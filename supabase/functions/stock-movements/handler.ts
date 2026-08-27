// Handler + validadores da Edge Function `stock-movements` — sem nenhum
// efeito colateral de módulo (nenhum Deno.serve aqui), mesmo padrão de
// accessories/handler.ts e packaging/handler.ts.
//
// Rota:
//   POST /stock-movements -> RPC register_stock_movement
//
// register_stock_movement é security definer com EXECUTE concedido só a
// service_role (supabase/migrations/20260827090000_create_stock_movements_table.sql)
// — só alcançável a partir desta Edge Function, nunca diretamente do
// frontend. Nenhuma escrita direta em public.stock_movements nem em
// accessories.current_stock/packaging.current_stock acontece nesta Edge
// Function — a RPC é a única forma de escrita para as duas, exatamente como
// já era antes desta rodada (a migration já revogava INSERT/UPDATE/DELETE
// de authenticated/anon em stock_movements, e current_stock já não é
// gravável direto desde a Migration 18).
//
// Validação estrutural (payload) vive aqui: item_type/movement_type dentro
// do enum conhecido, item_id/reference_id como UUID, quantity como inteiro
// positivo, motivo obrigatório por movement_type (função pura do próprio
// payload, sem depender do banco). Regras que dependem de ler o banco
// (saldo insuficiente, INITIAL_BALANCE repetido/exige saldo zero, item
// realmente existe, idempotency_key já usada) continuam exclusivas da RPC —
// mesmo critério já usado em accessories/handler.ts e packaging/handler.ts.
//
// Leitura do histórico continua via supabase-js direto do frontend
// (frontend/src/lib/api/stockMovements.ts, listStockMovements) — GRANT
// SELECT a authenticated preservado, RLS "Active users can view stock
// movements" inalterada; não afetado por esta Edge Function.

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { AppError, NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import {
  isUuid,
  optionalUuid,
  optionalString,
  parseJsonBody,
  rejectIdentityFields,
  requireTimestamp,
} from "../_shared/validate.ts";

// Extensível a FILAMENT_SPOOL no futuro (Incremento 5) — só ampliar esta
// lista quando a RPC também aceitar (o CHECK do banco muda junto, nunca
// independentemente).
const STOCK_ITEM_TYPES = ["ACCESSORY", "PACKAGING"] as const;

// Extensível a RESERVATION/RELEASE/CONSUMPTION/WEIGHING no futuro
// (Incrementos 5/7/8) — mesma ressalva do item_type acima.
const STOCK_MOVEMENT_TYPES = [
  "INITIAL_BALANCE",
  "PURCHASE",
  "RETURN",
  "POSITIVE_ADJUSTMENT",
  "LOSS",
  "SAMPLE_DONATION",
  "INTERNAL_USE",
  "NEGATIVE_ADJUSTMENT",
] as const;

// Espelha exatamente stock_movements_reason_required_by_type (migration
// 20260827090000) — nenhuma regra nova inventada aqui, só replicada para dar
// erro estrutural imediato (400) em vez de round-trip até a RPC para algo
// que não depende do banco.
const REASON_REQUIRED_MOVEMENT_TYPES = new Set<string>([
  "POSITIVE_ADJUSTMENT",
  "NEGATIVE_ADJUSTMENT",
  "LOSS",
  "SAMPLE_DONATION",
  "INTERNAL_USE",
]);

const STOCK_MOVEMENT_KEYS = [
  "item_type",
  "item_id",
  "movement_type",
  "quantity",
  "reason",
  "reference_type",
  "reference_id",
  "occurred_at",
  "idempotency_key",
] as const;

export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("stock-movements");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (route.length === 0) {
      if (req.method === "POST") return await handleRegisterStockMovement(req);
      throw new AppError("validation", 405, `Método ${req.method} não permitido em /stock-movements.`);
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
}

// ---------------------------------------------------------------------------
// Validadores locais (mesmo critério de "validador específico desta rota,
// não promovido a _shared/validate.ts ainda" já usado em accessories/
// handler.ts e packaging/handler.ts).
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

export function requireStockItemType(value: unknown): (typeof STOCK_ITEM_TYPES)[number] {
  if (typeof value !== "string" || !(STOCK_ITEM_TYPES as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: item_type deve ser um de: ${STOCK_ITEM_TYPES.join(", ")}.`);
  }
  return value as (typeof STOCK_ITEM_TYPES)[number];
}

export function requireStockMovementType(value: unknown): (typeof STOCK_MOVEMENT_TYPES)[number] {
  if (typeof value !== "string" || !(STOCK_MOVEMENT_TYPES as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: movement_type deve ser um de: ${STOCK_MOVEMENT_TYPES.join(", ")}.`);
  }
  return value as (typeof STOCK_MOVEMENT_TYPES)[number];
}

// Sempre uma quantidade POSITIVA — o sinal é resolvido pela RPC a partir de
// movement_type, mesmo contrato de register_stock_movement(). Rejeita
// fração aqui mesmo (a RPC também rejeita, em profundidade) para dar erro
// imediato sem round-trip.
export function requirePositiveIntegerQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError("Campo inválido: quantity deve ser um número positivo.");
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError("Campo inválido: quantity deve ser um número inteiro, sem casas decimais.");
  }
  return value;
}

// String vazia (inclusive só espaços) normaliza para null — nunca envia ""
// para a RPC, mesmo idioma de optionalTrimmedString em accessories/handler.ts.
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
// POST /stock-movements -> register_stock_movement(p_item_type, p_item_id,
//   p_movement_type, p_quantity, p_changed_by, p_reason, p_occurred_at,
//   p_reference_type, p_reference_id, p_idempotency_key)
// ---------------------------------------------------------------------------
export function validateRegisterStockMovementPayload(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, STOCK_MOVEMENT_KEYS, "corpo da requisição");

  const itemType = requireStockItemType(body.item_type);
  const movementType = requireStockMovementType(body.movement_type);
  const reason = optionalNonEmptyString(body.reason, "reason");

  if (REASON_REQUIRED_MOVEMENT_TYPES.has(movementType) && reason === null) {
    throw new ValidationError(`Campo obrigatório ausente: reason é obrigatório para movement_type ${movementType}.`);
  }

  return {
    p_item_type: itemType,
    p_item_id: requireUuid(body.item_id, "item_id"),
    p_movement_type: movementType,
    p_quantity: requirePositiveIntegerQuantity(body.quantity),
    p_reason: reason,
    p_occurred_at: optionalTimestamp(body.occurred_at, "occurred_at"),
    p_reference_type: optionalNonEmptyString(body.reference_type, "reference_type"),
    p_reference_id: optionalUuid(body.reference_id, "reference_id"),
    p_idempotency_key: optionalNonEmptyString(body.idempotency_key, "idempotency_key"),
  };
}

// Resposta: a movimentação completa gravada pela RPC — balance_after já É o
// novo saldo do item, não é preciso um campo/consulta separados só para
// devolver "o saldo atualizado" (requisito do pedido já satisfeito pelo
// próprio retorno de register_stock_movement()).
async function handleRegisterStockMovement(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const params = validateRegisterStockMovementPayload(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("register_stock_movement", {
    ...params,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 201);
}
