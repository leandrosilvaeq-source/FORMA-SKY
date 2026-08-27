import { useCallback, useEffect, useState } from 'react'
import { PT_BR_COLLATOR } from '@/components/dataTable/sorting'
import {
  createPackaging,
  deletePackaging,
  listPackaging,
  updatePackaging,
  type CreatePackagingInput,
  type UpdatePackagingInput,
} from '@/lib/api/packaging'
import { ApiError } from '@/lib/api/errors'
import type { Packaging } from '@/types/domain'

interface UsePackagingResult {
  packaging: Packaging[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: CreatePackagingInput) => Promise<Packaging>
  update: (id: string, input: UpdatePackagingInput) => Promise<Packaging>
  delete: (id: string) => Promise<void>
  // Mesmo raciocínio de useAccessories.setLocalStock: atualização local pura
  // (sem chamada de rede) depois de uma movimentação de estoque bem-sucedida.
  setLocalStock: (id: string, currentStock: number) => void
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function usePackaging(): UsePackagingResult {
  const [packaging, setPackaging] = useState<Packaging[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  // isLoading é derivado da comparação entre a requisição em andamento e a
  // última resolvida — nenhum setState síncrono no corpo do efeito (todos
  // os setState abaixo rodam dentro de callbacks de then/catch/finally).
  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listPackaging()
      .then((data) => {
        if (cancelled) return
        setPackaging(data)
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

  // Mesmo raciocínio de useAccessories.create: createPackaging já devolve a
  // linha completa, inserida localmente e reordenada por nome (mesmo
  // collator pt-BR de sorting.ts) em vez de um refetch inteiro.
  const create = useCallback(async (input: CreatePackagingInput) => {
    const created = await createPackaging(input)
    setPackaging((current) => [...current, created].sort((a, b) => PT_BR_COLLATOR.compare(a.name, b.name)))
    return created
  }, [])

  // Mesmo raciocínio de create: updatePackaging já devolve a linha completa
  // atualizada — substituída in-place no array local (por id) e reordenada
  // por nome, sem refetch.
  const update = useCallback(async (id: string, input: UpdatePackagingInput) => {
    const updated = await updatePackaging(id, input)
    setPackaging((current) =>
      current.map((item) => (item.id === id ? updated : item)).sort((a, b) => PT_BR_COLLATOR.compare(a.name, b.name)),
    )
    return updated
  }, [])

  // Exclusão física protegida (DELETE /packaging/:id -> delete_packaging):
  // a Edge Function/RPC já bloqueia com erro de negócio (409, mensagem
  // orientando desativação) quando a embalagem está vinculada a um produto
  // — se deletePackaging rejeita, o item nunca é removido do array local.
  const deleteItem = useCallback(async (id: string) => {
    await deletePackaging(id)
    setPackaging((current) => current.filter((item) => item.id !== id))
  }, [])

  const setLocalStock = useCallback((id: string, currentStock: number) => {
    setPackaging((current) =>
      current.map((item) => (item.id === id ? { ...item, current_stock: currentStock } : item)),
    )
  }, [])

  return { packaging, isLoading, error, refetch, create, update, delete: deleteItem, setLocalStock }
}
