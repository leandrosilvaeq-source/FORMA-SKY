// Leitura direta via supabase-js: public.order_status_history e
// public.payment_status_history concedem só SELECT a authenticated
// (supabase/migrations/20260814023012_create_status_history_tables.sql).
// Nenhuma Edge Function é necessária: as duas tabelas são escritas só
// internamente por change_order_status()/register_payment()/
// recalculate_order_financials() (service_role) — nenhuma escrita direta é
// exposta aqui, mesmo padrão de orders/order_items/payments/approvals.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import type { OrderStatusHistory, PaymentStatusHistory } from '@/types/domain'

export async function listOrderStatusHistory(orderId: string): Promise<OrderStatusHistory[]> {
  const { data, error } = await supabase
    .from('order_status_history')
    .select('*')
    .eq('order_id', orderId)
    .order('changed_at', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as OrderStatusHistory[]
}

export async function listPaymentStatusHistory(orderId: string): Promise<PaymentStatusHistory[]> {
  const { data, error } = await supabase
    .from('payment_status_history')
    .select('*')
    .eq('order_id', orderId)
    .order('changed_at', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as PaymentStatusHistory[]
}
