import { useCallback, useEffect, useState } from 'react'
import { listAccessories } from '@/lib/api/accessories'
import { ApiError } from '@/lib/api/errors'
import type { Accessory } from '@/types/domain'

interface UseAccessoriesResult {
  accessories: Accessory[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useAccessories(): UseAccessoriesResult {
  const [accessories, setAccessories] = useState<Accessory[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  // isLoading é derivado da comparação entre a requisição em andamento e a
  // última resolvida — nenhum setState síncrono no corpo do efeito (todos
  // os setState abaixo rodam dentro de callbacks de then/catch/finally).
  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listAccessories()
      .then((data) => {
        if (cancelled) return
        setAccessories(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(toApiError(err))
      })
      .finally(() => {
        if (!cancelled) setResolvedRequestId(requestId)
      })

    return () => {
      cancelled = true
    }
  }, [requestId])

  const refetch = useCallback(() => setRequestId((id) => id + 1), [])

  return { accessories, isLoading, error, refetch }
}
