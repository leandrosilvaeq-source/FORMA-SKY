import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import {
  listFilamentMovements,
  listFilamentMovementsByType,
  registerFilamentMovement,
  registerFilamentWeighing,
} from './filamentMovements'

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
  builder.limit = vi.fn(chain)
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled)
  return builder
}

describe('filamentMovements api', () => {
  beforeEach(() => {
    fromMock.mockReset()
    callEdgeFunctionMock.mockReset()
  })

  it('listFilamentMovements reads directly from supabase-js, filtered by spool_id', async () => {
    const builder = chainableResult({ data: [{ id: 'm1' }], error: null })
    fromMock.mockReturnValue(builder)

    const result = await listFilamentMovements('s1')

    expect(fromMock).toHaveBeenCalledWith('filament_movements')
    expect(builder.eq).toHaveBeenCalledWith('spool_id', 's1')
    expect(result).toEqual([{ id: 'm1' }])
  })

  it('listFilamentMovementsByType filters by filament_type_id (histórico consolidado por tipo)', async () => {
    const builder = chainableResult({ data: [{ id: 'm1' }], error: null })
    fromMock.mockReturnValue(builder)

    await listFilamentMovementsByType('t1')

    expect(builder.eq).toHaveBeenCalledWith('filament_type_id', 't1')
  })

  it('registerFilamentMovement writes through the filament-movements Edge Function', async () => {
    const created = { id: 'm1', balance_after: 500 }
    callEdgeFunctionMock.mockResolvedValue(created)

    const result = await registerFilamentMovement({ spool_id: 's1', movement_type: 'PURCHASE', quantity: 500 })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-movements', '', 'POST', {
      spool_id: 's1',
      movement_type: 'PURCHASE',
      quantity: 500,
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual(created)
  })

  it('registerFilamentWeighing calls the /weighing route of the filament-movements Edge Function', async () => {
    const response = { movement: { id: 'm1', balance_after: 750 } }
    callEdgeFunctionMock.mockResolvedValue(response)

    const result = await registerFilamentWeighing({ spool_id: 's1', measured_gross_weight_grams: 950, reason: 'conferência' })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-movements', '/weighing', 'POST', {
      spool_id: 's1',
      measured_gross_weight_grams: 950,
      reason: 'conferência',
    })
    expect(result).toEqual(response)
  })

  it('registerFilamentWeighing can resolve with movement: null (diferença zero, nada gravado)', async () => {
    callEdgeFunctionMock.mockResolvedValue({ movement: null })

    const result = await registerFilamentWeighing({ spool_id: 's1', measured_net_weight_grams: 500, reason: 'conferência' })

    expect(result.movement).toBeNull()
  })

  it('registerFilamentMovement propagates a standardized ApiError (ex.: saldo insuficiente)', async () => {
    const { ApiError } = await import('./errors')
    callEdgeFunctionMock.mockRejectedValue(new ApiError('business_rule', 409, 'peso insuficiente para esta operação'))

    await expect(registerFilamentMovement({ spool_id: 's1', movement_type: 'LOSS', quantity: 9999 })).rejects.toMatchObject({
      type: 'business_rule',
      status: 409,
    })
  })
})
