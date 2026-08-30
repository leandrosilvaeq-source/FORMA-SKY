import { useCallback, useEffect, useState } from 'react'
import { listProductFilaments } from '@/lib/api/productFilaments'
import { ApiError } from '@/lib/api/errors'
import type { ProductFilament } from '@/types/domain'

// Espelha useProductComposition.ts (Acessórios/Embalagens, NUNCA alterado
// por este incremento) na estrutura, mas é um hook independente.
//
// SOMENTE LEITURA a partir da limpeza de código órfão de 2026-08-29: este
// hook perdeu `save` (chamava updateProductFilaments -> PATCH
// /products/:id/filaments -> RPC set_product_filaments) por não ter mais
// nenhum consumidor de UI — o antigo diálogo "Composição de filamentos"
// (FilamentCompositionForm.tsx) que o chamava foi removido numa rodada
// anterior, e a própria migration pendente revoga o EXECUTE de
// service_role dessa RPC. product_filaments é dado LEGADO — a estrutura
// autoritativa de produção é product_plates/product_plate_filaments
// (migration 20260829160000_add_product_plates_structure.sql). Este hook
// continua existindo só como leitura — usado como fallback transitório de
// compatibilidade por ProductsPage.tsx/ProductDetailPage.tsx para Produtos
// que ainda não têm nenhum plate.

export type ProductFilamentsStatus = 'idle' | 'loading' | 'error' | 'success'

interface UseProductFilamentsResult {
  status: ProductFilamentsStatus
  filaments: ProductFilament[]
  isLoading: boolean
  error: ApiError | null
  retry: () => void
}

interface LoadResult {
  productId: string
  status: 'success' | 'error'
  filaments: ProductFilament[]
  error: ApiError | null
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

// productId nulo (dialog fechado) não dispara nenhuma requisição — carrega
// só quando um produto é selecionado.
export function useProductFilaments(productId: string | null): UseProductFilamentsResult {
  const [trackedProductId, setTrackedProductId] = useState(productId)
  const [result, setResult] = useState<LoadResult | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  // "Ajustar estado durante a renderização" — mesmo padrão oficial do React
  // já usado em useProductComposition.ts (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  if (productId !== trackedProductId) {
    setTrackedProductId(productId)
    setResult(null)
  }

  useEffect(() => {
    if (!productId) return

    let cancelled = false

    listProductFilaments(productId)
      .then((filamentRows) => {
        if (cancelled) return
        setResult({ productId, status: 'success', filaments: filamentRows, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResult({ productId, status: 'error', filaments: [], error: toApiError(err) })
      })

    return () => {
      cancelled = true
    }
  }, [productId, retryToken])

  let status: ProductFilamentsStatus
  let filaments: ProductFilament[] = []
  let error: ApiError | null = null

  if (!productId) {
    status = 'idle'
  } else if (result === null || result.productId !== productId) {
    status = 'loading'
  } else if (result.status === 'success') {
    status = 'success'
    filaments = result.filaments
  } else {
    status = 'error'
    error = result.error
  }

  const retry = useCallback(() => {
    setResult(null)
    setRetryToken((count) => count + 1)
  }, [])

  return { status, filaments, isLoading: status === 'loading', error, retry }
}
