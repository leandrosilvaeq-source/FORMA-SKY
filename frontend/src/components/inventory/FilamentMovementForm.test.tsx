import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilamentMovementForm } from './FilamentMovementForm'

function renderForm(
  overrides: Partial<{ currentWeightGrams: number; nominalWeightGrams: number; isEligibleForInitialBalance: boolean }> = {},
) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <FilamentMovementForm
      currentWeightGrams={overrides.currentWeightGrams ?? 500}
      nominalWeightGrams={overrides.nominalWeightGrams ?? 1000}
      isEligibleForInitialBalance={overrides.isEligibleForInitialBalance ?? false}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  )
  return { onSubmit, onCancel }
}

describe('FilamentMovementForm', () => {
  it('Saldo inicial só aparece quando isEligibleForInitialBalance é true', async () => {
    const user = userEvent.setup()
    renderForm({ isEligibleForInitialBalance: false })
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    expect(screen.queryByRole('radio', { name: 'Saldo inicial' })).not.toBeInTheDocument()
  })

  it('Saldo inicial aparece quando isEligibleForInitialBalance é true', async () => {
    const user = userEvent.setup()
    renderForm({ isEligibleForInitialBalance: true })
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    expect(screen.getByRole('radio', { name: 'Saldo inicial' })).toBeInTheDocument()
  })

  it('WEIGHING_ADJUSTMENT nunca aparece como opção (é exclusivo do FilamentWeighingForm)', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    expect(screen.queryByText(/pesagem/i)).not.toBeInTheDocument()
  })

  it('exige motivo para Consumo manual, mas não para Compra', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.click(screen.getByRole('radio', { name: 'Saída' }))
    await user.click(screen.getByRole('radio', { name: 'Consumo manual' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '100')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    expect(screen.getByText('Motivo é obrigatório para este tipo de movimentação.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('bloqueia uma saída que ultrapassa o peso disponível atual', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentWeightGrams: 100 })

    await user.click(screen.getByRole('radio', { name: 'Saída' }))
    await user.click(screen.getByRole('radio', { name: 'Perda/Avaria' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '200')
    await user.type(screen.getByLabelText(/motivo\/observação/i), 'caiu no chão')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    expect(screen.getByText(/não pode ultrapassar o peso disponível atual/)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('bloqueia uma entrada de rotina (Compra) que ultrapassaria o peso nominal', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentWeightGrams: 900, nominalWeightGrams: 1000 })

    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    await user.click(screen.getByRole('radio', { name: 'Compra' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '150')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    expect(screen.getByText(/ultrapassaria o peso nominal do rolo/)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('permite um Ajuste positivo que ultrapassa o peso nominal (ajuste é isento do teto)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentWeightGrams: 900, nominalWeightGrams: 1000 })

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    await user.click(screen.getByRole('radio', { name: 'Ajuste positivo' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '150')
    await user.type(screen.getByLabelText(/motivo\/observação/i), 'peso real medido acima do nominal')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ movement_type: 'POSITIVE_ADJUSTMENT', quantity: 150 })
  })

  it('aceita quantidade fracionária (gramas não são inteiros)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    await user.click(screen.getByRole('radio', { name: 'Devolução' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '12,5')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].quantity).toBe(12.5)
  })

  it('erro do backend preserva os valores já preenchidos no formulário', async () => {
    const onSubmit = vi.fn()
    const { rerender } = render(
      <FilamentMovementForm
        currentWeightGrams={500}
        nominalWeightGrams={1000}
        isEligibleForInitialBalance={false}
        isSubmitting={false}
        submitError={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    await user.click(screen.getByRole('radio', { name: 'Compra' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '250')

    rerender(
      <FilamentMovementForm
        currentWeightGrams={500}
        nominalWeightGrams={1000}
        isEligibleForInitialBalance={false}
        isSubmitting={false}
        submitError="peso insuficiente para esta operação"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('peso insuficiente para esta operação')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantidade (g)')).toHaveValue('250')
    expect(screen.getByRole('radio', { name: 'Compra' })).toHaveAttribute('aria-checked', 'true')
  })

  it('botão Cancelar chama onCancel', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
