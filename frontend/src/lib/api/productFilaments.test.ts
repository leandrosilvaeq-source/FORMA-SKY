import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import { listProductFilaments, updateProductFilaments } from './productFilaments'

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

describe('productFilaments api', () => {
  beforeEach(() => {
    fromMock.mockReset()
    callEdgeFunctionMock.mockReset()
  })

  it('listProductFilaments reads product_filaments filtered by product_id', async () => {
    const rows = [{ id: '1', product_id: 'p1', filament_type_id: 'ft1', theoretical_weight_grams: 12.5, created_at: '' }]
    const builder = chainableResult({ data: rows, error: null })
    fromMock.mockReturnValue(builder)

    const result = await listProductFilaments('p1')

    expect(fromMock).toHaveBeenCalledWith('product_filaments')
    expect(builder.eq).toHaveBeenCalledWith('product_id', 'p1')
    expect(callEdgeFunctionMock).not.toHaveBeenCalled()
    expect(result).toEqual(rows)
  })

  it('updateProductFilaments writes through the products Edge Function with PATCH /:id/filaments', async () => {
    callEdgeFunctionMock.mockResolvedValue({ success: true })

    const result = await updateProductFilaments('p1', {
      filaments: [{ id: 'ft1', theoretical_weight_grams: 12.5 }],
    })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('products', '/p1/filaments', 'PATCH', {
      filaments: [{ id: 'ft1', theoretical_weight_grams: 12.5 }],
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true })
  })

  it('updateProductFilaments nunca chama a rota /composition (independência de Acessórios/Embalagens)', async () => {
    callEdgeFunctionMock.mockResolvedValue({ success: true })

    await updateProductFilaments('p1', { filaments: [] })

    const calledPath = callEdgeFunctionMock.mock.calls[0][1]
    expect(calledPath).not.toContain('composition')
  })
})
