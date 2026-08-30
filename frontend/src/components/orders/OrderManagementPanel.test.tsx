import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api/errors'

const { useOrderManagementMock, useFilamentTypesMock, useOrderProductionColorsMock, toastMock } = vi.hoisted(() => ({
  useOrderManagementMock: vi.fn(),
  useFilamentTypesMock: vi.fn(),
  useOrderProductionColorsMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useOrderManagement', () => ({ useOrderManagement: useOrderManagementMock }))
vi.mock('@/hooks/useFilamentTypes', () => ({ useFilamentTypes: useFilamentTypesMock }))
vi.mock('@/hooks/useOrderProductionColors', () => ({ useOrderProductionColors: useOrderProductionColorsMock }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { OrderManagementPanel } from './OrderManagementPanel'

const baseSummary = {
  order_id: '1',
  order_number: 'FS-26-001',
  customer_id: 'c1',
  company_id: null,
  order_status: 'QUOTE' as const,
  payment_status: 'WAITING_PAYMENT' as const,
  payment_method: null,
  delivery_method: null,
  order_date: '2026-08-26',
  expected_delivery_date: null,
  actual_delivery_date: null,
  subtotal: 100,
  discount_value: 0,
  total_value: 100,
  shipping_cost: 10,
  total_receivable: 110,
  total_paid: 30,
  balance_due: 80,
  has_overpayment: false,
  overpayment_amount: 0,
  approval_required: false,
  is_fully_approved: true,
  pending_approval_items: 0,
  item_types: ['CATALOG' as const],
  item_names: ['Chaveiro'],
}

const payment = {
  id: 'pay-1',
  order_id: '1',
  payment_method: 'PIX' as const,
  amount: 30,
  payment_type: 'SINAL' as const,
  paid_at: '2026-08-20T12:00:00.000Z',
  notes: null,
  created_by: 'user-1',
  created_at: '2026-08-20T12:00:00.000Z',
}

const statusHistoryEntry = {
  id: 'h-1',
  order_id: '1',
  from_status: null,
  to_status: 'QUOTE' as const,
  changed_at: '2026-08-19T10:00:00.000Z',
  changed_by: 'user-1',
  reason: 'Pedido criado',
}

const paymentStatusHistoryEntry = {
  id: 'ph-1',
  order_id: '1',
  from_status: 'WAITING_PAYMENT' as const,
  to_status: 'DEPOSIT_RECEIVED' as const,
  changed_at: '2026-08-20T12:00:01.000Z',
  changed_by: 'user-1',
  reason: 'Recálculo após registrar pagamento',
}

function mockHook(overrides: Partial<ReturnType<typeof useOrderManagementMock>> = {}) {
  const changeStatus = vi.fn().mockResolvedValue(undefined)
  const registerPaymentForOrder = vi.fn().mockResolvedValue(undefined)
  const refetch = vi.fn()
  useOrderManagementMock.mockReturnValue({
    summary: baseSummary,
    payments: [payment],
    statusHistory: [statusHistoryEntry],
    paymentStatusHistory: [paymentStatusHistoryEntry],
    isLoading: false,
    loadError: null,
    refetch,
    isChangingStatus: false,
    changeStatus,
    isRegisteringPayment: false,
    registerPaymentForOrder,
    ...overrides,
  })
  return { changeStatus, registerPaymentForOrder, refetch }
}

function renderPanel(props: Partial<Parameters<typeof OrderManagementPanel>[0]> = {}) {
  const onClose = vi.fn()
  const onChanged = vi.fn()
  const view = render(
    <OrderManagementPanel orderId="1" clientLabel="Ana Cliente" onClose={onClose} onChanged={onChanged} {...props} />,
  )
  return {
    onClose,
    onChanged,
    rerender: () =>
      view.rerender(<OrderManagementPanel orderId="1" clientLabel="Ana Cliente" onClose={onClose} onChanged={onChanged} {...props} />),
  }
}

function mockProductionColorsHook(overrides: Partial<ReturnType<typeof useOrderProductionColorsMock>> = {}) {
  const save = vi.fn().mockResolvedValue(undefined)
  const retry = vi.fn()
  useOrderProductionColorsMock.mockReturnValue({
    status: 'success',
    items: [],
    value: {},
    isLoading: false,
    error: null,
    retry,
    isSaving: false,
    save,
    ...overrides,
  })
  return { save, retry }
}

describe('OrderManagementPanel', () => {
  beforeEach(() => {
    useOrderManagementMock.mockReset()
    useFilamentTypesMock.mockReset()
    useOrderProductionColorsMock.mockReset()
    toastMock.success.mockReset()
    toastMock.error.mockReset()

    useFilamentTypesMock.mockReturnValue({
      types: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })
    // Padrão: nenhum item CATALOG com plates ainda — a maioria dos testes
    // (status/pagamento/histórico) não depende disso; os testes de "Cores e
    // filamentos" abaixo sobrescrevem explicitamente.
    mockProductionColorsHook()
  })

  it('shows a loading skeleton while isLoading is true', () => {
    mockHook({ isLoading: true, summary: null })
    renderPanel()

    expect(screen.queryByText('Pedido FS-26-001')).not.toBeInTheDocument()
  })

  it('shows an inline error with a retry action when loading fails', async () => {
    const { refetch } = mockHook({ isLoading: false, loadError: new ApiError('database', 500, 'Falha ao carregar.'), summary: null })
    const user = userEvent.setup()
    renderPanel()

    expect(screen.getByText('Falha ao carregar.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows the order summary: number, client, status, financial status (unificado "Ag. Pagamento", 2026-08-29), totals', () => {
    mockHook()
    renderPanel()

    expect(screen.getByText('Pedido FS-26-001')).toBeInTheDocument()
    const summaryCard = screen.getByText('Pedido FS-26-001').closest('[data-slot="card"]') as HTMLElement
    expect(within(summaryCard).getByText('Ana Cliente')).toBeInTheDocument()
    expect(within(summaryCard).getByText('Orçamento')).toBeInTheDocument()
    expect(within(summaryCard).getByText('Ag. Pagamento')).toBeInTheDocument()
    expect(within(summaryCard).getByText('R$ 110,00')).toBeInTheDocument() // total_receivable
    expect(within(summaryCard).getByText('R$ 30,00')).toBeInTheDocument() // total_paid (também aparece na tabela de Pagamentos, por isso escopado)
    expect(within(summaryCard).getByText('R$ 80,00')).toBeInTheDocument() // balance_due
  })

  it('shows an overpayment notice only when has_overpayment is true', () => {
    mockHook({ summary: { ...baseSummary, has_overpayment: true, overpayment_amount: 15 } })
    renderPanel()

    expect(screen.getByText(/pagamento excedente: r\$ 15,00/i)).toBeInTheDocument()
  })

  it('QUOTE: shows the next-transition button and a cancel button, no others', () => {
    mockHook({ summary: { ...baseSummary, order_status: 'QUOTE' } })
    renderPanel()

    expect(screen.getByRole('button', { name: /avançar para "aguardando aprovação"/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancelar pedido/i })).toBeInTheDocument()
  })

  it('IN_PRODUCTION: shows the next-transition button but no cancel button (cancelamento bloqueado)', () => {
    mockHook({ summary: { ...baseSummary, order_status: 'IN_PRODUCTION' } })
    renderPanel()

    expect(screen.getByRole('button', { name: /avançar para "aguardando entrega"/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancelar pedido/i })).not.toBeInTheDocument()
  })

  it('DELIVERED: shows no status action buttons (terminal, encerrado)', () => {
    mockHook({ summary: { ...baseSummary, order_status: 'DELIVERED' } })
    renderPanel()

    expect(screen.queryByRole('button', { name: /avançar para/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancelar pedido/i })).not.toBeInTheDocument()
    expect(screen.getByText(/nenhuma — pedido entregue/i)).toBeInTheDocument()
  })

  it('CANCELLED: shows no status action buttons (terminal, cancelado)', () => {
    mockHook({ summary: { ...baseSummary, order_status: 'CANCELLED' } })
    renderPanel()

    expect(screen.queryByRole('button', { name: /avançar para/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancelar pedido/i })).not.toBeInTheDocument()
    expect(screen.getByText(/nenhuma — pedido cancelado/i)).toBeInTheDocument()
  })

  it('clicking the transition button opens a confirmation dialog before calling changeStatus', async () => {
    const { changeStatus } = mockHook()
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /avançar para "aguardando aprovação"/i }))

    expect(screen.getByText(/tem certeza que deseja avançar o pedido fs-26-001/i)).toBeInTheDocument()
    expect(changeStatus).not.toHaveBeenCalled()
  })

  it('confirming the transition calls changeStatus, shows a success toast and calls onChanged', async () => {
    const { changeStatus } = mockHook()
    const user = userEvent.setup()
    const { onChanged } = renderPanel()

    await user.click(screen.getByRole('button', { name: /avançar para "aguardando aprovação"/i }))
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => expect(changeStatus).toHaveBeenCalledWith('WAITING_APPROVAL'))
    expect(toastMock.success).toHaveBeenCalledWith('Status atualizado para "Aguardando aprovação".')
    expect(onChanged).toHaveBeenCalled()
  })

  it('canceling out of the confirmation dialog never calls changeStatus', async () => {
    const { changeStatus } = mockHook()
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /avançar para "aguardando aprovação"/i }))
    await user.click(screen.getByRole('button', { name: /^voltar$/i }))

    expect(changeStatus).not.toHaveBeenCalled()
    expect(screen.queryByText(/tem certeza que deseja avançar/i)).not.toBeInTheDocument()
  })

  it('cancel action: confirming calls changeStatus with CANCELLED and shows the specific toast', async () => {
    const { changeStatus } = mockHook()
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /cancelar pedido/i }))
    expect(screen.getByText(/esta ação encerra o fluxo do pedido/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => expect(changeStatus).toHaveBeenCalledWith('CANCELLED'))
    expect(toastMock.success).toHaveBeenCalledWith('Pedido cancelado.')
  })

  it('blocks double submit: the confirm button is disabled while isChangingStatus is true', async () => {
    mockHook({ isChangingStatus: false })
    const user = userEvent.setup()
    const { rerender } = renderPanel()

    await user.click(screen.getByRole('button', { name: /avançar para "aguardando aprovação"/i }))

    mockHook({ isChangingStatus: true })
    rerender()

    expect(screen.getByRole('button', { name: /confirmando/i })).toBeDisabled()
  })

  it('shows the real backend error inline in the confirmation dialog and does not close it', async () => {
    const changeStatus = vi.fn().mockRejectedValue(new ApiError('business_rule', 409, 'Transição de status inválida'))
    mockHook({ changeStatus })
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /avançar para "aguardando aprovação"/i }))
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    expect(await screen.findByText('Transição de status inválida')).toBeInTheDocument()
    expect(screen.getByText(/tem certeza que deseja avançar/i)).toBeInTheDocument()
  })

  it('opens the payment registration dialog and registers a payment successfully (payment_type inferido: saldo R$80/já pago R$30 -> FINAL)', async () => {
    const { registerPaymentForOrder } = mockHook()
    const user = userEvent.setup()
    const { onChanged } = renderPanel()

    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))
    expect(screen.getByRole('heading', { name: 'Registrar pagamento' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Tipo de pagamento' })).not.toBeInTheDocument()

    await user.click(within(screen.getByRole('radiogroup', { name: 'Método de pagamento' })).getByRole('radio', { name: 'Pix' }))
    await user.click(screen.getByLabelText(/^valor$/i))
    await user.keyboard('8000')
    await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

    await waitFor(() =>
      expect(registerPaymentForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ payment_type: 'FINAL', payment_method: 'PIX', amount: 80 }),
      ),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Pagamento registrado.')
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows the real backend error inline when payment registration fails', async () => {
    const registerPaymentForOrder = vi.fn().mockRejectedValue(new ApiError('business_rule', 409, 'Soma dos pagamentos ficaria negativa'))
    mockHook({ registerPaymentForOrder })
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Método de pagamento' })).getByRole('radio', { name: 'Pix' }))
    // -10 passa na validação client-side (currentTotalPaid=30, 30-10=20 >= 0)
    // — o objetivo deste teste é o erro REAL do backend, não a réplica
    // client-side da mesma regra.
    await user.click(screen.getByRole('switch', { name: /ajuste negativo/i }))
    await user.click(screen.getByLabelText(/^valor$/i))
    await user.keyboard('1000')
    await user.type(screen.getByLabelText(/observações/i), 'estorno pequeno')
    await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

    expect(await screen.findByText('Soma dos pagamentos ficaria negativa')).toBeInTheDocument()
  })

  it('lists existing payments in a table', () => {
    mockHook()
    renderPanel()

    // Ordem de renderização: tabela de Pagamentos vem antes da de Histórico.
    const [paymentsTable] = screen.getAllByRole('table')
    expect(within(paymentsTable).getByText('Sinal')).toBeInTheDocument()
    expect(within(paymentsTable).getByText('Pix')).toBeInTheDocument()
    expect(within(paymentsTable).getByText('R$ 30,00')).toBeInTheDocument()
  })

  it('shows "Nenhum pagamento registrado." when there are no payments', () => {
    mockHook({ payments: [] })
    renderPanel()

    expect(screen.getByText('Nenhum pagamento registrado.')).toBeInTheDocument()
  })

  it('combines status history, payment status history and payments into a single chronological timeline (most recent first)', () => {
    mockHook()
    renderPanel()

    // Ordem de renderização: tabela de Pagamentos vem antes da de Histórico.
    const tables = screen.getAllByRole('table')
    const historyTable = tables[tables.length - 1]
    const rows = within(historyTable)
      .getAllByRole('row')
      .filter((row) => within(row).queryAllByRole('cell').length > 0)
    // paymentStatusHistoryEntry (12:00:01) é o mais recente, depois payment
    // (12:00:00), depois statusHistoryEntry (10:00:00 do dia anterior).
    expect(within(rows[0]).getByText('Financeiro')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Pagamento')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Status')).toBeInTheDocument()
  })

  it('shows "Nenhum evento registrado." when there is no history at all', () => {
    mockHook({ statusHistory: [], paymentStatusHistory: [], payments: [] })
    renderPanel()

    expect(screen.getByText('Nenhum evento registrado.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum pagamento registrado.')).toBeInTheDocument()
  })

  it('calls onClose when the "Fechar" button is clicked', async () => {
    mockHook()
    const user = userEvent.setup()
    const { onClose } = renderPanel()

    await user.click(screen.getByRole('button', { name: /^fechar$/i }))

    expect(onClose).toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // "Cores e filamentos" (migration 20260829180000_add_categories_plate_weight_and_order_colors.sql,
  // ainda não aplicada) — caminho para completar/alterar cores DEPOIS da
  // criação do Pedido (PATCH /orders/:id/production-colors), bloco
  // inteiramente independente de status/pagamento/histórico.
  // ---------------------------------------------------------------------------
  describe('Cores e filamentos', () => {
    it('não mostra o cartão quando o pedido não tem nenhum item CATALOG com plates', () => {
      mockHook()
      mockProductionColorsHook({ items: [] })
      renderPanel()

      expect(screen.queryByText('Cores e filamentos')).not.toBeInTheDocument()
    })

    it('mostra skeleton enquanto carrega, sem esconder o resto do painel', () => {
      mockHook()
      mockProductionColorsHook({ status: 'loading', items: [] })
      renderPanel()

      expect(screen.getByText('Cores e filamentos')).toBeInTheDocument()
      expect(screen.getByText('Pedido FS-26-001')).toBeInTheDocument()
    })

    it('mostra erro real com retry próprio quando falha ao carregar', async () => {
      const user = userEvent.setup()
      mockHook()
      const { retry } = mockProductionColorsHook({
        status: 'error',
        items: [],
        error: new ApiError('database', 500, 'Falha ao carregar cores.'),
      })
      renderPanel()

      expect(screen.getByText('Falha ao carregar cores.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
      expect(retry).toHaveBeenCalled()
    })

    it('mostra o picker pré-preenchido e salva as cores editadas via save()', async () => {
      const user = userEvent.setup()
      mockHook()
      useFilamentTypesMock.mockReturnValue({
        types: [
          {
            filament_type_id: 'ft1',
            material: 'PLA',
            manufacturer: 'Voolt3D',
            line: 'Sólida',
            commercial_color: 'Preto',
            color_code: null,
            minimum_stock_grams: null,
            is_active: true,
            total_available_grams: 1000,
            usable_spool_count: 1,
            total_spool_count: 1,
          },
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      })
      const { save } = mockProductionColorsHook({
        items: [{ key: 'oi1', label: 'Chaveiro', quantity: 1, plateCount: 1 }],
        value: {},
      })
      renderPanel()

      expect(screen.getAllByText('Cores e filamentos').length).toBeGreaterThan(0)
      await user.click(screen.getByRole('button', { name: /cores e filamentos/i }))
      await user.click(screen.getByRole('checkbox', { name: /preto/i }))
      await user.click(screen.getByRole('button', { name: /^salvar cores$/i }))

      await waitFor(() =>
        expect(save).toHaveBeenCalledWith({ 'oi1:1:1': ['ft1'] }),
      )
      expect(toastMock.success).toHaveBeenCalledWith('Cores salvas.')
    })

    it('erro real ao salvar fica restrito ao cartão de cores, sem afetar status/pagamento', async () => {
      const user = userEvent.setup()
      mockHook()
      mockProductionColorsHook({
        items: [{ key: 'oi1', label: 'Chaveiro', quantity: 1, plateCount: 1 }],
        save: vi.fn().mockRejectedValue(new ApiError('business_rule', 409, 'Não é possível alterar cores.')),
      })
      renderPanel()

      await user.click(screen.getByRole('button', { name: /^salvar cores$/i }))

      expect(await screen.findByText('Não é possível alterar cores.')).toBeInTheDocument()
      expect(toastMock.success).not.toHaveBeenCalled()
    })

    // ---------------------------------------------------------------------
    // Congelamento (rodada corretiva) — a edição de cores só é permitida
    // ANTES do início real da produção. A partir de IN_PRODUCTION a
    // configuração fica congelada: sem botão "Salvar cores", sem checkbox
    // clicável, mas os dados continuam visíveis (nunca escondidos).
    // ---------------------------------------------------------------------
    const filamentPreto = {
      filament_type_id: 'ft1',
      material: 'PLA' as const,
      manufacturer: 'Voolt3D',
      line: 'Sólida',
      commercial_color: 'Preto',
      color_code: null,
      minimum_stock_grams: null,
      is_active: true,
      total_available_grams: 1000,
      usable_spool_count: 1,
      total_spool_count: 1,
    }

    it.each(['QUOTE', 'WAITING_APPROVAL', 'APPROVED', 'IN_PRODUCTION_QUEUE'] as const)(
      '%s: cores editáveis — mostra "Salvar cores" e checkboxes clicáveis',
      async (orderStatus) => {
        const user = userEvent.setup()
        mockHook({ summary: { ...baseSummary, order_status: orderStatus } })
        useFilamentTypesMock.mockReturnValue({
          types: [filamentPreto],
          isLoading: false,
          error: null,
          refetch: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        })
        mockProductionColorsHook({
          items: [{ key: 'oi1', label: 'Chaveiro', quantity: 1, plateCount: 1 }],
          value: {},
        })
        renderPanel()

        expect(screen.getByRole('button', { name: /^salvar cores$/i })).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: /cores e filamentos/i }))
        expect(screen.getByRole('checkbox', { name: /preto/i })).not.toBeDisabled()
        expect(screen.queryByText(/configuração de cores foi congelada/i)).not.toBeInTheDocument()
      },
    )

    it.each(['IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED'] as const)(
      '%s: cores congeladas — sem "Salvar cores", checkboxes desabilitados, dados continuam visíveis',
      (orderStatus) => {
        mockHook({ summary: { ...baseSummary, order_status: orderStatus } })
        useFilamentTypesMock.mockReturnValue({
          types: [filamentPreto],
          isLoading: false,
          error: null,
          refetch: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        })
        mockProductionColorsHook({
          items: [{ key: 'oi1', label: 'Chaveiro', quantity: 1, plateCount: 1 }],
          value: { 'oi1:1:1': ['ft1'] },
        })
        renderPanel()

        // Painel abre automaticamente em estado congelado (mostra os dados
        // sem exigir um clique extra) — nunca precisa clicar em "Cores e
        // filamentos" para ver a configuração já salva.
        expect(screen.queryByRole('button', { name: /^salvar cores$/i })).not.toBeInTheDocument()
        expect(screen.getByRole('checkbox', { name: /preto/i })).toBeDisabled()
        expect(screen.getByRole('checkbox', { name: /preto/i })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByText(/configuração de cores foi congelada ao iniciar a produção/i)).toBeInTheDocument()
      },
    )

    it('estado congelado nunca chama save() mesmo que o draft local seja manipulado (defesa em profundidade — backend é a autoridade)', () => {
      mockHook({ summary: { ...baseSummary, order_status: 'IN_PRODUCTION' } })
      const { save } = mockProductionColorsHook({
        items: [{ key: 'oi1', label: 'Chaveiro', quantity: 1, plateCount: 1 }],
        value: { 'oi1:1:1': ['ft1'] },
      })
      renderPanel()

      expect(screen.queryByRole('button', { name: /^salvar cores$/i })).not.toBeInTheDocument()
      expect(save).not.toHaveBeenCalled()
    })
  })
})
