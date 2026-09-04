// Testes locais da Edge Function `filament-types` — mesmo padrão de
// accessories/handler.test.ts e stock-movements/handler.test.ts (sem
// dependência externa de framework de asserção, só `Deno.test`).
//
// Importa exclusivamente de handler.ts (nunca de index.ts) — sem efeito
// colateral de módulo, nunca abre um listener HTTP nem faz rede por conta
// própria.
//
// Escopo coberto sem rede/banco (executável offline): validadores puros e
// handleRequest nos caminhos que não exigem sessão autenticada real (401 sem
// Authorization, 404 rota desconhecida, 405 método não permitido, CORS).
// Regras que dependem do banco (tipo duplicado, tipo em uso ao excluir,
// tipo inexistente) são cobertas por supabase/tests/filament_inventory_test.sql,
// não aqui.
//
// LIMITAÇÃO DE AMBIENTE (mesma já registrada em todas as rodadas
// anteriores): o runtime `deno` não está instalado nesta máquina/sessão —
// este arquivo não pôde ser executado. Escrito seguindo a mesma disciplina
// já usada no projeto; precisa de uma primeira execução real
// (`deno test supabase/functions/filament-types/`) antes de confiar
// cegamente nele.

import { ValidationError } from "../_shared/errors.ts";
import {
  buildFilamentTypePatch,
  handleRequest,
  optionalTrimmedString,
  rejectUnknownKeys,
  requireFilamentMaterial,
  requireTrimmedNonEmpty,
  validateCreateFilamentTypePayload,
} from "./handler.ts";

function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `esperado ${e}, obtido ${a}`);
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
// requireFilamentMaterial
// ---------------------------------------------------------------------------

Deno.test("requireFilamentMaterial aceita PLA/PETG/TPU", () => {
  assertEquals(requireFilamentMaterial("PLA"), "PLA");
  assertEquals(requireFilamentMaterial("PETG"), "PETG");
  assertEquals(requireFilamentMaterial("TPU"), "TPU");
});

Deno.test("requireFilamentMaterial rejeita ABS (explicitamente fora do MVP aprovado)", () => {
  assertThrows(() => requireFilamentMaterial("ABS"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

Deno.test("requireFilamentMaterial rejeita valor ausente/vazio", () => {
  assertThrows(() => requireFilamentMaterial(undefined));
  assertThrows(() => requireFilamentMaterial(""));
});

// ---------------------------------------------------------------------------
// requireTrimmedNonEmpty / optionalTrimmedString
// ---------------------------------------------------------------------------

Deno.test("requireTrimmedNonEmpty trima e rejeita vazio", () => {
  assertEquals(requireTrimmedNonEmpty("  Voolt3D  ", "manufacturer"), "Voolt3D");
  assertThrows(() => requireTrimmedNonEmpty("   ", "manufacturer"));
  assertThrows(() => requireTrimmedNonEmpty(undefined, "manufacturer"));
});

Deno.test("optionalTrimmedString normaliza vazio/espaços para null e preserva null/undefined", () => {
  assertEquals(optionalTrimmedString("", "color_code"), null);
  assertEquals(optionalTrimmedString("   ", "color_code"), null);
  assertEquals(optionalTrimmedString(null, "color_code"), null);
  assertEquals(optionalTrimmedString(undefined, "color_code"), null);
  assertEquals(optionalTrimmedString("  PLA-BLK-01  ", "color_code"), "PLA-BLK-01");
});

// ---------------------------------------------------------------------------
// validateCreateFilamentTypePayload
// ---------------------------------------------------------------------------

Deno.test("validateCreateFilamentTypePayload aceita payload mínimo válido", () => {
  const result = validateCreateFilamentTypePayload({
    material: "PLA",
    manufacturer: "Voolt3D",
    line: "Sólida",
    commercial_color: "Preto",
  });
  assertEquals(result, {
    p_material: "PLA",
    p_manufacturer: "Voolt3D",
    p_line: "Sólida",
    p_commercial_color: "Preto",
    p_color_code: null,
    p_minimum_stock_grams: null,
    p_is_active: null,
    p_notes: null,
  });
});

Deno.test("validateCreateFilamentTypePayload aceita uma linha livre não sugerida (ex.: Metálica) — line não é um enum travado", () => {
  const result = validateCreateFilamentTypePayload({
    material: "PETG",
    manufacturer: "3DFila",
    line: "Metálica",
    commercial_color: "Prata",
  });
  assertEquals(result.p_line, "Metálica");
});

Deno.test("validateCreateFilamentTypePayload rejeita material fora do enum", () => {
  assertThrows(() =>
    validateCreateFilamentTypePayload({
      material: "ABS",
      manufacturer: "Voolt3D",
      line: "Sólida",
      commercial_color: "Preto",
    }),
  );
});

Deno.test("validateCreateFilamentTypePayload rejeita manufacturer/line/commercial_color ausentes", () => {
  assertThrows(() => validateCreateFilamentTypePayload({ material: "PLA", line: "Sólida", commercial_color: "Preto" }));
  assertThrows(() => validateCreateFilamentTypePayload({ material: "PLA", manufacturer: "Voolt3D", commercial_color: "Preto" }));
  assertThrows(() => validateCreateFilamentTypePayload({ material: "PLA", manufacturer: "Voolt3D", line: "Sólida" }));
});

Deno.test("validateCreateFilamentTypePayload rejeita minimum_stock_grams negativo", () => {
  assertThrows(() =>
    validateCreateFilamentTypePayload({
      material: "PLA",
      manufacturer: "Voolt3D",
      line: "Sólida",
      commercial_color: "Preto",
      minimum_stock_grams: -1,
    }),
  );
});

Deno.test("validateCreateFilamentTypePayload aceita minimum_stock_grams fracionário (gramas são fracionáveis)", () => {
  const result = validateCreateFilamentTypePayload({
    material: "PLA",
    manufacturer: "Voolt3D",
    line: "Sólida",
    commercial_color: "Preto",
    minimum_stock_grams: 250.5,
  });
  assertEquals(result.p_minimum_stock_grams, 250.5);
});

Deno.test("validateCreateFilamentTypePayload rejeita campo desconhecido (ex.: unit_cost)", () => {
  assertThrows(() =>
    validateCreateFilamentTypePayload({
      material: "PLA",
      manufacturer: "Voolt3D",
      line: "Sólida",
      commercial_color: "Preto",
      unit_cost: 100,
    }),
  );
});

// ---------------------------------------------------------------------------
// buildFilamentTypePatch
// ---------------------------------------------------------------------------

Deno.test("buildFilamentTypePatch inclui só as chaves enviadas", () => {
  assertEquals(buildFilamentTypePatch({ is_active: false }), { is_active: false });
  assertEquals(buildFilamentTypePatch({ notes: "revisar fornecedor" }), { notes: "revisar fornecedor" });
});

Deno.test("buildFilamentTypePatch rejeita is_active explicitamente null", () => {
  assertThrows(() => buildFilamentTypePatch({ is_active: null }));
});

Deno.test("buildFilamentTypePatch rejeita patch vazio", () => {
  assertThrows(() => buildFilamentTypePatch({}));
});

Deno.test("rejectUnknownKeys aceita só chaves permitidas e rejeita as demais", () => {
  rejectUnknownKeys({ a: 1 }, ["a", "b"], "teste");
  assertThrows(() => rejectUnknownKeys({ a: 1, c: 2 }, ["a", "b"], "teste"));
});

// ---------------------------------------------------------------------------
// handleRequest — só os caminhos que não exigem rede/banco reais
// ---------------------------------------------------------------------------

function makeRequest(method: string, path: string, body?: unknown): Request {
  return new Request(`https://example.supabase.co/functions/v1/filament-types${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

Deno.test("handleRequest responde ao preflight OPTIONS com 204", async () => {
  const res = await handleRequest(makeRequest("OPTIONS", ""));
  assertEquals(res.status, 204);
});

Deno.test("handleRequest rejeita POST sem Authorization com 401", async () => {
  const res = await handleRequest(
    makeRequest("POST", "", { material: "PLA", manufacturer: "Voolt3D", line: "Sólida", commercial_color: "Preto" }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 405 para GET em /filament-types (listagem é via supabase-js direto, não Edge Function)", async () => {
  const res = await handleRequest(makeRequest("GET", ""));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest devolve 405 para POST em /filament-types/:id", async () => {
  const res = await handleRequest(makeRequest("POST", "/123e4567-e89b-42d3-a456-426614174000"));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest devolve 404 para rota com mais de um segmento", async () => {
  const res = await handleRequest(makeRequest("GET", "/algum-id/extra"));
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------
// normalizeRemoveFilamentTypeResult — normalização do jsonb de
// remove_filament_type devolvido pela RPC (migration 20260903120000).
// ---------------------------------------------------------------------------

import { normalizeRemoveFilamentTypeResult } from "./handler.ts";

Deno.test("normalizeRemoveFilamentTypeResult repassa PHYSICALLY_DELETED com contagem 0", () => {
  assertEquals(
    normalizeRemoveFilamentTypeResult({ result: "PHYSICALLY_DELETED", archived_spool_count: 0 }),
    { result: "PHYSICALLY_DELETED", archived_spool_count: 0 },
  );
});

Deno.test("normalizeRemoveFilamentTypeResult repassa ARCHIVED com a contagem de rolos arquivados", () => {
  assertEquals(
    normalizeRemoveFilamentTypeResult({ result: "ARCHIVED", archived_spool_count: 3 }),
    { result: "ARCHIVED", archived_spool_count: 3 },
  );
});

Deno.test("normalizeRemoveFilamentTypeResult trata shape inesperado como ARCHIVED / 0 (defesa em profundidade)", () => {
  assertEquals(normalizeRemoveFilamentTypeResult(null), { result: "ARCHIVED", archived_spool_count: 0 });
  assertEquals(normalizeRemoveFilamentTypeResult("nope"), { result: "ARCHIVED", archived_spool_count: 0 });
  assertEquals(normalizeRemoveFilamentTypeResult({}), { result: "ARCHIVED", archived_spool_count: 0 });
  assertEquals(
    normalizeRemoveFilamentTypeResult({ result: "SOMETHING_ELSE", archived_spool_count: "x" }),
    { result: "ARCHIVED", archived_spool_count: 0 },
  );
});

// ---------------------------------------------------------------------------
// handleRequest — rota DELETE (offline: só o caminho que não exige banco).
// As regras que dependem do banco (PHYSICALLY_DELETED / ARCHIVED / bloqueio
// por pedido ativo / mensagem real) são cobertas por
// supabase/tests/remove_filament_type_test.sql.
// ---------------------------------------------------------------------------

Deno.test("handleRequest rejeita DELETE /filament-types/:id sem Authorization com 401 (auth antes do banco)", async () => {
  const res = await handleRequest(
    makeRequest("DELETE", "/123e4567-e89b-42d3-a456-426614174000"),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest aceita DELETE como método válido em /filament-types/:id (não cai no 405)", async () => {
  const res = await handleRequest(makeRequest("DELETE", "/123e4567-e89b-42d3-a456-426614174000"));
  // Sem sessão -> 401; o que importa é NÃO ser 405 (método não permitido).
  assertEquals(res.status === 405, false);
});
