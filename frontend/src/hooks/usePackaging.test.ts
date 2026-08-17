import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listPackagingMock } = vi.hoisted(() => ({ listPackagingMock: vi.fn() }))

vi.mock('@/lib/api/packaging', () => ({ listPackaging: listPackagingMock }))

import { usePackaging } from './usePackaging'

const packagingItem = {
  id: '1',
  name: 'Caixa M',
  material: null,
  size: null,
  variant: null,
  unit_cost: null,
  minimum_stock: null,
  current_stock: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
}

describe('usePackaging', () => {
  beforeEach(() => {
    listPackagingMock.mockReset()
  })

  it('loads the packaging list on mount', async () => {
    listPackagingMock.mockResolvedValue([packagingItem])

    const { result } = renderHook(() => usePackaging())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.packaging).toEqual([packagingItem])
    expect(result.current.error).toBeNull()
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listPackagingMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => usePackaging())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
  })
})
