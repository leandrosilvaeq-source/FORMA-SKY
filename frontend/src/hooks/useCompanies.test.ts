import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listCompaniesMock, createCompanyMock, updateCompanyMock } = vi.hoisted(() => ({
  listCompaniesMock: vi.fn(),
  createCompanyMock: vi.fn(),
  updateCompanyMock: vi.fn(),
}))

vi.mock('@/lib/api/companies', () => ({
  listCompanies: listCompaniesMock,
  createCompany: createCompanyMock,
  updateCompany: updateCompanyMock,
}))

import { useCompanies } from './useCompanies'

const companyA = {
  id: '1',
  name: 'Empresa A',
  trade_name: null,
  document_number: null,
  whatsapp: null,
  instagram: null,
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const companyB = { ...companyA, id: '2', name: 'Empresa B' }

describe('useCompanies', () => {
  beforeEach(() => {
    listCompaniesMock.mockReset()
    createCompanyMock.mockReset()
    updateCompanyMock.mockReset()
  })

  it('loads the company list on mount', async () => {
    listCompaniesMock.mockResolvedValue([companyA])

    const { result } = renderHook(() => useCompanies())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.companies).toEqual([companyA])
    expect(result.current.error).toBeNull()
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listCompaniesMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useCompanies())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
  })

  it('refetch() triggers a new load', async () => {
    listCompaniesMock.mockResolvedValue([companyA])

    const { result } = renderHook(() => useCompanies())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    listCompaniesMock.mockResolvedValue([companyA, companyB])
    act(() => {
      result.current.refetch()
    })

    await waitFor(() => expect(result.current.companies).toEqual([companyA, companyB]))
    expect(listCompaniesMock).toHaveBeenCalledTimes(2)
  })

  it('create() appends the new company, kept sorted by name', async () => {
    listCompaniesMock.mockResolvedValue([companyB])
    createCompanyMock.mockResolvedValue(companyA)

    const { result } = renderHook(() => useCompanies())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.create({ name: 'Empresa A' })
    })

    expect(createCompanyMock).toHaveBeenCalledWith({ name: 'Empresa A' })
    expect(result.current.companies.map((company) => company.name)).toEqual(['Empresa A', 'Empresa B'])
  })

  it('update() replaces the matching company in place', async () => {
    listCompaniesMock.mockResolvedValue([companyA])
    const updated = { ...companyA, whatsapp: '11999999999' }
    updateCompanyMock.mockResolvedValue(updated)

    const { result } = renderHook(() => useCompanies())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.update('1', { whatsapp: '11999999999' })
    })

    expect(updateCompanyMock).toHaveBeenCalledWith('1', { whatsapp: '11999999999' })
    expect(result.current.companies).toEqual([updated])
  })
})
