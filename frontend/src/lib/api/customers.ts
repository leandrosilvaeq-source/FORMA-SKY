// Leitura e escrita diretas via supabase-js: public.customers concede
// SELECT/INSERT/UPDATE a authenticated, com RLS is_active_user()
// (supabase/migrations/20260813204515_create_customers_table.sql). Não há
// Edge Function para clientes — nenhuma foi criada no backend do Módulo 1.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
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
