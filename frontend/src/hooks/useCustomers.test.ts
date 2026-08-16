import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listCustomersMock, createCustomerMock, updateCustomerMock } = vi.hoisted(() => ({
  listCustomersMock: vi.fn(),
  createCustomerMock: vi.fn(),
  updateCustomerMock: vi.fn(),
}))

vi.mock('@/lib/api/customers', () => ({
  listCustomers: listCustomersMock,
  createCustomer: createCustomerMock,
  updateCustomer: updateCustomerMock,
}))

import { useCustomers } from './useCustomers'

const customerA = {
  id: '1',
  name: 'Ana',
  whatsapp: null,
  instagram: null,
  company_id: null,
  acquisition_source_id: null,
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const customerB = { ...customerA, id: '2', name: 'Bruno' }

describe('useCustomers', () => {
  beforeEach(() => {
    listCustomersMock.mockReset()
    createCustomerMock.mockReset()
    updateCustomerMock.mockReset()
  })

  it('loads the customer list on mount', async () => {
    listCustomersMock.mockResolvedValue([customerA])

    const { result } = renderHook(() => useCustomers())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.customers).toEqual([customerA])
    expect(result.current.error).toBeNull()
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listCustomersMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useCustomers())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
  })

  it('create() appends the new customer, kept sorted by name', async () => {
    listCustomersMock.mockResolvedValue([customerB])
    createCustomerMock.mockResolvedValue(customerA)

    const { result } = renderHook(() => useCustomers())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.create({ name: 'Ana' })
    })

    expect(createCustomerMock).toHaveBeenCalledWith({ name: 'Ana' })
    expect(result.current.customers.map((customer) => customer.name)).toEqual(['Ana', 'Bruno'])
  })

  it('update() replaces the matching customer in place', async () => {
    listCustomersMock.mockResolvedValue([customerA])
    const updated = { ...customerA, whatsapp: '11999999999' }
    updateCustomerMock.mockResolvedValue(updated)

    const { result } = renderHook(() => useCustomers())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.update('1', { whatsapp: '11999999999' })
    })

    expect(updateCustomerMock).toHaveBeenCalledWith('1', { whatsapp: '11999999999' })
    expect(result.current.customers).toEqual([updated])
  })
})
