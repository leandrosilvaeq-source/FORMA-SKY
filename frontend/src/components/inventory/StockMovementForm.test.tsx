import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StockMovementForm } from './StockMovementForm'

function renderForm(
  overrides: Partial<{
    currentStock: number
    isEligibleForInitialBalance: boolean
    isItemActive: boolean
    isSubmitting: boolean
    submitError: string | null
  }> = {},
) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <StockMovementForm
      currentStock={overrides.currentStock ?? 10}
      isEligibleForInitialBalance={overrides.isEligibleForInitialBalance ?? false}
      isItemActive={overrides.isItemActive ?? true}
      isSubmitting={overrides.isSubmitting ?? false}
      submitError={overrides.submitError ?? null}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  )
  return { onSubmit, onCancel }
}

async function pickCategoryAndType(user: ReturnType<typeof userEvent.setup>, category: string, type: string) {
  await user.click(screen.getByRole('radio', { name: category }))
  await user.click(screen.getByRole('radio', { name: type }))
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  { category, type, quantity, reason }: { category: string; type: string; quantity: string; reason?: string },
) {
  await pickCategoryAndType(user, category, type)
  await user.clear(screen.getByLabelText('Quantidade'))
  await user.type(screen.getByLabelText('Quantidade'), quantity)
  if (reason) {
    await user.type(screen.getByLabelText(/motivo\/observação/i), reason)
  }
  await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))
}

describe('StockMovementForm', () => {
  it('mostra os 3 grupos de primeiro nível (Entrada/Saída/Ajuste) como action buttons acessíveis', () => {
    renderForm()
    const group = screen.getByRole('radiogroup', { name: 'Movimentação' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Entrada' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Saída' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Ajuste' })).toBeInTheDocument()
  })

  it('não mostra o segundo nível antes de uma categoria ser escolhida', () => {
    renderForm()
    expect(screen.queryByRole('radiogroup', { name: 'Tipo de movimentação' })).not.toBeInTheDocument()
  })

  it('seleção de categoria é exclusiva (role=radio, aria-checked)', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    expect(screen.getByRole('radio', { name: 'Entrada' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Saída' })).toHaveAttribute('aria-checked', 'false')

    await user.click(screen.getByRole('radio', { name: 'Saída' }))
    expect(screen.getByRole('radio', { name: 'Entrada' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Saída' })).toHaveAttribute('aria-checked', 'true')
  })

  it('trocar de categoria limpa o tipo escolhido anteriormente', async () => {
    const user = userEvent.setup()
    renderForm()
    await pickCategoryAndType(user, 'Entrada', 'Compra')
    expect(screen.getByRole('radio', { name: 'Compra' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: 'Saída' }))
    expect(screen.queryByRole('radio', { name: 'Compra' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Perda/Avaria' })).toHaveAttribute('aria-checked', 'false')
  })

  it('Entrada mostra Saldo inicial/Compra/Devolução; Saída mostra Perda-Avaria/Amostra-Doação/Uso interno; Ajuste mostra positivo/negativo', async () => {
    const user = userEvent.setup()
    renderForm({ isEligibleForInitialBalance: true })

    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    expect(screen.getByRole('radio', { name: 'Saldo inicial' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Compra' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Devolução' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Saída' }))
    expect(screen.getByRole('radio', { name: 'Perda/Avaria' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Amostra/Doação' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Uso interno' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    expect(screen.getByRole('radio', { name: 'Ajuste positivo' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Ajuste negativo' })).toBeInTheDocument()
  })

  it('Saldo inicial só aparece quando isEligibleForInitialBalance=true', async () => {
    const user = userEvent.setup()
    renderForm({ isEligibleForInitialBalance: false })
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    expect(screen.queryByRole('radio', { name: 'Saldo inicial' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Compra' })).toBeInTheDocument()
  })

  it('item inativo: Saldo inicial e Compra ficam indisponíveis, Devolução continua disponível', async () => {
    const user = userEvent.setup()
    renderForm({ isEligibleForInitialBalance: true, isItemActive: false })
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    expect(screen.queryByRole('radio', { name: 'Saldo inicial' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Compra' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Devolução' })).toBeInTheDocument()
  })

  it('item inativo não filtra Saída/Ajuste (MVP permite ajuste/saída de saldo remanescente)', async () => {
    const user = userEvent.setup()
    renderForm({ isItemActive: false })
    await user.click(screen.getByRole('radio', { name: 'Saída' }))
    expect(screen.getByRole('radio', { name: 'Perda/Avaria' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Amostra/Doação' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Uso interno' })).toBeInTheDocument()
  })

  it('rejeita submissão sem categoria/tipo selecionados', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Quantidade'), '5')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))
    expect(await screen.findByText('Selecione o tipo de movimentação.')).toBeInTheDocument()
  })

  it('rejeita quantidade zero', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await fillAndSubmit(user, { category: 'Entrada', type: 'Compra', quantity: '0' })
    expect(await screen.findByText(/deve ser maior ou igual a 1/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejeita quantidade fracionada', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await fillAndSubmit(user, { category: 'Entrada', type: 'Compra', quantity: '1,5' })
    expect(await screen.findByText(/deve ser um número inteiro/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejeita quantidade não numérica', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await fillAndSubmit(user, { category: 'Entrada', type: 'Compra', quantity: 'abc' })
    expect(await screen.findByText(/deve ser um número válido/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('exibe a projeção "Saldo após movimentação" para entrada (soma) e saída (subtrai)', async () => {
    const user = userEvent.setup()
    renderForm({ currentStock: 10 })

    await pickCategoryAndType(user, 'Entrada', 'Compra')
    await user.type(screen.getByLabelText('Quantidade'), '5')
    expect(await screen.findByText('15')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Saída' }))
    await user.click(screen.getByRole('radio', { name: 'Uso interno' }))
    await user.clear(screen.getByLabelText('Quantidade'))
    await user.type(screen.getByLabelText('Quantidade'), '3')
    expect(await screen.findByText('7')).toBeInTheDocument()
  })

  it('bloqueia no frontend uma saída maior que o saldo atual', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentStock: 4 })
    await fillAndSubmit(user, { category: 'Saída', type: 'Uso interno', quantity: '6', reason: 'teste' })
    expect(await screen.findByText(/não pode ultrapassar o saldo atual \(4\)/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('permite saída exatamente igual ao saldo atual (zera)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentStock: 4 })
    await fillAndSubmit(user, { category: 'Saída', type: 'Uso interno', quantity: '4', reason: 'zerar' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it.each(['Perda/Avaria', 'Amostra/Doação', 'Uso interno'])('%s exige motivo', async (type) => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentStock: 10 })
    await fillAndSubmit(user, { category: 'Saída', type, quantity: '1' })
    expect(await screen.findByText('Motivo é obrigatório para este tipo de movimentação.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each(['Ajuste positivo', 'Ajuste negativo'])('%s exige motivo', async (type) => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentStock: 10 })
    await fillAndSubmit(user, { category: 'Ajuste', type, quantity: '1' })
    expect(await screen.findByText('Motivo é obrigatório para este tipo de movimentação.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Compra e Devolução aceitam observação opcional (não bloqueia sem motivo)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await fillAndSubmit(user, { category: 'Entrada', type: 'Compra', quantity: '5' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].reason).toBeNull()
  })

  it('envia o payload correto (movement_type/quantity/reason/occurred_at/idempotency_key)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentStock: 10 })
    await fillAndSubmit(user, { category: 'Saída', type: 'Perda/Avaria', quantity: '2', reason: 'quebrou' })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const values = onSubmit.mock.calls[0][0]
    expect(values.movement_type).toBe('LOSS')
    expect(values.quantity).toBe(2)
    expect(values.reason).toBe('quebrou')
    expect(typeof values.occurred_at).toBe('string')
    expect(typeof values.idempotency_key).toBe('string')
    expect(values.idempotency_key.length).toBeGreaterThan(0)
  })

  it('erro do backend (submitError) é exibido e o formulário preserva os valores preenchidos', async () => {
    const user = userEvent.setup()
    renderForm({ submitError: 'Saldo insuficiente para esta operação.' })
    await pickCategoryAndType(user, 'Entrada', 'Compra')
    await user.type(screen.getByLabelText('Quantidade'), '7')

    expect(screen.getByText('Saldo insuficiente para esta operação.')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantidade')).toHaveValue('7')
    expect(screen.getByRole('radio', { name: 'Compra' })).toHaveAttribute('aria-checked', 'true')
  })

  it('duplo envio bloqueado: isSubmitting desabilita o botão e os campos', () => {
    renderForm({ isSubmitting: true })
    expect(screen.getByRole('button', { name: /registrando/i })).toBeDisabled()
    expect(screen.getByLabelText('Quantidade')).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Entrada' })).toBeDisabled()
  })

  it('botão Cancelar chama onCancel', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('acessibilidade: campos de motivo/quantidade/data têm Label associado (getByLabelText funciona)', () => {
    renderForm()
    expect(screen.getByLabelText('Quantidade')).toBeInTheDocument()
    expect(screen.getByLabelText('Ocorrido em')).toBeInTheDocument()
    expect(screen.getByLabelText(/motivo\/observação/i)).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------
  // Idempotência (requisito 9): chave estável no retry do mesmo payload,
  // nova chave após qualquer mudança de movement_type/quantity/reason/data.
  // ---------------------------------------------------------------------

  it('idempotência: reenviar o MESMO payload (após um erro) reusa a mesma idempotency_key', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentStock: 10 })

    await fillAndSubmit(user, { category: 'Entrada', type: 'Compra', quantity: '5' })
    const firstKey = onSubmit.mock.calls[0][0].idempotency_key

    // Reenvia sem alterar nada — mesmo botão, mesmo payload.
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))
    const secondKey = onSubmit.mock.calls[1][0].idempotency_key

    expect(secondKey).toBe(firstKey)
  })

  it('idempotência: alterar a quantidade depois de um envio gera uma nova idempotency_key', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentStock: 10 })

    await fillAndSubmit(user, { category: 'Entrada', type: 'Compra', quantity: '5' })
    const firstKey = onSubmit.mock.calls[0][0].idempotency_key

    await user.clear(screen.getByLabelText('Quantidade'))
    await user.type(screen.getByLabelText('Quantidade'), '6')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))
    const secondKey = onSubmit.mock.calls[1][0].idempotency_key

    expect(secondKey).not.toBe(firstKey)
  })

  it('idempotência: trocar o tipo de movimentação gera uma nova idempotency_key', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentStock: 10 })

    await fillAndSubmit(user, { category: 'Entrada', type: 'Compra', quantity: '5' })
    const firstKey = onSubmit.mock.calls[0][0].idempotency_key

    await user.click(screen.getByRole('radio', { name: 'Devolução' }))
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))
    const secondKey = onSubmit.mock.calls[1][0].idempotency_key

    expect(secondKey).not.toBe(firstKey)
  })

  it('idempotência: alterar o motivo depois de um envio gera uma nova idempotency_key', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentStock: 10 })

    await fillAndSubmit(user, { category: 'Saída', type: 'Perda/Avaria', quantity: '1', reason: 'motivo A' })
    const firstKey = onSubmit.mock.calls[0][0].idempotency_key

    await user.type(screen.getByLabelText(/motivo\/observação/i), ' extra')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))
    const secondKey = onSubmit.mock.calls[1][0].idempotency_key

    expect(secondKey).not.toBe(firstKey)
  })

  it('idempotência: alterar a data depois de um envio gera uma nova idempotency_key', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentStock: 10 })

    await fillAndSubmit(user, { category: 'Entrada', type: 'Compra', quantity: '5' })
    const firstKey = onSubmit.mock.calls[0][0].idempotency_key

    const dateInput = screen.getByLabelText('Ocorrido em')
    await user.clear(dateInput)
    await user.type(dateInput, '2026-01-01')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))
    const secondKey = onSubmit.mock.calls[1][0].idempotency_key

    expect(secondKey).not.toBe(firstKey)
  })
})
