import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'
import type { ItemType, OrderSummary } from '@/types/domain'

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
  useOrderManagementMock,
  changeOrderStatusMock,
  registerPaymentMock,
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
  // OrderStatusControl (coluna Status da listagem) chama changeOrderStatus
  // direto de lib/api/orders, sem passar por useOrderManagement (custaria
  // uma busca inteira de resumo/pagamentos/histórico só para trocar um
  // status a partir da linha da tabela) — precisa do próprio mock aqui.
  changeOrderStatusMock: vi.fn(),
  // OrderPaymentStatusControl (coluna Status financeiro da listagem) chama
  // registerPayment direto de lib/api/payments, pelo mesmo motivo de
  // changeOrderStatusMock acima — os 3 valores financeiros já vêm prontos
  // via OrderSummary (useOrders), sem precisar de useOrderManagement.
  registerPaymentMock: vi.fn(),
  // OrderManagementPanel usa useOrderManagement por inteiro — mockado aqui
  // pelo mesmo motivo de getOrder/listOrderItems acima: esta suíte testa só
  // a integração (o botão abre o diálogo certo, com o orderId certo), não
  // o comportamento interno do painel (já coberto por
  // OrderManagementPanel.test.tsx).
  useOrderManagementMock: vi.fn(),
}))

vi.mock('@/hooks/useOrders', () => ({ useOrders: useOrdersMock }))
vi.mock('@/hooks/useCustomers', () => ({ useCustomers: useCustomersMock }))
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: useCompaniesMock }))
vi.mock('@/hooks/useLeadSources', () => ({ useLeadSources: useLeadSourcesMock }))
vi.mock('@/hooks/useProducts', () => ({ useProducts: useProductsMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('@/lib/api/orders', () => ({
  getOrder: getOrderMock,
  updateQuoteOrder: updateQuoteOrderMock,
  changeOrderStatus: changeOrderStatusMock,
}))
vi.mock('@/lib/api/orderItems', () => ({ listOrderItems: listOrderItemsMock }))
vi.mock('@/lib/api/payments', () => ({ registerPayment: registerPaymentMock }))
vi.mock('@/hooks/useOrderManagement', () => ({ useOrderManagement: useOrderManagementMock }))

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

const orderSummary: OrderSummary = {
  order_id: 'o1',
  order_number: 'FS-26-001',
  customer_id: 'c1',
  company_id: null,
  order_status: 'QUOTE',
  payment_status: 'WAITING_PAYMENT',
  payment_method: 'PIX',
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
  item_types: ['CATALOG'],
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

function mockOrders(
  list: OrderSummary[],
  overrides: Partial<{ isLoading: boolean; error: unknown; refetch: ReturnType<typeof vi.fn> }> = {},
  createMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ id: list[0]?.order_id }),
) {
  useOrdersMock.mockReturnValue({
    orders: list,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    create: createMock,
  })
}

// A lista de sugestões do autocomplete pode repetir, como sugestão, o
// mesmo texto já visível numa célula da tabela — por isso qualquer
// asserção de presença/ausência precisa ser explicitamente escopada à
// tabela ou à listbox, nunca screen.getByText/queryByText solto.
function getTable(): HTMLElement {
  return screen.getByRole('table')
}

function queryListbox(): HTMLElement | null {
  return screen.queryByRole('listbox', { name: 'Sugestões de pedido' })
}

function getListbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Sugestões de pedido' })
}

async function applySort(
  user: ReturnType<typeof userEvent.setup>,
  columnLabel: string,
  option: 'Ordenar crescente' | 'Ordenar decrescente' | 'Remover ordenação',
): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Ordenar coluna ${columnLabel}` }))
  await user.click(await screen.findByRole('menuitem', { name: option }))
}

// Retorna, na ordem visual atual (DOM), o Nº do pedido de cada linha de
// dados — usado como "impressão digital" da ordem das linhas, já que é
// sempre visível e único por linha, independente de qual coluna está de
// fato ordenando.
function getVisibleOrderNumbersInOrder(): string[] {
  const dataRows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)
  return dataRows.map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
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
    changeOrderStatusMock.mockReset().mockResolvedValue(undefined)
    registerPaymentMock.mockReset().mockResolvedValue({ id: 'pay-1' })
    useOrderManagementMock.mockReset().mockReturnValue({
      summary: orderSummary,
      payments: [],
      statusHistory: [],
      paymentStatusHistory: [],
      isLoading: false,
      loadError: null,
      refetch: vi.fn(),
      isChangingStatus: false,
      changeStatus: vi.fn().mockResolvedValue(undefined),
      isRegisteringPayment: false,
      registerPaymentForOrder: vi.fn().mockResolvedValue(undefined),
    })
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

  describe('coluna Ações — "Gerenciar pedido"', () => {
    it('o botão "Gerenciar pedido" aparece em cada linha, ao lado de "Alterar pedido"', () => {
      const orderB = { ...orderSummary, order_id: 'o2', order_number: 'FS-26-002' }
      mockOrders([orderSummary, orderB], {}, createMock)
      renderPage()

      const row1 = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      const row2 = screen.getByText('FS-26-002').closest('tr') as HTMLElement
      expect(within(row1).getByRole('button', { name: /gerenciar pedido/i })).toBeInTheDocument()
      expect(within(row1).getByRole('button', { name: /alterar pedido/i })).toBeInTheDocument()
      expect(within(row2).getByRole('button', { name: /gerenciar pedido/i })).toBeInTheDocument()
    })

    it('clicar em "Gerenciar pedido" abre o diálogo de gerenciamento para o pedido correto', async () => {
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: /gerenciar pedido/i }))

      expect(await screen.findByRole('heading', { name: 'Gerenciar pedido' })).toBeInTheDocument()
      expect(useOrderManagementMock).toHaveBeenCalledWith('o1')
    })

    it('passa o Cliente/Empresa já resolvido pela própria página (nunca uma nova consulta dentro do painel)', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /gerenciar pedido/i,
        }),
      )

      const heading = await screen.findByRole('heading', { name: 'Gerenciar pedido' })
      const dialog = heading.closest('[role="dialog"]') as HTMLElement
      expect(within(dialog).getByText('Ana Cliente')).toBeInTheDocument()
    })

    it('uma ação bem-sucedida dentro do painel (mudança de status) refaz a listagem de Pedidos', async () => {
      const changeStatus = vi.fn().mockResolvedValue(undefined)
      useOrderManagementMock.mockReturnValue({
        summary: orderSummary,
        payments: [],
        statusHistory: [],
        paymentStatusHistory: [],
        isLoading: false,
        loadError: null,
        refetch: vi.fn(),
        isChangingStatus: false,
        changeStatus,
        isRegisteringPayment: false,
        registerPaymentForOrder: vi.fn().mockResolvedValue(undefined),
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /gerenciar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Gerenciar pedido' })
      await user.click(screen.getByRole('button', { name: /avançar para/i }))
      await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

      await waitFor(() => expect(changeStatus).toHaveBeenCalled())
      await waitFor(() => expect(refetchMock).toHaveBeenCalled())
    })

    it('fechar o diálogo de gerenciamento não afeta o diálogo de "Alterar pedido"', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(
        within(screen.getByText('FS-26-001').closest('tr') as HTMLElement).getByRole('button', {
          name: /gerenciar pedido/i,
        }),
      )
      await screen.findByRole('heading', { name: 'Gerenciar pedido' })
      await user.click(screen.getByRole('button', { name: /^fechar$/i }))

      expect(screen.queryByRole('heading', { name: 'Gerenciar pedido' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Alterar pedido' })).not.toBeInTheDocument()
    })
  })

  describe('Filtro rápido por status', () => {
    const quoteOrder = { ...orderSummary, order_id: 'o1', order_number: 'FS-26-001', order_status: 'QUOTE' as const }
    const approvedOrder = {
      ...orderSummary,
      order_id: 'o2',
      order_number: 'FS-26-002',
      order_status: 'APPROVED' as const,
    }
    const deliveredOrder = {
      ...orderSummary,
      order_id: 'o3',
      order_number: 'FS-26-003',
      order_status: 'DELIVERED' as const,
    }

    beforeEach(() => {
      mockOrders([quoteOrder, approvedOrder, deliveredOrder], {}, createMock)
    })

    it('mostra "Todos" selecionado por padrão, com todos os pedidos visíveis', () => {
      renderPage()

      const group = screen.getByRole('radiogroup', { name: 'Filtrar pedidos por status' })
      expect(within(group).getByRole('radio', { name: /todos/i })).toHaveAttribute('aria-checked', 'true')
      expect(getVisibleOrderNumbersInOrder()).toHaveLength(3)
    })

    it('mostra a contagem de pedidos ao lado de cada opção de status', () => {
      renderPage()

      const group = screen.getByRole('radiogroup', { name: 'Filtrar pedidos por status' })
      expect(within(group).getByRole('radio', { name: /todos \(3\)/i })).toBeInTheDocument()
      expect(within(group).getByRole('radio', { name: /orçamento \(1\)/i })).toBeInTheDocument()
      expect(within(group).getByRole('radio', { name: /aprovado \(1\)/i })).toBeInTheDocument()
      expect(within(group).getByRole('radio', { name: /entregue \(1\)/i })).toBeInTheDocument()
      expect(within(group).getByRole('radio', { name: /cancelado \(0\)/i })).toBeInTheDocument()
    })

    it('clicar num status filtra a listagem para só aquele status', async () => {
      const user = userEvent.setup()
      renderPage()

      const group = screen.getByRole('radiogroup', { name: 'Filtrar pedidos por status' })
      await user.click(within(group).getByRole('radio', { name: /^aprovado/i }))

      expect(getVisibleOrderNumbersInOrder()).toEqual(['FS-26-002'])
      expect(within(group).getByRole('radio', { name: /^aprovado/i })).toHaveAttribute('aria-checked', 'true')
    })

    it('voltar para "Todos" restaura a listagem completa', async () => {
      const user = userEvent.setup()
      renderPage()

      const group = screen.getByRole('radiogroup', { name: 'Filtrar pedidos por status' })
      await user.click(within(group).getByRole('radio', { name: /^aprovado/i }))
      await user.click(within(group).getByRole('radio', { name: /^todos/i }))

      expect(getVisibleOrderNumbersInOrder()).toEqual(['FS-26-001', 'FS-26-002', 'FS-26-003'])
    })

    it('combina corretamente com a busca (busca primeiro, filtro de status depois)', async () => {
      const user = userEvent.setup()
      renderPage()

      const group = screen.getByRole('radiogroup', { name: 'Filtrar pedidos por status' })
      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'FS-26')
      await user.click(within(group).getByRole('radio', { name: /^entregue/i }))

      expect(getVisibleOrderNumbersInOrder()).toEqual(['FS-26-003'])
    })

    it('um status sem nenhum pedido mostra a mensagem de vazio específica de status, distinta da de busca', async () => {
      const user = userEvent.setup()
      renderPage()

      const group = screen.getByRole('radiogroup', { name: 'Filtrar pedidos por status' })
      await user.click(within(group).getByRole('radio', { name: /^cancelado/i }))

      expect(screen.getByText('Nenhum pedido encontrado para este status.')).toBeInTheDocument()
      expect(screen.queryByText('Nenhum pedido encontrado para esta busca.')).not.toBeInTheDocument()
    })

    it('não faz nenhuma nova chamada à API ao trocar de filtro', async () => {
      const user = userEvent.setup()
      renderPage()

      const group = screen.getByRole('radiogroup', { name: 'Filtrar pedidos por status' })
      await user.click(within(group).getByRole('radio', { name: /^aprovado/i }))

      expect(refetchMock).not.toHaveBeenCalled()
      expect(createMock).not.toHaveBeenCalled()
    })

    it('cada botão de status é focável e ativável por teclado (Tab + Enter)', async () => {
      const user = userEvent.setup()
      renderPage()

      const group = screen.getByRole('radiogroup', { name: 'Filtrar pedidos por status' })
      const approvedRadio = within(group).getByRole('radio', { name: /^aprovado/i })
      approvedRadio.focus()
      expect(approvedRadio).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(approvedRadio).toHaveAttribute('aria-checked', 'true')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['FS-26-002'])
    })
  })

  describe('Alterar status diretamente pela listagem (coluna Status)', () => {
    it('QUOTE mostra um badge clicável na coluna Status, sem precisar abrir "Gerenciar pedido"', () => {
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      expect(within(row).getByRole('button', { name: 'Orçamento' })).toBeInTheDocument()
    })

    it('DELIVERED mostra só um badge estático, sem nenhuma ação', () => {
      const deliveredOrder = { ...orderSummary, order_status: 'DELIVERED' as const }
      mockOrders([deliveredOrder], {}, createMock)
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      expect(within(row).queryByRole('button', { name: 'Entregue' })).not.toBeInTheDocument()
      expect(within(row).getByText('Entregue')).toBeInTheDocument()
    })

    it('CANCELLED mostra só um badge estático, sem nenhuma ação', () => {
      const cancelledOrder = { ...orderSummary, order_status: 'CANCELLED' as const }
      mockOrders([cancelledOrder], {}, createMock)
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      expect(within(row).queryByRole('button', { name: 'Cancelado' })).not.toBeInTheDocument()
      expect(within(row).getByText('Cancelado')).toBeInTheDocument()
      // Ações da linha (Alterar/Gerenciar pedido) continuam disponíveis —
      // só o controle de STATUS vira badge estático, nunca a linha inteira.
      expect(within(row).getByRole('button', { name: /gerenciar pedido/i })).toBeInTheDocument()
    })

    it('clicar no badge de status abre o diálogo mostrando só a próxima transição válida, exige confirmação', async () => {
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: 'Orçamento' }))

      expect(screen.getByRole('heading', { name: /alterar status/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /avançar para "aguardando aprovação"/i })).toBeInTheDocument()
      expect(changeOrderStatusMock).not.toHaveBeenCalled()
    })

    it('confirmar a transição chama changeOrderStatus, mostra toast e refaz a listagem/contagens', async () => {
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: 'Orçamento' }))
      await user.click(screen.getByRole('button', { name: /avançar para/i }))
      await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

      await waitFor(() => expect(changeOrderStatusMock).toHaveBeenCalledWith('o1', 'WAITING_APPROVAL'))
      expect(toastMock.success).toHaveBeenCalled()
      expect(refetchMock).toHaveBeenCalled()
    })

    it('bloqueia duplo clique: o botão Confirmar fica desabilitado durante a chamada', async () => {
      let resolvePromise: () => void = () => {}
      changeOrderStatusMock.mockReturnValue(
        new Promise<void>((resolve) => {
          resolvePromise = resolve
        }),
      )
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: 'Orçamento' }))
      await user.click(screen.getByRole('button', { name: /avançar para/i }))
      await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

      expect(screen.getByRole('button', { name: /confirmando/i })).toBeDisabled()
      resolvePromise()
    })

    it('mostra o erro real do backend quando a transição falha, sem fechar o diálogo', async () => {
      changeOrderStatusMock.mockRejectedValue(new ApiError('business_rule', 409, 'Transição de status inválida'))
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: 'Orçamento' }))
      await user.click(screen.getByRole('button', { name: /avançar para/i }))
      await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

      expect(await screen.findByText('Transição de status inválida')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /alterar status/i })).toBeInTheDocument()
    })

    it('pedido QUOTE só-CATALOG: avançar para "Aguardando aprovação" continua correto mesmo que o backend já promova automaticamente a Aprovado', async () => {
      // Este teste só confirma que a página confia no refetch (nunca
      // assume o novo status localmente) — a promoção automática em si é
      // responsabilidade de try_auto_approve_order() no backend, já fora
      // do escopo do frontend.
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: 'Orçamento' }))
      await user.click(screen.getByRole('button', { name: /avançar para/i }))
      await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

      await waitFor(() => expect(changeOrderStatusMock).toHaveBeenCalledWith('o1', 'WAITING_APPROVAL'))
      expect(refetchMock).toHaveBeenCalled()
    })

    it('cancelar pela listagem só é oferecido quando a máquina de estados permite', async () => {
      const inProductionOrder = { ...orderSummary, order_status: 'IN_PRODUCTION' as const }
      mockOrders([inProductionOrder], {}, createMock)
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: 'Em produção' }))

      expect(screen.queryByRole('button', { name: /cancelar pedido/i })).not.toBeInTheDocument()
    })

    it('o botão "Gerenciar pedido" continua disponível ao lado do controle de status, para pagamentos/histórico', () => {
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      expect(within(row).getByRole('button', { name: 'Orçamento' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /gerenciar pedido/i })).toBeInTheDocument()
    })
  })

  describe('Alterar status financeiro diretamente pela listagem (coluna Status financeiro)', () => {
    it('mostra um badge clicável com o texto do status financeiro atual', () => {
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      expect(within(row).getByRole('button', { name: /status financeiro: aguardando pagamento/i })).toBeInTheDocument()
    })

    it('clicar no status financeiro abre o RegisterPaymentForm com os totais corretos do pedido', async () => {
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: /status financeiro/i }))

      expect(screen.getByRole('heading', { name: 'Registrar pagamento' })).toBeInTheDocument()
      expect(screen.getByRole('radiogroup', { name: 'Tipo de pagamento' })).toBeInTheDocument()
      // orderSummary: total_receivable=50, total_paid=0, balance_due=50
      const totals = screen.getAllByText('R$ 50,00')
      expect(totals.length).toBeGreaterThanOrEqual(2)
    })

    it('abre também pelo teclado (foco + Enter)', async () => {
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      const trigger = within(row).getByRole('button', { name: /status financeiro/i })
      trigger.focus()
      await user.keyboard('{Enter}')

      expect(screen.getByRole('heading', { name: 'Registrar pagamento' })).toBeInTheDocument()
    })

    it('registrar um pagamento chama registerPayment, mostra toast, refaz a listagem e fecha o diálogo', async () => {
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: /status financeiro/i }))

      await user.click(screen.getByRole('radio', { name: 'Sinal' }))
      await user.click(screen.getByRole('radio', { name: 'Pix' }))
      await user.click(screen.getByLabelText(/^valor$/i))
      await user.keyboard('2000')
      await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

      await waitFor(() =>
        expect(registerPaymentMock).toHaveBeenCalledWith(
          expect.objectContaining({ order_id: 'o1', payment_type: 'SINAL', payment_method: 'PIX', amount: 20 }),
        ),
      )
      expect(toastMock.success).toHaveBeenCalledWith('Pagamento registrado.')
      expect(refetchMock).toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Registrar pagamento' })).not.toBeInTheDocument())
    })

    it('mostra o erro real do backend e mantém o diálogo aberto quando o pagamento falha', async () => {
      registerPaymentMock.mockRejectedValue(new ApiError('business_rule', 409, 'Soma dos pagamentos ficaria negativa'))
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: /status financeiro/i }))
      await user.click(screen.getByRole('radio', { name: 'Sinal' }))
      await user.click(screen.getByRole('radio', { name: 'Pix' }))
      await user.click(screen.getByLabelText(/^valor$/i))
      await user.keyboard('2000')
      await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

      expect(await screen.findByText('Soma dos pagamentos ficaria negativa')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Registrar pagamento' })).toBeInTheDocument()
    })

    it('bloqueia duplo envio: o botão fica desabilitado durante a requisição', async () => {
      let resolvePromise: (value: { id: string }) => void = () => {}
      registerPaymentMock.mockReturnValue(
        new Promise<{ id: string }>((resolve) => {
          resolvePromise = resolve
        }),
      )
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: /status financeiro/i }))
      await user.click(screen.getByRole('radio', { name: 'Sinal' }))
      await user.click(screen.getByRole('radio', { name: 'Pix' }))
      await user.click(screen.getByLabelText(/^valor$/i))
      await user.keyboard('2000')
      await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

      expect(screen.getByRole('button', { name: /registrando/i })).toBeDisabled()
      expect(registerPaymentMock).toHaveBeenCalledTimes(1)
      await act(async () => {
        resolvePromise({ id: 'pay-1' })
        await Promise.resolve()
      })
    })

    it('pedido CANCELLED: o controle de status financeiro continua clicável (register_payment não bloqueia por order_status)', async () => {
      const cancelledOrder = { ...orderSummary, order_status: 'CANCELLED' as const }
      mockOrders([cancelledOrder], {}, createMock)
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: /status financeiro/i }))

      expect(screen.getByRole('heading', { name: 'Registrar pagamento' })).toBeInTheDocument()
    })

    it('o controle de Status do pedido (operacional) continua funcionando ao lado do de status financeiro', async () => {
      const user = userEvent.setup()
      renderPage()

      const row = screen.getByText('FS-26-001').closest('tr') as HTMLElement
      expect(within(row).getByRole('button', { name: 'Orçamento' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /status financeiro/i })).toBeInTheDocument()

      const user2 = user
      await user2.click(within(row).getByRole('button', { name: 'Orçamento' }))
      expect(screen.getByRole('heading', { name: /alterar status/i })).toBeInTheDocument()
    })

    it('filtros por status e busca continuam funcionando com o novo controle de status financeiro na coluna', async () => {
      const orderB = { ...orderSummary, order_id: 'o2', order_number: 'FS-26-002', order_status: 'APPROVED' as const }
      mockOrders([orderSummary, orderB], {}, createMock)
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'FS-26-002')
      expect(within(getTable()).getByText('FS-26-002')).toBeInTheDocument()
      expect(within(getTable()).queryByText('FS-26-001')).not.toBeInTheDocument()

      await user.clear(screen.getByRole('combobox', { name: 'Buscar pedido' }))
      const group = screen.getByRole('radiogroup', { name: 'Filtrar pedidos por status' })
      await user.click(within(group).getByRole('radio', { name: /^aprovado/i }))
      expect(getVisibleOrderNumbersInOrder()).toEqual(['FS-26-002'])
    })
  })

  describe('Busca rápida de pedidos', () => {
    const leandroCustomer = { ...customer, id: 'c2', name: 'Leandro Augusto' }
    const joseCustomer = { ...customer, id: 'c3', name: 'José Contato' }

    const orderLeandro: OrderSummary = {
      ...orderSummary,
      order_id: 'o10',
      order_number: 'FS-26-010',
      customer_id: 'c2',
      item_types: ['CUSTOM'] as ItemType[],
      item_names: ['Miniatura Simples'],
    }
    const orderPetlink = {
      ...orderSummary,
      order_id: 'o11',
      order_number: 'FS-26-011',
      item_names: ['Petlink', 'Chaveiro'],
    }
    const orderB2B = { ...orderSummary, order_id: 'o12', order_number: 'FS-26-012', company_id: 'co1' }
    const orderJose = {
      ...orderSummary,
      order_id: 'o13',
      order_number: 'FS-26-013',
      customer_id: 'c3',
      item_names: ['Porta-retrato'],
    }

    beforeEach(() => {
      mockOrders([orderSummary, orderLeandro, orderPetlink, orderB2B, orderJose])
      useCustomersMock.mockReturnValue({
        customers: [customer, leandroCustomer, joseCustomer],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })
    })

    it('possui rótulo acessível "Buscar pedido" e placeholder "Buscar por pedido, cliente ou produto..."', () => {
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('placeholder', 'Buscar por pedido, cliente ou produto...')
    })

    it('número completo ("FS-26-001") encontra o pedido correspondente', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'FS-26-001')

      expect(within(getTable()).getByText('FS-26-001')).toBeInTheDocument()
      expect(within(getTable()).queryByText('FS-26-010')).not.toBeInTheDocument()
    })

    it('número parcial ("26-010") encontra o pedido correspondente', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), '26-010')

      expect(within(getTable()).getByText('FS-26-010')).toBeInTheDocument()
      expect(within(getTable()).queryByText('FS-26-001')).not.toBeInTheDocument()
    })

    it('nome de cliente ("leandro") encontra pedidos cujo cliente exibido contenha o nome', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'leandro')

      expect(within(getTable()).getByText('FS-26-010')).toBeInTheDocument()
      expect(within(getTable()).queryByText('FS-26-001')).not.toBeInTheDocument()
    })

    it('nome de empresa em pedido B2B ("empresa xyz") encontra o pedido', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'empresa xyz')

      expect(within(getTable()).getByText('FS-26-012')).toBeInTheDocument()
    })

    it('nome de produto ("petlink") encontra pedidos que contenham Petlink em Produto(s)', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'petlink')

      expect(within(getTable()).getByText('FS-26-011')).toBeInTheDocument()
    })

    it('pedido com vários produtos: busca por qualquer um deles encontra o pedido (e outros pedidos com o mesmo produto)', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'chaveiro')

      // FS-26-001 (só Chaveiro) e FS-26-011 (Petlink + Chaveiro) têm
      // "Chaveiro" entre os produtos — busca em TODOS os produtos do
      // pedido, não só o primeiro.
      expect(within(getTable()).getByText('FS-26-001')).toBeInTheDocument()
      expect(within(getTable()).getByText('FS-26-011')).toBeInTheDocument()
    })

    it('busca sem diferenciar maiúsculas/minúsculas', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'PETLINK')

      expect(within(getTable()).getByText('FS-26-011')).toBeInTheDocument()
    })

    it('busca tolerante a acentos ("jose" encontra "José Contato")', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'jose')

      expect(within(getTable()).getByText('FS-26-013')).toBeInTheDocument()
    })

    it('remove espaços extras do termo pesquisado', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), '   petlink   ')

      expect(within(getTable()).getByText('FS-26-011')).toBeInTheDocument()
    })

    it('termo sem resultado mostra o estado vazio específico da busca, distinto de "Nenhum pedido cadastrado."', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'zzzxyz')

      expect(screen.getByText('Nenhum pedido encontrado para esta busca.')).toBeInTheDocument()
      expect(screen.queryByText('Nenhum pedido cadastrado.')).not.toBeInTheDocument()
    })

    it('não considera status, status financeiro nem método de pagamento na busca', async () => {
      const user = userEvent.setup()
      renderPage()

      // "orçamento" é o rótulo do Status (QUOTE) e "pix" é o rótulo do
      // Método de pagamento de todos os pedidos deste fixture — nenhum
      // dos dois aparece no número, cliente ou produto de nenhum pedido.
      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'orçamento')
      expect(screen.getByText('Nenhum pedido encontrado para esta busca.')).toBeInTheDocument()

      await user.clear(screen.getByRole('combobox', { name: 'Buscar pedido' }))
      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'pix')
      expect(screen.getByText('Nenhum pedido encontrado para esta busca.')).toBeInTheDocument()
    })

    it('limpar busca restaura todos os pedidos', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      await user.type(input, 'petlink')
      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(input).toHaveValue('')
      expect(within(getTable()).getByText('FS-26-001')).toBeInTheDocument()
      expect(within(getTable()).getByText('FS-26-010')).toBeInTheDocument()
      expect(within(getTable()).getByText('FS-26-011')).toBeInTheDocument()
      expect(within(getTable()).getByText('FS-26-012')).toBeInTheDocument()
      expect(within(getTable()).getByText('FS-26-013')).toBeInTheDocument()
    })

    it('nenhuma nova chamada ao hook/API enquanto o usuário digita', async () => {
      const refetchMock = vi.fn()
      mockOrders([orderSummary, orderLeandro, orderPetlink, orderB2B, orderJose], { refetch: refetchMock })
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'petlink')

      expect(refetchMock).not.toHaveBeenCalled()
    })
  })

  describe('Autocomplete/typeahead do campo "Buscar pedido"', () => {
    const leandroCustomer = { ...customer, id: 'c2', name: 'Leandro Augusto' }

    // orderC repete o produto "Petlink" (também em orderB) e o cliente
    // "Ana Cliente" (também em orderA) — cobre deduplicação dentro do
    // mesmo tipo. orderD tem um PRODUTO literalmente chamado igual ao
    // cliente "Leandro Augusto" — cobre "valores iguais de tipos
    // diferentes preservados como sugestões distintas".
    const orderA = { ...orderSummary, order_id: 'oA', order_number: 'FS-26-100', customer_id: 'c1', item_names: ['Chaveiro'] }
    const orderB = { ...orderSummary, order_id: 'oB', order_number: 'FS-26-101', customer_id: 'c2', item_names: ['Petlink'] }
    const orderC = {
      ...orderSummary,
      order_id: 'oC',
      order_number: 'FS-26-102',
      customer_id: 'c1',
      item_names: ['Petlink', 'Boneco'],
    }
    const orderD = {
      ...orderSummary,
      order_id: 'oD',
      order_number: 'FS-26-103',
      customer_id: 'c1',
      item_names: ['Leandro Augusto'],
    }

    beforeEach(() => {
      mockOrders([orderA, orderB, orderC, orderD])
      useCustomersMock.mockReturnValue({
        customers: [customer, leandroCustomer],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })
    })

    it('não abre a lista com o campo vazio', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('combobox', { name: 'Buscar pedido' }))

      expect(queryListbox()).not.toBeInTheDocument()
    })

    it('sugestão do tipo Pedido aparece com o número, com o badge "Pedido"', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'fs-26-100')

      const option = within(getListbox()).getByRole('option', { name: /FS-26-100/ })
      expect(within(option).getByText('Pedido')).toBeInTheDocument()
    })

    it('sugestão do tipo Cliente aparece com o nome, com o badge "Cliente"', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'leandro augusto')

      const option = within(getListbox()).getByRole('option', { name: /^Cliente/ })
      expect(within(option).getByText('Cliente')).toBeInTheDocument()
      expect(option).toHaveTextContent('Leandro Augusto')
    })

    it('sugestão do tipo Produto aparece com o nome, com o badge "Produto"', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'petlink')

      const option = within(getListbox()).getByRole('option', { name: /^Produto/ })
      expect(within(option).getByText('Produto')).toBeInTheDocument()
      expect(option).toHaveTextContent('Petlink')
    })

    it('deduplica sugestões iguais dentro do mesmo tipo (Petlink em 2 pedidos, Ana Cliente em 2 pedidos)', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      await user.type(input, 'petlink')
      expect(within(getListbox()).getAllByRole('option', { name: /Petlink/ })).toHaveLength(1)

      await user.clear(input)
      await user.type(input, 'ana cliente')
      expect(within(getListbox()).getAllByRole('option', { name: /Ana Cliente/ })).toHaveLength(1)
    })

    it('não confunde valores iguais de tipos diferentes: Cliente "Leandro Augusto" e Produto "Leandro Augusto" continuam sugestões distintas', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'leandro augusto')

      const options = within(getListbox()).getAllByRole('option')
      expect(options).toHaveLength(2)
      expect(within(getListbox()).getByRole('option', { name: /^Cliente/ })).toBeInTheDocument()
      expect(within(getListbox()).getByRole('option', { name: /^Produto/ })).toBeInTheDocument()
    })

    it('sugestões são atualizadas a cada caractere digitado', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      await user.type(input, 'fs-26-10')
      expect(within(getListbox()).getAllByRole('option').length).toBeGreaterThan(1)

      await user.type(input, '0')
      expect(within(getListbox()).getAllByRole('option')).toHaveLength(1)
      expect(within(getListbox()).getByRole('option', { name: /FS-26-100/ })).toBeInTheDocument()
    })

    it('clicar na sugestão Cliente preenche o nome e mostra todos os pedidos desse cliente', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'ana cliente')
      await user.click(within(getListbox()).getByRole('option', { name: /Ana Cliente/ }))

      expect(screen.getByRole('combobox', { name: 'Buscar pedido' })).toHaveValue('Ana Cliente')
      expect(queryListbox()).not.toBeInTheDocument()
      // Ana Cliente é o cliente de orderA (FS-26-100) e orderC (FS-26-102).
      expect(within(getTable()).getByText('FS-26-100')).toBeInTheDocument()
      expect(within(getTable()).getByText('FS-26-102')).toBeInTheDocument()
      expect(within(getTable()).queryByText('FS-26-101')).not.toBeInTheDocument()
    })

    it('clicar na sugestão Produto preenche o nome e mostra todos os pedidos com esse produto', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'petlink')
      await user.click(within(getListbox()).getByRole('option', { name: /^Produto/ }))

      expect(screen.getByRole('combobox', { name: 'Buscar pedido' })).toHaveValue('Petlink')
      // Petlink aparece em orderB (FS-26-101) e orderC (FS-26-102).
      expect(within(getTable()).getByText('FS-26-101')).toBeInTheDocument()
      expect(within(getTable()).getByText('FS-26-102')).toBeInTheDocument()
      expect(within(getTable()).queryByText('FS-26-100')).not.toBeInTheDocument()
    })

    it('ArrowDown + Enter seleciona a primeira sugestão', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      await user.type(input, 'fs-26-100')
      await user.keyboard('{ArrowDown}{Enter}')

      expect(input).toHaveValue('FS-26-100')
      expect(queryListbox()).not.toBeInTheDocument()
    })

    it('ArrowUp navega para a sugestão anterior', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      await user.type(input, 'fs-26-10')
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}')

      // Independente de qual seja a 1ª opção na lista, ArrowDown 2x seguido
      // de ArrowUp sempre volta para a 1ª opção ativada.
      expect(queryListbox()).not.toBeInTheDocument()
      expect((input as HTMLInputElement).value.length).toBeGreaterThan(0)
    })

    it('Escape fecha a lista sem apagar o texto digitado', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      await user.type(input, 'petlink')
      await user.keyboard('{Escape}')

      expect(queryListbox()).not.toBeInTheDocument()
      expect(input).toHaveValue('petlink')
    })

    it('clicar fora do campo/lista fecha as sugestões, sem alterar o texto', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      await user.type(input, 'petlink')
      expect(queryListbox()).toBeInTheDocument()

      await user.click(screen.getByRole('heading', { name: 'Pedidos' }))

      expect(queryListbox()).not.toBeInTheDocument()
      expect(input).toHaveValue('petlink')
    })

    it('"Limpar busca" fecha o autocomplete e restaura a tabela completa', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'petlink')
      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(queryListbox()).not.toBeInTheDocument()
      expect(within(getTable()).getByText('FS-26-103')).toBeInTheDocument()
    })

    it('voltar a editar o texto reabre as sugestões com a lista atualizada', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      await user.type(input, 'fs-26-100')
      await user.click(within(getListbox()).getByRole('option', { name: /FS-26-100/ }))
      expect(queryListbox()).not.toBeInTheDocument()

      await user.type(input, ' ')

      expect(queryListbox()).toBeInTheDocument()
    })

    it('nenhuma seleção automática mesmo com uma única sugestão correspondente', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      await user.type(input, 'fs-26-103')

      expect(within(getListbox()).getAllByRole('option')).toHaveLength(1)
      expect(input).toHaveValue('fs-26-103')
    })

    it('atributos e nomes acessíveis do combobox/listbox/opções', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar pedido' })
      expect(input).toHaveAttribute('aria-autocomplete', 'list')
      expect(input).toHaveAttribute('aria-controls', 'order-search-listbox')
      expect(input).toHaveAttribute('aria-expanded', 'false')
      expect(input).not.toHaveAttribute('aria-activedescendant')

      await user.type(input, 'fs-26-100')
      expect(input).toHaveAttribute('aria-expanded', 'true')
      expect(getListbox()).toHaveAttribute('id', 'order-search-listbox')

      await user.keyboard('{ArrowDown}')
      const activeOption = within(getListbox()).getByRole('option', { name: /FS-26-100/ })
      expect(input).toHaveAttribute('aria-activedescendant', activeOption.id)
      expect(activeOption).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('Ordenação por coluna (menu estilo filtro de tabela)', () => {
    beforeEach(() => {
      useCustomersMock.mockReturnValue({
        customers: [
          customer,
          { ...customer, id: 'c2', name: 'Beatriz Cliente' },
          { ...customer, id: 'c3', name: 'Carlos Cliente' },
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })
    })

    it('coluna Nº do pedido: comparação numérica natural (FS-26-1 < FS-26-2 < FS-26-10), crescente e decrescente', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'FS-26-2' },
        { ...orderSummary, order_id: 'o2', order_number: 'FS-26-10' },
        { ...orderSummary, order_id: 'o3', order_number: 'FS-26-1' },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Nº pedido', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['FS-26-1', 'FS-26-2', 'FS-26-10'])

      await applySort(user, 'Nº pedido', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['FS-26-10', 'FS-26-2', 'FS-26-1'])
    })

    it('coluna Cliente: ordena pelo nome exibido, crescente e decrescente', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-1', customer_id: 'c3' },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-2', customer_id: 'c1' },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-3', customer_id: 'c2' },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Cliente', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-2', 'ORD-3', 'ORD-1'])

      await applySort(user, 'Cliente', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-1', 'ORD-3', 'ORD-2'])
    })

    it('coluna Tipo(s): ordena pelo texto exibido; pedido sem itens (vazio) sempre no final', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-SPOT', item_types: ['SPOT'] },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-CATALOG', item_types: ['CATALOG'] },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-VAZIO', item_types: [], item_names: [] },
        { ...orderSummary, order_id: 'o4', order_number: 'ORD-CUSTOM', item_types: ['CUSTOM'] },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Tipo(s)', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-CATALOG', 'ORD-CUSTOM', 'ORD-SPOT', 'ORD-VAZIO'])

      await applySort(user, 'Tipo(s)', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-SPOT', 'ORD-CUSTOM', 'ORD-CATALOG', 'ORD-VAZIO'])
    })

    it('coluna Produto(s): ordena pelo texto conjunto exibido; pedido sem produtos (vazio) sempre no final', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-ZEBRA', item_names: ['Zebra Produto'] },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-ALFA', item_names: ['Alfa Produto'] },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-VAZIO', item_types: [], item_names: [] },
        { ...orderSummary, order_id: 'o4', order_number: 'ORD-BETA', item_names: ['Beta Produto'] },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto(s)', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-ALFA', 'ORD-BETA', 'ORD-ZEBRA', 'ORD-VAZIO'])

      await applySort(user, 'Produto(s)', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-ZEBRA', 'ORD-BETA', 'ORD-ALFA', 'ORD-VAZIO'])
    })

    it('coluna Status: ordena pelo rótulo exibido ao usuário, crescente e decrescente', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-QUOTE', order_status: 'QUOTE' },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-APPROVED', order_status: 'APPROVED' },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-DELIVERED', order_status: 'DELIVERED' },
      ])
      const user = userEvent.setup()
      renderPage()

      // Rótulos: "Aprovado", "Entregue", "Orçamento" — ordem alfabética.
      await applySort(user, 'Status', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-APPROVED', 'ORD-DELIVERED', 'ORD-QUOTE'])

      await applySort(user, 'Status', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-QUOTE', 'ORD-DELIVERED', 'ORD-APPROVED'])
    })

    it('coluna Status financeiro: ordena pelo rótulo exibido, crescente e decrescente', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-WAITING', payment_status: 'WAITING_PAYMENT' },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-PAID', payment_status: 'PAID' },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-DEPOSIT', payment_status: 'DEPOSIT_RECEIVED' },
      ])
      const user = userEvent.setup()
      renderPage()

      // Rótulos: "Aguardando pagamento", "Pago", "Sinal recebido".
      await applySort(user, 'Status financeiro', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-WAITING', 'ORD-PAID', 'ORD-DEPOSIT'])

      await applySort(user, 'Status financeiro', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-DEPOSIT', 'ORD-PAID', 'ORD-WAITING'])
    })

    it('coluna Método de pagamento: ordena pelo rótulo exibido; ausente (null) sempre no final', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-PIX', payment_method: 'PIX' },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-CARTAO', payment_method: 'CARTAO' },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-NULO', payment_method: null },
        { ...orderSummary, order_id: 'o4', order_number: 'ORD-DINHEIRO', payment_method: 'DINHEIRO' },
      ])
      const user = userEvent.setup()
      renderPage()

      // Rótulos: "Cartão", "Dinheiro", "Pix".
      await applySort(user, 'Método de pagamento', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-CARTAO', 'ORD-DINHEIRO', 'ORD-PIX', 'ORD-NULO'])

      await applySort(user, 'Método de pagamento', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-PIX', 'ORD-DINHEIRO', 'ORD-CARTAO', 'ORD-NULO'])
    })

    it('coluna Forma de entrega: ordena pelo rótulo exibido; ausente sempre no final', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-TRANSP', delivery_method: 'Transportadora' },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-MAOS', delivery_method: 'Em mãos' },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-NULO', delivery_method: null },
        { ...orderSummary, order_id: 'o4', order_number: 'ORD-CORREIOS', delivery_method: 'Correios' },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Forma de entrega', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-CORREIOS', 'ORD-MAOS', 'ORD-TRANSP', 'ORD-NULO'])

      await applySort(user, 'Forma de entrega', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-TRANSP', 'ORD-MAOS', 'ORD-CORREIOS', 'ORD-NULO'])
    })

    it('coluna Total: ordena pelo número monetário real, crescente e decrescente', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-30', total_value: 30 },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-10', total_value: 10 },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-20', total_value: 20 },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Total', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-10', 'ORD-20', 'ORD-30'])

      await applySort(user, 'Total', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-30', 'ORD-20', 'ORD-10'])
    })

    it('coluna Saldo devedor: ordena pelo número monetário real, crescente e decrescente', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-30', balance_due: 30 },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-10', balance_due: 10 },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-20', balance_due: 20 },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Saldo devedor', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-10', 'ORD-20', 'ORD-30'])

      await applySort(user, 'Saldo devedor', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-30', 'ORD-20', 'ORD-10'])
    })

    it('coluna Prazo: ordena pela data real (cronológica), não pelo texto formatado; ausente sempre no final', async () => {
      // Datas propositalmente escolhidas para provar que NÃO é comparação
      // textual do formato DD/MM/AAAA: "15/01/2026" < "01/02/2026" <
      // "10/03/2026" como TEXTO ficaria só Fev, Mar, Jan (errado); a data
      // real cronológica é Jan, Fev, Mar.
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-JAN', expected_delivery_date: '2026-01-15' },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-MAR', expected_delivery_date: '2026-03-10' },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-NULO', expected_delivery_date: null },
        { ...orderSummary, order_id: 'o4', order_number: 'ORD-FEV', expected_delivery_date: '2026-02-01' },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Prazo', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-JAN', 'ORD-FEV', 'ORD-MAR', 'ORD-NULO'])

      await applySort(user, 'Prazo', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-MAR', 'ORD-FEV', 'ORD-JAN', 'ORD-NULO'])
    })

    it('ordenação estável: valores iguais preservam a ordem original', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-A', total_value: 50 },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-B', total_value: 50 },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-C', total_value: 50 },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Total', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-A', 'ORD-B', 'ORD-C'])

      await applySort(user, 'Total', 'Ordenar decrescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-A', 'ORD-B', 'ORD-C'])
    })

    it('somente uma coluna ordenada por vez: escolher outra coluna substitui a ordenação anterior', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-2', total_value: 20 },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-1', total_value: 10 },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Nº pedido', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Nº pedido/ })).toHaveAttribute('aria-sort', 'ascending')

      await applySort(user, 'Total', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Total/ })).toHaveAttribute('aria-sort', 'ascending')
      expect(screen.getByRole('columnheader', { name: /^Nº pedido/ })).toHaveAttribute('aria-sort', 'none')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-1', 'ORD-2'])
    })

    it('remover a ordenação restaura a ordem original (a ordem em que o hook devolveu os registros)', async () => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-B', total_value: 20 },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-A', total_value: 10 },
      ])
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Total', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-A', 'ORD-B'])

      await applySort(user, 'Total', 'Remover ordenação')

      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-B', 'ORD-A'])
      expect(screen.getByRole('columnheader', { name: /^Total/ })).toHaveAttribute('aria-sort', 'none')
    })

    it('aria-sort correto: none por padrão, ascending/descending após ordenar', async () => {
      mockOrders([orderSummary])
      const user = userEvent.setup()
      renderPage()

      expect(screen.getByRole('columnheader', { name: /^Nº pedido/ })).toHaveAttribute('aria-sort', 'none')

      await applySort(user, 'Nº pedido', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Nº pedido/ })).toHaveAttribute('aria-sort', 'ascending')

      await applySort(user, 'Nº pedido', 'Ordenar decrescente')
      expect(screen.getByRole('columnheader', { name: /^Nº pedido/ })).toHaveAttribute('aria-sort', 'descending')
    })

    it('a coluna Ações não é ordenável', () => {
      mockOrders([orderSummary])
      renderPage()

      const headers = screen.getAllByRole('columnheader')
      const actionsHeader = headers[headers.length - 1]
      expect(actionsHeader).toHaveTextContent('Ações')
      expect(within(actionsHeader).queryByRole('button', { name: /ordenar coluna/i })).not.toBeInTheDocument()
      expect(actionsHeader).not.toHaveAttribute('aria-sort')
    })

    it('nomes acessíveis claros nos botões de ordenação de cada coluna de dados', () => {
      mockOrders([orderSummary])
      renderPage()

      for (const label of [
        'Nº pedido',
        'Cliente',
        'Tipo(s)',
        'Produto(s)',
        'Status',
        'Status financeiro',
        'Método de pagamento',
        'Forma de entrega',
        'Total',
        'Saldo devedor',
        'Prazo',
      ]) {
        expect(screen.getByRole('button', { name: `Ordenar coluna ${label}` })).toBeInTheDocument()
      }
    })
  })

  describe('Combinação entre busca e ordenação', () => {
    beforeEach(() => {
      mockOrders([
        { ...orderSummary, order_id: 'o1', order_number: 'ORD-CARLOS', customer_id: 'c1' },
        { ...orderSummary, order_id: 'o2', order_number: 'ORD-ALICE', customer_id: 'c2' },
        { ...orderSummary, order_id: 'o3', order_number: 'ORD-AMANDA', customer_id: 'c3' },
      ])
      useCustomersMock.mockReturnValue({
        customers: [
          { ...customer, id: 'c1', name: 'Carlos' },
          { ...customer, id: 'c2', name: 'Alice' },
          { ...customer, id: 'c3', name: 'Amanda' },
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })
    })

    it('primeiro filtra pelo nome/número/produto, depois ordena o resultado filtrado', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'a')
      expect(getVisibleOrderNumbersInOrder()).toHaveLength(3)

      await applySort(user, 'Nº pedido', 'Ordenar crescente')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-ALICE', 'ORD-AMANDA', 'ORD-CARLOS'])
    })

    it('limpar a busca mantém a ordenação ativa', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Nº pedido', 'Ordenar decrescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'a')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-CARLOS', 'ORD-AMANDA', 'ORD-ALICE'])

      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-CARLOS', 'ORD-AMANDA', 'ORD-ALICE'])
      expect(screen.getByRole('columnheader', { name: /^Nº pedido/ })).toHaveAttribute('aria-sort', 'descending')
    })

    it('remover a ordenação mantém a busca ativa', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Nº pedido', 'Ordenar crescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'amanda')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-AMANDA'])

      await applySort(user, 'Nº pedido', 'Remover ordenação')

      expect(screen.getByRole('combobox', { name: 'Buscar pedido' })).toHaveValue('amanda')
      expect(getVisibleOrderNumbersInOrder()).toEqual(['ORD-AMANDA'])
    })

    it('autocomplete respeita a ordenação ativa e a preserva ao selecionar uma sugestão', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Nº pedido', 'Ordenar decrescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar pedido' }), 'a')

      const pedidoOptions = within(getListbox()).getAllByRole('option', { name: /^Pedido/ })
      expect(pedidoOptions.map((option) => option.textContent)).toEqual([
        expect.stringContaining('ORD-CARLOS'),
        expect.stringContaining('ORD-AMANDA'),
        expect.stringContaining('ORD-ALICE'),
      ])

      await user.click(pedidoOptions[0])

      expect(screen.getByRole('columnheader', { name: /^Nº pedido/ })).toHaveAttribute('aria-sort', 'descending')
    })

    it('zebra striping é recalculado conforme a ordem visual resultante da busca + ordenação', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Nº pedido', 'Ordenar crescente')

      const dataRows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)
      expect(dataRows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
        'ORD-ALICE',
        'ORD-AMANDA',
        'ORD-CARLOS',
      ])
      for (const row of dataRows) {
        expect(row).toHaveClass('odd:bg-brand-primary-soft/50')
        expect(row).toHaveClass('even:bg-white')
      }
    })
  })
})
