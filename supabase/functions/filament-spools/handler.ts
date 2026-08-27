// Handler + validadores da Edge Function `filament-spools` — sem nenhum
// efeito colateral de módulo (nenhum Deno.serve aqui), mesmo padrão de
// filament-types/handler.ts.
//
// Rotas:
//   POST   /filament-spools       -> RPC create_filament_spool
//   PATCH  /filament-spools/:id   -> RPC update_filament_spool (cadastro, status, ativar/desativar)
//   DELETE /filament-spools/:id   -> RPC delete_filament_spool (exclusão protegida)
//
// As 3 RPCs são security definer com EXECUTE concedido só a service_role
// (supabase/migrations/20260827103000_create_filament_spools_table.sql) —
// só alcançáveis a partir desta Edge Function.
//
// Ação de pesagem ("Registrar pesagem") NÃO vive aqui — é uma rota da Edge
// Function `filament-movements` (POST /filament-movements/weighing), pois
// grava na mesma tabela de ledger (filament_movements) que as demais
// movimentações, reaproveitando a mesma RPC de escrita e o mesmo desenho de
// idempotência/concorrência.

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { AppError, NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import {
  isUuid,
  optionalString,
  optionalNumber,
  requireNumber,
  optionalBoolean,
  parseJsonBody,
  rejectIdentityFields,
} from "../_shared/validate.ts";

const FILAMENT_SPOOL_STATUSES = ["LACRADO", "ABERTO", "ESGOTADO", "DESCARTADO"] as const;

const CREATE_FILAMENT_SPOOL_KEYS = [
  "filament_type_id",
  "nominal_weight_grams",
  "empty_spool_weight_grams",
  "received_at",
  "status",
  "notes",
  "is_active",
] as const;

const UPDATE_FILAMENT_SPOOL_KEYS = [
  "nominal_weight_grams",
  "empty_spool_weight_grams",
  "received_at",
  "status",
  "notes",
  "is_active",
] as const;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("filament-spools");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (route.length === 0) {
      if (req.method === "POST") return await handleCreateFilamentSpool(req);
      throw new AppError("validation", 405, `Método ${req.method} não permitido em /filament-spools.`);
    }

    if (route.length === 1) {
      if (req.method === "PATCH") return await handleUpdateFilamentSpool(req, route[0]);
      if (req.method === "DELETE") return await handleDeleteFilamentSpool(req, route[0]);
      throw new AppError("validation", 405, `Método ${req.method} não permitido em /filament-spools/:id.`);
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

export function optionalTrimmedString(value: unknown, field: string): string | null {
  const raw = optionalString(value, field);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function optionalFilamentSpoolStatus(value: unknown): (typeof FILAMENT_SPOOL_STATUSES)[number] | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !(FILAMENT_SPOOL_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: status deve ser um de: ${FILAMENT_SPOOL_STATUSES.join(", ")}.`);
  }
  return value as (typeof FILAMENT_SPOOL_STATUSES)[number];
}

// received_at é uma DATA (não timestamp) — formato estrito YYYY-MM-DD, sem
// hora/fuso, mesmo grão do campo no banco (date).
export function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`Campo inválido: ${field} deve ser uma data no formato YYYY-MM-DD.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// POST /filament-spools -> create_filament_spool(p_filament_type_id,
//   p_nominal_weight_grams, p_empty_spool_weight_grams, p_received_at,
//   p_status, p_notes, p_is_active, p_changed_by)
// ---------------------------------------------------------------------------
export function validateCreateFilamentSpoolPayload(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, CREATE_FILAMENT_SPOOL_KEYS, "corpo da requisição");

  return {
    p_filament_type_id: requireUuid(body.filament_type_id, "filament_type_id"),
    p_nominal_weight_grams: requireNumber(body.nominal_weight_grams, "nominal_weight_grams", { min: 0.01 }),
    p_empty_spool_weight_grams: optionalNumber(body.empty_spool_weight_grams, "empty_spool_weight_grams", { min: 0 }),
    p_received_at: optionalDate(body.received_at, "received_at"),
    p_status: optionalFilamentSpoolStatus(body.status),
    p_notes: optionalTrimmedString(body.notes, "notes"),
    p_is_active: optionalBoolean(body.is_active, "is_active"),
  };
}

async function handleCreateFilamentSpool(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const params = validateCreateFilamentSpoolPayload(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("create_filament_spool", {
    ...params,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 201);
}

// ---------------------------------------------------------------------------
// PATCH /filament-spools/:id -> update_filament_spool(p_filament_spool_id,
//   p_patch, p_changed_by)
// ---------------------------------------------------------------------------
export function buildFilamentSpoolPatch(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, UPDATE_FILAMENT_SPOOL_KEYS, "corpo do PATCH");

  const patch: Record<string, unknown> = {};

  if ("nominal_weight_grams" in body) {
    patch.nominal_weight_grams = requireNumber(body.nominal_weight_grams, "nominal_weight_grams", { min: 0.01 });
  }
  if ("empty_spool_weight_grams" in body) {
    patch.empty_spool_weight_grams = optionalNumber(body.empty_spool_weight_grams, "empty_spool_weight_grams", { min: 0 });
  }
  if ("received_at" in body) {
    patch.received_at = optionalDate(body.received_at, "received_at");
  }
  if ("status" in body) {
    if (body.status === null) {
      throw new ValidationError("Campo inválido: status não pode ser null (coluna obrigatória).");
    }
    patch.status = optionalFilamentSpoolStatus(body.status);
  }
  if ("notes" in body) {
    patch.notes = optionalTrimmedString(body.notes, "notes");
  }
  if ("is_active" in body) {
    if (body.is_active === null) {
      throw new ValidationError("Campo inválido: is_active não pode ser null (coluna obrigatória).");
    }
    patch.is_active = optionalBoolean(body.is_active, "is_active");
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("PATCH vazio: informe ao menos um campo reconhecido para alterar.");
  }

  return patch;
}

async function handleUpdateFilamentSpool(req: Request, filamentSpoolId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(filamentSpoolId)) {
    throw new ValidationError("Identificador de rolo de filamento inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const patch = buildFilamentSpoolPatch(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("update_filament_spool", {
    p_filament_spool_id: filamentSpoolId,
    p_patch: patch,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 200);
}

// ---------------------------------------------------------------------------
// DELETE /filament-spools/:id -> delete_filament_spool(p_filament_spool_id, p_changed_by)
// ---------------------------------------------------------------------------
async function handleDeleteFilamentSpool(req: Request, filamentSpoolId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(filamentSpoolId)) {
    throw new ValidationError("Identificador de rolo de filamento inválido na rota.");
  }

  const admin = getAdminClient();
  const { error } = await admin.rpc("delete_filament_spool", {
    p_filament_spool_id: filamentSpoolId,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { success: true }, 200);
}
