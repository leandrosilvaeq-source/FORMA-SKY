// Testes locais da Edge Function `orders` — mesmo padrão de
// supabase/functions/products/handler.test.ts (sem dependência externa de
// framework de asserção, só `Deno.test`).
//
// Importa exclusivamente de handler.ts (nunca de index.ts) — handler.ts não
// tem nenhum efeito colateral de módulo (nenhum Deno.serve), então importá-lo
// aqui nunca abre um listener HTTP nem faz rede por conta própria.
//
// Escopo coberto sem rede/banco (executável offline):
//   - preflight CORS;
//   - 401 sem Authorization em TODAS as 5 rotas (POST /orders, POST
//     /orders/with-payment [NOVA, 2026-08-29], PUT /orders/:id, PUT
//     /orders/:id/full, DELETE /orders/:id [NOVA, 2026-08-29]);
//   - roteamento: as 5 rotas nunca se confundem entre si nem caem em 404;
//   - 404 para rota/método não reconhecidos.
//
// Por que validações de negócio (payment_condition inválido, deposit_amount
// obrigatório/menor que o total, status inválido para exclusão etc.) NÃO são
// testadas via handleRequest ponta a ponta aqui: a maioria depende de ler o
// banco (create_order_with_payment/delete_order são RPCs) — exigem uma
// sessão autenticada real e um Postgres real, que este arquivo não pode
// exercitar sem Supabase local rodando. Mesmo critério já documentado em
// todos os arquivos irmãos deste projeto (cobertura real fica para o teste
// SQL transacional, supabase/tests/product_customer_order_ops_test.sql).
//
// LIMITAÇÃO DE AMBIENTE (mesma já registrada em todas as rodadas
// anteriores): o runtime `deno` não está instalado nesta máquina/sessão —
// este arquivo não pôde ser executado. Escrito seguindo a mesma disciplina
// já usada no projeto; precisa de uma primeira execução real
// (`deno test supabase/functions/orders/`) antes de confiar cegamente nele.

import { handleRequest } from "./handler.ts";

function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(msg ?? `esperado ${e}, obtido ${a}`);
  }
}

const VALID_UUID_1 = "123e4567-e89b-42d3-a456-426614174000";

const MINIMAL_ITEMS = [
  { item_type: "CATALOG", item_name: "Chaveiro", product_id: VALID_UUID_1, quantity: 1, unit_price: 10 },
];

function makeRequest(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  return new Request(`https://example.supabase.co/functions/v1/orders${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

Deno.test("handleRequest responde ao preflight OPTIONS com 204, sem corpo, headers de CORS do padrão do projeto", async () => {
  const res = await handleRequest(makeRequest("OPTIONS", ""));
  assertEquals(res.status, 204);
  assertEquals(await res.text(), "");
  assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PUT, PATCH, DELETE, OPTIONS");
});

// ---------------------------------------------------------------------------
// 401 sem Authorization — todas as rotas, incluindo as duas novas
// (2026-08-29).
// ---------------------------------------------------------------------------

Deno.test("handleRequest rejeita POST /orders sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(
    makeRequest("POST", "", { customer_id: VALID_UUID_1, items: MINIMAL_ITEMS }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita POST /orders/with-payment sem Authorization com 401 (NOVA rota, 2026-08-29)", async () => {
  const res = await handleRequest(
    makeRequest("POST", "/with-payment", {
      customer_id: VALID_UUID_1,
      items: MINIMAL_ITEMS,
      payment_condition: "ON_DELIVERY",
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita PUT /orders/:id sem Authorization com 401", async () => {
  const res = await handleRequest(
    makeRequest("PUT", `/${VALID_UUID_1}`, {
      customer_id: VALID_UUID_1,
      company_id: null,
      lead_source_id: null,
      payment_method: null,
      expected_delivery_date: null,
      actual_delivery_date: null,
      delivery_method: null,
      shipping_cost: null,
      discount_value: null,
      notes: null,
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita PUT /orders/:id/full sem Authorization com 401", async () => {
  const res = await handleRequest(
    makeRequest("PUT", `/${VALID_UUID_1}/full`, { customer_id: VALID_UUID_1, items: MINIMAL_ITEMS }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita DELETE /orders/:id sem Authorization com 401 (NOVA rota, 2026-08-29)", async () => {
  const res = await handleRequest(makeRequest("DELETE", `/${VALID_UUID_1}`));
  assertEquals(res.status, 401);
});

// ---------------------------------------------------------------------------
// Roteamento — as 5 rotas nunca se confundem entre si.
// ---------------------------------------------------------------------------

Deno.test("as 5 rotas (POST /orders, POST /with-payment, PUT /:id, PUT /:id/full, DELETE /:id) são todas resolvidas (401, nunca 404) — nenhuma ambiguidade de roteamento", async () => {
  const resPost = await handleRequest(makeRequest("POST", "", { customer_id: VALID_UUID_1, items: MINIMAL_ITEMS }));
  const resWithPayment = await handleRequest(
    makeRequest("POST", "/with-payment", { customer_id: VALID_UUID_1, items: MINIMAL_ITEMS }),
  );
  const resPut = await handleRequest(makeRequest("PUT", `/${VALID_UUID_1}`, {}));
  const resPutFull = await handleRequest(makeRequest("PUT", `/${VALID_UUID_1}/full`, {}));
  const resDelete = await handleRequest(makeRequest("DELETE", `/${VALID_UUID_1}`));

  for (const res of [resPost, resWithPayment, resPut, resPutFull, resDelete]) {
    assertEquals(res.status, 401);
  }
});

Deno.test("handleRequest devolve 404 para rota não reconhecida (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("GET", "/algum-id/nao-existe"));
  assertEquals(res.status, 404);
});

Deno.test("handleRequest devolve 404 para GET /orders (nenhuma rota de listagem nesta Edge Function)", async () => {
  const res = await handleRequest(makeRequest("GET", ""));
  assertEquals(res.status, 404);
});

Deno.test("handleRequest devolve 404 para DELETE /orders (sem id na rota)", async () => {
  const res = await handleRequest(makeRequest("DELETE", ""));
  assertEquals(res.status, 404);
});

Deno.test("handleRequest devolve 404 para POST /orders/algo-que-nao-e-with-payment", async () => {
  const res = await handleRequest(makeRequest("POST", "/algo-que-nao-e-with-payment", {}));
  assertEquals(res.status, 404);
});

Deno.test("respostas de erro não expõem detalhes internos (mensagem genérica e segura)", async () => {
  const res = await handleRequest(makeRequest("DELETE", `/${VALID_UUID_1}`));
  const envelope = (await res.json()) as { error?: { type?: string; message?: string } };
  assertEquals(res.status, 401);
  assertEquals(envelope.error?.type, "authorization");
  assertEquals(envelope.error?.message, "Header Authorization ausente.");
});
