import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api/errors'
import { formatCentsToBRL } from '@/lib/forms/currencyField'

const { registerPaymentMock, toastMock } = vi.hoisted(() => ({
  registerPaymentMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/api/payments', () => ({ registerPayment: registerPaymentMock }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { OrderPaymentStatusControl } from './OrderPaymentStatusControl'
import type { PaymentStatus } from '@/types/domain'

function renderControl(
  overrides: Partial<{
    paymentStatus: PaymentStatus
    orderTotal: number
    totalPaid: number
    balanceDue: number
  }> = {},
  onChanged: () => void = vi.fn(),
) {
  render(
    <OrderPaymentStatusControl
      orderId="o1"
      orderNumber="FS-26-001"
      paymentStatus="WAITING_PAYMENT"
      orderTotal={500}
      totalPaid={0}
      balanceDue={500}
      onChanged={onChanged}
      {...overrides}
    />,
  )
  return onChanged
}

async function fillMinimalPayment(user: ReturnType<typeof userEvent.setup>, amountDigits: string) {
  await user.click(screen.getByRole('radio', { name: 'Sinal' }))
  await user.click(screen.getByRole('radio', { name: 'Pix' }))
  await user.click(screen.getByLabelText(/^valor$/i))
  await user.keyboard(amountDigits)
}

describe('OrderPaymentStatusControl', () => {
  beforeEach(() => {
    registerPaymentMock.mockReset().mockResolvedValue({ id: 'pay-1' })
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it.each([
    ['WAITING_PAYMENT', 'Aguardando pagamento'],
    ['DEPOSIT_RECEIVED', 'Sinal recebido'],
    ['PAID', 'Pago'],
  ] as const)('renders the current payment_status label (%s -> %s), preserving the existing text', (status, label) => {
    renderControl({ paymentStatus: status })

    expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toHaveTextContent(label)
  })

  it('has an accessible name including the current financial status', () => {
    renderControl({ paymentStatus: 'DEPOSIT_RECEIVED' })

    expect(
      screen.getByRole('button', { name: 'Registrar pagamento — status financeiro: Sinal recebido' }),
    ).toBeInTheDocument()
  })

  it('shows a discreet tooltip/title indicating the badge is actionable', () => {
    renderControl()

    expect(screen.getByRole('button', { name: /status financeiro/i })).toHaveAttribute(
      'title',
      'Clique para registrar um pagamento',
    )
  })

  it('clicking the badge opens the RegisterPaymentForm dialog', async () => {
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))

    expect(screen.getByRole('heading', { name: 'Registrar pagamento' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Tipo de pagamento' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Método de pagamento' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^valor$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/data do pagamento/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/observações/i)).toBeInTheDocument()
  })

  it('opens via keyboard (focus + Enter)', async () => {
    const user = userEvent.setup()
    renderControl()

    const trigger = screen.getByRole('button', { name: /status financeiro/i })
    trigger.focus()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('heading', { name: 'Registrar pagamento' })).toBeInTheDocument()
  })

  it('passes the correct totals (Total do pedido/Já pago/Saldo devedor) down to the form', async () => {
    const user = userEvent.setup()
    renderControl({ orderTotal: 800, totalPaid: 300, balanceDue: 500 })

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))

    expect(screen.getByText('R$ 800,00')).toBeInTheDocument()
    expect(screen.getByText('R$ 300,00')).toBeInTheDocument()
    expect(screen.getByText('R$ 500,00')).toBeInTheDocument()
  })

  it('registers a partial (SINAL) payment: calls registerPayment with order_id injected, closes the dialog and calls onChanged', async () => {
    const user = userEvent.setup()
    const onChanged = renderControl({ paymentStatus: 'WAITING_PAYMENT' })

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))
    await fillMinimalPayment(user, '10000')
    await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

    await waitFor(() =>
      expect(registerPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({ order_id: 'o1', payment_type: 'SINAL', payment_method: 'PIX', amount: 100 }),
      ),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Pagamento registrado.')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Registrar pagamento' })).not.toBeInTheDocument())
    expect(onChanged).toHaveBeenCalled()
  })

  it('registers an INTEGRAL payment for the full balance due', async () => {
    const user = userEvent.setup()
    const onChanged = renderControl({ balanceDue: 500 })

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))
    await user.click(screen.getByRole('radio', { name: 'Integral' }))
    await user.click(screen.getByRole('radio', { name: 'Cartão' }))
    await user.click(screen.getByLabelText(/^valor$/i))
    await user.keyboard('50000')
    await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

    await waitFor(() =>
      expect(registerPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({ order_id: 'o1', payment_type: 'INTEGRAL', payment_method: 'CARTAO', amount: 500 }),
      ),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('bloqueia um pagamento acima do saldo devedor (excedente) — regra confirmada em 2026-08-26, sem estar mais permitida', async () => {
    const user = userEvent.setup()
    const onChanged = renderControl({ balanceDue: 100 })

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))
    await user.click(screen.getByRole('radio', { name: 'Integral' }))
    await user.click(screen.getByRole('radio', { name: 'Pix' }))
    await user.click(screen.getByLabelText(/^valor$/i))
    await user.keyboard('20000')
    await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

    expect(
      await screen.findByText('O valor não pode ultrapassar o saldo devedor. Valor máximo permitido: R$ 100,00.'),
    ).toBeInTheDocument()
    expect(registerPaymentMock).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('quando o saldo devedor é zero, o formulário de registro fica desabilitado (pedido totalmente pago)', async () => {
    const user = userEvent.setup()
    renderControl({ balanceDue: 0, totalPaid: 500 })

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))

    expect(screen.getByText(/já está totalmente pago/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^registrar pagamento$/i })).not.toBeInTheDocument()
  })

  it('pedido totalmente pago: a listagem continua mostrando o badge "Pago" e o controle não permite novo pagamento', async () => {
    const user = userEvent.setup()
    renderControl({ paymentStatus: 'PAID', balanceDue: 0, totalPaid: 500, orderTotal: 500 })

    // O badge da listagem continua mostrando "Pago" — nunca some nem vira
    // outro texto por causa do bloqueio de excedente.
    expect(screen.getByRole('button', { name: /status financeiro: pago/i })).toHaveTextContent('Pago')

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))
    expect(screen.getByText(/já está totalmente pago/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^registrar pagamento$/i })).not.toBeInTheDocument()
  })

  it('AJUSTE negativo segue as regras já existentes do RegisterPaymentForm (exige observação)', async () => {
    const user = userEvent.setup()
    renderControl({ totalPaid: 100 })

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))
    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    await user.click(screen.getByRole('radio', { name: 'Pix' }))
    await user.click(screen.getByRole('switch', { name: /ajuste negativo/i }))
    await user.click(screen.getByLabelText(/^valor$/i))
    await user.keyboard('2000')
    await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

    expect(await screen.findByText('Observação é obrigatória para um ajuste negativo.')).toBeInTheDocument()
    expect(registerPaymentMock).not.toHaveBeenCalled()
  })

  it('shows the real backend error and keeps the dialog open, preserving the filled data', async () => {
    registerPaymentMock.mockRejectedValue(new ApiError('business_rule', 409, 'Soma dos pagamentos ficaria negativa'))
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))
    await fillMinimalPayment(user, '5000')
    await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

    expect(await screen.findByText('Soma dos pagamentos ficaria negativa')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Registrar pagamento' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^valor$/i)).toHaveValue(formatCentsToBRL(5000))
  })

  it('blocks double submit: the submit button is disabled while the request is in flight', async () => {
    let resolvePromise: (value: { id: string }) => void = () => {}
    registerPaymentMock.mockReturnValue(
      new Promise<{ id: string }>((resolve) => {
        resolvePromise = resolve
      }),
    )
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))
    await fillMinimalPayment(user, '5000')
    await user.click(screen.getByRole('button', { name: /^registrar pagamento$/i }))

    expect(screen.getByRole('button', { name: /registrando/i })).toBeDisabled()
    expect(registerPaymentMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolvePromise({ id: 'pay-1' })
      await Promise.resolve()
    })
  })

  it('CANCELLED: o backend não bloqueia pagamentos (register_payment não verifica order_status), o controle continua clicável', async () => {
    const user = userEvent.setup()
    // payment_status não depende de order_status — um pedido CANCELLED pode
    // ter qualquer payment_status. Testado aqui só para confirmar que este
    // componente não recebe nem usa order_status para decidir se bloqueia.
    renderControl({ paymentStatus: 'WAITING_PAYMENT' })

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))

    expect(screen.getByRole('heading', { name: 'Registrar pagamento' })).toBeInTheDocument()
  })

  it('cancelling the dialog does not call registerPayment nor onChanged', async () => {
    const user = userEvent.setup()
    const onChanged = renderControl()

    await user.click(screen.getByRole('button', { name: /status financeiro/i }))
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))

    expect(screen.queryByRole('heading', { name: 'Registrar pagamento' })).not.toBeInTheDocument()
    expect(registerPaymentMock).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
