import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import { createAccessory, deleteAccessory, listAccessories, updateAccessory } from './accessories'

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

describe('accessories api', () => {
  beforeEach(() => {
    fromMock.mockReset()
    callEdgeFunctionMock.mockReset()
  })

  it('listAccessories reads directly from supabase-js', async () => {
    const rows = [{ id: '1', name: 'Ímã 6x2' }]
    fromMock.mockReturnValue(chainableResult({ data: rows, error: null }))

    const result = await listAccessories()

    expect(fromMock).toHaveBeenCalledWith('accessories')
    expect(callEdgeFunctionMock).not.toHaveBeenCalled()
    expect(result).toEqual(rows)
  })

  it('createAccessory writes through the accessories Edge Function, not a direct insert', async () => {
    const created = { id: 'a1', name: 'Ímã 6x2', size: null, variant: null, minimum_stock: null, is_active: true }
    callEdgeFunctionMock.mockResolvedValue(created)

    const result = await createAccessory({ name: 'Ímã 6x2' })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('accessories', '', 'POST', { name: 'Ímã 6x2' })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual(created)
  })

  it('updateAccessory writes through the accessories Edge Function with PATCH, not a direct update', async () => {
    const updated = { id: 'a1', name: 'Ímã 6x2', size: 'M', variant: null, minimum_stock: 5, is_active: false }
    callEdgeFunctionMock.mockResolvedValue(updated)

    const result = await updateAccessory('a1', { size: 'M', minimum_stock: 5, is_active: false })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('accessories', '/a1', 'PATCH', {
      size: 'M',
      minimum_stock: 5,
      is_active: false,
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual(updated)
  })

  it('deleteAccessory calls the accessories Edge Function with DELETE, not a direct delete', async () => {
    callEdgeFunctionMock.mockResolvedValue({ success: true })

    const result = await deleteAccessory('a1')

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('accessories', '/a1', 'DELETE')
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true })
  })

  it('deleteAccessory propagates a standardized ApiError when blocked by a product link', async () => {
    const { ApiError } = await import('./errors')
    callEdgeFunctionMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Este acessório está vinculado a um produto e não pode ser excluído. Desative o item.'),
    )

    await expect(deleteAccessory('a1')).rejects.toMatchObject({ type: 'business_rule', status: 409 })
  })
})
