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
