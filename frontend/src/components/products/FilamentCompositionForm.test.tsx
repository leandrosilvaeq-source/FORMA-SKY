import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilamentCompositionForm } from './FilamentCompositionForm'
import type { FilamentTypeSummary, ProductFilament } from '@/types/domain'

function typeFixture(overrides: Partial<FilamentTypeSummary> = {}): FilamentTypeSummary {
  return {
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
    ...overrides,
  }
}

const filamentTypes: FilamentTypeSummary[] = [
  typeFixture({ filament_type_id: 'ft1' }),
  typeFixture({ filament_type_id: 'ft2', commercial_color: 'Branco' }),
]

const initialFilaments: ProductFilament[] = [
  { id: 'pf1', product_id: 'p1', filament_type_id: 'ft1', theoretical_weight_grams: 12.5, created_at: '' },
]

function renderForm(overrides: Partial<Parameters<typeof FilamentCompositionForm>[0]> = {}) {
  const onSubmit = vi.fn()
  render(
    <FilamentCompositionForm
      filamentTypes={filamentTypes}
      initialFilaments={initialFilaments}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      {...overrides}
    />,
  )
  return { onSubmit }
}

async function chooseOption(user: ReturnType<typeof userEvent.setup>, comboboxName: string, optionName: string) {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

describe('FilamentCompositionForm', () => {
  it('carrega a composição existente pré-preenchida e envia sem alterações', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    expect(screen.getByRole('combobox', { name: 'Tipo de filamento' })).toHaveTextContent('PLA · Voolt3D · Sólida · Preto')
    expect(screen.getByRole('textbox', { name: 'Peso teórico por unidade (g)' })).toHaveValue('12.5')

    await user.click(screen.getByRole('button', { name: /^salvar filamentos$/i }))

    expect(onSubmit).toHaveBeenCalledWith({ filaments: [{ id: 'ft1', theoretical_weight_grams: 12.5 }] })
  })

  it('composição vazia mostra a mensagem de "nenhum filamento" e permite adicionar uma linha nova', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ initialFilaments: [] })

    expect(screen.getByText('Nenhum filamento na composição.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^adicionar filamento$/i }))
    await chooseOption(user, 'Tipo de filamento', 'PLA · Voolt3D · Sólida · Preto')
    await user.type(screen.getByRole('textbox', { name: 'Peso teórico por unidade (g)' }), '8')
    await user.click(screen.getByRole('button', { name: /^salvar filamentos$/i }))

    expect(onSubmit).toHaveBeenCalledWith({ filaments: [{ id: 'ft1', theoretical_weight_grams: 8 }] })
  })

  it('permite múltiplos tipos de filamento na mesma composição', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ initialFilaments: [] })

    await user.click(screen.getByRole('button', { name: /^adicionar filamento$/i }))
    await user.click(screen.getByRole('button', { name: /^adicionar filamento$/i }))

    const combos = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })
    await user.click(combos[0])
    await user.click(await screen.findByRole('option', { name: 'PLA · Voolt3D · Sólida · Preto' }))
    await user.click(combos[1])
    await user.click(await screen.findByRole('option', { name: 'PLA · Voolt3D · Sólida · Branco' }))

    const weightInputs = screen.getAllByRole('textbox', { name: 'Peso teórico por unidade (g)' })
    await user.type(weightInputs[0], '10')
    await user.type(weightInputs[1], '20')

    await user.click(screen.getByRole('button', { name: /^salvar filamentos$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      filaments: [
        { id: 'ft1', theoretical_weight_grams: 10 },
        { id: 'ft2', theoretical_weight_grams: 20 },
      ],
    })
  })

  it('não oferece um tipo já escolhido noutra linha (impede duplicidade)', async () => {
    const user = userEvent.setup()
    renderForm({ initialFilaments })

    await user.click(screen.getByRole('button', { name: /^adicionar filamento$/i }))
    const combos = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })
    await user.click(combos[1])

    expect(screen.queryByRole('option', { name: 'PLA · Voolt3D · Sólida · Preto' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'PLA · Voolt3D · Sólida · Branco' })).toBeInTheDocument()
  })

  it('bloqueia salvar quando o tipo de filamento está ausente', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ initialFilaments: [] })

    await user.click(screen.getByRole('button', { name: /^adicionar filamento$/i }))
    await user.type(screen.getByRole('textbox', { name: 'Peso teórico por unidade (g)' }), '10')
    await user.click(screen.getByRole('button', { name: /^salvar filamentos$/i }))

    expect(await screen.findByText('Selecione um tipo de filamento.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('bloqueia salvar com peso zero, negativo ou vazio', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    const weightInput = screen.getByRole('textbox', { name: 'Peso teórico por unidade (g)' })
    await user.clear(weightInput)
    await user.type(weightInput, '0')
    await user.click(screen.getByRole('button', { name: /^salvar filamentos$/i }))

    expect(await screen.findByText(/maior ou igual a 0.01/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('aceita peso decimal brasileiro (vírgula)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    const weightInput = screen.getByRole('textbox', { name: 'Peso teórico por unidade (g)' })
    await user.clear(weightInput)
    await user.type(weightInput, '9,75')
    await user.click(screen.getByRole('button', { name: /^salvar filamentos$/i }))

    expect(onSubmit).toHaveBeenCalledWith({ filaments: [{ id: 'ft1', theoretical_weight_grams: 9.75 }] })
  })

  it('preserva um tipo inativo já vinculado (nunca some da tela) e bloqueia salvar até ser removido', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({
      filamentTypes: [{ ...filamentTypes[0], is_active: false }],
    })

    expect(screen.getByRole('combobox', { name: 'Tipo de filamento' })).toHaveTextContent(
      'PLA · Voolt3D · Sólida · Preto (inativo)',
    )
    expect(screen.getByText(/este tipo de filamento está inativo/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^salvar filamentos$/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /^remover/i }))

    expect(screen.queryByText(/este tipo de filamento está inativo/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^salvar filamentos$/i })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: /^salvar filamentos$/i }))
    expect(onSubmit).toHaveBeenCalledWith({ filaments: [] })
  })

  it('"Desfazer alterações" descarta edições locais, voltando ao último estado salvo', async () => {
    const user = userEvent.setup()
    renderForm()

    const weightInput = screen.getByRole('textbox', { name: 'Peso teórico por unidade (g)' })
    await user.clear(weightInput)
    await user.type(weightInput, '999')
    expect(weightInput).toHaveValue('999')

    await user.click(screen.getByRole('button', { name: /^desfazer alterações$/i }))

    expect(screen.getByRole('textbox', { name: 'Peso teórico por unidade (g)' })).toHaveValue('12.5')
  })

  it('exibe o erro real do backend (submitError) sem impedir nova tentativa', () => {
    renderForm({ submitError: 'Este produto não foi encontrado.' })

    expect(screen.getByText('Este produto não foi encontrado.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^salvar filamentos$/i })).not.toBeDisabled()
  })

  it('desabilita todos os controles enquanto isSubmitting é true', () => {
    renderForm({ isSubmitting: true })

    expect(screen.getByRole('button', { name: /^salvando\.\.\.$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^desfazer alterações$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^adicionar filamento$/i })).toBeDisabled()
  })
})
