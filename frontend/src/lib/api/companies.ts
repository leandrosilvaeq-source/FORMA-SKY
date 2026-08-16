// Leitura e escrita diretas via supabase-js: public.companies concede
// SELECT/INSERT/UPDATE a authenticated, com RLS is_active_user()
// (supabase/migrations/20260813201248_create_companies_table.sql). Sem
// Edge Function para empresas — nenhuma foi criada no backend do Módulo 1.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import type { Company } from '@/types/domain'

export interface CreateCompanyInput {
  name: string
  trade_name?: string | null
  document_number?: string | null
  whatsapp?: string | null
  instagram?: string | null
  notes?: string | null
}

export interface UpdateCompanyInput {
  name?: string
  trade_name?: string | null
  document_number?: string | null
  whatsapp?: string | null
  instagram?: string | null
  notes?: string | null
  is_active?: boolean
}

export async function listCompanies(): Promise<Company[]> {
  const { data, error } = await supabase.from('companies').select('*').order('name', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as Company[]
}

export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  const { data, error } = await supabase.from('companies').insert(input).select().single()

  if (error) throw mapSupabaseError(error)
  return data as Company
}

export async function updateCompany(id: string, input: UpdateCompanyInput): Promise<Company> {
  const { data, error } = await supabase.from('companies').update(input).eq('id', id).select().single()

  if (error) throw mapSupabaseError(error)
  return data as Company
}
