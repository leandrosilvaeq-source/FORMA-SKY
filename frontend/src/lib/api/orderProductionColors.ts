// Leitura direta via supabase-js: public.order_item_plates/
// order_item_unit_plate_filaments concedem só SELECT a authenticated
// (migration 20260829180000_add_categories_plate_weight_and_order_colors.sql,
// ainda não aplicada). Escrita das seleções de cor só via
// updateOrderProductionColors (lib/api/orders.ts, PATCH
// /orders/:id/production-colors) — order_item_plates (snapshot) nunca é
// escrito diretamente pelo frontend, só pelas RPCs de criação/edição de
// Pedido (create_order/update_quote_order).

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import type { OrderItemPlate, OrderItemUnitPlateFilament } from '@/types/domain'

export async function listOrderItemPlates(orderItemIds: string[]): Promise<OrderItemPlate[]> {
  if (orderItemIds.length === 0) return []

  const { data, error } = await supabase
    .from('order_item_plates')
    .select('*')
    .in('order_item_id', orderItemIds)
    .order('plate_number', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as OrderItemPlate[]
}

export async function listOrderItemUnitPlateFilaments(
  orderItemIds: string[],
): Promise<OrderItemUnitPlateFilament[]> {
  if (orderItemIds.length === 0) return []

  const { data, error } = await supabase
    .from('order_item_unit_plate_filaments')
    .select('*')
    .in('order_item_id', orderItemIds)

  if (error) throw mapSupabaseError(error)
  return data as OrderItemUnitPlateFilament[]
}
