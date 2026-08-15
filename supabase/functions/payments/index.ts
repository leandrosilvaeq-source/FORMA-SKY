// Edge Function: payments
//
// Rota implementada:
//   POST /payments -> RPC register_payment
//
// payments NÃO possui nenhuma rota GET/PATCH/DELETE (mesma decisão já
// confirmada para orders/order-items/order-status/order-approvals —
// leituras do Bloco 1 ficam no frontend via Supabase client autenticado +
// RLS/security_invoker).
//
// RPC usada, conferida contra
// supabase/migrations/20260814030351_create_order_business_functions.sql
// (não tocada por nenhuma migration posterior):
//   register_payment(p_order_id uuid, p_payment_method text,
//     p_amount numeric(10,2), p_payment_type text, p_paid_at timestamptz,
//     p_changed_by uuid, p_notes text default null) returns uuid
// security definer, EXECUTE concedido só a service_role.
//
// Validado localmente só o que é decidível a partir do próprio payload
// (payment_method/payment_type/amount<>0/consistência amount×payment_type/
// notes em ajuste negativo — todas constraints reais de public.payments,
// Migration 12). NÃO replicado: proteção contra saldo acumulado negativo
// (depende da soma de pagamentos já existentes do pedido), recálculo de
// total_paid/payment_status/payment_status_history/subtotal/total_value/
// overpayment — tudo isso continua exclusivamente em register_payment() e
// recalculate_order_financials().

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import {
  isUuid,
  requireTimestamp,
  optionalString,
  parseJsonBody,
  rejectIdentityFields,
} from "../_shared/validate.ts";

// payments.payment_method (Migration 12): CHECK exato.
const PAYMENT_METHODS = ["PIX", "DINHEIRO", "CARTAO"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// payments.payment_type (Migration 12): CHECK exato.
const PAYMENT_TYPES = ["SINAL", "FINAL", "INTEGRAL", "AJUSTE"] as const;
type PaymentType = (typeof PAYMENT_TYPES)[number];

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("payments");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (req.method === "POST" && route.length === 0) {
      return await handleRegisterPayment(req);
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

// payments.amount: NOT NULL, check (amount <> 0). Só a finitude/não-zero é
// verificável sem conhecer payment_type — a consistência com payment_type
// (payments_amount_type_consistency) é checada separadamente no handler.
function requireAmount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field}.`);
  }
  if (value === 0) {
    throw new ValidationError(`Campo inválido: ${field} não pode ser zero.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// POST /payments -> register_payment(p_order_id, p_payment_method, p_amount,
//   p_payment_type, p_paid_at, p_changed_by, p_notes)
//
// p_paid_at não tem DEFAULT no SQL (coluna payments.paid_at é NOT NULL, sem
// default) — sempre obrigatório, validado com requireTimestamp. Nenhum
// now() inventado.
//
// p_notes tem DEFAULT null literal no SQL — enviado como null explícito
// quando ausente, resultado idêntico a omitir a chave.
// ---------------------------------------------------------------------------
async function handleRegisterPayment(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const orderId = requireUuid(body.order_id, "order_id");
  const paymentMethod = requireEnum<PaymentMethod>(
    body.payment_method,
    "payment_method",
    PAYMENT_METHODS,
  );
  const paymentType = requireEnum<PaymentType>(body.payment_type, "payment_type", PAYMENT_TYPES);
  const amount = requireAmount(body.amount, "amount");

  // Espelha payments_amount_type_consistency: payment_type = 'AJUSTE' or
  // amount > 0 — amount já não pode ser 0 (requireAmount acima), então
  // isto rejeita amount negativo para qualquer tipo diferente de AJUSTE.
  if (paymentType !== "AJUSTE" && amount < 0) {
    throw new ValidationError(
      "Campo inválido: amount deve ser > 0 quando payment_type é SINAL, FINAL ou INTEGRAL " +
        "(somente AJUSTE aceita valor negativo).",
    );
  }

  const paidAt = requireTimestamp(body.paid_at, "paid_at");
  const notes = optionalString(body.notes, "notes");

  // Espelha payments_negative_adjustment_requires_notes: amount >= 0 or
  // (notes is not null and length(btrim(notes)) > 0). trim() usado só para
  // checar presença de conteúdo — o valor enviado à RPC é o `notes`
  // original, sem alteração.
  if (amount < 0 && (notes === null || notes.trim().length === 0)) {
    throw new ValidationError(
      "Campo inválido: notes é obrigatório e não pode ser vazio/conter só espaços quando " +
        "amount é negativo (ajuste negativo).",
    );
  }

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("register_payment", {
    p_order_id: orderId,
    p_payment_method: paymentMethod,
    p_amount: amount,
    p_payment_type: paymentType,
    p_paid_at: paidAt,
    p_changed_by: operator.userId,
    p_notes: notes,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { id: data }, 201);
}
