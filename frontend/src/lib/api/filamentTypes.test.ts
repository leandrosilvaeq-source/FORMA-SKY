import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import { createFilamentType, deleteFilamentType, listFilamentTypeSummaries, listFilamentTypes, updateFilamentType } from './filamentTypes'

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

describe('filamentTypes api', () => {
  beforeEach(() => {
    fromMock.mockReset()
    callEdgeFunctionMock.mockReset()
  })

  it('listFilamentTypes reads directly from supabase-js (filament_types)', async () => {
    const rows = [{ id: 't1', manufacturer: 'Voolt3D' }]
    fromMock.mockReturnValue(chainableResult({ data: rows, error: null }))

    const result = await listFilamentTypes()

    expect(fromMock).toHaveBeenCalledWith('filament_types')
    expect(callEdgeFunctionMock).not.toHaveBeenCalled()
    expect(result).toEqual(rows)
  })

  it('listFilamentTypeSummaries reads from vw_filament_type_summary, not the raw table', async () => {
    const rows = [{ filament_type_id: 't1', total_available_grams: 500 }]
    fromMock.mockReturnValue(chainableResult({ data: rows, error: null }))

    const result = await listFilamentTypeSummaries()

    expect(fromMock).toHaveBeenCalledWith('vw_filament_type_summary')
    expect(result).toEqual(rows)
  })

  it('createFilamentType writes through the filament-types Edge Function, not a direct insert', async () => {
    const created = { id: 't1', material: 'PLA', manufacturer: 'Voolt3D', line: 'Sólida', commercial_color: 'Preto' }
    callEdgeFunctionMock.mockResolvedValue(created)

    const result = await createFilamentType({ material: 'PLA', manufacturer: 'Voolt3D', line: 'Sólida', commercial_color: 'Preto' })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-types', '', 'POST', {
      material: 'PLA',
      manufacturer: 'Voolt3D',
      line: 'Sólida',
      commercial_color: 'Preto',
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(result).toEqual(created)
  })

  it('updateFilamentType writes through the filament-types Edge Function with PATCH', async () => {
    const updated = { id: 't1', is_active: false }
    callEdgeFunctionMock.mockResolvedValue(updated)

    const result = await updateFilamentType('t1', { is_active: false })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-types', '/t1', 'PATCH', { is_active: false })
    expect(result).toEqual(updated)
  })

  it('deleteFilamentType calls the filament-types Edge Function with DELETE', async () => {
    callEdgeFunctionMock.mockResolvedValue({ success: true })

    const result = await deleteFilamentType('t1')

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-types', '/t1', 'DELETE')
    expect(result).toEqual({ success: true })
  })

  it('deleteFilamentType propagates a standardized ApiError when blocked by a spool link', async () => {
    const { ApiError } = await import('./errors')
    callEdgeFunctionMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Este tipo de filamento possui rolo(s) cadastrado(s) e não pode ser excluído.'),
    )

    await expect(deleteFilamentType('t1')).rejects.toMatchObject({ type: 'business_rule', status: 409 })
  })
})
