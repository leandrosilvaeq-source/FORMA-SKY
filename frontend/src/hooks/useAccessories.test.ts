import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listAccessoriesMock } = vi.hoisted(() => ({ listAccessoriesMock: vi.fn() }))

vi.mock('@/lib/api/accessories', () => ({ listAccessories: listAccessoriesMock }))

import { useAccessories } from './useAccessories'

const accessory = {
  id: '1',
  name: 'Ímã 6x2',
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

describe('useAccessories', () => {
  beforeEach(() => {
    listAccessoriesMock.mockReset()
  })

  it('loads the accessory list on mount', async () => {
    listAccessoriesMock.mockResolvedValue([accessory])

    const { result } = renderHook(() => useAccessories())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.accessories).toEqual([accessory])
    expect(result.current.error).toBeNull()
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listAccessoriesMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useAccessories())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
  })
})
