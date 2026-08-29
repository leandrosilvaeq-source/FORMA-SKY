// Leitura direta via supabase-js: public.product_filaments concede SELECT a
// authenticated, com RLS is_active_user()
// (supabase/migrations/20260827113000_create_product_filaments_table.sql).
// Escrita (substituição atômica da composição de filamentos inteira) só via
// Edge Function `products` -> RPC set_product_filaments
// (supabase/functions/products/handler.ts) — nenhum INSERT/UPDATE/DELETE
// direto é concedido nesta tabela.
//
// Deliberadamente um arquivo NOVO e independente de lib/api/productComposition.ts
// (Acessórios/Embalagens, NUNCA alterado por este incremento) — mesma
// separação já decidida no banco (set_product_filaments é uma RPC própria,
// nunca mesclada com set_product_composition) preservada até a borda da API.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import { callEdgeFunction } from './edgeFunctionClient'
import type { ProductFilament } from '@/types/domain'

export async function listProductFilaments(productId: string): Promise<ProductFilament[]> {
  const { data, error } = await supabase.from('product_filaments').select('*').eq('product_id', productId)

  if (error) throw mapSupabaseError(error)
  return data as ProductFilament[]
}

export interface ProductFilamentItemInput {
  // filament_type_id
  id: string
  theoretical_weight_grams: number
}

export interface UpdateProductFilamentsInput {
  filaments: ProductFilamentItemInput[]
}

// PATCH /products/:id/filaments -> set_product_filaments. Mesmo idioma de
// updateProductComposition: substitui o conjunto inteiro, nunca um PATCH
// incremental (ver comentário em supabase/functions/products/handler.ts).
export async function updateProductFilaments(
  productId: string,
  input: UpdateProductFilamentsInput,
): Promise<{ success: true }> {
  return callEdgeFunction<{ success: true }>('products', `/${productId}/filaments`, 'PATCH', input)
}
