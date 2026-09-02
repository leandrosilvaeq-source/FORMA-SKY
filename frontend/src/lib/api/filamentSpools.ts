// Leitura direta via supabase-js: public.filament_spools concede SELECT a
// authenticated, com RLS is_active_user()
// (supabase/migrations/20260827103000_create_filament_spools_table.sql).
// Escrita: Edge Function `filament-spools` (ainda NÃO publicada — só roda
// localmente nesta rodada).

import { mapSupabaseError } from './errors'
import { supabase } from '@/lib/supabase'
import { callEdgeFunction } from './edgeFunctionClient'
import type { FilamentSpool, FilamentSpoolStatus } from '@/types/domain'

// Resposta crua das duas rotas de escrita (Edge Function -> RPC): nunca
// inclui `has_movement_history` (campo derivado, calculado só por
// listFilamentSpools abaixo) — os hooks (useFilamentSpools) são
// responsáveis por preencher esse campo ao mesclar no estado local (false
// para um rolo recém-criado; preservado do valor anterior numa edição).
export type FilamentSpoolWriteResponse = Omit<FilamentSpool, 'has_movement_history'>

// Rolos de um tipo específico — mais recentes primeiro (mesma ordem que a
// interface de drill-down por tipo espera exibir).
//
// Segunda consulta (spool_id de filament_movements para o mesmo tipo) só
// para determinar, de forma confiável e não-textual, quais rolos têm
// histórico — delete_filament_spool bloqueia exclusivamente por
// FILAMENT_SPOOL_HAS_MOVEMENTS: (nenhum outro vínculo impede a exclusão de
// um rolo individual nesta etapa), então "tem ao menos uma linha em
// filament_movements" é uma predição exata de "excluir vai falhar" — usada
// pela interface para decidir Excluir vs. Arquivar ANTES de mostrar a
// confirmação (achado da validação manual, 2026-08-28: decidir só depois de
// tentar e capturar o texto do erro não funcionou como esperado). Nenhuma
// migration/RPC nova: as duas consultas usam SELECT já concedido a
// authenticated (RLS is_active_user() nas duas tabelas).
// Aceita um único filament_type_id OU vários (listagem consolidada de
// Filamentos por Material+Linha+Cor, 2026-09-01: "Ver rolos" abre todos os
// tipos/fabricantes do grupo). Uma única consulta com `.in(...)` para todos
// os tipos — nunca N chamadas (sem N+1). Os dois SELECT já são concedidos a
// authenticated (RLS is_active_user()), então nenhum contrato novo é
// necessário.
export async function listFilamentSpools(
  filamentTypeIds: string | string[],
): Promise<FilamentSpool[]> {
  const ids = Array.isArray(filamentTypeIds) ? filamentTypeIds : [filamentTypeIds]
  if (ids.length === 0) return []
  const [spoolsResult, movementsResult] = await Promise.all([
    supabase
      .from('filament_spools')
      .select('*')
      .in('filament_type_id', ids)
      .order('created_at', { ascending: false }),
    supabase.from('filament_movements').select('spool_id').in('filament_type_id', ids),
  ])

  if (spoolsResult.error) throw mapSupabaseError(spoolsResult.error)
  if (movementsResult.error) throw mapSupabaseError(movementsResult.error)

  const spoolIdsWithHistory = new Set(
    (movementsResult.data as Array<{ spool_id: string }>).map((row) => row.spool_id),
  )
  return (spoolsResult.data as FilamentSpoolWriteResponse[]).map((spool) => ({
    ...spool,
    has_movement_history: spoolIdsWithHistory.has(spool.id),
  }))
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
export async function createFilamentSpool(
  input: CreateFilamentSpoolInput,
): Promise<FilamentSpoolWriteResponse> {
  return callEdgeFunction<FilamentSpoolWriteResponse>('filament-spools', '', 'POST', input)
}

// PATCH /filament-spools/:id -> update_filament_spool (cadastro, status,
// ativar/desativar — DESCARTADO é terminal, a RPC rejeita qualquer
// transição de volta).
export async function updateFilamentSpool(
  id: string,
  input: UpdateFilamentSpoolInput,
): Promise<FilamentSpoolWriteResponse> {
  return callEdgeFunction<FilamentSpoolWriteResponse>('filament-spools', `/${id}`, 'PATCH', input)
}

// DELETE /filament-spools/:id -> delete_filament_spool (exclusão protegida
// — bloqueia quando há movimentação vinculada; nunca cascateia). Continua
// existindo como proteção de defesa em profundidade no backend — a
// interface só chama esta rota quando já sabe (via has_movement_history)
// que o rolo não tem histórico.
export async function deleteFilamentSpool(id: string): Promise<{ success: true }> {
  return callEdgeFunction<{ success: true }>('filament-spools', `/${id}`, 'DELETE')
}
