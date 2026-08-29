import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrderEditForm } from './OrderEditForm'
import { ApiError } from '@/lib/api/errors'
import type { Company, Customer, LeadSource, Product } from '@/types/domain'

const { getOrderMock, listOrderItemsMock } = vi.hoisted(() => ({
  getOrderMock: vi.fn(),
  listOrderItemsMock: vi.fn(),
}))

vi.mock('@/lib/api/orders', () => ({ getOrder: getOrderMock }))
vi.mock('@/lib/api/orderItems', () => ({ listOrderItems: listOrderItemsMock }))

const customers: Customer[] = [
  {
    id: 'c1',
    name: 'Ana Cliente',
    whatsapp: null,
    instagram: null,
    company_id: null,
    acquisition_source_id: null,
    notes: null,
    is_active: true,
    is_protected: false,
    created_at: '',
    updated_at: '',
  },
]

const companies: Company[] = [
  {
    id: 'e1',
    name: 'Empresa A',
    trade_name: null,
    document_number: null,
    whatsapp: null,
    instagram: null,
    notes: null,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
]

const leadSources: LeadSource[] = [{ id: 'l1', name: 'Instagram', is_active: true }]

const products: Product[] = [
  {
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
  },
]

const baseOrder = {
  id: 'o1',
  order_number: 'FS-26-001',
  customer_id: 'c1',
  company_id: null,
  lead_source_id: 'l1',
  order_status: 'QUOTE' as const,
  payment_status: 'WAITING_PAYMENT' as const,
  payment_method: 'PIX' as const,
  order_date: '2026-08-17',
  approval_date: null,
  expected_delivery_date: '2026-08-25',
  actual_delivery_date: null,
  delivery_method: 'Correios',
  shipping_cost: 15.5,
  discount_value: 0,
  subtotal: 50,
  total_value: 50,
  notes: 'Observação existente',
  created_at: '',
  updated_at: '',
}

const baseItem = {
  id: 'oi1',
  order_id: 'o1',
  item_type: 'CATALOG' as const,
  product_id: 'p1',
  item_name: 'Chaveiro',
  description: null,
  quantity: 2,
  unit_price: 25,
  personalization_fee: 0,
  discount_value: 0,
  total_price: 50,
  color_description: null,
  number_of_colors: null,
  customization_data: {},
  expected_delivery_date: null,
  notes: null,
  created_at: '',
  updated_at: '',
}

function renderForm(overrides: Partial<Parameters<typeof OrderEditForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <OrderEditForm
      orderId="o1"
      customers={customers}
      companies={companies}
      leadSources={leadSources}
      products={products}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onCancel }
}

async function waitForLoaded() {
  await screen.findByLabelText('Cliente/Contato')
}

describe('OrderEditForm', () => {
  beforeEach(() => {
    getOrderMock.mockReset().mockResolvedValue(baseOrder)
    listOrderItemsMock.mockReset().mockResolvedValue([baseItem])
  })

  it('mostra um estado de carregamento enquanto busca o pedido e os itens', () => {
    getOrderMock.mockReturnValue(new Promise(() => {}))
    listOrderItemsMock.mockReturnValue(new Promise(() => {}))
    renderForm()

    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Cliente/Contato')).not.toBeInTheDocument()
  })

  it('carrega o pedido (getOrder) e os itens (listOrderItems) do orderId recebido', async () => {
    renderForm()
    await waitForLoaded()

    expect(getOrderMock).toHaveBeenCalledWith('o1')
    expect(listOrderItemsMock).toHaveBeenCalledWith('o1')
  })

  it('é visualmente/estruturalmente o mesmo formulário de criação (OrderForm compartilhado): mesmas seções, mesma tabela de itens', async () => {
    renderForm()
    await waitForLoaded()

    expect(screen.getByRole('radiogroup', { name: 'Tipo de venda' })).toBeInTheDocument()
    expect(screen.getByLabelText('Cliente/Contato')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Entrou em contato por' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByLabelText('Produto')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantidade')).toBeInTheDocument()
    expect(screen.getByLabelText('Preço unitário')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Forma de entrega' })).toBeInTheDocument()
    expect(screen.getByLabelText('Método de pagamento')).toBeInTheDocument()
    expect(screen.getByLabelText('Prazo de entrega')).toBeInTheDocument()
    expect(screen.getByText(/total do pedido/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /salvar alterações/i })).toBeInTheDocument()
  })

  it('pré-preenche os dados do cabeçalho (B2C: cliente sem empresa)', async () => {
    renderForm()
    await waitForLoaded()

    expect(screen.getByRole('radio', { name: 'B2C' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByLabelText('Empresa')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Cliente/Contato' })).toHaveTextContent('Ana Cliente')
    expect(screen.getByRole('radio', { name: 'Pix' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Correios' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Frete')).toHaveValue('15.5')
    expect(screen.getByLabelText('Prazo de entrega')).toHaveValue('2026-08-25')
    expect(screen.getByLabelText('Observações')).toHaveValue('Observação existente')
  })

  it('pré-preenche B2B corretamente quando o pedido tem company_id', async () => {
    getOrderMock.mockResolvedValue({ ...baseOrder, company_id: 'e1' })
    renderForm()
    await waitForLoaded()

    expect(screen.getByRole('radio', { name: 'B2B' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('combobox', { name: 'Empresa' })).toHaveTextContent('Empresa A')
  })

  it('pré-preenche o item CATALOG (produto, quantidade, preço)', async () => {
    renderForm()
    await waitForLoaded()

    expect(screen.getByRole('combobox', { name: 'Produto' })).toHaveTextContent('Chaveiro')
    expect(screen.getByLabelText('Quantidade')).toHaveValue('2')
    expect(screen.getByLabelText('Preço unitário')).toHaveValue('25')
  })

  it('a edição preserva o produto CATALOG existente mesmo quando há produtos CUSTOM/SPOT reutilizáveis na lista', async () => {
    const productsWithReusables: Product[] = [
      ...products,
      {
        id: 'p2',
        name: 'Miniatura Personalizada Reutilizável',
        category: null,
        description: null,
        default_price: 60,
        product_type: 'CUSTOM',
        default_print_time_seconds: null,
        default_weight_grams: null,
        units_per_plate: null,
        default_file_id: null,
        allows_personalization: false,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'p3',
        name: 'Peça Spot Reutilizável',
        category: null,
        description: null,
        default_price: 15,
        product_type: 'SPOT',
        default_print_time_seconds: null,
        default_weight_grams: null,
        units_per_plate: null,
        default_file_id: null,
        allows_personalization: false,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]
    renderForm({ products: productsWithReusables })
    await waitForLoaded()

    expect(screen.getByRole('combobox', { name: 'Produto' })).toHaveTextContent('Chaveiro')
    expect(screen.getByLabelText('Quantidade')).toHaveValue('2')
    expect(screen.getByLabelText('Preço unitário')).toHaveValue('25')
  })

  it('o total inicial corresponde ao pedido carregado (quantidade × preço + frete)', async () => {
    renderForm()
    await waitForLoaded()

    // baseOrder tem delivery_method=Correios e shipping_cost=15.5: total do
    // rodapé = itens (50,00) + frete (15,50) = 65,50, mesma fórmula de
    // vw_order_summary.total_receivable.
    expect(screen.getByText('Total do pedido').closest('div')).toHaveTextContent('R$ 65,50')
  })

  it('"Alterar pedido" exibe o mesmo total destacado (fonte grande, peso forte, cor da paleta Forma) do formulário de criação', async () => {
    renderForm()
    await waitForLoaded()

    const footer = screen.getByText('Total do pedido').closest('div') as HTMLElement
    const valueEl = within(footer).getByText('R$ 65,50')
    expect(valueEl).toHaveClass('text-brand-primary-dark')
    expect(valueEl).toHaveClass('text-2xl')
    expect(valueEl).toHaveClass('font-bold')
  })

  it('alterar quantidade/preço recalcula a prévia do total imediatamente (incluindo o frete já preenchido)', async () => {
    const user = userEvent.setup()
    renderForm()
    await waitForLoaded()

    const quantityInput = screen.getByLabelText('Quantidade')
    await user.clear(quantityInput)
    await user.type(quantityInput, '3')

    expect(screen.getByText('Total do pedido').closest('div')).toHaveTextContent('R$ 90,50')
  })

  it('valor de método de pagamento previamente salvo aparece selecionado ao abrir "Alterar pedido"', async () => {
    getOrderMock.mockResolvedValue({ ...baseOrder, payment_method: 'CARTAO' })
    renderForm()
    await waitForLoaded()

    expect(screen.getByRole('radio', { name: 'Cartão' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Pix' })).toHaveAttribute('aria-checked', 'false')
  })

  it('adicionar item funciona no formulário de edição', async () => {
    const user = userEvent.setup()
    renderForm()
    await waitForLoaded()

    await user.click(screen.getByRole('button', { name: /adicionar item/i }))

    expect(screen.getAllByRole('combobox', { name: 'Produto' })).toHaveLength(2)
  })

  it('remover item mantém ao menos um', async () => {
    renderForm()
    await waitForLoaded()

    const removeButtons = screen.getAllByRole('button', { name: /remover item/i })
    expect(removeButtons[0]).toBeDisabled()
  })

  it('payload é enviado via onSubmit ao clicar em Salvar alterações, sem order_number/order_status/payment_status', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await waitForLoaded()

    await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const payload = onSubmit.mock.calls[0][0]
    expect(payload).not.toHaveProperty('order_number')
    expect(payload).not.toHaveProperty('order_status')
    expect(payload).not.toHaveProperty('payment_status')
    expect(payload.customer_id).toBe('c1')
    expect(payload.items).toEqual([
      expect.objectContaining({ item_type: 'CATALOG', product_id: 'p1', quantity: 2, unit_price: 25 }),
    ])
  })

  it('erro de carregamento mostra mensagem e um botão para fechar', async () => {
    getOrderMock.mockRejectedValue(new ApiError('not_found', 404, 'Pedido não encontrado.'))
    const { onCancel } = renderForm()

    expect(await screen.findByText('Pedido não encontrado.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /fechar/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('pedido fora de QUOTE fica somente leitura, sem botão "Salvar alterações", com mensagem clara', async () => {
    getOrderMock.mockResolvedValue({ ...baseOrder, order_status: 'APPROVED' })
    renderForm()
    await waitForLoaded()

    expect(screen.getByText(/está em "Aprovado"/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /salvar alterações/i })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Cliente/Contato' })).toBeDisabled()
  })

  it('pedido com item CUSTOM/SPOT fica somente leitura, sem botão "Salvar alterações", com mensagem clara', async () => {
    listOrderItemsMock.mockResolvedValue([{ ...baseItem, item_type: 'SPOT', product_id: null }])
    renderForm()
    await waitForLoaded()

    expect(screen.getByText(/Personalizado ou Spot/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /salvar alterações/i })).not.toBeInTheDocument()
  })

  it('pedido em QUOTE com só itens CATALOG permanece editável (sem mensagem de bloqueio)', async () => {
    renderForm()
    await waitForLoaded()

    expect(screen.queryByText(/não pode ser totalmente editado/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /salvar alterações/i })).toBeInTheDocument()
  })
})
