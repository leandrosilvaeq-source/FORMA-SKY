// Leitura direta via supabase-js: public.filament_spools concede SELECT a
// authenticated, com RLS is_active_user()
// (supabase/migrations/20260827103000_create_filament_spools_table.sql).
// Escrita: Edge Function `filament-spools` (ainda NÃO publicada — só roda
// localmente nesta rodada).

import { mapSupabaseError } from './errors'
import { supabase } from '@/lib/supabase'
import { callEdgeFunction } from './edgeFunctionClient'
import type { FilamentSpool, FilamentSpoolStatus } from '@/types/domain'

// Rolos de um tipo específico — mais recentes primeiro (mesma ordem que a
// interface de drill-down por tipo espera exibir).
export async function listFilamentSpools(filamentTypeId: string): Promise<FilamentSpool[]> {
  const { data, error } = await supabase
    .from('filament_spools')
    .select('*')
    .eq('filament_type_id', filamentTypeId)
    .order('created_at', { ascending: false })

  if (error) throw mapSupabaseError(error)
  return data as FilamentSpool[]
}

export interface CreateFilamentSpoolInput {
  filament_type_id: string
  // Livre — sugestão de 1000g só na interface, nunca um valor fixo aqui.
  nominal_weight_grams: number
  empty_spool_weight_grams?: number | null
  received_at?: string | null
  status?: FilamentSpoolStatus | null
  notes?: string | null
  is_active?: boolean | null
}

export interface UpdateFilamentSpoolInput {
  nominal_weight_grams?: number
  empty_spool_weight_grams?: number | null
  received_at?: string | null
  status?: FilamentSpoolStatus
  notes?: string | null
  is_active?: boolean
}

// POST /filament-spools -> create_filament_spool (code gerado no backend).
export async function createFilamentSpool(input: CreateFilamentSpoolInput): Promise<FilamentSpool> {
  return callEdgeFunction<FilamentSpool>('filament-spools', '', 'POST', input)
}

// PATCH /filament-spools/:id -> update_filament_spool (cadastro, status,
// ativar/desativar — DESCARTADO é terminal, a RPC rejeita qualquer
// transição de volta).
export async function updateFilamentSpool(id: string, input: UpdateFilamentSpoolInput): Promise<FilamentSpool> {
  return callEdgeFunction<FilamentSpool>('filament-spools', `/${id}`, 'PATCH', input)
}

// DELETE /filament-spools/:id -> delete_filament_spool (exclusão protegida
// — bloqueia quando há movimentação vinculada; nunca cascateia).
export async function deleteFilamentSpool(id: string): Promise<{ success: true }> {
  return callEdgeFunction<{ success: true }>('filament-spools', `/${id}`, 'DELETE')
}
