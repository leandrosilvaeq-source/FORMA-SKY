// Testes locais da Edge Function `filament-movements` — mesmo padrão de
// stock-movements/handler.test.ts.
//
// LIMITAÇÃO DE AMBIENTE: o runtime `deno` não está instalado nesta
// máquina/sessão — este arquivo não pôde ser executado. Precisa de uma
// primeira execução real (`deno test supabase/functions/filament-movements/`)
// antes de confiar cegamente nele. Regras dependentes do banco (peso
// insuficiente, teto do nominal, rolo descartado, tara desconhecida,
// INITIAL_BALANCE repetido, idempotência sob concorrência) são cobertas por
// supabase/tests/filament_inventory_test.sql.

import { ValidationError } from "../_shared/errors.ts";
import {
  handleRequest,
  optionalNonEmptyString,
  requireFilamentMovementType,
  requirePositiveQuantity,
  validateRegisterFilamentMovementPayload,
  validateRegisterFilamentWeighingPayload,
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
// requireFilamentMovementType
// ---------------------------------------------------------------------------

Deno.test("requireFilamentMovementType aceita os 8 tipos manuais desta rota", () => {
  for (const type of [
    "INITIAL_BALANCE",
    "PURCHASE",
    "RETURN",
    "POSITIVE_ADJUSTMENT",
    "MANUAL_CONSUMPTION",
    "LOSS",
    "SAMPLE_TEST",
    "NEGATIVE_ADJUSTMENT",
  ]) {
    assertEquals(requireFilamentMovementType(type), type);
  }
});

Deno.test("requireFilamentMovementType rejeita WEIGHING_ADJUSTMENT (exclusivo da rota /weighing)", () => {
  assertThrows(() => requireFilamentMovementType("WEIGHING_ADJUSTMENT"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

// ---------------------------------------------------------------------------
// requirePositiveQuantity — gramas, fracionário (diferente de
// requirePositiveIntegerQuantity de stock-movements/handler.ts)
// ---------------------------------------------------------------------------

Deno.test("requirePositiveQuantity aceita valor fracionário positivo", () => {
  assertEquals(requirePositiveQuantity(487.5), 487.5);
  assertEquals(requirePositiveQuantity(1), 1);
});

Deno.test("requirePositiveQuantity rejeita zero/negativo/não numérico", () => {
  assertThrows(() => requirePositiveQuantity(0));
  assertThrows(() => requirePositiveQuantity(-5));
  assertThrows(() => requirePositiveQuantity("500"));
});

// ---------------------------------------------------------------------------
// validateRegisterFilamentMovementPayload
// ---------------------------------------------------------------------------

Deno.test("validateRegisterFilamentMovementPayload aceita payload mínimo válido (entrada sem motivo)", () => {
  const result = validateRegisterFilamentMovementPayload({
    spool_id: VALID_UUID,
    movement_type: "PURCHASE",
    quantity: 500,
  });
  assertEquals(result, {
    p_spool_id: VALID_UUID,
    p_movement_type: "PURCHASE",
    p_quantity: 500,
    p_reason: null,
    p_occurred_at: null,
    p_reference_type: null,
    p_reference_id: null,
    p_idempotency_key: null,
  });
});

Deno.test("validateRegisterFilamentMovementPayload exige reason para MANUAL_CONSUMPTION/LOSS/SAMPLE_TEST/POSITIVE_ADJUSTMENT/NEGATIVE_ADJUSTMENT", () => {
  for (const movementType of ["MANUAL_CONSUMPTION", "LOSS", "SAMPLE_TEST", "POSITIVE_ADJUSTMENT", "NEGATIVE_ADJUSTMENT"]) {
    assertThrows(
      () => validateRegisterFilamentMovementPayload({ spool_id: VALID_UUID, movement_type: movementType, quantity: 10 }),
      (err) => {
        if (!isValidationError(err)) throw new Error(`esperado ValidationError para ${movementType}`);
      },
    );
  }
});

Deno.test("validateRegisterFilamentMovementPayload aceita PURCHASE/RETURN/INITIAL_BALANCE sem reason", () => {
  for (const movementType of ["PURCHASE", "RETURN", "INITIAL_BALANCE"]) {
    const result = validateRegisterFilamentMovementPayload({ spool_id: VALID_UUID, movement_type: movementType, quantity: 10 });
    assertEquals(result.p_reason, null);
  }
});

Deno.test("validateRegisterFilamentMovementPayload rejeita quantity fracionária inválida não-positiva e spool_id ausente", () => {
  assertThrows(() => validateRegisterFilamentMovementPayload({ spool_id: VALID_UUID, movement_type: "PURCHASE", quantity: 0 }));
  assertThrows(() => validateRegisterFilamentMovementPayload({ movement_type: "PURCHASE", quantity: 10 }));
});

Deno.test("validateRegisterFilamentMovementPayload rejeita movement_type WEIGHING_ADJUSTMENT (rota errada)", () => {
  assertThrows(() =>
    validateRegisterFilamentMovementPayload({ spool_id: VALID_UUID, movement_type: "WEIGHING_ADJUSTMENT", quantity: 10 }),
  );
});

Deno.test("validateRegisterFilamentMovementPayload rejeita campo desconhecido", () => {
  assertThrows(() =>
    validateRegisterFilamentMovementPayload({ spool_id: VALID_UUID, movement_type: "PURCHASE", quantity: 10, order_id: VALID_UUID }),
  );
});

// ---------------------------------------------------------------------------
// validateRegisterFilamentWeighingPayload
// ---------------------------------------------------------------------------

Deno.test("validateRegisterFilamentWeighingPayload aceita peso bruto + tara conhecida", () => {
  const result = validateRegisterFilamentWeighingPayload({
    spool_id: VALID_UUID,
    measured_gross_weight_grams: 700,
    reason: "conferência mensal",
  });
  assertEquals(result.p_measured_gross_weight_grams, 700);
  assertEquals(result.p_measured_net_weight_grams, null);
  assertEquals(result.p_reason, "conferência mensal");
});

Deno.test("validateRegisterFilamentWeighingPayload aceita peso líquido direto (tara desconhecida)", () => {
  const result = validateRegisterFilamentWeighingPayload({
    spool_id: VALID_UUID,
    measured_net_weight_grams: 480,
    reason: "tara não conhecida, pesagem direta",
  });
  assertEquals(result.p_measured_net_weight_grams, 480);
  assertEquals(result.p_measured_gross_weight_grams, null);
});

Deno.test("validateRegisterFilamentWeighingPayload rejeita quando nenhum peso é informado", () => {
  assertThrows(() => validateRegisterFilamentWeighingPayload({ spool_id: VALID_UUID, reason: "teste" }));
});

Deno.test("validateRegisterFilamentWeighingPayload rejeita quando os dois pesos são informados ao mesmo tempo", () => {
  assertThrows(() =>
    validateRegisterFilamentWeighingPayload({
      spool_id: VALID_UUID,
      measured_gross_weight_grams: 700,
      measured_net_weight_grams: 480,
      reason: "teste",
    }),
  );
});

Deno.test("validateRegisterFilamentWeighingPayload exige reason sempre (sem tolerância diferencial por tamanho da diferença)", () => {
  assertThrows(() => validateRegisterFilamentWeighingPayload({ spool_id: VALID_UUID, measured_net_weight_grams: 480 }));
});

Deno.test("optionalNonEmptyString normaliza vazio/espaços para null", () => {
  assertEquals(optionalNonEmptyString("", "reason"), null);
  assertEquals(optionalNonEmptyString("   ", "reason"), null);
  assertEquals(optionalNonEmptyString("  peso divergente  ", "reason"), "peso divergente");
});

// ---------------------------------------------------------------------------
// handleRequest — só os caminhos que não exigem rede/banco reais
// ---------------------------------------------------------------------------

function makeRequest(method: string, path: string, body?: unknown): Request {
  return new Request(`https://example.supabase.co/functions/v1/filament-movements${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

Deno.test("handleRequest responde ao preflight OPTIONS com 204", async () => {
  const res = await handleRequest(makeRequest("OPTIONS", ""));
  assertEquals(res.status, 204);
});

Deno.test("handleRequest rejeita POST sem Authorization com 401 em /filament-movements e em /filament-movements/weighing", async () => {
  const res1 = await handleRequest(makeRequest("POST", "", { spool_id: VALID_UUID, movement_type: "PURCHASE", quantity: 10 }));
  assertEquals(res1.status, 401);

  const res2 = await handleRequest(
    makeRequest("POST", "/weighing", { spool_id: VALID_UUID, measured_net_weight_grams: 480, reason: "teste" }),
  );
  assertEquals(res2.status, 401);
});

Deno.test("handleRequest devolve 405 para GET em /filament-movements e em /filament-movements/weighing", async () => {
  const res1 = await handleRequest(makeRequest("GET", ""));
  assertEquals(res1.status, 405);
  const res2 = await handleRequest(makeRequest("GET", "/weighing"));
  assertEquals(res2.status, 405);
});

Deno.test("handleRequest devolve 404 para rota desconhecida (ex.: /reservas)", async () => {
  const res = await handleRequest(makeRequest("GET", "/reservas"));
  assertEquals(res.status, 404);
});
