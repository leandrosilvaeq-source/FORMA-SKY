import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { filterSelectableItems, ProductCompositionForm } from './ProductCompositionForm'
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

describe('ProductCompositionForm', () => {
  it('pré-preenche as linhas a partir da composição atual e envia sem alterações', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      accessories: [{ id: 'a1', quantity: 2 }],
      packaging: [{ id: 'k1', quantity: 1 }],
    })
  })

  it('permite editar a quantidade de uma linha pré-preenchida', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    const quantityInput = screen.getByDisplayValue('2')
    await user.clear(quantityInput)
    await user.type(quantityInput, '5')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      accessories: [{ id: 'a1', quantity: 5 }],
      packaging: [{ id: 'k1', quantity: 1 }],
    })
  })

  it('renderiza sem nenhuma composição prévia (0 acessórios, 0 embalagens)', () => {
    renderForm({ initialAccessories: [], initialPackaging: [] })

    expect(screen.getByText('Nenhum acessório na composição.')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma embalagem na composição.')).toBeInTheDocument()
  })

  it('adiciona uma linha vazia ao clicar em "Adicionar acessório"', async () => {
    const user = userEvent.setup()
    renderForm({ initialAccessories: [], initialPackaging: [] })

    await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))

    expect(screen.getByText('Selecione um acessório')).toBeInTheDocument()
  })

  it('remove uma linha ao clicar em "Remover"', async () => {
    const user = userEvent.setup()
    renderForm()

    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /remover acessório/i })[0])

    expect(screen.queryByDisplayValue('2')).not.toBeInTheDocument()
  })

  it('não envia e mostra erro quando uma linha adicionada não tem item selecionado', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ initialAccessories: [], initialPackaging: [] })

    await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(await screen.findByText('Selecione um acessório.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('não envia e mostra erro quando a quantidade de uma linha pré-preenchida é inválida', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    const quantityInput = screen.getByDisplayValue('2')
    await user.clear(quantityInput)
    await user.type(quantityInput, '0')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(await screen.findByText('A quantidade deve ser maior ou igual a 1.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('chama onCancel ao clicar em Cancelar', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  describe('filterSelectableItems (itens inativos)', () => {
    const activeA = { id: 'x1', is_active: true }
    const activeB = { id: 'x2', is_active: true }
    const inactiveC = { id: 'x3', is_active: false }

    it('exclui itens inativos das opções para uma linha nova (sem seleção)', () => {
      const result = filterSelectableItems([activeA, activeB, inactiveC], new Set(), null)

      expect(result.map((item) => item.id)).toEqual(['x1', 'x2'])
    })

    it('mantém o item inativo se ele for o selecionado atual da própria linha', () => {
      const result = filterSelectableItems([activeA, activeB, inactiveC], new Set(), 'x3')

      expect(result.map((item) => item.id)).toEqual(['x1', 'x2', 'x3'])
    })

    it('exclui itens já escolhidos em outras linhas, mesmo ativos', () => {
      const result = filterSelectableItems([activeA, activeB, inactiveC], new Set(['x1']), null)

      expect(result.map((item) => item.id)).toEqual(['x2'])
    })
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

  it('mostra um acessório inativo já vinculado com indicação visual, e continua enviando-o ao salvar sem alterações', async () => {
    const user = userEvent.setup()
    const accessoriesWithInactive: Accessory[] = [
      ...accessories,
      { ...accessories[0], id: 'a3', name: 'Ímã descontinuado', is_active: false },
    ]
    const initialWithInactive: ProductAccessory[] = [
      { id: 'pa2', product_id: 'p1', accessory_id: 'a3', quantity: 4, created_at: '' },
    ]
    const { onSubmit } = renderForm({
      accessories: accessoriesWithInactive,
      initialAccessories: initialWithInactive,
      initialPackaging: [],
    })

    expect(screen.getByText('Ímã descontinuado (inativo)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      accessories: [{ id: 'a3', quantity: 4 }],
      packaging: [],
    })
  })
})
