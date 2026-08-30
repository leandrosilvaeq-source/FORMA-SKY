// Leitura direta via supabase-js: public.products concede SELECT a
// authenticated (supabase/migrations/20260813205942_create_products_table.sql).
// Escrita: default_price é coluna controlada (sem UPDATE direto concedido a
// authenticated), então criação e alteração de preço sempre passam pela
// Edge Function `products` (RPCs create_product/update_product_price). Já
// is_active está na lista de colunas com GRANT UPDATE direto a authenticated
// (mesma migration, RLS "Active users can update products"), então
// ativar/desativar produto usa supabase-js direto, igual a customers.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import { callEdgeFunction } from './edgeFunctionClient'
// Acessórios/Embalagens reaproveitam exatamente o mesmo formato já usado
// por lib/api/productComposition.ts ({id, quantity}) — não redeclarado
// aqui, só referenciado nos tipos abaixo para não duplicar a forma.
import type { ProductCompositionItemInput } from './productComposition'
import type { Product, ProductCategory, ProductPriceHistory, ProductType } from '@/types/domain'

// units_per_plate deliberadamente ausente deste contrato: removido da
// interface de "Novo produto" (decisão aprovada) — o backend continua
// sempre recebendo null para esse parâmetro (a coluna/parâmetro da RPC
// ainda existe, só não é mais preenchível por aqui; ver
// supabase/functions/products/index.ts).
export interface CreateProductInput {
  name: string
  // products.product_type — migration 20260821090000_add_product_type.sql
  // (ainda não aplicada). Sempre enviado (nunca omitido): o formulário
  // sempre tem uma seleção (CATALOG por padrão para produtos novos).
  product_type: ProductType
  default_price: number
  category?: string | null
  description?: string | null
  // Segundos inteiros (products.default_print_time_seconds) — substitui
  // default_print_time_minutes (integer, minutos) desde a migration que
  // renomeia a coluna e converte os valores legados (*60).
  default_print_time_seconds?: number | null
  default_weight_grams?: number | null
  default_file_id?: string | null
  allows_personalization?: boolean | null
}

export interface UpdateProductPriceInput {
  new_price: number
  reason?: string | null
  effective_from?: string
}

export interface UpdateProductInput {
  is_active?: boolean
}

// PATCH /products/:id (20260829143000_add_product_edit_function.sql, ainda
// não aplicada) — whitelist de update_product, nunca default_price (só
// updateProductPrice, abaixo) nem is_active (updateProduct, acima, grant
// direto). Cada chave é opcional: omitida preserva o valor atual (semântica
// PATCH da própria RPC).
export interface UpdateProductDetailsInput {
  name?: string
  category?: string | null
  description?: string | null
  default_print_time_seconds?: number | null
  default_weight_grams?: number | null
  default_file_id?: string | null
  allows_personalization?: boolean
}

// Estrutura produtiva por plates — migration
// 20260829180000_add_categories_plate_weight_and_order_colors.sql (ainda não
// aplicada) retirou toda composição de filamento do plate do Produto:
// weight_grams passa a ser informado diretamente (não mais somado de
// PlateFilamentItemInput[], removido). A posição no array (índice) define o
// número do plate (Plate 1, Plate 2, ...), nunca um campo separado aqui —
// mesmo contrato de PlateInput em supabase/functions/products/handler.ts.
export interface PlateInput {
  production_time_seconds: number
  weight_grams: number
}

// POST /products/with-plates -> create_product_with_plates. category (string
// única) substituído por categories (array de strings, N por Produto) pela
// migration 20260829180000 (ainda não aplicada) — nunca os dois ao mesmo
// tempo; products.category continua existindo só como espelho DERIVADO,
// nunca aceito neste contrato. manual_weight_override_grams/
// manual_time_override_seconds são independentes um do outro — cada um pode
// estar ausente/null enquanto o outro está presente (ver comentário da
// coluna na migration).
export interface CreateProductWithPlatesInput {
  name: string
  product_type: ProductType
  default_price: number
  categories: string[]
  description?: string | null
  default_file_id?: string | null
  allows_personalization?: boolean | null
  plates: PlateInput[]
  manual_weight_override_grams?: number | null
  manual_time_override_seconds?: number | null
  accessories: ProductCompositionItemInput[]
  packaging: ProductCompositionItemInput[]
}

// PATCH /products/:id/full -> update_product_full. Os campos descritivos
// (name/description/default_file_id/allows_personalization) são opcionais
// como um todo — omitir todos preserva os dados descritivos atuais do
// produto, sem exigir reenviar o que não mudou; categories/plates/
// accessories/packaging continuam SEMPRE substituição completa (o
// formulário sempre envia o estado inteiro atual dessas seções a cada
// salvar). category (singular) nunca é aceito nesta rota — só
// PATCH /products/:id (updateProductDetails, abaixo) ainda aceita a chave
// legada "category", que segue existindo só como espelho derivado.
export interface UpdateProductFullInput {
  name?: string
  description?: string | null
  default_file_id?: string | null
  allows_personalization?: boolean
  categories: string[]
  plates: PlateInput[]
  manual_weight_override_grams?: number | null
  manual_time_override_seconds?: number | null
  accessories: ProductCompositionItemInput[]
  packaging: ProductCompositionItemInput[]
}

export async function listProducts(): Promise<Product[]> {
  const { data, error } = await supabase.from('products').select('*').order('name', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as Product[]
}

// Busca individual por id — usada pela Ficha Técnica do Produto (acesso
// direto pela URL, não depende da listagem já ter sido carregada).
// maybeSingle() (em vez de single()) devolve null em vez de lançar erro
// quando 0 linhas batem — permite diferenciar "produto não encontrado" de
// um erro real de rede/API no chamador.
export async function getProduct(id: string): Promise<Product | null> {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle()

  if (error) throw mapSupabaseError(error)
  return data as Product | null
}

export async function updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
  const { data, error } = await supabase.from('products').update(input).eq('id', id).select().single()

  if (error) throw mapSupabaseError(error)
  return data as Product
}

// POST /products -> create_product (supabase/functions/products/index.ts).
export async function createProduct(input: CreateProductInput): Promise<{ id: string }> {
  return callEdgeFunction<{ id: string }>('products', '', 'POST', input)
}

// PATCH /products/:id/price -> update_product_price.
export async function updateProductPrice(
  productId: string,
  input: UpdateProductPriceInput,
): Promise<{ price_history_id: string }> {
  return callEdgeFunction<{ price_history_id: string }>('products', `/${productId}/price`, 'PATCH', input)
}

// PATCH /products/:id -> update_product (NOVA, 2026-08-29). Devolve a linha
// completa do produto (RPC retorna public.products via RETURNING *).
export async function updateProductDetails(
  productId: string,
  input: UpdateProductDetailsInput,
): Promise<Product> {
  return callEdgeFunction<Product>('products', `/${productId}`, 'PATCH', input)
}

// Leitura direta via supabase-js: public.product_price_history concede só
// SELECT a authenticated (20260814020237_create_product_price_history_table.sql)
// — mesmo padrão de listPayments/listOrderSummaries. Mais recente primeiro
// (effective_from desc) — a linha vigente (effective_to null) sempre vem
// primeiro, já que nenhuma linha futura pode existir.
export async function listProductPriceHistory(productId: string): Promise<ProductPriceHistory[]> {
  const { data, error } = await supabase
    .from('product_price_history')
    .select('*')
    .eq('product_id', productId)
    .order('effective_from', { ascending: false })

  if (error) throw mapSupabaseError(error)
  return data as ProductPriceHistory[]
}

// POST /products/with-plates -> create_product_with_plates (NOVA,
// 2026-08-29, estrutura produtiva por plates). Cria o Produto e, na MESMA
// transação no banco, seus plates/filamentos/totais e sua composição de
// Acessórios/Embalagens — nunca chamadas HTTP separadas.
export async function createProductWithPlates(input: CreateProductWithPlatesInput): Promise<{ id: string }> {
  return callEdgeFunction<{ id: string }>('products', '/with-plates', 'POST', input)
}

// PATCH /products/:id/full -> update_product_full (NOVA, 2026-08-29).
// Devolve a linha completa do produto (RPC retorna public.products via
// RETURNING *), mesmo padrão de updateProductDetails.
export async function updateProductFull(productId: string, input: UpdateProductFullInput): Promise<Product> {
  return callEdgeFunction<Product>('products', `/${productId}/full`, 'PATCH', input)
}

// Leitura direta via supabase-js: public.product_categories concede só
// SELECT a authenticated (migration 20260829180000, ainda não aplicada) —
// mesmo padrão de listProductPriceHistory. position asc reproduz a ordem de
// exibição definida por set_product_categories() (1 = categoria "principal",
// espelhada em products.category).
export async function listProductCategoriesForProduct(productId: string): Promise<ProductCategory[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('*')
    .eq('product_id', productId)
    .order('position', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as ProductCategory[]
}

// Busca em lote de TODAS as categorias de TODOS os produtos — usada por
// ProductsPage.tsx para filtrar/exibir por categoria sem 1 consulta por
// linha da listagem (mesmo padrão de outras telas que agregam no cliente em
// vez de repetir round-trips).
export async function listAllProductCategories(): Promise<ProductCategory[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('*')
    .order('position', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as ProductCategory[]
}
