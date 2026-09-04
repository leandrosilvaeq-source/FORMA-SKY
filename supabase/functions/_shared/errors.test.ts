// Testes locais de _shared/errors.ts — cobre os mapeamentos de Acessórios
// (Incremento 2) e Embalagens (Incremento 3: marcador estável
// PACKAGING_IN_USE: -> 409), mais regressões cruzadas para confirmar que
// nenhum dos dois módulos interferiu no mapeamento do outro nem nos padrões
// mais antigos (Pedidos/Produtos). Sem dependências externas de framework
// de asserção (mesmo critério de handler.test.ts) — só o runner nativo
// `Deno.test`.

import { BusinessRuleError, NotFoundError, ValidationError, mapPgError } from "./errors.ts";

function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
  }
}

Deno.test("mapPgError mapeia ACCESSORY_IN_USE: para BusinessRuleError (409) e remove o marcador da mensagem", () => {
  const err = mapPgError({
    code: "P0001",
    message: "ACCESSORY_IN_USE: Este acessório está vinculado a um produto e não pode ser excluído. Desative o item.",
  });

  if (!(err instanceof BusinessRuleError)) {
    throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 409);
  assertEquals(err.type, "business_rule");
  assertEquals(err.message, "Este acessório está vinculado a um produto e não pode ser excluído. Desative o item.");
  // O marcador nunca deve sobrar na mensagem exibida ao usuário.
  assertEquals(err.message.includes("ACCESSORY_IN_USE"), false);
});

Deno.test("mapPgError mapeia accessories.size inválido para ValidationError (400), não business_rule", () => {
  const err = mapPgError({
    code: "P0001",
    message: "accessories.size inválido: XG (esperado PP, P, M, G, GG ou null)",
  });

  if (!(err instanceof ValidationError)) {
    throw new Error(`esperado ValidationError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 400);
});

Deno.test("mapPgError mapeia accessories.name não pode ser vazio para ValidationError (400)", () => {
  const err = mapPgError({ code: "P0001", message: "accessories.name não pode ser vazio nem null" });
  if (!(err instanceof ValidationError)) {
    throw new Error(`esperado ValidationError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 400);
});

Deno.test("mapPgError mapeia chave não suportada em update_accessory para ValidationError (400)", () => {
  const err = mapPgError({
    code: "P0001",
    message: "update_accessory: chave(s) não suportada(s) em p_patch: material",
  });
  if (!(err instanceof ValidationError)) {
    throw new Error(`esperado ValidationError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 400);
});

Deno.test("mapPgError mapeia p_patch vazio em update_accessory para ValidationError (400)", () => {
  const err = mapPgError({ code: "P0001", message: "update_accessory: p_patch vazio, informe ao menos um campo reconhecido" });
  if (!(err instanceof ValidationError)) {
    throw new Error(`esperado ValidationError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 400);
});

// Regressão: "accessories.id % não encontrado" (create_accessory/
// update_accessory/delete_accessory) continua batendo no padrão genérico
// "não encontrado" — confirma que a nova entrada não alterou a ordem de
// casamento dos padrões já existentes.
Deno.test("mapPgError mantém accessories.id não encontrado como NotFoundError (404) — regressão", () => {
  const err = mapPgError({
    code: "P0001",
    message: "accessories.id 123e4567-e89b-42d3-a456-426614174000 não encontrado",
  });
  if (!(err instanceof NotFoundError)) {
    throw new Error(`esperado NotFoundError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 404);
});

// Regressão: um SQLSTATE real (não P0001) continua indo direto pelo
// SQLSTATE_MAP, sem passar pelos padrões de texto — não afetado por esta
// rodada.
Deno.test("mapPgError mantém 23514 (check_violation) como ValidationError (400) — regressão", () => {
  const err = mapPgError({ code: "23514", message: "new row for relation \"accessories\" violates check constraint" });
  if (!(err instanceof ValidationError)) {
    throw new Error(`esperado ValidationError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 400);
});

// ---------------------------------------------------------------------------
// Embalagens (Incremento 3, Migration 20260823120000) — mesmo conjunto de
// mapeamentos de Acessórios, espelhado com o marcador PACKAGING_IN_USE:.
// ---------------------------------------------------------------------------

Deno.test("mapPgError mapeia PACKAGING_IN_USE: para BusinessRuleError (409) e remove o marcador da mensagem", () => {
  const err = mapPgError({
    code: "P0001",
    message: "PACKAGING_IN_USE: Esta embalagem está vinculada a um produto e não pode ser excluída. Desative o item.",
  });

  if (!(err instanceof BusinessRuleError)) {
    throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 409);
  assertEquals(err.type, "business_rule");
  assertEquals(err.message, "Esta embalagem está vinculada a um produto e não pode ser excluída. Desative o item.");
  assertEquals(err.message.includes("PACKAGING_IN_USE"), false);
});

Deno.test("mapPgError mapeia packaging.size inválido para ValidationError (400), não business_rule", () => {
  const err = mapPgError({
    code: "P0001",
    message: "packaging.size inválido: XG (esperado PP, P, M, G, GG ou null)",
  });
  if (!(err instanceof ValidationError)) {
    throw new Error(`esperado ValidationError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 400);
});

Deno.test("mapPgError mapeia packaging.name não pode ser vazio para ValidationError (400)", () => {
  const err = mapPgError({ code: "P0001", message: "packaging.name não pode ser vazio nem null" });
  if (!(err instanceof ValidationError)) {
    throw new Error(`esperado ValidationError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 400);
});

Deno.test("mapPgError mapeia chave não suportada em update_packaging para ValidationError (400)", () => {
  const err = mapPgError({
    code: "P0001",
    message: "update_packaging: chave(s) não suportada(s) em p_patch: material",
  });
  if (!(err instanceof ValidationError)) {
    throw new Error(`esperado ValidationError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 400);
});

Deno.test("mapPgError mapeia p_patch vazio em update_packaging para ValidationError (400)", () => {
  const err = mapPgError({ code: "P0001", message: "update_packaging: p_patch vazio, informe ao menos um campo reconhecido" });
  if (!(err instanceof ValidationError)) {
    throw new Error(`esperado ValidationError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 400);
});

Deno.test("mapPgError mantém packaging.id não encontrado como NotFoundError (404) — regressão", () => {
  const err = mapPgError({
    code: "P0001",
    message: "packaging.id 123e4567-e89b-42d3-a456-426614174000 não encontrado",
  });
  if (!(err instanceof NotFoundError)) {
    throw new Error(`esperado NotFoundError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 404);
});

// Regressão cruzada: o marcador ACCESSORY_IN_USE: (Incremento 2) continua
// mapeando para BusinessRuleError normalmente — confirma que adicionar
// PACKAGING_IN_USE: não alterou o padrão irmão nem a ordem de casamento.
Deno.test("mapPgError mantém ACCESSORY_IN_USE: funcionando após a adição de PACKAGING_IN_USE: — regressão cruzada", () => {
  const err = mapPgError({
    code: "P0001",
    message: "ACCESSORY_IN_USE: Este acessório está vinculado a um produto e não pode ser excluído. Desative o item.",
  });
  if (!(err instanceof BusinessRuleError)) {
    throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 409);
  assertEquals(err.message.includes("ACCESSORY_IN_USE"), false);
  assertEquals(err.message.includes("PACKAGING_IN_USE"), false);
});

// Regressão cruzada inversa: uma mensagem de accessories nunca deve casar
// com um padrão de packaging (e vice-versa) — os dois marcadores/prefixos
// são strings totalmente distintas, sem sobreposição de substring.
Deno.test("mapPgError não confunde accessories.size inválido com packaging.size inválido — regressão cruzada", () => {
  const accessoriesErr = mapPgError({ code: "P0001", message: "accessories.size inválido: XG (esperado PP, P, M, G, GG ou null)" });
  const packagingErr = mapPgError({ code: "P0001", message: "packaging.size inválido: XG (esperado PP, P, M, G, GG ou null)" });
  assertEquals(accessoriesErr instanceof ValidationError, true);
  assertEquals(packagingErr instanceof ValidationError, true);
  assertEquals(accessoriesErr.message.includes("accessories"), true);
  assertEquals(packagingErr.message.includes("packaging"), true);
});

// ---------------------------------------------------------------------------
// Módulo 3, Incremento 1/2 — register_stock_movement / delete_accessory /
// delete_packaging (migrations 20260827090000/20260827093000)
// ---------------------------------------------------------------------------

Deno.test("mapPgError mapeia STOCK_INSUFFICIENT_BALANCE: para BusinessRuleError (409) e remove o marcador", () => {
  const err = mapPgError({
    code: "P0001",
    message: "STOCK_INSUFFICIENT_BALANCE: saldo insuficiente para INTERNAL_USE em ACCESSORY id — saldo atual: 4, quantidade solicitada: 6",
  });
  if (!(err instanceof BusinessRuleError)) throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  assertEquals(err.status, 409);
  assertEquals(err.message.includes("STOCK_INSUFFICIENT_BALANCE"), false);
  assertEquals(err.message.includes("saldo insuficiente"), true);
});

Deno.test("mapPgError mapeia INITIAL_BALANCE_ALREADY_EXISTS: para BusinessRuleError (409) e remove o marcador", () => {
  const err = mapPgError({
    code: "P0001",
    message: "INITIAL_BALANCE_ALREADY_EXISTS: INITIAL_BALANCE só pode ser a primeira movimentação do item",
  });
  if (!(err instanceof BusinessRuleError)) throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  assertEquals(err.status, 409);
  assertEquals(err.message.includes("INITIAL_BALANCE_ALREADY_EXISTS"), false);
});

Deno.test("mapPgError mapeia INITIAL_BALANCE_REQUIRES_ZERO: para BusinessRuleError (409) e remove o marcador", () => {
  const err = mapPgError({
    code: "P0001",
    message: "INITIAL_BALANCE_REQUIRES_ZERO: INITIAL_BALANCE exige saldo atual igual a zero (saldo atual: 4)",
  });
  if (!(err instanceof BusinessRuleError)) throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  assertEquals(err.status, 409);
  assertEquals(err.message.includes("INITIAL_BALANCE_REQUIRES_ZERO"), false);
});

Deno.test("mapPgError mapeia IDEMPOTENCY_KEY_CONFLICT: para BusinessRuleError (409) e remove o marcador", () => {
  const err = mapPgError({
    code: "P0001",
    message: "IDEMPOTENCY_KEY_CONFLICT: idempotency_key abc já foi usada com um payload diferente",
  });
  if (!(err instanceof BusinessRuleError)) throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  assertEquals(err.status, 409);
  assertEquals(err.message.includes("IDEMPOTENCY_KEY_CONFLICT"), false);
});

Deno.test("mapPgError mapeia ACCESSORY_HAS_STOCK_HISTORY: para BusinessRuleError (409) e remove o marcador", () => {
  const err = mapPgError({
    code: "P0001",
    message: "ACCESSORY_HAS_STOCK_HISTORY: Este acessório já teve movimentação de estoque registrada e não pode ser excluído. Desative o item.",
  });
  if (!(err instanceof BusinessRuleError)) throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  assertEquals(err.status, 409);
  assertEquals(err.message.includes("ACCESSORY_HAS_STOCK_HISTORY"), false);
  // Nunca confundido com o marcador de vínculo por composição — string
  // distinta, sem sobreposição de substring.
  assertEquals(err.message.includes("ACCESSORY_IN_USE"), false);
});

Deno.test("mapPgError mapeia PACKAGING_HAS_STOCK_HISTORY: para BusinessRuleError (409) e remove o marcador", () => {
  const err = mapPgError({
    code: "P0001",
    message: "PACKAGING_HAS_STOCK_HISTORY: Esta embalagem já teve movimentação de estoque registrada e não pode ser excluída. Desative o item.",
  });
  if (!(err instanceof BusinessRuleError)) throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  assertEquals(err.status, 409);
  assertEquals(err.message.includes("PACKAGING_HAS_STOCK_HISTORY"), false);
});

Deno.test("mapPgError mapeia stock_movements.item_type inválido para ValidationError (400), não business_rule", () => {
  const err = mapPgError({ code: "P0001", message: "stock_movements.item_type inválido: FILAMENT_SPOOL (esperado ACCESSORY ou PACKAGING)" });
  assertEquals(err instanceof ValidationError, true);
  assertEquals(err.status, 400);
});

Deno.test("mapPgError mapeia stock_movements.movement_type inválido para ValidationError (400)", () => {
  const err = mapPgError({ code: "P0001", message: "stock_movements.movement_type inválido: RESERVATION" });
  assertEquals(err instanceof ValidationError, true);
  assertEquals(err.status, 400);
});

Deno.test("mapPgError mapeia as duas mensagens de p_quantity para ValidationError (400)", () => {
  const zero = mapPgError({ code: "P0001", message: "register_stock_movement: p_quantity deve ser um inteiro positivo (recebido 0)" });
  const fraction = mapPgError({ code: "P0001", message: "register_stock_movement: p_quantity deve ser um número inteiro, sem casas decimais (recebido 1.5)" });
  assertEquals(zero instanceof ValidationError, true);
  assertEquals(fraction instanceof ValidationError, true);
});

Deno.test("mapPgError mapeia motivo obrigatório para ValidationError (400)", () => {
  const err = mapPgError({ code: "P0001", message: "register_stock_movement: motivo obrigatório para movement_type LOSS" });
  assertEquals(err instanceof ValidationError, true);
  assertEquals(err.status, 400);
});

Deno.test("mapPgError mantém accessories.id não encontrado e ACCESSORY_IN_USE: funcionando após a adição dos padrões do Módulo 3 — regressão cruzada", () => {
  const notFound = mapPgError({ code: "P0001", message: "accessories.id 123 não encontrado" });
  const inUse = mapPgError({
    code: "P0001",
    message: "ACCESSORY_IN_USE: Este acessório está vinculado a um produto e não pode ser excluído. Desative o item.",
  });
  assertEquals(notFound instanceof NotFoundError, true);
  assertEquals(inUse instanceof BusinessRuleError, true);
  assertEquals(inUse.message.includes("ACCESSORY_IN_USE"), false);
});

// -----------------------------------------------------------------------------
// remove_filament_type (migration 20260903120000) — FILAMENT_TYPE_IN_ACTIVE_ORDER:
// -----------------------------------------------------------------------------

Deno.test("mapPgError mapeia FILAMENT_TYPE_IN_ACTIVE_ORDER: para BusinessRuleError (409) e remove o marcador da mensagem", () => {
  const err = mapPgError({
    code: "P0001",
    message:
      "FILAMENT_TYPE_IN_ACTIVE_ORDER: Este tipo de filamento está sendo utilizado por pedido(s) ativo(s) e não pode ser removido. Pedido(s): FS-26-010, FS-26-011.",
  });
  if (!(err instanceof BusinessRuleError)) {
    throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 409);
  assertEquals(err.message.includes("FILAMENT_TYPE_IN_ACTIVE_ORDER"), false);
  assertEquals(
    err.message.startsWith("Este tipo de filamento está sendo utilizado por pedido(s) ativo(s)"),
    true,
  );
  // O número do pedido continua na mensagem exibida (sem UUID).
  assertEquals(err.message.includes("FS-26-010"), true);
});

// -----------------------------------------------------------------------------
// remove_filament_type (migration 20260903130000, rodada corretiva) —
// FILAMENT_TYPE_REMOVAL_PLAN_CHANGED:
// -----------------------------------------------------------------------------

Deno.test("mapPgError mapeia FILAMENT_TYPE_REMOVAL_PLAN_CHANGED: para BusinessRuleError (409) e remove o marcador da mensagem", () => {
  const err = mapPgError({
    code: "P0001",
    message:
      "FILAMENT_TYPE_REMOVAL_PLAN_CHANGED: O plano de remoção mudou desde a conferência (agora: ARCHIVED). Recarregue as informações e confirme novamente.",
  });
  if (!(err instanceof BusinessRuleError)) {
    throw new Error(`esperado BusinessRuleError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 409);
  assertEquals(err.message.includes("FILAMENT_TYPE_REMOVAL_PLAN_CHANGED"), false);
  // O fragmento estável que o frontend usa (isRemovalPlanChangedError) fica.
  assertEquals(err.message.toLowerCase().includes("plano de remoção mudou"), true);
});

Deno.test("mapPgError não confunde FILAMENT_TYPE_REMOVAL_PLAN_CHANGED: com FILAMENT_TYPE_IN_ACTIVE_ORDER: — regressão cruzada", () => {
  const planChanged = mapPgError({
    code: "P0001",
    message: "FILAMENT_TYPE_REMOVAL_PLAN_CHANGED: O plano de remoção mudou desde a conferência (agora: BLOCKED_ACTIVE_ORDER). Recarregue as informações e confirme novamente.",
  });
  const activeOrder = mapPgError({
    code: "P0001",
    message: "FILAMENT_TYPE_IN_ACTIVE_ORDER: Este tipo de filamento está sendo utilizado por pedido(s) ativo(s) e não pode ser removido. Pedido(s): FS-26-010.",
  });
  assertEquals(planChanged instanceof BusinessRuleError, true);
  assertEquals(activeOrder instanceof BusinessRuleError, true);
  assertEquals(planChanged.message.toLowerCase().includes("plano de remoção mudou"), true);
  assertEquals(activeOrder.message.toLowerCase().includes("plano de remoção mudou"), false);
});

Deno.test("mapPgError mantém FILAMENT_TYPE_HAS_SPOOLS:/HAS_COMPOSITION: mapeados (regressão — bancos ainda não migrados)", () => {
  const spools = mapPgError({
    code: "P0001",
    message: "FILAMENT_TYPE_HAS_SPOOLS: Este tipo de filamento possui rolo(s) cadastrado(s) e não pode ser excluído. Desative o tipo.",
  });
  const composition = mapPgError({
    code: "P0001",
    message: "FILAMENT_TYPE_HAS_COMPOSITION: Este tipo de filamento está vinculado à composição de um produto e não pode ser excluído. Desative o tipo.",
  });
  assertEquals(spools instanceof BusinessRuleError, true);
  assertEquals(composition instanceof BusinessRuleError, true);
  assertEquals(spools.message.includes("FILAMENT_TYPE_HAS_SPOOLS"), false);
  assertEquals(composition.message.includes("FILAMENT_TYPE_HAS_COMPOSITION"), false);
});

// -----------------------------------------------------------------------------
// register_inventory_purchase (migration 20260904120000, revisão do fluxo de
// Filamentos) — filament_type_id + campo legado juntos
// -----------------------------------------------------------------------------

Deno.test("mapPgError mapeia 'informe p_filament_type_id OU...' para ValidationError (400), não business_rule", () => {
  const err = mapPgError({
    code: "P0001",
    message:
      "register_inventory_purchase: informe p_filament_type_id OU material/manufacturer/line/commercial_color, nunca os dois",
  });
  if (!(err instanceof ValidationError)) {
    throw new Error(`esperado ValidationError, obtido ${err.constructor.name}`);
  }
  assertEquals(err.status, 400);
});

Deno.test("mapPgError não confunde a mensagem de filament_type_id com 'informe exatamente' (pesos brutos) — regressão cruzada", () => {
  const filamentTypeIdMsg = mapPgError({
    code: "P0001",
    message: "register_inventory_purchase: informe p_filament_type_id OU material/manufacturer/line/commercial_color, nunca os dois",
  });
  const grossWeightsMsg = mapPgError({
    code: "P0001",
    message: "register_inventory_purchase: informe exatamente 2 peso(s) bruto(s) (um por rolo) — recebido 1",
  });
  assertEquals(filamentTypeIdMsg instanceof ValidationError, true);
  assertEquals(grossWeightsMsg instanceof ValidationError, true);
  assertEquals(filamentTypeIdMsg.message.includes("informe p_filament_type_id"), true);
  assertEquals(grossWeightsMsg.message.includes("informe exatamente"), true);
});
