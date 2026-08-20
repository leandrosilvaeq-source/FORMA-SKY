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
import type { Product } from '@/types/domain'

export interface CreateProductInput {
  name: string
  default_price: number
  category?: string | null
  description?: string | null
  default_print_time_minutes?: number | null
  default_weight_grams?: number | null
  units_per_plate?: number | null
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
