import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { getProductMock } = vi.hoisted(() => ({ getProductMock: vi.fn() }))

vi.mock('@/lib/api/products', () => ({ getProduct: getProductMock }))

import { useProduct } from './useProduct'

const product = {
  id: 'p1',
  name: 'Chaveiro',
  category: null,
  description: null,
  default_price: 10,
  default_print_time_minutes: null,
  default_weight_grams: null,
  units_per_plate: null,
  default_file_id: null,
  allows_personalization: false,
  is_active: true,
  created_at: '',
  updated_at: '',
}

describe('useProduct', () => {
  beforeEach(() => {
    getProductMock.mockReset()
  })

  it('starts loading and resolves to success with the product', async () => {
    getProductMock.mockResolvedValue(product)

    const { result } = renderHook(() => useProduct('p1'))

    expect(result.current.status).toBe('loading')

    await waitFor(() => expect(result.current.status).toBe('success'))

    expect(getProductMock).toHaveBeenCalledWith('p1')
    expect(result.current.product).toEqual(product)
    expect(result.current.error).toBeNull()
  })

  it('resolves to not_found when the API returns null (no matching row)', async () => {
    getProductMock.mockResolvedValue(null)

    const { result } = renderHook(() => useProduct('missing'))

    await waitFor(() => expect(result.current.status).toBe('not_found'))

    expect(result.current.product).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('resolves to error (distinct from not_found) when the API call fails', async () => {
    getProductMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useProduct('p1'))

    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
    expect(result.current.product).toBeNull()
  })

  it('retry() clears the error and refetches', async () => {
    getProductMock.mockRejectedValueOnce(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useProduct('p1'))
    await waitFor(() => expect(result.current.status).toBe('error'))

    getProductMock.mockResolvedValueOnce(product)

    result.current.retry()

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.product).toEqual(product)
    expect(getProductMock).toHaveBeenCalledTimes(2)
  })

  it('a late response for a previous productId does not override the current productId state', async () => {
    let resolveFirst!: (value: typeof product | null) => void
    getProductMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve
      }),
    )

    const { result, rerender } = renderHook(({ productId }) => useProduct(productId), {
      initialProps: { productId: 'p1' },
    })

    expect(result.current.status).toBe('loading')

    const productTwo = { ...product, id: 'p2', name: 'Vaso' }
    getProductMock.mockResolvedValueOnce(productTwo)
    rerender({ productId: 'p2' })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.product).toEqual(productTwo)

    resolveFirst(product)
    await Promise.resolve()

    expect(result.current.status).toBe('success')
    expect(result.current.product).toEqual(productTwo)
  })
})
