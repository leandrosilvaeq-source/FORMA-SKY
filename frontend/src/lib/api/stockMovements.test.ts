import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import { listStockMovements, registerStockMovement } from './stockMovements'

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

describe('stockMovements api', () => {
  beforeEach(() => {
    fromMock.mockReset()
    callEdgeFunctionMock.mockReset()
  })

  it('listStockMovements reads directly from supabase-js, filtered by item_type/item_id', async () => {
    const rows = [{ id: 'm1', item_type: 'ACCESSORY', item_id: 'a1' }]
    const builder = chainableResult({ data: rows, error: null })
    fromMock.mockReturnValue(builder)

    const result = await listStockMovements('ACCESSORY', 'a1')

    expect(fromMock).toHaveBeenCalledWith('stock_movements')
    expect(builder.eq).toHaveBeenCalledWith('item_type', 'ACCESSORY')
    expect(builder.eq).toHaveBeenCalledWith('item_id', 'a1')
    expect(callEdgeFunctionMock).not.toHaveBeenCalled()
    expect(result).toEqual(rows)
  })

  it('listStockMovements orders by occurred_at/created_at descending (mais recente primeiro)', async () => {
    const builder = chainableResult({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    await listStockMovements('PACKAGING', 'k1')

    expect(builder.order).toHaveBeenCalledWith('occurred_at', { ascending: false })
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('listStockMovements limita a quantidade de registros por item (não carrega o histórico completo sem necessidade)', async () => {
    const builder = chainableResult({ data: [], error: null })
    fromMock.mockReturnValue(builder)

    await listStockMovements('ACCESSORY', 'a1')

    expect(builder.limit).toHaveBeenCalledWith(expect.any(Number))
    const limitArg = (builder.limit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(limitArg).toBeGreaterThan(0)
  })

  it('listStockMovements propaga um ApiError normalizado em caso de erro do Postgrest', async () => {
    fromMock.mockReturnValue(chainableResult({ data: null, error: { code: '42501', message: 'permission denied' } }))
    await expect(listStockMovements('ACCESSORY', 'a1')).rejects.toMatchObject({ type: 'authorization', status: 403 })
  })

  it('registerStockMovement writes through the stock-movements Edge Function, never a direct insert', async () => {
    const created = { id: 'm1', item_type: 'ACCESSORY', item_id: 'a1', balance_after: 10 }
    callEdgeFunctionMock.mockResolvedValue(created)

    const result = await registerStockMovement({
      item_type: 'ACCESSORY',
      item_id: 'a1',
      movement_type: 'PURCHASE',
      quantity: 10,
    })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('stock-movements', '', 'POST', {
      item_type: 'ACCESSORY',
      item_id: 'a1',
      movement_type: 'PURCHASE',
      quantity: 10,
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual(created)
  })

  it('registerStockMovement propaga o ApiError real do backend (ex.: saldo insuficiente)', async () => {
    const { ApiError } = await import('./errors')
    callEdgeFunctionMock.mockRejectedValue(new ApiError('business_rule', 409, 'saldo insuficiente'))

    await expect(
      registerStockMovement({ item_type: 'ACCESSORY', item_id: 'a1', movement_type: 'INTERNAL_USE', quantity: 999 }),
    ).rejects.toMatchObject({ type: 'business_rule', status: 409 })
  })
})
