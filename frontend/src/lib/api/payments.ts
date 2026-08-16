// Leitura direta via supabase-js: public.payments concede só SELECT a
// authenticated (supabase/migrations/20260814021751_create_payments_table.sql).
// Escrita via Edge Function `payments` (register_payment) — proteção contra
// saldo negativo e recálculo de orders.payment_status continuam exclusivos
// da RPC.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import { callEdgeFunction } from './edgeFunctionClient'
import type { Payment, PaymentMethod, PaymentType } from '@/types/domain'

export async function listPayments(orderId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('order_id', orderId)
    .order('paid_at', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as Payment[]
}

export interface RegisterPaymentInput {
  order_id: string
  payment_method: PaymentMethod
  amount: number
  payment_type: PaymentType
  paid_at: string
  notes?: string | null
}

// POST /payments -> register_payment.
export async function registerPayment(input: RegisterPaymentInput): Promise<{ id: string }> {
  return callEdgeFunction<{ id: string }>('payments', '', 'POST', input)
}
