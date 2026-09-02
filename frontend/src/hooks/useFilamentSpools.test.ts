import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const {
  listFilamentSpoolsMock,
  createFilamentSpoolMock,
  updateFilamentSpoolMock,
  deleteFilamentSpoolMock,
} = vi.hoisted(() => ({
  listFilamentSpoolsMock: vi.fn(),
  createFilamentSpoolMock: vi.fn(),
  updateFilamentSpoolMock: vi.fn(),
  deleteFilamentSpoolMock: vi.fn(),
}))

vi.mock('@/lib/api/filamentSpools', () => ({
  listFilamentSpools: listFilamentSpoolsMock,
  createFilamentSpool: createFilamentSpoolMock,
  updateFilamentSpool: updateFilamentSpoolMock,
  deleteFilamentSpool: deleteFilamentSpoolMock,
}))

import { useFilamentSpools } from './useFilamentSpools'

const spool = {
  id: 's1',
  code: 'RL-26-001',
  filament_type_id: 't1',
  nominal_weight_grams: 1000,
  current_net_weight_grams: 0,
  empty_spool_weight_grams: null,
  received_at: null,
  opened_at: null,
  status: 'LACRADO' as const,
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
  has_movement_history: false,
}

const otherSpool = { ...spool, id: 's2', code: 'RL-26-002' }

// A resposta crua de createFilamentSpool/updateFilamentSpool (Edge
// Function -> RPC) nunca inclui has_movement_history — só listFilamentSpools
// o calcula. Os mocks abaixo devolvem exatamente essa forma (sem o campo),
// mesma forma real (FilamentSpoolWriteResponse), para provar que o HOOK (não
// a API) é quem preenche o campo ao mesclar no estado local.
function rawWriteResponse<T extends { has_movement_history?: boolean }>(fixture: T) {
  const clone: Partial<T> = { ...fixture }
  delete clone.has_movement_history
  return clone
}

describe('useFilamentSpools', () => {
  beforeEach(() => {
    listFilamentSpoolsMock.mockReset()
    createFilamentSpoolMock.mockReset()
    updateFilamentSpoolMock.mockReset()
    deleteFilamentSpoolMock.mockReset()
  })

  it('loads the spool list for the given filament type on mount (single id normalised to a one-element list)', async () => {
    listFilamentSpoolsMock.mockResolvedValue([spool])

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(listFilamentSpoolsMock).toHaveBeenCalledWith(['t1'])
    expect(result.current.spools).toEqual([spool])
  })

  it('loads spools for a consolidated group (several filament_type_id) in a single call', async () => {
    listFilamentSpoolsMock.mockResolvedValue([spool, otherSpool])

    const { result } = renderHook(() => useFilamentSpools(['t2', 't1']))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(listFilamentSpoolsMock).toHaveBeenCalledTimes(1)
    expect(listFilamentSpoolsMock).toHaveBeenCalledWith(['t1', 't2'])
    expect(result.current.spools).toEqual([spool, otherSpool])
  })

  it('create() in group mode requires an explicit filament_type_id', async () => {
    listFilamentSpoolsMock.mockResolvedValue([])
    createFilamentSpoolMock.mockResolvedValue(rawWriteResponse(spool))

    const { result } = renderHook(() => useFilamentSpools(['t1', 't2']))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(result.current.create({ nominal_weight_grams: 1000 })).rejects.toThrow()

    await act(async () => {
      await result.current.create({ nominal_weight_grams: 1000, filament_type_id: 't2' })
    })
    expect(createFilamentSpoolMock).toHaveBeenCalledWith({
      nominal_weight_grams: 1000,
      filament_type_id: 't2',
    })
  })

  it('create() injects filament_type_id, inserts the created spool at the top with has_movement_history=false (never undefined)', async () => {
    listFilamentSpoolsMock.mockResolvedValue([otherSpool])
    createFilamentSpoolMock.mockResolvedValue(rawWriteResponse(spool))

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let created
    await act(async () => {
      created = await result.current.create({ nominal_weight_grams: 1000 })
    })

    expect(createFilamentSpoolMock).toHaveBeenCalledWith({
      nominal_weight_grams: 1000,
      filament_type_id: 't1',
    })
    expect(created).toEqual(spool)
    expect(result.current.spools).toEqual([spool, otherSpool])
  })

  it('update() replaces the spool in place and PRESERVES has_movement_history from the prior local value (the write response never carries it)', async () => {
    const spoolWithHistory = { ...spool, has_movement_history: true }
    listFilamentSpoolsMock.mockResolvedValue([spoolWithHistory])
    const updatedRaw = rawWriteResponse({ ...spoolWithHistory, status: 'DESCARTADO' as const })
    updateFilamentSpoolMock.mockResolvedValue(updatedRaw)

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.update('s1', { status: 'DESCARTADO' })
    })

    expect(result.current.spools).toEqual([{ ...spoolWithHistory, status: 'DESCARTADO' }])
  })

  it('update() propagates an ApiError without changing the list (ex.: descarte é terminal)', async () => {
    listFilamentSpoolsMock.mockResolvedValue([spool])
    updateFilamentSpoolMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Este rolo foi descartado e não pode ser reativado.'),
    )

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => result.current.update('s1', { status: 'ABERTO' })),
    ).rejects.toBeInstanceOf(ApiError)
    expect(result.current.spools).toEqual([spool])
  })

  it('delete() removes only the matching spool from the local array', async () => {
    listFilamentSpoolsMock.mockResolvedValue([spool, otherSpool])
    deleteFilamentSpoolMock.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.delete('s1')
    })

    expect(result.current.spools).toEqual([otherSpool])
  })

  it('delete() blocked (movement history) keeps the spool in the local array', async () => {
    listFilamentSpoolsMock.mockResolvedValue([spool])
    deleteFilamentSpoolMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Este rolo possui movimentações registradas.'),
    )

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(act(async () => result.current.delete('s1'))).rejects.toBeInstanceOf(ApiError)
    expect(result.current.spools).toEqual([spool])
  })

  it('setLocalSpoolState() updates current_net_weight_grams/status AND sets has_movement_history=true (uma movimentação acabou de ser registrada)', async () => {
    listFilamentSpoolsMock.mockResolvedValue([spool, otherSpool])

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.setLocalSpoolState('s1', { current_net_weight_grams: 0, status: 'ESGOTADO' })
    })

    const updated = result.current.spools.find((s) => s.id === 's1')
    expect(updated?.current_net_weight_grams).toBe(0)
    expect(updated?.status).toBe('ESGOTADO')
    expect(updated?.has_movement_history).toBe(true)
    expect(result.current.spools.find((s) => s.id === 's2')?.status).toBe('LACRADO')
    expect(createFilamentSpoolMock).not.toHaveBeenCalled()
  })

  it('setLocalSpoolState() without a status keeps the current status unchanged', async () => {
    listFilamentSpoolsMock.mockResolvedValue([{ ...spool, status: 'ABERTO' as const }])

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.setLocalSpoolState('s1', { current_net_weight_grams: 300 })
    })

    const updated = result.current.spools.find((s) => s.id === 's1')
    expect(updated?.current_net_weight_grams).toBe(300)
    expect(updated?.status).toBe('ABERTO')
  })
})
