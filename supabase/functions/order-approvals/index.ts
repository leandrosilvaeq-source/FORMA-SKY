// Edge Function: order-approvals
//
// Rotas implementadas (explícitas, sem campo action):
//   POST /order-approvals/approvals -> RPC register_approval
//   POST /order-approvals/versions  -> RPC register_custom_version
//
// order-approvals NÃO possui nenhuma rota GET (mesma decisão já confirmada
// para orders/order-items/order-status — leituras do Bloco 1 ficam no
// frontend via Supabase client autenticado + RLS/security_invoker).
//
// RPCs usadas, conferidas contra
// supabase/migrations/20260814030351_create_order_business_functions.sql
// (nenhuma das duas foi tocada por migration posterior):
//   register_approval(p_order_item_id uuid, p_approval_type text,
//     p_approved_at timestamptz, p_changed_by uuid,
//     p_custom_version_id uuid default null,
//     p_approval_evidence_file_id uuid default null,
//     p_notes text default null) returns uuid
//   register_custom_version(p_order_item_id uuid, p_version_number text,
//     p_changed_by uuid, p_change_type text default null,
//     p_change_description text default null,
//     p_file_id uuid default null) returns uuid
// Ambas security definer, EXECUTE concedido só a service_role.
//
// Regras de negócio (CATALOG não pode ser aprovado, SPOT não usa
// custom_version_id, CUSTOM exige custom_version_id da versão atual,
// autoaprovação via try_auto_approve_order, item precisa ser CUSTOM para
// nova versão, versão duplicada, bloqueio após início da produção,
// regressão para WAITING_APPROVAL) NÃO são replicadas aqui — as duas RPCs
// continuam sendo a única fonte de verdade. Esta Edge Function só valida
// formato (UUID, enum, timestamp, regex de versão) e encaminha.

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import {
  isUuid,
  requireString,
  requireTimestamp,
  optionalString,
  optionalUuid,
  parseJsonBody,
  rejectIdentityFields,
} from "../_shared/validate.ts";

// approvals.approval_type (Migration 9): CHECK exato.
const APPROVAL_TYPES = ["WHATSAPP", "PHOTO", "FORMAL_DOCUMENT", "OTHER"] as const;
type ApprovalType = (typeof APPROVAL_TYPES)[number];

// custom_versions.version_number (Migration 9): CHECK exato, mesmo padrão
// já usado em orders/order-items para custom_details.current_version.
const CUSTOM_VERSION_PATTERN = /^v[0-9]+\.[0-9]+$/;

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("order-approvals");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (req.method === "POST" && route.length === 1 && route[0] === "approvals") {
      return await handleRegisterApproval(req);
    }

    if (req.method === "POST" && route.length === 1 && route[0] === "versions") {
      return await handleRegisterCustomVersion(req);
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
});

function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field} deve ser um UUID.`);
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: ${field} deve ser um de: ${allowed.join(", ")}.`);
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// POST /order-approvals/approvals -> register_approval(p_order_item_id,
//   p_approval_type, p_approved_at, p_changed_by, p_custom_version_id,
//   p_approval_evidence_file_id, p_notes)
//
// p_approved_at não tem DEFAULT no SQL (coluna approvals.approved_at é NOT
// NULL, sem default) — sempre obrigatório, validado com requireTimestamp
// (já existente em _shared/validate.ts, mesmo usado para
// update_product_price.effective_from). Nenhum default inventado aqui.
//
// Os demais parâmetros opcionais (custom_version_id,
// approval_evidence_file_id, notes) têm DEFAULT null literal no SQL —
// enviados como null explícito quando ausentes, resultado idêntico a
// omitir a chave.
// ---------------------------------------------------------------------------
async function handleRegisterApproval(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const orderItemId = requireUuid(body.order_item_id, "order_item_id");
  const approvalType = requireEnum<ApprovalType>(body.approval_type, "approval_type", APPROVAL_TYPES);
  const approvedAt = requireTimestamp(body.approved_at, "approved_at");
  const customVersionId = optionalUuid(body.custom_version_id, "custom_version_id");
  const approvalEvidenceFileId = optionalUuid(
    body.approval_evidence_file_id,
    "approval_evidence_file_id",
  );
  const notes = optionalString(body.notes, "notes");

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("register_approval", {
    p_order_item_id: orderItemId,
    p_approval_type: approvalType,
    p_approved_at: approvedAt,
    p_changed_by: operator.userId,
    p_custom_version_id: customVersionId,
    p_approval_evidence_file_id: approvalEvidenceFileId,
    p_notes: notes,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { id: data }, 201);
}

// ---------------------------------------------------------------------------
// POST /order-approvals/versions -> register_custom_version(p_order_item_id,
//   p_version_number, p_changed_by, p_change_type, p_change_description,
//   p_file_id)
//
// change_type é texto livre no banco (custom_versions.change_type não tem
// CHECK/enum) — validado só como string opcional, sem inventar um enum
// que não existe.
// ---------------------------------------------------------------------------
async function handleRegisterCustomVersion(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const orderItemId = requireUuid(body.order_item_id, "order_item_id");
  const versionNumber = requireString(body.version_number, "version_number");
  if (!CUSTOM_VERSION_PATTERN.test(versionNumber)) {
    throw new ValidationError(
      "Campo inválido: version_number deve seguir o formato vX.Y (ex.: v1.1).",
    );
  }
  const changeType = optionalString(body.change_type, "change_type");
  const changeDescription = optionalString(body.change_description, "change_description");
  const fileId = optionalUuid(body.file_id, "file_id");

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("register_custom_version", {
    p_order_item_id: orderItemId,
    p_version_number: versionNumber,
    p_changed_by: operator.userId,
    p_change_type: changeType,
    p_change_description: changeDescription,
    p_file_id: fileId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { id: data }, 201);
}
