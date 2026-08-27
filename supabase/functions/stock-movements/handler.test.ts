// Testes locais da Edge Function `stock-movements` — mesmo padrão de
// supabase/functions/accessories/handler.test.ts e packaging/handler.test.ts
// (sem dependência externa de framework de asserção, só `Deno.test`).
//
// Importa exclusivamente de handler.ts (nunca de index.ts) — handler.ts não
// tem nenhum efeito colateral de módulo (nenhum Deno.serve), então importá-lo
// aqui nunca abre um listener HTTP nem faz rede por conta própria.
//
// Escopo coberto sem rede/banco (executável offline):
//   - validadores puros (requireStockItemType/requireStockMovementType/
//     requirePositiveIntegerQuantity/optionalNonEmptyString/
//     optionalTimestamp/rejectUnknownKeys/requireUuid/
//     validateRegisterStockMovementPayload);
//   - handleRequest: preflight CORS, 401 sem Authorization, 404 rota
//     desconhecida, 405 método não permitido, resposta de erro sem
//     detalhes internos.
//
// Por que "saldo insuficiente", "INITIAL_BALANCE repetido/exige saldo
// zero", "item inexistente" e "usuário inativo" NÃO são testados via
// handleRequest ponta a ponta: são regras que dependem de ler o banco
// (register_stock_movement, migration 20260827090000) — exigem uma sessão
// autenticada real (rede) e um Postgres real, que este arquivo não pode
// exercitar sem Supabase local rodando. Mesmo critério já documentado em
// accessories/handler.test.ts: a integração completa dessas regras já está
// coberta por supabase/tests/inventory_movements_test.sql (executado e
// aprovado contra o banco remoto real — 40 PASS/1 SKIP/0 FAIL, ver
// docs/05_ROADMAP_MODULOS.md). Aqui testamos só a validação estrutural pura
// que handleRegisterStockMovement usa antes de sequer chamar a RPC.
//
// LIMITAÇÃO DE AMBIENTE (mesma já registrada em todas as rodadas
// anteriores): o runtime `deno` não está instalado nesta máquina/sessão —
// este arquivo não pôde ser executado. Escrito seguindo a mesma disciplina
// já usada no projeto; precisa de uma primeira execução real
// (`deno test supabase/functions/stock-movements/`) antes de confiar
// cegamente nele.

import { ValidationError } from "../_shared/errors.ts";
import { isUuid } from "../_shared/validate.ts";
import {
  handleRequest,
  optionalNonEmptyString,
  optionalTimestamp,
  rejectUnknownKeys,
  requirePositiveIntegerQuantity,
  requireStockItemType,
  requireStockMovementType,
  requireUuid,
  validateRegisterStockMovementPayload,
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
// requireUuid / requireStockItemType / requireStockMovementType
// ---------------------------------------------------------------------------

Deno.test("requireUuid aceita um UUID v4 bem formado", () => {
  assertEquals(requireUuid(VALID_UUID, "item_id"), VALID_UUID);
});

Deno.test("requireUuid rejeita valor que não é UUID", () => {
  assertThrows(() => requireUuid("nao-e-um-uuid", "item_id"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
  assertThrows(() => requireUuid(undefined, "item_id"));
});

Deno.test("requireStockItemType aceita ACCESSORY e PACKAGING", () => {
  assertEquals(requireStockItemType("ACCESSORY"), "ACCESSORY");
  assertEquals(requireStockItemType("PACKAGING"), "PACKAGING");
});

Deno.test("requireStockItemType rejeita valor fora do enum (ex.: FILAMENT_SPOOL, ainda não suportado)", () => {
  assertThrows(() => requireStockItemType("FILAMENT_SPOOL"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

Deno.test("requireStockMovementType aceita as 8 movement_type manuais desta etapa", () => {
  for (const type of [
    "INITIAL_BALANCE",
    "PURCHASE",
    "RETURN",
    "POSITIVE_ADJUSTMENT",
    "LOSS",
    "SAMPLE_DONATION",
    "INTERNAL_USE",
    "NEGATIVE_ADJUSTMENT",
  ]) {
    assertEquals(requireStockMovementType(type), type);
  }
});

Deno.test("requireStockMovementType rejeita valor fora do enum (ex.: RESERVATION, ainda não suportado)", () => {
  assertThrows(() => requireStockMovementType("RESERVATION"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

// ---------------------------------------------------------------------------
// requirePositiveIntegerQuantity
// ---------------------------------------------------------------------------

Deno.test("requirePositiveIntegerQuantity aceita inteiro positivo", () => {
  assertEquals(requirePositiveIntegerQuantity(5), 5);
  assertEquals(requirePositiveIntegerQuantity(1), 1);
});

Deno.test("requirePositiveIntegerQuantity rejeita zero", () => {
  assertThrows(() => requirePositiveIntegerQuantity(0), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

Deno.test("requirePositiveIntegerQuantity rejeita negativo", () => {
  assertThrows(() => requirePositiveIntegerQuantity(-3));
});

Deno.test("requirePositiveIntegerQuantity rejeita fração", () => {
  assertThrows(() => requirePositiveIntegerQuantity(1.5), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
  assertThrows(() => requirePositiveIntegerQuantity(2.25));
});

Deno.test("requirePositiveIntegerQuantity rejeita valor não numérico", () => {
  assertThrows(() => requirePositiveIntegerQuantity("5"));
  assertThrows(() => requirePositiveIntegerQuantity(null));
  assertThrows(() => requirePositiveIntegerQuantity(undefined));
});

// ---------------------------------------------------------------------------
// optionalNonEmptyString / optionalTimestamp
// ---------------------------------------------------------------------------

Deno.test("optionalNonEmptyString normaliza string vazia/só espaços para null", () => {
  assertEquals(optionalNonEmptyString("", "reason"), null);
  assertEquals(optionalNonEmptyString("   ", "reason"), null);
});

Deno.test("optionalNonEmptyString preserva null/undefined como null", () => {
  assertEquals(optionalNonEmptyString(null, "reason"), null);
  assertEquals(optionalNonEmptyString(undefined, "reason"), null);
});

Deno.test("optionalNonEmptyString trima texto não vazio", () => {
  assertEquals(optionalNonEmptyString("  peça quebrada  ", "reason"), "peça quebrada");
});

Deno.test("optionalTimestamp aceita null/undefined", () => {
  assertEquals(optionalTimestamp(null, "occurred_at"), null);
  assertEquals(optionalTimestamp(undefined, "occurred_at"), null);
});

Deno.test("optionalTimestamp aceita ISO 8601 válido", () => {
  assertEquals(optionalTimestamp("2026-08-27T12:00:00Z", "occurred_at"), "2026-08-27T12:00:00Z");
});

Deno.test("optionalTimestamp rejeita string que não é data válida", () => {
  assertThrows(() => optionalTimestamp("não é uma data", "occurred_at"), (err) => {
    if (!isValidationError(err)) throw new Error("esperado ValidationError");
  });
});

// ---------------------------------------------------------------------------
// validateRegisterStockMovementPayload
// ---------------------------------------------------------------------------

Deno.test("validateRegisterStockMovementPayload aceita payload mínimo válido (entrada sem motivo)", () => {
  const result = validateRegisterStockMovementPayload({
    item_type: "ACCESSORY",
    item_id: VALID_UUID,
    movement_type: "PURCHASE",
    quantity: 10,
  });
  assertEquals(result, {
    p_item_type: "ACCESSORY",
    p_item_id: VALID_UUID,
    p_movement_type: "PURCHASE",
    p_quantity: 10,
    p_reason: null,
    p_occurred_at: null,
    p_reference_type: null,
    p_reference_id: null,
    p_idempotency_key: null,
  });
});

Deno.test("validateRegisterStockMovementPayload preserva idempotency_key exatamente como enviada", () => {
  const result = validateRegisterStockMovementPayload({
    item_type: "ACCESSORY",
    item_id: VALID_UUID,
    movement_type: "PURCHASE",
    quantity: 10,
    idempotency_key: "11111111-1111-1111-1111-111111111111",
  });
  assertEquals(result.p_idempotency_key, "11111111-1111-1111-1111-111111111111");
});

Deno.test("validateRegisterStockMovementPayload rejeita item_type ausente", () => {
  assertThrows(() =>
    validateRegisterStockMovementPayload({ item_id: VALID_UUID, movement_type: "PURCHASE", quantity: 1 }),
  );
});

Deno.test("validateRegisterStockMovementPayload rejeita item_id ausente/inválido", () => {
  assertThrows(() =>
    validateRegisterStockMovementPayload({ item_type: "ACCESSORY", movement_type: "PURCHASE", quantity: 1 }),
  );
  assertThrows(() =>
    validateRegisterStockMovementPayload({
      item_type: "ACCESSORY",
      item_id: "nao-e-uuid",
      movement_type: "PURCHASE",
      quantity: 1,
    }),
  );
});

Deno.test("validateRegisterStockMovementPayload rejeita quantity zero", () => {
  assertThrows(() =>
    validateRegisterStockMovementPayload({
      item_type: "ACCESSORY",
      item_id: VALID_UUID,
      movement_type: "PURCHASE",
      quantity: 0,
    }),
  );
});

Deno.test("validateRegisterStockMovementPayload rejeita quantity fracionada", () => {
  assertThrows(() =>
    validateRegisterStockMovementPayload({
      item_type: "ACCESSORY",
      item_id: VALID_UUID,
      movement_type: "PURCHASE",
      quantity: 1.5,
    }),
  );
});

Deno.test("validateRegisterStockMovementPayload exige reason para LOSS/SAMPLE_DONATION/INTERNAL_USE/POSITIVE_ADJUSTMENT/NEGATIVE_ADJUSTMENT", () => {
  for (const movementType of ["LOSS", "SAMPLE_DONATION", "INTERNAL_USE", "POSITIVE_ADJUSTMENT", "NEGATIVE_ADJUSTMENT"]) {
    assertThrows(
      () =>
        validateRegisterStockMovementPayload({
          item_type: "ACCESSORY",
          item_id: VALID_UUID,
          movement_type: movementType,
          quantity: 1,
        }),
      (err) => {
        if (!isValidationError(err)) throw new Error(`esperado ValidationError para ${movementType}`);
      },
    );
  }
});

Deno.test("validateRegisterStockMovementPayload aceita PURCHASE/RETURN/INITIAL_BALANCE sem reason", () => {
  for (const movementType of ["PURCHASE", "RETURN", "INITIAL_BALANCE"]) {
    const result = validateRegisterStockMovementPayload({
      item_type: "ACCESSORY",
      item_id: VALID_UUID,
      movement_type: movementType,
      quantity: 1,
    });
    assertEquals(result.p_reason, null);
  }
});

Deno.test("validateRegisterStockMovementPayload rejeita movement_type fora do enum (RESERVATION, ainda não suportado)", () => {
  assertThrows(() =>
    validateRegisterStockMovementPayload({
      item_type: "ACCESSORY",
      item_id: VALID_UUID,
      movement_type: "RESERVATION",
      quantity: 1,
    }),
  );
});

Deno.test("validateRegisterStockMovementPayload rejeita campo desconhecido", () => {
  assertThrows(() =>
    validateRegisterStockMovementPayload({
      item_type: "ACCESSORY",
      item_id: VALID_UUID,
      movement_type: "PURCHASE",
      quantity: 1,
      supplier: "fornecedor X",
    }),
  );
});

Deno.test("rejectUnknownKeys aceita só chaves permitidas", () => {
  rejectUnknownKeys({ a: 1 }, ["a", "b"], "teste");
});

Deno.test("rejectUnknownKeys rejeita chave fora da lista", () => {
  assertThrows(() => rejectUnknownKeys({ a: 1, c: 2 }, ["a", "b"], "teste"));
});

// ---------------------------------------------------------------------------
// isUuid — mesma checagem de formato usada por requireUuid/optionalUuid
// ---------------------------------------------------------------------------

Deno.test("isUuid aceita um UUID v4 bem formado", () => {
  assertEquals(isUuid(VALID_UUID), true);
});

Deno.test("isUuid rejeita string que não é UUID", () => {
  assertEquals(isUuid("nao-e-um-uuid"), false);
});

// ---------------------------------------------------------------------------
// handleRequest — só os caminhos que não exigem rede/banco reais
// ---------------------------------------------------------------------------

function makeRequest(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  return new Request(`https://example.supabase.co/functions/v1/stock-movements${path}`, {
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
  const res = await handleRequest(
    makeRequest("POST", "", { item_type: "ACCESSORY", item_id: VALID_UUID, movement_type: "PURCHASE", quantity: 1 }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 405 para método não permitido em /stock-movements (sem exigir autenticação)", async () => {
  const res = await handleRequest(makeRequest("GET", ""));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest devolve 405 para PATCH em /stock-movements (não existe rota de edição — histórico é imutável)", async () => {
  const res = await handleRequest(makeRequest("PATCH", ""));
  assertEquals(res.status, 405);
});

Deno.test("handleRequest devolve 405 para DELETE em /stock-movements (não existe rota de exclusão — histórico é imutável)", async () => {
  const res = await handleRequest(makeRequest("DELETE", ""));
  assertEquals(res.status, 405);
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
