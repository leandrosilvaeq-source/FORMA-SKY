import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegisterPaymentForm } from './RegisterPaymentForm'
import { formatCentsToBRL } from '@/lib/forms/currencyField'

function renderForm(overrides: Partial<Parameters<typeof RegisterPaymentForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <RegisterPaymentForm
      orderTotal={500}
      balanceDue={500}
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

async function pickRadio(user: ReturnType<typeof userEvent.setup>, groupName: string, optionName: string): Promise<void> {
  const group = screen.getByRole('radiogroup', { name: groupName })
  await user.click(within(group).getByRole('radio', { name: optionName }))
}

const AMOUNT_LABEL = /^valor$/i

describe('RegisterPaymentForm', () => {
  it('renders the expected fields and groups', () => {
    renderForm()

    expect(screen.getByRole('radiogroup', { name: 'Tipo de pagamento' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Método de pagamento' })).toBeInTheDocument()
    expect(screen.getByLabelText(AMOUNT_LABEL)).toBeInTheDocument()
    expect(screen.getByLabelText(/data do pagamento/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/observações/i)).toBeInTheDocument()
  })

  it('mostra as 4 opções de Tipo de pagamento (Sinal/Final/Integral/Ajuste) como action buttons com ícone decorativo', () => {
    renderForm()

    const group = screen.getByRole('radiogroup', { name: 'Tipo de pagamento' })
    const options = within(group).getAllByRole('radio')
    expect(options.map((option) => option.textContent)).toEqual(['Sinal', 'Final', 'Integral', 'Ajuste'])
    for (const option of options) {
      expect(option.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
    }
  })

  it('mostra as 3 opções de Método de pagamento (Pix/Dinheiro/Cartão) reaproveitando os ícones de OrderForm, sem "Não informado"', () => {
    renderForm()

    const group = screen.getByRole('radiogroup', { name: 'Método de pagamento' })
    const options = within(group).getAllByRole('radio')
    expect(options.map((option) => option.textContent)).toEqual(['Pix', 'Dinheiro', 'Cartão'])
    expect(within(group).queryByRole('radio', { name: /não informado/i })).not.toBeInTheDocument()
    for (const option of options) {
      expect(option.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
    }
  })

  it('seleção exclusiva: escolher uma opção de Tipo de pagamento desmarca a anterior', async () => {
    const user = userEvent.setup()
    renderForm()

    await pickRadio(user, 'Tipo de pagamento', 'Sinal')
    expect(screen.getByRole('radio', { name: 'Sinal' })).toHaveAttribute('aria-checked', 'true')

    await pickRadio(user, 'Tipo de pagamento', 'Final')
    expect(screen.getByRole('radio', { name: 'Final' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Sinal' })).toHaveAttribute('aria-checked', 'false')
  })

  it('seleção exclusiva: escolher uma opção de Método de pagamento desmarca a anterior', async () => {
    const user = userEvent.setup()
    renderForm()

    await pickRadio(user, 'Método de pagamento', 'Pix')
    expect(screen.getByRole('radio', { name: 'Pix' })).toHaveAttribute('aria-checked', 'true')

    await pickRadio(user, 'Método de pagamento', 'Cartão')
    expect(screen.getByRole('radio', { name: 'Cartão' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Pix' })).toHaveAttribute('aria-checked', 'false')
  })

  it('prefills the payment date with today (relógio fixo, determinístico — nunca depende do horário real da máquina)', () => {
    // Achado real desta auditoria (2026-08-28): a asserção antiga comparava
    // a data LOCAL do componente (todayIsoDate() usa
    // getFullYear/getMonth/getDate, partes locais) contra
    // `new Date().toISOString()` (UTC) — diverge sempre que o horário local
    // já passou da meia-noite UTC mas ainda não virou o dia local (ex.:
    // America/Sao_Paulo, UTC-3, entre ~21h e 24h). Não é uma regressão de
    // produção: o componente sempre usou (corretamente) a data local, nunca
    // UTC, para um formulário de pagamento brasileiro — o teste é que
    // comparava contra o fuso errado. Corrigido fixando o relógio (só
    // `Date`, nunca os timers reais — userEvent não é usado aqui) num
    // instante em que local e UTC caem em dias diferentes, para nunca mais
    // regredir silenciosamente.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 28, 21, 30, 0))
    try {
      renderForm()
      expect(screen.getByLabelText(/data do pagamento/i)).toHaveValue('2026-08-28')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the highlighted financial summary (total, já pago, saldo devedor)', () => {
    renderForm({ orderTotal: 500, currentTotalPaid: 120, balanceDue: 380 })

    expect(screen.getByText('R$ 500,00')).toBeInTheDocument()
    expect(screen.getByText('R$ 120,00')).toBeInTheDocument()
    expect(screen.getByText('R$ 380,00')).toBeInTheDocument()
  })

  it('blocks submit and shows errors when nothing is filled', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(await screen.findByText('Selecione o tipo de pagamento.')).toBeInTheDocument()
    expect(screen.getByText('Selecione o método de pagamento.')).toBeInTheDocument()
    expect(screen.getByText('O valor não pode ser zero.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('digitar valores no campo Valor formata como moeda brasileira em tempo real (padrão bancário)', async () => {
    const user = userEvent.setup()
    renderForm()

    const amountInput = screen.getByLabelText(AMOUNT_LABEL)
    await user.click(amountInput)
    await user.keyboard('15050')

    expect(amountInput).toHaveValue(formatCentsToBRL(15050))
  })

  it('submits a valid SINAL payment with amount converted to number (never a formatted string), com relógio fixo determinístico', async () => {
    // Mesmo achado/correção da asserção "prefills the payment date with
    // today" acima: `paid_at` enviado pelo formulário vem de todayIsoDate()
    // (data LOCAL), e a asserção antiga comparava contra
    // `new Date().toISOString()` (UTC) — corrigido fixando só `Date` (nunca
    // os timers reais, para não interferir em userEvent) num instante em
    // que local e UTC caem em dias diferentes.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 28, 21, 30, 0))
    try {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await pickRadio(user, 'Tipo de pagamento', 'Sinal')
      await pickRadio(user, 'Método de pagamento', 'Pix')
      await user.click(screen.getByLabelText(AMOUNT_LABEL))
      await user.keyboard('15050')
      await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

      expect(onSubmit).toHaveBeenCalledWith({
        payment_type: 'SINAL',
        payment_method: 'PIX',
        amount: 150.5,
        paid_at: '2026-08-28',
        notes: null,
      })
      expect(typeof onSubmit.mock.calls[0][0].amount).toBe('number')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects amount zero mesmo com tipo e método selecionados', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await pickRadio(user, 'Tipo de pagamento', 'Integral')
    await pickRadio(user, 'Método de pagamento', 'Dinheiro')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(await screen.findByText('O valor não pode ser zero.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('o interruptor "Ajuste negativo" só aparece quando o Tipo de pagamento é Ajuste', async () => {
    const user = userEvent.setup()
    renderForm()

    expect(screen.queryByRole('switch', { name: /ajuste negativo/i })).not.toBeInTheDocument()

    await pickRadio(user, 'Tipo de pagamento', 'Sinal')
    expect(screen.queryByRole('switch', { name: /ajuste negativo/i })).not.toBeInTheDocument()

    await pickRadio(user, 'Tipo de pagamento', 'Ajuste')
    expect(screen.getByRole('switch', { name: /ajuste negativo/i })).toBeInTheDocument()
  })

  it('trocar de Ajuste para outro tipo desliga automaticamente o ajuste negativo', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await pickRadio(user, 'Tipo de pagamento', 'Ajuste')
    await user.click(screen.getByRole('switch', { name: /ajuste negativo/i }))
    expect(screen.getByRole('switch', { name: /ajuste negativo/i })).toHaveAttribute('aria-checked', 'true')

    await pickRadio(user, 'Tipo de pagamento', 'Sinal')
    await pickRadio(user, 'Método de pagamento', 'Pix')
    await user.click(screen.getByLabelText(AMOUNT_LABEL))
    await user.keyboard('5000')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 50 }))
  })

  it('AJUSTE negativo exige observação', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentTotalPaid: 100 })

    await pickRadio(user, 'Tipo de pagamento', 'Ajuste')
    await pickRadio(user, 'Método de pagamento', 'Pix')
    await user.click(screen.getByRole('switch', { name: /ajuste negativo/i }))
    await user.click(screen.getByLabelText(AMOUNT_LABEL))
    await user.keyboard('2000')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(await screen.findByText('Observação é obrigatória para um ajuste negativo.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('AJUSTE negativo (pagamento parcial estornado) com observação é aceito, convertido para number negativo', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentTotalPaid: 100 })

    await pickRadio(user, 'Tipo de pagamento', 'Ajuste')
    await pickRadio(user, 'Método de pagamento', 'Pix')
    await user.click(screen.getByRole('switch', { name: /ajuste negativo/i }))
    await user.click(screen.getByLabelText(AMOUNT_LABEL))
    await user.keyboard('2000')
    await user.type(screen.getByLabelText(/observações/i), 'Estorno parcial combinado com o cliente')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ payment_type: 'AJUSTE', amount: -20, notes: 'Estorno parcial combinado com o cliente' }),
    )
  })

  it('bloqueia um ajuste negativo que deixaria a soma dos pagamentos negativa', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentTotalPaid: 10 })

    await pickRadio(user, 'Tipo de pagamento', 'Ajuste')
    await pickRadio(user, 'Método de pagamento', 'Pix')
    await user.click(screen.getByRole('switch', { name: /ajuste negativo/i }))
    await user.click(screen.getByLabelText(AMOUNT_LABEL))
    await user.keyboard('2000')
    await user.type(screen.getByLabelText(/observações/i), 'Estorno')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(
      await screen.findByText('Este ajuste deixaria a soma dos pagamentos do pedido negativa.'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Backspace remove o último dígito do valor (estilo maquininha)', async () => {
    const user = userEvent.setup()
    renderForm()

    const amountInput = screen.getByLabelText(AMOUNT_LABEL)
    await user.click(amountInput)
    await user.keyboard('15050')
    expect(amountInput).toHaveValue(formatCentsToBRL(15050))

    await user.keyboard('{Backspace}')
    expect(amountInput).toHaveValue(formatCentsToBRL(1505))
  })

  it('colar um valor com vírgula decimal é interpretado corretamente', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await pickRadio(user, 'Tipo de pagamento', 'Final')
    await pickRadio(user, 'Método de pagamento', 'Cartão')
    const amountInput = screen.getByLabelText(AMOUNT_LABEL)
    await user.click(amountInput)
    await user.paste('99,90')
    await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 99.9 }))
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('disables all controls and shows the loading label while submitting', () => {
    renderForm({ isSubmitting: true })

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
    }
    expect(screen.getByLabelText(AMOUNT_LABEL)).toBeDisabled()
    expect(screen.getByRole('button', { name: /registrando/i })).toBeDisabled()
  })

  it('shows the submitError message inline', () => {
    renderForm({ submitError: 'Soma dos pagamentos ficaria negativa.' })

    expect(screen.getByText('Soma dos pagamentos ficaria negativa.')).toBeInTheDocument()
  })

  describe('Bloqueio de pagamento excedente (saldo devedor nunca pode ser ultrapassado)', () => {
    // Total do pedido R$ 100,00, já pago R$ 40,00, saldo devedor R$ 60,00 —
    // mesmo exemplo do enunciado da regra.
    const scenario = { orderTotal: 100, currentTotalPaid: 40, balanceDue: 60 }

    it('pagamento inferior ao saldo (R$ 50,00 de R$ 60,00) é aceito normalmente', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm(scenario)

      await pickRadio(user, 'Tipo de pagamento', 'Final')
      await pickRadio(user, 'Método de pagamento', 'Pix')
      await user.click(screen.getByLabelText(AMOUNT_LABEL))
      await user.keyboard('5000')
      await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 50 }))
    })

    it('pagamento exatamente igual ao saldo (R$ 60,00) é aceito', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm(scenario)

      await pickRadio(user, 'Tipo de pagamento', 'Final')
      await pickRadio(user, 'Método de pagamento', 'Pix')
      await user.click(screen.getByLabelText(AMOUNT_LABEL))
      await user.keyboard('6000')
      await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 60 }))
    })

    it('pagamento um centavo acima do saldo (R$ 60,01) é bloqueado com o valor máximo permitido na mensagem', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm(scenario)

      await pickRadio(user, 'Tipo de pagamento', 'Final')
      await pickRadio(user, 'Método de pagamento', 'Pix')
      await user.click(screen.getByLabelText(AMOUNT_LABEL))
      await user.keyboard('6001')
      await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

      expect(
        await screen.findByText('O valor não pode ultrapassar o saldo devedor. Valor máximo permitido: R$ 60,00.'),
      ).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('tentativa cuja soma ultrapassa muito o total também é bloqueada (não só por 1 centavo)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm(scenario)

      await pickRadio(user, 'Tipo de pagamento', 'Integral')
      await pickRadio(user, 'Método de pagamento', 'Cartão')
      await user.click(screen.getByLabelText(AMOUNT_LABEL))
      await user.keyboard('20000')
      await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

      expect(
        await screen.findByText('O valor não pode ultrapassar o saldo devedor. Valor máximo permitido: R$ 60,00.'),
      ).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('duas parcelas cuja soma completa exatamente o pedido: a segunda parcela (saldo restante) ainda é aceita', async () => {
      const user = userEvent.setup()
      // Primeira parcela de R$ 60,00 já registrada — simula o estado depois
      // do primeiro pagamento (currentTotalPaid/balanceDue atualizados,
      // mesma forma como a prop chegaria após refetch no app real).
      const { onSubmit } = renderForm({ orderTotal: 100, currentTotalPaid: 60, balanceDue: 40 })

      await pickRadio(user, 'Tipo de pagamento', 'Final')
      await pickRadio(user, 'Método de pagamento', 'Pix')
      await user.click(screen.getByLabelText(AMOUNT_LABEL))
      await user.keyboard('4000')
      await user.click(screen.getByRole('button', { name: /registrar pagamento/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 40 }))
    })

    it('pedido já totalmente pago (saldo devedor zero): o formulário de registro fica desabilitado', () => {
      renderForm({ orderTotal: 100, currentTotalPaid: 100, balanceDue: 0 })

      expect(screen.getByText(/já está totalmente pago/i)).toBeInTheDocument()
      expect(screen.queryByRole('radiogroup', { name: 'Tipo de pagamento' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText(AMOUNT_LABEL)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /registrar pagamento/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^fechar$/i })).toBeInTheDocument()
    })

    it('mesmo bloqueio se aplica a um saldo negativo residual (dado legado de excedente anterior à regra)', () => {
      renderForm({ orderTotal: 100, currentTotalPaid: 120, balanceDue: -20 })

      expect(screen.getByText(/já está totalmente pago/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /registrar pagamento/i })).not.toBeInTheDocument()
    })

    it('"Fechar" no estado totalmente pago chama onCancel', async () => {
      const user = userEvent.setup()
      const { onCancel } = renderForm({ orderTotal: 100, currentTotalPaid: 100, balanceDue: 0 })

      await user.click(screen.getByRole('button', { name: /^fechar$/i }))

      expect(onCancel).toHaveBeenCalled()
    })

    it('continua mostrando o resumo financeiro (Total/Já pago/Saldo devedor) mesmo no estado totalmente pago', () => {
      renderForm({ orderTotal: 100, currentTotalPaid: 100, balanceDue: 0 })

      expect(screen.getAllByText('R$ 100,00')).toHaveLength(2) // Total do pedido + Já pago
      expect(screen.getByText('R$ 0,00')).toBeInTheDocument() // Saldo devedor
    })

    it('exibe o erro real do backend (submitError) quando o teto é violado apesar da validação local (saldo desatualizado)', () => {
      renderForm({
        ...scenario,
        submitError:
          'Pagamento excedente: a soma dos pagamentos ultrapassaria o total do pedido. Valor máximo permitido: R$ 60,00.',
      })

      expect(
        screen.getByText(
          'Pagamento excedente: a soma dos pagamentos ultrapassaria o total do pedido. Valor máximo permitido: R$ 60,00.',
        ),
      ).toBeInTheDocument()
    })
  })
})
