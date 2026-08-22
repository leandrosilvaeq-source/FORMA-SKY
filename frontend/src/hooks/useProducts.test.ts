import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listProductsMock, createProductMock, updateProductPriceMock, updateProductMock } = vi.hoisted(() => ({
  listProductsMock: vi.fn(),
  createProductMock: vi.fn(),
  updateProductPriceMock: vi.fn(),
  updateProductMock: vi.fn(),
}))

vi.mock('@/lib/api/products', () => ({
  listProducts: listProductsMock,
  createProduct: createProductMock,
  updateProductPrice: updateProductPriceMock,
  updateProduct: updateProductMock,
}))

import { useProducts } from './useProducts'

const productA = {
  id: '1',
  name: 'Chaveiro',
  category: null,
  description: null,
  default_price: 10,
  product_type: 'CATALOG',
  default_print_time_seconds: null,
  default_weight_grams: null,
  units_per_plate: null,
  default_file_id: null,
  allows_personalization: false,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const productB = { ...productA, id: '2', name: 'Vaso', default_price: 25 }

describe('useProducts', () => {
  beforeEach(() => {
    listProductsMock.mockReset()
    createProductMock.mockReset()
    updateProductPriceMock.mockReset()
    updateProductMock.mockReset()
  })

  it('loads the product list on mount', async () => {
    listProductsMock.mockResolvedValue([productA])

    const { result } = renderHook(() => useProducts())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.products).toEqual([productA])
    expect(result.current.error).toBeNull()
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listProductsMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useProducts())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
  })

  it('create() calls the API and refetches the list', async () => {
    listProductsMock.mockResolvedValueOnce([productA]).mockResolvedValueOnce([productA, productB])
    createProductMock.mockResolvedValue({ id: '2' })

    const { result } = renderHook(() => useProducts())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.create({ name: 'Vaso', product_type: 'CATALOG', default_price: 25 })
    })

    expect(createProductMock).toHaveBeenCalledWith({ name: 'Vaso', product_type: 'CATALOG', default_price: 25 })
    await waitFor(() => expect(listProductsMock).toHaveBeenCalledTimes(2))
    expect(result.current.products).toEqual([productA, productB])
  })

  it('changePrice() calls the API and refetches the list', async () => {
    const repriced = { ...productA, default_price: 15 }
    listProductsMock.mockResolvedValueOnce([productA]).mockResolvedValueOnce([repriced])
    updateProductPriceMock.mockResolvedValue({ price_history_id: 'ph1' })

    const { result } = renderHook(() => useProducts())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.changePrice('1', { new_price: 15 })
    })

    expect(updateProductPriceMock).toHaveBeenCalledWith('1', { new_price: 15 })
    await waitFor(() => expect(listProductsMock).toHaveBeenCalledTimes(2))
    expect(result.current.products).toEqual([repriced])
  })

  it('update() calls the API and replaces the item locally, without a full refetch', async () => {
    listProductsMock.mockResolvedValueOnce([productA, productB])
    const deactivated = { ...productA, is_active: false }
    updateProductMock.mockResolvedValue(deactivated)

    const { result } = renderHook(() => useProducts())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.update('1', { is_active: false })
    })

    expect(updateProductMock).toHaveBeenCalledWith('1', { is_active: false })
    expect(listProductsMock).toHaveBeenCalledTimes(1)
    expect(result.current.products).toEqual([deactivated, productB])
  })
})
