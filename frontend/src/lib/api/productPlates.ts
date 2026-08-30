// Leitura direta via supabase-js: public.product_plates/product_plate_filaments
// concedem SELECT a authenticated, com RLS is_active_user()
// (supabase/migrations/20260829160000_add_product_plates_structure.sql,
// ainda não aplicada). Escrita (substituição atômica de toda a estrutura de
// plates de um Produto, sempre junto com o resto do Produto) só via
// createProductWithPlates/updateProductFull (lib/api/products.ts) — nenhum
// INSERT/UPDATE/DELETE direto é concedido nestas duas tabelas.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import type { ProductPlate, ProductPlateFilament } from '@/types/domain'

export async function listProductPlates(productId: string): Promise<ProductPlate[]> {
  const { data, error } = await supabase
    .from('product_plates')
    .select('*')
    .eq('product_id', productId)
    .order('plate_number', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as ProductPlate[]
}

// Todos os plates de TODOS os produtos — usada por OrderForm.tsx
// (useAllProductPlateCounts) para saber, ao escolher um produto num item
// CATALOG, quantos plates ele tem (define quantas linhas "Plate N" a seção
// "Cores e filamentos" oferece), sem 1 consulta por produto.
export async function listAllProductPlates(): Promise<ProductPlate[]> {
  const { data, error } = await supabase.from('product_plates').select('*').order('plate_number', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as ProductPlate[]
}

// Uma única consulta para todos os plates de um produto — o chamador
// (hook/página de edição) já tem a lista de plate_id em mãos depois de
// listProductPlates(), então filtra por IN aqui em vez de N consultas
// separadas (uma por plate).
export async function listProductPlateFilaments(plateIds: string[]): Promise<ProductPlateFilament[]> {
  if (plateIds.length === 0) return []

  const { data, error } = await supabase.from('product_plate_filaments').select('*').in('plate_id', plateIds)

  if (error) throw mapSupabaseError(error)
  return data as ProductPlateFilament[]
}
