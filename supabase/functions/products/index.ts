// Edge Function: products
//
// Rotas:
//   POST   /products                   -> RPC create_product
//   PATCH  /products/:id/price         -> RPC update_product_price
//   PATCH  /products/:id/composition   -> RPC set_product_composition
//
// As três RPCs são security definer com EXECUTE concedido só a service_role
// (supabase/migrations/20260814030351_create_order_business_functions.sql,
// 20260816150500_create_product_composition_function.sql) — só alcançáveis a
// partir desta Edge Function, nunca diretamente do frontend.
//
// composition usa PATCH, não PUT: _shared/cors.ts só libera
// "GET, POST, PATCH, DELETE, OPTIONS" em Access-Control-Allow-Methods para
// todas as Edge Functions do Bloco 1 — adicionar PUT exigiria alterar um
// arquivo compartilhado fora do escopo desta subetapa. PATCH é semanticamente
// aceitável aqui (já é o verbo usado por .../price) mesmo a operação sendo
// uma substituição completa, não incremental.

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { NotFoundError, mapPgError, ValidationError } from "../_shared/errors.ts";
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
  requireTimestamp,
  parseJsonBody,
  rejectIdentityFields,
} from "../_shared/validate.ts";

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("products");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (req.method === "POST" && route.length === 0) {
      return await handleCreateProduct(req);
    }

    if (req.method === "PATCH" && route.length === 2 && route[1] === "price") {
      return await handleUpdateProductPrice(req, route[0]);
    }

    if (req.method === "PATCH" && route.length === 2 && route[1] === "composition") {
      return await handleUpdateProductComposition(req, route[0]);
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
});

// ---------------------------------------------------------------------------
// POST /products -> create_product(p_name, p_category, p_description,
//   p_default_price, p_default_print_time_minutes, p_default_weight_grams,
//   p_units_per_plate, p_default_file_id, p_allows_personalization,
//   p_changed_by)
//
// Nenhum dos 10 parâmetros da função tem DEFAULT no SQL — por isso todos são
// sempre enviados na chamada RPC, usando null explícito para os opcionais
// não informados. `p_allows_personalization = null` é seguro: a própria
// função faz `coalesce(p_allows_personalization, false)` internamente
// (linha 1166 da migration) — não estamos inventando esse default na API,
// só deixando a função aplicar o dela.
// ---------------------------------------------------------------------------
async function handleCreateProduct(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const name = requireString(body.name, "name");
  const defaultPrice = requireNumber(body.default_price, "default_price", { min: 0 });
  const category = optionalString(body.category, "category");
  const description = optionalString(body.description, "description");
  const defaultPrintTimeMinutes = optionalInteger(
    body.default_print_time_minutes,
    "default_print_time_minutes",
    { min: 0 },
  );
  const defaultWeightGrams = optionalNumber(body.default_weight_grams, "default_weight_grams", {
    min: 0,
  });
  const unitsPerPlate = optionalInteger(body.units_per_plate, "units_per_plate", { min: 1 });
  const defaultFileId = optionalUuid(body.default_file_id, "default_file_id");
  const allowsPersonalization = optionalBoolean(
    body.allows_personalization,
    "allows_personalization",
  );

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("create_product", {
    p_name: name,
    p_category: category,
    p_description: description,
    p_default_price: defaultPrice,
    p_default_print_time_minutes: defaultPrintTimeMinutes,
    p_default_weight_grams: defaultWeightGrams,
    p_units_per_plate: unitsPerPlate,
    p_default_file_id: defaultFileId,
    p_allows_personalization: allowsPersonalization,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { id: data }, 201);
}

// ---------------------------------------------------------------------------
// PATCH /products/:id/price -> update_product_price(p_product_id,
//   p_new_price, p_changed_by, p_reason default null,
//   p_effective_from default now())
//
// p_reason tem DEFAULT null no SQL — equivalente a enviar null
// explicitamente, então sempre incluímos a chave.
//
// p_effective_from tem DEFAULT now() no SQL (calculado no momento da
// execução da função no banco). Se o cliente não informar effective_from,
// a chave p_effective_from é OMITIDA do objeto de parâmetros — não
// reproduzimos "now()" aqui no código da Edge Function, para não divergir
// do instante real em que a função roda no banco. Só incluímos a chave
// quando o cliente manda um valor explícito.
// ---------------------------------------------------------------------------
async function handleUpdateProductPrice(req: Request, productId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(productId)) {
    throw new ValidationError("Identificador de produto inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const newPrice = requireNumber(body.new_price, "new_price", { min: 0 });
  const reason = optionalString(body.reason, "reason");

  const params: Record<string, unknown> = {
    p_product_id: productId,
    p_new_price: newPrice,
    p_changed_by: operator.userId,
    p_reason: reason,
  };

  if (body.effective_from !== undefined && body.effective_from !== null) {
    params.p_effective_from = requireTimestamp(body.effective_from, "effective_from");
  }

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("update_product_price", params);

  if (error) throw mapPgError(error);

  return jsonResponse(req, { price_history_id: data }, 200);
}

// ---------------------------------------------------------------------------
// PATCH /products/:id/composition -> set_product_composition(p_product_id,
//   p_accessories, p_packaging, p_changed_by)
//
// Substituição completa: accessories/packaging ausentes ou null no corpo
// equivalem a "nenhum item desse lado" (composição vazia daquele tipo),
// nunca a "manter o que já existia" — não há PATCH incremental nesta rota,
// mesmo o verbo HTTP sendo PATCH (ver nota no topo do arquivo).
// ---------------------------------------------------------------------------
async function handleUpdateProductComposition(req: Request, productId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(productId)) {
    throw new ValidationError("Identificador de produto inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const accessories = validateCompositionItems(body.accessories, "accessories");
  const packaging = validateCompositionItems(body.packaging, "packaging");

  const admin = getAdminClient();
  const { error } = await admin.rpc("set_product_composition", {
    p_product_id: productId,
    p_accessories: accessories,
    p_packaging: packaging,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { success: true }, 200);
}

// ---------------------------------------------------------------------------
// Validador local de um array de itens de composição (accessories/packaging)
// — {id: uuid, quantity: inteiro > 0}, sem id repetido no mesmo array. Não
// promovido a _shared/validate.ts nesta etapa: mesmo critério já usado em
// orders/index.ts para validadores específicos de uma única rota.
// ---------------------------------------------------------------------------
function validateCompositionItems(
  raw: unknown,
  field: string,
): Array<{ id: string; quantity: number }> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError(`Campo inválido: ${field} deve ser um array.`);
  }

  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const prefix = `${field}[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ValidationError(`Campo inválido: ${prefix} deve ser um objeto.`);
    }
    const record = entry as Record<string, unknown>;

    if (!isUuid(record.id)) {
      throw new ValidationError(`Campo inválido: ${prefix}.id deve ser um UUID.`);
    }
    const id = record.id as string;
    if (seen.has(id)) {
      throw new ValidationError(`Campo inválido: ${field} não pode repetir o mesmo id (${id}).`);
    }
    seen.add(id);

    const quantity = requireNumber(record.quantity, `${prefix}.quantity`, { min: 1 });
    if (!Number.isInteger(quantity)) {
      throw new ValidationError(`Campo inválido: ${prefix}.quantity deve ser um número inteiro.`);
    }

    return { id, quantity };
  });
}
