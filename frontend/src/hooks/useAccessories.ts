import { useCallback, useEffect, useState } from 'react'
import { PT_BR_COLLATOR } from '@/components/dataTable/sorting'
import {
  createAccessory,
  listAccessories,
  updateAccessory,
  type CreateAccessoryInput,
  type UpdateAccessoryInput,
} from '@/lib/api/accessories'
import { ApiError } from '@/lib/api/errors'
import type { Accessory } from '@/types/domain'

interface UseAccessoriesResult {
  accessories: Accessory[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: CreateAccessoryInput) => Promise<Accessory>
  update: (id: string, input: UpdateAccessoryInput) => Promise<Accessory>
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useAccessories(): UseAccessoriesResult {
  const [accessories, setAccessories] = useState<Accessory[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  // isLoading é derivado da comparação entre a requisição em andamento e a
  // última resolvida — nenhum setState síncrono no corpo do efeito (todos
  // os setState abaixo rodam dentro de callbacks de then/catch/finally).
  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listAccessories()
      .then((data) => {
        if (cancelled) return
        setAccessories(data)
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

  // createAccessory (Edge Function -> create_accessory) já devolve a linha
  // completa — diferente de createProduct (só {id}), não precisamos de um
  // refetch inteiro: inserimos localmente e reordenamos por nome com o
  // mesmo collator pt-BR usado em sorting.ts, preservando a mesma ordem
  // alfabética que um refetch real traria (listAccessories já ordena por
  // nome no banco).
  const create = useCallback(async (input: CreateAccessoryInput) => {
    const created = await createAccessory(input)
    setAccessories((current) => [...current, created].sort((a, b) => PT_BR_COLLATOR.compare(a.name, b.name)))
    return created
  }, [])

  // Mesmo raciocínio de create: updateAccessory já devolve a linha completa
  // atualizada — substituída in-place no array local (por id) e reordenada
  // por nome, sem refetch.
  const update = useCallback(async (id: string, input: UpdateAccessoryInput) => {
    const updated = await updateAccessory(id, input)
    setAccessories((current) =>
      current.map((item) => (item.id === id ? updated : item)).sort((a, b) => PT_BR_COLLATOR.compare(a.name, b.name)),
    )
    return updated
  }, [])

  return { accessories, isLoading, error, refetch, create, update }
}
