import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilamentMovementForm, type FilamentMovementOperation } from './FilamentMovementForm'

function renderForm(
  overrides: Partial<{
    currentWeightGrams: number
    initialOperation: FilamentMovementOperation | null
    isSubmitting: boolean
    submitError: string | null
  }> = {},
) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <FilamentMovementForm
      currentWeightGrams={overrides.currentWeightGrams ?? 500}
      initialOperation={overrides.initialOperation ?? null}
      isSubmitting={overrides.isSubmitting ?? false}
      submitError={overrides.submitError ?? null}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  )
  return { onSubmit, onCancel }
}

describe('FilamentMovementForm', () => {
  it('só oferece as operações "Registrar perda" e "Ajuste" — sem Entrada/Saída/Compra/Devolução/Saldo inicial nem seção "Tipo"', () => {
    renderForm()
    const operations = screen.getByRole('radiogroup', { name: 'Operação' })
    expect(operations).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Registrar perda' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Ajuste' })).toBeInTheDocument()

    for (const gone of ['Entrada', 'Saída', 'Compra', 'Devolução', 'Saldo inicial']) {
      expect(screen.queryByRole('radio', { name: gone })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('radiogroup', { name: 'Movimentação' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: 'Tipo de movimentação' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Tipo')).not.toBeInTheDocument()
  })

  it('sem initialOperation, nenhuma operação vem marcada e os campos só aparecem após escolher', () => {
    renderForm()
    expect(screen.getByRole('radio', { name: 'Registrar perda' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('radio', { name: 'Ajuste' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByLabelText('Quantidade (g)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Novo peso líquido (g)')).not.toBeInTheDocument()
  })

  it('initialOperation="ADJUST" já entra com "Ajuste" selecionado e o campo "Novo peso líquido (g)" visível', () => {
    renderForm({ initialOperation: 'ADJUST' })
    expect(screen.getByRole('radio', { name: 'Ajuste' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Novo peso líquido (g)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar ajuste' })).toBeInTheDocument()
  })

  it('WEIGHING_ADJUSTMENT nunca aparece (é exclusivo do FilamentWeighingForm)', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    expect(screen.queryByText(/pesagem/i)).not.toBeInTheDocument()
  })

  it('"Registrar perda" grava movement_type = LOSS com quantidade positiva e exige motivo', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentWeightGrams: 500 })

    await user.click(screen.getByRole('radio', { name: 'Registrar perda' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '80')
    await user.click(screen.getByRole('button', { name: 'Registrar perda' }))
    expect(screen.getByText('Motivo é obrigatório para esta operação.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Motivo/observação'), 'rolo caiu e sujou')
    await user.click(screen.getByRole('button', { name: 'Registrar perda' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      movement_type: 'LOSS',
      quantity: 80,
      reason: 'rolo caiu e sujou',
    })
  })

  it('"Registrar perda" bloqueia uma quantidade acima do peso líquido atual', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentWeightGrams: 100 })

    await user.click(screen.getByRole('radio', { name: 'Registrar perda' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '200')
    await user.type(screen.getByLabelText('Motivo/observação'), 'perda total')
    await user.click(screen.getByRole('button', { name: 'Registrar perda' }))

    expect(screen.getByText(/não pode ultrapassar o peso líquido atual/)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('"Ajuste" para um peso maior grava POSITIVE_ADJUSTMENT com a diferença como quantidade', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentWeightGrams: 500 })

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    await user.type(screen.getByLabelText('Novo peso líquido (g)'), '620')
    await user.type(screen.getByLabelText('Motivo/observação'), 'pesagem real acima do registrado')
    await user.click(screen.getByRole('button', { name: 'Confirmar ajuste' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      movement_type: 'POSITIVE_ADJUSTMENT',
      quantity: 120,
      reason: 'pesagem real acima do registrado',
    })
  })

  it('"Ajuste" para um peso menor grava NEGATIVE_ADJUSTMENT com a diferença absoluta', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentWeightGrams: 500 })

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    await user.type(screen.getByLabelText('Novo peso líquido (g)'), '430')
    await user.type(screen.getByLabelText('Motivo/observação'), 'correção após pesagem')
    await user.click(screen.getByRole('button', { name: 'Confirmar ajuste' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      movement_type: 'NEGATIVE_ADJUSTMENT',
      quantity: 70,
    })
  })

  it('"Ajuste" com o mesmo peso atual é rejeitado', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentWeightGrams: 500 })

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    await user.type(screen.getByLabelText('Novo peso líquido (g)'), '500')
    await user.type(screen.getByLabelText('Motivo/observação'), 'sem mudança')
    await user.click(screen.getByRole('button', { name: 'Confirmar ajuste' }))

    expect(screen.getByText('Informe um peso líquido diferente do atual.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('"Ajuste" exige motivo', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentWeightGrams: 500 })

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    await user.type(screen.getByLabelText('Novo peso líquido (g)'), '450')
    await user.click(screen.getByRole('button', { name: 'Confirmar ajuste' }))

    expect(screen.getByText('Motivo é obrigatório para esta operação.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('"Ajuste" aceita valor fracionário (gramas não são inteiros) e não tem teto de peso nominal', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ currentWeightGrams: 900 })

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    await user.type(screen.getByLabelText('Novo peso líquido (g)'), '1012,5')
    await user.type(screen.getByLabelText('Motivo/observação'), 'peso real medido')
    await user.click(screen.getByRole('button', { name: 'Confirmar ajuste' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      movement_type: 'POSITIVE_ADJUSTMENT',
      quantity: 112.5,
    })
  })

  it('erro do backend preserva a operação e os valores já preenchidos', async () => {
    const onSubmit = vi.fn()
    const { rerender } = render(
      <FilamentMovementForm
        currentWeightGrams={500}
        initialOperation={null}
        isSubmitting={false}
        submitError={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    await user.type(screen.getByLabelText('Novo peso líquido (g)'), '450')

    rerender(
      <FilamentMovementForm
        currentWeightGrams={500}
        initialOperation={null}
        isSubmitting={false}
        submitError="saldo desatualizado, tente de novo"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('saldo desatualizado, tente de novo')).toBeInTheDocument()
    expect(screen.getByLabelText('Novo peso líquido (g)')).toHaveValue('450')
    expect(screen.getByRole('radio', { name: 'Ajuste' })).toHaveAttribute('aria-checked', 'true')
  })

  it('botão Cancelar chama onCancel', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm({ initialOperation: 'ADJUST' })
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
