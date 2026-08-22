// Leitura direta via supabase-js: public.orders concede só SELECT a
// authenticated (supabase/migrations/20260813221340_create_orders_table.sql);
// vw_order_summary consolida valores financeiros/aprovação, somente leitura
// (supabase/migrations/20260814040037_create_order_summary_views.sql).
// Escrita via Edge Functions `orders` (create_order/update_order) e
// `order-status` (change_order_status) — toda a máquina de estados e as
// regras de negócio continuam exclusivamente nas RPCs, nunca replicadas
// aqui.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import { callEdgeFunction } from './edgeFunctionClient'
import type { ItemType, Order, OrderStatus, OrderSummary, PaymentMethod, SearchTimeStatus } from '@/types/domain'

// Payload de item usado tanto em createOrder (aninhado em `items`) quanto em
// addOrderItem (orderItems.ts, mesmo formato no corpo raiz) — ver
// supabase/functions/orders/index.ts validateOrderItem() e
// supabase/functions/order-items/index.ts validateOrderItemPayload().
export interface CustomDetailsInput {
  current_version: string
  is_exclusive?: boolean | null
  prototype_required?: boolean | null
  development_minutes?: number | null
  notes?: string | null
}

export interface SpotDetailsInput {
  model_source_id?: string | null
  source_reference?: string | null
  is_exclusive?: boolean | null
  test_print_required?: boolean | null
  search_time_status?: SearchTimeStatus | null
  search_minutes?: number | null
  preparation_minutes?: number | null
  market_reference_price?: number | null
  market_reference_source?: string | null
  market_reference_date?: string | null
  notes?: string | null
}

export interface OrderItemInput {
  item_type: ItemType
  item_name: string
  quantity: number
  unit_price: number
  product_id?: string | null
  description?: string | null
  personalization_fee?: number
  discount_value?: number
  color_description?: string | null
  number_of_colors?: number | null
  customization_data?: Record<string, unknown> | null
  expected_delivery_date?: string | null
  notes?: string | null
  custom_details?: CustomDetailsInput
  spot_details?: SpotDetailsInput
}

export interface CreateOrderInput {
  customer_id: string
  items: OrderItemInput[]
  company_id?: string | null
  lead_source_id?: string | null
  // Opcional, igual aos demais campos abaixo — orders.payment_method é
  // nullable e, diferente do PUT, o POST nunca exigiu presença de chave
  // (create_order() sempre aceitou os campos opcionais ausentes = null).
  // Omitido do payload = não informado no momento da criação; nunca
  // enviado como '' (string vazia).
  payment_method?: PaymentMethod | null
  expected_delivery_date?: string | null
  delivery_method?: string | null
  shipping_cost?: number | null
  discount_value?: number | null
  notes?: string | null
}

// PUT /orders/:id exige substituição completa — as 10 chaves abaixo devem
// estar todas presentes no corpo, inclusive quando o valor é null
// (supabase/functions/orders/index.ts handleUpdateOrder/requirePresent).
export interface UpdateOrderInput {
  customer_id: string
  company_id: string | null
  lead_source_id: string | null
  payment_method: PaymentMethod | null
  expected_delivery_date: string | null
  actual_delivery_date: string | null
  delivery_method: string | null
  shipping_cost: number | null
  discount_value: number | null
  notes: string | null
}

// PUT /orders/:id/full -> update_quote_order(). Edição completa atômica de
// cabeçalho + itens, numa única chamada — nunca create_order, nunca
// update_order + add/update/remove_order_item em sequência. Só aceita a
// operação quando o pedido está em QUOTE e todos os itens (atuais e
// enviados) são CATALOG; a Edge Function e a RPC recusam qualquer outro
// caso. items reaproveita o mesmo formato de OrderItemInput (create_order),
// já que a RPC substitui o conjunto inteiro de order_items do pedido.
export interface UpdateQuoteOrderInput {
  customer_id: string
  items: OrderItemInput[]
  company_id?: string | null
  lead_source_id?: string | null
  payment_method?: PaymentMethod | null
  expected_delivery_date?: string | null
  delivery_method?: string | null
  shipping_cost?: number | null
  discount_value?: number | null
  notes?: string | null
}

export async function listOrderSummaries(): Promise<OrderSummary[]> {
  const { data, error } = await supabase
    .from('vw_order_summary')
    .select('*')
    .order('order_date', { ascending: false })

  if (error) throw mapSupabaseError(error)
  return data as OrderSummary[]
}

export async function getOrderSummary(orderId: string): Promise<OrderSummary> {
  const { data, error } = await supabase.from('vw_order_summary').select('*').eq('order_id', orderId).single()

  if (error) throw mapSupabaseError(error)
  return data as OrderSummary
}

export async function getOrder(orderId: string): Promise<Order> {
  const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).single()

  if (error) throw mapSupabaseError(error)
  return data as Order
}

// POST /orders -> create_order.
export async function createOrder(input: CreateOrderInput): Promise<{ id: string }> {
  return callEdgeFunction<{ id: string }>('orders', '', 'POST', input)
}

// PUT /orders/:id -> update_order.
export async function updateOrder(orderId: string, input: UpdateOrderInput): Promise<void> {
  await callEdgeFunction<{ success: true }>('orders', `/${orderId}`, 'PUT', input)
}

// PUT /orders/:id/full -> update_quote_order.
export async function updateQuoteOrder(orderId: string, input: UpdateQuoteOrderInput): Promise<{ id: string }> {
  return callEdgeFunction<{ id: string }>('orders', `/${orderId}/full`, 'PUT', input)
}

// POST /order-status/:orderId -> change_order_status
// (supabase/functions/order-status/index.ts). reason é omitido do corpo
// quando ausente, deixando o DEFAULT null do SQL agir — mesmo padrão já
// usado pela Edge Function.
export async function changeOrderStatus(orderId: string, toStatus: OrderStatus, reason?: string): Promise<void> {
  await callEdgeFunction<{ success: true }>('order-status', `/${orderId}`, 'POST', {
    to_status: toStatus,
    ...(reason !== undefined ? { reason } : {}),
  })
}
