// Handler + validadores da Edge Function `inventory-purchases` — sem nenhum
// efeito colateral de módulo (nenhum Deno.serve aqui), mesmo padrão de
// stock-movements/handler.ts e filament-spools/handler.ts.
//
// Rota:
//   POST /inventory-purchases -> RPC register_inventory_purchase
//
// register_inventory_purchase é security definer com EXECUTE concedido só a
// service_role (supabase/migrations/20260828121000_create_register_inventory_purchase_function.sql)
// — só alcançável a partir desta Edge Function, nunca diretamente do
// frontend. Nenhuma escrita direta em inventory_purchases, filament_types,
// filament_spools, filament_movements, stock_movements ou nos saldos
// materializados (accessories/packaging.current_stock,
// filament_spools.current_net_weight_grams) acontece nesta Edge Function —
// a RPC é a única forma de escrita, numa única transação.
//
// Validação estrutural (payload) vive aqui: category dentro do enum
// conhecido, quantity como inteiro positivo, item_value/freight_value como
// número não-negativo, e os campos específicos de cada categoria (item_id
// para ACCESSORY/PACKAGING; material/marca/acabamento/cor/peso nominal/
// pesos brutos para FILAMENT) — tudo que não depende de ler o banco. Regras
// que dependem do banco (item realmente existe e está ativo, tipo de
// filamento já existe ou precisa ser criado, tipo inativo correspondente,
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
  // FILAMENT
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
//   p_line, p_commercial_color, p_nominal_weight_grams, p_gross_weights_grams)
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

  const material = requireFilamentMaterial(body.material);
  const manufacturer = requireTrimmedString(body.manufacturer, "manufacturer");
  const line = requireTrimmedString(body.line, "line");
  const commercialColor = requireTrimmedString(body.commercial_color, "commercial_color");
  const nominalWeightGrams = requireNumber(body.nominal_weight_grams, "nominal_weight_grams", { min: 0.01 });
  const grossWeightsGrams = requireGrossWeightsGrams(body.gross_weights_grams, quantity, nominalWeightGrams);

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
