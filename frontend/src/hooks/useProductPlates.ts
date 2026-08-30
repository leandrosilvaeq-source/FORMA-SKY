import { useCallback, useEffect, useState } from 'react'
import { listProductPlates } from '@/lib/api/productPlates'
import { ApiError } from '@/lib/api/errors'
import type { ProductPlate } from '@/types/domain'

// Espelha useProductComposition.ts na estrutura — leitura só (nenhum
// `save`: toda escrita de plates passa por updateProductFull/
// createProductWithPlates, nunca por uma chamada isolada daqui).
//
// A partir da migration 20260829180000_add_categories_plate_weight_and_order_colors.sql
// (ainda não aplicada), product_plates.weight_grams é uma coluna DIRETA —
// este hook não busca mais product_plate_filaments (composição de
// filamento saiu do Produto; a escolha agora acontece no Pedido). `select('*')`
// em listProductPlates já traz weight_grams assim que a coluna existir.

export type ProductPlatesStatus = 'idle' | 'loading' | 'error' | 'success'

interface UseProductPlatesResult {
  status: ProductPlatesStatus
  plates: ProductPlate[]
  isLoading: boolean
  error: ApiError | null
  retry: () => void
}

interface LoadResult {
  productId: string
  status: 'success' | 'error'
  plates: ProductPlate[]
  error: ApiError | null
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useProductPlates(productId: string | null): UseProductPlatesResult {
  const [trackedProductId, setTrackedProductId] = useState(productId)
  const [result, setResult] = useState<LoadResult | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  if (productId !== trackedProductId) {
    setTrackedProductId(productId)
    setResult(null)
  }

  useEffect(() => {
    if (!productId) return

    let cancelled = false

    listProductPlates(productId)
      .then((plates) => {
        if (cancelled) return
        setResult({ productId, status: 'success', plates, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResult({ productId, status: 'error', plates: [], error: toApiError(err) })
      })

    return () => {
      cancelled = true
    }
  }, [productId, retryToken])

  let status: ProductPlatesStatus
  let plates: ProductPlate[] = []
  let error: ApiError | null = null

  if (!productId) {
    status = 'idle'
  } else if (result === null || result.productId !== productId) {
    status = 'loading'
  } else if (result.status === 'success') {
    status = 'success'
    plates = result.plates
  } else {
    status = 'error'
    error = result.error
  }

  const retry = useCallback(() => {
    setResult(null)
    setRetryToken((count) => count + 1)
  }, [])

  return { status, plates, isLoading: status === 'loading', error, retry }
}
