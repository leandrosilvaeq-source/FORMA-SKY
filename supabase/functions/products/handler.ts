// Handler + validadores da Edge Function `products` — sem nenhum efeito
// colateral de módulo (nenhum Deno.serve aqui), mesmo padrão de
// accessories/handler.ts, stock-movements/handler.ts e
// inventory-purchases/handler.ts. Extraído de index.ts nesta rodada
// (Módulo 3, Incremento 6A — composição de filamentos) especificamente para
// permitir testes locais sem abrir um listener HTTP real — mesmo motivo já
// documentado nos arquivos irmãos. Rotas/lógica de POST /products, PATCH
// .../price e PATCH .../composition são movidas aqui SEM NENHUMA alteração
// de comportamento (só de localização do código) — preservação explícita
// exigida para Acessórios/Embalagens/Preço, já implementados e validados.
//
// Rotas:
//   POST   /products                   -> RPC create_product
//   PATCH  /products/:id               -> RPC update_product (NOVA — 2026-08-29)
//   PATCH  /products/:id/price         -> RPC update_product_price
//   PATCH  /products/:id/composition   -> RPC set_product_composition
//   PATCH  /products/:id/filaments     -> RPC set_product_filaments (Incremento 6A)
//
// As cinco RPCs são security definer com EXECUTE concedido só a
// service_role (supabase/migrations/20260814030351_create_order_business_functions.sql,
// 20260816150500_create_product_composition_function.sql,
// 20260827113000_create_product_filaments_table.sql,
// 20260829143000_add_product_edit_function.sql) — só alcançáveis a partir
// desta Edge Function, nunca diretamente do frontend.
//
// PATCH /products/:id (NOVA, 2026-08-29): substitui o antigo botão "Alterar
// preço" por "Editar produto" no frontend — edita campos descritivos/de
// produção (whitelist de update_product, nunca default_price). Rota própria,
// deliberadamente distinta de .../price: o preço continua exigindo sua
// própria chamada a update_product_price (histórico em
// product_price_history) — "Editar produto" no frontend pode disparar as
// duas chamadas quando o preço muda, mas cada uma continua atômica por si,
// nunca uma transação conjunta.
//
// composition/filaments usam PATCH, não PUT: _shared/cors.ts só libera
// "GET, POST, PUT, PATCH, DELETE, OPTIONS" em Access-Control-Allow-Methods
// para todas as Edge Functions do Bloco 1 — adicionar PUT exigiria alterar
// um arquivo compartilhado fora do escopo desta subetapa. PATCH é
// semanticamente aceitável aqui (já é o verbo usado por .../price e
// .../composition) mesmo a operação sendo uma substituição completa, não
// incremental.
//
// PATCH /products/:id/filaments é deliberadamente uma ROTA PRÓPRIA, nunca
// mesclada em /composition: set_product_filaments (RPC) já é uma function
// separada e independente de set_product_composition (decisão de
// arquitetura já tomada em 20260827113000_create_product_filaments_table.sql
// — "nunca duplicar/alterar a function já testada de acessórios/
// embalagens"). Uma rota própria preserva essa mesma separação até a borda
// HTTP: salvar Filamentos nunca depende de, nem interfere com, salvar
// Acessórios/Embalagens — duas chamadas HTTP independentes, cada uma
// atômica por si (uma única transação Postgres dentro de cada RPC), nunca
// uma transação conjunta cobrindo as duas.

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

// Mesmos 3 valores técnicos de item_type (order_items,
// supabase/migrations/20260814005328_create_order_items_table.sql) — nunca
// reinventados, só reutilizados para classificar o PRODUTO no Catálogo.
// requireEnum é uma cópia local do mesmo helper já usado em
// orders/index.ts (nenhum módulo compartilhado de validação genérica de
// enum existe ainda neste projeto — mesmo critério de "validador
// específico de uma única rota" já aplicado a validateCompositionItems
// abaixo).
const PRODUCT_TYPES = ["CATALOG", "CUSTOM", "SPOT"] as const;

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`Campo inválido: ${field} deve ser um de: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export async function handleRequest(req: Request): Promise<Response> {
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

    if (req.method === "PATCH" && route.length === 1) {
      return await handleUpdateProduct(req, route[0]);
    }

    if (req.method === "PATCH" && route.length === 2 && route[1] === "price") {
      return await handleUpdateProductPrice(req, route[0]);
    }

    if (req.method === "PATCH" && route.length === 2 && route[1] === "composition") {
      return await handleUpdateProductComposition(req, route[0]);
    }

    if (req.method === "PATCH" && route.length === 2 && route[1] === "filaments") {
      return await handleUpdateProductFilaments(req, route[0]);
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
}

// ---------------------------------------------------------------------------
// POST /products -> create_product(p_name, p_product_type, p_category,
//   p_description, p_default_price, p_default_print_time_seconds,
//   p_default_weight_grams, p_units_per_plate, p_default_file_id,
//   p_allows_personalization, p_changed_by)
//
// Nenhum dos 11 parâmetros da função tem DEFAULT no SQL — por isso todos são
// sempre enviados na chamada RPC, usando null explícito para os opcionais
// não informados. `p_allows_personalization = null` é seguro: a própria
// função faz `coalesce(p_allows_personalization, false)` internamente
// (linha 1166 da migration) — não estamos inventando esse default na API,
// só deixando a função aplicar o dela.
//
// p_default_print_time_seconds substitui p_default_print_time_minutes
// (mesma posição/tipo integer — ver migration de renomeação da coluna,
// que também renomeia este parâmetro via CREATE OR REPLACE FUNCTION,
// preservando o mesmo número/tipo de argumentos).
//
// p_product_type: parâmetro novo (migration 20260821090000_add_product_type.sql,
// ainda não aplicada) — sempre obrigatório aqui (nunca opcional/null), o
// formulário sempre envia uma seleção (CATALOG por padrão).
//
// p_units_per_plate: nunca mais lido do corpo da requisição — removido da
// interface de "Novo produto" (decisão aprovada), sempre null aqui. O
// parâmetro continua existindo na assinatura da função (coluna não
// descontinuada nesta rodada), então precisa ser passado explicitamente
// (a função não tem DEFAULT para ele).
// ---------------------------------------------------------------------------
async function handleCreateProduct(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const name = requireString(body.name, "name");
  const productType = requireEnum(body.product_type, "product_type", PRODUCT_TYPES);
  const defaultPrice = requireNumber(body.default_price, "default_price", { min: 0 });
  const category = optionalString(body.category, "category");
  const description = optionalString(body.description, "description");
  const defaultPrintTimeSeconds = optionalInteger(
    body.default_print_time_seconds,
    "default_print_time_seconds",
    { min: 0 },
  );
  const defaultWeightGrams = optionalNumber(body.default_weight_grams, "default_weight_grams", {
    min: 0,
  });
  const defaultFileId = optionalUuid(body.default_file_id, "default_file_id");
  const allowsPersonalization = optionalBoolean(
    body.allows_personalization,
    "allows_personalization",
  );

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("create_product", {
    p_name: name,
    p_product_type: productType,
    p_category: category,
    p_description: description,
    p_default_price: defaultPrice,
    p_default_print_time_seconds: defaultPrintTimeSeconds,
    p_default_weight_grams: defaultWeightGrams,
    p_units_per_plate: null,
    p_default_file_id: defaultFileId,
    p_allows_personalization: allowsPersonalization,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { id: data }, 201);
}

// ---------------------------------------------------------------------------
// PATCH /products/:id -> update_product(p_product_id, p_patch, p_changed_by)
//   -- NOVA (2026-08-29)
//
// Whitelist explícita, espelhando exatamente a whitelist da RPC
// (20260829143000_add_product_edit_function.sql): name, category,
// description, default_print_time_seconds, default_weight_grams,
// default_file_id, allows_personalization. Nunca default_price (só
// update_product_price), is_active (grant direto já existente) nem
// product_type/units_per_plate (fora de escopo). Chave fora da whitelist é
// REJEITADA aqui (400) — a RPC também rejeita, mas rejeitar já na Edge
// Function devolve uma mensagem mais cedo, sem round-trip ao banco.
// ---------------------------------------------------------------------------
const PRODUCT_PATCH_KEYS = [
  "name",
  "category",
  "description",
  "default_print_time_seconds",
  "default_weight_grams",
  "default_file_id",
  "allows_personalization",
] as const;

async function handleUpdateProduct(req: Request, productId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(productId)) {
    throw new ValidationError("Identificador de produto inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const unknownKeys = Object.keys(body).filter(
    (key) => !(PRODUCT_PATCH_KEYS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new ValidationError(
      `Campo(s) não suportado(s) no corpo da requisição: ${unknownKeys.join(", ")}.`,
    );
  }
  if (Object.keys(body).length === 0) {
    throw new ValidationError("Corpo da requisição vazio — informe ao menos um campo reconhecido.");
  }

  const patch: Record<string, unknown> = {};
  if ("name" in body) patch.name = requireString(body.name, "name");
  if ("category" in body) patch.category = optionalString(body.category, "category");
  if ("description" in body) patch.description = optionalString(body.description, "description");
  if ("default_print_time_seconds" in body) {
    patch.default_print_time_seconds = optionalInteger(
      body.default_print_time_seconds,
      "default_print_time_seconds",
      { min: 0 },
    );
  }
  if ("default_weight_grams" in body) {
    patch.default_weight_grams = optionalNumber(
      body.default_weight_grams,
      "default_weight_grams",
      { min: 0 },
    );
  }
  if ("default_file_id" in body) {
    patch.default_file_id = optionalUuid(body.default_file_id, "default_file_id");
  }
  if ("allows_personalization" in body) {
    patch.allows_personalization = optionalBoolean(
      body.allows_personalization,
      "allows_personalization",
    );
  }

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("update_product", {
    p_product_id: productId,
    p_patch: patch,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 200);
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
export function validateCompositionItems(
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

// ---------------------------------------------------------------------------
// PATCH /products/:id/filaments -> set_product_filaments(p_product_id,
//   p_filaments, p_changed_by) — NOVA (Módulo 3, Incremento 6A)
//
// Mesmo idioma de handleUpdateProductComposition: substituição completa
// (filaments ausente/null = composição de filamentos vazia), nunca PATCH
// incremental. set_product_filaments é uma RPC própria e independente de
// set_product_composition (migration 20260827113000) — esta rota chama
// SÓ essa RPC, nunca as duas juntas na mesma requisição, preservando a
// mesma separação/atomicidade independente já decidida no banco.
// ---------------------------------------------------------------------------
async function handleUpdateProductFilaments(req: Request, productId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(productId)) {
    throw new ValidationError("Identificador de produto inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const filaments = validateFilamentCompositionItems(body.filaments, "filaments");

  const admin = getAdminClient();
  const { error } = await admin.rpc("set_product_filaments", {
    p_product_id: productId,
    p_filaments: filaments,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { success: true }, 200);
}

// ---------------------------------------------------------------------------
// Validador local de um array de itens de composição de filamento —
// {id: uuid (filament_type_id), theoretical_weight_grams: número > 0}, sem
// id repetido no mesmo array (impede duplicidade — o mesmo tipo de
// filamento não pode aparecer duas vezes na composição de um produto,
// espelhando unique(product_id, filament_type_id) em product_filaments).
// Mesmo critério de validateCompositionItems (acima): campos não
// revalidados além do necessário para a RPC decidir — a RPC
// (set_product_filaments) é a autoridade final e revalida tipo ativo/peso
// positivo de novo, em profundidade.
// ---------------------------------------------------------------------------
export function validateFilamentCompositionItems(
  raw: unknown,
  field: string,
): Array<{ id: string; theoretical_weight_grams: number }> {
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

    const weight = requireNumber(record.theoretical_weight_grams, `${prefix}.theoretical_weight_grams`, {
      min: 0.01,
    });

    return { id, theoretical_weight_grams: weight };
  });
}
