import { useCallback, useEffect, useState } from 'react'
import {
  createProduct,
  createProductWithPlates,
  listProducts,
  updateProduct,
  updateProductDetails,
  updateProductFull,
  updateProductPrice,
  type CreateProductInput,
  type CreateProductWithPlatesInput,
  type UpdateProductDetailsInput,
  type UpdateProductFullInput,
  type UpdateProductInput,
  type UpdateProductPriceInput,
} from '@/lib/api/products'
import { ApiError } from '@/lib/api/errors'
import type { Product } from '@/types/domain'

interface UseProductsResult {
  products: Product[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: CreateProductInput) => Promise<void>
  // Estrutura produtiva por plates (2026-08-29) — cria o Produto e, na
  // mesma transação no banco, plates/filamentos/totais/Acessórios/
  // Embalagens (create_product_with_plates). Único caminho usado pelo novo
  // formulário "Novo Produto" — createProduct (acima) continua existindo
  // para qualquer outro uso direto da rota antiga, sem alteração.
  createWithPlates: (input: CreateProductWithPlatesInput) => Promise<void>
  changePrice: (productId: string, input: UpdateProductPriceInput) => Promise<void>
  update: (productId: string, input: UpdateProductInput) => Promise<Product>
  updateDetails: (productId: string, input: UpdateProductDetailsInput) => Promise<Product>
  // Edição atômica completa (Dados Gerais + Composição por plates +
  // Acessórios/Embalagens) — update_product_full.
  updateFull: (productId: string, input: UpdateProductFullInput) => Promise<Product>
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useProducts(): UseProductsResult {
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  // isLoading é derivado da comparação entre a requisição em andamento e a
  // última resolvida — nenhum setState síncrono no corpo do efeito (todos
  // os setState abaixo rodam dentro de callbacks de then/catch/finally).
  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listProducts()
      .then((data) => {
        if (cancelled) return
        setProducts(data)
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

  // createProduct/updateProductPrice (Edge Function) devolvem só
  // {id}/{price_history_id}, não a linha completa — por isso, ao invés de um
  // patch local que inventaria created_at/updated_at, refazemos listProducts
  // para manter a lista fiel ao banco.
  const create = useCallback(
    async (input: CreateProductInput) => {
      await createProduct(input)
      refetch()
    },
    [refetch],
  )

  const createWithPlates = useCallback(
    async (input: CreateProductWithPlatesInput) => {
      await createProductWithPlates(input)
      refetch()
    },
    [refetch],
  )

  const changePrice = useCallback(
    async (productId: string, input: UpdateProductPriceInput) => {
      await updateProductPrice(productId, input)
      refetch()
    },
    [refetch],
  )

  // updateProduct devolve a linha completa (supabase-js direto, sem RPC) —
  // igual a customers, substituímos o item local em vez de refazer a listagem.
  const update = useCallback(async (productId: string, input: UpdateProductInput) => {
    const updated = await updateProduct(productId, input)
    setProducts((current) => current.map((product) => (product.id === productId ? updated : product)))
    return updated
  }, [])

  // updateProductDetails (PATCH /products/:id -> update_product, NOVA
  // 2026-08-29) também devolve a linha completa (RETURNING * na RPC) —
  // mesmo padrão de substituição local de update() acima. Nunca toca
  // default_price (fica com changePrice, acima).
  const updateDetails = useCallback(async (productId: string, input: UpdateProductDetailsInput) => {
    const updated = await updateProductDetails(productId, input)
    setProducts((current) => current.map((product) => (product.id === productId ? updated : product)))
    return updated
  }, [])

  const updateFull = useCallback(async (productId: string, input: UpdateProductFullInput) => {
    const updated = await updateProductFull(productId, input)
    setProducts((current) => current.map((product) => (product.id === productId ? updated : product)))
    return updated
  }, [])

  return {
    products,
    isLoading,
    error,
    refetch,
    create,
    createWithPlates,
    changePrice,
    update,
    updateDetails,
    updateFull,
  }
}
