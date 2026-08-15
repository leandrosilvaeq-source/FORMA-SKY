// Edge Function: order-items
//
// Rotas implementadas:
//   POST   /order-items      -> RPC add_order_item
//   PATCH  /order-items/:id  -> RPC update_order_item
//   DELETE /order-items/:id  -> RPC remove_order_item
//
// PATCH /order-items/:id — semântica PATCH real (não read-modify-write):
//   custom_details/spot_details, quando a chave está presente, são
//   validados via requireObject (não optionalObject) — null explícito
//   nessas duas chaves é rejeitado com 400 ANTES da RPC. Motivo: dentro de
//   update_order_item(), esses dois campos são passados por
//   jsonb_whitelist() -> jsonb_each(coalesce(p_data, '{}'::jsonb)).
//   `v_item -> 'custom_details'` quando a chave existe com valor JSON null
//   retorna o literal jsonb 'null' (NÃO SQL NULL — 'null'::jsonb IS NULL é
//   false), então o coalesce não entra em ação e jsonb_each() lançaria
//   erro para esse escalar — erro sem SQLSTATE mapeado em
//   _shared/errors.ts, cairia no fallback de mapPgError como 500 em vez de
//   400. add_order_item/create_order não têm esse risco (usam ->/->>
//   diretamente, tolerantes a escalar, nunca jsonb_each).
//
// order-items NÃO possui nenhuma rota GET (mesma decisão já confirmada
// para orders — leituras do Bloco 1 ficam no frontend via Supabase client
// autenticado + RLS/security_invoker).
//
// RPCs usadas, conferidas contra
// supabase/migrations/20260814030351_create_order_business_functions.sql
// (update_order_item, remove_order_item) e
// supabase/migrations/20260814051143_create_initial_custom_version_fix.sql
// (add_order_item, versão vigente — corrige só o ramo CUSTOM em relação à
// Migration 15, passando a gravar também a linha inicial em
// custom_versions, mesma lógica de create_order):
//   add_order_item(uuid, jsonb, uuid) returns uuid
//   update_order_item(uuid, jsonb, uuid) returns void
//   remove_order_item(uuid, uuid) returns void
// Todas security definer, EXECUTE concedido só a service_role.
//
// Validações de item (POST) duplicadas deliberadamente de orders/index.ts
// nesta etapa — decisão explícita de não reabrir/extrair para _shared
// ainda (refatoração compartilhada fica para depois de todas as Edge
// Functions do Bloco 1 estarem implementadas e testadas).

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

// vX.Y (ex.: v1.0, v1.1) — mesmo padrão exigido por
// custom_item_details.current_version (Migration 9).
const CUSTOM_VERSION_PATTERN = /^v[0-9]+\.[0-9]+$/;

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("order-items");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (req.method === "POST" && route.length === 0) {
      return await handleAddOrderItem(req);
    }

    if (req.method === "PATCH" && route.length === 1) {
      return await handleUpdateOrderItem(req, route[0]);
    }

    if (req.method === "DELETE" && route.length === 1) {
      return await handleRemoveOrderItem(req, route[0]);
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
});

// ---------------------------------------------------------------------------
// Helpers locais (duplicados de orders/index.ts por decisão explícita desta
// etapa — não promovidos a _shared/validate.ts).
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

// Rejeita, com 400, qualquer chave de `obj` que não esteja em `allowed` —
// usado no whitelist do PATCH (nível superior e dentro de custom_details/
// spot_details) para nunca ignorar silenciosamente um campo desconhecido,
// diferente do comportamento da própria RPC (jsonb_whitelist descarta sem
// avisar).
function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const unknown = Object.keys(obj).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(
      `Campo(s) não suportado(s) em ${context}: ${unknown.join(", ")}. ` +
        `Campos aceitos: ${allowed.join(", ")}.`,
    );
  }
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

// Validador local de data YYYY-MM-DD (mesmo comportamento de
// orders/index.ts, duplicado por decisão explícita desta etapa). Rejeita
// formato fora do padrão E datas de calendário inexistentes (ex.:
// 2026-02-30) via checagem manual de componente, não Date.parse()/
// new Date() (que normalizam datas inválidas em vez de rejeitá-las).
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
// POST /order-items -> add_order_item(p_order_id, p_item, p_changed_by)
//
// Mesmo contrato de item já aprovado em POST /orders — order_id vem junto
// no mesmo corpo (não aninhado em "items"). Nenhum dos 3 parâmetros da RPC
// tem DEFAULT no SQL. Não replica a criação de custom_versions inicial:
// isso continua responsabilidade de add_order_item (correção da Migration 17).
// ---------------------------------------------------------------------------
async function handleAddOrderItem(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const orderId = requireUuid(body.order_id, "order_id");
  const item = validateOrderItemPayload(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("add_order_item", {
    p_order_id: orderId,
    p_item: item,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { id: data }, 201);
}

// Espelha as constraints reais de order_items (Migration 8) e, conforme
// item_type, de custom_item_details (Migration 9) ou spot_item_details
// (Migration 10) — mesma lógica de validateOrderItem em orders/index.ts,
// adaptada para ler os campos direto do corpo (sem aninhamento em array).
function validateOrderItemPayload(item: Record<string, unknown>): Record<string, unknown> {
  const itemType = requireEnum<ItemType>(item.item_type, "item_type", ITEM_TYPES);
  const itemName = requireString(item.item_name, "item_name");
  const description = optionalString(item.description, "description");

  const quantity = requireNumber(item.quantity, "quantity", { min: 1 });
  if (!Number.isInteger(quantity)) {
    throw new ValidationError("Campo inválido: quantity deve ser um número inteiro.");
  }

  const unitPrice = requireNumber(item.unit_price, "unit_price", { min: 0 });
  const personalizationFee =
    optionalNumber(item.personalization_fee, "personalization_fee", { min: 0 }) ?? 0;
  const itemDiscountValue = optionalNumber(item.discount_value, "discount_value", { min: 0 }) ?? 0;
  const colorDescription = optionalString(item.color_description, "color_description");
  const numberOfColors = optionalInteger(item.number_of_colors, "number_of_colors", { min: 1 });
  const customizationData = optionalObject(item.customization_data, "customization_data");
  const expectedDeliveryDate = optionalDateOnly(
    item.expected_delivery_date,
    "expected_delivery_date",
  );
  const notes = optionalString(item.notes, "notes");

  const productId = optionalUuid(item.product_id, "product_id");
  if (itemType === "CATALOG" && !productId) {
    throw new ValidationError(
      "Campo obrigatório ausente: product_id (exigido para item_type=CATALOG).",
    );
  }
  if (itemType !== "CATALOG" && productId) {
    throw new ValidationError(
      `Campo não permitido: product_id (não deve ser informado para item_type=${itemType}).`,
    );
  }

  // Espelha a constraint real order_items_total_price_non_negative
  // (Migration 8).
  const totalPrice = quantity * unitPrice + personalizationFee - itemDiscountValue;
  if (totalPrice < 0) {
    throw new ValidationError(
      `Campo inválido: quantity*unit_price + personalization_fee - discount_value ` +
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
    payload.custom_details = validateCustomDetailsForCreate(
      requireObject(item.custom_details, "custom_details"),
    );
  } else if (itemType === "SPOT") {
    payload.spot_details = validateSpotDetailsForCreate(
      requireObject(item.spot_details, "spot_details"),
    );
  }

  return payload;
}

// custom_item_details (Migration 9): current_version segue vX.Y.
function validateCustomDetailsForCreate(details: Record<string, unknown>): Record<string, unknown> {
  const currentVersion = requireString(details.current_version, "custom_details.current_version");
  if (!CUSTOM_VERSION_PATTERN.test(currentVersion)) {
    throw new ValidationError(
      "Campo inválido: custom_details.current_version deve seguir o formato vX.Y (ex.: v1.0).",
    );
  }

  const isExclusive = optionalBoolean(details.is_exclusive, "custom_details.is_exclusive");
  const prototypeRequired = optionalBoolean(
    details.prototype_required,
    "custom_details.prototype_required",
  );
  const developmentMinutes = optionalInteger(
    details.development_minutes,
    "custom_details.development_minutes",
    { min: 0 },
  );
  const notes = optionalString(details.notes, "custom_details.notes");

  return {
    current_version: currentVersion,
    is_exclusive: isExclusive,
    prototype_required: prototypeRequired,
    development_minutes: developmentMinutes,
    notes,
  };
}

// spot_item_details (Migration 10): search_time_status=RECORDED exige
// search_minutes preenchido.
function validateSpotDetailsForCreate(details: Record<string, unknown>): Record<string, unknown> {
  const modelSourceId = optionalUuid(details.model_source_id, "spot_details.model_source_id");
  const sourceReference = optionalString(details.source_reference, "spot_details.source_reference");
  const isExclusive = optionalBoolean(details.is_exclusive, "spot_details.is_exclusive");
  const testPrintRequired = optionalBoolean(
    details.test_print_required,
    "spot_details.test_print_required",
  );
  const searchTimeStatus = details.search_time_status === undefined ||
      details.search_time_status === null
    ? null
    : requireEnum(
      details.search_time_status,
      "spot_details.search_time_status",
      SEARCH_TIME_STATUSES,
    );
  const searchMinutes = optionalInteger(details.search_minutes, "spot_details.search_minutes", {
    min: 0,
  });
  const preparationMinutes = optionalInteger(
    details.preparation_minutes,
    "spot_details.preparation_minutes",
    { min: 0 },
  );
  const marketReferencePrice = optionalNumber(
    details.market_reference_price,
    "spot_details.market_reference_price",
    { min: 0 },
  );
  const marketReferenceSource = optionalString(
    details.market_reference_source,
    "spot_details.market_reference_source",
  );
  const marketReferenceDate = optionalDateOnly(
    details.market_reference_date,
    "spot_details.market_reference_date",
  );
  const notes = optionalString(details.notes, "spot_details.notes");

  if (searchTimeStatus === "RECORDED" && searchMinutes === null) {
    throw new ValidationError(
      "Campo inválido: spot_details.search_minutes é obrigatório quando " +
        "spot_details.search_time_status = RECORDED.",
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

// ---------------------------------------------------------------------------
// PATCH /order-items/:id -> update_order_item(p_order_item_id, p_item, p_changed_by)
//
// Whitelist idêntica à da RPC (jsonb_whitelist), reforçada aqui com 400
// explícito em vez do descarte silencioso da RPC para qualquer chave fora
// da lista — inclui id, order_item_id, order_id, item_type, product_id,
// item_name, description, current_version e campos de identidade
// operacional (estes últimos também cobertos por rejectIdentityFields).
// ---------------------------------------------------------------------------
const PATCH_ORDER_ITEM_KEYS = [
  "quantity",
  "unit_price",
  "personalization_fee",
  "discount_value",
  "color_description",
  "number_of_colors",
  "customization_data",
  "expected_delivery_date",
  "notes",
  "custom_details",
  "spot_details",
] as const;

const CUSTOM_DETAILS_PATCH_KEYS = [
  "is_exclusive",
  "prototype_required",
  "prototype_completed",
  "development_minutes",
  "notes",
] as const;

const SPOT_DETAILS_PATCH_KEYS = [
  "model_source_id",
  "source_reference",
  "is_exclusive",
  "test_print_required",
  "test_print_completed",
  "search_time_status",
  "search_minutes",
  "preparation_minutes",
  "market_reference_price",
  "market_reference_source",
  "market_reference_date",
  "catalog_conversion_suggested",
  "notes",
] as const;

async function handleUpdateOrderItem(req: Request, orderItemId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(orderItemId)) {
    throw new ValidationError("Identificador de item de pedido inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const patch = buildOrderItemPatch(body);

  const admin = getAdminClient();
  const { error } = await admin.rpc("update_order_item", {
    p_order_item_id: orderItemId,
    p_item: patch,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { success: true }, 200);
}

// Constrói p_item só com as chaves que o cliente de fato enviou — chave
// ausente nunca entra no objeto (preserva o valor atual na RPC); chave
// presente é validada e incluída, inclusive quando o valor é null, exceto
// onde isso é proibido (quantity/unit_price, colunas NOT NULL sem coalesce
// na RPC) ou perigoso (custom_details/spot_details, ver cabeçalho do
// arquivo). PATCH sem nenhuma chave reconhecida é rejeitado com 400 — a
// RPC nunca é chamada sem nenhuma alteração solicitada.
function buildOrderItemPatch(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, PATCH_ORDER_ITEM_KEYS, "corpo do PATCH");

  const patch: Record<string, unknown> = {};

  // quantity/unit_price: NOT NULL, e o CASE WHEN de update_order_item NÃO
  // usa coalesce para essas duas colunas (assimetria confirmada na leitura
  // do SQL real) — null explícito viraria 23502 genérico na RPC; rejeitado
  // aqui com mensagem específica.
  if ("quantity" in body) {
    if (body.quantity === null) {
      throw new ValidationError(
        "Campo inválido: quantity não pode ser null (coluna obrigatória, não é possível limpar).",
      );
    }
    const quantity = requireNumber(body.quantity, "quantity", { min: 1 });
    if (!Number.isInteger(quantity)) {
      throw new ValidationError("Campo inválido: quantity deve ser um número inteiro.");
    }
    patch.quantity = quantity;
  }

  if ("unit_price" in body) {
    if (body.unit_price === null) {
      throw new ValidationError(
        "Campo inválido: unit_price não pode ser null (coluna obrigatória, não é possível limpar).",
      );
    }
    patch.unit_price = requireNumber(body.unit_price, "unit_price", { min: 0 });
  }

  // NOT NULL com coalesce no CASE WHEN da RPC: null explícito é absorvido
  // e equivale a preservar o valor atual — permitido, encaminhado como
  // está.
  if ("personalization_fee" in body) {
    patch.personalization_fee = optionalNumber(
      body.personalization_fee,
      "personalization_fee",
      { min: 0 },
    );
  }
  if ("discount_value" in body) {
    patch.discount_value = optionalNumber(body.discount_value, "discount_value", { min: 0 });
  }
  if ("customization_data" in body) {
    patch.customization_data = optionalObject(body.customization_data, "customization_data");
  }

  // Nullable sem coalesce no CASE WHEN da RPC: null explícito limpa a
  // coluna de fato.
  if ("color_description" in body) {
    patch.color_description = optionalString(body.color_description, "color_description");
  }
  if ("number_of_colors" in body) {
    patch.number_of_colors = optionalInteger(body.number_of_colors, "number_of_colors", {
      min: 1,
    });
  }
  if ("expected_delivery_date" in body) {
    patch.expected_delivery_date = optionalDateOnly(
      body.expected_delivery_date,
      "expected_delivery_date",
    );
  }
  if ("notes" in body) {
    patch.notes = optionalString(body.notes, "notes");
  }

  // custom_details/spot_details: a chave inteira nunca pode ser null
  // (requireObject rejeita null/array/string/number/boolean com 400) — ver
  // achado no cabeçalho do arquivo (jsonb_each quebraria com um escalar).
  if ("custom_details" in body) {
    patch.custom_details = buildCustomDetailsPatch(
      requireObject(body.custom_details, "custom_details"),
    );
  }
  if ("spot_details" in body) {
    patch.spot_details = buildSpotDetailsPatch(
      requireObject(body.spot_details, "spot_details"),
    );
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("PATCH vazio: informe ao menos um campo reconhecido para alterar.");
  }

  return patch;
}

// custom_item_details (Migration 9) — mesma semântica de presença/null da
// RPC, campo a campo (ver comentário de update_order_item no topo do
// arquivo de migration): is_exclusive/prototype_required/
// prototype_completed usam coalesce (null absorvido); development_minutes/
// notes não usam (null limpa de fato).
function buildCustomDetailsPatch(details: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(details, CUSTOM_DETAILS_PATCH_KEYS, "custom_details");

  const patch: Record<string, unknown> = {};

  if ("is_exclusive" in details) {
    patch.is_exclusive = optionalBoolean(details.is_exclusive, "custom_details.is_exclusive");
  }
  if ("prototype_required" in details) {
    patch.prototype_required = optionalBoolean(
      details.prototype_required,
      "custom_details.prototype_required",
    );
  }
  if ("prototype_completed" in details) {
    patch.prototype_completed = optionalBoolean(
      details.prototype_completed,
      "custom_details.prototype_completed",
    );
  }
  if ("development_minutes" in details) {
    patch.development_minutes = optionalInteger(
      details.development_minutes,
      "custom_details.development_minutes",
      { min: 0 },
    );
  }
  if ("notes" in details) {
    patch.notes = optionalString(details.notes, "custom_details.notes");
  }

  // Regra cruzada (custom_item_details_prototype_consistency) só
  // validável aqui quando ambas as chaves vêm no mesmo PATCH — sem ler o
  // estado atual do banco. Quando só uma das duas vem, a consistência com
  // o valor atual fica a cargo do CHECK da própria RPC.
  if (patch.prototype_completed === true && patch.prototype_required === false) {
    throw new ValidationError(
      "Campo inválido: custom_details.prototype_completed não pode ser true quando " +
        "custom_details.prototype_required é false.",
    );
  }

  return patch;
}

// spot_item_details (Migration 10) — mesma lógica: model_source_id/
// source_reference/search_minutes/preparation_minutes/
// market_reference_price/market_reference_source/market_reference_date/
// notes não usam coalesce (null limpa); is_exclusive/test_print_required/
// test_print_completed/search_time_status/catalog_conversion_suggested
// usam coalesce (null absorvido).
function buildSpotDetailsPatch(details: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(details, SPOT_DETAILS_PATCH_KEYS, "spot_details");

  const patch: Record<string, unknown> = {};

  if ("model_source_id" in details) {
    patch.model_source_id = optionalUuid(details.model_source_id, "spot_details.model_source_id");
  }
  if ("source_reference" in details) {
    patch.source_reference = optionalString(
      details.source_reference,
      "spot_details.source_reference",
    );
  }
  if ("is_exclusive" in details) {
    patch.is_exclusive = optionalBoolean(details.is_exclusive, "spot_details.is_exclusive");
  }
  if ("test_print_required" in details) {
    patch.test_print_required = optionalBoolean(
      details.test_print_required,
      "spot_details.test_print_required",
    );
  }
  if ("test_print_completed" in details) {
    patch.test_print_completed = optionalBoolean(
      details.test_print_completed,
      "spot_details.test_print_completed",
    );
  }
  if ("search_time_status" in details) {
    patch.search_time_status = optionalEnum(
      details.search_time_status,
      "spot_details.search_time_status",
      SEARCH_TIME_STATUSES,
    );
  }
  if ("search_minutes" in details) {
    patch.search_minutes = optionalInteger(details.search_minutes, "spot_details.search_minutes", {
      min: 0,
    });
  }
  if ("preparation_minutes" in details) {
    patch.preparation_minutes = optionalInteger(
      details.preparation_minutes,
      "spot_details.preparation_minutes",
      { min: 0 },
    );
  }
  if ("market_reference_price" in details) {
    patch.market_reference_price = optionalNumber(
      details.market_reference_price,
      "spot_details.market_reference_price",
      { min: 0 },
    );
  }
  if ("market_reference_source" in details) {
    patch.market_reference_source = optionalString(
      details.market_reference_source,
      "spot_details.market_reference_source",
    );
  }
  if ("market_reference_date" in details) {
    patch.market_reference_date = optionalDateOnly(
      details.market_reference_date,
      "spot_details.market_reference_date",
    );
  }
  if ("catalog_conversion_suggested" in details) {
    patch.catalog_conversion_suggested = optionalBoolean(
      details.catalog_conversion_suggested,
      "spot_details.catalog_conversion_suggested",
    );
  }
  if ("notes" in details) {
    patch.notes = optionalString(details.notes, "spot_details.notes");
  }

  // Regra cruzada (spot_item_details_search_time_consistency) — espelha
  // integralmente a constraint real do banco, que é UNIDIRECIONAL:
  //   check (search_time_status <> 'RECORDED' or search_minutes is not null)
  // Só exige search_minutes não-nulo quando search_time_status = RECORDED.
  // Não existe, na constraint real, nenhuma exigência do tipo "se não for
  // RECORDED, search_minutes deve ser null" — o comentário da migration
  // (20260814013200_create_spot_item_details_table.sql) confirma
  // explicitamente que IN_PROGRESS/NOT_INFORMED não exigem search_minutes
  // (nem vazio, nem preenchido). Por isso só a direção RECORDED -> not
  // null é validada aqui.
  //
  // Gate por presença real nas chaves de `details` (não em `patch`): só
  // valida quando as DUAS chaves vêm no mesmo PATCH. Se só uma delas vier,
  // a consistência com o valor atual no banco fica a cargo do CHECK da
  // própria RPC — nenhuma leitura do estado atual é feita aqui.
  if ("search_time_status" in details && "search_minutes" in details) {
    const isRecorded = patch.search_time_status === "RECORDED";
    const minutesIsNull = patch.search_minutes === null;
    if (isRecorded && minutesIsNull) {
      throw new ValidationError(
        "Campo inválido: spot_details.search_minutes não pode ser null quando " +
          "spot_details.search_time_status = RECORDED.",
      );
    }
  }

  return patch;
}

// ---------------------------------------------------------------------------
// DELETE /order-items/:id -> remove_order_item(p_order_item_id, p_changed_by)
//
// Sem corpo. Nenhuma regra de bloqueio (produção, último item, histórico
// custom_versions/approvals) é replicada aqui — a RPC continua sendo a
// única fonte de verdade para essas checagens; qualquer exceção que ela
// lançar é só mapeada por mapPgError.
// ---------------------------------------------------------------------------
async function handleRemoveOrderItem(req: Request, orderItemId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(orderItemId)) {
    throw new ValidationError("Identificador de item de pedido inválido na rota.");
  }

  const admin = getAdminClient();
  const { error } = await admin.rpc("remove_order_item", {
    p_order_item_id: orderItemId,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { success: true }, 200);
}
