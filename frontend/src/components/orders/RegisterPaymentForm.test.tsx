import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegisterPaymentForm } from './RegisterPaymentForm'

function renderForm(overrides: Partial<Parameters<typeof RegisterPaymentForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <RegisterPaymentForm
      currentTotalPaid={0}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onCancel }
}

async function selectOption(user: ReturnType<typeof userEvent.setup>, comboboxName: string, optionName: string) {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

describe('RegisterPaymentForm', () => {
  it('renders the expected fields', () => {
    renderForm()

    expect(screen.getByLabelText(/tipo de pagamento/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/método de pagamento/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/valor \(r\$\)/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/data do pagamento/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/observações/i)).toBeInTheDocument()
  })

  it('prefills the payment date with today', () => {
    renderForm()

    const today = new Date().toISOString().slice(0, 10)
    expect(screen.getByLabelText(/data do pagamento/i)).toHaveValue(today)
  })

  it('blocks submit and shows errors when nothing is filled', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(await screen.findByText('Selecione o tipo de pagamento.')).toBeInTheDocument()
    expect(screen.getByText('Selecione o método de pagamento.')).toBeInTheDocument()
    expect(screen.getByText(/informe o valor/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a valid SINAL payment with the exact payload', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await selectOption(user, 'Tipo de pagamento', 'Sinal')
    await selectOption(user, 'Método de pagamento', 'Pix')
    await user.type(screen.getByLabelText(/valor \(r\$\)/i), '150,50')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      payment_type: 'SINAL',
      payment_method: 'PIX',
      amount: 150.5,
      paid_at: new Date().toISOString().slice(0, 10),
      notes: null,
    })
  })

  it('rejects a negative amount when payment_type is not AJUSTE', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await selectOption(user, 'Tipo de pagamento', 'Sinal')
    await selectOption(user, 'Método de pagamento', 'Pix')
    await user.type(screen.getByLabelText(/valor \(r\$\)/i), '-50')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(
      await screen.findByText('O valor deve ser maior que zero (só Ajuste aceita valor negativo).'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects amount zero', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await selectOption(user, 'Tipo de pagamento', 'Integral')
    await selectOption(user, 'Método de pagamento', 'Dinheiro')
    await user.type(screen.getByLabelText(/valor \(r\$\)/i), '0')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(await screen.findByText('O valor não pode ser zero.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('AJUSTE negativo exige observação', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentTotalPaid: 100 })

    await selectOption(user, 'Tipo de pagamento', 'Ajuste')
    await selectOption(user, 'Método de pagamento', 'Pix')
    await user.type(screen.getByLabelText(/valor \(r\$\)/i), '-20')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(await screen.findByText('Observação é obrigatória para um ajuste negativo.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('AJUSTE negativo com observação é aceito e enviado', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentTotalPaid: 100 })

    await selectOption(user, 'Tipo de pagamento', 'Ajuste')
    await selectOption(user, 'Método de pagamento', 'Pix')
    await user.type(screen.getByLabelText(/valor \(r\$\)/i), '-20')
    await user.type(screen.getByLabelText(/observações/i), 'Estorno parcial combinado com o cliente')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ payment_type: 'AJUSTE', amount: -20, notes: 'Estorno parcial combinado com o cliente' }),
    )
  })

  it('bloqueia um ajuste negativo que deixaria a soma dos pagamentos negativa', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentTotalPaid: 10 })

    await selectOption(user, 'Tipo de pagamento', 'Ajuste')
    await selectOption(user, 'Método de pagamento', 'Pix')
    await user.type(screen.getByLabelText(/valor \(r\$\)/i), '-20')
    await user.type(screen.getByLabelText(/observações/i), 'Estorno')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(
      await screen.findByText('Este ajuste deixaria a soma dos pagamentos do pedido negativa.'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('aceita vírgula ou ponto como separador decimal', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await selectOption(user, 'Tipo de pagamento', 'Final')
    await selectOption(user, 'Método de pagamento', 'Cartão')
    await user.type(screen.getByLabelText(/valor \(r\$\)/i), '99.90')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 99.9 }))
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('disables all fields and shows the loading label while submitting', () => {
    renderForm({ isSubmitting: true })

    expect(screen.getByRole('combobox', { name: 'Tipo de pagamento' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Método de pagamento' })).toBeDisabled()
    expect(screen.getByLabelText(/valor \(r\$\)/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /registrando/i })).toBeDisabled()
  })

  it('shows the submitError message inline', () => {
    renderForm({ submitError: 'Soma dos pagamentos ficaria negativa.' })

    expect(screen.getByText('Soma dos pagamentos ficaria negativa.')).toBeInTheDocument()
  })
})
