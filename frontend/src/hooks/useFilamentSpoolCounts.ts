import { useCallback, useEffect, useMemo, useState } from 'react'
import { listAvailableSpoolCountsByType } from '@/lib/api/filamentSpools'
import { ApiError } from '@/lib/api/errors'

interface UseFilamentSpoolCountsResult {
  // Rolos DISPONÍVEIS (saldo > 0) por filament_type_id. `null` enquanto a
  // primeira carga não terminou; num erro, permanece o último valor bom (ou
  // `null` se nunca carregou) e `error` fica preenchido — o chamador mostra
  // "—" e desabilita o filtro de faixa, NUNCA cai em usable_spool_count.
  countByTypeId: Map<string, number> | null
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

// Uma única consulta em lote (`.in('filament_type_id', ids)`) sobre
// filament_spools — sem N+1, sem consultar filament_movements. Remontada
// quando o conjunto de ids muda.
export function useFilamentSpoolCounts(filamentTypeIds: string[]): UseFilamentSpoolCountsResult {
  const idsKey = useMemo(() => [...filamentTypeIds].sort().join('|'), [filamentTypeIds])

  const [countByTypeId, setCountByTypeId] = useState<Map<string, number> | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false
    const ids = idsKey ? idsKey.split('|') : []

    listAvailableSpoolCountsByType(ids)
      .then((data) => {
        if (cancelled) return
        setCountByTypeId(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toApiError(err))
      })
      .finally(() => {
        if (!cancelled) setResolvedRequestId(requestId)
      })

    return () => {
      cancelled = true
    }
  }, [idsKey, requestId])

  const refetch = useCallback(() => setRequestId((id) => id + 1), [])

  return { countByTypeId, isLoading, error, refetch }
}
