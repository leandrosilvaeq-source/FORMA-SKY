// Leitura e escrita diretas via supabase-js: public.customers concede
// SELECT/INSERT/UPDATE a authenticated, com RLS is_active_user()
// (supabase/migrations/20260813204515_create_customers_table.sql).
// Exclusão física (2026-08-29) é a ÚNICA operação que passa por uma Edge
// Function (`customers`, ainda NÃO publicada — roda só localmente nesta
// rodada) chamando a RPC protegida delete_customer
// (20260829140000_add_customer_deletion_function.sql, ainda não aplicada) —
// nunca um DELETE direto (customers nunca concedeu DELETE a authenticated).

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import { callEdgeFunction } from './edgeFunctionClient'
import type { Customer } from '@/types/domain'

export interface CreateCustomerInput {
  name: string
  whatsapp?: string | null
  instagram?: string | null
  company_id?: string | null
  acquisition_source_id?: string | null
  notes?: string | null
}

export interface UpdateCustomerInput {
  name?: string
  whatsapp?: string | null
  instagram?: string | null
  company_id?: string | null
  acquisition_source_id?: string | null
  notes?: string | null
  is_active?: boolean
}

export async function listCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase.from('customers').select('*').order('name', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as Customer[]
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  const { data, error } = await supabase.from('customers').insert(input).select().single()

  if (error) throw mapSupabaseError(error)
  return data as Customer
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<Customer> {
  const { data, error } = await supabase.from('customers').update(input).eq('id', id).select().single()

  if (error) throw mapSupabaseError(error)
  return data as Customer
}

// DELETE /customers/:id -> delete_customer. Exclusão física protegida:
// bloqueada (409) quando o cliente tem pedido ou empresa vinculados —
// _shared/errors.ts mapeia CUSTOMER_HAS_ORDERS:/CUSTOMER_HAS_COMPANY: para
// uma mensagem amigável (business_rule), nunca um DELETE parcial/cascata.
export async function deleteCustomer(id: string): Promise<void> {
  await callEdgeFunction<{ success: true }>('customers', `/${id}`, 'DELETE')
}
