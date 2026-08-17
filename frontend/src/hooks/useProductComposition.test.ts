import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listProductAccessoriesMock, listProductPackagingMock, updateProductCompositionMock } = vi.hoisted(() => ({
  listProductAccessoriesMock: vi.fn(),
  listProductPackagingMock: vi.fn(),
  updateProductCompositionMock: vi.fn(),
}))

vi.mock('@/lib/api/productComposition', () => ({
  listProductAccessories: listProductAccessoriesMock,
  listProductPackaging: listProductPackagingMock,
  updateProductComposition: updateProductCompositionMock,
}))

import { useProductComposition } from './useProductComposition'

const accessoryRowP1 = { id: '1', product_id: 'p1', accessory_id: 'a1', quantity: 2, created_at: '' }
const packagingRowP1 = { id: '2', product_id: 'p1', packaging_id: 'k1', quantity: 1, created_at: '' }
const accessoryRowP2 = { id: '3', product_id: 'p2', accessory_id: 'a9', quantity: 9, created_at: '' }

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useProductComposition', () => {
  beforeEach(() => {
    listProductAccessoriesMock.mockReset()
    listProductPackagingMock.mockReset()
    updateProductCompositionMock.mockReset()
  })

  it('starts idle and fetches nothing when productId is null', () => {
    const { result } = renderHook(() => useProductComposition(null))

    expect(result.current.status).toBe('idle')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.accessories).toEqual([])
    expect(result.current.packaging).toEqual([])
    expect(listProductAccessoriesMock).not.toHaveBeenCalled()
    expect(listProductPackagingMock).not.toHaveBeenCalled()
  })

  it('loads the current composition when productId is set', async () => {
    listProductAccessoriesMock.mockResolvedValue([accessoryRowP1])
    listProductPackagingMock.mockResolvedValue([packagingRowP1])

    const { result } = renderHook(() => useProductComposition('p1'))

    expect(result.current.status).toBe('loading')

    await waitFor(() => expect(result.current.status).toBe('success'))

    expect(listProductAccessoriesMock).toHaveBeenCalledWith('p1')
    expect(listProductPackagingMock).toHaveBeenCalledWith('p1')
    expect(result.current.accessories).toEqual([accessoryRowP1])
    expect(result.current.packaging).toEqual([packagingRowP1])
    expect(result.current.error).toBeNull()
  })

  it('exposes an error status (not empty arrays) when loading fails', async () => {
    listProductAccessoriesMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))
    listProductPackagingMock.mockResolvedValue([])

    const { result } = renderHook(() => useProductComposition('p1'))

    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
    // Estado de erro é distinto de "composição vazia": consumidores não
    // devem tratar accessories/packaging como confirmados neste status.
    expect(result.current.accessories).toEqual([])
    expect(result.current.packaging).toEqual([])
  })

  it('save() calls updateProductComposition with the given productId', async () => {
    listProductAccessoriesMock.mockResolvedValue([])
    listProductPackagingMock.mockResolvedValue([])
    updateProductCompositionMock.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useProductComposition('p1'))
    await waitFor(() => expect(result.current.status).toBe('success'))

    await act(async () => {
      await result.current.save({ accessories: [{ id: 'a1', quantity: 2 }], packaging: [] })
    })

    expect(updateProductCompositionMock).toHaveBeenCalledWith('p1', {
      accessories: [{ id: 'a1', quantity: 2 }],
      packaging: [],
    })
  })

  it('reopening the same productId shows loading again and never treats the old response as confirmed for the new request', async () => {
    listProductAccessoriesMock.mockResolvedValueOnce([accessoryRowP1])
    listProductPackagingMock.mockResolvedValueOnce([packagingRowP1])

    const { result, rerender } = renderHook(({ productId }) => useProductComposition(productId), {
      initialProps: { productId: 'p1' as string | null },
    })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.accessories).toEqual([accessoryRowP1])

    // Fecha o dialog.
    rerender({ productId: null })
    expect(result.current.status).toBe('idle')

    // Reabre o MESMO produto — a segunda busca ainda não resolveu.
    const secondAccessories = createDeferred<(typeof accessoryRowP1)[]>()
    const secondPackaging = createDeferred<(typeof packagingRowP1)[]>()
    listProductAccessoriesMock.mockReturnValueOnce(secondAccessories.promise)
    listProductPackagingMock.mockReturnValueOnce(secondPackaging.promise)

    rerender({ productId: 'p1' })

    // Estado imediatamente após reabrir: loading, e os dados antigos NÃO
    // são expostos como se fossem a resposta confirmada da nova busca.
    expect(result.current.status).toBe('loading')
    expect(result.current.accessories).toEqual([])
    expect(result.current.packaging).toEqual([])

    // Resolve a nova busca com um resultado DIFERENTE do anterior.
    const freshAccessoryRow = { ...accessoryRowP1, quantity: 99 }
    await act(async () => {
      secondAccessories.resolve([freshAccessoryRow])
      secondPackaging.resolve([packagingRowP1])
    })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.accessories).toEqual([freshAccessoryRow])
  })

  it('a late response for a previous productId does not override the current productId state', async () => {
    const firstAccessories = createDeferred<typeof accessoryRowP1[]>()
    const firstPackaging = createDeferred<typeof packagingRowP1[]>()
    listProductAccessoriesMock.mockReturnValueOnce(firstAccessories.promise)
    listProductPackagingMock.mockReturnValueOnce(firstPackaging.promise)

    const { result, rerender } = renderHook(({ productId }) => useProductComposition(productId), {
      initialProps: { productId: 'p1' as string | null },
    })

    expect(result.current.status).toBe('loading')

    // Troca para p2 ANTES da busca de p1 resolver.
    listProductAccessoriesMock.mockResolvedValueOnce([accessoryRowP2])
    listProductPackagingMock.mockResolvedValueOnce([])
    rerender({ productId: 'p2' })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.accessories).toEqual([accessoryRowP2])

    // A resposta atrasada de p1 chega DEPOIS — não deve sobrescrever p2.
    await act(async () => {
      firstAccessories.resolve([accessoryRowP1])
      firstPackaging.resolve([packagingRowP1])
      await Promise.resolve()
    })

    expect(result.current.status).toBe('success')
    expect(result.current.accessories).toEqual([accessoryRowP2])
  })

  it('retry() clears the error and refetches', async () => {
    listProductAccessoriesMock.mockRejectedValueOnce(new ApiError('database', 500, 'falhou'))
    listProductPackagingMock.mockResolvedValueOnce([])

    const { result } = renderHook(() => useProductComposition('p1'))
    await waitFor(() => expect(result.current.status).toBe('error'))

    listProductAccessoriesMock.mockResolvedValueOnce([accessoryRowP1])
    listProductPackagingMock.mockResolvedValueOnce([packagingRowP1])

    act(() => {
      result.current.retry()
    })

    expect(result.current.status).toBe('loading')
    expect(result.current.error).toBeNull()

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.accessories).toEqual([accessoryRowP1])
    expect(listProductAccessoriesMock).toHaveBeenCalledTimes(2)
  })
})
