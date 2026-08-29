import { useCallback, useEffect, useState } from 'react'
import {
  createOrder,
  createOrderWithPayment,
  deleteOrder,
  listOrderSummaries,
  type CreateOrderInput,
  type CreateOrderWithPaymentInput,
} from '@/lib/api/orders'
import { ApiError } from '@/lib/api/errors'
import type { OrderSummary } from '@/types/domain'

interface UseOrdersResult {
  orders: OrderSummary[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: CreateOrderInput) => Promise<{ id: string }>
  createWithPayment: (input: CreateOrderWithPaymentInput) => Promise<{ id: string; payment_id: string | null }>
  remove: (id: string) => Promise<void>
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

  // "Novo Pedido" com Forma de pagamento (2026-08-29) — rota/RPC distinta
  // (create_order_with_payment), nunca chamada por edição de pedido
  // existente. Mesma razão de refetch() que create acima: a resposta não
  // traz um OrderSummary completo (financeiro/aprovação vêm de várias
  // tabelas via vw_order_summary).
  const createWithPayment = useCallback(
    async (input: CreateOrderWithPaymentInput) => {
      const created = await createOrderWithPayment(input)
      refetch()
      return created
    },
    [refetch],
  )

  // Exclusão física (2026-08-29) — remove do estado local em vez de refazer
  // a listagem inteira (delete_order não devolve nenhuma linha; a ausência
  // do id já é toda a informação necessária).
  const remove = useCallback(async (id: string) => {
    await deleteOrder(id)
    setOrders((current) => current.filter((order) => order.order_id !== id))
  }, [])

  return { orders, isLoading, error, refetch, create, createWithPayment, remove }
}
