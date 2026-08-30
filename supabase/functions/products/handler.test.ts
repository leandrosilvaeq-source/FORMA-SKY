// Testes locais da Edge Function `products` — mesmo padrão de
// supabase/functions/stock-movements/handler.test.ts e
// inventory-purchases/handler.test.ts (sem dependência externa de framework
// de asserção, só `Deno.test`).
//
// Importa exclusivamente de handler.ts (nunca de index.ts) — handler.ts não
// tem nenhum efeito colateral de módulo (nenhum Deno.serve), então importá-lo
// aqui nunca abre um listener HTTP nem faz rede por conta própria.
//
// Escopo coberto sem rede/banco (executável offline):
//   - validadores puros já existentes (validateCompositionItems, inalterado
//     por esta rodada — só mudou de arquivo, testado aqui pela primeira vez
//     porque agora é importável sem abrir um servidor real);
//   - validadores da rodada de reorganização (2026-08-29, migration
//     20260829180000, pendente): validatePlates (plate com peso direto,
//     sem filamentos — removidos do cadastro do Produto) e
//     validateCategories (múltiplas categorias, sem duplicidade);
//   - handleRequest: preflight CORS, 401 sem Authorization, 404 rota
//     desconhecida, 405 implícito (nenhuma rota reconhecida para métodos
//     fora do mapeado cai em 404, mesmo padrão de accessories/handler.ts).
//
// Por que "produto não encontrado", "tipo de filamento inativo/inexistente",
// "reaproveitar tipo já vinculado" etc. NÃO são testados via handleRequest
// ponta a ponta: são regras que dependem de ler o banco
// (set_product_composition/create_product/update_product_price/
// create_product_with_plates/update_product_full) — exigem uma sessão
// autenticada real (rede) e um Postgres real, que este arquivo não pode
// exercitar sem Supabase local rodando. Mesmo critério já documentado em
// todos os arquivos irmãos deste projeto.
//
// PATCH /products/:id/filaments (rodada corretiva 2026-08-29 — RPC
// set_product_filaments retirada da escrita operacional, ver
// "FONTE AUTORITATIVA" no cabeçalho de
// supabase/migrations/20260829160000_add_product_plates_structure.sql):
// a MESMA limitação acima se aplica ao novo comportamento — o erro de
// negócio PRODUCT_FILAMENTS_ROUTE_RETIRED: só é alcançado DEPOIS de
// resolveOperator(req) (rede real), então não é exercitável aqui sem
// Supabase local. O que ESTE arquivo já prova sem rede — que a rota
// continua respondendo com 401 sem Authorization, nunca 404 (roteamento
// preservado) — permanece verdadeiro depois da mudança, porque
// resolveOperator continua sendo a primeira linha da função, antes de
// qualquer lógica nova.
//
// LIMITAÇÃO DE AMBIENTE (mesma já registrada em todas as rodadas
// anteriores): o runtime `deno` não está instalado nesta máquina/sessão —
// este arquivo não pôde ser executado. Escrito seguindo a mesma disciplina
// já usada no projeto; precisa de uma primeira execução real
// (`deno test supabase/functions/products/`) antes de confiar cegamente
// nele.

import { ValidationError } from "../_shared/errors.ts";
import { isUuid } from "../_shared/validate.ts";
import {
  handleRequest,
  validateCategories,
  validateCompositionItems,
  validatePlates,
} from "./handler.ts";

function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(msg ?? `esperado ${e}, obtido ${a}`);
  }
}

function assertThrows(fn: () => unknown, check?: (err: unknown) => void): void {
  try {
    fn();
  } catch (err) {
    check?.(err);
    return;
  }
  throw new Error("esperado que a função lançasse uma exceção, mas não lançou");
}

function isValidationError(err: unknown): err is ValidationError {
  return err instanceof ValidationError;
}

const VALID_UUID_1 = "123e4567-e89b-42d3-a456-426614174000";
const VALID_UUID_2 = "223e4567-e89b-42d3-a456-426614174001";

// ---------------------------------------------------------------------------
// validateCompositionItems — já existia (accessories/packaging), inalterado
// por esta rodada; testado aqui pela primeira vez (agora importável).
// ---------------------------------------------------------------------------

Deno.test("validateCompositionItems aceita null/undefined como lista vazia", () => {
  assertEquals(validateCompositionItems(undefined, "accessories"), []);
  assertEquals(validateCompositionItems(null, "accessories"), []);
});

Deno.test("validateCompositionItems aceita itens válidos {id, quantity}", () => {
  const result = validateCompositionItems(
    [{ id: VALID_UUID_1, quantity: 2 }, { id: VALID_UUID_2, quantity: 5 }],
    "accessories",
  );
  assertEquals(result, [{ id: VALID_UUID_1, quantity: 2 }, { id: VALID_UUID_2, quantity: 5 }]);
});

Deno.test("validateCompositionItems rejeita id duplicado no mesmo array", () => {
  assertThrows(
    () => validateCompositionItems([{ id: VALID_UUID_1, quantity: 1 }, { id: VALID_UUID_1, quantity: 2 }], "accessories"),
    (err) => {
      if (!isValidationError(err)) throw new Error("esperado ValidationError");
    },
  );
});

Deno.test("validateCompositionItems rejeita quantity fracionada ou <= 0", () => {
  assertThrows(() => validateCompositionItems([{ id: VALID_UUID_1, quantity: 1.5 }], "accessories"));
  assertThrows(() => validateCompositionItems([{ id: VALID_UUID_1, quantity: 0 }], "accessories"));
});

Deno.test("validateCompositionItems rejeita array com item que não é objeto", () => {
  assertThrows(() => validateCompositionItems(["não é objeto"], "accessories"));
});

Deno.test("validateCompositionItems rejeita valor que não é array", () => {
  assertThrows(() => validateCompositionItems({ id: VALID_UUID_1 }, "accessories"));
});

// ---------------------------------------------------------------------------
// validatePlates — a partir da rodada de reorganização (2026-08-29,
// migration 20260829180000, pendente): plate NUNCA mais carrega
// filamentos — só production_time_seconds + weight_grams direto.
// ---------------------------------------------------------------------------

Deno.test("validatePlates aceita null/undefined como lista vazia", () => {
  assertEquals(validatePlates(undefined, "plates"), []);
  assertEquals(validatePlates(null, "plates"), []);
});

Deno.test("validatePlates aceita plates com peso direto e tempo", () => {
  const result = validatePlates(
    [
      { production_time_seconds: 4620, weight_grams: 37.16 },
      { production_time_seconds: 10440, weight_grams: 97.34 },
    ],
    "plates",
  );
  assertEquals(result, [
    { production_time_seconds: 4620, weight_grams: 37.16 },
    { production_time_seconds: 10440, weight_grams: 97.34 },
  ]);
});

Deno.test("validatePlates aceita weight_grams igual a 0 (nunca exige > 0)", () => {
  const result = validatePlates([{ production_time_seconds: 0, weight_grams: 0 }], "plates");
  assertEquals(result, [{ production_time_seconds: 0, weight_grams: 0 }]);
});

Deno.test("validatePlates rejeita weight_grams negativo", () => {
  assertThrows(() => validatePlates([{ production_time_seconds: 0, weight_grams: -1 }], "plates"));
});

Deno.test("validatePlates rejeita weight_grams ausente/não numérico", () => {
  assertThrows(() => validatePlates([{ production_time_seconds: 0 }], "plates"));
  assertThrows(() => validatePlates([{ production_time_seconds: 0, weight_grams: "10" }], "plates"));
});

Deno.test("validatePlates rejeita production_time_seconds fracionado ou negativo", () => {
  assertThrows(() => validatePlates([{ production_time_seconds: 1.5, weight_grams: 10 }], "plates"));
  assertThrows(() => validatePlates([{ production_time_seconds: -1, weight_grams: 10 }], "plates"));
});

Deno.test("validatePlates rejeita valor que não é array", () => {
  assertThrows(() => validatePlates({ production_time_seconds: 0 }, "plates"));
});

Deno.test("validatePlates rejeita item que não é objeto", () => {
  assertThrows(() => validatePlates([42], "plates"));
});

// ---------------------------------------------------------------------------
// validateCategories — NOVO (múltiplas categorias, 2026-08-29)
// ---------------------------------------------------------------------------

Deno.test("validateCategories aceita null/undefined como lista vazia", () => {
  assertEquals(validateCategories(undefined, "categories"), []);
  assertEquals(validateCategories(null, "categories"), []);
});

Deno.test("validateCategories aceita múltiplas categorias, preservando a ordem", () => {
  assertEquals(validateCategories(["Gamer", "Geek", "Outro texto"], "categories"), [
    "Gamer",
    "Geek",
    "Outro texto",
  ]);
});

Deno.test("validateCategories remove espaços nas pontas (trim)", () => {
  assertEquals(validateCategories(["  Gamer  "], "categories"), ["Gamer"]);
});

Deno.test("validateCategories rejeita categoria vazia ou só espaços", () => {
  assertThrows(() => validateCategories([""], "categories"));
  assertThrows(() => validateCategories(["   "], "categories"));
});

Deno.test("validateCategories rejeita categoria repetida no mesmo array", () => {
  assertThrows(
    () => validateCategories(["Gamer", "Gamer"], "categories"),
    (err) => {
      if (!isValidationError(err)) throw new Error("esperado ValidationError");
      if (!(err as ValidationError).message.includes("não pode repetir a mesma categoria")) {
        throw new Error("mensagem não menciona duplicidade");
      }
    },
  );
});

Deno.test("validateCategories rejeita entrada que não é string", () => {
  assertThrows(() => validateCategories([42], "categories"));
});

Deno.test("validateCategories rejeita valor que não é array", () => {
  assertThrows(() => validateCategories("Gamer", "categories"));
});

Deno.test("isUuid aceita um UUID v4 bem formado e rejeita string inválida", () => {
  assertEquals(isUuid(VALID_UUID_1), true);
  assertEquals(isUuid("nao-e-um-uuid"), false);
});

// ---------------------------------------------------------------------------
// handleRequest — só os caminhos que não exigem rede/banco reais
// ---------------------------------------------------------------------------

function makeRequest(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  return new Request(`https://example.supabase.co/functions/v1/products${path}`, {
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

Deno.test("handleRequest rejeita POST /products sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(makeRequest("POST", "", { name: "x", product_type: "CATALOG", default_price: 10 }));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita PATCH .../filaments sem Authorization com 401 (sem tocar rede) — rota descontinuada, mas ainda responde e ainda exige auth, nunca 404", async () => {
  const res = await handleRequest(
    makeRequest("PATCH", `/${VALID_UUID_1}/filaments`, { filaments: [] }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita POST /products/with-plates sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(
    makeRequest("POST", "/with-plates", {
      name: "x",
      product_type: "CATALOG",
      default_price: 10,
      plates: [],
      accessories: [],
      packaging: [],
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita PATCH /products/:id/full sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(
    makeRequest("PATCH", `/${VALID_UUID_1}/full`, { plates: [], accessories: [], packaging: [] }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 404 para rota não reconhecida (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("GET", "/algum-id/nao-existe"));
  assertEquals(res.status, 404);
});

Deno.test("handleRequest devolve 404 para GET /products (nenhuma rota de listagem nesta Edge Function)", async () => {
  const res = await handleRequest(makeRequest("GET", ""));
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------
// PATCH /products/:id -> update_product (NOVA, 2026-08-29 — edição
// controlada de Produto, whitelist de campos, nunca default_price).
// ---------------------------------------------------------------------------

Deno.test("handleRequest rejeita PATCH /products/:id sem Authorization com 401 (rota resolvida, sem tocar rede)", async () => {
  const res = await handleRequest(makeRequest("PATCH", `/${VALID_UUID_1}`, { name: "Novo nome" }));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest PATCH /products/:id não é confundido com /:id/price, /:id/composition, /:id/filaments nem /:id/full (rotas distintas, todas exigem auth 401)", async () => {
  const resPlain = await handleRequest(makeRequest("PATCH", `/${VALID_UUID_1}`, { name: "x" }));
  const resPrice = await handleRequest(makeRequest("PATCH", `/${VALID_UUID_1}/price`, { new_price: 10 }));
  const resComposition = await handleRequest(
    makeRequest("PATCH", `/${VALID_UUID_1}/composition`, { accessories: [], packaging: [] }),
  );
  const resFilaments = await handleRequest(makeRequest("PATCH", `/${VALID_UUID_1}/filaments`, { filaments: [] }));
  const resFull = await handleRequest(
    makeRequest("PATCH", `/${VALID_UUID_1}/full`, { plates: [], accessories: [], packaging: [] }),
  );
  // Todas as 5 rotas existem e exigem autenticação (401) — nenhuma cai em
  // 404 (o que indicaria roteamento ambíguo/quebrado entre elas). /filaments
  // continua respondendo (rota descontinuada só para escrita, nunca
  // removida do roteador) — 401 aqui prova que ainda é resolvida antes de
  // qualquer lógica de negócio, exatamente como as demais.
  assertEquals(resPlain.status, 401);
  assertEquals(resPrice.status, 401);
  assertEquals(resComposition.status, 401);
  assertEquals(resFilaments.status, 401);
  assertEquals(resFull.status, 401);
});

Deno.test("respostas de erro não expõem detalhes internos (mensagem genérica e segura)", async () => {
  const res = await handleRequest(makeRequest("PATCH", `/${VALID_UUID_1}/filaments`, { filaments: [] }));
  const envelope = (await res.json()) as { error?: { type?: string; message?: string } };
  assertEquals(res.status, 401);
  assertEquals(envelope.error?.type, "authorization");
  assertEquals(envelope.error?.message, "Header Authorization ausente.");
});
