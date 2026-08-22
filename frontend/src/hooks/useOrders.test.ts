import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listOrderSummariesMock, createOrderMock } = vi.hoisted(() => ({
  listOrderSummariesMock: vi.fn(),
  createOrderMock: vi.fn(),
}))

vi.mock('@/lib/api/orders', () => ({
  listOrderSummaries: listOrderSummariesMock,
  createOrder: createOrderMock,
}))

import { useOrders } from './useOrders'

const orderA = {
  order_id: '1',
  order_number: 'FS-26-001',
  customer_id: 'c1',
  company_id: null,
  order_status: 'QUOTE',
  payment_status: 'WAITING_PAYMENT',
  payment_method: null,
  delivery_method: null,
  order_date: '2026-08-17',
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

const orderB = { ...orderA, order_id: '2', order_number: 'FS-26-002' }

describe('useOrders', () => {
  beforeEach(() => {
    listOrderSummariesMock.mockReset()
    createOrderMock.mockReset()
  })

  it('loads the order list on mount', async () => {
    listOrderSummariesMock.mockResolvedValue([orderA])

    const { result } = renderHook(() => useOrders())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.orders).toEqual([orderA])
    expect(result.current.error).toBeNull()
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listOrderSummariesMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useOrders())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
  })

  it('create() calls the API and refetches the list instead of fabricating a summary locally', async () => {
    listOrderSummariesMock.mockResolvedValueOnce([orderA]).mockResolvedValueOnce([orderA, orderB])
    createOrderMock.mockResolvedValue({ id: '2' })

    const { result } = renderHook(() => useOrders())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const input = {
      customer_id: 'c1',
      items: [{ item_type: 'CATALOG' as const, item_name: 'Chaveiro', quantity: 1, unit_price: 10, product_id: 'p1' }],
    }

    await act(async () => {
      await result.current.create(input)
    })

    expect(createOrderMock).toHaveBeenCalledWith(input)
    await waitFor(() => expect(listOrderSummariesMock).toHaveBeenCalledTimes(2))
    expect(result.current.orders).toEqual([orderA, orderB])
  })

  it('create() propagates ApiError without swallowing it', async () => {
    listOrderSummariesMock.mockResolvedValue([])
    createOrderMock.mockRejectedValue(new ApiError('validation', 400, 'campo inválido'))

    const { result } = renderHook(() => useOrders())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.create({ customer_id: 'c1', items: [] })
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})
