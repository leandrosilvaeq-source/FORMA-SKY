// Handler + validadores da Edge Function `filament-types` — sem nenhum
// efeito colateral de módulo (nenhum Deno.serve aqui), mesmo padrão de
// accessories/handler.ts e packaging/handler.ts.
//
// Rotas:
//   POST   /filament-types       -> RPC create_filament_type
//   PATCH  /filament-types/:id   -> RPC update_filament_type (edição e/ou ativar/desativar)
//   DELETE /filament-types/:id   -> RPC remove_filament_type (remoção segura transacional:
//                                   exclusão física sem referência; arquivamento atômico
//                                   do tipo + rolos com qualquer referência; bloqueio por
//                                   pedido ativo — FILAMENT_TYPE_IN_ACTIVE_ORDER:).
//                                   Resposta { result: 'PHYSICALLY_DELETED' | 'ARCHIVED',
//                                   archived_spool_count: number }.
//
// As 3 RPCs são security definer com EXECUTE concedido só a service_role
// (supabase/migrations/20260827100000_create_filament_types_table.sql) —
// só alcançáveis a partir desta Edge Function, nunca diretamente do
// frontend. Nenhum INSERT/UPDATE/DELETE direto de `authenticated` em
// public.filament_types é concedido — só SELECT.
//
// Leitura/listagem continua via supabase-js direto do frontend
// (frontend/src/lib/api/filamentTypes.ts) — GRANT SELECT a authenticated,
// RLS "Active users can view filament types"; não afetado por esta Edge
// Function.

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { AppError, NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import {
  isUuid,
  optionalString,
  optionalNumber,
  optionalBoolean,
  parseJsonBody,
  rejectIdentityFields,
} from "../_shared/validate.ts";

// Material fechado (PLA/PETG/TPU) — ABS explicitamente fora do MVP
// aprovado nesta rodada. line NÃO é validada contra nenhuma lista aqui —
// texto livre, cadastrável (ver comentário de filament_types.line na
// migration): as 5 linhas sugeridas (Sólida/Silk/Velvet/Translúcido/
// DuoColor) são só opções de interface no frontend, nunca uma validação de
// servidor.
const FILAMENT_MATERIALS = ["PLA", "PETG", "TPU"] as const;

const FILAMENT_TYPE_KEYS = [
  "material",
  "manufacturer",
  "line",
  "commercial_color",
  "color_code",
  "minimum_stock_grams",
  "is_active",
  "notes",
] as const;

export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("filament-types");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (route.length === 0) {
      if (req.method === "POST") return await handleCreateFilamentType(req);
      throw new AppError("validation", 405, `Método ${req.method} não permitido em /filament-types.`);
    }

    if (route.length === 1) {
      if (req.method === "PATCH") return await handleUpdateFilamentType(req, route[0]);
      if (req.method === "DELETE") return await handleDeleteFilamentType(req, route[0]);
      throw new AppError("validation", 405, `Método ${req.method} não permitido em /filament-types/:id.`);
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
}

// ---------------------------------------------------------------------------
// Validadores locais (mesmo critério de "validador específico desta rota,
// não promovido a _shared/validate.ts ainda" já usado em accessories/
// handler.ts).
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

export function requireFilamentMaterial(value: unknown): (typeof FILAMENT_MATERIALS)[number] {
  if (typeof value !== "string" || !(FILAMENT_MATERIALS as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: material deve ser um de: ${FILAMENT_MATERIALS.join(", ")}.`);
  }
  return value as (typeof FILAMENT_MATERIALS)[number];
}

export function requireTrimmedNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field}.`);
  }
  return value.trim();
}

export function optionalTrimmedString(value: unknown, field: string): string | null {
  const raw = optionalString(value, field);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// ---------------------------------------------------------------------------
// POST /filament-types -> create_filament_type(p_material, p_manufacturer,
//   p_line, p_commercial_color, p_color_code, p_minimum_stock_grams,
//   p_is_active, p_notes, p_changed_by)
// ---------------------------------------------------------------------------
export function validateCreateFilamentTypePayload(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, FILAMENT_TYPE_KEYS, "corpo da requisição");

  return {
    p_material: requireFilamentMaterial(body.material),
    p_manufacturer: requireTrimmedNonEmpty(body.manufacturer, "manufacturer"),
    p_line: requireTrimmedNonEmpty(body.line, "line"),
    p_commercial_color: requireTrimmedNonEmpty(body.commercial_color, "commercial_color"),
    p_color_code: optionalTrimmedString(body.color_code, "color_code"),
    p_minimum_stock_grams: optionalNumber(body.minimum_stock_grams, "minimum_stock_grams", { min: 0 }),
    p_is_active: optionalBoolean(body.is_active, "is_active"),
    p_notes: optionalTrimmedString(body.notes, "notes"),
  };
}

async function handleCreateFilamentType(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const params = validateCreateFilamentTypePayload(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("create_filament_type", {
    ...params,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 201);
}

// ---------------------------------------------------------------------------
// PATCH /filament-types/:id -> update_filament_type(p_filament_type_id,
//   p_patch, p_changed_by)
// ---------------------------------------------------------------------------
export function buildFilamentTypePatch(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, FILAMENT_TYPE_KEYS, "corpo do PATCH");

  const patch: Record<string, unknown> = {};

  if ("material" in body) {
    patch.material = requireFilamentMaterial(body.material);
  }
  if ("manufacturer" in body) {
    patch.manufacturer = requireTrimmedNonEmpty(body.manufacturer, "manufacturer");
  }
  if ("line" in body) {
    patch.line = requireTrimmedNonEmpty(body.line, "line");
  }
  if ("commercial_color" in body) {
    patch.commercial_color = requireTrimmedNonEmpty(body.commercial_color, "commercial_color");
  }
  if ("color_code" in body) {
    patch.color_code = optionalTrimmedString(body.color_code, "color_code");
  }
  if ("minimum_stock_grams" in body) {
    patch.minimum_stock_grams = optionalNumber(body.minimum_stock_grams, "minimum_stock_grams", { min: 0 });
  }
  if ("is_active" in body) {
    if (body.is_active === null) {
      throw new ValidationError("Campo inválido: is_active não pode ser null (coluna obrigatória).");
    }
    patch.is_active = optionalBoolean(body.is_active, "is_active");
  }
  if ("notes" in body) {
    patch.notes = optionalTrimmedString(body.notes, "notes");
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("PATCH vazio: informe ao menos um campo reconhecido para alterar.");
  }

  return patch;
}

async function handleUpdateFilamentType(req: Request, filamentTypeId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(filamentTypeId)) {
    throw new ValidationError("Identificador de tipo de filamento inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const patch = buildFilamentTypePatch(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("update_filament_type", {
    p_filament_type_id: filamentTypeId,
    p_patch: patch,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 200);
}

// ---------------------------------------------------------------------------
// DELETE /filament-types/:id -> remove_filament_type(p_filament_type_id, p_changed_by)
//
// Remoção segura transacional (migration 20260903120000): sem nenhuma
// referência -> exclusão física; com qualquer referência -> arquiva o tipo
// e todos os seus rolos na mesma transação; pedido ATIVO usando o tipo ->
// bloqueio (FILAMENT_TYPE_IN_ACTIVE_ORDER:, mapeado para 409 com a mensagem
// real). A RPC devolve jsonb { result, archived_spool_count } — repassado
// ao frontend para escolher entre "excluído" e "removido do estoque".
// ---------------------------------------------------------------------------
// A RPC remove_filament_type devolve jsonb { result: 'PHYSICALLY_DELETED' |
// 'ARCHIVED', archived_spool_count: number }. Normaliza para a interface
// sem confiar cegamente no shape (defesa em profundidade): qualquer coisa
// que não seja explicitamente PHYSICALLY_DELETED é tratada como ARCHIVED, e
// archived_spool_count só é repassado quando vem como número.
export function normalizeRemoveFilamentTypeResult(
  data: unknown,
): { result: "PHYSICALLY_DELETED" | "ARCHIVED"; archived_spool_count: number } {
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    result: obj.result === "PHYSICALLY_DELETED" ? "PHYSICALLY_DELETED" : "ARCHIVED",
    archived_spool_count:
      typeof obj.archived_spool_count === "number" ? obj.archived_spool_count : 0,
  };
}

async function handleDeleteFilamentType(req: Request, filamentTypeId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(filamentTypeId)) {
    throw new ValidationError("Identificador de tipo de filamento inválido na rota.");
  }

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("remove_filament_type", {
    p_filament_type_id: filamentTypeId,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  const normalized = normalizeRemoveFilamentTypeResult(data);

  return jsonResponse(req, { success: true, ...normalized }, 200);
}
