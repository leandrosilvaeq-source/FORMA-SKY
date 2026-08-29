// Edge Function: customers — entrypoint.
//
// Toda a lógica vive em handler.ts (sem Deno.serve) — mesmo padrão de
// accessories/index.ts, orders/index.ts, products/index.ts etc. Função nova
// (2026-08-29): a primeira Edge Function dedicada a clientes — leitura e
// criação/edição continuam via supabase-js direto
// (frontend/src/lib/api/customers.ts, RLS + grants diretos já concedidos em
// 20260813204515_create_customers_table.sql); só a exclusão física exige uma
// RPC security definer (delete_customer,
// 20260829140000_add_customer_deletion_function.sql), inacessível
// diretamente do frontend.
import { handleRequest } from "./handler.ts";

Deno.serve(handleRequest);
