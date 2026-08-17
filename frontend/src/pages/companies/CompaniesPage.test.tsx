import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'

const { useCompaniesMock, toastMock, useAuthMock } = vi.hoisted(() => ({
  useCompaniesMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  useAuthMock: vi.fn(),
}))

vi.mock('@/hooks/useCompanies', () => ({ useCompanies: useCompaniesMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { CompaniesPage } from './CompaniesPage'

const company = {
  id: 'c1',
  name: 'Empresa A',
  trade_name: 'Fantasia A',
  document_number: '12345678000199',
  whatsapp: null,
  instagram: null,
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

function renderPage() {
  return render(<CompaniesPage />, { wrapper: MemoryRouter })
}

describe('CompaniesPage', () => {
  let createMock: ReturnType<typeof vi.fn>
  let updateMock: ReturnType<typeof vi.fn>
  let refetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createMock = vi.fn().mockResolvedValue(company)
    updateMock = vi.fn().mockResolvedValue(company)
    refetchMock = vi.fn()

    useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
    useCompaniesMock.mockReturnValue({
      companies: [company],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      update: updateMock,
    })
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('renders the company table with the expected columns', () => {
    renderPage()

    expect(screen.getByText('Empresa A')).toBeInTheDocument()
    expect(screen.getByText('Fantasia A')).toBeInTheDocument()
    expect(screen.getByText('12345678000199')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Nome' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Nome fantasia' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Documento' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Instagram' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Ativo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editar/i })).toBeInTheDocument()
  })

  it('opens the dialog, submits a new company and shows a success toast', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /nova empresa/i }))
    await user.type(screen.getByLabelText(/^nome$/i), 'Nova Empresa')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nova Empresa' })),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Empresa cadastrada.')
  })

  it('toggles active/inactive from the listing, calling update with is_active', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('switch'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('c1', { is_active: false }))
  })

  it('shows an inline error with a retry action when the list fails to load', async () => {
    useCompaniesMock.mockReturnValue({
      companies: [],
      isLoading: false,
      error: new ApiError('database', 500, 'Falha ao carregar empresas.'),
      refetch: refetchMock,
      create: createMock,
      update: updateMock,
    })
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Falha ao carregar empresas.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(refetchMock).toHaveBeenCalled()
  })
})
