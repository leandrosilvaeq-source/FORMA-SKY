// Leitura direta via supabase-js: public.product_accessories/
// public.product_packaging concedem SELECT a authenticated, com RLS
// is_active_user()
// (supabase/migrations/20260816150000_create_accessories_packaging_and_composition_tables.sql).
// Escrita (substituição atômica da composição inteira) só via Edge Function
// `products` -> RPC set_product_composition
// (supabase/functions/products/index.ts) — nenhum INSERT/UPDATE/DELETE
// direto é concedido nessas duas tabelas.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import { callEdgeFunction } from './edgeFunctionClient'
import type { ProductAccessory, ProductPackaging } from '@/types/domain'

export interface ProductCompositionItemInput {
  id: string
  quantity: number
}

export interface UpdateProductCompositionInput {
  accessories: ProductCompositionItemInput[]
  packaging: ProductCompositionItemInput[]
}

export async function listProductAccessories(productId: string): Promise<ProductAccessory[]> {
  const { data, error } = await supabase.from('product_accessories').select('*').eq('product_id', productId)

  if (error) throw mapSupabaseError(error)
  return data as ProductAccessory[]
}

export async function listProductPackaging(productId: string): Promise<ProductPackaging[]> {
  const { data, error } = await supabase.from('product_packaging').select('*').eq('product_id', productId)

  if (error) throw mapSupabaseError(error)
  return data as ProductPackaging[]
}

// PATCH /products/:id/composition -> set_product_composition. PATCH (não
// PUT) porque a Edge Function usa PATCH nesta rota — ver comentário em
// supabase/functions/products/index.ts sobre a restrição de
// Access-Control-Allow-Methods em _shared/cors.ts.
export async function updateProductComposition(
  productId: string,
  input: UpdateProductCompositionInput,
): Promise<{ success: true }> {
  return callEdgeFunction<{ success: true }>('products', `/${productId}/composition`, 'PATCH', input)
}
