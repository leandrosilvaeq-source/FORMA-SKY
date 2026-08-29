// Testes locais da Edge Function `customers` — mesmo padrão de
// supabase/functions/products/handler.test.ts e orders/handler.test.ts (sem
// dependência externa de framework de asserção, só `Deno.test`).
//
// Importa exclusivamente de handler.ts (nunca de index.ts) — handler.ts não
// tem nenhum efeito colateral de módulo (nenhum Deno.serve), então importá-lo
// aqui nunca abre um listener HTTP nem faz rede por conta própria.
//
// customers é uma Edge Function NOVA (2026-08-29) com uma única rota:
//   DELETE /customers/:id -> delete_customer
// Leitura e criação/edição continuam via supabase-js direto (RLS + grants
// diretos, frontend/src/lib/api/customers.ts) — nunca por aqui.
//
// Por que "cliente com pedido/empresa vinculados" (CUSTOMER_HAS_ORDERS:/
// CUSTOMER_HAS_COMPANY:) NÃO é testado via handleRequest ponta a ponta: essa
// regra depende de ler o banco (delete_customer é uma RPC) — exige uma
// sessão autenticada real e um Postgres real, que este arquivo não pode
// exercitar sem Supabase local rodando. Cobertura real fica para o teste SQL
// transacional (supabase/tests/product_customer_order_ops_test.sql).
//
// LIMITAÇÃO DE AMBIENTE (mesma já registrada em todas as rodadas
// anteriores): o runtime `deno` não está instalado nesta máquina/sessão —
// este arquivo não pôde ser executado. Escrito seguindo a mesma disciplina
// já usada no projeto; precisa de uma primeira execução real
// (`deno test supabase/functions/customers/`) antes de confiar cegamente
// nele.

import { handleRequest } from "./handler.ts";

function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(msg ?? `esperado ${e}, obtido ${a}`);
  }
}

const VALID_UUID_1 = "123e4567-e89b-42d3-a456-426614174000";

function makeRequest(method: string, path: string, extraHeaders?: Record<string, string>): Request {
  const headers: Record<string, string> = { ...extraHeaders };
  return new Request(`https://example.supabase.co/functions/v1/customers${path}`, {
    method,
    headers,
  });
}

Deno.test("handleRequest responde ao preflight OPTIONS com 204, sem corpo, headers de CORS do padrão do projeto", async () => {
  const res = await handleRequest(makeRequest("OPTIONS", ""));
  assertEquals(res.status, 204);
  assertEquals(await res.text(), "");
  assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PUT, PATCH, DELETE, OPTIONS");
});

Deno.test("handleRequest rejeita DELETE /customers/:id sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(makeRequest("DELETE", `/${VALID_UUID_1}`));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 404 para rota não reconhecida (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("GET", "/algum-id/nao-existe"));
  assertEquals(res.status, 404);
});

Deno.test("handleRequest devolve 404 para GET /customers (nenhuma rota de leitura nesta Edge Function — leitura é sempre direta via supabase-js)", async () => {
  const res = await handleRequest(makeRequest("GET", ""));
  assertEquals(res.status, 404);
});

Deno.test("handleRequest devolve 404 para POST /customers (criação continua direta via supabase-js, nunca por aqui)", async () => {
  const res = await handleRequest(makeRequest("POST", ""));
  assertEquals(res.status, 404);
});

Deno.test("handleRequest devolve 404 para DELETE /customers (sem id na rota)", async () => {
  const res = await handleRequest(makeRequest("DELETE", ""));
  assertEquals(res.status, 404);
});

Deno.test("respostas de erro não expõem detalhes internos (mensagem genérica e segura)", async () => {
  const res = await handleRequest(makeRequest("DELETE", `/${VALID_UUID_1}`));
  const envelope = (await res.json()) as { error?: { type?: string; message?: string } };
  assertEquals(res.status, 401);
  assertEquals(envelope.error?.type, "authorization");
  assertEquals(envelope.error?.message, "Header Authorization ausente.");
});
