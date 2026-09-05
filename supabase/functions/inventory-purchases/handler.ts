// Handler + validadores da Edge Function `inventory-purchases` — sem nenhum
// efeito colateral de módulo (nenhum Deno.serve aqui), mesmo padrão de
// stock-movements/handler.ts e filament-spools/handler.ts.
//
// Rotas:
//   POST /inventory-purchases          -> RPC register_inventory_purchase
//     (ACCESSORY/PACKAGING; FILAMENT de item único, preservado para
//     compatibilidade — a interface não usa mais este caminho para
//     Filamento, ver rota abaixo)
//   POST /inventory-purchases/filament -> RPC register_filament_purchase
//     (2026-09-04 — compra de filamento com UM OU MAIS itens/tipos/marcas
//     na mesma compra, migration
//     20260904130000_support_multi_item_filament_purchases.sql; único
//     caminho usado pela janela "Compra de filamentos" a partir desta
//     rodada)
//
// As duas RPCs são security definer com EXECUTE concedido só a service_role
// (supabase/migrations/20260828121000_create_register_inventory_purchase_function.sql,
// 20260904130000_support_multi_item_filament_purchases.sql) — só
// alcançáveis a partir desta Edge Function, nunca diretamente do frontend.
// Nenhuma escrita direta em inventory_purchases,
// inventory_purchase_filament_items, filament_types, filament_spools,
// filament_movements, stock_movements ou nos saldos materializados
// (accessories/packaging.current_stock,
// filament_spools.current_net_weight_grams) acontece nesta Edge Function —
// a RPC é sempre a única forma de escrita, numa única transação.
//
// Validação estrutural (payload) vive aqui: category dentro do enum
// conhecido, quantity como inteiro positivo, item_value/freight_value como
// número não-negativo, e os campos específicos de cada categoria (item_id
// para ACCESSORY/PACKAGING; para FILAMENT de item único, OU filament_type_id
// — caminho por tipo já cadastrado — OU material/manufacturer/line/
// commercial_color — caminho legado de find-or-create por nome, preservado
// para compatibilidade, nunca os dois juntos — além de peso nominal/pesos
// brutos, sempre exigidos) na rota base; para a rota /filament, freight_value
// + purchase_channel (2026-09-04, migration
// 20260904140000_add_purchase_channel_to_filament_purchases.sql — local/canal
// da compra, obrigatório, um de MERCADO_LIVRE/ALIEXPRESS/SHOPEE/PRESENCIAL) +
// uma lista não vazia de itens (filament_type_id/manufacturer/
// nominal_weight_grams/quantity/total_value cada — total_value substitui
// unit_value a partir de 2026-09-04/migration 20260905160000: o valor pago
// por TODOS os rolos da linha, nunca dividido pelo frontend) — tudo que não
// depende de ler o banco. Regras que dependem do banco (item realmente existe e está
// ativo, tipo de filamento existe/está ativo, tipo inativo correspondente,
// idempotency_key já usada) continuam exclusivas da RPC, mesmo critério já
// usado em accessories/handler.ts, stock-movements/handler.ts e
// filament-spools/handler.ts.

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { AppError, NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import {
  isUuid,
  optionalString,
  optionalNumber,
  requireNumber,
  parseJsonBody,
  rejectIdentityFields,
} from "../_shared/validate.ts";

const PURCHASE_CATEGORIES = ["FILAMENT", "ACCESSORY", "PACKAGING"] as const;
type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number];

const FILAMENT_MATERIALS = ["PLA", "PETG", "TPU"] as const;

const PURCHASE_KEYS = [
  "category",
  "quantity",
  "item_value",
  "freight_value",
  "occurred_at",
  "notes",
  "idempotency_key",
  // ACCESSORY / PACKAGING
  "item_id",
  // FILAMENT — caminho novo (2026-09-04): tipo já cadastrado, escolhido na
  // interface. Nunca usado junto dos 4 campos legados abaixo.
  "filament_type_id",
  // FILAMENT — caminho legado (find-or-create por nome), preservado para
  // compatibilidade com qualquer chamador que não informe filament_type_id.
  "material",
  "manufacturer",
  "line",
  "commercial_color",
  "nominal_weight_grams",
  "gross_weights_grams",
] as const;

export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("inventory-purchases");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (route.length === 0) {
      if (req.method === "POST") return await handleRegisterInventoryPurchase(req);
      throw new AppError("validation", 405, `Método ${req.method} não permitido em /inventory-purchases.`);
    }

    if (route.length === 1 && route[0] === "filament") {
      if (req.method === "POST") return await handleRegisterFilamentPurchase(req);
      throw new AppError(
        "validation",
        405,
        `Método ${req.method} não permitido em /inventory-purchases/filament.`,
      );
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
}

// ---------------------------------------------------------------------------
// Validadores locais
// ---------------------------------------------------------------------------

export function rejectUnknownKeys(
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

export function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field}.`);
  }
  return value;
}

export function requirePurchaseCategory(value: unknown): PurchaseCategory {
  if (typeof value !== "string" || !(PURCHASE_CATEGORIES as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: category deve ser um de: ${PURCHASE_CATEGORIES.join(", ")}.`);
  }
  return value as PurchaseCategory;
}

export function requirePositiveIntegerQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError("Campo inválido: quantity deve ser um número positivo.");
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError("Campo inválido: quantity deve ser um número inteiro, sem casas decimais.");
  }
  return value;
}

export function optionalNonEmptyString(value: unknown, field: string): string | null {
  const raw = optionalString(value, field);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function requireTrimmedString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field}.`);
  }
  return value.trim();
}

export function requireFilamentMaterial(value: unknown): (typeof FILAMENT_MATERIALS)[number] {
  if (typeof value !== "string" || !(FILAMENT_MATERIALS as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: material deve ser um de: ${FILAMENT_MATERIALS.join(", ")}.`);
  }
  return value as (typeof FILAMENT_MATERIALS)[number];
}

export function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`Campo inválido: ${field} deve ser uma data/hora ISO 8601 válida.`);
  }
  return value;
}

// Um peso bruto por rolo, na mesma ordem — comprimento exigido exatamente
// igual a `quantity` (a RPC valida de novo, em profundidade; aqui é só
// para dar erro estrutural imediato sem round-trip). Cada valor deve ser
// number finito e maior que o peso líquido nominal (requisito explícito:
// "peso bruto de cada rolo... exigir valor maior que o peso líquido
// nominal").
export function requireGrossWeightsGrams(value: unknown, quantity: number, nominalWeightGrams: number): number[] {
  if (!Array.isArray(value) || value.length !== quantity) {
    throw new ValidationError(
      `Campo inválido: gross_weights_grams deve ser uma lista com exatamente ${quantity} peso(s) bruto(s) (um por rolo).`,
    );
  }
  return value.map((raw, index) => {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new ValidationError(`Campo inválido: gross_weights_grams[${index}] deve ser numérico.`);
    }
    if (raw <= nominalWeightGrams) {
      throw new ValidationError(
        `Campo inválido: gross_weights_grams[${index}] (peso bruto do rolo ${index + 1}) deve ser maior que o peso líquido nominal (${nominalWeightGrams}g).`,
      );
    }
    return raw;
  });
}

// ---------------------------------------------------------------------------
// POST /inventory-purchases -> register_inventory_purchase(p_category,
//   p_quantity, p_item_value, p_freight_value, p_changed_by, p_occurred_at,
//   p_notes, p_idempotency_key, p_item_id, p_material, p_manufacturer,
//   p_line, p_commercial_color, p_nominal_weight_grams, p_gross_weights_grams,
//   p_filament_type_id)
// ---------------------------------------------------------------------------
export function validateRegisterInventoryPurchasePayload(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, PURCHASE_KEYS, "corpo da requisição");

  const category = requirePurchaseCategory(body.category);
  const quantity = requirePositiveIntegerQuantity(body.quantity);
  const itemValue = requireNumber(body.item_value, "item_value", { min: 0 });
  const freightValue = optionalNumber(body.freight_value, "freight_value", { min: 0 }) ?? 0;
  const occurredAt = optionalTimestamp(body.occurred_at, "occurred_at");
  const notes = optionalNonEmptyString(body.notes, "notes");
  const idempotencyKey = optionalNonEmptyString(body.idempotency_key, "idempotency_key");

  const common = {
    p_category: category,
    p_quantity: quantity,
    p_item_value: itemValue,
    p_freight_value: freightValue,
    p_occurred_at: occurredAt,
    p_notes: notes,
    p_idempotency_key: idempotencyKey,
  };

  if (category === "ACCESSORY" || category === "PACKAGING") {
    const filamentOnlyKeys = [
      "material",
      "manufacturer",
      "line",
      "commercial_color",
      "nominal_weight_grams",
      "gross_weights_grams",
    ];
    const present = filamentOnlyKeys.filter((key) => body[key] !== undefined);
    if (present.length > 0) {
      throw new ValidationError(
        `Campo(s) não aplicável(is) à categoria ${category}: ${present.join(", ")}.`,
      );
    }

    return {
      ...common,
      p_item_id: requireUuid(body.item_id, "item_id"),
    };
  }

  // FILAMENT
  if (body.item_id !== undefined) {
    throw new ValidationError("Campo não aplicável à categoria FILAMENT: item_id.");
  }

  // Caminho novo (2026-09-04): a interface escolhe um filament_type_id já
  // cadastrado — nunca os 4 campos legados de identidade (material/
  // manufacturer/line/commercial_color) junto dele. nominal_weight_grams e
  // gross_weights_grams continuam sempre exigidos nos dois caminhos (são
  // propriedades do ROLO comprado, não da identidade do tipo).
  const legacyIdentityKeys = ["material", "manufacturer", "line", "commercial_color"] as const;
  const hasFilamentTypeId = body.filament_type_id !== undefined;
  const presentLegacyKeys = legacyIdentityKeys.filter((key) => body[key] !== undefined);

  if (hasFilamentTypeId && presentLegacyKeys.length > 0) {
    throw new ValidationError(
      `Campo(s) não aplicável(is) quando filament_type_id é informado: ${presentLegacyKeys.join(", ")}.`,
    );
  }

  const nominalWeightGrams = requireNumber(body.nominal_weight_grams, "nominal_weight_grams", { min: 0.01 });
  const grossWeightsGrams = requireGrossWeightsGrams(body.gross_weights_grams, quantity, nominalWeightGrams);

  if (hasFilamentTypeId) {
    return {
      ...common,
      p_filament_type_id: requireUuid(body.filament_type_id, "filament_type_id"),
      p_nominal_weight_grams: nominalWeightGrams,
      p_gross_weights_grams: grossWeightsGrams,
    };
  }

  // Caminho legado (find-or-create por nome), preservado para compatibilidade.
  const material = requireFilamentMaterial(body.material);
  const manufacturer = requireTrimmedString(body.manufacturer, "manufacturer");
  const line = requireTrimmedString(body.line, "line");
  const commercialColor = requireTrimmedString(body.commercial_color, "commercial_color");

  return {
    ...common,
    p_material: material,
    p_manufacturer: manufacturer,
    p_line: line,
    p_commercial_color: commercialColor,
    p_nominal_weight_grams: nominalWeightGrams,
    p_gross_weights_grams: grossWeightsGrams,
  };
}

async function handleRegisterInventoryPurchase(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const params = validateRegisterInventoryPurchasePayload(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("register_inventory_purchase", {
    ...params,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 201);
}

// ---------------------------------------------------------------------------
// POST /inventory-purchases/filament -> register_filament_purchase
//   (p_freight_value, p_changed_by, p_items, p_occurred_at, p_notes,
//   p_idempotency_key, p_purchase_channel) — compra de filamento com UM OU
//   MAIS itens (2026-09-04). Cada item exige filament_type_id (tipo já
//   cadastrado e ATIVO — nunca cria nem localiza por nome), manufacturer
//   (marca da compra, distinta do fabricante interno do tipo),
//   nominal_weight_grams, quantity e total_value (2026-09-05, migration
//   20260905160000 — valor pago por TODOS os rolos da linha; unit_value é
//   calculado dentro da RPC, nunca aceito aqui). Sem peso bruto individual
//   por rolo nesta rota (requisito explícito da janela nova) — cada rolo
//   nasce sem empty_spool_weight_grams/initial_gross_weight_grams,
//   exatamente como um rolo criado manualmente. purchase_channel (2026-09-04,
//   migration 20260904140000_add_purchase_channel_to_filament_purchases.sql)
//   é o local/canal da compra — obrigatório, fechado aos 4 valores oficiais.
// ---------------------------------------------------------------------------

// SITE/OUTRO acrescentados em 2026-09-04 (migration
// 20260904150000_add_site_outro_purchase_channels.sql) — sem campo de texto
// livre adicional para "Outro" nesta rodada.
const PURCHASE_CHANNELS = [
  "MERCADO_LIVRE",
  "ALIEXPRESS",
  "SHOPEE",
  "PRESENCIAL",
  "SITE",
  "OUTRO",
] as const;

const FILAMENT_PURCHASE_KEYS = [
  "freight_value",
  "occurred_at",
  "notes",
  "idempotency_key",
  "items",
  "purchase_channel",
] as const;

const FILAMENT_PURCHASE_ITEM_KEYS = [
  "filament_type_id",
  "manufacturer",
  "nominal_weight_grams",
  "quantity",
  "total_value",
] as const;

export function requirePurchaseChannel(value: unknown): (typeof PURCHASE_CHANNELS)[number] {
  if (typeof value !== "string" || !(PURCHASE_CHANNELS as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: purchase_channel deve ser um de: ${PURCHASE_CHANNELS.join(", ")}.`);
  }
  return value as (typeof PURCHASE_CHANNELS)[number];
}

export interface FilamentPurchaseItemParams {
  filament_type_id: string;
  manufacturer: string;
  nominal_weight_grams: number;
  quantity: number;
  total_value: number;
}

// total_value (2026-09-05, substitui unit_value neste contrato): o quanto o
// usuário pagou por TODOS os rolos desta linha, exatamente como informado —
// nunca dividido pelo frontend antes do envio. register_filament_purchase
// (migration 20260905160000) grava este valor tal como recebido e deriva
// unit_value internamente (round(total_value/quantity, 2)); o subtotal do
// cabeçalho soma total_value de cada item diretamente, nunca
// quantity*unit_value, então não sofre o arredondamento de centavo mesmo
// quando a divisão não é exata.
export function validateFilamentPurchaseItem(
  value: unknown,
  index: number,
): FilamentPurchaseItemParams {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`Campo inválido: items[${index}] deve ser um objeto.`);
  }
  const item = value as Record<string, unknown>;
  rejectUnknownKeys(item, FILAMENT_PURCHASE_ITEM_KEYS, `items[${index}]`);

  const totalValue = requireNumber(item.total_value, `items[${index}].total_value`);
  if (totalValue <= 0) {
    throw new ValidationError(`Campo inválido: items[${index}].total_value deve ser maior que zero.`);
  }

  return {
    filament_type_id: requireUuid(item.filament_type_id, `items[${index}].filament_type_id`),
    manufacturer: requireTrimmedString(item.manufacturer, `items[${index}].manufacturer`),
    nominal_weight_grams: requireNumber(item.nominal_weight_grams, `items[${index}].nominal_weight_grams`, {
      min: 0.01,
    }),
    quantity: requirePositiveIntegerQuantity(item.quantity),
    total_value: totalValue,
  };
}

export function validateRegisterFilamentPurchasePayload(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, FILAMENT_PURCHASE_KEYS, "corpo da requisição");

  const freightValue = optionalNumber(body.freight_value, "freight_value", { min: 0 }) ?? 0;
  const occurredAt = optionalTimestamp(body.occurred_at, "occurred_at");
  const notes = optionalNonEmptyString(body.notes, "notes");
  const idempotencyKey = optionalNonEmptyString(body.idempotency_key, "idempotency_key");
  const purchaseChannel = requirePurchaseChannel(body.purchase_channel);

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ValidationError("Campo inválido: items deve ser uma lista com ao menos um item de compra.");
  }

  const items = body.items.map((raw, index) => validateFilamentPurchaseItem(raw, index));

  return {
    p_freight_value: freightValue,
    p_occurred_at: occurredAt,
    p_notes: notes,
    p_idempotency_key: idempotencyKey,
    p_items: items,
    p_purchase_channel: purchaseChannel,
  };
}

async function handleRegisterFilamentPurchase(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const params = validateRegisterFilamentPurchasePayload(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("register_filament_purchase", {
    ...params,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 201);
}
