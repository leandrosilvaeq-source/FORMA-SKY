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
//   - validador novo desta rodada (validateFilamentCompositionItems —
//     Módulo 3, Incremento 6A: peso teórico > 0, sem duplicidade de tipo,
//     sem zero/negativo);
//   - handleRequest: preflight CORS, 401 sem Authorization, 404 rota
//     desconhecida, 405 implícito (nenhuma rota reconhecida para métodos
//     fora do mapeado cai em 404, mesmo padrão de accessories/handler.ts).
//
// Por que "produto não encontrado", "tipo de filamento inativo/inexistente",
// "reaproveitar tipo já vinculado" etc. NÃO são testados via handleRequest
// ponta a ponta: são regras que dependem de ler o banco
// (set_product_filaments/set_product_composition/create_product/
// update_product_price) — exigem uma sessão autenticada real (rede) e um
// Postgres real, que este arquivo não pode exercitar sem Supabase local
// rodando. Mesmo critério já documentado em todos os arquivos irmãos deste
// projeto.
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
  validateCompositionItems,
  validateFilamentCompositionItems,
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
// validateFilamentCompositionItems — NOVO (Módulo 3, Incremento 6A)
// ---------------------------------------------------------------------------

Deno.test("validateFilamentCompositionItems aceita null/undefined como lista vazia", () => {
  assertEquals(validateFilamentCompositionItems(undefined, "filaments"), []);
  assertEquals(validateFilamentCompositionItems(null, "filaments"), []);
});

Deno.test("validateFilamentCompositionItems aceita múltiplos tipos com peso teórico decimal", () => {
  const result = validateFilamentCompositionItems(
    [
      { id: VALID_UUID_1, theoretical_weight_grams: 12.5 },
      { id: VALID_UUID_2, theoretical_weight_grams: 3.75 },
    ],
    "filaments",
  );
  assertEquals(result, [
    { id: VALID_UUID_1, theoretical_weight_grams: 12.5 },
    { id: VALID_UUID_2, theoretical_weight_grams: 3.75 },
  ]);
});

Deno.test("validateFilamentCompositionItems rejeita filament_type_id duplicado no mesmo array", () => {
  assertThrows(
    () =>
      validateFilamentCompositionItems(
        [
          { id: VALID_UUID_1, theoretical_weight_grams: 10 },
          { id: VALID_UUID_1, theoretical_weight_grams: 20 },
        ],
        "filaments",
      ),
    (err) => {
      if (!isValidationError(err)) throw new Error("esperado ValidationError");
      if (!(err as ValidationError).message.includes("não pode repetir o mesmo id")) {
        throw new Error("mensagem não menciona duplicidade");
      }
    },
  );
});

Deno.test("validateFilamentCompositionItems rejeita peso zero ou negativo", () => {
  assertThrows(() => validateFilamentCompositionItems([{ id: VALID_UUID_1, theoretical_weight_grams: 0 }], "filaments"));
  assertThrows(() => validateFilamentCompositionItems([{ id: VALID_UUID_1, theoretical_weight_grams: -5 }], "filaments"));
});

Deno.test("validateFilamentCompositionItems rejeita peso ausente/não numérico", () => {
  assertThrows(() => validateFilamentCompositionItems([{ id: VALID_UUID_1 }], "filaments"));
  assertThrows(() => validateFilamentCompositionItems([{ id: VALID_UUID_1, theoretical_weight_grams: "10" }], "filaments"));
});

Deno.test("validateFilamentCompositionItems rejeita id que não é UUID", () => {
  assertThrows(() => validateFilamentCompositionItems([{ id: "nao-e-uuid", theoretical_weight_grams: 10 }], "filaments"));
});

Deno.test("validateFilamentCompositionItems rejeita valor que não é array", () => {
  assertThrows(() => validateFilamentCompositionItems({ id: VALID_UUID_1 }, "filaments"));
});

Deno.test("validateFilamentCompositionItems rejeita item que não é objeto", () => {
  assertThrows(() => validateFilamentCompositionItems([42], "filaments"));
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

Deno.test("handleRequest rejeita PATCH .../filaments sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(
    makeRequest("PATCH", `/${VALID_UUID_1}/filaments`, { filaments: [] }),
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

Deno.test("respostas de erro não expõem detalhes internos (mensagem genérica e segura)", async () => {
  const res = await handleRequest(makeRequest("PATCH", `/${VALID_UUID_1}/filaments`, { filaments: [] }));
  const envelope = (await res.json()) as { error?: { type?: string; message?: string } };
  assertEquals(res.status, 401);
  assertEquals(envelope.error?.type, "authorization");
  assertEquals(envelope.error?.message, "Header Authorization ausente.");
});
