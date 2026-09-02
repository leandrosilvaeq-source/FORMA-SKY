import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createFilamentSpool,
  deleteFilamentSpool,
  listFilamentSpools,
  updateFilamentSpool,
  type CreateFilamentSpoolInput,
  type UpdateFilamentSpoolInput,
} from '@/lib/api/filamentSpools'
import { ApiError } from '@/lib/api/errors'
import type { FilamentSpool, FilamentSpoolStatus } from '@/types/domain'

// `create` aceita a composição sem filament_type_id (modo tipo único —
// injeta o id do próprio hook) OU com filament_type_id explícito (modo
// grupo consolidado, "Ver rolos" com vários tipos/fabricantes — o chamador
// diz a qual tipo o novo rolo pertence).
type CreateSpoolInput = Omit<CreateFilamentSpoolInput, 'filament_type_id'> & {
  filament_type_id?: string
}

interface UseFilamentSpoolsResult {
  spools: FilamentSpool[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: CreateSpoolInput) => Promise<FilamentSpool>
  update: (id: string, input: UpdateFilamentSpoolInput) => Promise<FilamentSpool>
  delete: (id: string) => Promise<void>
  // Atualização local pura (sem chamada de rede) — usada depois de uma
  // movimentação/pesagem bem-sucedida: register_filament_movement/
  // register_filament_weighing já devolvem balance_after (e o status pode
  // ter mudado para ESGOTADO automaticamente), então buscar o rolo de novo
  // só para saber valores que a própria resposta já trouxe seria uma
  // requisição desnecessária — mesmo padrão de useAccessories.setLocalStock.
  setLocalSpoolState: (
    id: string,
    patch: { current_net_weight_grams: number; status?: FilamentSpoolStatus },
  ) => void
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

// Um hook por tipo (string) OU por GRUPO consolidado de tipos (string[] —
// listagem de Filamentos por Material+Linha+Cor, "Ver rolos" abre todos os
// fabricantes do grupo). Remontado do zero quando o conjunto de ids muda.
// listFilamentSpools carrega todos os ids numa única consulta (`.in`) — sem
// N+1.
export function useFilamentSpools(filamentTypeIds: string | string[]): UseFilamentSpoolsResult {
  const ids = useMemo(
    () => (Array.isArray(filamentTypeIds) ? [...filamentTypeIds] : [filamentTypeIds]),
    [filamentTypeIds],
  )
  // Chave estável: reordenada e concatenada — o array pode trocar de
  // referência a cada render sem trocar de conteúdo.
  const idsKey = useMemo(() => [...ids].sort().join('|'), [ids])
  const singleId = ids.length === 1 ? ids[0] : null

  const [spools, setSpools] = useState<FilamentSpool[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false
    const currentIds = idsKey ? idsKey.split('|') : []

    listFilamentSpools(currentIds)
      .then((data) => {
        if (cancelled) return
        setSpools(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toApiError(err))
      })
      .finally(() => {
        if (!cancelled) setResolvedRequestId(requestId)
      })

    return () => {
      cancelled = true
    }
  }, [idsKey, requestId])

  const refetch = useCallback(() => setRequestId((id) => id + 1), [])

  // Um rolo recém-criado nunca teve nenhuma movimentação — has_movement_history
  // sempre começa false (afirmação, não suposição: create_filament_spool
  // sempre zera current_net_weight_grams e não grava nenhuma linha em
  // filament_movements).
  const create = useCallback(
    async (input: CreateSpoolInput) => {
      const targetTypeId = input.filament_type_id ?? singleId
      if (!targetTypeId) {
        throw new ApiError('validation', 400, 'Informe o tipo de filamento do novo rolo.')
      }
      const created = await createFilamentSpool({ ...input, filament_type_id: targetTypeId })
      const withHistory: FilamentSpool = { ...created, has_movement_history: false }
      setSpools((current) => [withHistory, ...current])
      return withHistory
    },
    [singleId],
  )

  // A resposta de update_filament_spool não inclui has_movement_history
  // (campo derivado só calculado por listFilamentSpools) — nenhum dos
  // campos editáveis por esta função (nominal/tara/data/status/notas/
  // is_active) altera se o rolo tem histórico ou não, então o valor
  // anterior é sempre preservado aqui, nunca perdido nem recalculado.
  const update = useCallback(async (id: string, input: UpdateFilamentSpoolInput) => {
    const updated = await updateFilamentSpool(id, input)
    let merged: FilamentSpool | undefined
    setSpools((current) =>
      current.map((item) => {
        if (item.id !== id) return item
        merged = { ...updated, has_movement_history: item.has_movement_history }
        return merged
      }),
    )
    return merged as FilamentSpool
  }, [])

  const deleteItem = useCallback(async (id: string) => {
    await deleteFilamentSpool(id)
    setSpools((current) => current.filter((item) => item.id !== id))
  }, [])

  // Só é chamada depois de uma movimentação/pesagem bem-sucedida
  // (FilamentSpoolPanel.onSpoolChanged) — o rolo passa a ter histórico a
  // partir daqui, sempre true (mesmo que já fosse true antes).
  const setLocalSpoolState = useCallback(
    (id: string, patch: { current_net_weight_grams: number; status?: FilamentSpoolStatus }) => {
      setSpools((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                current_net_weight_grams: patch.current_net_weight_grams,
                status: patch.status ?? item.status,
                has_movement_history: true,
              }
            : item,
        ),
      )
    },
    [],
  )

  return {
    spools,
    isLoading,
    error,
    refetch,
    create,
    update,
    delete: deleteItem,
    setLocalSpoolState,
  }
}
