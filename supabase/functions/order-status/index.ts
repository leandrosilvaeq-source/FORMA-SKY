// Edge Function: order-status
//
// Rota implementada:
//   POST /order-status/:orderId -> RPC change_order_status
//
// order-status NÃO possui nenhuma rota GET (mesma decisão já confirmada
// para orders/order-items — leituras do Bloco 1 ficam no frontend via
// Supabase client autenticado + RLS/security_invoker).
//
// RPC usada, conferida contra
// supabase/migrations/20260814030351_create_order_business_functions.sql
// (change_order_status não foi tocada por nenhuma migration posterior):
//   change_order_status(p_order_id uuid, p_to_status text,
//     p_changed_by uuid, p_reason text default null) returns void
// security definer, EXECUTE concedido só a service_role.
//
// A máquina de estados inteira (sequência permitida, proibição de pular
// estados, elegibilidade de cancelamento, autoaprovação via
// try_auto_approve_order, gate de SPOT para IN_PRODUCTION_QUEUE) NÃO é
// replicada aqui — a RPC é a única fonte de verdade para essas regras.
// Esta Edge Function só valida formato (UUID, enum de to_status, tipo de
// reason) e encaminha.

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import { isUuid, optionalString, parseJsonBody, rejectIdentityFields } from "../_shared/validate.ts";

// Idêntico ao CHECK de orders.order_status e de order_status_history.to_status.
const ORDER_STATUSES = [
  "QUOTE",
  "WAITING_APPROVAL",
  "APPROVED",
  "IN_PRODUCTION_QUEUE",
  "IN_PRODUCTION",
  "WAITING_DELIVERY",
  "DELIVERED",
  "CANCELLED",
] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("order-status");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (req.method === "POST" && route.length === 1) {
      return await handleChangeOrderStatus(req, route[0]);
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

function requireOrderStatus(value: unknown, field: string): OrderStatus {
  if (typeof value !== "string" || !(ORDER_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError(
      `Campo inválido: ${field} deve ser um de: ${ORDER_STATUSES.join(", ")}.`,
    );
  }
  return value as OrderStatus;
}

// ---------------------------------------------------------------------------
// POST /order-status/:orderId -> change_order_status(p_order_id, p_to_status,
//   p_changed_by, p_reason default null)
//
// p_reason tem DEFAULT null no SQL — quando o cliente não informa reason
// (ausente ou null), a chave p_reason é OMITIDA do objeto de parâmetros,
// deixando o Postgres aplicar seu próprio default, em vez de replicar
// "null" explicitamente na Edge Function (mesmo padrão já usado para
// update_product_price.p_effective_from em products/index.ts).
// ---------------------------------------------------------------------------
async function handleChangeOrderStatus(req: Request, orderIdParam: string): Promise<Response> {
  const operator = await resolveOperator(req);

  const orderId = requireUuid(orderIdParam, "orderId");

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const toStatus = requireOrderStatus(body.to_status, "to_status");
  const reason = optionalString(body.reason, "reason");

  const params: Record<string, unknown> = {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_changed_by: operator.userId,
  };
  if (reason !== null) {
    params.p_reason = reason;
  }

  const admin = getAdminClient();
  const { error } = await admin.rpc("change_order_status", params);

  if (error) throw mapPgError(error);

  return jsonResponse(req, { success: true }, 200);
}
