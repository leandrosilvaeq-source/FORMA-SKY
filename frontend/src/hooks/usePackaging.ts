import { useCallback, useEffect, useState } from 'react'
import { PT_BR_COLLATOR } from '@/components/dataTable/sorting'
import { createPackaging, listPackaging, type CreatePackagingInput } from '@/lib/api/packaging'
import { ApiError } from '@/lib/api/errors'
import type { Packaging } from '@/types/domain'

interface UsePackagingResult {
  packaging: Packaging[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: CreatePackagingInput) => Promise<Packaging>
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

  return { packaging, isLoading, error, refetch, create }
}
