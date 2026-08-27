import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilamentWeighingForm } from './FilamentWeighingForm'

function renderForm(overrides: Partial<{ currentWeightGrams: number; emptySpoolWeightGrams: number | null }> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <FilamentWeighingForm
      currentWeightGrams={overrides.currentWeightGrams ?? 800}
      emptySpoolWeightGrams={'emptySpoolWeightGrams' in overrides ? overrides.emptySpoolWeightGrams! : 200}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  )
  return { onSubmit, onCancel }
}

describe('FilamentWeighingForm', () => {
  it('exibe o peso disponível atual', () => {
    renderForm({ currentWeightGrams: 800 })
    expect(screen.getByText(/peso disponível atual/i)).toBeInTheDocument()
    expect(screen.getByText('800g')).toBeInTheDocument()
  })

  it('quando a tara é conhecida, o modo padrão é "peso bruto" e ambos os modos ficam disponíveis', () => {
    renderForm({ emptySpoolWeightGrams: 200 })
    expect(screen.getByRole('radio', { name: /peso bruto medido/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /peso bruto medido/i })).not.toBeDisabled()
    expect(screen.getByText(/tara do carretel deste rolo: 200g/i)).toBeInTheDocument()
  })

  it('quando a tara não é conhecida, o modo "peso bruto" fica indisponível e o padrão é "peso líquido"', () => {
    renderForm({ emptySpoolWeightGrams: null })
    expect(screen.getByRole('radio', { name: /peso bruto medido/i })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /peso líquido disponível/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/tara do carretel deste rolo não é conhecida/i)).toBeInTheDocument()
  })

  it('calcula o peso líquido e a diferença ao digitar o peso bruto (tara conhecida)', async () => {
    const user = userEvent.setup()
    renderForm({ currentWeightGrams: 800, emptySpoolWeightGrams: 200 })

    await user.type(screen.getByLabelText(/peso bruto medido/i), '950')

    expect(screen.getByText(/peso líquido calculado/i)).toBeInTheDocument()
    expect(screen.getByText('750g')).toBeInTheDocument()
    expect(screen.getByText(/-50g/)).toBeInTheDocument()
  })

  it('rejeita peso bruto menor que a tara', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ emptySpoolWeightGrams: 200 })

    await user.type(screen.getByLabelText(/peso bruto medido/i), '100')
    await user.type(screen.getByLabelText(/motivo\/observação/i), 'teste')
    await user.click(screen.getByRole('button', { name: /^registrar pesagem$/i }))

    expect(screen.getByText(/não pode ser menor que a tara do carretel/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejeita peso líquido negativo direto', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ emptySpoolWeightGrams: null })

    await user.type(screen.getByLabelText(/peso líquido disponível/i), '-5')
    await user.type(screen.getByLabelText(/motivo\/observação/i), 'teste')
    await user.click(screen.getByRole('button', { name: /^registrar pesagem$/i }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('exige motivo sempre — mesmo com uma diferença pequena, sem tolerância diferencial', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ emptySpoolWeightGrams: null, currentWeightGrams: 500 })

    await user.type(screen.getByLabelText(/peso líquido disponível/i), '501')
    await user.click(screen.getByRole('button', { name: /^registrar pesagem$/i }))

    expect(screen.getByText('Motivo é obrigatório para registrar uma pesagem.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('envia measured_gross_weight_grams quando no modo "peso bruto"', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ emptySpoolWeightGrams: 200 })

    await user.type(screen.getByLabelText(/peso bruto medido/i), '950')
    await user.type(screen.getByLabelText(/motivo\/observação/i), 'conferência mensal')
    await user.click(screen.getByRole('button', { name: /^registrar pesagem$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      measured_gross_weight_grams: 950,
      measured_net_weight_grams: null,
      reason: 'conferência mensal',
    })
  })

  it('envia measured_net_weight_grams quando no modo "peso líquido"', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ emptySpoolWeightGrams: 200 })

    await user.click(screen.getByRole('radio', { name: /peso líquido disponível/i }))
    await user.type(screen.getByLabelText(/peso líquido disponível/i), '480')
    await user.type(screen.getByLabelText(/motivo\/observação/i), 'tara não confiável desta vez')
    await user.click(screen.getByRole('button', { name: /^registrar pesagem$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      measured_gross_weight_grams: null,
      measured_net_weight_grams: 480,
      reason: 'tara não confiável desta vez',
    })
  })

  it('trocar de modo limpa o valor digitado', async () => {
    const user = userEvent.setup()
    renderForm({ emptySpoolWeightGrams: 200 })

    await user.type(screen.getByLabelText(/peso bruto medido/i), '950')
    await user.click(screen.getByRole('radio', { name: /peso líquido disponível/i }))

    expect(screen.getByLabelText(/peso líquido disponível/i)).toHaveValue('')
  })

  it('erro do backend fica visível sem fechar/limpar o formulário', () => {
    render(
      <FilamentWeighingForm
        currentWeightGrams={800}
        emptySpoolWeightGrams={200}
        isSubmitting={false}
        submitError="peso líquido resultante não pode ser negativo"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('peso líquido resultante não pode ser negativo')).toBeInTheDocument()
  })
})
