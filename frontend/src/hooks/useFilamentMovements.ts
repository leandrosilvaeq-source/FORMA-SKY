import { useCallback, useEffect, useState } from 'react'
import {
  listFilamentMovements,
  registerFilamentMovement,
  registerFilamentWeighing,
  type RegisterFilamentMovementInput,
  type RegisterFilamentWeighingInput,
} from '@/lib/api/filamentMovements'
import { ApiError } from '@/lib/api/errors'
import type { FilamentMovement } from '@/types/domain'

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

interface UseFilamentMovementsResult {
  movements: FilamentMovement[]
  isLoading: boolean
  loadError: ApiError | null
  refetch: () => void
  isRegistering: boolean
  register: (input: Omit<RegisterFilamentMovementInput, 'spool_id'>) => Promise<FilamentMovement>
  isWeighing: boolean
  // null quando a diferença calculada é zero — nenhuma movimentação foi
  // gravada (register_filament_weighing devolve movement: null nesse caso).
  weigh: (input: Omit<RegisterFilamentWeighingInput, 'spool_id'>) => Promise<FilamentMovement | null>
}

// Um hook por rolo (spoolId) — remontado do zero a cada abertura do painel
// de movimentação/pesagem, mesmo padrão de useStockMovements.
export function useFilamentMovements(spoolId: string): UseFilamentMovementsResult {
  const [movements, setMovements] = useState<FilamentMovement[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)
  const [isRegistering, setIsRegistering] = useState(false)
  const [isWeighing, setIsWeighing] = useState(false)

  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listFilamentMovements(spoolId)
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
  }, [spoolId, requestId])

  const refetch = useCallback(() => setRequestId((id) => id + 1), [])

  const register = useCallback(
    async (input: Omit<RegisterFilamentMovementInput, 'spool_id'>) => {
      setIsRegistering(true)
      try {
        const created = await registerFilamentMovement({ ...input, spool_id: spoolId })
        setMovements((current) => [created, ...current])
        return created
      } finally {
        setIsRegistering(false)
      }
    },
    [spoolId],
  )

  const weigh = useCallback(
    async (input: Omit<RegisterFilamentWeighingInput, 'spool_id'>) => {
      setIsWeighing(true)
      try {
        const { movement } = await registerFilamentWeighing({ ...input, spool_id: spoolId })
        if (movement) setMovements((current) => [movement, ...current])
        return movement
      } finally {
        setIsWeighing(false)
      }
    },
    [spoolId],
  )

  return { movements, isLoading, loadError, refetch, isRegistering, register, isWeighing, weigh }
}
