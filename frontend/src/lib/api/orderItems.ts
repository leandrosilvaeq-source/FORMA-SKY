// Leitura direta via supabase-js: public.order_items concede só SELECT a
// authenticated (supabase/migrations/20260814005328_create_order_items_table.sql);
// vw_order_item_approval_status expõe o status de aprovação derivado
// (supabase/migrations/20260814040037_create_order_summary_views.sql).
// Escrita via Edge Function `order-items` (add_order_item/update_order_item/
// remove_order_item) — a máquina de estados e as validações cruzadas
// continuam exclusivamente na RPC.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import { callEdgeFunction } from './edgeFunctionClient'
import type { OrderItem, OrderItemApprovalStatus, SearchTimeStatus } from '@/types/domain'
import type { OrderItemInput } from './orders'

export async function listOrderItems(orderId: string): Promise<OrderItem[]> {
  const { data, error } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as OrderItem[]
}

export async function listOrderItemApprovalStatus(orderId: string): Promise<OrderItemApprovalStatus[]> {
  const { data, error } = await supabase.from('vw_order_item_approval_status').select('*').eq('order_id', orderId)

  if (error) throw mapSupabaseError(error)
  return data as OrderItemApprovalStatus[]
}

export interface AddOrderItemInput extends OrderItemInput {
  order_id: string
}

// POST /order-items -> add_order_item.
export async function addOrderItem(input: AddOrderItemInput): Promise<{ id: string }> {
  return callEdgeFunction<{ id: string }>('order-items', '', 'POST', input)
}

// PATCH /order-items/:id -> update_order_item. Semântica PATCH real: só as
// chaves presentes no objeto são alteradas — chave ausente preserva o valor
// atual (supabase/functions/order-items/index.ts buildOrderItemPatch()).
// current_version não é uma chave aceita no PATCH de custom_details (só no
// POST inicial) — por isso CustomDetailsPatch/SpotDetailsPatch são tipos
// próprios, não um Partial<CustomDetailsInput>.
export interface CustomDetailsPatch {
  is_exclusive?: boolean | null
  prototype_required?: boolean | null
  prototype_completed?: boolean | null
  development_minutes?: number | null
  notes?: string | null
}

export interface SpotDetailsPatch {
  model_source_id?: string | null
  source_reference?: string | null
  is_exclusive?: boolean | null
  test_print_required?: boolean | null
  test_print_completed?: boolean | null
  search_time_status?: SearchTimeStatus | null
  search_minutes?: number | null
  preparation_minutes?: number | null
  market_reference_price?: number | null
  market_reference_source?: string | null
  market_reference_date?: string | null
  catalog_conversion_suggested?: boolean | null
  notes?: string | null
}

export interface UpdateOrderItemInput {
  quantity?: number
  unit_price?: number
  personalization_fee?: number | null
  discount_value?: number | null
  color_description?: string | null
  number_of_colors?: number | null
  customization_data?: Record<string, unknown> | null
  expected_delivery_date?: string | null
  notes?: string | null
  custom_details?: CustomDetailsPatch
  spot_details?: SpotDetailsPatch
}

export async function updateOrderItem(orderItemId: string, input: UpdateOrderItemInput): Promise<void> {
  await callEdgeFunction<{ success: true }>('order-items', `/${orderItemId}`, 'PATCH', input)
}

// DELETE /order-items/:id -> remove_order_item. Sem corpo.
export async function removeOrderItem(orderItemId: string): Promise<void> {
  await callEdgeFunction<{ success: true }>('order-items', `/${orderItemId}`, 'DELETE')
}
