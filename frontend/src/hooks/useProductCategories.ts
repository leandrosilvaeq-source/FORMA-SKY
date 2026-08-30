import { useCallback, useEffect, useState } from 'react'
import { listProductCategoriesForProduct } from '@/lib/api/products'
import { ApiError } from '@/lib/api/errors'
import type { ProductCategory } from '@/types/domain'

// Espelha useProductPlates.ts na estrutura — leitura só (toda escrita de
// categorias passa por createProductWithPlates/updateProductFull, nunca uma
// chamada isolada daqui). Migration 20260829180000_add_categories_plate_weight_and_order_colors.sql
// (ainda não aplicada) — product_categories é a fonte AUTORITATIVA de
// categorias (N por Produto), já em ordem de exibição (position asc).

export type ProductCategoriesStatus = 'idle' | 'loading' | 'error' | 'success'

interface UseProductCategoriesResult {
  status: ProductCategoriesStatus
  categories: ProductCategory[]
  isLoading: boolean
  error: ApiError | null
  retry: () => void
}

interface LoadResult {
  productId: string
  status: 'success' | 'error'
  categories: ProductCategory[]
  error: ApiError | null
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useProductCategories(productId: string | null): UseProductCategoriesResult {
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

    listProductCategoriesForProduct(productId)
      .then((categories) => {
        if (cancelled) return
        setResult({ productId, status: 'success', categories, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResult({ productId, status: 'error', categories: [], error: toApiError(err) })
      })

    return () => {
      cancelled = true
    }
  }, [productId, retryToken])

  let status: ProductCategoriesStatus
  let categories: ProductCategory[] = []
  let error: ApiError | null = null

  if (!productId) {
    status = 'idle'
  } else if (result === null || result.productId !== productId) {
    status = 'loading'
  } else if (result.status === 'success') {
    status = 'success'
    categories = result.categories
  } else {
    status = 'error'
    error = result.error
  }

  const retry = useCallback(() => {
    setResult(null)
    setRetryToken((count) => count + 1)
  }, [])

  return { status, categories, isLoading: status === 'loading', error, retry }
}
