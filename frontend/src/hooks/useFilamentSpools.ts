import { useCallback, useEffect, useState } from 'react'
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

interface UseFilamentSpoolsResult {
  spools: FilamentSpool[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: Omit<CreateFilamentSpoolInput, 'filament_type_id'>) => Promise<FilamentSpool>
  update: (id: string, input: UpdateFilamentSpoolInput) => Promise<FilamentSpool>
  delete: (id: string) => Promise<void>
  // Atualização local pura (sem chamada de rede) — usada depois de uma
  // movimentação/pesagem bem-sucedida: register_filament_movement/
  // register_filament_weighing já devolvem balance_after (e o status pode
  // ter mudado para ESGOTADO automaticamente), então buscar o rolo de novo
  // só para saber valores que a própria resposta já trouxe seria uma
  // requisição desnecessária — mesmo padrão de useAccessories.setLocalStock.
  setLocalSpoolState: (id: string, patch: { current_net_weight_grams: number; status?: FilamentSpoolStatus }) => void
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

// Um hook por tipo (filamentTypeId) — remontado do zero a cada tipo aberto,
// mesmo padrão de useStockMovements (um hook por item).
export function useFilamentSpools(filamentTypeId: string): UseFilamentSpoolsResult {
  const [spools, setSpools] = useState<FilamentSpool[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listFilamentSpools(filamentTypeId)
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
  }, [filamentTypeId, requestId])

  const refetch = useCallback(() => setRequestId((id) => id + 1), [])

  const create = useCallback(
    async (input: Omit<CreateFilamentSpoolInput, 'filament_type_id'>) => {
      const created = await createFilamentSpool({ ...input, filament_type_id: filamentTypeId })
      setSpools((current) => [created, ...current])
      return created
    },
    [filamentTypeId],
  )

  const update = useCallback(async (id: string, input: UpdateFilamentSpoolInput) => {
    const updated = await updateFilamentSpool(id, input)
    setSpools((current) => current.map((item) => (item.id === id ? updated : item)))
    return updated
  }, [])

  const deleteItem = useCallback(async (id: string) => {
    await deleteFilamentSpool(id)
    setSpools((current) => current.filter((item) => item.id !== id))
  }, [])

  const setLocalSpoolState = useCallback(
    (id: string, patch: { current_net_weight_grams: number; status?: FilamentSpoolStatus }) => {
      setSpools((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, current_net_weight_grams: patch.current_net_weight_grams, status: patch.status ?? item.status }
            : item,
        ),
      )
    },
    [],
  )

  return { spools, isLoading, error, refetch, create, update, delete: deleteItem, setLocalSpoolState }
}
