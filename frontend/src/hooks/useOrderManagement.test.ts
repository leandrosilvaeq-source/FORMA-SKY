import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { getOrderSummaryMock, changeOrderStatusMock, listPaymentsMock, registerPaymentMock, listOrderStatusHistoryMock, listPaymentStatusHistoryMock } =
  vi.hoisted(() => ({
    getOrderSummaryMock: vi.fn(),
    changeOrderStatusMock: vi.fn(),
    listPaymentsMock: vi.fn(),
    registerPaymentMock: vi.fn(),
    listOrderStatusHistoryMock: vi.fn(),
    listPaymentStatusHistoryMock: vi.fn(),
  }))

vi.mock('@/lib/api/orders', () => ({
  getOrderSummary: getOrderSummaryMock,
  changeOrderStatus: changeOrderStatusMock,
}))
vi.mock('@/lib/api/payments', () => ({
  listPayments: listPaymentsMock,
  registerPayment: registerPaymentMock,
}))
vi.mock('@/lib/api/orderHistory', () => ({
  listOrderStatusHistory: listOrderStatusHistoryMock,
  listPaymentStatusHistory: listPaymentStatusHistoryMock,
}))

import { useOrderManagement } from './useOrderManagement'

const summary = {
  order_id: '1',
  order_number: 'FS-26-001',
  customer_id: 'c1',
  company_id: null,
  order_status: 'QUOTE',
  payment_status: 'WAITING_PAYMENT',
  payment_method: null,
  delivery_method: null,
  order_date: '2026-08-26',
  expected_delivery_date: null,
  actual_delivery_date: null,
  subtotal: 100,
  discount_value: 0,
  total_value: 100,
  shipping_cost: 0,
  total_receivable: 100,
  total_paid: 0,
  balance_due: 100,
  has_overpayment: false,
  overpayment_amount: 0,
  approval_required: false,
  is_fully_approved: true,
  pending_approval_items: 0,
  item_types: ['CATALOG'],
  item_names: ['Chaveiro'],
}

const payment = {
  id: 'pay-1',
  order_id: '1',
  payment_method: 'PIX',
  amount: 50,
  payment_type: 'SINAL',
  paid_at: '2026-08-26T12:00:00.000Z',
  notes: null,
  created_by: 'user-1',
  created_at: '2026-08-26T12:00:00.000Z',
}

const statusHistoryEntry = {
  id: 'h-1',
  order_id: '1',
  from_status: null,
  to_status: 'QUOTE',
  changed_at: '2026-08-26T10:00:00.000Z',
  changed_by: 'user-1',
  reason: 'Pedido criado',
}

const paymentStatusHistoryEntry = {
  id: 'ph-1',
  order_id: '1',
  from_status: null,
  to_status: 'WAITING_PAYMENT',
  changed_at: '2026-08-26T10:00:00.000Z',
  changed_by: 'user-1',
  reason: 'Pedido criado',
}

describe('useOrderManagement', () => {
  beforeEach(() => {
    getOrderSummaryMock.mockReset().mockResolvedValue(summary)
    changeOrderStatusMock.mockReset().mockResolvedValue(undefined)
    listPaymentsMock.mockReset().mockResolvedValue([payment])
    registerPaymentMock.mockReset().mockResolvedValue({ id: 'pay-2' })
    listOrderStatusHistoryMock.mockReset().mockResolvedValue([statusHistoryEntry])
    listPaymentStatusHistoryMock.mockReset().mockResolvedValue([paymentStatusHistoryEntry])
  })

  it('loads summary, payments and both histories on mount, scoped to the given orderId', async () => {
    const { result } = renderHook(() => useOrderManagement('1'))

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.summary).toEqual(summary)
    expect(result.current.payments).toEqual([payment])
    expect(result.current.statusHistory).toEqual([statusHistoryEntry])
    expect(result.current.paymentStatusHistory).toEqual([paymentStatusHistoryEntry])
    expect(getOrderSummaryMock).toHaveBeenCalledWith('1')
    expect(listPaymentsMock).toHaveBeenCalledWith('1')
    expect(listOrderStatusHistoryMock).toHaveBeenCalledWith('1')
    expect(listPaymentStatusHistoryMock).toHaveBeenCalledWith('1')
  })

  it('exposes an ApiError when any of the loads fails', async () => {
    listPaymentsMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useOrderManagement('1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.loadError).toBeInstanceOf(ApiError)
    expect(result.current.loadError?.message).toBe('falhou')
  })

  it('changeStatus() calls changeOrderStatus and refetches all four sources', async () => {
    const { result } = renderHook(() => useOrderManagement('1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    getOrderSummaryMock.mockClear()
    listPaymentsMock.mockClear()
    listOrderStatusHistoryMock.mockClear()
    listPaymentStatusHistoryMock.mockClear()

    await act(async () => {
      await result.current.changeStatus('WAITING_APPROVAL')
    })

    expect(changeOrderStatusMock).toHaveBeenCalledWith('1', 'WAITING_APPROVAL')
    await waitFor(() => expect(getOrderSummaryMock).toHaveBeenCalledTimes(1))
    expect(listPaymentsMock).toHaveBeenCalledTimes(1)
    expect(listOrderStatusHistoryMock).toHaveBeenCalledTimes(1)
    expect(listPaymentStatusHistoryMock).toHaveBeenCalledTimes(1)
  })

  it('changeStatus() propagates the real backend error without swallowing it', async () => {
    changeOrderStatusMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Transição de status inválida: QUOTE -> DELIVERED'),
    )
    const { result } = renderHook(() => useOrderManagement('1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.changeStatus('DELIVERED')
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('changeStatus() toggles isChangingStatus around the call', async () => {
    const { result } = renderHook(() => useOrderManagement('1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.isChangingStatus).toBe(false)
    const promise = act(async () => {
      await result.current.changeStatus('WAITING_APPROVAL')
    })
    await promise
    expect(result.current.isChangingStatus).toBe(false)
  })

  it('registerPaymentForOrder() injects order_id, calls registerPayment and refetches', async () => {
    const { result } = renderHook(() => useOrderManagement('1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    listPaymentsMock.mockClear()

    await act(async () => {
      await result.current.registerPaymentForOrder({
        payment_method: 'PIX',
        amount: 30,
        payment_type: 'SINAL',
        paid_at: '2026-08-26',
        notes: null,
      })
    })

    expect(registerPaymentMock).toHaveBeenCalledWith({
      order_id: '1',
      payment_method: 'PIX',
      amount: 30,
      payment_type: 'SINAL',
      paid_at: '2026-08-26',
      notes: null,
    })
    await waitFor(() => expect(listPaymentsMock).toHaveBeenCalledTimes(1))
  })

  it('registerPaymentForOrder() propagates the real backend error without swallowing it', async () => {
    registerPaymentMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Soma dos pagamentos ficaria negativa'),
    )
    const { result } = renderHook(() => useOrderManagement('1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.registerPaymentForOrder({
          payment_method: 'PIX',
          amount: -100,
          payment_type: 'AJUSTE',
          paid_at: '2026-08-26',
          notes: 'estorno',
        })
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('refetch() reloads all four sources again', async () => {
    const { result } = renderHook(() => useOrderManagement('1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    getOrderSummaryMock.mockClear()

    act(() => {
      result.current.refetch()
    })

    await waitFor(() => expect(getOrderSummaryMock).toHaveBeenCalledTimes(1))
  })
})
