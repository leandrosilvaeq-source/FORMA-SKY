// Leitura direta via supabase-js: public.filament_types e
// public.vw_filament_type_summary concedem SELECT a authenticated, com RLS
// is_active_user()
// (supabase/migrations/20260827100000_create_filament_types_table.sql,
// 20260827106000_create_filament_movements_table.sql) — mesmo padrão de
// accessories.ts/packaging.ts. Escrita (criar/editar/ativar-desativar/
// excluir): Edge Function `filament-types` (ainda NÃO publicada — só roda
// localmente nesta rodada).

import { mapSupabaseError } from './errors'
import { supabase } from '@/lib/supabase'
import { callEdgeFunction } from './edgeFunctionClient'
import type { FilamentMaterial, FilamentType, FilamentTypeSummary } from '@/types/domain'

export async function listFilamentTypes(): Promise<FilamentType[]> {
  const { data, error } = await supabase
    .from('filament_types')
    .select('*')
    .order('manufacturer', { ascending: true })
    .order('commercial_color', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as FilamentType[]
}

// Quantidade disponível por tipo (soma dos rolos ativos e utilizáveis) —
// mesma listagem base de listFilamentTypes, só que já agregada pela view.
export async function listFilamentTypeSummaries(): Promise<FilamentTypeSummary[]> {
  const { data, error } = await supabase
    .from('vw_filament_type_summary')
    .select('*')
    .order('manufacturer', { ascending: true })
    .order('commercial_color', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as FilamentTypeSummary[]
}

export interface CreateFilamentTypeInput {
  material: FilamentMaterial
  manufacturer: string
  line: string
  commercial_color: string
  color_code?: string | null
  minimum_stock_grams?: number | null
  is_active?: boolean | null
  notes?: string | null
}

export interface UpdateFilamentTypeInput {
  material?: FilamentMaterial
  manufacturer?: string
  line?: string
  commercial_color?: string
  color_code?: string | null
  minimum_stock_grams?: number | null
  is_active?: boolean
  notes?: string | null
}

// POST /filament-types -> create_filament_type.
export async function createFilamentType(input: CreateFilamentTypeInput): Promise<FilamentType> {
  return callEdgeFunction<FilamentType>('filament-types', '', 'POST', input)
}

// PATCH /filament-types/:id -> update_filament_type.
export async function updateFilamentType(id: string, input: UpdateFilamentTypeInput): Promise<FilamentType> {
  return callEdgeFunction<FilamentType>('filament-types', `/${id}`, 'PATCH', input)
}

// DELETE /filament-types/:id -> delete_filament_type (exclusão protegida —
// bloqueia com erro de negócio quando há rolo ou composição de produto
// vinculados; nunca cascateia).
export async function deleteFilamentType(id: string): Promise<{ success: true }> {
  return callEdgeFunction<{ success: true }>('filament-types', `/${id}`, 'DELETE')
}
