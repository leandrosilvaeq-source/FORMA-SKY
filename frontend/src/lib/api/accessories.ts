// Leitura direta via supabase-js: public.accessories concede SELECT a
// authenticated, com RLS is_active_user()
// (supabase/migrations/20260816150000_create_accessories_packaging_and_composition_tables.sql).
// Cadastro/edição de acessórios fica para uma subetapa futura ("administração
// separada", já combinada) — aqui só a listagem necessária para montar a
// composição padrão de um produto.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import type { Accessory } from '@/types/domain'

export async function listAccessories(): Promise<Accessory[]> {
  const { data, error } = await supabase.from('accessories').select('*').order('name', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as Accessory[]
}
