import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'

const {
  useOrdersMock,
  useCustomersMock,
  useCompaniesMock,
  useLeadSourcesMock,
  useProductsMock,
  toastMock,
  useAuthMock,
} = vi.hoisted(() => ({
  useOrdersMock: vi.fn(),
  useCustomersMock: vi.fn(),
  useCompaniesMock: vi.fn(),
  useLeadSourcesMock: vi.fn(),
  useProductsMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  useAuthMock: vi.fn(),
}))

vi.mock('@/hooks/useOrders', () => ({ useOrders: useOrdersMock }))
vi.mock('@/hooks/useCustomers', () => ({ useCustomers: useCustomersMock }))
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: useCompaniesMock }))
vi.mock('@/hooks/useLeadSources', () => ({ useLeadSources: useLeadSourcesMock }))
vi.mock('@/hooks/useProducts', () => ({ useProducts: useProductsMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { formatDateOnly, OrdersPage } from './OrdersPage'

const customer = {
  id: 'c1',
  name: 'Ana Cliente',
  whatsapp: null,
  instagram: null,
  company_id: null,
  acquisition_source_id: null,
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const product = {
  id: 'p1',
  name: 'Chaveiro',
  category: null,
  description: null,
  default_price: 25,
  default_print_time_minutes: null,
  default_weight_grams: null,
  units_per_plate: null,
  default_file_id: null,
  allows_personalization: false,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const orderSummary = {
  order_id: 'o1',
  order_number: 'FS-2026-0001',
  customer_id: 'c1',
  company_id: null,
  order_status: 'QUOTE' as const,
  payment_status: 'WAITING_PAYMENT' as const,
  order_date: '2026-08-17',
  expected_delivery_date: '2026-08-25',
  actual_delivery_date: null,
  subtotal: 50,
  discount_value: 0,
  total_value: 50,
  shipping_cost: 0,
  total_receivable: 50,
  total_paid: 0,
  balance_due: 50,
  has_overpayment: false,
  overpayment_amount: 0,
  approval_required: false,
  is_fully_approved: true,
  pending_approval_items: 0,
}

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  comboboxName: string,
  optionName: string,
): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

function renderPage() {
  return render(<OrdersPage />, { wrapper: MemoryRouter })
}

describe('formatDateOnly', () => {
  it('converte 2026-08-25 para 25/08/2026', () => {
    expect(formatDateOnly('2026-08-25')).toBe('25/08/2026')
  })

  it('retorna "—" para null', () => {
    expect(formatDateOnly(null)).toBe('—')
  })
})

describe('OrdersPage', () => {
  let createMock: ReturnType<typeof vi.fn>
  let refetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createMock = vi.fn().mockResolvedValue({ id: 'o1' })
    refetchMock = vi.fn()

    useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
    useOrdersMock.mockReturnValue({
      orders: [orderSummary],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
    })
    useCustomersMock.mockReturnValue({ customers: [customer], isLoading: false, error: null, refetch: vi.fn() })
    useCompaniesMock.mockReturnValue({ companies: [], isLoading: false, error: null, refetch: vi.fn() })
    useLeadSourcesMock.mockReturnValue({ leadSources: [], isLoading: false, error: null, refetch: vi.fn() })
    useProductsMock.mockReturnValue({ products: [product], isLoading: false, error: null, refetch: vi.fn() })
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('renders the order list resolving the customer name and formatting currency, never raw UUIDs', () => {
    renderPage()

    expect(screen.getByText('FS-2026-0001')).toBeInTheDocument()
    expect(screen.getByText('Ana Cliente')).toBeInTheDocument()
    expect(screen.getByText('Orçamento')).toBeInTheDocument()
    expect(screen.getByText('Aguardando pagamento')).toBeInTheDocument()
    expect(screen.getAllByText(/R\$\s*50,00/).length).toBeGreaterThan(0)
    expect(screen.queryByText('c1')).not.toBeInTheDocument()
    expect(screen.queryByText('o1')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no orders', () => {
    useOrdersMock.mockReturnValue({ orders: [], isLoading: false, error: null, refetch: refetchMock, create: createMock })
    renderPage()

    expect(screen.getByText('Nenhum pedido cadastrado.')).toBeInTheDocument()
  })

  it('opens the dialog, submits a new order with a Catálogo item and shows a success toast', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo pedido/i }))

    await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
    await selectOption(user, 'Produto', 'Chaveiro')

    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_id: 'c1',
          items: [expect.objectContaining({ item_type: 'CATALOG', product_id: 'p1', quantity: 1, unit_price: 25 })],
        }),
      ),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Pedido cadastrado.')
  })

  it('does not call create and shows an inline error when no customer/product is selected', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo pedido/i }))
    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(await screen.findByText('Selecione um cliente.')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('shows an inline error with a retry action when the list fails to load', async () => {
    useOrdersMock.mockReturnValue({
      orders: [],
      isLoading: false,
      error: new ApiError('database', 500, 'Falha ao carregar pedidos.'),
      refetch: refetchMock,
      create: createMock,
    })
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Falha ao carregar pedidos.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(refetchMock).toHaveBeenCalled()
  })

  it('shows a loading skeleton while orders are loading, instead of the table or the empty state', () => {
    useOrdersMock.mockReturnValue({ orders: [], isLoading: true, error: null, refetch: refetchMock, create: createMock })
    renderPage()

    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByText('Nenhum pedido cadastrado.')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows a validation ApiError from create() inline, not as a toast', async () => {
    createMock.mockRejectedValue(new ApiError('validation', 400, 'cliente inválido'))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo pedido/i }))
    await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
    await selectOption(user, 'Produto', 'Chaveiro')
    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(await screen.findByText('cliente inválido')).toBeInTheDocument()
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('shows a non-validation ApiError from create() via toast, not inline', async () => {
    createMock.mockRejectedValue(new ApiError('business_rule', 409, 'conflito de negócio'))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo pedido/i }))
    await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
    await selectOption(user, 'Produto', 'Chaveiro')
    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('conflito de negócio'))
  })
})
