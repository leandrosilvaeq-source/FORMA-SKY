import { useCallback, useEffect, useState } from 'react'
import { listAllProductCategories } from '@/lib/api/products'
import { ApiError } from '@/lib/api/errors'

// Hook próprio (não incorporado a useProducts.ts, para não alterar seus
// testes/contrato existentes) — busca TODAS as categorias de TODOS os
// produtos numa única consulta, usado por ProductsPage.tsx para exibir e
// filtrar por categoria (múltiplas por Produto) na listagem sem 1 consulta
// por linha. Migration 20260829180000_add_categories_plate_weight_and_order_colors.sql
// (ainda não aplicada).

interface UseAllProductCategoriesResult {
  categoriesByProductId: Map<string, string[]>
  isLoading: boolean
  error: ApiError | null
  retry: () => void
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useAllProductCategories(): UseAllProductCategoriesResult {
  const [categoriesByProductId, setCategoriesByProductId] = useState<Map<string, string[]>>(new Map())
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listAllProductCategories()
      .then((rows) => {
        if (cancelled) return
        const grouped = new Map<string, string[]>()
        for (const row of rows) {
          const current = grouped.get(row.product_id) ?? []
          current.push(row.category)
          grouped.set(row.product_id, current)
        }
        setCategoriesByProductId(grouped)
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

  return { categoriesByProductId, isLoading, error, retry }
}
