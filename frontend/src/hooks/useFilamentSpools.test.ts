import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listFilamentSpoolsMock, createFilamentSpoolMock, updateFilamentSpoolMock, deleteFilamentSpoolMock } = vi.hoisted(() => ({
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
}

const otherSpool = { ...spool, id: 's2', code: 'RL-26-002' }

describe('useFilamentSpools', () => {
  beforeEach(() => {
    listFilamentSpoolsMock.mockReset()
    createFilamentSpoolMock.mockReset()
    updateFilamentSpoolMock.mockReset()
    deleteFilamentSpoolMock.mockReset()
  })

  it('loads the spool list for the given filament type on mount', async () => {
    listFilamentSpoolsMock.mockResolvedValue([spool])

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(listFilamentSpoolsMock).toHaveBeenCalledWith('t1')
    expect(result.current.spools).toEqual([spool])
  })

  it('create() injects filament_type_id and inserts the created spool at the top', async () => {
    listFilamentSpoolsMock.mockResolvedValue([otherSpool])
    createFilamentSpoolMock.mockResolvedValue(spool)

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.create({ nominal_weight_grams: 1000 })
    })

    expect(createFilamentSpoolMock).toHaveBeenCalledWith({ nominal_weight_grams: 1000, filament_type_id: 't1' })
    expect(result.current.spools).toEqual([spool, otherSpool])
  })

  it('update() replaces the spool in place', async () => {
    listFilamentSpoolsMock.mockResolvedValue([spool])
    const updated = { ...spool, status: 'DESCARTADO' as const }
    updateFilamentSpoolMock.mockResolvedValue(updated)

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.update('s1', { status: 'DESCARTADO' })
    })

    expect(result.current.spools).toEqual([updated])
  })

  it('update() propagates an ApiError without changing the list (ex.: descarte é terminal)', async () => {
    listFilamentSpoolsMock.mockResolvedValue([spool])
    updateFilamentSpoolMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Este rolo foi descartado e não pode ser reativado.'),
    )

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(act(async () => result.current.update('s1', { status: 'ABERTO' }))).rejects.toBeInstanceOf(ApiError)
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

  it('setLocalSpoolState() updates current_net_weight_grams and status without calling the API', async () => {
    listFilamentSpoolsMock.mockResolvedValue([spool, otherSpool])

    const { result } = renderHook(() => useFilamentSpools('t1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.setLocalSpoolState('s1', { current_net_weight_grams: 0, status: 'ESGOTADO' })
    })

    const updated = result.current.spools.find((s) => s.id === 's1')
    expect(updated?.current_net_weight_grams).toBe(0)
    expect(updated?.status).toBe('ESGOTADO')
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
