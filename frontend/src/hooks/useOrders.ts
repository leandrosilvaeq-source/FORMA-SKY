import { useCallback, useEffect, useState } from 'react'
import { createOrder, listOrderSummaries, type CreateOrderInput } from '@/lib/api/orders'
import { ApiError } from '@/lib/api/errors'
import type { OrderSummary } from '@/types/domain'

interface UseOrdersResult {
  orders: OrderSummary[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: CreateOrderInput) => Promise<{ id: string }>
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useOrders(): UseOrdersResult {
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  // isLoading é derivado da comparação entre a requisição em andamento e a
  // última resolvida — nenhum setState síncrono no corpo do efeito (todos
  // os setState abaixo rodam dentro de callbacks de then/catch/finally).
  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listOrderSummaries()
      .then((data) => {
        if (cancelled) return
        setOrders(data)
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

  // createOrder devolve só {id} — vw_order_summary consolida financeiro e
  // aprovação a partir de várias tabelas (não replicável no cliente), então
  // refazemos listOrderSummaries() em vez de fabricar um OrderSummary local.
  const create = useCallback(
    async (input: CreateOrderInput) => {
      const created = await createOrder(input)
      refetch()
      return created
    },
    [refetch],
  )

  return { orders, isLoading, error, refetch, create }
}
