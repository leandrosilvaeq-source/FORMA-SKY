import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import { createPackaging, deletePackaging, listPackaging, updatePackaging } from './packaging'

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

describe('packaging api', () => {
  beforeEach(() => {
    fromMock.mockReset()
    callEdgeFunctionMock.mockReset()
  })

  it('listPackaging reads directly from supabase-js', async () => {
    const rows = [{ id: '1', name: 'Caixa M' }]
    fromMock.mockReturnValue(chainableResult({ data: rows, error: null }))

    const result = await listPackaging()

    expect(fromMock).toHaveBeenCalledWith('packaging')
    expect(callEdgeFunctionMock).not.toHaveBeenCalled()
    expect(result).toEqual(rows)
  })

  it('createPackaging writes through the packaging Edge Function, not a direct insert', async () => {
    const created = { id: 'k1', name: 'Caixa M', size: null, variant: null, minimum_stock: null, is_active: true }
    callEdgeFunctionMock.mockResolvedValue(created)

    const result = await createPackaging({ name: 'Caixa M' })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('packaging', '', 'POST', { name: 'Caixa M' })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual(created)
  })

  it('updatePackaging writes through the packaging Edge Function with PATCH, not a direct update', async () => {
    const updated = { id: 'k1', name: 'Caixa M', size: 'M', variant: null, minimum_stock: 5, is_active: false }
    callEdgeFunctionMock.mockResolvedValue(updated)

    const result = await updatePackaging('k1', { size: 'M', minimum_stock: 5, is_active: false })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('packaging', '/k1', 'PATCH', {
      size: 'M',
      minimum_stock: 5,
      is_active: false,
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual(updated)
  })

  it('deletePackaging calls the packaging Edge Function with DELETE, not a direct delete', async () => {
    callEdgeFunctionMock.mockResolvedValue({ success: true })

    const result = await deletePackaging('k1')

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('packaging', '/k1', 'DELETE')
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true })
  })

  it('deletePackaging propagates a standardized ApiError when blocked by a product link', async () => {
    const { ApiError } = await import('./errors')
    callEdgeFunctionMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Esta embalagem está vinculada a um produto e não pode ser excluída. Desative o item.'),
    )

    await expect(deletePackaging('k1')).rejects.toMatchObject({ type: 'business_rule', status: 409 })
  })
})
