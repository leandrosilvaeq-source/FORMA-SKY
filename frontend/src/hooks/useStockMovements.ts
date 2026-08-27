import { useCallback, useEffect, useState } from 'react'
import {
  listStockMovements,
  registerStockMovement,
  type RegisterStockMovementInput,
} from '@/lib/api/stockMovements'
import { ApiError } from '@/lib/api/errors'
import type { StockItemType, StockMovement } from '@/types/domain'

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

interface UseStockMovementsResult {
  movements: StockMovement[]
  isLoading: boolean
  loadError: ApiError | null
  refetch: () => void
  isRegistering: boolean
  register: (input: Omit<RegisterStockMovementInput, 'item_type' | 'item_id'>) => Promise<StockMovement>
}

// Um hook por item (itemType + itemId) — remontado do zero a cada abertura
// do painel de movimentação, mesmo padrão de useOrderManagement (nunca
// reaproveita a mesma instância para um item diferente).
export function useStockMovements(itemType: StockItemType, itemId: string): UseStockMovementsResult {
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)
  const [isRegistering, setIsRegistering] = useState(false)

  // isLoading é derivado da comparação entre a requisição em andamento e a
  // última resolvida — mesmo padrão já usado por useOrderManagement/
  // useAccessories/usePackaging: nenhum setState síncrono no corpo do
  // efeito (todos os setState abaixo rodam dentro de callbacks de
  // then/catch/finally).
  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listStockMovements(itemType, itemId)
      .then((data) => {
        if (cancelled) return
        setMovements(data)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(toApiError(err))
      })
      .finally(() => {
        if (!cancelled) setResolvedRequestId(requestId)
      })

    return () => {
      cancelled = true
    }
  }, [itemType, itemId, requestId])

  const refetch = useCallback(() => setRequestId((id) => id + 1), [])

  // register_stock_movement já devolve a movimentação completa (incl.
  // balance_after, o novo saldo do item) — inserida localmente no topo do
  // histórico (mais recente primeiro), sem precisar de um refetch completo.
  // Atualizar accessories/packaging.current_stock é responsabilidade do
  // chamador (StockMovementPanel): ele já recebe a movimentação criada de
  // volta e lê balance_after de lá.
  const register = useCallback(
    async (input: Omit<RegisterStockMovementInput, 'item_type' | 'item_id'>) => {
      setIsRegistering(true)
      try {
        const created = await registerStockMovement({ ...input, item_type: itemType, item_id: itemId })
        setMovements((current) => [created, ...current])
        return created
      } finally {
        setIsRegistering(false)
      }
    },
    [itemType, itemId],
  )

  return { movements, isLoading, loadError, refetch, isRegistering, register }
}
