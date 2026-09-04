// Testes locais da Edge Function `inventory-purchases` — mesmo padrão de
// supabase/functions/stock-movements/handler.test.ts e
// filament-spools/handler.test.ts (sem dependência externa de framework de
// asserção, só `Deno.test`).
//
// Importa exclusivamente de handler.ts (nunca de index.ts) — handler.ts não
// tem nenhum efeito colateral de módulo (nenhum Deno.serve), então importá-lo
// aqui nunca abre um listener HTTP nem faz rede por conta própria.
//
// Escopo coberto sem rede/banco (executável offline):
//   - validadores puros (requirePurchaseCategory/requirePositiveIntegerQuantity/
//     requireFilamentMaterial/requireGrossWeightsGrams/optionalNonEmptyString/
//     optionalTimestamp/rejectUnknownKeys/requireUuid/
//     validateRegisterInventoryPurchasePayload);
//   - handleRequest: preflight CORS, 401 sem Authorization, 404 rota
//     desconhecida, 405 método não permitido, resposta de erro sem
//     detalhes internos.
//
// Por que "tipo inativo correspondente", "item inexistente/inativo",
// "reaproveitar tipo existente", "criar N rolos com saldo/movimento COMPRA"
// e "idempotência sob concorrência real" NÃO são testados via handleRequest
// ponta a ponta: dependem de ler/escrever o banco (register_inventory_purchase,
// migrations 20260828120000/121000) — exigem uma sessão autenticada real
// (rede) e um Postgres real. Mesmo critério já documentado em
// stock-movements/handler.test.ts. A integração completa dessas regras
// precisa de supabase/tests/inventory_purchases_test.sql (ver esse arquivo)
// executado contra o banco remoto/local real. Aqui testamos só a validação
// estrutural pura que handleRegisterInventoryPurchase usa antes de sequer
// chamar a RPC.
//
// LIMITAÇÃO DE AMBIENTE (mesma já registrada em todas as rodadas
// anteriores): o runtime `deno` não está instalado nesta máquina/sessão —
// este arquivo não pôde ser executado. Escrito seguindo a mesma disciplina
// já usada no projeto; precisa de uma primeira execução real
// (`deno test supabase/functions/inventory-purchases/`) antes de confiar
// cegamente nele.

import { ValidationError } from "../_shared/errors.ts";
import { isUuid } from "../_shared/validate.ts";
import {
  handleRequest,
  optionalNonEmptyString,
  optionalTimestamp,
  rejectUnknownKeys,
  requireFilamentMaterial,
  requireGrossWeightsGrams,
  requirePositiveIntegerQuantity,
  requirePurchaseCategory,
  requireTrimmedString,
  requireUuid,
  validateRegisterInventoryPurchasePayload,
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

const VALID_UUID = "123e4567-e89b-42d3-a456-426614174000";

// ---------------------------------------------------------------------------
// requireUuid / requirePurchaseCategory / requireFilamentMaterial
// ---------------------------------------------------------------------------

Deno.test("requireUuid aceita um UUID v4 bem formado", () => {
  assertEquals(requireUuid(VALID_UUID, "item_id"), VALID_UUID);
});

Deno.test("requireUuid rejeita valor que não é UUID", () => {
  assertThrows(() => requireUuid("nao-e-um-uuid", "item_id"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

Deno.test("requirePurchaseCategory aceita FILAMENT, ACCESSORY e PACKAGING", () => {
  assertEquals(requirePurchaseCategory("FILAMENT"), "FILAMENT");
  assertEquals(requirePurchaseCategory("ACCESSORY"), "ACCESSORY");
  assertEquals(requirePurchaseCategory("PACKAGING"), "PACKAGING");
});

Deno.test("requirePurchaseCategory rejeita valor fora do enum", () => {
  assertThrows(() => requirePurchaseCategory("TOOL"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

Deno.test("requireFilamentMaterial aceita PLA/PETG/TPU", () => {
  assertEquals(requireFilamentMaterial("PLA"), "PLA");
  assertEquals(requireFilamentMaterial("PETG"), "PETG");
  assertEquals(requireFilamentMaterial("TPU"), "TPU");
});

Deno.test("requireFilamentMaterial rejeita ABS (explicitamente fora do MVP)", () => {
  assertThrows(() => requireFilamentMaterial("ABS"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

Deno.test("requireTrimmedString rejeita vazio/só espaços", () => {
  assertThrows(() => requireTrimmedString("   ", "manufacturer"));
  assertThrows(() => requireTrimmedString(undefined, "manufacturer"));
});

Deno.test("requireTrimmedString trima e devolve o valor", () => {
  assertEquals(requireTrimmedString("  Voolt3D  ", "manufacturer"), "Voolt3D");
});

// ---------------------------------------------------------------------------
// requirePositiveIntegerQuantity
// ---------------------------------------------------------------------------

Deno.test("requirePositiveIntegerQuantity aceita inteiro positivo", () => {
  assertEquals(requirePositiveIntegerQuantity(3), 3);
});

Deno.test("requirePositiveIntegerQuantity rejeita zero/negativo/fração/não numérico", () => {
  assertThrows(() => requirePositiveIntegerQuantity(0));
  assertThrows(() => requirePositiveIntegerQuantity(-1));
  assertThrows(() => requirePositiveIntegerQuantity(1.5));
  assertThrows(() => requirePositiveIntegerQuantity("2"));
});

// ---------------------------------------------------------------------------
// requireGrossWeightsGrams
// ---------------------------------------------------------------------------

Deno.test("requireGrossWeightsGrams aceita uma lista do tamanho exato de quantity, cada peso maior que o nominal", () => {
  const result = requireGrossWeightsGrams([1050, 1030], 2, 1000);
  assertEquals(result, [1050, 1030]);
});

Deno.test("requireGrossWeightsGrams rejeita comprimento diferente de quantity", () => {
  assertThrows(() => requireGrossWeightsGrams([1050], 2, 1000), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
  assertThrows(() => requireGrossWeightsGrams([1050, 1030, 1010], 2, 1000));
});

Deno.test("requireGrossWeightsGrams rejeita peso bruto menor ou igual ao nominal", () => {
  assertThrows(() => requireGrossWeightsGrams([1000], 1, 1000), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
  assertThrows(() => requireGrossWeightsGrams([900], 1, 1000));
});

Deno.test("requireGrossWeightsGrams rejeita valor não numérico dentro da lista", () => {
  assertThrows(() => requireGrossWeightsGrams(["1050"], 1, 1000));
});

Deno.test("requireGrossWeightsGrams rejeita quando o valor não é uma lista", () => {
  assertThrows(() => requireGrossWeightsGrams(1050, 1, 1000));
  assertThrows(() => requireGrossWeightsGrams(undefined, 1, 1000));
});

// ---------------------------------------------------------------------------
// optionalNonEmptyString / optionalTimestamp
// ---------------------------------------------------------------------------

Deno.test("optionalNonEmptyString normaliza string vazia/só espaços para null e trima o resto", () => {
  assertEquals(optionalNonEmptyString("", "notes"), null);
  assertEquals(optionalNonEmptyString("   ", "notes"), null);
  assertEquals(optionalNonEmptyString("  compra em promoção  ", "notes"), "compra em promoção");
});

Deno.test("optionalTimestamp aceita null/undefined e ISO válido, rejeita inválido", () => {
  assertEquals(optionalTimestamp(null, "occurred_at"), null);
  assertEquals(optionalTimestamp("2026-08-28T12:00:00Z", "occurred_at"), "2026-08-28T12:00:00Z");
  assertThrows(() => optionalTimestamp("não é uma data", "occurred_at"));
});

// ---------------------------------------------------------------------------
// validateRegisterInventoryPurchasePayload
// ---------------------------------------------------------------------------

Deno.test("validateRegisterInventoryPurchasePayload aceita um payload mínimo válido de ACCESSORY", () => {
  const result = validateRegisterInventoryPurchasePayload({
    category: "ACCESSORY",
    quantity: 5,
    item_value: 100,
    item_id: VALID_UUID,
  });
  assertEquals(result, {
    p_category: "ACCESSORY",
    p_quantity: 5,
    p_item_value: 100,
    p_freight_value: 0,
    p_occurred_at: null,
    p_notes: null,
    p_idempotency_key: null,
    p_item_id: VALID_UUID,
  });
});

Deno.test("validateRegisterInventoryPurchasePayload aplica freight_value=0 quando omitido, preserva quando informado", () => {
  const withoutFreight = validateRegisterInventoryPurchasePayload({
    category: "PACKAGING",
    quantity: 1,
    item_value: 10,
    item_id: VALID_UUID,
  });
  assertEquals(withoutFreight.p_freight_value, 0);

  const withFreight = validateRegisterInventoryPurchasePayload({
    category: "PACKAGING",
    quantity: 1,
    item_value: 10,
    freight_value: 15.5,
    item_id: VALID_UUID,
  });
  assertEquals(withFreight.p_freight_value, 15.5);
});

Deno.test("validateRegisterInventoryPurchasePayload rejeita item_value/freight_value negativos", () => {
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({ category: "ACCESSORY", quantity: 1, item_value: -1, item_id: VALID_UUID }),
  );
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({
      category: "ACCESSORY",
      quantity: 1,
      item_value: 1,
      freight_value: -1,
      item_id: VALID_UUID,
    }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload exige item_id para ACCESSORY/PACKAGING", () => {
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({ category: "ACCESSORY", quantity: 1, item_value: 1 }),
  );
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({ category: "PACKAGING", quantity: 1, item_value: 1 }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload rejeita campos de FILAMENT presentes numa compra de ACCESSORY/PACKAGING", () => {
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({
      category: "ACCESSORY",
      quantity: 1,
      item_value: 1,
      item_id: VALID_UUID,
      material: "PLA",
    }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload rejeita item_id presente numa compra de FILAMENT", () => {
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({
      category: "FILAMENT",
      quantity: 1,
      item_value: 1,
      item_id: VALID_UUID,
      material: "PLA",
      manufacturer: "Voolt3D",
      line: "Sólida",
      commercial_color: "Preto",
      nominal_weight_grams: 1000,
      gross_weights_grams: [1050],
    }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload aceita um payload mínimo válido de FILAMENT com N pesos brutos", () => {
  const result = validateRegisterInventoryPurchasePayload({
    category: "FILAMENT",
    quantity: 2,
    item_value: 200,
    freight_value: 20,
    material: "PETG",
    manufacturer: "Voolt3D",
    line: "Sólida",
    commercial_color: "Preto",
    nominal_weight_grams: 1000,
    gross_weights_grams: [1250, 1240],
  });
  assertEquals(result, {
    p_category: "FILAMENT",
    p_quantity: 2,
    p_item_value: 200,
    p_freight_value: 20,
    p_occurred_at: null,
    p_notes: null,
    p_idempotency_key: null,
    p_material: "PETG",
    p_manufacturer: "Voolt3D",
    p_line: "Sólida",
    p_commercial_color: "Preto",
    p_nominal_weight_grams: 1000,
    p_gross_weights_grams: [1250, 1240],
  });
});

// ---------------------------------------------------------------------------
// FILAMENT — caminho novo (2026-09-04): filament_type_id
// ---------------------------------------------------------------------------

Deno.test("validateRegisterInventoryPurchasePayload aceita um payload mínimo válido de FILAMENT com filament_type_id", () => {
  const result = validateRegisterInventoryPurchasePayload({
    category: "FILAMENT",
    quantity: 2,
    item_value: 200,
    freight_value: 20,
    filament_type_id: VALID_UUID,
    nominal_weight_grams: 1000,
    gross_weights_grams: [1250, 1240],
  });
  assertEquals(result, {
    p_category: "FILAMENT",
    p_quantity: 2,
    p_item_value: 200,
    p_freight_value: 20,
    p_occurred_at: null,
    p_notes: null,
    p_idempotency_key: null,
    p_filament_type_id: VALID_UUID,
    p_nominal_weight_grams: 1000,
    p_gross_weights_grams: [1250, 1240],
  });
});

Deno.test("validateRegisterInventoryPurchasePayload rejeita filament_type_id junto de QUALQUER campo legado de identidade", () => {
  const base = {
    category: "FILAMENT",
    quantity: 1,
    item_value: 1,
    filament_type_id: VALID_UUID,
    nominal_weight_grams: 1000,
    gross_weights_grams: [1050],
  };
  for (const legacyKey of ["material", "manufacturer", "line", "commercial_color"] as const) {
    assertThrows(
      () =>
        validateRegisterInventoryPurchasePayload({
          ...base,
          [legacyKey]: legacyKey === "material" ? "PLA" : "X",
        }),
      (err) => {
        if (!isValidationError(err)) throw new Error("esperado ValidationError");
      },
    );
  }
});

Deno.test("validateRegisterInventoryPurchasePayload rejeita filament_type_id inválido (não-UUID)", () => {
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({
      category: "FILAMENT",
      quantity: 1,
      item_value: 1,
      filament_type_id: "nao-e-um-uuid",
      nominal_weight_grams: 1000,
      gross_weights_grams: [1050],
    }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload continua exigindo peso nominal/pesos brutos mesmo com filament_type_id", () => {
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({
      category: "FILAMENT",
      quantity: 1,
      item_value: 1,
      filament_type_id: VALID_UUID,
    }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload rejeita ABS para FILAMENT", () => {
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({
      category: "FILAMENT",
      quantity: 1,
      item_value: 1,
      material: "ABS",
      manufacturer: "Voolt3D",
      line: "Sólida",
      commercial_color: "Preto",
      nominal_weight_grams: 1000,
      gross_weights_grams: [1050],
    }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload rejeita gross_weights_grams com comprimento diferente de quantity", () => {
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({
      category: "FILAMENT",
      quantity: 2,
      item_value: 1,
      material: "PLA",
      manufacturer: "Voolt3D",
      line: "Sólida",
      commercial_color: "Preto",
      nominal_weight_grams: 1000,
      gross_weights_grams: [1050],
    }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload rejeita peso bruto menor ou igual ao nominal", () => {
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({
      category: "FILAMENT",
      quantity: 1,
      item_value: 1,
      material: "PLA",
      manufacturer: "Voolt3D",
      line: "Sólida",
      commercial_color: "Preto",
      nominal_weight_grams: 1000,
      gross_weights_grams: [1000],
    }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload rejeita category ausente/inválida", () => {
  assertThrows(() => validateRegisterInventoryPurchasePayload({ quantity: 1, item_value: 1, item_id: VALID_UUID }));
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({ category: "TOOL", quantity: 1, item_value: 1, item_id: VALID_UUID }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload rejeita campo desconhecido", () => {
  assertThrows(() =>
    validateRegisterInventoryPurchasePayload({
      category: "ACCESSORY",
      quantity: 1,
      item_value: 1,
      item_id: VALID_UUID,
      supplier: "fornecedor X",
    }),
  );
});

Deno.test("validateRegisterInventoryPurchasePayload preserva idempotency_key e notes trimados", () => {
  const result = validateRegisterInventoryPurchasePayload({
    category: "ACCESSORY",
    quantity: 1,
    item_value: 1,
    item_id: VALID_UUID,
    notes: "  observação técnica  ",
    idempotency_key: "11111111-1111-1111-1111-111111111111",
  });
  assertEquals(result.p_notes, "observação técnica");
  assertEquals(result.p_idempotency_key, "11111111-1111-1111-1111-111111111111");
});

Deno.test("rejectUnknownKeys aceita só chaves permitidas", () => {
  rejectUnknownKeys({ a: 1 }, ["a", "b"], "teste");
});

Deno.test("rejectUnknownKeys rejeita chave fora da lista", () => {
  assertThrows(() => rejectUnknownKeys({ a: 1, c: 2 }, ["a", "b"], "teste"));
});

Deno.test("isUuid aceita um UUID v4 bem formado e rejeita string inválida", () => {
  assertEquals(isUuid(VALID_UUID), true);
  assertEquals(isUuid("nao-e-um-uuid"), false);
});

// ---------------------------------------------------------------------------
// handleRequest — só os caminhos que não exigem rede/banco reais
// ---------------------------------------------------------------------------

function makeRequest(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  return new Request(`https://example.supabase.co/functions/v1/inventory-purchases${path}`, {
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

Deno.test("handleRequest rejeita POST sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(
    makeRequest("POST", "", { category: "ACCESSORY", quantity: 1, item_value: 1, item_id: VALID_UUID }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 405 para método não permitido em /inventory-purchases (sem exigir autenticação)", () =>
  handleRequest(makeRequest("GET", "")).then((res) => assertEquals(res.status, 405)));

Deno.test("handleRequest devolve 405 para PATCH/DELETE em /inventory-purchases (histórico imutável, sem rota de edição/exclusão)", async () => {
  const patchRes = await handleRequest(makeRequest("PATCH", ""));
  assertEquals(patchRes.status, 405);
  const deleteRes = await handleRequest(makeRequest("DELETE", ""));
  assertEquals(deleteRes.status, 405);
});

Deno.test("handleRequest devolve 404 para rota não reconhecida (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("GET", "/algum-id"));
  assertEquals(res.status, 404);
});

Deno.test("respostas de erro não expõem detalhes internos (mensagem genérica e segura)", async () => {
  const res = await handleRequest(makeRequest("POST", ""));
  const envelope = (await res.json()) as { error?: { type?: string; message?: string } };
  assertEquals(res.status, 401);
  assertEquals(envelope.error?.type, "authorization");
  assertEquals(envelope.error?.message, "Header Authorization ausente.");
});
