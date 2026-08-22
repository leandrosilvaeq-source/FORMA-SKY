import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  getOrderMock,
  updateQuoteOrderMock,
  listOrderItemsMock,
} = vi.hoisted(() => ({
  useOrdersMock: vi.fn(),
  useCustomersMock: vi.fn(),
  useCompaniesMock: vi.fn(),
  useLeadSourcesMock: vi.fn(),
  useProductsMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  useAuthMock: vi.fn(),
  // OrderEditForm chama getOrder direto de lib/api/orders e listOrderItems
  // de lib/api/orderItems, nunca através de useOrders (já mockado por
  // inteiro acima) — precisa do próprio mock para não disparar uma chamada
  // real ao Supabase. updateQuoteOrder é chamado por esta própria página
  // (handleEditSubmit), não pelo OrderEditForm.
  getOrderMock: vi.fn(),
  updateQuoteOrderMock: vi.fn(),
  listOrderItemsMock: vi.fn(),
}))

vi.mock('@/hooks/useOrders', () => ({ useOrders: useOrdersMock }))
vi.mock('@/hooks/useCustomers', () => ({ useCustomers: useCustomersMock }))
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: useCompaniesMock }))
vi.mock('@/hooks/useLeadSources', () => ({ useLeadSources: useLeadSourcesMock }))
vi.mock('@/hooks/useProducts', () => ({ useProducts: useProductsMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('@/lib/api/orders', () => ({ getOrder: getOrderMock, updateQuoteOrder: updateQuoteOrderMock }))
vi.mock('@/lib/api/orderItems', () => ({ listOrderItems: listOrderItemsMock }))

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
  product_type: 'CATALOG',
  default_print_time_seconds: null,
  default_weight_grams: null,
  units_per_plate: null,
  default_file_id: null,
  allows_personalization: false,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const company = {
  id: 'co1',
  name: 'Empresa XYZ',
  trade_name: null,
  document_number: null,
  whatsapp: null,
  instagram: null,
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const orderSummary = {
  order_id: 'o1',
  order_number: 'FS-26-001',
  customer_id: 'c1',
  company_id: null,
  order_status: 'QUOTE' as const,
  payment_status: 'WAITING_PAYMENT' as const,
  payment_method: 'PIX' as const,
  delivery_method: 'Correios',
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
  item_types: ['CATALOG'] as const,
  item_names: ['Chaveiro'],
}

// public.orders (linha completa) — o que getOrder(orderId) devolve para
// alimentar o OrderEditForm. Distinto de orderSummary (vw_order_summary,
// usada só na listagem).
const fullOrder = {
  id: 'o1',
  order_number: 'FS-26-001',
  customer_id: 'c1',
  company_id: null,
  lead_source_id: null,
  order_status: 'QUOTE' as const,
  payment_status: 'WAITING_PAYMENT' as const,
  payment_method: 'PIX' as const,
  order_date: '2026-08-17',
  approval_date: null,
  expected_delivery_date: '2026-08-25',
  actual_delivery_date: null,
  delivery_method: 'Correios',
  shipping_cost: 0,
  discount_value: 0,
  subtotal: 50,
  total_value: 50,
  notes: null,
  created_at: '',
  updated_at: '',
}

// order_items da linha FS-26-001 — CATALOG puro, então o pedido é elegível
// para edição completa (QUOTE + só itens CATALOG).
const fullOrderItem = {
  id: 'oi1',
  order_id: 'o1',
  item_type: 'CATALOG' as const,
  product_id: 'p1',
  item_name: 'Chaveiro',
  description: null,
  quantity: 1,
  unit_price: 25,
  personalization_fee: 0,
  discount_value: 0,
  total_price: 25,
  color_description: null,
  number_of_colors: null,
  customization_data: {},
  expected_delivery_date: null,
  notes: null,
  created_at: '',
  updated_at: '',
}

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  comboboxName: string,
  optionName: string,
): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

async function clickRadio(
  user: ReturnType<typeof userEvent.setup>,
  groupName: string,
  optionName: string,
): Promise<void> {
  const group = screen.getByRole('radiogroup', { name: groupName })
  await user.click(within(group).getByRole('radio', { name: optionName }))
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
    useCompaniesMock.mockReturnValue({ companies: [company], isLoading: false, error: null, refetch: vi.fn() })
    useLeadSourcesMock.mockReturnValue({ leadSources: [], isLoading: false, error: null, refetch: vi.fn() })
    useProductsMock.mockReturnValue({ products: [product], isLoading: false, error: null, refetch: vi.fn() })
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    getOrderMock.mockReset().mockResolvedValue(fullOrder)
    listOrderItemsMock.mockReset().mockResolvedValue([fullOrderItem])
    updateQuoteOrderMock.mockReset().mockResolvedValue({ id: 'o1' })
  })

  it('renders the order list resolving the customer name and formatting currency, never raw UUIDs (regressão)', () => {
    renderPage()

    expect(screen.getByText('FS-26-001')).toBeInTheDocument()
    expect(screen.getByText('Ana Cliente')).toBeInTheDocument()
    expect(screen.getByText('Orçamento')).toBeInTheDocument()
    expect(screen.getByText('Aguardando pagamento')).toBeInTheDocument()
    expect(screen.getByText('Pix')).toBeInTheDocument()
    expect(screen.getByText('Correios')).toBeInTheDocument()
    expect(screen.getByText('Catálogo')).toBeInTheDocument()
    expect(screen.getByText('Chaveiro')).toBeInTheDocument()
    expect(screen.getByText('25/08/2026')).toBeInTheDocument()
    expect(screen.getAllByText(/R\$\s*50,00/).length).toBeGreaterThan(0)
    expect(screen.queryByText('c1')).not.toBeInTheDocument()
    expect(screen.queryByText('o1')).not.toBeInTheDocument()
    expect(screen.queryByText('co1')).not.toBeInTheDocument()
  })

  it('B2C (company_id nulo) mostra o nome do cliente na coluna Cliente', () => {
    renderPage()

    const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
    expect(within(row).getByText('Ana Cliente')).toBeInTheDocument()
  })

  it('B2B (company_id preenchido) mostra o nome da empresa na coluna Cliente, nunca o nome do cliente nem o UUID', () => {
    const b2bOrder = { ...orderSummary, order_id: 'o2', order_number: 'FS-26-002', company_id: 'co1' }
    useOrdersMock.mockReturnValue({
      orders: [b2bOrder],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
    })
    renderPage()

    const row = screen.getByText('FS-26-002').closest('tr') as HTMLElement
    expect(within(row).getByText('Empresa XYZ')).toBeInTheDocument()
    expect(within(row).queryByText('Ana Cliente')).not.toBeInTheDocument()
    expect(within(row).queryByText('co1')).not.toBeInTheDocument()
  })

  it('Tipo(s): múltiplos tipos aparecem juntos, sem duplicação, traduzidos', () => {
    const mixedOrder = {
      ...orderSummary,
      order_id: 'o3',
      order_number: 'FS-26-003',
      item_types: ['CATALOG', 'CUSTOM'] as const,
      item_names: ['Chaveiro', 'Caneca Personalizada'],
    }
    useOrdersMock.mockReturnValue({
      orders: [mixedOrder],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
    })
    renderPage()

    const row = screen.getByText('FS-26-003').closest('tr') as HTMLElement
    expect(within(row).getByText('Catálogo, Personalizado')).toBeInTheDocument()
  })

  it('Produto(s): mostra o nome de todos os itens, preservando a ordem recebida da view', () => {
    const mixedOrder = {
      ...orderSummary,
      order_id: 'o3',
      order_number: 'FS-26-003',
      item_types: ['CATALOG', 'CUSTOM'] as const,
      item_names: ['Chaveiro', 'Caneca Personalizada'],
    }
    useOrdersMock.mockReturnValue({
      orders: [mixedOrder],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
    })
    renderPage()

    const row = screen.getByText('FS-26-003').closest('tr') as HTMLElement
    expect(within(row).getByText('Chaveiro, Caneca Personalizada')).toBeInTheDocument()
  })

  it('itens CUSTOM/SPOT usam item_name diretamente, sem product_id nem tentativa de resolver produto', () => {
    const spotOrder = {
      ...orderSummary,
      order_id: 'o4',
      order_number: 'FS-26-004',
      item_types: ['SPOT'] as const,
      item_names: ['Miniatura sob encomenda (sem produto de catálogo)'],
    }
    useOrdersMock.mockReturnValue({
      orders: [spotOrder],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
    })
    renderPage()

    const row = screen.getByText('FS-26-004').closest('tr') as HTMLElement
    expect(within(row).getByText('Spot')).toBeInTheDocument()
    expect(within(row).getByText('Miniatura sob encomenda (sem produto de catálogo)')).toBeInTheDocument()
  })

  it.each([
    ['PIX', 'Pix'],
    ['DINHEIRO', 'Dinheiro'],
    ['CARTAO', 'Cartão'],
  ] as const)('Método de pagamento %s é exibido como "%s"', (method, label) => {
    const order = { ...orderSummary, payment_method: method }
    useOrdersMock.mockReturnValue({
      orders: [order],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
    })
    renderPage()

    const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
    expect(within(row).getByText(label)).toBeInTheDocument()
  })

  it('Método de pagamento ausente (null) mostra "—"', () => {
    const order = { ...orderSummary, payment_method: null }
    useOrdersMock.mockReturnValue({
      orders: [order],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
    })
    renderPage()

    const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell')
    // Índice 6: Nº pedido(0)/Cliente(1)/Tipo(s)(2)/Produto(s)(3)/Status(4)/
    // Status financeiro(5)/Método de pagamento(6).
    expect(cells[6]).toHaveTextContent('—')
  })

  it('Forma de entrega mostra o valor gravado (já em português, sem dicionário de tradução) e "—" quando ausente', () => {
    const withDelivery = { ...orderSummary, order_id: 'o5', order_number: 'FS-26-005', delivery_method: 'Transportadora' }
    const withoutDelivery = { ...orderSummary, order_id: 'o6', order_number: 'FS-26-006', delivery_method: null }
    useOrdersMock.mockReturnValue({
      orders: [withDelivery, withoutDelivery],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
    })
    renderPage()

    const rowWith = screen.getByText('FS-26-005').closest('tr') as HTMLElement
    expect(within(rowWith).getByText('Transportadora')).toBeInTheDocument()

    const rowWithout = screen.getByText('FS-26-006').closest('tr') as HTMLElement
    const cells = within(rowWithout).getAllByRole('cell')
    expect(cells[7]).toHaveTextContent('—')
  })

  it('Prazo de entrega é formatado como DD/MM/YYYY na listagem', () => {
    renderPage()

    const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
    expect(within(row).getByText('25/08/2026')).toBeInTheDocument()
  })

  it('zebra striping: linha ímpar em roxo suave, linha par em branco, mesma paleta Forma', () => {
    const orderB = { ...orderSummary, order_id: 'o2', order_number: 'FS-26-002' }
    useOrdersMock.mockReturnValue({
      orders: [orderSummary, orderB],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
    })
    renderPage()

    const firstRow = screen.getByText('FS-26-001').closest('tr')
    const secondRow = screen.getByText('FS-26-002').closest('tr')
    expect(firstRow).toHaveClass('odd:bg-brand-primary-soft/50')
    expect(firstRow).toHaveClass('even:bg-white')
    expect(secondRow).toHaveClass('odd:bg-brand-primary-soft/50')
    expect(secondRow).toHaveClass('even:bg-white')
  })

  it('Produto(s) com conteúdo longo trunca visualmente e preserva o texto completo via title', () => {
    const longNames = ['Chaveiro Personalizado Edição Especial', 'Caneca Térmica Grande com Alça Reforçada']
    const order = {
      ...orderSummary,
      item_types: ['CATALOG', 'CUSTOM'] as const,
      item_names: longNames,
    }
    useOrdersMock.mockReturnValue({
      orders: [order],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
    })
    renderPage()

    const fullText = longNames.join(', ')
    const cell = screen.getByTitle(fullText)
    expect(cell).toHaveClass('truncate')
    expect(cell).toHaveTextContent(fullText)
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

  it('envia payment_method e expected_delivery_date escolhidos no formulário, atomicamente na criação (mesmo POST)', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo pedido/i }))

    await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
    await selectOption(user, 'Produto', 'Chaveiro')
    await clickRadio(user, 'Método de pagamento', 'Pix')
    await user.type(screen.getByLabelText('Prazo de entrega'), '2026-09-01')

    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: 'PIX',
          expected_delivery_date: '2026-09-01',
        }),
      ),
    )
  })

  it('campos opcionais do cabeçalho (payment_method/expected_delivery_date) enviam null quando não preenchidos', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo pedido/i }))
    await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
    await selectOption(user, 'Produto', 'Chaveiro')
    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: null,
          expected_delivery_date: null,
        }),
      ),
    )
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

  describe('coluna Ações — "Alterar pedido"', () => {
    it('a coluna Ações aparece no cabeçalho e o botão "Alterar pedido" aparece em cada linha', () => {
      const orderB = { ...orderSummary, order_id: 'o2', order_number: 'FS-26-002' }
      useOrdersMock.mockReturnValue({
        orders: [orderSummary, orderB],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
      })
      renderPage()

      expect(screen.getByRole('columnheader', { name: 'Ações' })).toBeInTheDocument()
      const row1 = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      const row2 = screen.getByText('FS-26-002').closest('tr') as HTMLElement
      expect(within(row1).getByRole('button', { name: /alterar pedido/i })).toBeInTheDocument()
      expect(within(row2).getByRole('button', { name: /alterar pedido/i })).toBeInTheDocument()
    })

    it('clicar em "Alterar pedido" abre o diálogo de edição carregando o pedido correto (getOrder e listOrderItems)', async () => {
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: /alterar pedido/i }))

      expect(await screen.findByRole('heading', { name: 'Alterar pedido' })).toBeInTheDocument()
      expect(getOrderMock).toHaveBeenCalledWith('o1')
      expect(listOrderItemsMock).toHaveBeenCalledWith('o1')
    })

    it('abre visualmente idêntico ao formulário "Novo pedido", pré-preenchido com os dados do pedido', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /alterar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Alterar pedido' })
      await screen.findByLabelText('Cliente/Contato')

      expect(screen.getByRole('combobox', { name: 'Cliente/Contato' })).toHaveTextContent('Ana Cliente')
      expect(screen.getByRole('combobox', { name: 'Produto' })).toHaveTextContent('Chaveiro')
      expect(screen.getByLabelText('Quantidade')).toHaveValue('1')
      expect(screen.getByLabelText('Preço unitário')).toHaveValue('25')
      expect(screen.getByRole('radio', { name: 'Correios' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Pix' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText('Prazo de entrega')).toHaveValue('2026-08-25')
      expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeInTheDocument()
    })

    it('sucesso ao salvar chama updateQuoteOrder com o payload completo (sem order_number/status), mostra o toast e refaz a listagem', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /alterar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Alterar pedido' })
      await screen.findByLabelText('Cliente/Contato')

      await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

      await waitFor(() => expect(updateQuoteOrderMock).toHaveBeenCalledTimes(1))
      expect(updateQuoteOrderMock).toHaveBeenCalledWith(
        'o1',
        expect.objectContaining({
          customer_id: 'c1',
          items: [expect.objectContaining({ item_type: 'CATALOG', product_id: 'p1' })],
        }),
      )
      const payload = updateQuoteOrderMock.mock.calls[0][1]
      expect(payload).not.toHaveProperty('order_number')
      expect(payload).not.toHaveProperty('order_status')
      expect(payload).not.toHaveProperty('payment_status')
      await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Pedido atualizado.'))
      expect(screen.queryByRole('heading', { name: 'Alterar pedido' })).not.toBeInTheDocument()
      expect(refetchMock).toHaveBeenCalled()
    })

    it('alterar o método de pagamento antes de salvar envia o novo valor correto no payload de PUT /orders/:id/full', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /alterar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Alterar pedido' })
      await screen.findByLabelText('Cliente/Contato')

      expect(screen.getByRole('radio', { name: 'Pix' })).toHaveAttribute('aria-checked', 'true')
      await clickRadio(user, 'Método de pagamento', 'Cartão')
      await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

      await waitFor(() => expect(updateQuoteOrderMock).toHaveBeenCalledTimes(1))
      expect(updateQuoteOrderMock).toHaveBeenCalledWith('o1', expect.objectContaining({ payment_method: 'CARTAO' }))
    })

    it('nunca gera um novo número de pedido durante a edição (updateQuoteOrder nunca é seguido de refetch com order_number diferente)', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /alterar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Alterar pedido' })
      await screen.findByLabelText('Cliente/Contato')

      await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

      await waitFor(() => expect(updateQuoteOrderMock).toHaveBeenCalledTimes(1))
      const payload = updateQuoteOrderMock.mock.calls[0][1]
      expect(payload).not.toHaveProperty('order_number')
      expect(createMock).not.toHaveBeenCalled()
    })

    it('nunca chama createOrder (create) ao salvar uma edição', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /alterar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Alterar pedido' })
      await screen.findByLabelText('Cliente/Contato')

      await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

      await waitFor(() => expect(updateQuoteOrderMock).toHaveBeenCalledTimes(1))
      expect(createMock).not.toHaveBeenCalled()
    })

    it('erro ao salvar mantém o diálogo aberto com os dados preenchidos e mostra a mensagem real, sem toast', async () => {
      updateQuoteOrderMock.mockRejectedValue(new ApiError('business_rule', 409, 'Pedido não pode mais ser editado.'))
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /alterar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Alterar pedido' })
      await screen.findByLabelText('Cliente/Contato')

      await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

      expect(await screen.findByText('Pedido não pode mais ser editado.')).toBeInTheDocument()
      expect(toastMock.error).not.toHaveBeenCalled()
      expect(screen.getByRole('heading', { name: 'Alterar pedido' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Cliente/Contato' })).toHaveTextContent('Ana Cliente')
    })

    it('bloqueia o duplo envio: o botão "Salvar alterações" fica desabilitado enquanto a chamada está em andamento', async () => {
      let resolveUpdate: (value: { id: string }) => void = () => {}
      updateQuoteOrderMock.mockReturnValue(new Promise((resolve) => (resolveUpdate = resolve)))
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /alterar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Alterar pedido' })
      await screen.findByLabelText('Cliente/Contato')

      const saveButton = screen.getByRole('button', { name: 'Salvar alterações' })
      await user.click(saveButton)

      await waitFor(() => expect(screen.getByRole('button', { name: /salvando/i })).toBeDisabled())
      expect(updateQuoteOrderMock).toHaveBeenCalledTimes(1)

      resolveUpdate({ id: 'o1' })
      await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
    })

    it('pedido fora de QUOTE abre o mesmo formulário preenchido, mas somente leitura, sem "Salvar alterações"', async () => {
      getOrderMock.mockResolvedValue({ ...fullOrder, order_status: 'APPROVED' })
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /alterar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Alterar pedido' })
      await screen.findByLabelText('Cliente/Contato')

      expect(screen.getByRole('combobox', { name: 'Cliente/Contato' })).toHaveTextContent('Ana Cliente')
      expect(screen.getByRole('combobox', { name: 'Cliente/Contato' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: /salvar alterações/i })).not.toBeInTheDocument()
      expect(screen.getByText(/está em "Aprovado"/i)).toBeInTheDocument()
    })

    it('pedido com item Personalizado/Spot abre o mesmo formulário preenchido, mas somente leitura', async () => {
      listOrderItemsMock.mockResolvedValue([{ ...fullOrderItem, item_type: 'SPOT', product_id: null }])
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /alterar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Alterar pedido' })
      await screen.findByLabelText('Cliente/Contato')

      expect(screen.queryByRole('button', { name: /salvar alterações/i })).not.toBeInTheDocument()
      expect(screen.getByText(/Personalizado ou Spot/i)).toBeInTheDocument()
    })
  })
})
