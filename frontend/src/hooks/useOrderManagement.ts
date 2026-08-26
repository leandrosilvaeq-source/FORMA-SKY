import { useCallback, useEffect, useState } from 'react'
import { changeOrderStatus, getOrderSummary } from '@/lib/api/orders'
import { listPayments, registerPayment, type RegisterPaymentInput } from '@/lib/api/payments'
import { listOrderStatusHistory, listPaymentStatusHistory } from '@/lib/api/orderHistory'
import { ApiError } from '@/lib/api/errors'
import type { OrderStatus, OrderStatusHistory, OrderSummary, Payment, PaymentStatusHistory } from '@/types/domain'

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

interface UseOrderManagementResult {
  summary: OrderSummary | null
  payments: Payment[]
  statusHistory: OrderStatusHistory[]
  paymentStatusHistory: PaymentStatusHistory[]
  isLoading: boolean
  loadError: ApiError | null
  refetch: () => void
  isChangingStatus: boolean
  // Lança em caso de erro (o backend é a única fonte de verdade sobre se a
  // transição é permitida) — o chamador decide como exibir, mesmo padrão já
  // usado por useCustomers/useCompanies.update.
  changeStatus: (toStatus: OrderStatus) => Promise<void>
  isRegisteringPayment: boolean
  registerPaymentForOrder: (input: Omit<RegisterPaymentInput, 'order_id'>) => Promise<void>
}

// Um hook por pedido (orderId), sempre remontado do zero a cada abertura do
// painel de gerenciamento — mesmo padrão já usado por OrderEditForm.tsx
// (nunca reaproveita a mesma instância para um orderId diferente). Reúne
// tudo que o painel de gerenciamento precisa: resumo financeiro/aprovação
// (vw_order_summary), pagamentos, e os dois históricos imutáveis — nenhum
// desses dados é inventado ou calculado aqui, só lido das fontes já
// existentes.
export function useOrderManagement(orderId: string): UseOrderManagementResult {
  const [summary, setSummary] = useState<OrderSummary | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [statusHistory, setStatusHistory] = useState<OrderStatusHistory[]>([])
  const [paymentStatusHistory, setPaymentStatusHistory] = useState<PaymentStatusHistory[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)
  const [isChangingStatus, setIsChangingStatus] = useState(false)
  const [isRegisteringPayment, setIsRegisteringPayment] = useState(false)

  // isLoading é derivado da comparação entre a requisição em andamento e a
  // última resolvida — mesmo padrão já usado por useCustomers/useCompanies/
  // useOrders: nenhum setState síncrono no corpo do efeito (todos os
  // setState abaixo rodam dentro de callbacks de then/catch/finally).
  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    Promise.all([
      getOrderSummary(orderId),
      listPayments(orderId),
      listOrderStatusHistory(orderId),
      listPaymentStatusHistory(orderId),
    ])
      .then(([summaryData, paymentsData, statusHistoryData, paymentStatusHistoryData]) => {
        if (cancelled) return
        setSummary(summaryData)
        setPayments(paymentsData)
        setStatusHistory(statusHistoryData)
        setPaymentStatusHistory(paymentStatusHistoryData)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(toApiError(err))
      })
      .finally(() => {
        if (!cancelled) setResolvedRequestId(requestId)
      })

    return () => {
      cancelled = true
    }
  }, [orderId, requestId])

  const refetch = useCallback(() => setRequestId((id) => id + 1), [])

  const changeStatus = useCallback(
    async (toStatus: OrderStatus) => {
      setIsChangingStatus(true)
      try {
        await changeOrderStatus(orderId, toStatus)
        refetch()
      } finally {
        setIsChangingStatus(false)
      }
    },
    [orderId, refetch],
  )

  const registerPaymentForOrder = useCallback(
    async (input: Omit<RegisterPaymentInput, 'order_id'>) => {
      setIsRegisteringPayment(true)
      try {
        await registerPayment({ ...input, order_id: orderId })
        refetch()
      } finally {
        setIsRegisteringPayment(false)
      }
    },
    [orderId, refetch],
  )

  return {
    summary,
    payments,
    statusHistory,
    paymentStatusHistory,
    isLoading,
    loadError,
    refetch,
    isChangingStatus,
    changeStatus,
    isRegisteringPayment,
    registerPaymentForOrder,
  }
}
