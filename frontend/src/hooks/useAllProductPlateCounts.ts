import { useCallback, useEffect, useState } from 'react'
import { listAllProductPlates } from '@/lib/api/productPlates'
import { ApiError } from '@/lib/api/errors'

// Espelha useAllProductCategories.ts na estrutura — usado por OrderForm.tsx
// (seção "Cores e filamentos", migration 20260829180000, ainda não
// aplicada) para saber quantos plates cada produto CATALOG tem, sem 1
// consulta por linha de item.

interface UseAllProductPlateCountsResult {
  plateCountByProductId: Map<string, number>
  isLoading: boolean
  error: ApiError | null
  retry: () => void
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useAllProductPlateCounts(): UseAllProductPlateCountsResult {
  const [plateCountByProductId, setPlateCountByProductId] = useState<Map<string, number>>(new Map())
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listAllProductPlates()
      .then((plates) => {
        if (cancelled) return
        const counts = new Map<string, number>()
        for (const plate of plates) {
          counts.set(plate.product_id, (counts.get(plate.product_id) ?? 0) + 1)
        }
        setPlateCountByProductId(counts)
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

  const retry = useCallback(() => setRequestId((id) => id + 1), [])

  return { plateCountByProductId, isLoading, error, retry }
}
