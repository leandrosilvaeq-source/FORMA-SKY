import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductCompositionForm } from './ProductCompositionForm'
import type { Accessory, Packaging, ProductAccessory, ProductPackaging } from '@/types/domain'

const accessories: Accessory[] = [
  {
    id: 'a1',
    name: 'Ímã 6x2',
    material: null,
    size: null,
    variant: null,
    unit_cost: null,
    minimum_stock: null,
    current_stock: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'a2',
    name: 'Parafuso M3',
    material: null,
    size: null,
    variant: null,
    unit_cost: null,
    minimum_stock: null,
    current_stock: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
]

const packaging: Packaging[] = [
  {
    id: 'k1',
    name: 'Caixa M',
    material: null,
    size: null,
    variant: null,
    unit_cost: null,
    minimum_stock: null,
    current_stock: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
]

const initialAccessories: ProductAccessory[] = [
  { id: 'pa1', product_id: 'p1', accessory_id: 'a1', quantity: 2, created_at: '' },
]

const initialPackaging: ProductPackaging[] = [
  { id: 'pk1', product_id: 'p1', packaging_id: 'k1', quantity: 1, created_at: '' },
]

function renderForm(overrides: Partial<Parameters<typeof ProductCompositionForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <ProductCompositionForm
      accessories={accessories}
      packaging={packaging}
      initialAccessories={initialAccessories}
      initialPackaging={initialPackaging}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onCancel }
}

async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  comboboxName: string,
  optionName: string,
) {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

describe('ProductCompositionForm', () => {
  it('abertura e conteúdo: carrega a composição existente pré-preenchida e envia sem alterações', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    expect(screen.getByRole('combobox', { name: 'Quantidade do acessório' })).toHaveTextContent('2')
    expect(screen.getByRole('combobox', { name: 'Quantidade da embalagem' })).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      accessories: [{ id: 'a1', quantity: 2 }],
      packaging: [{ id: 'k1', quantity: 1 }],
    })
  })

  it('permite alterar a quantidade de uma linha pré-preenchida escolhendo outro valor no Select, preservando o contrato (número)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await chooseOption(user, 'Quantidade do acessório', '5')
    expect(screen.getByRole('combobox', { name: 'Quantidade do acessório' })).toHaveTextContent('5')

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      accessories: [{ id: 'a1', quantity: 5 }],
      packaging: [{ id: 'k1', quantity: 1 }],
    })
  })

  it('oferece exatamente as opções de 1 a 20 para a quantidade do acessório', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('combobox', { name: 'Quantidade do acessório' }))

    const optionValues = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(optionValues).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)))
  })

  it('oferece exatamente as opções de 1 a 20 para a quantidade da embalagem', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('combobox', { name: 'Quantidade da embalagem' }))

    const optionValues = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(optionValues).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)))
  })

  it('não é possível escolher 0 ou 21: não existem como opção na lista', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('combobox', { name: 'Quantidade do acessório' }))
    await screen.findAllByRole('option')

    expect(screen.queryByRole('option', { name: '0' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '21' })).not.toBeInTheDocument()
  })

  it('seleciona item e quantidade numa linha nova e envia a quantidade como número', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ initialAccessories: [], initialPackaging: [] })

    await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))
    await chooseOption(user, 'Acessório', 'Ímã 6x2')
    await chooseOption(user, 'Quantidade do acessório', '7')

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      accessories: [{ id: 'a1', quantity: 7 }],
      packaging: [],
    })
  })

  it('renderiza sem nenhuma composição prévia (0 acessórios, 0 embalagens)', () => {
    renderForm({ initialAccessories: [], initialPackaging: [] })

    expect(screen.getByText('Nenhum acessório na composição.')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma embalagem na composição.')).toBeInTheDocument()
  })

  it('inclusão de acessório: adiciona uma linha vazia ao clicar em "Adicionar acessório"', async () => {
    const user = userEvent.setup()
    renderForm({ initialAccessories: [], initialPackaging: [] })

    await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))

    expect(screen.getByText('Selecione um acessório')).toBeInTheDocument()
  })

  it('inclusão de embalagem: adiciona uma linha vazia ao clicar em "Adicionar embalagem"', async () => {
    const user = userEvent.setup()
    renderForm({ initialAccessories: [], initialPackaging: [] })

    await user.click(screen.getByRole('button', { name: /adicionar embalagem/i }))

    expect(screen.getByText('Selecione uma embalagem')).toBeInTheDocument()
  })

  it('remoção pelo ícone: remove a linha e o botão tem nome acessível com o nome do item', async () => {
    const user = userEvent.setup()
    renderForm()

    expect(screen.getByRole('combobox', { name: 'Quantidade do acessório' })).toBeInTheDocument()
    const removeButton = screen.getByRole('button', { name: 'Remover Ímã 6x2' })
    expect(removeButton.querySelector('svg')).toBeInTheDocument()

    await user.click(removeButton)

    expect(
      screen.queryByRole('combobox', { name: 'Quantidade do acessório' }),
    ).not.toBeInTheDocument()
  })

  it('linha nova sem item selecionado tem nome acessível de remoção baseado na posição', async () => {
    const user = userEvent.setup()
    renderForm({ initialAccessories: [], initialPackaging: [] })

    await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))

    expect(screen.getByRole('button', { name: 'Remover acessório (linha 1)' })).toBeInTheDocument()
  })

  it('não envia e mostra erro quando uma linha adicionada não tem item selecionado', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ initialAccessories: [], initialPackaging: [] })

    await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(await screen.findByText('Selecione um acessório.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('chama onCancel ao clicar em Cancelar', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('exibe o submitError vindo do pai (erro de salvamento)', () => {
    renderForm({ submitError: 'Falha ao salvar a composição.' })

    expect(screen.getByText('Falha ao salvar a composição.')).toBeInTheDocument()
  })

  it('bloqueio de submissão duplicada: desabilita adicionar, remover, campos e Cancelar/Salvar durante isSubmitting', () => {
    renderForm({ isSubmitting: true })

    expect(screen.getByRole('button', { name: /adicionar acessório/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /adicionar embalagem/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remover Ímã 6x2' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remover Caixa M' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Quantidade do acessório' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Quantidade da embalagem' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /salvando/i })).toBeDisabled()
  })

  it('não oferece um acessório inativo como opção para uma linha nova', async () => {
    const user = userEvent.setup()
    const accessoriesWithInactive: Accessory[] = [
      ...accessories,
      { ...accessories[0], id: 'a3', name: 'Ímã descontinuado', is_active: false },
    ]
    renderForm({
      accessories: accessoriesWithInactive,
      initialAccessories: [],
      initialPackaging: [],
    })

    await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))

    expect(screen.queryByText('Ímã descontinuado')).not.toBeInTheDocument()
  })

  // Item inativo VINCULADO ANTERIORMENTE (rodada corretiva 2026-08-30) —
  // NUNCA mais bloqueia o salvamento: o usuário não pode ser obrigado a
  // remover um vínculo histórico só para editar outro campo/salvar outra
  // alteração. Continua visível, marcado como inativo, com quantidade
  // editável e removível voluntariamente; se permanecer na linha, o
  // payload o inclui normalmente. Um item inativo SEM vínculo anterior
  // continua nunca aparecendo como opção nova (ver "não oferece um
  // acessório inativo como opção para uma linha nova" acima, inalterado).
  describe('item inativo já vinculado à composição (preservável, nunca bloqueia)', () => {
    const accessoriesWithInactive: Accessory[] = [
      ...accessories,
      { ...accessories[0], id: 'a3', name: 'Ímã descontinuado', is_active: false },
    ]
    const initialWithInactive: ProductAccessory[] = [
      { id: 'pa2', product_id: 'p1', accessory_id: 'a3', quantity: 4, created_at: '' },
    ]

    it('exibição: mostra o item inativo já vinculado com indicação visual, sem removê-lo silenciosamente', () => {
      renderForm({
        accessories: accessoriesWithInactive,
        initialAccessories: initialWithInactive,
        initialPackaging: [],
      })

      expect(screen.getByText('Ímã descontinuado (inativo)')).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Quantidade do acessório' })).toHaveTextContent(
        '4',
      )
    })

    it('aviso: explica que o item é preservado, nunca que precisa ser removido', () => {
      renderForm({
        accessories: accessoriesWithInactive,
        initialAccessories: initialWithInactive,
        initialPackaging: [],
      })

      expect(
        screen.getByText(/foi preservado por já fazer parte da composição/i),
      ).toBeInTheDocument()
      expect(screen.queryByText(/precisa ser removido/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/remova-o.*para poder salvar/i)).not.toBeInTheDocument()
    })

    it('Salvar permanece habilitado com o item inativo presente (nunca bloqueia)', () => {
      renderForm({
        accessories: accessoriesWithInactive,
        initialAccessories: initialWithInactive,
        initialPackaging: [],
      })

      expect(screen.getByRole('button', { name: /^salvar$/i })).not.toBeDisabled()
    })

    it('salvar sem remover preserva o vínculo: onSubmit é chamado com o item inativo no payload', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({
        accessories: accessoriesWithInactive,
        initialAccessories: initialWithInactive,
        initialPackaging: [],
      })

      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(onSubmit).toHaveBeenCalledWith({
        accessories: [{ id: 'a3', quantity: 4 }],
        packaging: [],
      })
    })

    it('alterar só a quantidade do item inativo é permitido e preserva o vínculo com o novo valor', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({
        accessories: accessoriesWithInactive,
        initialAccessories: initialWithInactive,
        initialPackaging: [],
      })

      await chooseOption(user, 'Quantidade do acessório', '7')
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(onSubmit).toHaveBeenCalledWith({
        accessories: [{ id: 'a3', quantity: 7 }],
        packaging: [],
      })
    })

    it('remover o item inativo é permitido (voluntário, nunca exigido) e a composição é enviada sem ele', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({
        accessories: accessoriesWithInactive,
        initialAccessories: initialWithInactive,
        initialPackaging: [],
      })

      await user.click(screen.getByRole('button', { name: 'Remover Ímã descontinuado' }))
      expect(screen.queryByText('Ímã descontinuado (inativo)')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(onSubmit).toHaveBeenCalledWith({ accessories: [], packaging: [] })
    })

    it('depois de removido, o item inativo não pode ser selecionado novamente em nenhuma linha', async () => {
      const user = userEvent.setup()
      renderForm({
        accessories: accessoriesWithInactive,
        initialAccessories: initialWithInactive,
        initialPackaging: [],
      })

      await user.click(screen.getByRole('button', { name: 'Remover Ímã descontinuado' }))
      await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))

      expect(screen.queryByText('Ímã descontinuado')).not.toBeInTheDocument()
    })
  })

  describe('quantidade existente fora do intervalo permitido (1-20)', () => {
    const initialOutOfRangeQuantity: ProductAccessory[] = [
      { id: 'pa3', product_id: 'p1', accessory_id: 'a1', quantity: 50, created_at: '' },
    ]

    it('exibição: mantém o valor atual visível, sem correção/truncamento silencioso', () => {
      renderForm({ initialAccessories: initialOutOfRangeQuantity, initialPackaging: [] })

      expect(screen.getByRole('combobox', { name: 'Quantidade do acessório' })).toHaveTextContent(
        '50',
      )
    })

    it('aviso: exibe orientação para selecionar uma quantidade entre 1 e 20', () => {
      renderForm({ initialAccessories: initialOutOfRangeQuantity, initialPackaging: [] })

      expect(
        screen.getByText(
          'Quantidade fora do intervalo permitido (1 a 20). Selecione um valor válido para salvar.',
        ),
      ).toBeInTheDocument()
    })

    it('bloqueio: o botão Salvar fica desabilitado enquanto a quantidade permanecer fora do intervalo', () => {
      renderForm({ initialAccessories: initialOutOfRangeQuantity, initialPackaging: [] })

      expect(screen.getByRole('button', { name: /^salvar$/i })).toBeDisabled()
    })

    it('bloqueio: submeter o formulário diretamente (defesa extra) também não chama onSubmit', () => {
      const { onSubmit } = renderForm({
        initialAccessories: initialOutOfRangeQuantity,
        initialPackaging: [],
      })

      const form = screen
        .getByRole('button', { name: /cancelar/i })
        .closest('form') as HTMLFormElement
      fireEvent.submit(form)

      expect(onSubmit).not.toHaveBeenCalled()
      expect(
        screen.getByText('Selecione uma quantidade entre 1 e 20 antes de salvar.'),
      ).toBeInTheDocument()
    })

    it('liberação: escolher uma quantidade válida no Select libera o salvamento e envia o novo valor', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({
        initialAccessories: initialOutOfRangeQuantity,
        initialPackaging: [],
      })

      await chooseOption(user, 'Quantidade do acessório', '10')

      const saveButton = screen.getByRole('button', { name: /^salvar$/i })
      expect(saveButton).not.toBeDisabled()

      await user.click(saveButton)

      expect(onSubmit).toHaveBeenCalledWith({
        accessories: [{ id: 'a1', quantity: 10 }],
        packaging: [],
      })
    })
  })
})
