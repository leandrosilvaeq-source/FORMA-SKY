import { useCallback, useEffect, useState } from 'react'
import { getProduct } from '@/lib/api/products'
import { ApiError } from '@/lib/api/errors'
import type { Product } from '@/types/domain'

export type ProductDetailStatus = 'loading' | 'error' | 'not_found' | 'success'

interface UseProductResult {
  status: ProductDetailStatus
  product: Product | null
  error: ApiError | null
  retry: () => void
}

// Resultado de UMA busca, sempre carimbado com o productId a que pertence —
// mesmo padrão de useProductComposition: impede uma resposta de um produto
// diferente/antigo (ex.: usuário navegou rápido entre duas fichas) de ser
// tratada como se fosse a resposta do productId atual.
interface LoadResult {
  productId: string
  status: 'success' | 'not_found' | 'error'
  product: Product | null
  error: ApiError | null
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useProduct(productId: string): UseProductResult {
  const [result, setResult] = useState<LoadResult | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    getProduct(productId)
      .then((product) => {
        if (cancelled) return
        setResult({
          productId,
          status: product ? 'success' : 'not_found',
          product,
          error: null,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResult({ productId, status: 'error', product: null, error: toApiError(err) })
      })

    return () => {
      cancelled = true
    }
  }, [productId, retryToken])

  const retry = useCallback(() => {
    setResult(null)
    setRetryToken((count) => count + 1)
  }, [])

  let status: ProductDetailStatus
  let product: Product | null = null
  let error: ApiError | null = null

  if (result === null || result.productId !== productId) {
    status = 'loading'
  } else if (result.status === 'success') {
    status = 'success'
    product = result.product
  } else if (result.status === 'not_found') {
    status = 'not_found'
  } else {
    status = 'error'
    error = result.error
  }

  return { status, product, error, retry }
}
