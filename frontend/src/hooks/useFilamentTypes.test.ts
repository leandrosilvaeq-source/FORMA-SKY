import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const {
  listFilamentTypeSummariesMock,
  createFilamentTypeMock,
  updateFilamentTypeMock,
  deleteFilamentTypeMock,
  getFilamentTypeRemovalPlanMock,
} = vi.hoisted(() => ({
  listFilamentTypeSummariesMock: vi.fn(),
  createFilamentTypeMock: vi.fn(),
  updateFilamentTypeMock: vi.fn(),
  deleteFilamentTypeMock: vi.fn(),
  getFilamentTypeRemovalPlanMock: vi.fn(),
}))

vi.mock('@/lib/api/filamentTypes', () => ({
  listFilamentTypeSummaries: listFilamentTypeSummariesMock,
  createFilamentType: createFilamentTypeMock,
  updateFilamentType: updateFilamentTypeMock,
  deleteFilamentType: deleteFilamentTypeMock,
  getFilamentTypeRemovalPlan: getFilamentTypeRemovalPlanMock,
}))

import { useFilamentTypes } from './useFilamentTypes'

const summary = {
  filament_type_id: 't1',
  material: 'PLA' as const,
  manufacturer: 'Voolt3D',
  line: 'Sólida',
  commercial_color: 'Preto',
  color_code: null,
  minimum_stock_grams: null,
  is_active: true,
  total_available_grams: 500,
  usable_spool_count: 1,
  total_spool_count: 1,
}

const otherSummary = { ...summary, filament_type_id: 't2', manufacturer: 'Zebra Filamentos' }

describe('useFilamentTypes', () => {
  beforeEach(() => {
    listFilamentTypeSummariesMock.mockReset()
    createFilamentTypeMock.mockReset()
    updateFilamentTypeMock.mockReset()
    deleteFilamentTypeMock.mockReset()
    getFilamentTypeRemovalPlanMock.mockReset()
  })

  it('loads the type summary list on mount (vw_filament_type_summary, not the raw table)', async () => {
    listFilamentTypeSummariesMock.mockResolvedValue([summary])

    const { result } = renderHook(() => useFilamentTypes())
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.types).toEqual([summary])
    expect(result.current.error).toBeNull()
  })

  it('refetch() busca a lista de novo e substitui o estado local pelo resultado mais recente (base do "sem F5" — 2026-09-04)', async () => {
    listFilamentTypeSummariesMock.mockResolvedValueOnce([summary])

    const { result } = renderHook(() => useFilamentTypes())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.types).toEqual([summary])

    // Um tipo novo foi cadastrado por FORA desta instância do hook (ex.: em
    // outra tela/instância) — refetch() precisa trazê-lo sem exigir F5.
    listFilamentTypeSummariesMock.mockResolvedValueOnce([summary, otherSummary])
    act(() => result.current.refetch())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(listFilamentTypeSummariesMock).toHaveBeenCalledTimes(2)
    expect(result.current.types).toEqual([summary, otherSummary])
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listFilamentTypeSummariesMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useFilamentTypes())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
  })

  it('create() inserts a synthetic summary (zero grams, zero spools — a brand-new type never has a spool yet)', async () => {
    listFilamentTypeSummariesMock.mockResolvedValue([otherSummary])
    createFilamentTypeMock.mockResolvedValue({
      id: 't1',
      material: 'PLA',
      manufacturer: 'Voolt3D',
      line: 'Sólida',
      commercial_color: 'Preto',
      color_code: null,
      minimum_stock_grams: null,
      is_active: true,
      notes: null,
      created_at: '',
      updated_at: '',
    })

    const { result } = renderHook(() => useFilamentTypes())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let created
    await act(async () => {
      created = await result.current.create({
        material: 'PLA',
        manufacturer: 'Voolt3D',
        line: 'Sólida',
        commercial_color: 'Preto',
      })
    })

    expect(created).toMatchObject({
      filament_type_id: 't1',
      total_available_grams: 0,
      usable_spool_count: 0,
    })
    expect(result.current.types.map((t) => t.filament_type_id)).toContain('t1')
    expect(listFilamentTypeSummariesMock).toHaveBeenCalledTimes(1)
  })

  it('update() merges cadastro fields but preserves the already-loaded totals (never refetched)', async () => {
    listFilamentTypeSummariesMock.mockResolvedValue([summary])
    updateFilamentTypeMock.mockResolvedValue({
      id: 't1',
      material: 'PLA',
      manufacturer: 'Voolt3D',
      line: 'Silk',
      commercial_color: 'Preto',
      color_code: null,
      minimum_stock_grams: 100,
      is_active: true,
      notes: null,
      created_at: '',
      updated_at: '',
    })

    const { result } = renderHook(() => useFilamentTypes())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.update('t1', { line: 'Silk', minimum_stock_grams: 100 })
    })

    const updated = result.current.types.find((t) => t.filament_type_id === 't1')
    expect(updated?.line).toBe('Silk')
    expect(updated?.minimum_stock_grams).toBe(100)
    // Totais preservados — update_filament_type nunca toca em rolos.
    expect(updated?.total_available_grams).toBe(500)
    expect(updated?.usable_spool_count).toBe(1)
  })

  it('update() propagates an ApiError without changing the list', async () => {
    listFilamentTypeSummariesMock.mockResolvedValue([summary])
    updateFilamentTypeMock.mockRejectedValue(new ApiError('validation', 400, 'material inválido'))

    const { result } = renderHook(() => useFilamentTypes())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => result.current.update('t1', { material: 'ABS' as never })),
    ).rejects.toBeInstanceOf(ApiError)
    expect(result.current.types).toEqual([summary])
  })

  it('getRemovalPlan() apenas repassa a chamada da API, sem tocar no estado local', async () => {
    listFilamentTypeSummariesMock.mockResolvedValue([summary])
    const plan = {
      success: true,
      planned_result: 'ARCHIVED' as const,
      spool_count: 2,
      active_spool_count: 2,
      active_order_numbers: [],
      has_movements: true,
      has_purchases: false,
      has_product_filaments: false,
      has_product_plate_filaments: false,
      has_order_selection: false,
    }
    getFilamentTypeRemovalPlanMock.mockResolvedValue(plan)

    const { result } = renderHook(() => useFilamentTypes())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let got
    await act(async () => {
      got = await result.current.getRemovalPlan('t1')
    })

    expect(getFilamentTypeRemovalPlanMock).toHaveBeenCalledWith('t1')
    expect(got).toBe(plan)
    expect(result.current.types).toEqual([summary])
  })

  it('delete() -> PHYSICALLY_DELETED remove só o tipo correspondente do array local', async () => {
    listFilamentTypeSummariesMock.mockResolvedValue([summary, otherSummary])
    deleteFilamentTypeMock.mockResolvedValue({
      success: true,
      result: 'PHYSICALLY_DELETED',
      archived_spool_count: 0,
    })

    const { result } = renderHook(() => useFilamentTypes())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let outcome: Awaited<ReturnType<typeof result.current.delete>> | undefined
    await act(async () => {
      outcome = await result.current.delete('t1', 'PHYSICALLY_DELETED')
    })

    expect(deleteFilamentTypeMock).toHaveBeenCalledWith('t1', 'PHYSICALLY_DELETED')
    expect(result.current.types).toEqual([otherSummary])
    expect(outcome).toMatchObject({ result: 'PHYSICALLY_DELETED' })
  })

  it('delete() -> ARCHIVED mantém o tipo no array, mas marcado como inativo, e devolve o resultado', async () => {
    listFilamentTypeSummariesMock.mockResolvedValue([summary, otherSummary])
    deleteFilamentTypeMock.mockResolvedValue({
      success: true,
      result: 'ARCHIVED',
      archived_spool_count: 3,
    })

    const { result } = renderHook(() => useFilamentTypes())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let outcome: Awaited<ReturnType<typeof result.current.delete>> | undefined
    await act(async () => {
      outcome = await result.current.delete('t1', 'ARCHIVED')
    })

    expect(deleteFilamentTypeMock).toHaveBeenCalledWith('t1', 'ARCHIVED')
    expect(result.current.types).toHaveLength(2)
    expect(result.current.types.find((t) => t.filament_type_id === 't1')?.is_active).toBe(false)
    expect(result.current.types.find((t) => t.filament_type_id === 't2')?.is_active).toBe(true)
    expect(outcome).toMatchObject({ result: 'ARCHIVED', archived_spool_count: 3 })
  })

  it('delete() bloqueado (pedido ativo) mantém o tipo no array local', async () => {
    listFilamentTypeSummariesMock.mockResolvedValue([summary])
    deleteFilamentTypeMock.mockRejectedValue(
      new ApiError(
        'business_rule',
        409,
        'Este tipo de filamento está sendo utilizado por pedido(s) ativo(s) e não pode ser removido. Pedido(s): FS-26-010.',
      ),
    )

    const { result } = renderHook(() => useFilamentTypes())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(act(async () => result.current.delete('t1', 'ARCHIVED'))).rejects.toBeInstanceOf(
      ApiError,
    )
    expect(result.current.types).toEqual([summary])
  })
})
