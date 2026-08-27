import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listFilamentMovementsMock, registerFilamentMovementMock, registerFilamentWeighingMock } = vi.hoisted(() => ({
  listFilamentMovementsMock: vi.fn(),
  registerFilamentMovementMock: vi.fn(),
  registerFilamentWeighingMock: vi.fn(),
}))

vi.mock('@/lib/api/filamentMovements', () => ({
  listFilamentMovements: listFilamentMovementsMock,
  registerFilamentMovement: registerFilamentMovementMock,
  registerFilamentWeighing: registerFilamentWeighingMock,
}))

import { useFilamentMovements } from './useFilamentMovements'

const movement = {
  id: 'm1',
  filament_type_id: 't1',
  spool_id: 's1',
  movement_type: 'PURCHASE' as const,
  quantity_delta: 500,
  balance_before: 0,
  balance_after: 500,
  reason: null,
  reference_type: null,
  reference_id: null,
  idempotency_key: null,
  occurred_at: '2026-08-27T12:00:00Z',
  created_by: 'u1',
  created_at: '2026-08-27T12:00:00Z',
}

describe('useFilamentMovements', () => {
  beforeEach(() => {
    listFilamentMovementsMock.mockReset()
    registerFilamentMovementMock.mockReset()
    registerFilamentWeighingMock.mockReset()
  })

  it('loads the movement history for the given spool on mount', async () => {
    listFilamentMovementsMock.mockResolvedValue([movement])

    const { result } = renderHook(() => useFilamentMovements('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(listFilamentMovementsMock).toHaveBeenCalledWith('s1')
    expect(result.current.movements).toEqual([movement])
  })

  it('register() injects spool_id and inserts the created movement at the top', async () => {
    listFilamentMovementsMock.mockResolvedValue([])
    registerFilamentMovementMock.mockResolvedValue(movement)

    const { result } = renderHook(() => useFilamentMovements('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let created
    await act(async () => {
      created = await result.current.register({ movement_type: 'PURCHASE', quantity: 500 })
    })

    expect(registerFilamentMovementMock).toHaveBeenCalledWith({ movement_type: 'PURCHASE', quantity: 500, spool_id: 's1' })
    expect(created).toEqual(movement)
    expect(result.current.movements).toEqual([movement])
  })

  it('register() propagates an ApiError without changing the history', async () => {
    listFilamentMovementsMock.mockResolvedValue([movement])
    registerFilamentMovementMock.mockRejectedValue(new ApiError('business_rule', 409, 'peso insuficiente'))

    const { result } = renderHook(() => useFilamentMovements('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => result.current.register({ movement_type: 'LOSS', quantity: 9999, reason: 'teste' })),
    ).rejects.toBeInstanceOf(ApiError)
    expect(result.current.movements).toEqual([movement])
  })

  it('weigh() injects spool_id, inserts the movement at the top and returns it', async () => {
    const weighed = { ...movement, movement_type: 'WEIGHING_ADJUSTMENT' as const, quantity_delta: -50, balance_after: 450 }
    listFilamentMovementsMock.mockResolvedValue([])
    registerFilamentWeighingMock.mockResolvedValue({ movement: weighed })

    const { result } = renderHook(() => useFilamentMovements('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let returned
    await act(async () => {
      returned = await result.current.weigh({ measured_gross_weight_grams: 650, reason: 'conferência' })
    })

    expect(registerFilamentWeighingMock).toHaveBeenCalledWith({
      measured_gross_weight_grams: 650,
      reason: 'conferência',
      spool_id: 's1',
    })
    expect(returned).toEqual(weighed)
    expect(result.current.movements).toEqual([weighed])
  })

  it('weigh() with a zero difference resolves to null and does NOT insert anything into the history', async () => {
    listFilamentMovementsMock.mockResolvedValue([movement])
    registerFilamentWeighingMock.mockResolvedValue({ movement: null })

    const { result } = renderHook(() => useFilamentMovements('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let returned
    await act(async () => {
      returned = await result.current.weigh({ measured_net_weight_grams: 500, reason: 'conferência repetida' })
    })

    expect(returned).toBeNull()
    expect(result.current.movements).toEqual([movement])
  })

  it('weigh() propagates an ApiError without changing the history', async () => {
    listFilamentMovementsMock.mockResolvedValue([movement])
    registerFilamentWeighingMock.mockRejectedValue(new ApiError('validation', 400, 'motivo obrigatório'))

    const { result } = renderHook(() => useFilamentMovements('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(act(async () => result.current.weigh({ measured_net_weight_grams: 400, reason: '' }))).rejects.toBeInstanceOf(
      ApiError,
    )
    expect(result.current.movements).toEqual([movement])
  })

  it('isRegistering and isWeighing reflect only their own in-flight call', async () => {
    listFilamentMovementsMock.mockResolvedValue([])
    let resolveRegister: (value: typeof movement) => void = () => {}
    registerFilamentMovementMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRegister = resolve
      }),
    )

    const { result } = renderHook(() => useFilamentMovements('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let registerPromise: Promise<unknown> = Promise.resolve()
    act(() => {
      registerPromise = result.current.register({ movement_type: 'PURCHASE', quantity: 1 })
    })

    await waitFor(() => expect(result.current.isRegistering).toBe(true))
    expect(result.current.isWeighing).toBe(false)

    await act(async () => {
      resolveRegister(movement)
      await registerPromise
    })

    expect(result.current.isRegistering).toBe(false)
  })
})
