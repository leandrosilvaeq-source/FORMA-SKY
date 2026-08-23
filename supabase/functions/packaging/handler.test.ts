// Testes locais da Edge Function `packaging` — espelha integralmente
// supabase/functions/accessories/handler.test.ts (Incremento 2). Sem
// dependências externas de framework de asserção — só o runner nativo
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
//     optionalSize/rejectUnknownKeys/validateCreatePackagingPayload/
//     buildPackagingPatch), incluindo isUuid (_shared/validate.ts) — a
//     mesma checagem de formato usada por handleUpdatePackaging/
//     handleDeletePackaging antes de qualquer chamada de rede;
//   - handleRequest: preflight CORS (status e headers exatos, conferidos
//     contra _shared/cors.ts), 401 sem Authorization (resolveOperator falha
//     antes de qualquer chamada de rede), 404 para rota desconhecida, 405
//     para método não permitido numa rota reconhecida.
//
// Por que "UUID inválido com usuário autenticado" e "payload inválido com
// usuário autenticado" NÃO são testados via handleRequest ponta a ponta:
// mesmo motivo documentado em accessories/handler.test.ts — resolveOperator
// é chamado antes da validação de UUID/payload, e simular autenticação real
// exigiria rede (Supabase local não disponível nesta sessão, decisão de não
// usar Docker). Testamos a mesma lógica pura diretamente em vez de criar um
// atalho de autenticação no código de produção.
//
// LIMITAÇÃO DE AMBIENTE: `deno` só está disponível via `npx -y deno`
// (temporário, não instalado globalmente) — ver relatório do Incremento 3.

import { ValidationError } from "../_shared/errors.ts";
import { isUuid } from "../_shared/validate.ts";
import {
  buildPackagingPatch,
  handleRequest,
  optionalSize,
  optionalTrimmedString,
  requireTrimmedName,
  validateCreatePackagingPayload,
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
// isUuid — mesma checagem de formato usada por handleUpdatePackaging/
// handleDeletePackaging antes de chamar a RPC.
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
  assertEquals(requireTrimmedName("  Caixa M  ", "name"), "Caixa M");
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
  assertEquals(optionalTrimmedString("  kraft  ", "variant"), "kraft");
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
// validateCreatePackagingPayload (POST)
// ---------------------------------------------------------------------------

Deno.test("validateCreatePackagingPayload aceita payload mínimo válido", () => {
  const result = validateCreatePackagingPayload({ name: "Caixa M" });
  assertEquals(result, {
    p_name: "Caixa M",
    p_size: null,
    p_variant: null,
    p_minimum_stock: null,
    p_is_active: null,
  });
});

Deno.test("validateCreatePackagingPayload rejeita nome ausente", () => {
  assertThrows(() => validateCreatePackagingPayload({}), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

Deno.test("validateCreatePackagingPayload rejeita nome vazio", () => {
  assertThrows(() => validateCreatePackagingPayload({ name: "   " }));
});

Deno.test("validateCreatePackagingPayload rejeita tamanho fora da lista", () => {
  assertThrows(() => validateCreatePackagingPayload({ name: "Caixa", size: "XG" }));
});

Deno.test("validateCreatePackagingPayload rejeita estoque mínimo negativo", () => {
  assertThrows(() => validateCreatePackagingPayload({ name: "Caixa", minimum_stock: -1 }));
});

Deno.test("validateCreatePackagingPayload rejeita material", () => {
  assertThrows(() => validateCreatePackagingPayload({ name: "Caixa", material: "papelão" }));
});

Deno.test("validateCreatePackagingPayload rejeita unit_cost", () => {
  assertThrows(() => validateCreatePackagingPayload({ name: "Caixa", unit_cost: 1.5 }));
});

Deno.test("validateCreatePackagingPayload rejeita current_stock", () => {
  assertThrows(() => validateCreatePackagingPayload({ name: "Caixa", current_stock: 10 }));
});

Deno.test("validateCreatePackagingPayload rejeita campo desconhecido", () => {
  assertThrows(() => validateCreatePackagingPayload({ name: "Caixa", cor_favorita: "azul" }));
});

Deno.test("validateCreatePackagingPayload normaliza size vazio para null", () => {
  const result = validateCreatePackagingPayload({ name: "Caixa", size: "" });
  assertEquals(result.p_size, null);
});

// ---------------------------------------------------------------------------
// buildPackagingPatch (PATCH)
// ---------------------------------------------------------------------------

Deno.test("buildPackagingPatch inclui só as chaves enviadas", () => {
  const patch = buildPackagingPatch({ minimum_stock: 5 });
  assertEquals(patch, { minimum_stock: 5 });
});

Deno.test("buildPackagingPatch rejeita body vazio", () => {
  assertThrows(() => buildPackagingPatch({}));
});

Deno.test("buildPackagingPatch rejeita novo size inválido", () => {
  assertThrows(() => buildPackagingPatch({ size: "XG" }));
});

Deno.test("buildPackagingPatch ativa e desativa via is_active", () => {
  assertEquals(buildPackagingPatch({ is_active: true }), { is_active: true });
  assertEquals(buildPackagingPatch({ is_active: false }), { is_active: false });
});

Deno.test("buildPackagingPatch rejeita name null (coluna obrigatória)", () => {
  assertThrows(() => buildPackagingPatch({ name: null }));
});

Deno.test("buildPackagingPatch rejeita is_active null (coluna obrigatória)", () => {
  assertThrows(() => buildPackagingPatch({ is_active: null }));
});

Deno.test("buildPackagingPatch rejeita campo desconhecido", () => {
  assertThrows(() => buildPackagingPatch({ material: "papelão" }));
});

// ---------------------------------------------------------------------------
// handleRequest — só os caminhos que não exigem rede/banco reais
// ---------------------------------------------------------------------------

function makeRequest(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  return new Request(`https://example.supabase.co/functions/v1/packaging${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Confere o comportamento REAL de _shared/cors.ts (buildCorsHeaders +
// handlePreflight), não uma expectativa inventada.
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
  const res = await handleRequest(makeRequest("POST", "", { name: "Caixa" }));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita PATCH sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(
    makeRequest("PATCH", "/00000000-0000-0000-0000-000000000000", { name: "Caixa" }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest rejeita DELETE sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(makeRequest("DELETE", "/00000000-0000-0000-0000-000000000000"));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 405 para método não permitido em /packaging (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("GET", ""));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest devolve 405 para método não permitido em /packaging/:id (sem exigir autenticação)", async () => {
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
  assertEquals(envelope.error?.message, "Header Authorization ausente.");
});
