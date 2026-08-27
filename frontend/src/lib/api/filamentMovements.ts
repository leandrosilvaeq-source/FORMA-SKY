// Leitura direta via supabase-js: public.filament_movements concede SELECT
// a authenticated, com RLS is_active_user()
// (supabase/migrations/20260827110000_create_filament_movements_table.sql).
// Escrita: Edge Function `filament-movements` (ainda NÃO publicada — só
// roda localmente nesta rodada).

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import { callEdgeFunction } from './edgeFunctionClient'
import type { FilamentMovement, FilamentMovementType } from '@/types/domain'

// Mesmo limite documentado de stockMovements.ts — sem paginação real nesta
// etapa, pendência futura registrada em docs/05_ROADMAP_MODULOS.md.
const HISTORY_PAGE_SIZE = 50

export async function listFilamentMovements(spoolId: string): Promise<FilamentMovement[]> {
  const { data, error } = await supabase
    .from('filament_movements')
    .select('*')
    .eq('spool_id', spoolId)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(HISTORY_PAGE_SIZE)

  if (error) throw mapSupabaseError(error)
  return data as FilamentMovement[]
}

// Histórico consolidado por tipo (requisito 8: "se viável sem duplicação")
// — mesma tabela, filtrada por filament_type_id em vez de spool_id, graças
// à denormalização deliberada da coluna (ver comentário da migration).
export async function listFilamentMovementsByType(filamentTypeId: string): Promise<FilamentMovement[]> {
  const { data, error } = await supabase
    .from('filament_movements')
    .select('*')
    .eq('filament_type_id', filamentTypeId)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(HISTORY_PAGE_SIZE)

  if (error) throw mapSupabaseError(error)
  return data as FilamentMovement[]
}

export interface RegisterFilamentMovementInput {
  spool_id: string
  movement_type: Exclude<FilamentMovementType, 'WEIGHING_ADJUSTMENT'>
  // Sempre uma quantidade positiva, em gramas (fracionário) — o sinal é
  // resolvido pelo backend a partir de movement_type.
  quantity: number
  reason?: string | null
  reference_type?: string | null
  reference_id?: string | null
  occurred_at?: string | null
  idempotency_key?: string | null
}

// POST /filament-movements -> register_filament_movement.
export async function registerFilamentMovement(input: RegisterFilamentMovementInput): Promise<FilamentMovement> {
  return callEdgeFunction<FilamentMovement>('filament-movements', '', 'POST', input)
}

export interface RegisterFilamentWeighingInput {
  spool_id: string
  // Exatamente um dos dois deve ser informado.
  measured_gross_weight_grams?: number | null
  measured_net_weight_grams?: number | null
  reason: string
  occurred_at?: string | null
  idempotency_key?: string | null
}

export interface RegisterFilamentWeighingResult {
  movement: FilamentMovement | null
}

// POST /filament-movements/weighing -> register_filament_weighing. movement
// vem null quando a diferença calculada é zero (nada foi gravado).
export async function registerFilamentWeighing(
  input: RegisterFilamentWeighingInput,
): Promise<RegisterFilamentWeighingResult> {
  return callEdgeFunction<RegisterFilamentWeighingResult>('filament-movements', '/weighing', 'POST', input)
}
