import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listAccessoriesMock, createAccessoryMock, updateAccessoryMock } = vi.hoisted(() => ({
  listAccessoriesMock: vi.fn(),
  createAccessoryMock: vi.fn(),
  updateAccessoryMock: vi.fn(),
}))

vi.mock('@/lib/api/accessories', () => ({
  listAccessories: listAccessoriesMock,
  createAccessory: createAccessoryMock,
  updateAccessory: updateAccessoryMock,
}))

import { useAccessories } from './useAccessories'

const accessory = {
  id: '1',
  name: 'Ímã 6x2',
  material: null,
  size: null,
  variant: null,
  unit_cost: null,
  minimum_stock: null,
  current_stock: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const otherAccessory = { ...accessory, id: '2', name: 'Zebra clipe' }

describe('useAccessories', () => {
  beforeEach(() => {
    listAccessoriesMock.mockReset()
    createAccessoryMock.mockReset()
    updateAccessoryMock.mockReset()
  })

  it('loads the accessory list on mount', async () => {
    listAccessoriesMock.mockResolvedValue([accessory])

    const { result } = renderHook(() => useAccessories())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.accessories).toEqual([accessory])
    expect(result.current.error).toBeNull()
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listAccessoriesMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useAccessories())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
  })

  it('create() calls the API, inserts the new item locally (sorted by name) and returns it — without refetching', async () => {
    listAccessoriesMock.mockResolvedValue([otherAccessory])
    createAccessoryMock.mockResolvedValue(accessory)

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let created
    await act(async () => {
      created = await result.current.create({ name: 'Ímã 6x2', minimum_stock: 5 })
    })

    expect(createAccessoryMock).toHaveBeenCalledWith({ name: 'Ímã 6x2', minimum_stock: 5 })
    expect(created).toEqual(accessory)
    // "Ímã 6x2" vem antes de "Zebra clipe" na ordenação pt-BR — o hook
    // reordena localmente, mesma ordem que um refetch real traria.
    expect(result.current.accessories).toEqual([accessory, otherAccessory])
    // Nunca dispara uma nova chamada de listagem — só a chamada inicial do
    // mount.
    expect(listAccessoriesMock).toHaveBeenCalledTimes(1)
  })

  it('create() propagates an ApiError without changing the current list', async () => {
    listAccessoriesMock.mockResolvedValue([otherAccessory])
    createAccessoryMock.mockRejectedValue(new ApiError('validation', 400, 'Campo inválido: name.'))

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.create({ name: '', minimum_stock: 0 })
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.accessories).toEqual([otherAccessory])
  })

  it('update() calls the API, replaces the item locally (still sorted by name) and returns it — without refetching', async () => {
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    const updated = { ...accessory, name: 'Ábaco', minimum_stock: 20 }
    updateAccessoryMock.mockResolvedValue(updated)

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let returned
    await act(async () => {
      returned = await result.current.update('1', { name: 'Ábaco', minimum_stock: 20 })
    })

    expect(updateAccessoryMock).toHaveBeenCalledWith('1', { name: 'Ábaco', minimum_stock: 20 })
    expect(returned).toEqual(updated)
    // "Ábaco" reordena antes de "Zebra clipe" — a lista continua ordenada
    // por nome após a atualização local, sem precisar de refetch.
    expect(result.current.accessories).toEqual([updated, otherAccessory])
    expect(listAccessoriesMock).toHaveBeenCalledTimes(1)
  })

  it('update() propagates an ApiError without changing the current list', async () => {
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    updateAccessoryMock.mockRejectedValue(new ApiError('validation', 400, 'Campo inválido: name.'))

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.update('1', { name: '' })
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.accessories).toEqual([accessory, otherAccessory])
  })
})
