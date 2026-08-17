import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import { listProductAccessories, listProductPackaging, updateProductComposition } from './productComposition'

interface QueryResult {
  data: unknown
  error: unknown
}

function chainableResult(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled)
  return builder
}

describe('productComposition api', () => {
  beforeEach(() => {
    fromMock.mockReset()
    callEdgeFunctionMock.mockReset()
  })

  it('listProductAccessories reads product_accessories filtered by product_id', async () => {
    const rows = [{ id: '1', product_id: 'p1', accessory_id: 'a1', quantity: 2, created_at: '' }]
    const builder = chainableResult({ data: rows, error: null })
    fromMock.mockReturnValue(builder)

    const result = await listProductAccessories('p1')

    expect(fromMock).toHaveBeenCalledWith('product_accessories')
    expect(builder.eq).toHaveBeenCalledWith('product_id', 'p1')
    expect(callEdgeFunctionMock).not.toHaveBeenCalled()
    expect(result).toEqual(rows)
  })

  it('listProductPackaging reads product_packaging filtered by product_id', async () => {
    const rows = [{ id: '1', product_id: 'p1', packaging_id: 'k1', quantity: 1, created_at: '' }]
    const builder = chainableResult({ data: rows, error: null })
    fromMock.mockReturnValue(builder)

    const result = await listProductPackaging('p1')

    expect(fromMock).toHaveBeenCalledWith('product_packaging')
    expect(builder.eq).toHaveBeenCalledWith('product_id', 'p1')
    expect(result).toEqual(rows)
  })

  it('updateProductComposition writes through the products Edge Function with PATCH', async () => {
    callEdgeFunctionMock.mockResolvedValue({ success: true })

    const result = await updateProductComposition('p1', {
      accessories: [{ id: 'a1', quantity: 2 }],
      packaging: [],
    })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('products', '/p1/composition', 'PATCH', {
      accessories: [{ id: 'a1', quantity: 2 }],
      packaging: [],
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true })
  })
})
