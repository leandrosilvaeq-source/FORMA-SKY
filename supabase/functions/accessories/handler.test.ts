// Testes locais da Edge Function `accessories` — primeiro arquivo de teste
// Deno deste projeto (nenhuma outra Edge Function do Bloco 1 tinha testes
// automatizados até esta rodada). Sem dependências externas de framework de
// asserção (evita depender de resolução de um import remoto/versão de
// deno.land ou jsr não conferida nesta sessão) — só o runner nativo
// `Deno.test` e um par de helpers mínimos definidos abaixo.
//
// Importa exclusivamente de handler.ts (nunca de index.ts) — handler.ts não
// tem NENHUM efeito colateral de módulo (nenhum Deno.serve), então importá-lo
// aqui nunca abre um listener HTTP nem faz rede por conta própria. index.ts
// (o entrypoint real, com `Deno.serve(handleRequest)`) nunca é importado por
// este arquivo.
//
// Escopo coberto sem rede/banco (executável offline):
//   - validadores puros (requireTrimmedName/optionalTrimmedString/
//     optionalSize/rejectUnknownKeys/validateCreateAccessoryPayload/
//     buildAccessoryPatch), incluindo isUuid (_shared/validate.ts) — a
//     mesma checagem de formato usada por handleUpdateAccessory/
//     handleDeleteAccessory antes de qualquer chamada de rede;
//   - handleRequest: preflight CORS (status e headers exatos, conferidos
//     contra _shared/cors.ts), 401 sem Authorization (resolveOperator falha
//     antes de qualquer chamada de rede), 404 para rota desconhecida, 405
//     para método não permitido numa rota reconhecida.
//
// Por que "UUID inválido com usuário autenticado" e "payload inválido com
// usuário autenticado" NÃO são testados via handleRequest ponta a ponta:
// handleUpdateAccessory/handleDeleteAccessory chamam resolveOperator(req)
// ANTES de validar UUID/payload — de propósito, nunca revalidamos um
// recurso para quem ainda não provou identidade. Simular uma sessão
// "autenticada" de verdade exigiria uma chamada real a
// userClient.auth.getUser() (rede), que este arquivo não pode fazer sem
// Supabase local rodando. Em vez de criar um atalho de autenticação no
// código de produção só para viabilizar o teste, testamos a MESMA lógica
// pura que esses handlers usam (isUuid, buildAccessoryPatch,
// validateCreateAccessoryPayload) diretamente, sem depender de rede — a
// integração completa (autenticado real + UUID/payload inválido) fica para
// supabase/tests/bloco1_integration_test.sql (que já testa as RPCs
// via SET ROLE real) e/ou uma futura suíte E2E com Supabase local rodando.
//
// LIMITAÇÃO DE AMBIENTE (ver relatório do Incremento 2 e desta rodada
// corretiva): o runtime `deno` não está instalado nesta máquina/sessão —
// este arquivo não pôde ser executado. Escrito seguindo a mesma disciplina
// de validate.ts/errors.ts já usada no projeto; precisa de uma primeira
// execução real (`deno test supabase/functions/accessories/`) antes de
// confiar cegamente nele.

import { ValidationError } from "../_shared/errors.ts";
import { isUuid } from "../_shared/validate.ts";
import {
  buildAccessoryPatch,
  handleRequest,
  optionalSize,
  optionalTrimmedString,
  requireTrimmedName,
  validateCreateAccessoryPayload,
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

// ---------------------------------------------------------------------------
// isUuid — mesma checagem de formato usada por handleUpdateAccessory/
// handleDeleteAccessory antes de chamar a RPC (ver comentário no topo do
// arquivo sobre por que isso substitui um teste end-to-end aqui).
// ---------------------------------------------------------------------------

Deno.test("isUuid aceita um UUID v4 bem formado", () => {
  assertEquals(isUuid("123e4567-e89b-42d3-a456-426614174000"), true);
});

Deno.test("isUuid rejeita string que não é UUID", () => {
  assertEquals(isUuid("nao-e-um-uuid"), false);
  assertEquals(isUuid("123"), false);
  assertEquals(isUuid(""), false);
});

// ---------------------------------------------------------------------------
// requireTrimmedName / optionalTrimmedString / optionalSize
// ---------------------------------------------------------------------------

Deno.test("requireTrimmedName trima espaços de borda", () => {
  assertEquals(requireTrimmedName("  Ímã 6x2  ", "name"), "Ímã 6x2");
});

Deno.test("requireTrimmedName rejeita string vazia após trim", () => {
  assertThrows(() => requireTrimmedName("   ", "name"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

Deno.test("optionalTrimmedString normaliza string vazia para null", () => {
  assertEquals(optionalTrimmedString("   ", "variant"), null);
  assertEquals(optionalTrimmedString("", "variant"), null);
});

Deno.test("optionalTrimmedString preserva null/undefined como null", () => {
  assertEquals(optionalTrimmedString(null, "variant"), null);
  assertEquals(optionalTrimmedString(undefined, "variant"), null);
});

Deno.test("optionalTrimmedString trima texto não vazio", () => {
  assertEquals(optionalTrimmedString("  azul  ", "variant"), "azul");
});

Deno.test("optionalSize normaliza vazio para null (Não se aplica)", () => {
  assertEquals(optionalSize("", "size"), null);
  assertEquals(optionalSize("   ", "size"), null);
  assertEquals(optionalSize(null, "size"), null);
});

Deno.test("optionalSize aceita as 5 opções oficiais", () => {
  for (const size of ["PP", "P", "M", "G", "GG"]) {
    assertEquals(optionalSize(size, "size"), size);
  }
});

Deno.test("optionalSize rejeita valor livre fora do enum", () => {
  assertThrows(() => optionalSize("XG", "size"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

// ---------------------------------------------------------------------------
// validateCreateAccessoryPayload (POST)
// ---------------------------------------------------------------------------

Deno.test("validateCreateAccessoryPayload aceita payload mínimo válido", () => {
  const result = validateCreateAccessoryPayload({ name: "Ímã 6x2" });
  assertEquals(result, {
    p_name: "Ímã 6x2",
    p_size: null,
    p_variant: null,
    p_minimum_stock: null,
    p_is_active: null,
  });
});

Deno.test("validateCreateAccessoryPayload rejeita nome ausente", () => {
  assertThrows(() => validateCreateAccessoryPayload({}), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

Deno.test("validateCreateAccessoryPayload rejeita nome vazio", () => {
  assertThrows(() => validateCreateAccessoryPayload({ name: "   " }));
});

Deno.test("validateCreateAccessoryPayload rejeita tamanho fora da lista", () => {
  assertThrows(() => validateCreateAccessoryPayload({ name: "Ímã", size: "XG" }));
});

Deno.test("validateCreateAccessoryPayload rejeita estoque mínimo negativo", () => {
  assertThrows(() => validateCreateAccessoryPayload({ name: "Ímã", minimum_stock: -1 }));
});

Deno.test("validateCreateAccessoryPayload rejeita material", () => {
  assertThrows(() => validateCreateAccessoryPayload({ name: "Ímã", material: "aço" }));
});

Deno.test("validateCreateAccessoryPayload rejeita unit_cost", () => {
  assertThrows(() => validateCreateAccessoryPayload({ name: "Ímã", unit_cost: 1.5 }));
});

Deno.test("validateCreateAccessoryPayload rejeita current_stock", () => {
  assertThrows(() => validateCreateAccessoryPayload({ name: "Ímã", current_stock: 10 }));
});

Deno.test("validateCreateAccessoryPayload rejeita campo desconhecido", () => {
  assertThrows(() => validateCreateAccessoryPayload({ name: "Ímã", cor_favorita: "azul" }));
});

Deno.test("validateCreateAccessoryPayload normaliza size vazio para null", () => {
  const result = validateCreateAccessoryPayload({ name: "Ímã", size: "" });
  assertEquals(result.p_size, null);
});

// ---------------------------------------------------------------------------
// buildAccessoryPatch (PATCH)
// ---------------------------------------------------------------------------

Deno.test("buildAccessoryPatch inclui só as chaves enviadas", () => {
  const patch = buildAccessoryPatch({ minimum_stock: 5 });
  assertEquals(patch, { minimum_stock: 5 });
});

Deno.test("buildAccessoryPatch rejeita body vazio", () => {
  assertThrows(() => buildAccessoryPatch({}));
});

Deno.test("buildAccessoryPatch rejeita novo size inválido", () => {
  assertThrows(() => buildAccessoryPatch({ size: "XG" }));
});

Deno.test("buildAccessoryPatch ativa e desativa via is_active", () => {
  assertEquals(buildAccessoryPatch({ is_active: true }), { is_active: true });
  assertEquals(buildAccessoryPatch({ is_active: false }), { is_active: false });
});

Deno.test("buildAccessoryPatch rejeita name null (coluna obrigatória)", () => {
  assertThrows(() => buildAccessoryPatch({ name: null }));
});

Deno.test("buildAccessoryPatch rejeita is_active null (coluna obrigatória)", () => {
  assertThrows(() => buildAccessoryPatch({ is_active: null }));
});

Deno.test("buildAccessoryPatch rejeita campo desconhecido", () => {
  assertThrows(() => buildAccessoryPatch({ material: "aço" }));
});

// ---------------------------------------------------------------------------
// handleRequest — só os caminhos que não exigem rede/banco reais
// ---------------------------------------------------------------------------

function makeRequest(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  return new Request(`https://example.supabase.co/functions/v1/accessories${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Confere o comportamento REAL de _shared/cors.ts (buildCorsHeaders +
// handlePreflight), não uma expectativa inventada: 204, sem corpo, os 2
// headers sempre presentes (Allow-Methods/Allow-Headers) + Vary: Origin, e
// Allow-Origin só aparece quando a origem da requisição está na allowlist
// (ALLOWED_ORIGIN) — ausente aqui porque nenhuma env var foi setada e/ou
// nenhum header Origin foi enviado.
Deno.test("handleRequest responde ao preflight OPTIONS com 204, sem corpo, headers de CORS do padrão do projeto", async () => {
  const res = await handleRequest(makeRequest("OPTIONS", ""));
  assertEquals(res.status, 204);
  assertEquals(await res.text(), "");
  assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  assertEquals(
    res.headers.get("access-control-allow-headers"),
    "authorization, apikey, content-type, x-client-info",
  );
  assertEquals(res.headers.get("vary"), "Origin");
  assertEquals(res.headers.get("access-control-allow-origin"), null);
});

Deno.test("handleRequest ecoa Access-Control-Allow-Origin só quando a origem está em ALLOWED_ORIGIN", async () => {
  const previous = Deno.env.get("ALLOWED_ORIGIN");
  try {
    Deno.env.set("ALLOWED_ORIGIN", "https://app.formasky.com,http://localhost:5173");

    const allowed = await handleRequest(
      makeRequest("OPTIONS", "", undefined, { Origin: "http://localhost:5173" }),
    );
    assertEquals(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");

    const notAllowed = await handleRequest(
      makeRequest("OPTIONS", "", undefined, { Origin: "https://origem-desconhecida.example" }),
    );
    assertEquals(notAllowed.headers.get("access-control-allow-origin"), null);
  } finally {
    if (previous === undefined) Deno.env.delete("ALLOWED_ORIGIN");
    else Deno.env.set("ALLOWED_ORIGIN", previous);
  }
});

Deno.test("handleRequest rejeita POST sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(makeRequest("POST", "", { name: "Ímã" }));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita PATCH sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(
    makeRequest("PATCH", "/00000000-0000-0000-0000-000000000000", { name: "Ímã" }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita DELETE sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(makeRequest("DELETE", "/00000000-0000-0000-0000-000000000000"));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 405 para método não permitido em /accessories (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("GET", ""));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest devolve 405 para método não permitido em /accessories/:id (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("POST", "/00000000-0000-0000-0000-000000000000"));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest devolve 404 para rota não reconhecida (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("GET", "/a/b/c"));
  assertEquals(res.status, 404);
});

Deno.test("respostas de erro não expõem detalhes internos (mensagem genérica e segura)", async () => {
  const res = await handleRequest(makeRequest("POST", ""));
  const envelope = (await res.json()) as { error?: { type?: string; message?: string } };
  assertEquals(res.status, 401);
  assertEquals(envelope.error?.type, "authorization");
  // Mensagem fixa e segura (AuthenticationError default) — nunca stack
  // trace, nunca detalhe de driver/rede.
  assertEquals(envelope.error?.message, "Header Authorization ausente.");
});
