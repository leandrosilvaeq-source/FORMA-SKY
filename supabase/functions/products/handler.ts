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
//   PATCH  /products/:id/filaments     -> DESCONTINUADA (rodada corretiva 2026-08-29):
//                                          nunca mais chama set_product_filaments;
//                                          responde sempre com um erro de negócio
//                                          (PRODUCT_FILAMENTS_ROUTE_RETIRED:) depois
//                                          de autenticar — ver comentário da própria
//                                          função abaixo.
//   POST   /products/with-plates       -> RPC create_product_with_plates (NOVA — estrutura por plates, 2026-08-29)
//   PATCH  /products/:id/full          -> RPC update_product_full (NOVA — estrutura por plates, 2026-08-29)
//
// As sete RPCs são security definer com EXECUTE concedido só a
// service_role (supabase/migrations/20260814030351_create_order_business_functions.sql,
// 20260816150500_create_product_composition_function.sql,
// 20260827113000_create_product_filaments_table.sql,
// 20260829143000_add_product_edit_function.sql,
// 20260829160000_add_product_plates_structure.sql) — só alcançáveis a
// partir desta Edge Function, nunca diretamente do frontend.
//
// POST /products/with-plates e PATCH /products/:id/full (NOVAS,
// 2026-08-29 — estrutura produtiva por plates, ainda não aplicada ao
// remoto): o novo formulário "Novo Produto"/"Editar produto" (3 seções —
// Dados Gerais/Composição por plates/Acessórios e Embalagem) passa a usar
// exclusivamente estas duas rotas para criar/editar um Produto — Produto +
// plates + filamentos por plate + totais/ajuste manual + Acessórios +
// Embalagens são salvos numa ÚNICA chamada atômica cada (create_product_with_plates/
// update_product_full), nunca várias chamadas HTTP separadas. As rotas
// antigas POST /products, PATCH /:id e PATCH /:id/composition continuam
// existindo e funcionando exatamente como antes — nenhuma removida, nenhuma
// alterada — preservando 100% de compatibilidade para qualquer uso direto
// delas fora do novo formulário. PATCH /:id/filaments é a ÚNICA exceção
// (rodada corretiva 2026-08-29): continua existindo como ROTA (nunca 404,
// autenticação preservada), mas foi DESCONTINUADA para escrita — ver
// comentário de handleUpdateProductFilaments logo abaixo e "FONTE
// AUTORITATIVA" em supabase/migrations/20260829160000_add_product_plates_structure.sql.
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
import { BusinessRuleError, NotFoundError, mapPgError, ValidationError } from "../_shared/errors.ts";
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

    if (req.method === "POST" && route.length === 1 && route[0] === "with-plates") {
      return await handleCreateProductWithPlates(req);
    }

    if (req.method === "PATCH" && route.length === 2 && route[1] === "full") {
      return await handleUpdateProductFull(req, route[0]);
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
// DESCONTINUADA para escrita operacional (rodada corretiva 2026-08-29 —
// ver "FONTE AUTORITATIVA" no cabeçalho de
// supabase/migrations/20260829160000_add_product_plates_structure.sql).
// Uma auditoria encontrou que, mesmo depois de product_plates passar a
// existir, esta rota continuava chamando set_product_filaments — uma
// segunda fonte de escrita operacional para a mesma composição que
// PATCH /products/:id/full (update_product_full) já cobre integralmente,
// inclusive para Produtos com múltiplos plates (que esta rota legada nunca
// soube representar, por só conhecer uma composição "flat" por Produto).
// A partir desta rodada, a rota continua respondendo (nunca 404 — mantém
// autenticação e validação de UUID exatamente como antes), mas rejeita
// TODA chamada com um erro de negócio claro, ANTES de sequer montar o
// corpo ou chamar a RPC — set_product_filaments nunca é invocada daqui em
// diante. A própria RPC também perde o EXECUTE de service_role
// na migration pendente (defesa em profundidade, nível banco) — as duas
// camadas juntas garantem que não sobra nenhum caminho de escrita
// operacional independente em product_filaments.
async function handleUpdateProductFilaments(req: Request, productId: string): Promise<Response> {
  await resolveOperator(req);

  if (!isUuid(productId)) {
    throw new ValidationError("Identificador de produto inválido na rota.");
  }

  throw new BusinessRuleError(
    "PRODUCT_FILAMENTS_ROUTE_RETIRED: Esta rota foi descontinuada. Altere a composição de filamentos pelo fluxo completo de edição do Produto (PATCH /products/:id/full), que suporta múltiplos plates.",
  );
}

// ---------------------------------------------------------------------------
// Validador local da estrutura de plates — a partir da rodada de
// reorganização (2026-08-29, migration
// 20260829180000_add_categories_plate_weight_and_order_colors.sql,
// pendente), plate NUNCA mais carrega filamentos/cores (removidos do
// cadastro do Produto — cores agora são escolhidas no Pedido, por unidade
// e por plate). Array de:
//   { production_time_seconds: inteiro >= 0, weight_grams: número >= 0 }
// A posição no array define o número do plate (Plate 1, Plate 2, ...) —
// nunca um campo separado no payload, para nunca haver buraco/duplicata.
// A RPC (set_product_production) continua sendo a autoridade final —
// esta função só evita um round-trip ao banco para os erros mais comuns.
// ---------------------------------------------------------------------------
export interface PlateInput {
  production_time_seconds: number;
  weight_grams: number;
}

export function validatePlates(raw: unknown, field: string): PlateInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError(`Campo inválido: ${field} deve ser um array.`);
  }

  return raw.map((entry, index) => {
    const prefix = `${field}[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ValidationError(`Campo inválido: ${prefix} deve ser um objeto.`);
    }
    const record = entry as Record<string, unknown>;

    const productionTimeSeconds = requireNumber(
      record.production_time_seconds,
      `${prefix}.production_time_seconds`,
      { min: 0 },
    );
    if (!Number.isInteger(productionTimeSeconds)) {
      throw new ValidationError(`Campo inválido: ${prefix}.production_time_seconds deve ser um número inteiro.`);
    }

    const weightGrams = requireNumber(record.weight_grams, `${prefix}.weight_grams`, { min: 0 });

    return { production_time_seconds: productionTimeSeconds, weight_grams: weightGrams };
  });
}

// ---------------------------------------------------------------------------
// Validador local de múltiplas categorias (2026-08-29, mesma migration) —
// array de strings não vazias, sem repetição (case-sensitive, mesmo texto
// livre que a antiga categoria única já aceitava, incl. valores digitados
// em "Outro"). A ORDEM no array define a posição (categories[0] é o valor
// espelhado em products.category pela RPC). A RPC (set_product_categories)
// continua sendo a autoridade final.
// ---------------------------------------------------------------------------
export function validateCategories(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError(`Campo inválido: ${field} deve ser um array.`);
  }

  const seen = new Set<string>();
  return raw.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new ValidationError(`Campo inválido: ${field}[${index}] deve ser um texto.`);
    }
    const trimmed = entry.trim();
    if (trimmed === "") {
      throw new ValidationError(`Campo inválido: ${field}[${index}] não pode ser vazio.`);
    }
    if (seen.has(trimmed)) {
      throw new ValidationError(`Campo inválido: ${field} não pode repetir a mesma categoria (${trimmed}).`);
    }
    seen.add(trimmed);
    return trimmed;
  });
}

// ---------------------------------------------------------------------------
// POST /products/with-plates -> create_product_with_plates(p_name,
//   p_product_type, p_category, p_description, p_default_price,
//   p_default_file_id, p_allows_personalization, p_plates,
//   p_manual_weight_override_grams, p_manual_time_override_seconds,
//   p_accessories, p_packaging, p_changed_by) — NOVA, 2026-08-29
//
// Mesma validação de campos descritivos de handleCreateProduct (nome/tipo/
// categoria/descrição/preço/arquivo/personalização) — default_print_time_seconds/
// default_weight_grams NÃO são lidos do corpo aqui (não fazem parte deste
// contrato: o peso/tempo efetivos vêm de p_plates + o ajuste manual
// opcional, nunca digitados soltos nesta rota). manual_weight_override_grams/
// manual_time_override_seconds são independentes um do outro (qualquer um
// pode estar ausente/null enquanto o outro está presente).
// ---------------------------------------------------------------------------
async function handleCreateProductWithPlates(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const name = requireString(body.name, "name");
  const productType = requireEnum(body.product_type, "product_type", PRODUCT_TYPES);
  const defaultPrice = requireNumber(body.default_price, "default_price", { min: 0 });
  const categories = validateCategories(body.categories, "categories");
  const description = optionalString(body.description, "description");
  const defaultFileId = optionalUuid(body.default_file_id, "default_file_id");
  const allowsPersonalization = optionalBoolean(body.allows_personalization, "allows_personalization");

  const plates = validatePlates(body.plates, "plates");
  const manualWeightOverrideGrams = optionalNumber(
    body.manual_weight_override_grams,
    "manual_weight_override_grams",
    { min: 0 },
  );
  const manualTimeOverrideSecondsRaw = optionalInteger(
    body.manual_time_override_seconds,
    "manual_time_override_seconds",
    { min: 0 },
  );
  const accessories = validateCompositionItems(body.accessories, "accessories");
  const packaging = validateCompositionItems(body.packaging, "packaging");

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("create_product_with_plates", {
    p_name: name,
    p_product_type: productType,
    p_categories: categories,
    p_description: description,
    p_default_price: defaultPrice,
    p_default_file_id: defaultFileId,
    p_allows_personalization: allowsPersonalization,
    p_plates: plates,
    p_manual_weight_override_grams: manualWeightOverrideGrams,
    p_manual_time_override_seconds: manualTimeOverrideSecondsRaw,
    p_accessories: accessories,
    p_packaging: packaging,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { id: data }, 201);
}

// ---------------------------------------------------------------------------
// PATCH /products/:id/full -> update_product_full(p_product_id, p_patch,
//   p_plates, p_manual_weight_override_grams, p_manual_time_override_seconds,
//   p_accessories, p_packaging, p_changed_by) — NOVA, 2026-08-29
//
// p_patch: mesma whitelist/validação de handleUpdateProduct (PRODUCT_PATCH_KEYS)
// — mas aqui é OPCIONAL como um todo: um corpo sem nenhuma das chaves de
// PRODUCT_PATCH_KEYS é válido (a seção "Dados Gerais" pode não ter mudado
// nesta edição), a RPC decide não chamar update_product() nesse caso.
// Chaves DESCONHECIDAS (fora de PRODUCT_PATCH_KEYS ∪ {plates, manual_weight_override_grams,
// manual_time_override_seconds, accessories, packaging}) continuam
// rejeitadas, mesmo critério de handleUpdateProduct.
// ---------------------------------------------------------------------------
// Whitelist do p_patch de update_product_full — DELIBERADAMENTE não reusa
// PRODUCT_PATCH_KEYS (que ainda inclui "category", exclusiva de
// handleUpdateProduct/update_product, rota antiga preservada): a partir da
// migration 20260829180000, categorias são SEMPRE substituição completa
// via p_categories (Seção 2/6 da migration) — "category" nunca é aceita
// dentro do patch desta rota, para nunca haver duas fontes concorrentes.
const PRODUCT_FULL_PATCH_KEYS = [
  "name",
  "description",
  "default_file_id",
  "allows_personalization",
] as const;

const PRODUCT_FULL_KEYS = [
  ...PRODUCT_FULL_PATCH_KEYS,
  "categories",
  "plates",
  "manual_weight_override_grams",
  "manual_time_override_seconds",
  "accessories",
  "packaging",
] as const;

async function handleUpdateProductFull(req: Request, productId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(productId)) {
    throw new ValidationError("Identificador de produto inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);

  const unknownKeys = Object.keys(body).filter(
    (key) => !(PRODUCT_FULL_KEYS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new ValidationError(
      `Campo(s) não suportado(s) no corpo da requisição: ${unknownKeys.join(", ")}.`,
    );
  }

  const patch: Record<string, unknown> = {};
  if ("name" in body) patch.name = requireString(body.name, "name");
  if ("description" in body) patch.description = optionalString(body.description, "description");
  if ("default_file_id" in body) {
    patch.default_file_id = optionalUuid(body.default_file_id, "default_file_id");
  }
  if ("allows_personalization" in body) {
    patch.allows_personalization = optionalBoolean(
      body.allows_personalization,
      "allows_personalization",
    );
  }

  const categories = validateCategories(body.categories, "categories");
  const plates = validatePlates(body.plates, "plates");
  const manualWeightOverrideGrams = optionalNumber(
    body.manual_weight_override_grams,
    "manual_weight_override_grams",
    { min: 0 },
  );
  const manualTimeOverrideSecondsRaw = optionalInteger(
    body.manual_time_override_seconds,
    "manual_time_override_seconds",
    { min: 0 },
  );
  const accessories = validateCompositionItems(body.accessories, "accessories");
  const packaging = validateCompositionItems(body.packaging, "packaging");

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("update_product_full", {
    p_product_id: productId,
    p_patch: patch,
    p_categories: categories,
    p_plates: plates,
    p_manual_weight_override_grams: manualWeightOverrideGrams,
    p_manual_time_override_seconds: manualTimeOverrideSecondsRaw,
    p_accessories: accessories,
    p_packaging: packaging,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 200);
}
