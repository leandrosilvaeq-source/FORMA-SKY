// Handler + validadores da Edge Function `orders` — sem nenhum efeito
// colateral de módulo (nenhum Deno.serve aqui), mesmo padrão de
// accessories/handler.ts, stock-movements/handler.ts, inventory-purchases/
// handler.ts e products/handler.ts (Incremento 6A). Extraído de index.ts
// nesta rodada (ajustes de Produtos/Clientes/Pedidos, 2026-08-29)
// especificamente para permitir testes locais sem abrir um listener HTTP
// real — mesmo motivo já documentado nos arquivos irmãos. Rotas/lógica de
// POST /orders, PUT /orders/:id e PUT /orders/:id/full são movidas aqui SEM
// NENHUMA alteração de comportamento (só de localização do código) —
// preservação explícita exigida para as três rotas já implementadas e
// validadas.
//
// Rotas:
//   POST   /orders               -> RPC create_order (11 parâmetros)
//   POST   /orders/with-payment  -> RPC create_order_with_payment (NOVA)
//   PUT    /orders/:id           -> RPC update_order
//   PUT    /orders/:id/full      -> RPC update_quote_order
//   DELETE /orders/:id           -> RPC delete_order (NOVA)
//
// orders NÃO possui nenhuma rota GET. Leituras do Bloco 1 ficam no
// frontend, diretamente via Supabase client autenticado (JWT do usuário) +
// RLS/security_invoker — decisão confirmada explicitamente, não pendente.
//
// PUT (não PATCH) em /orders/:id: update_order() (Migration 15, não tocada
// pela Migration 17) não tem semântica PATCH — os 12 parâmetros não têm
// nenhum DEFAULT no SQL e a função faz UPDATE incondicional de todas as
// colunas do cabeçalho, sem distinguir "campo não informado" de "campo
// explicitamente null" (diferente de update_order_item, que usa jsonb +
// jsonb_whitelist — essa semântica PATCH pertence a update_order_item, não
// a update_order). Por isso esta rota é PUT: substituição completa,
// nenhuma leitura do estado atual, nenhuma tentativa de merge. O corpo da
// requisição deve conter todas as 10 chaves do contrato (ver handler);
// ausência de qualquer uma delas é 400, mesmo que o valor pudesse ser null.
//
// create_order tem DUAS sobrecargas no banco (identidade de função em
// PostgreSQL inclui a lista de tipos dos parâmetros — uma função de 10
// parâmetros e uma de 11 são funções DISTINTAS, nunca a mesma função
// "estendida"): a de 10 parâmetros (Migration 17,
// supabase/migrations/20260814051143_create_initial_custom_version_fix.sql)
// é preservada intocada, sem EXECUTE para nada além de service_role, mas
// esta Edge Function NUNCA a chama. Esta Edge Function sempre chama a de
// 11 parâmetros (a única com p_payment_method), enviando os 11 parâmetros
// nomeados sempre, inclusive payment_method=null quando não informado —
// o PostgREST/supabase-js resolve overloads pelo CONJUNTO de nomes de
// parâmetro presentes na chamada; como só a sobrecarga de 11 parâmetros
// tem um parâmetro chamado p_payment_method, enviar esse nome já elimina
// a de 10 parâmetros das candidatas, sem nenhuma ambiguidade possível.
//
// POST /orders/with-payment (NOVA, 2026-08-29): rota DISTINTA de POST
// /orders — a alteração de "Forma de pagamento" (Adiantado/Sinal/Na
// entrega) foi pedida especificamente para "Novo Pedido"; POST /orders
// "puro" permanece intocado (create_order, sem payment_condition/pagamento
// inicial), preservando qualquer outro consumidor existente. Chama
// create_order_with_payment (20260829142000_add_order_payment_condition_and_atomic_creation.sql),
// que cria pedido + (condicionalmente) o pagamento inicial numa única
// transação — nunca duas chamadas HTTP separadas a partir do frontend.
// Nunca chamada pela edição de um pedido existente (PUT /orders/:id ou
// PUT /orders/:id/full) — a edição nunca recria o pagamento inicial,
// estruturalmente (rotas e RPCs diferentes).
//
// DELETE /orders/:id (NOVA, 2026-08-29): chama delete_order
// (20260829141000_add_order_deletion_function.sql) — exclusão física
// protegida (só QUOTE/CANCELLED, sem pagamento/aprovação/versão
// vinculados), nunca cascata ampla.

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import {
  isUuid,
  requireString,
  requireNumber,
  optionalString,
  optionalNumber,
  optionalInteger,
  optionalUuid,
  optionalBoolean,
  parseJsonBody,
  rejectIdentityFields,
} from "../_shared/validate.ts";

const ITEM_TYPES = ["CATALOG", "CUSTOM", "SPOT"] as const;
type ItemType = (typeof ITEM_TYPES)[number];

const SEARCH_TIME_STATUSES = ["NOT_INFORMED", "IN_PROGRESS", "RECORDED"] as const;

// orders.payment_method (Migration 7): nullable, mas quando informado deve
// ser um destes três valores.
const PAYMENT_METHODS = ["PIX", "DINHEIRO", "CARTAO"] as const;

// orders.payment_condition (20260829142000): Forma de pagamento escolhida
// na criação — só usada pela rota POST /orders/with-payment.
const PAYMENT_CONDITIONS = ["ADVANCE", "DEPOSIT", "ON_DELIVERY"] as const;
type PaymentCondition = (typeof PAYMENT_CONDITIONS)[number];

// vX.Y (ex.: v1.0, v1.1) — mesmo padrão exigido por
// custom_item_details.current_version (Migration 9).
const CUSTOM_VERSION_PATTERN = /^v[0-9]+\.[0-9]+$/;

export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("orders");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (req.method === "POST" && route.length === 1 && route[0] === "with-payment") {
      return await handleCreateOrderWithPayment(req);
    }

    if (req.method === "POST" && route.length === 0) {
      return await handleCreateOrder(req);
    }

    if (req.method === "PUT" && route.length === 2 && route[1] === "full") {
      return await handleUpdateFullOrder(req, route[0]);
    }

    if (req.method === "PUT" && route.length === 1) {
      return await handleUpdateOrder(req, route[0]);
    }

    if (req.method === "DELETE" && route.length === 1) {
      return await handleDeleteOrder(req, route[0]);
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
}

// ---------------------------------------------------------------------------
// Helpers locais de validação (escopo deste arquivo — não promovidos a
// _shared/validate.ts nesta etapa, ver revisão desta etapa).
// ---------------------------------------------------------------------------

function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field} deve ser um UUID.`);
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: ${field} deve ser um de: ${allowed.join(", ")}.`);
  }
  // O `includes` acima já confirmou, em runtime, que value pertence a
  // `allowed` (um T[]) — o cast só formaliza para o compilador algo que o
  // narrowing de `typeof`/`includes` não propaga automaticamente para um
  // genérico T extends string.
  return value as T;
}

function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | null {
  if (value === undefined || value === null) return null;
  return requireEnum(value, field, allowed);
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field} deve ser um objeto.`);
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown, field: string): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  return requireObject(value, field);
}

// PUT /orders/:id exige substituição completa: cada uma das 10 chaves do
// contrato de update_order() deve estar PRESENTE no corpo (mesmo que o
// valor seja null, para as colunas nullable) — ausência da chave em si é
// 400, nunca tratada como "manter valor atual" (não há leitura/merge nesta
// rota) nem como "equivale a null" (evita confundir "cliente não mandou"
// com "cliente mandou null de propósito").
function requirePresent(body: Record<string, unknown>, key: string): unknown {
  if (!(key in body)) {
    throw new ValidationError(`Campo obrigatório ausente no corpo da requisição: ${key}.`);
  }
  return body[key];
}

// Validador local de data YYYY-MM-DD (não promovido a _shared/validate.ts
// nesta etapa). Rejeita formato fora do padrão E datas de calendário
// inexistentes (ex.: 2026-02-30, 2026-04-31) — feito por checagem manual de
// componente, não por Date.parse()/new Date(), que normalizam datas
// inválidas em vez de rejeitá-las (new Date(2026, 1, 30) vira 2 de março).
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function requireDateOnly(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`Campo inválido: ${field} deve ser uma data no formato YYYY-MM-DD.`);
  }
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new ValidationError(`Campo inválido: ${field} deve seguir o formato YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) {
    throw new ValidationError(
      `Campo inválido: ${field} não é uma data de calendário válida (${value}).`,
    );
  }
  return value;
}

function optionalDateOnly(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireDateOnly(value, field);
}

// ---------------------------------------------------------------------------
// Campos comuns de criação de pedido (POST /orders e POST /orders/with-payment
// compartilham exatamente os mesmos 9 campos de cabeçalho + items) —
// extraído para nunca duplicar a validação entre as duas rotas.
// ---------------------------------------------------------------------------
interface OrderCreationFields {
  customerId: string;
  companyId: string | null;
  leadSourceId: string | null;
  paymentMethod: (typeof PAYMENT_METHODS)[number] | null;
  expectedDeliveryDate: string | null;
  deliveryMethod: string | null;
  shippingCost: number | null;
  discountValue: number | null;
  notes: string | null;
  items: Record<string, unknown>[];
}

function validateOrderCreationFields(body: Record<string, unknown>): OrderCreationFields {
  const customerId = requireUuid(body.customer_id, "customer_id");
  const companyId = optionalUuid(body.company_id, "company_id");
  const leadSourceId = optionalUuid(body.lead_source_id, "lead_source_id");
  const paymentMethod = optionalEnum(body.payment_method, "payment_method", PAYMENT_METHODS);
  const expectedDeliveryDate = optionalDateOnly(
    body.expected_delivery_date,
    "expected_delivery_date",
  );
  const deliveryMethod = optionalString(body.delivery_method, "delivery_method");
  const shippingCost = optionalNumber(body.shipping_cost, "shipping_cost", { min: 0 });
  const discountValue = optionalNumber(body.discount_value, "discount_value", { min: 0 });
  const notes = optionalString(body.notes, "notes");

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ValidationError("Campo obrigatório: items deve ser um array com ao menos 1 item.");
  }
  const items = body.items.map((raw, index) => validateOrderItem(raw, index));

  return {
    customerId,
    companyId,
    leadSourceId,
    paymentMethod,
    expectedDeliveryDate,
    deliveryMethod,
    shippingCost,
    discountValue,
    notes,
    items,
  };
}

// ---------------------------------------------------------------------------
// POST /orders -> create_order(p_customer_id, p_company_id, p_lead_source_id,
//   p_expected_delivery_date, p_delivery_method, p_shipping_cost,
//   p_discount_value, p_notes, p_items, p_changed_by, p_payment_method)
//
// payment_method no CORPO HTTP é OPCIONAL na criação — orders.payment_method
// é nullable e o POST nunca exigiu presença de chave para os demais campos
// opcionais (diferente do PUT, que usa requirePresent para todos): omitido
// ou null no corpo vira null aqui, sem erro.
//
// Na chamada ao RPC (admin.rpc abaixo), p_payment_method é SEMPRE enviado
// como chave (null quando não informado) — nunca omitido do objeto —
// porque é justamente a presença desse nome de parâmetro que faz o
// PostgREST resolver para a sobrecarga de 11 parâmetros de create_order()
// (supabase/migrations/20260821014342_extend_order_summary_and_payment_method.sql),
// nunca para a de 10 parâmetros preservada pela Migration 17.
// ---------------------------------------------------------------------------
async function handleCreateOrder(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const fields = validateOrderCreationFields(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("create_order", {
    p_customer_id: fields.customerId,
    p_company_id: fields.companyId,
    p_lead_source_id: fields.leadSourceId,
    p_expected_delivery_date: fields.expectedDeliveryDate,
    p_delivery_method: fields.deliveryMethod,
    p_shipping_cost: fields.shippingCost,
    p_discount_value: fields.discountValue,
    p_notes: fields.notes,
    p_items: fields.items,
    p_changed_by: operator.userId,
    p_payment_method: fields.paymentMethod,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { id: data }, 201);
}

// ---------------------------------------------------------------------------
// POST /orders/with-payment -> create_order_with_payment(p_customer_id,
//   p_company_id, p_lead_source_id, p_expected_delivery_date,
//   p_delivery_method, p_shipping_cost, p_discount_value, p_notes, p_items,
//   p_changed_by, p_payment_method, p_payment_condition, p_deposit_amount)
//   -- NOVA (2026-08-29)
//
// payment_condition é OBRIGATÓRIO nesta rota (diferente de payment_method,
// que continua opcional/nullable — mas a RPC exige payment_method quando
// payment_condition é ADVANCE/DEPOSIT, validado lá, não duplicado aqui).
// deposit_amount só é lido/enviado quando payment_condition = DEPOSIT;
// omitido/null nos outros dois casos (a RPC ignora o parâmetro nesses
// casos, então enviar null é seguro).
//
// idempotency_key OPCIONAL — gerada pelo frontend (OrderForm.tsx, useRef
// estável por "fingerprint", mesmo padrão de StockMovementForm.tsx) e
// simplesmente repassada à RPC (que decide sozinha: chave nova cria
// normalmente, chave repetida com o mesmo payload devolve o pedido já
// criado em vez de duplicar, chave repetida com payload diferente é
// rejeitada com IDEMPOTENCY_KEY_CONFLICT:). Nenhuma lógica de idempotência
// é replicada aqui — só validação de formato (string não vazia).
// ---------------------------------------------------------------------------
async function handleCreateOrderWithPayment(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const fields = validateOrderCreationFields(body);
  const paymentCondition = requireEnum<PaymentCondition>(
    body.payment_condition,
    "payment_condition",
    PAYMENT_CONDITIONS,
  );
  const depositAmount =
    paymentCondition === "DEPOSIT"
      ? requireNumber(body.deposit_amount, "deposit_amount", { min: 0.01 })
      : null;
  const idempotencyKey = optionalString(body.idempotency_key, "idempotency_key");

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("create_order_with_payment", {
    p_customer_id: fields.customerId,
    p_company_id: fields.companyId,
    p_lead_source_id: fields.leadSourceId,
    p_expected_delivery_date: fields.expectedDeliveryDate,
    p_delivery_method: fields.deliveryMethod,
    p_shipping_cost: fields.shippingCost,
    p_discount_value: fields.discountValue,
    p_notes: fields.notes,
    p_items: fields.items,
    p_changed_by: operator.userId,
    p_payment_method: fields.paymentMethod,
    p_payment_condition: paymentCondition,
    p_deposit_amount: depositAmount,
    p_idempotency_key: idempotencyKey,
  });

  if (error) throw mapPgError(error);

  const result = data as { order_id: string; payment_id: string | null };
  return jsonResponse(req, { id: result.order_id, payment_id: result.payment_id }, 201);
}

// ---------------------------------------------------------------------------
// PUT /orders/:id -> update_order(p_order_id, p_customer_id, p_company_id,
//   p_lead_source_id, p_payment_method, p_expected_delivery_date,
//   p_actual_delivery_date, p_delivery_method, p_shipping_cost,
//   p_discount_value, p_notes, p_changed_by)
//
// Substituição completa (não PATCH): as 10 chaves do corpo abaixo devem
// estar todas presentes (requirePresent lança 400 se faltar alguma), e o
// valor de cada uma é então validado pelo validador correspondente —
// campos nullable (company_id, lead_source_id, payment_method,
// expected_delivery_date, actual_delivery_date, delivery_method, notes,
// shipping_cost, discount_value) aceitam null explícito; customer_id não
// aceita null (orders.customer_id é NOT NULL — requireUuid rejeita null).
// Nenhuma leitura do estado atual do pedido é feita; nenhum merge. Nunca
// toca payment_condition nem chama register_payment — edição de pedido
// jamais recria o pagamento inicial.
// ---------------------------------------------------------------------------
async function handleUpdateOrder(req: Request, orderId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(orderId)) {
    throw new ValidationError("Identificador de pedido inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const customerId = requireUuid(requirePresent(body, "customer_id"), "customer_id");
  const companyId = optionalUuid(requirePresent(body, "company_id"), "company_id");
  const leadSourceId = optionalUuid(requirePresent(body, "lead_source_id"), "lead_source_id");
  const paymentMethod = optionalEnum(
    requirePresent(body, "payment_method"),
    "payment_method",
    PAYMENT_METHODS,
  );
  const expectedDeliveryDate = optionalDateOnly(
    requirePresent(body, "expected_delivery_date"),
    "expected_delivery_date",
  );
  const actualDeliveryDate = optionalDateOnly(
    requirePresent(body, "actual_delivery_date"),
    "actual_delivery_date",
  );
  const deliveryMethod = optionalString(
    requirePresent(body, "delivery_method"),
    "delivery_method",
  );
  const shippingCost = optionalNumber(requirePresent(body, "shipping_cost"), "shipping_cost", {
    min: 0,
  });
  const discountValue = optionalNumber(
    requirePresent(body, "discount_value"),
    "discount_value",
    { min: 0 },
  );
  const notes = optionalString(requirePresent(body, "notes"), "notes");

  const admin = getAdminClient();
  const { error } = await admin.rpc("update_order", {
    p_order_id: orderId,
    p_customer_id: customerId,
    p_company_id: companyId,
    p_lead_source_id: leadSourceId,
    p_payment_method: paymentMethod,
    p_expected_delivery_date: expectedDeliveryDate,
    p_actual_delivery_date: actualDeliveryDate,
    p_delivery_method: deliveryMethod,
    p_shipping_cost: shippingCost,
    p_discount_value: discountValue,
    p_notes: notes,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { success: true }, 200);
}

// ---------------------------------------------------------------------------
// PUT /orders/:id/full -> update_quote_order(p_order_id, p_customer_id,
//   p_company_id, p_lead_source_id, p_payment_method,
//   p_expected_delivery_date, p_delivery_method, p_shipping_cost,
//   p_discount_value, p_notes, p_items, p_changed_by)
//
// Edição completa atômica: cabeçalho + itens substituídos numa única
// chamada de RPC — nunca create_order, nunca múltiplas mutações
// sequenciais (update_order + add/update/remove_order_item). Só aceita
// itens CATALOG (item_type diferente de CATALOG é rejeitado aqui, com uma
// mensagem específica desta rota, antes mesmo de chamar validateOrderItem
// — evita a mensagem genérica de custom_details/spot_details ausente para
// um caso que já sabemos ser inválido). A RPC em si recusa pedidos fora de
// QUOTE ou com qualquer item CUSTOM/SPOT (atual ou enviado) — esta função
// nunca replica essas checagens de status/tipo, só a de item_type=CATALOG
// no formato do payload. Nunca toca payment_condition nem chama
// register_payment — edição de pedido jamais recria o pagamento inicial.
// ---------------------------------------------------------------------------
async function handleUpdateFullOrder(req: Request, orderId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(orderId)) {
    throw new ValidationError("Identificador de pedido inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const customerId = requireUuid(body.customer_id, "customer_id");
  const companyId = optionalUuid(body.company_id, "company_id");
  const leadSourceId = optionalUuid(body.lead_source_id, "lead_source_id");
  const paymentMethod = optionalEnum(body.payment_method, "payment_method", PAYMENT_METHODS);
  const expectedDeliveryDate = optionalDateOnly(
    body.expected_delivery_date,
    "expected_delivery_date",
  );
  const deliveryMethod = optionalString(body.delivery_method, "delivery_method");
  const shippingCost = optionalNumber(body.shipping_cost, "shipping_cost", { min: 0 });
  const discountValue = optionalNumber(body.discount_value, "discount_value", { min: 0 });
  const notes = optionalString(body.notes, "notes");

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ValidationError("Campo obrigatório: items deve ser um array com ao menos 1 item.");
  }

  const items = body.items.map((raw, index) => {
    const prefix = `items[${index}]`;
    const item = requireObject(raw, prefix);
    if (item.item_type !== "CATALOG") {
      throw new ValidationError(
        `Campo inválido: ${prefix}.item_type deve ser CATALOG — a edição completa só aceita itens de Catálogo nesta versão.`,
      );
    }
    return validateOrderItem(raw, index);
  });

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("update_quote_order", {
    p_order_id: orderId,
    p_customer_id: customerId,
    p_company_id: companyId,
    p_lead_source_id: leadSourceId,
    p_payment_method: paymentMethod,
    p_expected_delivery_date: expectedDeliveryDate,
    p_delivery_method: deliveryMethod,
    p_shipping_cost: shippingCost,
    p_discount_value: discountValue,
    p_notes: notes,
    p_items: items,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { id: data }, 200);
}

// ---------------------------------------------------------------------------
// DELETE /orders/:id -> delete_order(p_order_id, p_changed_by) — NOVA
// (2026-08-29). Exclusão física protegida: bloqueada fora de QUOTE/CANCELLED
// e quando há pagamento/aprovação/versão vinculados (mensagens de negócio
// mapeadas por _shared/errors.ts). Nenhum corpo de requisição é lido.
// ---------------------------------------------------------------------------
async function handleDeleteOrder(req: Request, orderId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(orderId)) {
    throw new ValidationError("Identificador de pedido inválido na rota.");
  }

  const admin = getAdminClient();
  const { error } = await admin.rpc("delete_order", {
    p_order_id: orderId,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { success: true }, 200);
}

// ---------------------------------------------------------------------------
// Validação de um item de p_items — espelha as constraints reais de
// order_items (Migration 8) e, conforme item_type, de custom_item_details
// (Migration 9) ou spot_item_details (Migration 10).
//
// prototype_completed, test_print_completed e catalog_conversion_suggested
// não são aceitos aqui: create_order() nunca os lê do payload (sempre grava
// false), então oferecer esses campos no contrato HTTP seria enganoso.
// ---------------------------------------------------------------------------
function validateOrderItem(raw: unknown, index: number): Record<string, unknown> {
  const prefix = `items[${index}]`;
  const item = requireObject(raw, prefix);

  const itemType = requireEnum<ItemType>(item.item_type, `${prefix}.item_type`, ITEM_TYPES);
  const itemName = requireString(item.item_name, `${prefix}.item_name`);
  const description = optionalString(item.description, `${prefix}.description`);

  // quantity > 0 (order_items): requireNumber com min:1 já cobre ">= 1",
  // equivalente a "> 0" para inteiros; a checagem de inteireza é separada
  // porque não existe um requireInteger em _shared/validate.ts.
  const quantity = requireNumber(item.quantity, `${prefix}.quantity`, { min: 1 });
  if (!Number.isInteger(quantity)) {
    throw new ValidationError(`Campo inválido: ${prefix}.quantity deve ser um número inteiro.`);
  }

  const unitPrice = requireNumber(item.unit_price, `${prefix}.unit_price`, { min: 0 });
  const personalizationFee =
    optionalNumber(item.personalization_fee, `${prefix}.personalization_fee`, { min: 0 }) ?? 0;
  const itemDiscountValue =
    optionalNumber(item.discount_value, `${prefix}.discount_value`, { min: 0 }) ?? 0;
  const colorDescription = optionalString(item.color_description, `${prefix}.color_description`);
  const numberOfColors = optionalInteger(item.number_of_colors, `${prefix}.number_of_colors`, {
    min: 1,
  });
  const customizationData = optionalObject(
    item.customization_data,
    `${prefix}.customization_data`,
  );
  const expectedDeliveryDate = optionalDateOnly(
    item.expected_delivery_date,
    `${prefix}.expected_delivery_date`,
  );
  const notes = optionalString(item.notes, `${prefix}.notes`);

  const productId = optionalUuid(item.product_id, `${prefix}.product_id`);
  if (itemType === "CATALOG" && !productId) {
    throw new ValidationError(
      `Campo obrigatório ausente: ${prefix}.product_id (exigido para item_type=CATALOG).`,
    );
  }
  if (itemType !== "CATALOG" && productId) {
    throw new ValidationError(
      `Campo não permitido: ${prefix}.product_id (não deve ser informado para item_type=${itemType}).`,
    );
  }

  // Espelha a constraint real order_items_total_price_non_negative
  // (Migration 8): total_price = quantity*unit_price + personalization_fee -
  // discount_value >= 0.
  const totalPrice = quantity * unitPrice + personalizationFee - itemDiscountValue;
  if (totalPrice < 0) {
    throw new ValidationError(
      `Campo inválido: ${prefix} — quantity*unit_price + personalization_fee - discount_value ` +
        `resultaria em ${totalPrice.toFixed(2)}, que é negativo.`,
    );
  }

  const payload: Record<string, unknown> = {
    item_type: itemType,
    product_id: productId,
    item_name: itemName,
    description,
    quantity,
    unit_price: unitPrice,
    personalization_fee: personalizationFee,
    discount_value: itemDiscountValue,
    color_description: colorDescription,
    number_of_colors: numberOfColors,
    customization_data: customizationData ?? {},
    expected_delivery_date: expectedDeliveryDate,
    notes,
  };

  if (itemType === "CUSTOM") {
    payload.custom_details = validateCustomDetails(
      requireObject(item.custom_details, `${prefix}.custom_details`),
      `${prefix}.custom_details`,
    );
  } else if (itemType === "SPOT") {
    payload.spot_details = validateSpotDetails(
      requireObject(item.spot_details, `${prefix}.spot_details`),
      `${prefix}.spot_details`,
    );
  }

  return payload;
}

// custom_item_details (Migration 9): current_version segue vX.Y.
function validateCustomDetails(
  details: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const currentVersion = requireString(details.current_version, `${field}.current_version`);
  if (!CUSTOM_VERSION_PATTERN.test(currentVersion)) {
    throw new ValidationError(
      `Campo inválido: ${field}.current_version deve seguir o formato vX.Y (ex.: v1.0).`,
    );
  }

  const isExclusive = optionalBoolean(details.is_exclusive, `${field}.is_exclusive`);
  const prototypeRequired = optionalBoolean(
    details.prototype_required,
    `${field}.prototype_required`,
  );
  const developmentMinutes = optionalInteger(
    details.development_minutes,
    `${field}.development_minutes`,
    { min: 0 },
  );
  const notes = optionalString(details.notes, `${field}.notes`);

  return {
    current_version: currentVersion,
    is_exclusive: isExclusive,
    prototype_required: prototypeRequired,
    development_minutes: developmentMinutes,
    notes,
  };
}

// spot_item_details (Migration 10): search_time_status=RECORDED exige
// search_minutes preenchido (constraint spot_item_details_search_time_consistency).
function validateSpotDetails(
  details: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const modelSourceId = optionalUuid(details.model_source_id, `${field}.model_source_id`);
  const sourceReference = optionalString(details.source_reference, `${field}.source_reference`);
  const isExclusive = optionalBoolean(details.is_exclusive, `${field}.is_exclusive`);
  const testPrintRequired = optionalBoolean(
    details.test_print_required,
    `${field}.test_print_required`,
  );
  const searchTimeStatus = optionalEnum(
    details.search_time_status,
    `${field}.search_time_status`,
    SEARCH_TIME_STATUSES,
  );
  const searchMinutes = optionalInteger(details.search_minutes, `${field}.search_minutes`, {
    min: 0,
  });
  const preparationMinutes = optionalInteger(
    details.preparation_minutes,
    `${field}.preparation_minutes`,
    { min: 0 },
  );
  const marketReferencePrice = optionalNumber(
    details.market_reference_price,
    `${field}.market_reference_price`,
    { min: 0 },
  );
  const marketReferenceSource = optionalString(
    details.market_reference_source,
    `${field}.market_reference_source`,
  );
  const marketReferenceDate = optionalDateOnly(
    details.market_reference_date,
    `${field}.market_reference_date`,
  );
  const notes = optionalString(details.notes, `${field}.notes`);

  if (searchTimeStatus === "RECORDED" && searchMinutes === null) {
    throw new ValidationError(
      `Campo inválido: ${field}.search_minutes é obrigatório quando ` +
        `${field}.search_time_status = RECORDED.`,
    );
  }

  return {
    model_source_id: modelSourceId,
    source_reference: sourceReference,
    is_exclusive: isExclusive,
    test_print_required: testPrintRequired,
    search_time_status: searchTimeStatus,
    search_minutes: searchMinutes,
    preparation_minutes: preparationMinutes,
    market_reference_price: marketReferencePrice,
    market_reference_source: marketReferenceSource,
    market_reference_date: marketReferenceDate,
    notes,
  };
}
