// Testes locais da Edge Function `filament-spools` — mesmo padrão de
// filament-types/handler.test.ts.
//
// LIMITAÇÃO DE AMBIENTE: o runtime `deno` não está instalado nesta
// máquina/sessão — este arquivo não pôde ser executado. Precisa de uma
// primeira execução real (`deno test supabase/functions/filament-spools/`)
// antes de confiar cegamente nele. Regras dependentes do banco (rolo
// inexistente, tipo inativo, descarte é terminal, rolo com movimentação não
// pode ser excluído) são cobertas por
// supabase/tests/filament_inventory_test.sql.

import { ValidationError } from "../_shared/errors.ts";
import {
  buildFilamentSpoolPatch,
  handleRequest,
  optionalDate,
  optionalFilamentSpoolStatus,
  requireUuid,
  validateCreateFilamentSpoolPayload,
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

const VALID_UUID = "123e4567-e89b-42d3-a456-426614174000";

// ---------------------------------------------------------------------------
// requireUuid / optionalFilamentSpoolStatus / optionalDate
// ---------------------------------------------------------------------------

Deno.test("requireUuid aceita UUID bem formado e rejeita o resto", () => {
  assertEquals(requireUuid(VALID_UUID, "filament_type_id"), VALID_UUID);
  assertThrows(() => requireUuid("nao-e-uuid", "filament_type_id"));
});

Deno.test("optionalFilamentSpoolStatus aceita os 4 status mínimos exigidos", () => {
  for (const status of ["LACRADO", "ABERTO", "ESGOTADO", "DESCARTADO"]) {
    assertEquals(optionalFilamentSpoolStatus(status), status);
  }
});

Deno.test('optionalFilamentSpoolStatus rejeita "em uso" (5º valor da especificação antiga, não aprovado nesta rodada)', () => {
  assertThrows(() => optionalFilamentSpoolStatus("EM_USO"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

Deno.test("optionalFilamentSpoolStatus aceita null/undefined", () => {
  assertEquals(optionalFilamentSpoolStatus(null), null);
  assertEquals(optionalFilamentSpoolStatus(undefined), null);
});

Deno.test("optionalDate aceita YYYY-MM-DD e rejeita outros formatos", () => {
  assertEquals(optionalDate("2026-08-27", "received_at"), "2026-08-27");
  assertThrows(() => optionalDate("27/08/2026", "received_at"));
  assertThrows(() => optionalDate("2026-08-27T12:00:00Z", "received_at"));
});

Deno.test("optionalDate aceita null/undefined", () => {
  assertEquals(optionalDate(null, "received_at"), null);
  assertEquals(optionalDate(undefined, "received_at"), null);
});

// ---------------------------------------------------------------------------
// validateCreateFilamentSpoolPayload
// ---------------------------------------------------------------------------

Deno.test("validateCreateFilamentSpoolPayload aceita payload mínimo válido (peso nominal livre, não fixo em 1000g)", () => {
  const result = validateCreateFilamentSpoolPayload({
    filament_type_id: VALID_UUID,
    nominal_weight_grams: 250,
  });
  assertEquals(result, {
    p_filament_type_id: VALID_UUID,
    p_nominal_weight_grams: 250,
    p_empty_spool_weight_grams: null,
    p_received_at: null,
    p_status: null,
    p_notes: null,
    p_is_active: null,
  });
});

Deno.test("validateCreateFilamentSpoolPayload aceita peso nominal 750g (não precisa ser 1000g)", () => {
  const result = validateCreateFilamentSpoolPayload({ filament_type_id: VALID_UUID, nominal_weight_grams: 750 });
  assertEquals(result.p_nominal_weight_grams, 750);
});

Deno.test("validateCreateFilamentSpoolPayload rejeita nominal_weight_grams ausente/zero/negativo", () => {
  assertThrows(() => validateCreateFilamentSpoolPayload({ filament_type_id: VALID_UUID }));
  assertThrows(() => validateCreateFilamentSpoolPayload({ filament_type_id: VALID_UUID, nominal_weight_grams: 0 }));
  assertThrows(() => validateCreateFilamentSpoolPayload({ filament_type_id: VALID_UUID, nominal_weight_grams: -100 }));
});

Deno.test("validateCreateFilamentSpoolPayload rejeita filament_type_id ausente/inválido", () => {
  assertThrows(() => validateCreateFilamentSpoolPayload({ nominal_weight_grams: 250 }));
  assertThrows(() => validateCreateFilamentSpoolPayload({ filament_type_id: "nao-e-uuid", nominal_weight_grams: 250 }));
});

Deno.test("validateCreateFilamentSpoolPayload aceita empty_spool_weight_grams quando conhecido", () => {
  const result = validateCreateFilamentSpoolPayload({
    filament_type_id: VALID_UUID,
    nominal_weight_grams: 1000,
    empty_spool_weight_grams: 200,
  });
  assertEquals(result.p_empty_spool_weight_grams, 200);
});

Deno.test("validateCreateFilamentSpoolPayload rejeita status fora do enum", () => {
  assertThrows(() =>
    validateCreateFilamentSpoolPayload({ filament_type_id: VALID_UUID, nominal_weight_grams: 1000, status: "EM_USO" }),
  );
});

Deno.test("validateCreateFilamentSpoolPayload rejeita campo desconhecido (ex.: supplier_id)", () => {
  assertThrows(() =>
    validateCreateFilamentSpoolPayload({ filament_type_id: VALID_UUID, nominal_weight_grams: 1000, supplier_id: VALID_UUID }),
  );
});

// ---------------------------------------------------------------------------
// buildFilamentSpoolPatch
// ---------------------------------------------------------------------------

Deno.test("buildFilamentSpoolPatch inclui só as chaves enviadas", () => {
  assertEquals(buildFilamentSpoolPatch({ status: "ABERTO" }), { status: "ABERTO" });
});

Deno.test("buildFilamentSpoolPatch rejeita filament_type_id e code (imutáveis, nunca aceitos no patch)", () => {
  assertThrows(() => buildFilamentSpoolPatch({ filament_type_id: VALID_UUID }));
  assertThrows(() => buildFilamentSpoolPatch({ code: "RL-26-001" }));
});

Deno.test("buildFilamentSpoolPatch rejeita current_net_weight_grams (só alterável por movimentação/pesagem)", () => {
  assertThrows(() => buildFilamentSpoolPatch({ current_net_weight_grams: 500 }));
});

Deno.test("buildFilamentSpoolPatch rejeita status/is_active explicitamente null", () => {
  assertThrows(() => buildFilamentSpoolPatch({ status: null }));
  assertThrows(() => buildFilamentSpoolPatch({ is_active: null }));
});

Deno.test("buildFilamentSpoolPatch rejeita patch vazio", () => {
  assertThrows(() => buildFilamentSpoolPatch({}));
});

// ---------------------------------------------------------------------------
// handleRequest — só os caminhos que não exigem rede/banco reais
// ---------------------------------------------------------------------------

function makeRequest(method: string, path: string, body?: unknown): Request {
  return new Request(`https://example.supabase.co/functions/v1/filament-spools${path}`, {
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
  const res = await handleRequest(makeRequest("POST", "", { filament_type_id: VALID_UUID, nominal_weight_grams: 1000 }));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 405 para GET em /filament-spools", async () => {
  const res = await handleRequest(makeRequest("GET", ""));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest devolve 404 para rota com mais de um segmento", async () => {
  const res = await handleRequest(makeRequest("GET", `/${VALID_UUID}/extra`));
  assertEquals(res.status, 404);
});
