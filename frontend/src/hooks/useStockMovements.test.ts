import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listStockMovementsMock, registerStockMovementMock } = vi.hoisted(() => ({
  listStockMovementsMock: vi.fn(),
  registerStockMovementMock: vi.fn(),
}))

vi.mock('@/lib/api/stockMovements', () => ({
  listStockMovements: listStockMovementsMock,
  registerStockMovement: registerStockMovementMock,
}))

import { useStockMovements } from './useStockMovements'

const movement = {
  id: 'm1',
  item_type: 'ACCESSORY' as const,
  item_id: 'a1',
  movement_type: 'PURCHASE' as const,
  quantity_delta: 10,
  balance_before: 0,
  balance_after: 10,
  reason: null,
  reference_type: null,
  reference_id: null,
  idempotency_key: null,
  occurred_at: '2026-08-27T12:00:00Z',
  created_by: 'u1',
  created_at: '2026-08-27T12:00:00Z',
}

describe('useStockMovements', () => {
  beforeEach(() => {
    listStockMovementsMock.mockReset()
    registerStockMovementMock.mockReset()
  })

  it('loads the movement history for the given item on mount', async () => {
    listStockMovementsMock.mockResolvedValue([movement])

    const { result } = renderHook(() => useStockMovements('ACCESSORY', 'a1'))

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(listStockMovementsMock).toHaveBeenCalledWith('ACCESSORY', 'a1')
    expect(result.current.movements).toEqual([movement])
    expect(result.current.loadError).toBeNull()
  })

  it('exposes an ApiError when the history fails to load', async () => {
    listStockMovementsMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useStockMovements('ACCESSORY', 'a1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.loadError).toBeInstanceOf(ApiError)
    expect(result.current.loadError?.message).toBe('falhou')
  })

  it('register() calls registerStockMovement with item_type/item_id injected and inserts the result at the top of the history — without refetching', async () => {
    listStockMovementsMock.mockResolvedValue([])
    registerStockMovementMock.mockResolvedValue(movement)

    const { result } = renderHook(() => useStockMovements('ACCESSORY', 'a1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let created
    await act(async () => {
      created = await result.current.register({ movement_type: 'PURCHASE', quantity: 10 })
    })

    expect(registerStockMovementMock).toHaveBeenCalledWith({
      movement_type: 'PURCHASE',
      quantity: 10,
      item_type: 'ACCESSORY',
      item_id: 'a1',
    })
    expect(created).toEqual(movement)
    expect(result.current.movements).toEqual([movement])
    // Nunca dispara uma nova listagem — só a chamada inicial do mount.
    expect(listStockMovementsMock).toHaveBeenCalledTimes(1)
  })

  it('register() inserts new movements at the TOP (mais recente primeiro), preserving earlier ones', async () => {
    const olderMovement = { ...movement, id: 'm0', balance_after: 5 }
    listStockMovementsMock.mockResolvedValue([olderMovement])
    registerStockMovementMock.mockResolvedValue(movement)

    const { result } = renderHook(() => useStockMovements('ACCESSORY', 'a1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.register({ movement_type: 'PURCHASE', quantity: 10 })
    })

    expect(result.current.movements).toEqual([movement, olderMovement])
  })

  it('register() propagates an ApiError without changing the history', async () => {
    listStockMovementsMock.mockResolvedValue([movement])
    registerStockMovementMock.mockRejectedValue(new ApiError('business_rule', 409, 'saldo insuficiente'))

    const { result } = renderHook(() => useStockMovements('ACCESSORY', 'a1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.register({ movement_type: 'INTERNAL_USE', quantity: 999 })
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.movements).toEqual([movement])
  })

  it('isRegistering reflects only the register() call in flight', async () => {
    listStockMovementsMock.mockResolvedValue([])
    let resolveRegister: (value: typeof movement) => void = () => {}
    registerStockMovementMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRegister = resolve
      }),
    )

    const { result } = renderHook(() => useStockMovements('ACCESSORY', 'a1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let registerPromise: Promise<unknown> = Promise.resolve()
    act(() => {
      registerPromise = result.current.register({ movement_type: 'PURCHASE', quantity: 1 })
    })

    await waitFor(() => expect(result.current.isRegistering).toBe(true))

    await act(async () => {
      resolveRegister(movement)
      await registerPromise
    })

    expect(result.current.isRegistering).toBe(false)
  })

  it('refetch() triggers a new listStockMovements call', async () => {
    listStockMovementsMock.mockResolvedValue([movement])

    const { result } = renderHook(() => useStockMovements('ACCESSORY', 'a1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.refetch()
    })

    await waitFor(() => expect(listStockMovementsMock).toHaveBeenCalledTimes(2))
  })
})
