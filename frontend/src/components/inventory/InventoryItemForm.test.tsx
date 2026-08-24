import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InventoryItemForm } from './InventoryItemForm'

function renderForm(overrides: Partial<Parameters<typeof InventoryItemForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <InventoryItemForm
      idPrefix="accessory"
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onCancel }
}

describe('InventoryItemForm', () => {
  it('renderiza os campos esperados: Nome, Tamanho, Variante e Estoque mínimo — nada mais', () => {
    renderForm()

    expect(screen.getByLabelText('Nome')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Tamanho' })).toBeInTheDocument()
    expect(screen.getByLabelText('Variante')).toBeInTheDocument()
    expect(screen.getByLabelText('Estoque mínimo')).toBeInTheDocument()

    // Campos explicitamente fora de escopo: nunca devem existir no DOM.
    expect(screen.queryByLabelText(/material/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/fornecedor/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/custo/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/estoque atual/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/código interno/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/observaç/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/ativo/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('as opções de Tamanho são exatamente Não se aplica/PP/P/M/G/GG, com "Não se aplica" selecionada por padrão', () => {
    renderForm()

    expect(screen.getByRole('radiogroup', { name: 'Tamanho' })).toBeInTheDocument()
    const options = ['Não se aplica', 'PP', 'P', 'M', 'G', 'GG']
    for (const label of options) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('radio')).toHaveLength(options.length)
    expect(screen.getByRole('radio', { name: 'Não se aplica' })).toHaveAttribute('aria-checked', 'true')
  })

  it('rejeita nome vazio ou só com espaços, sem chamar onSubmit', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText('Nome'), '   ')
    await user.type(screen.getByLabelText('Estoque mínimo'), '5')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(screen.getByText('Informe o nome.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejeita estoque mínimo ausente, negativo ou não inteiro', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText('Nome'), 'Ímã 6x2')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe o estoque mínimo.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Estoque mínimo'), '-1')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('o estoque mínimo deve ser maior ou igual a 0.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('remove espaços externos de Nome e Variante antes de enviar', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText('Nome'), '  Ímã 6x2  ')
    await user.type(screen.getByLabelText('Variante'), '  azul  ')
    await user.type(screen.getByLabelText('Estoque mínimo'), '10')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ímã 6x2', size: null, variant: 'azul', minimum_stock: 10 })
  })

  it('variante em branco é enviada como null, não como string vazia', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText('Nome'), 'Ímã 6x2')
    await user.type(screen.getByLabelText('Estoque mínimo'), '0')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ímã 6x2', size: null, variant: null, minimum_stock: 0 })
  })

  it('selecionar um tamanho envia o valor escolhido no payload', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText('Nome'), 'Ímã 6x2')
    await user.type(screen.getByLabelText('Estoque mínimo'), '3')
    await user.click(screen.getByRole('radio', { name: 'GG' }))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ímã 6x2', size: 'GG', variant: null, minimum_stock: 3 })
  })

  it('preserva os valores preenchidos quando o pai reporta um erro de envio (submitError)', () => {
    renderForm({ submitError: 'Falha ao cadastrar. Tente novamente.' })

    expect(screen.getByText('Falha ao cadastrar. Tente novamente.')).toBeInTheDocument()
  })

  it('cancelar chama onCancel sem chamar onSubmit', async () => {
    const user = userEvent.setup()
    const { onSubmit, onCancel } = renderForm()

    await user.type(screen.getByLabelText('Nome'), 'Ímã 6x2')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('durante o envio (isSubmitting), os campos e o botão Salvar/Cancelar ficam desabilitados, impedindo duplo envio', () => {
    renderForm({ isSubmitting: true })

    expect(screen.getByLabelText('Nome')).toBeDisabled()
    expect(screen.getByLabelText('Variante')).toBeDisabled()
    expect(screen.getByLabelText('Estoque mínimo')).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'PP' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Salvando...' })).toBeDisabled()
  })
})

describe('InventoryItemForm — modo edição', () => {
  it('mode="edit" pré-preenche os campos a partir de initialValues e usa o rótulo "Salvar alterações"', () => {
    renderForm({
      mode: 'edit',
      initialValues: { name: 'Ímã 6x2', size: 'M', variant: 'azul', minimum_stock: 10 },
    })

    expect(screen.getByLabelText('Nome')).toHaveValue('Ímã 6x2')
    expect(screen.getByLabelText('Variante')).toHaveValue('azul')
    expect(screen.getByLabelText('Estoque mínimo')).toHaveValue('10')
    expect(screen.getByRole('radio', { name: 'M' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeInTheDocument()
  })

  it('minimum_stock nulo em initialValues pré-preenche o campo como vazio', () => {
    renderForm({
      mode: 'edit',
      initialValues: { name: 'Ímã 6x2', size: null, variant: null, minimum_stock: null },
    })

    expect(screen.getByLabelText('Estoque mínimo')).toHaveValue('')
  })

  it('editar e salvar sem alterar nada reenvia os mesmos valores pré-preenchidos', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({
      mode: 'edit',
      initialValues: { name: 'Ímã 6x2', size: 'M', variant: 'azul', minimum_stock: 10 },
    })

    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ímã 6x2', size: 'M', variant: 'azul', minimum_stock: 10 })
  })

  it('um tamanho legado (fora de PP/P/M/G/GG) aparece como opção extra, selecionada por padrão', () => {
    renderForm({
      mode: 'edit',
      initialValues: { name: 'Parafuso', size: 'M3', variant: null, minimum_stock: 0 },
    })

    const legacyOption = screen.getByRole('radio', { name: 'M3' })
    expect(legacyOption).toHaveAttribute('aria-checked', 'true')
    // As opções oficiais continuam todas presentes, mais a legada — nunca
    // um campo de texto livre para digitar um novo valor de tamanho.
    expect(screen.getAllByRole('radio')).toHaveLength(7)
    expect(screen.queryByRole('textbox', { name: 'Tamanho' })).not.toBeInTheDocument()
  })

  it('o valor legado pode ser mantido inalterado ao salvar', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({
      mode: 'edit',
      initialValues: { name: 'Parafuso', size: 'M3', variant: null, minimum_stock: 0 },
    })

    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Parafuso', size: 'M3', variant: null, minimum_stock: 0 })
  })

  it('o valor legado pode ser trocado por uma opção oficial da lista', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({
      mode: 'edit',
      initialValues: { name: 'Parafuso', size: 'M3', variant: null, minimum_stock: 0 },
    })

    await user.click(screen.getByRole('radio', { name: 'G' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Parafuso', size: 'G', variant: null, minimum_stock: 0 })
  })

  it('o valor legado pode ser trocado por "Não se aplica" (size null)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({
      mode: 'edit',
      initialValues: { name: 'Parafuso', size: 'M3', variant: null, minimum_stock: 0 },
    })

    await user.click(screen.getByRole('radio', { name: 'Não se aplica' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Parafuso', size: null, variant: null, minimum_stock: 0 })
  })
})
