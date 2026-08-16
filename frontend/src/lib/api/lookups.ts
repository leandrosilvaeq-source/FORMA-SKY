// Leitura direta via supabase-js: public.lead_sources e public.model_sources
// concedem SELECT a authenticated, com RLS is_active_user()
// (supabase/migrations/20260813194021_create_lookup_tables.sql). Tabelas de
// domínio usadas em dropdowns — sem Edge Function dedicada.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import type { LeadSource, ModelSource } from '@/types/domain'

export async function listLeadSources(): Promise<LeadSource[]> {
  const { data, error } = await supabase.from('lead_sources').select('*').order('name', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as LeadSource[]
}

export async function listModelSources(): Promise<ModelSource[]> {
  const { data, error } = await supabase.from('model_sources').select('*').order('name', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as ModelSource[]
}
