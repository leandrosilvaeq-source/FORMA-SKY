import { useCallback, useEffect, useState } from 'react'
import { listProductPriceHistory } from '@/lib/api/products'
import { ApiError } from '@/lib/api/errors'
import type { ProductPriceHistory } from '@/types/domain'

// Espelha useProductFilaments.ts na estrutura (mesmo padrão de "ajustar
// estado durante a renderização" para productId trocar sem mostrar dado
// obsoleto de um produto anterior) — mas é só leitura (sem save/atualização
// via este hook): Histórico de preços é sempre somente leitura na Ficha
// Técnica/diálogo de edição, escrito exclusivamente por updateProductPrice.

export type ProductPriceHistoryStatus = 'idle' | 'loading' | 'error' | 'success'

interface UseProductPriceHistoryResult {
  status: ProductPriceHistoryStatus
  history: ProductPriceHistory[]
  isLoading: boolean
  error: ApiError | null
  retry: () => void
}

interface LoadResult {
  productId: string
  status: 'success' | 'error'
  history: ProductPriceHistory[]
  error: ApiError | null
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

// productId nulo (dialog fechado) não dispara nenhuma requisição.
export function useProductPriceHistory(productId: string | null): UseProductPriceHistoryResult {
  const [trackedProductId, setTrackedProductId] = useState(productId)
  const [result, setResult] = useState<LoadResult | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  // "Ajustar estado durante a renderização" — mesmo padrão oficial do React
  // já usado em useProductComposition.ts/useProductFilaments.ts
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  if (productId !== trackedProductId) {
    setTrackedProductId(productId)
    setResult(null)
  }

  useEffect(() => {
    if (!productId) return

    let cancelled = false

    listProductPriceHistory(productId)
      .then((rows) => {
        if (cancelled) return
        setResult({ productId, status: 'success', history: rows, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResult({ productId, status: 'error', history: [], error: toApiError(err) })
      })

    return () => {
      cancelled = true
    }
  }, [productId, retryToken])

  let status: ProductPriceHistoryStatus
  let history: ProductPriceHistory[] = []
  let error: ApiError | null = null

  if (!productId) {
    status = 'idle'
  } else if (result === null || result.productId !== productId) {
    status = 'loading'
  } else if (result.status === 'success') {
    status = 'success'
    history = result.history
  } else {
    status = 'error'
    error = result.error
  }

  const retry = useCallback(() => {
    setResult(null)
    setRetryToken((count) => count + 1)
  }, [])

  return { status, history, isLoading: status === 'loading', error, retry }
}
