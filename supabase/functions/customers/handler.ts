// Handler da Edge Function `customers` — sem nenhum efeito colateral de
// módulo (nenhum Deno.serve aqui), mesmo padrão de accessories/handler.ts,
// orders/handler.ts, products/handler.ts etc.
//
// Rota:
//   DELETE /customers/:id -> RPC delete_customer
//
// Nenhuma outra rota existe aqui: leitura (listCustomers/getCustomer) e
// escrita de criação/edição (createCustomer/updateCustomer, incluindo
// ativar/desativar via is_active) continuam via supabase-js direto — RLS +
// grants diretos já concedidos a authenticated
// (20260813204515_create_customers_table.sql), nunca duplicados aqui.
// Exclusão física é a ÚNICA operação de clientes que passa por uma RPC
// security definer (delete_customer,
// 20260829140000_add_customer_deletion_function.sql) e, por isso, pela
// única Edge Function.

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import { isUuid } from "../_shared/validate.ts";

export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("customers");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (req.method === "DELETE" && route.length === 1) {
      return await handleDeleteCustomer(req, route[0]);
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
}

// ---------------------------------------------------------------------------
// DELETE /customers/:id -> delete_customer(p_customer_id, p_changed_by)
//
// Exclusão física protegida: bloqueada quando o cliente é um registro
// permanente/protegido (is_protected, PROTECTED_CUSTOMER: — checado
// primeiro, incondicional, independente de vínculos) ou quando tem pedido
// (CUSTOMER_HAS_ORDERS:) ou empresa (CUSTOMER_HAS_COMPANY:) vinculados —
// mensagens de negócio mapeadas por _shared/errors.ts (409). Nenhum corpo
// de requisição é lido.
// ---------------------------------------------------------------------------
async function handleDeleteCustomer(req: Request, customerId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(customerId)) {
    throw new ValidationError("Identificador de cliente inválido na rota.");
  }

  const admin = getAdminClient();
  const { error } = await admin.rpc("delete_customer", {
    p_customer_id: customerId,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { success: true }, 200);
}
