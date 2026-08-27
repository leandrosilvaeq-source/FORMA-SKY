// Handler + validadores da Edge Function `filament-movements` — sem nenhum
// efeito colateral de módulo (nenhum Deno.serve aqui), mesmo padrão de
// stock-movements/handler.ts.
//
// Rotas:
//   POST /filament-movements          -> RPC register_filament_movement (8 tipos manuais)
//   POST /filament-movements/weighing -> RPC register_filament_weighing ("Registrar pesagem")
//
// As duas RPCs são security definer com EXECUTE concedido só a
// service_role (supabase/migrations/20260827110000_create_filament_movements_table.sql)
// — só alcançáveis a partir desta Edge Function, nunca diretamente do
// frontend. Nenhuma escrita direta em public.filament_movements nem em
// filament_spools.current_net_weight_grams/status acontece nesta Edge
// Function.
//
// Validação estrutural (payload) vive aqui — regras que dependem de ler o
// banco (peso insuficiente, teto do nominal, rolo descartado, tara
// desconhecida, INITIAL_BALANCE repetido, idempotency_key já usada)
// continuam exclusivas das RPCs, mesmo critério de stock-movements/handler.ts.
//
// Leitura do histórico continua via supabase-js direto do frontend
// (frontend/src/lib/api/filamentMovements.ts) — GRANT SELECT a
// authenticated, RLS "Active users can view filament movements".

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { AppError, NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import {
  isUuid,
  optionalUuid,
  optionalString,
  optionalNumber,
  parseJsonBody,
  rejectIdentityFields,
  requireTimestamp,
} from "../_shared/validate.ts";

// WEIGHING_ADJUSTMENT NUNCA aparece aqui — só register_filament_weighing
// (rota /weighing) pode gravá-lo; register_filament_movement rejeita esse
// valor mesmo se enviado (defesa em profundidade, ver migration).
const FILAMENT_MOVEMENT_TYPES = [
  "INITIAL_BALANCE",
  "PURCHASE",
  "RETURN",
  "POSITIVE_ADJUSTMENT",
  "MANUAL_CONSUMPTION",
  "LOSS",
  "SAMPLE_TEST",
  "NEGATIVE_ADJUSTMENT",
] as const;

// Espelha exatamente filament_movements_reason_required_by_type (migration
// 20260827110000) — replicado aqui só para dar erro estrutural imediato.
const REASON_REQUIRED_MOVEMENT_TYPES = new Set<string>([
  "POSITIVE_ADJUSTMENT",
  "NEGATIVE_ADJUSTMENT",
  "LOSS",
  "SAMPLE_TEST",
  "MANUAL_CONSUMPTION",
]);

const FILAMENT_MOVEMENT_KEYS = [
  "spool_id",
  "movement_type",
  "quantity",
  "reason",
  "reference_type",
  "reference_id",
  "occurred_at",
  "idempotency_key",
] as const;

const FILAMENT_WEIGHING_KEYS = [
  "spool_id",
  "measured_gross_weight_grams",
  "measured_net_weight_grams",
  "reason",
  "occurred_at",
  "idempotency_key",
] as const;

export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("filament-movements");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (route.length === 0) {
      if (req.method === "POST") return await handleRegisterFilamentMovement(req);
      throw new AppError("validation", 405, `Método ${req.method} não permitido em /filament-movements.`);
    }

    if (route.length === 1 && route[0] === "weighing") {
      if (req.method === "POST") return await handleRegisterFilamentWeighing(req);
      throw new AppError("validation", 405, `Método ${req.method} não permitido em /filament-movements/weighing.`);
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
}

// ---------------------------------------------------------------------------
// Validadores locais
// ---------------------------------------------------------------------------

export function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const unknown = Object.keys(obj).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(
      `Campo(s) não suportado(s) em ${context}: ${unknown.join(", ")}. ` +
        `Campos aceitos: ${allowed.join(", ")}.`,
    );
  }
}

export function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field}.`);
  }
  return value;
}

export function requireFilamentMovementType(value: unknown): (typeof FILAMENT_MOVEMENT_TYPES)[number] {
  if (typeof value !== "string" || !(FILAMENT_MOVEMENT_TYPES as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: movement_type deve ser um de: ${FILAMENT_MOVEMENT_TYPES.join(", ")}.`);
  }
  return value as (typeof FILAMENT_MOVEMENT_TYPES)[number];
}

// Sempre uma quantidade POSITIVA em gramas — o sinal é resolvido pela RPC a
// partir de movement_type. Fracionário (grama não é uma grandeza inteira),
// ao contrário de requirePositiveIntegerQuantity em stock-movements/handler.ts.
export function requirePositiveQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError("Campo inválido: quantity deve ser um número positivo (gramas).");
  }
  return value;
}

export function optionalNonEmptyString(value: unknown, field: string): string | null {
  const raw = optionalString(value, field);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireTimestamp(value, field);
}

// ---------------------------------------------------------------------------
// POST /filament-movements -> register_filament_movement(p_spool_id,
//   p_movement_type, p_quantity, p_changed_by, p_reason, p_occurred_at,
//   p_reference_type, p_reference_id, p_idempotency_key)
// ---------------------------------------------------------------------------
export function validateRegisterFilamentMovementPayload(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, FILAMENT_MOVEMENT_KEYS, "corpo da requisição");

  const movementType = requireFilamentMovementType(body.movement_type);
  const reason = optionalNonEmptyString(body.reason, "reason");

  if (REASON_REQUIRED_MOVEMENT_TYPES.has(movementType) && reason === null) {
    throw new ValidationError(`Campo obrigatório ausente: reason é obrigatório para movement_type ${movementType}.`);
  }

  return {
    p_spool_id: requireUuid(body.spool_id, "spool_id"),
    p_movement_type: movementType,
    p_quantity: requirePositiveQuantity(body.quantity),
    p_reason: reason,
    p_occurred_at: optionalTimestamp(body.occurred_at, "occurred_at"),
    p_reference_type: optionalNonEmptyString(body.reference_type, "reference_type"),
    p_reference_id: optionalUuid(body.reference_id, "reference_id"),
    p_idempotency_key: optionalNonEmptyString(body.idempotency_key, "idempotency_key"),
  };
}

async function handleRegisterFilamentMovement(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const params = validateRegisterFilamentMovementPayload(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("register_filament_movement", {
    ...params,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 201);
}

// ---------------------------------------------------------------------------
// POST /filament-movements/weighing -> register_filament_weighing(p_spool_id,
//   p_measured_gross_weight_grams, p_measured_net_weight_grams, p_reason,
//   p_changed_by, p_occurred_at, p_idempotency_key)
//
// Exatamente um dos dois pesos deve ser informado — validado aqui (erro
// estrutural imediato) além da RPC (defesa em profundidade). reason é
// SEMPRE obrigatório para pesagem (nenhuma tolerância percentual é
// aplicada — motivo obrigatório independente do tamanho da diferença).
//
// A RPC pode devolver null (delta zero: nada mudou) — nesse caso a resposta
// é 200 com movement: null, nunca um 201 fabricando uma movimentação que
// não foi gravada.
// ---------------------------------------------------------------------------
export function validateRegisterFilamentWeighingPayload(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, FILAMENT_WEIGHING_KEYS, "corpo da requisição");

  const grossWeight = optionalNumber(body.measured_gross_weight_grams, "measured_gross_weight_grams", { min: 0 });
  const netWeight = optionalNumber(body.measured_net_weight_grams, "measured_net_weight_grams", { min: 0 });

  if ((grossWeight === null) === (netWeight === null)) {
    throw new ValidationError(
      "Informe exatamente um dos dois pesos: measured_gross_weight_grams (peso bruto medido, quando a tara do rolo é conhecida) OU measured_net_weight_grams (peso líquido disponível, quando não é).",
    );
  }

  const reason = optionalNonEmptyString(body.reason, "reason");
  if (reason === null) {
    throw new ValidationError("Campo obrigatório ausente: reason é obrigatório para registrar uma pesagem.");
  }

  return {
    p_spool_id: requireUuid(body.spool_id, "spool_id"),
    p_measured_gross_weight_grams: grossWeight,
    p_measured_net_weight_grams: netWeight,
    p_reason: reason,
    p_occurred_at: optionalTimestamp(body.occurred_at, "occurred_at"),
    p_idempotency_key: optionalNonEmptyString(body.idempotency_key, "idempotency_key"),
  };
}

async function handleRegisterFilamentWeighing(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const params = validateRegisterFilamentWeighingPayload(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("register_filament_weighing", {
    ...params,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  if (data === null) {
    return jsonResponse(req, { movement: null, message: "Nenhuma diferença encontrada em relação ao peso já registrado." }, 200);
  }

  return jsonResponse(req, { movement: data }, 201);
}
