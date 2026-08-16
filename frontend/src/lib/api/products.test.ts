import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import { createProduct, listProducts, updateProductPrice } from './products'

interface QueryResult {
  data: unknown
  error: unknown
}

function chainableResult(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled)
  return builder
}

describe('products api', () => {
  beforeEach(() => {
    fromMock.mockReset()
    callEdgeFunctionMock.mockReset()
  })

  it('listProducts reads directly from supabase-js', async () => {
    const rows = [{ id: '1', name: 'Chaveiro' }]
    fromMock.mockReturnValue(chainableResult({ data: rows, error: null }))

    const result = await listProducts()

    expect(fromMock).toHaveBeenCalledWith('products')
    expect(callEdgeFunctionMock).not.toHaveBeenCalled()
    expect(result).toEqual(rows)
  })

  it('createProduct writes through the products Edge Function, not a direct insert', async () => {
    callEdgeFunctionMock.mockResolvedValue({ id: 'abc' })

    const result = await createProduct({ name: 'Chaveiro', default_price: 10 })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('products', '', 'POST', {
      name: 'Chaveiro',
      default_price: 10,
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual({ id: 'abc' })
  })

  it('updateProductPrice calls the price route with the product id', async () => {
    callEdgeFunctionMock.mockResolvedValue({ price_history_id: 'ph1' })

    const result = await updateProductPrice('prod-1', { new_price: 20 })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('products', '/prod-1/price', 'PATCH', {
      new_price: 20,
    })
    expect(result).toEqual({ price_history_id: 'ph1' })
  })
})
