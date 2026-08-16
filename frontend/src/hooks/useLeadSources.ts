import { useCallback, useEffect, useState } from 'react'
import { listLeadSources } from '@/lib/api/lookups'
import { ApiError } from '@/lib/api/errors'
import type { LeadSource } from '@/types/domain'

interface UseLeadSourcesResult {
  leadSources: LeadSource[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useLeadSources(): UseLeadSourcesResult {
  const [leadSources, setLeadSources] = useState<LeadSource[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  // isLoading é derivado da comparação entre a requisição em andamento e a
  // última resolvida — nenhum setState síncrono no corpo do efeito (todos
  // os setState abaixo rodam dentro de callbacks de then/catch/finally).
  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listLeadSources()
      .then((data) => {
        if (cancelled) return
        setLeadSources(data)
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

  return { leadSources, isLoading, error, refetch }
}
