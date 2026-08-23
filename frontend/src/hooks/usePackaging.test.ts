import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listPackagingMock, createPackagingMock } = vi.hoisted(() => ({
  listPackagingMock: vi.fn(),
  createPackagingMock: vi.fn(),
}))

vi.mock('@/lib/api/packaging', () => ({
  listPackaging: listPackagingMock,
  createPackaging: createPackagingMock,
}))

import { usePackaging } from './usePackaging'

const packagingItem = {
  id: '1',
  name: 'Caixa M',
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

const otherPackagingItem = { ...packagingItem, id: '2', name: 'Sacola Kraft' }

describe('usePackaging', () => {
  beforeEach(() => {
    listPackagingMock.mockReset()
    createPackagingMock.mockReset()
  })

  it('loads the packaging list on mount', async () => {
    listPackagingMock.mockResolvedValue([packagingItem])

    const { result } = renderHook(() => usePackaging())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.packaging).toEqual([packagingItem])
    expect(result.current.error).toBeNull()
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listPackagingMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => usePackaging())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
  })

  it('create() calls the API, inserts the new item locally (sorted by name) and returns it — without refetching', async () => {
    listPackagingMock.mockResolvedValue([otherPackagingItem])
    createPackagingMock.mockResolvedValue(packagingItem)

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let created
    await act(async () => {
      created = await result.current.create({ name: 'Caixa M', minimum_stock: 3 })
    })

    expect(createPackagingMock).toHaveBeenCalledWith({ name: 'Caixa M', minimum_stock: 3 })
    expect(created).toEqual(packagingItem)
    // "Caixa M" vem antes de "Sacola Kraft" na ordenação pt-BR.
    expect(result.current.packaging).toEqual([packagingItem, otherPackagingItem])
    expect(listPackagingMock).toHaveBeenCalledTimes(1)
  })

  it('create() propagates an ApiError without changing the current list', async () => {
    listPackagingMock.mockResolvedValue([otherPackagingItem])
    createPackagingMock.mockRejectedValue(new ApiError('validation', 400, 'Campo inválido: name.'))

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.create({ name: '', minimum_stock: 0 })
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.packaging).toEqual([otherPackagingItem])
  })
})
