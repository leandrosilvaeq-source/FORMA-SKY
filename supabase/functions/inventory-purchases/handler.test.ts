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
//   - 2026-09-04 (compra de filamento com múltiplos itens):
//     validateFilamentPurchaseItem/validateRegisterFilamentPurchasePayload
//     (rota POST /inventory-purchases/filament, register_filament_purchase);
//   - 2026-09-04, mesma rodada (Local da compra): requirePurchaseChannel
//     (purchase_channel, obrigatório, 4 valores oficiais);
//   - handleRequest: preflight CORS, 401 sem Authorization, 404 rota
//     desconhecida, 405 método não permitido, resposta de erro sem
//     detalhes internos — nas duas rotas (base e /filament).
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
  requireIsoDate,
  requireMixedPurchaseChannel,
  requirePositiveIntegerQuantity,
  requirePurchaseCategory,
  requirePurchaseChannel,
  requireTrimmedString,
  requireUuid,
  validateAccessoryPurchaseItem,
  validateFilamentPurchaseItem,
  validateMixedPurchaseItem,
  validateRegisterAccessoryPurchasePayload,
  validateRegisterFilamentPurchasePayload,
  validateRegisterInventoryPurchasePayload,
  validateRegisterMixedPurchasePayload,
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

// ---------------------------------------------------------------------------
// FILAMENT — compra com múltiplos itens (2026-09-04): validateFilamentPurchaseItem
// / validateRegisterFilamentPurchasePayload (rota POST /inventory-purchases/filament,
// register_filament_purchase, migration 20260904130000).
// ---------------------------------------------------------------------------

const VALID_ITEM = {
  filament_type_id: VALID_UUID,
  manufacturer: "Bambu Lab",
  nominal_weight_grams: 1000,
  quantity: 2,
  total_value: 190,
};

Deno.test("validateFilamentPurchaseItem aceita um item mínimo válido e trima a marca", () => {
  const result = validateFilamentPurchaseItem({ ...VALID_ITEM, manufacturer: "  Bambu Lab  " }, 0);
  assertEquals(result, VALID_ITEM);
});

Deno.test("validateFilamentPurchaseItem rejeita filament_type_id ausente/inválido", () => {
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, filament_type_id: undefined }, 0));
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, filament_type_id: "nao-e-um-uuid" }, 0));
});

Deno.test("validateFilamentPurchaseItem rejeita marca vazia/só espaços", () => {
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, manufacturer: "   " }, 0));
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, manufacturer: undefined }, 0));
});

Deno.test("validateFilamentPurchaseItem rejeita peso líquido zero/negativo/ausente", () => {
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, nominal_weight_grams: 0 }, 0));
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, nominal_weight_grams: -1 }, 0));
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, nominal_weight_grams: undefined }, 0));
});

Deno.test("validateFilamentPurchaseItem rejeita quantidade zero/negativa/fracionária", () => {
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, quantity: 0 }, 0));
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, quantity: -1 }, 0));
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, quantity: 1.5 }, 0));
});

// 2026-09-05: total_value substitui unit_value neste contrato — deve ser
// MAIOR QUE ZERO (diferente da regra antiga de unit_value, que aceitava
// zero); register_filament_purchase deriva unit_value internamente.
Deno.test("validateFilamentPurchaseItem rejeita total_value negativo ou zero", () => {
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, total_value: -1 }, 0));
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, total_value: 0 }, 0));
});

Deno.test("validateFilamentPurchaseItem aceita total_value que não divide exatamente pela quantidade (arredondamento fica por conta da RPC)", () => {
  const result = validateFilamentPurchaseItem({ ...VALID_ITEM, quantity: 3, total_value: 100 }, 0);
  assertEquals(result.total_value, 100);
  assertEquals(result.quantity, 3);
});

Deno.test("validateFilamentPurchaseItem rejeita campo desconhecido dentro do item", () => {
  assertThrows(() => validateFilamentPurchaseItem({ ...VALID_ITEM, line: "Sólida" }, 0));
});

Deno.test("validateFilamentPurchaseItem rejeita valor que não é objeto", () => {
  assertThrows(() => validateFilamentPurchaseItem("string", 0));
  assertThrows(() => validateFilamentPurchaseItem([VALID_ITEM], 0));
  assertThrows(() => validateFilamentPurchaseItem(null, 0));
});

Deno.test("validateRegisterFilamentPurchasePayload aceita um payload mínimo válido com 1 item, freight_value=0 quando omitido", () => {
  const result = validateRegisterFilamentPurchasePayload({
    items: [VALID_ITEM],
    purchase_channel: "MERCADO_LIVRE",
  });
  assertEquals(result, {
    p_freight_value: 0,
    p_occurred_at: null,
    p_notes: null,
    p_idempotency_key: null,
    p_items: [VALID_ITEM],
    p_purchase_channel: "MERCADO_LIVRE",
  });
});

Deno.test("validateRegisterFilamentPurchasePayload aceita vários itens (tipos/marcas diferentes) e preserva a ordem", () => {
  const secondItem = {
    filament_type_id: "11111111-1111-1111-1111-111111111111",
    manufacturer: "Voolt",
    nominal_weight_grams: 1000,
    quantity: 1,
    total_value: 110,
  };
  const result = validateRegisterFilamentPurchasePayload({
    freight_value: 30,
    items: [VALID_ITEM, secondItem],
    purchase_channel: "ALIEXPRESS",
  });
  assertEquals(result.p_freight_value, 30);
  assertEquals(result.p_items, [VALID_ITEM, secondItem]);
  assertEquals(result.p_purchase_channel, "ALIEXPRESS");
});

Deno.test("validateRegisterFilamentPurchasePayload rejeita freight_value negativo", () => {
  assertThrows(() =>
    validateRegisterFilamentPurchasePayload({
      freight_value: -1,
      items: [VALID_ITEM],
      purchase_channel: "MERCADO_LIVRE",
    }),
  );
});

Deno.test("validateRegisterFilamentPurchasePayload rejeita items ausente/vazio/não-array", () => {
  assertThrows(() => validateRegisterFilamentPurchasePayload({ purchase_channel: "MERCADO_LIVRE" }));
  assertThrows(() =>
    validateRegisterFilamentPurchasePayload({ items: [], purchase_channel: "MERCADO_LIVRE" }),
  );
  assertThrows(() =>
    validateRegisterFilamentPurchasePayload({ items: "not-an-array", purchase_channel: "MERCADO_LIVRE" }),
  );
});

Deno.test("validateRegisterFilamentPurchasePayload rejeita um item inválido dentro da lista (propaga o erro do item)", () => {
  assertThrows(() =>
    validateRegisterFilamentPurchasePayload({
      items: [VALID_ITEM, { ...VALID_ITEM, quantity: 0 }],
      purchase_channel: "MERCADO_LIVRE",
    }),
  );
});

Deno.test("validateRegisterFilamentPurchasePayload rejeita campo desconhecido no corpo (ex.: os campos de item único da rota base)", () => {
  assertThrows(() =>
    validateRegisterFilamentPurchasePayload({
      items: [VALID_ITEM],
      purchase_channel: "MERCADO_LIVRE",
      category: "FILAMENT",
    }),
  );
  assertThrows(() =>
    validateRegisterFilamentPurchasePayload({
      items: [VALID_ITEM],
      purchase_channel: "MERCADO_LIVRE",
      quantity: 1,
    }),
  );
});

Deno.test("validateRegisterFilamentPurchasePayload preserva idempotency_key e notes trimados", () => {
  const result = validateRegisterFilamentPurchasePayload({
    items: [VALID_ITEM],
    purchase_channel: "SHOPEE",
    notes: "  compra com 2 marcas  ",
    idempotency_key: "11111111-1111-1111-1111-111111111111",
  });
  assertEquals(result.p_notes, "compra com 2 marcas");
  assertEquals(result.p_idempotency_key, "11111111-1111-1111-1111-111111111111");
});

// ---------------------------------------------------------------------------
// requirePurchaseChannel / purchase_channel (2026-09-04, "Local da compra" —
// migration 20260904140000_add_purchase_channel_to_filament_purchases.sql)
// ---------------------------------------------------------------------------

Deno.test("requirePurchaseChannel aceita os 6 valores oficiais (SITE/OUTRO acrescentados em 2026-09-04)", () => {
  assertEquals(requirePurchaseChannel("MERCADO_LIVRE"), "MERCADO_LIVRE");
  assertEquals(requirePurchaseChannel("ALIEXPRESS"), "ALIEXPRESS");
  assertEquals(requirePurchaseChannel("SHOPEE"), "SHOPEE");
  assertEquals(requirePurchaseChannel("PRESENCIAL"), "PRESENCIAL");
  assertEquals(requirePurchaseChannel("SITE"), "SITE");
  assertEquals(requirePurchaseChannel("OUTRO"), "OUTRO");
});

Deno.test("requirePurchaseChannel rejeita valor ausente/desconhecido", () => {
  assertThrows(() => requirePurchaseChannel(undefined), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
  assertThrows(() => requirePurchaseChannel(null));
  assertThrows(() => requirePurchaseChannel("AMAZON"));
  assertThrows(() => requirePurchaseChannel(""));
});

Deno.test("validateRegisterFilamentPurchasePayload rejeita purchase_channel ausente/inválido", () => {
  assertThrows(() => validateRegisterFilamentPurchasePayload({ items: [VALID_ITEM] }));
  assertThrows(() =>
    validateRegisterFilamentPurchasePayload({ items: [VALID_ITEM], purchase_channel: "AMAZON" }),
  );
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

// ---------------------------------------------------------------------------
// handleRequest — POST /inventory-purchases/filament (register_filament_purchase)
// ---------------------------------------------------------------------------

Deno.test("handleRequest rejeita POST em /inventory-purchases/filament sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(makeRequest("POST", "/filament", { items: [VALID_ITEM] }));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 405 para método não permitido em /inventory-purchases/filament (sem exigir autenticação)", () =>
  handleRequest(makeRequest("GET", "/filament")).then((res) => assertEquals(res.status, 405)));

Deno.test("handleRequest devolve 404 para sub-rota de /inventory-purchases/filament (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("GET", "/filament/algum-id"));
  assertEquals(res.status, 404);
});

Deno.test("respostas de erro não expõem detalhes internos (mensagem genérica e segura)", async () => {
  const res = await handleRequest(makeRequest("POST", ""));
  const envelope = (await res.json()) as { error?: { type?: string; message?: string } };
  assertEquals(res.status, 401);
  assertEquals(envelope.error?.type, "authorization");
  assertEquals(envelope.error?.message, "Header Authorization ausente.");
});

// ---------------------------------------------------------------------------
// ACESSÓRIOS — validateAccessoryPurchaseItem / validateRegisterAccessoryPurchasePayload
// (rota POST /inventory-purchases/accessory, register_accessory_purchase,
// migration 20260906140000). O frontend NUNCA envia unit_cost,
// freight_allocated nem saldos — o handler só valida estrutura
// (accessory_id/quantity/total_value, limites, acessório único, strings com
// trim/teto). As regras que dependem do banco (acessório existe/ativo,
// idempotência, rateio, média ponderada) são exclusivas da RPC e são
// cobertas por supabase/tests/accessory_purchase_test.sql.
// ---------------------------------------------------------------------------

const VALID_ACCESSORY_ITEM = { accessory_id: VALID_UUID, quantity: 3, total_value: 25 };
const OTHER_UUID = "223e4567-e89b-42d3-a456-426614174111";

Deno.test("validateAccessoryPurchaseItem aceita um item mínimo válido", () => {
  assertEquals(validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM }, 0), VALID_ACCESSORY_ITEM);
});

Deno.test("validateAccessoryPurchaseItem rejeita accessory_id ausente/inválido", () => {
  assertThrows(() => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, accessory_id: undefined }, 0));
  assertThrows(() => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, accessory_id: "nao-e-uuid" }, 0));
});

Deno.test("validateAccessoryPurchaseItem rejeita quantidade zero/negativa/fracionada", () => {
  assertThrows(() => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, quantity: 0 }, 0));
  assertThrows(() => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, quantity: -1 }, 0));
  assertThrows(() => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, quantity: 1.5 }, 0));
});

Deno.test("validateAccessoryPurchaseItem rejeita total_value zero/negativo e com mais de 2 casas", () => {
  assertThrows(() => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, total_value: 0 }, 0));
  assertThrows(() => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, total_value: -5 }, 0));
  assertThrows(
    () => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, total_value: 25.005 }, 0),
    (err) => assertEquals(isValidationError(err), true),
  );
  assertEquals(validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, total_value: 25.5 }, 0).total_value, 25.5);
});

Deno.test("validateAccessoryPurchaseItem rejeita chave desconhecida no item (nunca unit_cost/freight_allocated/saldos)", () => {
  assertThrows(() => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, unit_cost: 3 }, 0));
  assertThrows(() => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, freight_allocated: 1 }, 0));
  assertThrows(() => validateAccessoryPurchaseItem({ ...VALID_ACCESSORY_ITEM, balance_before: 0 }, 0));
});

Deno.test("validateRegisterAccessoryPurchasePayload aceita um payload mínimo (frete default 0, sem fornecedor/observação)", () => {
  const result = validateRegisterAccessoryPurchasePayload({ items: [{ ...VALID_ACCESSORY_ITEM }] });
  assertEquals(result, {
    p_items: [VALID_ACCESSORY_ITEM],
    p_freight_value: 0,
    p_supplier_name: null,
    p_notes: null,
    p_occurred_at: null,
    p_idempotency_key: null,
  });
});

Deno.test("validateRegisterAccessoryPurchasePayload preserva freight/supplier/notes/occurred_at quando informados (com trim)", () => {
  const result = validateRegisterAccessoryPurchasePayload({
    items: [{ ...VALID_ACCESSORY_ITEM }],
    freight_value: 5,
    supplier_name: "  Loja X  ",
    notes: "  compra de reposicao  ",
    occurred_at: "2026-09-06T00:00:00Z",
    idempotency_key: "abc",
  });
  assertEquals(result.p_freight_value, 5);
  assertEquals(result.p_supplier_name, "Loja X");
  assertEquals(result.p_notes, "compra de reposicao");
  assertEquals(result.p_occurred_at, "2026-09-06T00:00:00Z");
  assertEquals(result.p_idempotency_key, "abc");
});

Deno.test("validateRegisterAccessoryPurchasePayload rejeita lista vazia e mais de 50 itens; aceita exatamente 50", () => {
  assertThrows(() => validateRegisterAccessoryPurchasePayload({ items: [] }));
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      accessory_id: `${i.toString().padStart(8, "0")}-e89b-42d3-a456-426614174000`,
      quantity: 1,
      total_value: 1,
    }));
  assertThrows(
    () => validateRegisterAccessoryPurchasePayload({ items: make(51) }),
    (err) => assertEquals(isValidationError(err), true),
  );
  assertEquals((validateRegisterAccessoryPurchasePayload({ items: make(50) }).p_items as unknown[]).length, 50);
});

Deno.test("validateRegisterAccessoryPurchasePayload rejeita o mesmo acessório em duas linhas; aceita distintos", () => {
  assertThrows(
    () =>
      validateRegisterAccessoryPurchasePayload({
        items: [
          { accessory_id: VALID_UUID, quantity: 1, total_value: 10 },
          { accessory_id: VALID_UUID, quantity: 2, total_value: 20 },
        ],
      }),
    (err) => assertEquals(isValidationError(err), true),
  );
  const ok = validateRegisterAccessoryPurchasePayload({
    items: [
      { accessory_id: VALID_UUID, quantity: 1, total_value: 10 },
      { accessory_id: OTHER_UUID, quantity: 2, total_value: 20 },
    ],
  });
  assertEquals((ok.p_items as unknown[]).length, 2);
});

Deno.test("validateRegisterAccessoryPurchasePayload rejeita freight_value negativo / >2 casas e supplier>200 / notes>1000", () => {
  assertThrows(() => validateRegisterAccessoryPurchasePayload({ items: [{ ...VALID_ACCESSORY_ITEM }], freight_value: -1 }));
  assertThrows(() =>
    validateRegisterAccessoryPurchasePayload({ items: [{ ...VALID_ACCESSORY_ITEM }], freight_value: 1.005 })
  );
  assertThrows(() =>
    validateRegisterAccessoryPurchasePayload({ items: [{ ...VALID_ACCESSORY_ITEM }], supplier_name: "x".repeat(201) })
  );
  assertThrows(() =>
    validateRegisterAccessoryPurchasePayload({ items: [{ ...VALID_ACCESSORY_ITEM }], notes: "y".repeat(1001) })
  );
});

Deno.test("validateRegisterAccessoryPurchasePayload rejeita chave desconhecida no corpo (nunca category/unit_cost/freight_allocated)", () => {
  assertThrows(() =>
    validateRegisterAccessoryPurchasePayload({ items: [{ ...VALID_ACCESSORY_ITEM }], category: "ACCESSORY" })
  );
  assertThrows(() =>
    validateRegisterAccessoryPurchasePayload({ items: [{ ...VALID_ACCESSORY_ITEM }], freight_allocated: 1 })
  );
});

// ---------------------------------------------------------------------------
// handleRequest — POST /inventory-purchases/accessory (register_accessory_purchase)
// ---------------------------------------------------------------------------

Deno.test("handleRequest rejeita POST em /inventory-purchases/accessory sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(makeRequest("POST", "/accessory", { items: [VALID_ACCESSORY_ITEM] }));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 405 para método não permitido em /inventory-purchases/accessory (sem exigir autenticação)", () =>
  handleRequest(makeRequest("GET", "/accessory")).then((res) => assertEquals(res.status, 405)));

Deno.test("handleRequest devolve 404 para sub-rota de /inventory-purchases/accessory (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("GET", "/accessory/algum-id"));
  assertEquals(res.status, 404);
});

Deno.test("handleRequest preserva as rotas antigas: base (Embalagem/legado) e /filament seguem respondendo 401 sem Authorization", async () => {
  const base = await handleRequest(
    makeRequest("POST", "", { category: "PACKAGING", quantity: 1, item_value: 1, item_id: VALID_UUID }),
  );
  assertEquals(base.status, 401);
  const filament = await handleRequest(makeRequest("POST", "/filament", { items: [VALID_ITEM] }));
  assertEquals(filament.status, 401);
});

// ---------------------------------------------------------------------------
// COMPRA MISTA — POST /inventory-purchases/mixed (register_mixed_inventory_purchase)
// migration 20260906150000. Escritos, NAO executados — deno ausente nesta
// maquina (mesma limitacao ja registrada no cabecalho deste arquivo).
// ---------------------------------------------------------------------------

const MIXED_FIL_ITEM = {
  category: "FILAMENT",
  filament_type_id: VALID_UUID,
  manufacturer: "Voolt",
  nominal_weight_grams: 1000,
  quantity: 2,
  total_value: 100.0,
};
const MIXED_ACC_ITEM = { category: "ACCESSORY", accessory_id: VALID_UUID, quantity: 3, total_value: 15.0 };
const MIXED_PKG_ITEM = {
  category: "PACKAGING",
  packaging_id: "223e4567-e89b-42d3-a456-426614174000",
  quantity: 4,
  total_value: 20.0,
};

function mixedBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    items: [{ ...MIXED_FIL_ITEM }, { ...MIXED_ACC_ITEM }, { ...MIXED_PKG_ITEM }],
    freight_value: 10,
    purchase_channel: "MERCADO_LIVRE",
    occurred_on: "2026-09-06",
    ...over,
  };
}

Deno.test("requireMixedPurchaseChannel aceita os 5 canais; rejeita SITE/OUTRO/valor fora", () => {
  for (const c of ["MERCADO_LIVRE", "SHOPEE", "ALIEXPRESS", "OUTRO_SITE", "PRESENCIAL"]) {
    assertEquals(requireMixedPurchaseChannel(c), c);
  }
  assertThrows(() => requireMixedPurchaseChannel("SITE"));
  assertThrows(() => requireMixedPurchaseChannel("OUTRO"));
  assertThrows(() => requireMixedPurchaseChannel("FACEBOOK"));
});

Deno.test("requireIsoDate aceita YYYY-MM-DD real; rejeita formato/data inexistente/tipo", () => {
  assertEquals(requireIsoDate("2026-09-06", "occurred_on"), "2026-09-06");
  assertThrows(() => requireIsoDate("06/09/2026", "occurred_on"));
  assertThrows(() => requireIsoDate("2026-9-6", "occurred_on"));
  assertThrows(() => requireIsoDate("2026-02-30", "occurred_on"));
  assertThrows(() => requireIsoDate("", "occurred_on"));
  assertThrows(() => requireIsoDate(20260906, "occurred_on"));
});

Deno.test("validateMixedPurchaseItem: FILAMENT valido trima a marca e devolve os campos", () => {
  const it = validateMixedPurchaseItem({ ...MIXED_FIL_ITEM, manufacturer: "  Bambu Lab  " }, 0);
  assertEquals(it.category, "FILAMENT");
  assertEquals(it.manufacturer, "Bambu Lab");
  assertEquals(it.nominal_weight_grams, 1000);
  assertEquals(it.quantity, 2);
  assertEquals(it.total_value, 100.0);
});

Deno.test("validateMixedPurchaseItem: ACCESSORY / PACKAGING validos", () => {
  const a = validateMixedPurchaseItem({ ...MIXED_ACC_ITEM }, 0);
  assertEquals(a.category, "ACCESSORY");
  assertEquals(a.accessory_id, VALID_UUID);
  const p = validateMixedPurchaseItem({ ...MIXED_PKG_ITEM }, 1);
  assertEquals(p.category, "PACKAGING");
  assertEquals(p.packaging_id, "223e4567-e89b-42d3-a456-426614174000");
});

Deno.test("validateMixedPurchaseItem rejeita category ausente/invalida (MIXED nao e categoria de item)", () => {
  assertThrows(() => validateMixedPurchaseItem({ accessory_id: VALID_UUID, quantity: 1, total_value: 1 }, 0));
  assertThrows(() => validateMixedPurchaseItem({ category: "MIXED", quantity: 1, total_value: 1 }, 0));
});

Deno.test("validateMixedPurchaseItem rejeita campo de OUTRA categoria dentro do item (schema discriminado)", () => {
  assertThrows(() => validateMixedPurchaseItem({ ...MIXED_ACC_ITEM, filament_type_id: VALID_UUID }, 0));
  assertThrows(() => validateMixedPurchaseItem({ ...MIXED_FIL_ITEM, accessory_id: VALID_UUID }, 0));
});

Deno.test("validateMixedPurchaseItem rejeita quantity 0/fracao e total_value 0/negativo/>2 casas", () => {
  assertThrows(() => validateMixedPurchaseItem({ ...MIXED_ACC_ITEM, quantity: 0 }, 0));
  assertThrows(() => validateMixedPurchaseItem({ ...MIXED_ACC_ITEM, quantity: 1.5 }, 0));
  assertThrows(() => validateMixedPurchaseItem({ ...MIXED_ACC_ITEM, total_value: 0 }, 0));
  assertThrows(() => validateMixedPurchaseItem({ ...MIXED_ACC_ITEM, total_value: -5 }, 0));
  assertThrows(() => validateMixedPurchaseItem({ ...MIXED_ACC_ITEM, total_value: 10.999 }, 0));
});

Deno.test("validateMixedPurchaseItem NUNCA aceita campos calculados no item", () => {
  const calc = [
    "unit_cost",
    "freight_allocated",
    "landed_total_value",
    "balance_before",
    "balance_after",
    "unit_cost_before",
    "unit_cost_after",
    "spool_ids",
    "line_number",
  ];
  for (const k of calc) {
    assertThrows(() => validateMixedPurchaseItem({ ...MIXED_ACC_ITEM, [k]: 1 }, 0));
  }
});

Deno.test("validateRegisterMixedPurchasePayload aceita um payload misto valido (3 categorias) e preserva a ordem", () => {
  const ok = validateRegisterMixedPurchasePayload(mixedBody());
  const items = ok.p_items as Array<{ category: string }>;
  assertEquals(items.length, 3);
  assertEquals([items[0].category, items[1].category, items[2].category], ["FILAMENT", "ACCESSORY", "PACKAGING"]);
  assertEquals(ok.p_freight_value, 10);
  assertEquals(ok.p_purchase_channel, "MERCADO_LIVRE");
  assertEquals(ok.p_occurred_on, "2026-09-06");
  assertEquals(ok.p_supplier_name, null);
});

Deno.test("validateRegisterMixedPurchasePayload aceita cada categoria isoladamente", () => {
  assertEquals(
    (validateRegisterMixedPurchasePayload(mixedBody({ items: [{ ...MIXED_FIL_ITEM }] })).p_items as unknown[]).length,
    1,
  );
  assertEquals(
    (validateRegisterMixedPurchasePayload(mixedBody({ items: [{ ...MIXED_ACC_ITEM }] })).p_items as unknown[]).length,
    1,
  );
  assertEquals(
    (validateRegisterMixedPurchasePayload(mixedBody({ items: [{ ...MIXED_PKG_ITEM }] })).p_items as unknown[]).length,
    1,
  );
});

Deno.test("validateRegisterMixedPurchasePayload aplica freight_value=0 quando omitido; rejeita negativo/>2 casas", () => {
  assertEquals(validateRegisterMixedPurchasePayload(mixedBody({ freight_value: undefined })).p_freight_value, 0);
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ freight_value: -1 })));
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ freight_value: 1.005 })));
});

Deno.test("validateRegisterMixedPurchasePayload: OUTRO_SITE exige nome do site; PRESENCIAL exige nome da loja", () => {
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ purchase_channel: "OUTRO_SITE" })));
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ purchase_channel: "PRESENCIAL" })));
  assertEquals(
    validateRegisterMixedPurchasePayload(mixedBody({ purchase_channel: "OUTRO_SITE", supplier_name: "loja.com" }))
      .p_supplier_name,
    "loja.com",
  );
  assertEquals(
    validateRegisterMixedPurchasePayload(mixedBody({ purchase_channel: "PRESENCIAL", supplier_name: "  Loja do Ze  " }))
      .p_supplier_name,
    "Loja do Ze",
  );
});

Deno.test("validateRegisterMixedPurchasePayload: canal padronizado IGNORA o complemento (supplier_name -> null)", () => {
  assertEquals(
    validateRegisterMixedPurchasePayload(mixedBody({ purchase_channel: "SHOPEE", supplier_name: "nao usar" }))
      .p_supplier_name,
    null,
  );
});

Deno.test("validateRegisterMixedPurchasePayload exige occurred_on YYYY-MM-DD valido (nunca occurred_at)", () => {
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ occurred_on: "06/09/2026" })));
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ occurred_on: undefined })));
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ occurred_at: "2026-09-06T00:00:00Z" })));
});

Deno.test("validateRegisterMixedPurchasePayload rejeita items vazio / nao-array / > 50", () => {
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ items: [] })));
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ items: "x" })));
  assertThrows(() =>
    validateRegisterMixedPurchasePayload(mixedBody({ items: Array.from({ length: 51 }, () => ({ ...MIXED_ACC_ITEM })) }))
  );
});

Deno.test("validateRegisterMixedPurchasePayload rejeita accessory_id / packaging_id duplicados; filament_type_id pode repetir", () => {
  assertThrows(() =>
    validateRegisterMixedPurchasePayload(mixedBody({ items: [{ ...MIXED_ACC_ITEM }, { ...MIXED_ACC_ITEM }] }))
  );
  assertThrows(() =>
    validateRegisterMixedPurchasePayload(mixedBody({ items: [{ ...MIXED_PKG_ITEM }, { ...MIXED_PKG_ITEM }] }))
  );
  const ok = validateRegisterMixedPurchasePayload(
    mixedBody({
      items: [
        { ...MIXED_FIL_ITEM, manufacturer: "Voolt", nominal_weight_grams: 1000 },
        { ...MIXED_FIL_ITEM, manufacturer: "Bambu Lab", nominal_weight_grams: 500 },
      ],
    }),
  );
  assertEquals((ok.p_items as unknown[]).length, 2);
});

Deno.test("validateRegisterMixedPurchasePayload rejeita chave desconhecida no corpo (notes, category, freight_allocated)", () => {
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ notes: "x" })));
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ category: "MIXED" })));
  assertThrows(() => validateRegisterMixedPurchasePayload(mixedBody({ freight_allocated: 1 })));
});

Deno.test("handleRequest responde preflight CORS (OPTIONS) em /inventory-purchases/mixed", async () => {
  const res = await handleRequest(
    new Request("https://x/inventory-purchases/mixed", {
      method: "OPTIONS",
      headers: { origin: "https://app", "access-control-request-method": "POST" },
    }),
  );
  assertEquals(res.status === 204 || res.status === 200, true);
});

Deno.test("handleRequest rejeita POST em /inventory-purchases/mixed sem Authorization com 401 (sem tocar rede)", async () => {
  const res = await handleRequest(makeRequest("POST", "/mixed", mixedBody()));
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 405 para GET em /inventory-purchases/mixed (sem exigir autenticacao)", () =>
  handleRequest(makeRequest("GET", "/mixed")).then((res) => assertEquals(res.status, 405)));

Deno.test("handleRequest devolve 404 para sub-rota de /inventory-purchases/mixed", async () => {
  const res = await handleRequest(makeRequest("GET", "/mixed/algum-id"));
  assertEquals(res.status, 404);
});

Deno.test("handleRequest preserva /, /filament e /accessory apos adicionar /mixed", async () => {
  assertEquals(
    (await handleRequest(
      makeRequest("POST", "", { category: "PACKAGING", quantity: 1, item_value: 1, item_id: VALID_UUID }),
    )).status,
    401,
  );
  assertEquals((await handleRequest(makeRequest("POST", "/filament", { items: [VALID_ITEM] }))).status, 401);
  assertEquals((await handleRequest(makeRequest("POST", "/accessory", { items: [VALID_ACCESSORY_ITEM] }))).status, 401);
});
