import { useCallback, useEffect, useState } from 'react'
import {
  listProductAccessories,
  listProductPackaging,
  updateProductComposition,
  type UpdateProductCompositionInput,
} from '@/lib/api/productComposition'
import { ApiError } from '@/lib/api/errors'
import type { ProductAccessory, ProductPackaging } from '@/types/domain'

export type ProductCompositionStatus = 'idle' | 'loading' | 'error' | 'success'

interface UseProductCompositionResult {
  status: ProductCompositionStatus
  accessories: ProductAccessory[]
  packaging: ProductPackaging[]
  isLoading: boolean
  error: ApiError | null
  retry: () => void
  save: (input: UpdateProductCompositionInput) => Promise<void>
}

// Resultado de UMA busca, sempre carimbado com o productId a que pertence —
// é essa marca (comparada ao productId atual mais abaixo) que impede uma
// resposta de um produto diferente/antigo de ser tratada como se fosse a
// resposta do produto atualmente selecionado.
interface LoadResult {
  productId: string
  status: 'success' | 'error'
  accessories: ProductAccessory[]
  packaging: ProductPackaging[]
  error: ApiError | null
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

// productId nulo (dialog fechado) não dispara nenhuma requisição — carrega
// só quando um produto é selecionado para editar a composição.
export function useProductComposition(productId: string | null): UseProductCompositionResult {
  const [trackedProductId, setTrackedProductId] = useState(productId)
  const [result, setResult] = useState<LoadResult | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  // "Ajustar estado durante a renderização" — padrão oficial do React para
  // resetar estado derivado quando uma prop muda
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // Ao detectar que productId mudou — inclusive ao REABRIR/REVISITAR um
  // productId já carregado antes (fechar e reabrir o mesmo produto) —
  // descarta `result` de forma síncrona, antes do commit, para que a última
  // resposta bem-sucedida de uma carga anterior nunca seja exibida/usada
  // como se fosse a resposta da carga atual. Isto não é "setState em
  // efeito" (que causa cascading renders e é rejeitado pelo lint
  // react-hooks/set-state-in-effect): é o padrão que o próprio React
  // suporta para este caso, disparado no corpo do componente, fora de
  // useEffect.
  if (productId !== trackedProductId) {
    setTrackedProductId(productId)
    setResult(null)
  }

  useEffect(() => {
    if (!productId) return

    let cancelled = false

    Promise.all([listProductAccessories(productId), listProductPackaging(productId)])
      .then(([accessoryRows, packagingRows]) => {
        if (cancelled) return
        setResult({ productId, status: 'success', accessories: accessoryRows, packaging: packagingRows, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResult({ productId, status: 'error', accessories: [], packaging: [], error: toApiError(err) })
      })

    return () => {
      cancelled = true
    }
  }, [productId, retryToken])

  // status/accessories/packaging/error são todos derivados de `result`, só
  // aplicado quando `result.productId === productId` — proteção explícita
  // adicional (além do `cancelled` do efeito acima) contra uma resposta
  // tardia de um produto diferente vazar para o produto atual.
  let status: ProductCompositionStatus
  let accessories: ProductAccessory[] = []
  let packaging: ProductPackaging[] = []
  let error: ApiError | null = null

  if (!productId) {
    status = 'idle'
  } else if (result === null || result.productId !== productId) {
    status = 'loading'
  } else if (result.status === 'success') {
    status = 'success'
    accessories = result.accessories
    packaging = result.packaging
  } else {
    status = 'error'
    error = result.error
  }

  const retry = useCallback(() => {
    setResult(null)
    setRetryToken((count) => count + 1)
  }, [])

  const save = useCallback(
    async (input: UpdateProductCompositionInput) => {
      if (!productId) return
      await updateProductComposition(productId, input)
    },
    [productId],
  )

  return { status, accessories, packaging, isLoading: status === 'loading', error, retry, save }
}
