import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import { createFilamentSpool, deleteFilamentSpool, listFilamentSpools, updateFilamentSpool } from './filamentSpools'

interface QueryResult {
  data: unknown
  error: unknown
}

function chainableResult(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled)
  return builder
}

describe('filamentSpools api', () => {
  beforeEach(() => {
    fromMock.mockReset()
    callEdgeFunctionMock.mockReset()
  })

  it('listFilamentSpools reads directly from supabase-js, filtered by filament_type_id', async () => {
    const builder = chainableResult({ data: [{ id: 's1', code: 'RL-26-001' }], error: null })
    fromMock.mockReturnValue(builder)

    const result = await listFilamentSpools('t1')

    expect(fromMock).toHaveBeenCalledWith('filament_spools')
    expect(builder.eq).toHaveBeenCalledWith('filament_type_id', 't1')
    expect(callEdgeFunctionMock).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 's1', code: 'RL-26-001' }])
  })

  it('createFilamentSpool writes through the filament-spools Edge Function, not a direct insert', async () => {
    const created = { id: 's1', code: 'RL-26-001', filament_type_id: 't1', nominal_weight_grams: 1000 }
    callEdgeFunctionMock.mockResolvedValue(created)

    const result = await createFilamentSpool({ filament_type_id: 't1', nominal_weight_grams: 1000 })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-spools', '', 'POST', {
      filament_type_id: 't1',
      nominal_weight_grams: 1000,
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual(created)
  })

  it('updateFilamentSpool writes through the filament-spools Edge Function with PATCH', async () => {
    const updated = { id: 's1', status: 'ABERTO' }
    callEdgeFunctionMock.mockResolvedValue(updated)

    const result = await updateFilamentSpool('s1', { status: 'ABERTO' })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-spools', '/s1', 'PATCH', { status: 'ABERTO' })
    expect(result).toEqual(updated)
  })

  it('deleteFilamentSpool calls the filament-spools Edge Function with DELETE', async () => {
    callEdgeFunctionMock.mockResolvedValue({ success: true })

    const result = await deleteFilamentSpool('s1')

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-spools', '/s1', 'DELETE')
    expect(result).toEqual({ success: true })
  })

  it('deleteFilamentSpool propagates a standardized ApiError when blocked by movement history', async () => {
    const { ApiError } = await import('./errors')
    callEdgeFunctionMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Este rolo possui movimentações registradas e não pode ser excluído.'),
    )

    await expect(deleteFilamentSpool('s1')).rejects.toMatchObject({ type: 'business_rule', status: 409 })
  })
})
