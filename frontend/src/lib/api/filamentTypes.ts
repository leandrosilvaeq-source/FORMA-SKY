// Leitura direta via supabase-js: public.filament_types e
// public.vw_filament_type_summary concedem SELECT a authenticated, com RLS
// is_active_user()
// (supabase/migrations/20260827100000_create_filament_types_table.sql,
// 20260827110000_create_filament_movements_table.sql) — mesmo padrão de
// accessories.ts/packaging.ts. Escrita (criar/editar/ativar-desativar/
// remover) e o planejamento de remoção (GET /:id/removal-plan): Edge
// Function `filament-types` (publicada e operacional para POST/PATCH/DELETE;
// a rota GET /:id/removal-plan entra no deploy desta rodada corretiva).

import { ApiError, mapSupabaseError } from './errors'
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
export async function updateFilamentType(
  id: string,
  input: UpdateFilamentTypeInput,
): Promise<FilamentType> {
  return callEdgeFunction<FilamentType>('filament-types', `/${id}`, 'PATCH', input)
}

// GET /filament-types/:id/removal-plan -> get_filament_type_removal_plan:
// planejamento AUTORITATIVO e somente-leitura da remoção. A interface
// consulta ANTES de abrir a confirmação e escolhe a variante do diálogo
// pelo planned_result — nunca mais deriva "exclusão permanente" só da
// presença de rolos. Não altera nada.
export type FilamentTypeRemovalPlanResult =
  'PHYSICALLY_DELETED' | 'ARCHIVED' | 'BLOCKED_ACTIVE_ORDER'

export interface FilamentTypeRemovalPlan {
  success: true
  planned_result: FilamentTypeRemovalPlanResult
  spool_count: number
  active_spool_count: number
  active_order_numbers: string[]
  has_movements: boolean
  has_purchases: boolean
  has_product_filaments: boolean
  has_product_plate_filaments: boolean
  has_order_selection: boolean
}

export async function getFilamentTypeRemovalPlan(id: string): Promise<FilamentTypeRemovalPlan> {
  return callEdgeFunction<FilamentTypeRemovalPlan>('filament-types', `/${id}/removal-plan`, 'GET')
}

// DELETE /filament-types/:id -> remove_filament_type (remoção segura
// transacional): sem nenhuma referência -> exclusão física definitiva
// (result 'PHYSICALLY_DELETED'); com qualquer referência (rolos,
// movimentações, compras, composição legada, seleção em pedido
// finalizado/cancelado) -> arquiva o tipo e TODOS os seus rolos na mesma
// transação (result 'ARCHIVED', com a contagem de rolos arquivados);
// pedido ATIVO usando o tipo -> bloqueio (ApiError business_rule, mensagem
// real do backend). Nunca cascateia, nunca apaga histórico/movimentações.
//
// expectedResult é o planned_result confirmado pelo usuário a partir de
// getFilamentTypeRemovalPlan. Se o plano real mudou entre a consulta e a
// execução, o backend não altera nada e devolve um ApiError business_rule
// cuja mensagem casa com REMOVAL_PLAN_CHANGED_HINT (isRemovalPlanChangedError)
// — a interface recarrega o plano e pede nova confirmação.
export interface RemoveFilamentTypeResult {
  success: true
  result: 'PHYSICALLY_DELETED' | 'ARCHIVED'
  archived_spool_count: number
}

export async function deleteFilamentType(
  id: string,
  expectedResult: 'PHYSICALLY_DELETED' | 'ARCHIVED',
): Promise<RemoveFilamentTypeResult> {
  return callEdgeFunction<RemoveFilamentTypeResult>('filament-types', `/${id}`, 'DELETE', {
    expected_result: expectedResult,
  })
}

// Fragmento estável da mensagem de FILAMENT_TYPE_REMOVAL_PLAN_CHANGED: (o
// marcador é removido pelo backend antes de chegar ao cliente). Usado para
// distinguir "plano mudou, reconfirme" de um bloqueio definitivo por pedido
// ativo — ambos chegam como ApiError business_rule/409.
export const REMOVAL_PLAN_CHANGED_HINT = 'plano de remoção mudou'

export function isRemovalPlanChangedError(err: unknown): boolean {
  return err instanceof ApiError && err.message.toLowerCase().includes(REMOVAL_PLAN_CHANGED_HINT)
}
