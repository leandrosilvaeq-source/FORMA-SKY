// Leitura direta via supabase-js: public.product_filaments concede SELECT a
// authenticated, com RLS is_active_user()
// (supabase/migrations/20260827113000_create_product_filaments_table.sql).
//
// SOMENTE LEITURA a partir da limpeza de código órfão de 2026-08-29:
// product_filaments é dado LEGADO — a estrutura autoritativa de produção é
// product_plates/product_plate_filaments (migration
// 20260829160000_add_product_plates_structure.sql). A escrita
// (updateProductFilaments -> PATCH /products/:id/filaments -> RPC
// set_product_filaments) foi removida daqui por não ter mais nenhum
// consumidor de UI (o antigo diálogo "Composição de filamentos",
// FilamentCompositionForm.tsx, foi removido de ProductsPage.tsx numa rodada
// anterior) — a mesma migration pendente também revoga o EXECUTE de
// service_role da RPC e a rota passa a responder com um erro de negócio
// (PRODUCT_FILAMENTS_ROUTE_RETIRED:), então essa função já não faria nada
// além de falhar se alguém voltasse a chamá-la. listProductFilaments
// continua aqui só como leitura — usada como fallback transitório de
// compatibilidade por ProductsPage.tsx/ProductDetailPage.tsx para Produtos
// que ainda não têm nenhum plate (backfill pendente de aplicação).

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import type { ProductFilament } from '@/types/domain'

export async function listProductFilaments(productId: string): Promise<ProductFilament[]> {
  const { data, error } = await supabase.from('product_filaments').select('*').eq('product_id', productId)

  if (error) throw mapSupabaseError(error)
  return data as ProductFilament[]
}
