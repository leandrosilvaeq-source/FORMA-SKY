import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const { listAvailableSpoolCountsByTypeMock } = vi.hoisted(() => ({
  listAvailableSpoolCountsByTypeMock: vi.fn(),
}))

vi.mock('@/lib/api/filamentSpools', () => ({
  listAvailableSpoolCountsByType: listAvailableSpoolCountsByTypeMock,
}))

import { useFilamentSpoolCounts } from './useFilamentSpoolCounts'

describe('useFilamentSpoolCounts', () => {
  beforeEach(() => {
    listAvailableSpoolCountsByTypeMock.mockReset()
  })

  it('carrega a contagem numa única chamada em lote, com a lista de ids ordenada', async () => {
    listAvailableSpoolCountsByTypeMock.mockResolvedValue(new Map([['t1', 2]]))
    const { result } = renderHook(() => useFilamentSpoolCounts(['t2', 't1']))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(listAvailableSpoolCountsByTypeMock).toHaveBeenCalledTimes(1)
    expect(listAvailableSpoolCountsByTypeMock).toHaveBeenCalledWith(['t1', 't2'])
    expect(result.current.countByTypeId?.get('t1')).toBe(2)
    expect(result.current.error).toBeNull()
  })

  it('lista de ids vazia: consulta com [] (a API trata sem ir à rede)', async () => {
    listAvailableSpoolCountsByTypeMock.mockResolvedValue(new Map())
    const { result } = renderHook(() => useFilamentSpoolCounts([]))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(listAvailableSpoolCountsByTypeMock).toHaveBeenCalledWith([])
  })

  it('num erro: countByTypeId fica null (nunca a view) e error é preenchido', async () => {
    const { ApiError } = await import('@/lib/api/errors')
    listAvailableSpoolCountsByTypeMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))
    const { result } = renderHook(() => useFilamentSpoolCounts(['t1']))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.countByTypeId).toBeNull()
  })

  it('refetch dispara uma nova consulta', async () => {
    listAvailableSpoolCountsByTypeMock.mockResolvedValue(new Map())
    const { result } = renderHook(() => useFilamentSpoolCounts(['t1']))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      result.current.refetch()
    })
    await waitFor(() => expect(listAvailableSpoolCountsByTypeMock).toHaveBeenCalledTimes(2))
  })

  it('não refaz a consulta quando o array de ids troca de referência mas não de conteúdo', async () => {
    listAvailableSpoolCountsByTypeMock.mockResolvedValue(new Map())
    const { rerender, result } = renderHook(({ ids }) => useFilamentSpoolCounts(ids), {
      initialProps: { ids: ['t1', 't2'] },
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    rerender({ ids: ['t2', 't1'] })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(listAvailableSpoolCountsByTypeMock).toHaveBeenCalledTimes(1)
  })
})
