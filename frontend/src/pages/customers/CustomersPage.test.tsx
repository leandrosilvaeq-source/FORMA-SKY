import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'
import type { Customer } from '@/types/domain'

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

const customer: Customer = {
  id: '1',
  name: 'Ana',
  whatsapp: '11999990000',
  instagram: '@ana',
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

  it('shows the column headers in the approved order, with "Como nos conheceu" instead of "Origem"', () => {
    renderPage()

    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual([
      'Nome',
      'Empresa',
      'WhatsApp',
      'Instagram',
      'Como nos conheceu',
      'Ativo',
      '',
    ])
    expect(screen.queryByText('Origem')).not.toBeInTheDocument()
  })

  it('keeps each value under the correct column after the reorder', () => {
    renderPage()

    const row = screen.getByRole('row', { name: /ana/i })
    const cells = within(row).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('Ana')
    expect(cells[1]).toHaveTextContent('Empresa A')
    // 11999990000 é um número BR válido (11 dígitos): a listagem agora
    // normaliza para exibição, ver describe 'WhatsApp/Instagram clicáveis'.
    expect(cells[2]).toHaveTextContent('+55 (11) 99999-0000')
    expect(cells[3]).toHaveTextContent('@ana')
    expect(cells[4]).toHaveTextContent('Indicação / boca a boca')
    expect(within(cells[5]).getByRole('switch')).toBeInTheDocument()
    expect(within(cells[6]).getByRole('button', { name: /editar/i })).toBeInTheDocument()
  })

  it('clicking "Editar" opens the dialog pre-filled for that customer', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /editar/i }))

    expect(screen.getByText('Editar cliente')).toBeInTheDocument()
    expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Ana')
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

  describe('WhatsApp/Instagram clicáveis na listagem', () => {
    function renderWithCustomer(overrides: Partial<typeof customer>) {
      useCustomersMock.mockReturnValue({
        customers: [{ ...customer, ...overrides }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        update: updateMock,
      })
      renderPage()
    }

    it.each([
      ['+5541999999999', '+55 (41) 99999-9999'],
      ['(41) 99999-9999', '+55 (41) 99999-9999'],
    ])('%s normaliza só para exibição como "%s" e vira link do WhatsApp', (raw, expectedDisplay) => {
      renderWithCustomer({ whatsapp: raw })

      const link = screen.getByRole('link', { name: expectedDisplay })
      expect(link).toHaveTextContent(expectedDisplay)
      expect(link).toHaveAttribute('href', 'https://wa.me/5541999999999')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('valor de WhatsApp irreconhecível permanece texto puro, sem virar link', () => {
      renderWithCustomer({ whatsapp: 'az' })

      expect(screen.getByText('az')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /az/i })).not.toBeInTheDocument()
    })

    it('WhatsApp null continua mostrando "—"', () => {
      renderWithCustomer({ whatsapp: null })

      const row = screen.getByRole('row', { name: /ana/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[2]).toHaveTextContent('—')
      expect(within(cells[2]).queryByRole('link')).not.toBeInTheDocument()
    })

    it.each([
      ['@usuario', '@usuario'],
      ['usuario', '@usuario'],
      ['https://instagram.com/usuario/', '@usuario'],
    ])('%s normaliza só para exibição como "%s" e vira link do Instagram', (raw, expectedDisplay) => {
      renderWithCustomer({ instagram: raw })

      const link = screen.getByRole('link', { name: expectedDisplay })
      expect(link).toHaveTextContent(expectedDisplay)
      expect(link).toHaveAttribute('href', 'https://instagram.com/usuario')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('valor de Instagram irreconhecível permanece texto puro, sem virar link', () => {
      renderWithCustomer({ instagram: 'john doe' })

      expect(screen.getByText('john doe')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /john doe/i })).not.toBeInTheDocument()
    })

    it('Instagram null continua mostrando "—"', () => {
      renderWithCustomer({ instagram: null })

      const row = screen.getByRole('row', { name: /ana/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[3]).toHaveTextContent('—')
      expect(within(cells[3]).queryByRole('link')).not.toBeInTheDocument()
    })
  })
})
