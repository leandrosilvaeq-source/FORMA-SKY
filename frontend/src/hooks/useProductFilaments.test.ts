import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listProductFilamentsMock, updateProductFilamentsMock } = vi.hoisted(() => ({
  listProductFilamentsMock: vi.fn(),
  updateProductFilamentsMock: vi.fn(),
}))

vi.mock('@/lib/api/productFilaments', () => ({
  listProductFilaments: listProductFilamentsMock,
  updateProductFilaments: updateProductFilamentsMock,
}))

import { useProductFilaments } from './useProductFilaments'

const filamentRowP1 = { id: '1', product_id: 'p1', filament_type_id: 'ft1', theoretical_weight_grams: 12.5, created_at: '' }
const filamentRowP2 = { id: '2', product_id: 'p2', filament_type_id: 'ft9', theoretical_weight_grams: 5, created_at: '' }

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useProductFilaments', () => {
  beforeEach(() => {
    listProductFilamentsMock.mockReset()
    updateProductFilamentsMock.mockReset()
  })

  it('starts idle and fetches nothing when productId is null', () => {
    const { result } = renderHook(() => useProductFilaments(null))

    expect(result.current.status).toBe('idle')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.filaments).toEqual([])
    expect(listProductFilamentsMock).not.toHaveBeenCalled()
  })

  it('loads the current filament composition when productId is set', async () => {
    listProductFilamentsMock.mockResolvedValue([filamentRowP1])

    const { result } = renderHook(() => useProductFilaments('p1'))

    expect(result.current.status).toBe('loading')

    await waitFor(() => expect(result.current.status).toBe('success'))

    expect(listProductFilamentsMock).toHaveBeenCalledWith('p1')
    expect(result.current.filaments).toEqual([filamentRowP1])
    expect(result.current.error).toBeNull()
  })

  it('exposes an error status (not an empty array) when loading fails', async () => {
    listProductFilamentsMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useProductFilaments('p1'))

    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
    expect(result.current.filaments).toEqual([])
  })

  it('save() calls updateProductFilaments with the given productId', async () => {
    listProductFilamentsMock.mockResolvedValue([])
    updateProductFilamentsMock.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useProductFilaments('p1'))
    await waitFor(() => expect(result.current.status).toBe('success'))

    await act(async () => {
      await result.current.save({ filaments: [{ id: 'ft1', theoretical_weight_grams: 12.5 }] })
    })

    expect(updateProductFilamentsMock).toHaveBeenCalledWith('p1', {
      filaments: [{ id: 'ft1', theoretical_weight_grams: 12.5 }],
    })
  })

  it('a late response for a previous productId does not override the current productId state', async () => {
    const firstFilaments = createDeferred<(typeof filamentRowP1)[]>()
    listProductFilamentsMock.mockReturnValueOnce(firstFilaments.promise)

    const { result, rerender } = renderHook(({ productId }) => useProductFilaments(productId), {
      initialProps: { productId: 'p1' as string | null },
    })

    expect(result.current.status).toBe('loading')

    listProductFilamentsMock.mockResolvedValueOnce([filamentRowP2])
    rerender({ productId: 'p2' })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.filaments).toEqual([filamentRowP2])

    await act(async () => {
      firstFilaments.resolve([filamentRowP1])
      await Promise.resolve()
    })

    expect(result.current.status).toBe('success')
    expect(result.current.filaments).toEqual([filamentRowP2])
  })

  it('retry() clears the error and refetches', async () => {
    listProductFilamentsMock.mockRejectedValueOnce(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useProductFilaments('p1'))
    await waitFor(() => expect(result.current.status).toBe('error'))

    listProductFilamentsMock.mockResolvedValueOnce([filamentRowP1])

    act(() => {
      result.current.retry()
    })

    expect(result.current.status).toBe('loading')
    expect(result.current.error).toBeNull()

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.filaments).toEqual([filamentRowP1])
    expect(listProductFilamentsMock).toHaveBeenCalledTimes(2)
  })
})
