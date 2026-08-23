// Testes locais de _shared/errors.ts — foco no mapeamento novo desta rodada
// (marcador estável ACCESSORY_IN_USE: -> 409) e num par de regressões dos
// padrões já existentes, para confirmar que a nova entrada não mudou a
// ordem/casamento de nenhum padrão anterior. Sem dependências externas de
// framework de asserção (mesmo critério de handler.test.ts) — só o runner
// nativo `Deno.test`.
//
// LIMITAÇÃO DE AMBIENTE: o runtime `deno` não está instalado nesta máquina/
// sessão — este arquivo não pôde ser executado nesta rodada (ver relatório).

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
