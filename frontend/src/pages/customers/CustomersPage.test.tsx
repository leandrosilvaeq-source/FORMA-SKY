import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'

const { useCustomersMock, useCompaniesMock, useLeadSourcesMock, toastMock, useAuthMock } = vi.hoisted(() => ({
  useCustomersMock: vi.fn(),
  useCompaniesMock: vi.fn(),
  useLeadSourcesMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  useAuthMock: vi.fn(),
}))

vi.mock('@/hooks/useCustomers', () => ({ useCustomers: useCustomersMock }))
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: useCompaniesMock }))
vi.mock('@/hooks/useLeadSources', () => ({ useLeadSources: useLeadSourcesMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { CustomersPage } from './CustomersPage'

const company = {
  id: 'c1',
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

const leadSource = { id: 'l1', name: 'Indicação / boca a boca', is_active: true }

const customer = {
  id: '1',
  name: 'Ana',
  whatsapp: null,
  instagram: null,
  company_id: 'c1',
  acquisition_source_id: 'l1',
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

function renderPage() {
  return render(<CustomersPage />, { wrapper: MemoryRouter })
}

describe('CustomersPage', () => {
  let createMock: ReturnType<typeof vi.fn>
  let updateMock: ReturnType<typeof vi.fn>
  let refetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createMock = vi.fn().mockResolvedValue(customer)
    updateMock = vi.fn().mockResolvedValue(customer)
    refetchMock = vi.fn()

    useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
    useCustomersMock.mockReturnValue({
      customers: [customer],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      update: updateMock,
    })
    useCompaniesMock.mockReturnValue({ companies: [company], isLoading: false, error: null, refetch: vi.fn() })
    useLeadSourcesMock.mockReturnValue({
      leadSources: [leadSource],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('renders the company/lead source names instead of raw ids', () => {
    renderPage()

    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Empresa A')).toBeInTheDocument()
    expect(screen.getByText('Indicação / boca a boca')).toBeInTheDocument()
    expect(screen.queryByText('c1')).not.toBeInTheDocument()
    expect(screen.queryByText('l1')).not.toBeInTheDocument()
  })

  it('opens the dialog, submits a new customer and shows a success toast', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo cliente/i }))
    await user.type(screen.getByLabelText(/^nome$/i), 'Novo Cliente')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Novo Cliente' })),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Cliente cadastrado.')
  })

  it('toggles active/inactive from the listing, calling update with is_active', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('switch'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('1', { is_active: false }))
  })

  it('shows an inline error with a retry action when the list fails to load', async () => {
    useCustomersMock.mockReturnValue({
      customers: [],
      isLoading: false,
      error: new ApiError('database', 500, 'Falha ao carregar clientes.'),
      refetch: refetchMock,
      create: createMock,
      update: updateMock,
    })
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Falha ao carregar clientes.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(refetchMock).toHaveBeenCalled()
  })
})
