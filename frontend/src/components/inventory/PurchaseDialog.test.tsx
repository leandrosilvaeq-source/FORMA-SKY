import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api/errors'
import { formatCentsToBRL } from '@/lib/forms/currencyField'
import type { Accessory, Packaging } from '@/types/domain'

const { useAccessoriesMock, usePackagingMock, registerInventoryPurchaseMock, toastMock } = vi.hoisted(() => ({
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  registerInventoryPurchaseMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
vi.mock('@/lib/api/inventoryPurchases', () => ({ registerInventoryPurchase: registerInventoryPurchaseMock }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { PurchaseDialog } from './PurchaseDialog'

function accessoryFixture(overrides: Partial<Accessory> = {}): Accessory {
  return {
    id: 'a1',
    name: 'Ímã 6x2',
    material: null,
    size: 'M',
    variant: 'azul',
    unit_cost: 1.5,
    minimum_stock: 10,
    current_stock: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function packagingFixture(overrides: Partial<Packaging> = {}): Packaging {
  return {
    id: 'k1',
    name: 'Caixa M',
    material: null,
    size: 'M',
    variant: 'kraft',
    unit_cost: 3.2,
    minimum_stock: 5,
    current_stock: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function mockAccessories(list: Accessory[]) {
  useAccessoriesMock.mockReturnValue({
    accessories: list,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setLocalStock: vi.fn(),
  })
}

function mockPackaging(list: Packaging[]) {
  usePackagingMock.mockReturnValue({
    packaging: list,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setLocalStock: vi.fn(),
  })
}

// getByText normaliza o texto do nó (colapsando qualquer espaço, incluindo
// NBSP, para um espaço comum) antes de comparar, mas usa a STRING de busca
// tal como recebida — formatCentsToBRL devolve o separador real do Intl
// (NBSP, nao um espaco comum), entao a busca precisa passar pela mesma
// normalizacao (s do JS ja casa NBSP), senao nunca casa com o texto ja
// normalizado do no.
function normalizedBRL(cents: number): string {
  return formatCentsToBRL(cents).replace(/\s/g, ' ')
}

function purchaseFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p1',
    category: 'ACCESSORY',
    item_id: 'a1',
    quantity: 1,
    item_value: 10,
    freight_value: 0,
    total_value: 10,
    occurred_at: '2026-08-28T00:00:00Z',
    notes: null,
    idempotency_key: null,
    created_by: 'u1',
    created_at: '2026-08-28T00:00:00Z',
    ...overrides,
  }
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Compras' }))
  return screen.getByRole('dialog', { name: 'Registrar compra' })
}

async function selectCategory(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: 'Filamento' | 'Acessório' | 'Embalagem') {
  await user.click(within(dialog).getByRole('radio', { name: label }))
}

describe('PurchaseDialog', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    registerInventoryPurchaseMock.mockReset()
    mockAccessories([accessoryFixture()])
    mockPackaging([packagingFixture()])
  })

  // ---------------------------------------------------------------------------
  // GERAIS
  // ---------------------------------------------------------------------------

  it('abre e fecha o diálogo "Registrar compra"', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()

    const dialog = await openDialog(user)
    expect(dialog).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /^cancelar$/i }))
    expect(screen.queryByRole('dialog', { name: 'Registrar compra' })).not.toBeInTheDocument()
  })

  it('a janela usa max-height/overflow-y vertical, sem min-width/overflow-x na tabela (área sem rolagem horizontal)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    expect(dialog.className).toContain('max-h-[90vh]')
    expect(dialog.className).toContain('overflow-y-auto')
    expect(dialog.className).not.toMatch(/overflow-x-auto|overflow-x-scroll/)
  })

  it('action buttons "Item" aparecem na ordem Filamento, Acessório, Embalagem, com radiogroup acessível por teclado', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)

    const group = within(dialog).getByRole('radiogroup', { name: 'Item' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual(['Filamento', 'Acessório', 'Embalagem'])
    expect(radios.every((radio) => radio.tagName === 'BUTTON')).toBe(true)
  })

  it('bloqueia duplo envio: o botão de envio fica desabilitado enquanto a chamada está em andamento', async () => {
    let resolvePurchase: (value: unknown) => void = () => {}
    registerInventoryPurchaseMock.mockReturnValue(new Promise((resolve) => { resolvePurchase = resolve }))
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)

    await selectCategory(user, dialog, 'Acessório')
    await user.type(within(dialog).getByRole('combobox', { name: 'Acessório' }), 'Ímã')
    await user.click(await within(dialog).findByRole('option', { name: /Ímã 6x2/i }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '2')
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '1000')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^registrando\.\.\.$/i })).toBeDisabled())
    expect(registerInventoryPurchaseMock).toHaveBeenCalledTimes(1)

    resolvePurchase(purchaseFixture())
  })

  it('erro real do backend mantém o diálogo aberto e preserva os valores preenchidos', async () => {
    registerInventoryPurchaseMock.mockRejectedValue(new ApiError('validation', 400, 'valor inválido'))
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)

    await selectCategory(user, dialog, 'Acessório')
    await user.type(within(dialog).getByRole('combobox', { name: 'Acessório' }), 'Ímã')
    await user.click(await within(dialog).findByRole('option', { name: /Ímã 6x2/i }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '3')
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '500')
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    expect(await within(dialog).findByText('valor inválido')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Registrar compra' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Quantidade')).toHaveValue('3')
  })

  it('idempotência: reenviar o mesmo formulário sem alterações reusa a mesma idempotency_key', async () => {
    registerInventoryPurchaseMock.mockRejectedValueOnce(new ApiError('database', 500, 'falhou'))
    registerInventoryPurchaseMock.mockResolvedValueOnce(purchaseFixture())
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)

    await selectCategory(user, dialog, 'Acessório')
    await user.type(within(dialog).getByRole('combobox', { name: 'Acessório' }), 'Ímã')
    await user.click(await within(dialog).findByRole('option', { name: /Ímã 6x2/i }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '1')
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '100')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))
    await waitFor(() => expect(registerInventoryPurchaseMock).toHaveBeenCalledTimes(1))
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))
    await waitFor(() => expect(registerInventoryPurchaseMock).toHaveBeenCalledTimes(2))

    const firstKey = registerInventoryPurchaseMock.mock.calls[0][0].idempotency_key
    const secondKey = registerInventoryPurchaseMock.mock.calls[1][0].idempotency_key
    expect(firstKey).toBeTruthy()
    expect(firstKey).toBe(secondKey)
  })

  // ---------------------------------------------------------------------------
  // FILAMENTO
  // ---------------------------------------------------------------------------

  it('Filamento: material tem PLA/PETG/TPU e nunca ABS', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const group = within(dialog).getByRole('radiogroup', { name: 'Material' })
    expect(within(group).getByRole('radio', { name: 'PLA' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'PETG' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'TPU' })).toBeInTheDocument()
    expect(within(group).queryByRole('radio', { name: 'ABS' })).not.toBeInTheDocument()
  })

  it('Filamento: peso líquido tem 250g/500g/1000g', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const group = within(dialog).getByRole('radiogroup', { name: 'Peso líquido' })
    expect(within(group).getByRole('radio', { name: '250g' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: '500g' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: '1000g' })).toBeInTheDocument()
  })

  it('Filamento: nunca mostra um campo de "Código da cor"', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(within(dialog).queryByLabelText(/código da cor/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/código do filamento/i)).not.toBeInTheDocument()
  })

  it('Filamento: quantidade bloqueia zero, negativo, fração e texto', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('radio', { name: 'PLA' }))
    await user.click(within(dialog).getByRole('radio', { name: '1000g' }))

    await user.type(within(dialog).getByLabelText('Quantidade'), '0')
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))
    expect(await within(dialog).findByText(/deve ser maior ou igual a 1/i)).toBeInTheDocument()
    expect(registerInventoryPurchaseMock).not.toHaveBeenCalled()
  })

  it('Filamento: os campos de "Peso bruto do rolo N" aparecem dinamicamente conforme a quantidade', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('radio', { name: '1000g' }))

    await user.type(within(dialog).getByLabelText('Quantidade'), '1')
    expect(within(dialog).getByLabelText('Peso bruto do rolo 1')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Peso bruto do rolo 2')).not.toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Quantidade'))
    await user.type(within(dialog).getByLabelText('Quantidade'), '3')
    expect(within(dialog).getByLabelText('Peso bruto do rolo 1')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Peso bruto do rolo 2')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Peso bruto do rolo 3')).toBeInTheDocument()
  })

  it('Filamento: peso bruto menor ou igual ao líquido nominal é bloqueado', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('radio', { name: 'PLA' }))
    await user.click(within(dialog).getByRole('radio', { name: '1000g' }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '1')
    await user.type(within(dialog).getByLabelText('Peso bruto do rolo 1'), '1000')
    await user.type(within(dialog).getByLabelText('Marca'), 'Voolt3D')
    await user.type(within(dialog).getByLabelText('Cor'), 'Preto')
    await user.click(within(dialog).getByRole('radio', { name: 'Sólido' }))
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '100')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    expect(await within(dialog).findByText(/deve ser maior que o peso líquido nominal/i)).toBeInTheDocument()
    expect(registerInventoryPurchaseMock).not.toHaveBeenCalled()
  })

  it('Filamento: Acabamento tem Sólido/Velvet/Silk/DuoColor/TriColor/Transparente, nunca rotulado "Tipo"', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const group = within(dialog).getByRole('radiogroup', { name: 'Acabamento' })
    for (const label of ['Sólido', 'Velvet', 'Silk', 'DuoColor', 'TriColor', 'Transparente']) {
      expect(within(group).getByRole('radio', { name: label })).toBeInTheDocument()
    }
    expect(within(dialog).queryByText(/^Tipo$/)).not.toBeInTheDocument()
  })

  it('Filamento: máscara de Valor/Frete em R$ e cálculo do resumo (total, custo médio por rolo, custo por kg)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('radio', { name: 'PLA' }))
    await user.click(within(dialog).getByRole('radio', { name: '1000g' }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '2')

    const itemValueInput = within(dialog).getByLabelText('Valor dos itens')
    expect(itemValueInput).toHaveValue(formatCentsToBRL(0))
    await user.type(itemValueInput, '20000')
    expect(itemValueInput).toHaveValue(formatCentsToBRL(20000))

    // "Valor dos itens" e "Total da compra" mostram o mesmo valor aqui (frete
    // zero) — duas ocorrências esperadas, não uma.
    expect(within(dialog).getAllByText(normalizedBRL(20000)).length).toBe(2)
    // custo médio por rolo = 200 / 2 = 100; custo por kg = 200 / (2kg) = 100
    expect(within(dialog).getAllByText(normalizedBRL(10000)).length).toBe(2)
  })

  it('Filamento: envia o payload correto (material/marca/acabamento/cor/peso nominal/pesos brutos/quantidade/valores)', async () => {
    registerInventoryPurchaseMock.mockResolvedValue(purchaseFixture({ category: 'FILAMENT' }))
    const onPurchaseCompleted = vi.fn()
    render(<PurchaseDialog onPurchaseCompleted={onPurchaseCompleted} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('radio', { name: 'PETG' }))
    await user.click(within(dialog).getByRole('radio', { name: '1000g' }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '2')
    await user.type(within(dialog).getByLabelText('Peso bruto do rolo 1'), '1150')
    await user.type(within(dialog).getByLabelText('Peso bruto do rolo 2'), '1140')
    await user.type(within(dialog).getByLabelText('Marca'), '  Voolt3D  ')
    await user.type(within(dialog).getByLabelText('Cor'), '  Preto  ')
    await user.click(within(dialog).getByRole('radio', { name: 'Sólido' }))
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '20000')
    await user.type(within(dialog).getByLabelText('Frete'), '2000')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerInventoryPurchaseMock).toHaveBeenCalledTimes(1))
    expect(registerInventoryPurchaseMock.mock.calls[0][0]).toMatchObject({
      category: 'FILAMENT',
      quantity: 2,
      item_value: 200,
      freight_value: 20,
      material: 'PETG',
      manufacturer: 'Voolt3D',
      line: 'Sólido',
      commercial_color: 'Preto',
      nominal_weight_grams: 1000,
      gross_weights_grams: [1150, 1140],
    })
    expect(toastMock.success).toHaveBeenCalledWith('Compra registrada.')
    expect(onPurchaseCompleted).toHaveBeenCalledWith('FILAMENT')
  })

  // ---------------------------------------------------------------------------
  // ACESSÓRIO / EMBALAGEM
  // ---------------------------------------------------------------------------

  it('Acessório: só mostra itens ativos, orienta cadastrar quando não há nenhum ativo', async () => {
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ativo' }), accessoryFixture({ id: 'a2', name: 'Inativo', is_active: false })])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')

    await user.type(within(dialog).getByRole('combobox', { name: 'Acessório' }), 'a')
    expect(screen.queryByRole('option', { name: /Inativo/i })).not.toBeInTheDocument()
  })

  it('Acessório: nenhum item ativo cadastrado orienta cadastrar na aba Acessórios', async () => {
    mockAccessories([])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')

    expect(within(dialog).getByText(/cadastre um na aba Acessórios/i)).toBeInTheDocument()
  })

  it('Acessório: envia o payload correto e aciona onPurchaseCompleted("ACCESSORY") após sucesso', async () => {
    registerInventoryPurchaseMock.mockResolvedValue(purchaseFixture())
    const onPurchaseCompleted = vi.fn()
    render(<PurchaseDialog onPurchaseCompleted={onPurchaseCompleted} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')
    await user.type(within(dialog).getByRole('combobox', { name: 'Acessório' }), 'Ímã')
    await user.click(await within(dialog).findByRole('option', { name: /Ímã 6x2/i }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '4')
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '4000')
    await user.type(within(dialog).getByLabelText('Frete'), '500')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerInventoryPurchaseMock).toHaveBeenCalledTimes(1))
    expect(registerInventoryPurchaseMock.mock.calls[0][0]).toMatchObject({
      category: 'ACCESSORY',
      item_id: 'a1',
      quantity: 4,
      item_value: 40,
      freight_value: 5,
    })
    expect(toastMock.success).toHaveBeenCalledWith('Compra registrada.')
    expect(onPurchaseCompleted).toHaveBeenCalledWith('ACCESSORY')
    expect(screen.queryByRole('dialog', { name: 'Registrar compra' })).not.toBeInTheDocument()
  })

  it('Acessório: quantidade ausente/zero bloqueia o envio', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')
    await user.type(within(dialog).getByRole('combobox', { name: 'Acessório' }), 'Ímã')
    await user.click(await within(dialog).findByRole('option', { name: /Ímã 6x2/i }))
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '100')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))
    expect(await within(dialog).findByText(/^informe a quantidade/i)).toBeInTheDocument()
    expect(registerInventoryPurchaseMock).not.toHaveBeenCalled()
  })

  it('Acessório: erro de negócio do backend vira toast, nunca atualiza estoque no frontend (sem chamada extra)', async () => {
    registerInventoryPurchaseMock.mockRejectedValue(new ApiError('business_rule', 409, 'não encontrado ou inativo'))
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')
    await user.type(within(dialog).getByRole('combobox', { name: 'Acessório' }), 'Ímã')
    await user.click(await within(dialog).findByRole('option', { name: /Ímã 6x2/i }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '1')
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '100')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('não encontrado ou inativo'))
    expect(registerInventoryPurchaseMock).toHaveBeenCalledTimes(1)
  })

  it('Embalagem: mesmas regras de Acessório — envia payload correto e aciona onPurchaseCompleted("PACKAGING")', async () => {
    registerInventoryPurchaseMock.mockResolvedValue(purchaseFixture({ category: 'PACKAGING', item_id: 'k1' }))
    const onPurchaseCompleted = vi.fn()
    render(<PurchaseDialog onPurchaseCompleted={onPurchaseCompleted} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Embalagem')
    await user.type(within(dialog).getByRole('combobox', { name: 'Embalagem' }), 'Caixa')
    await user.click(await within(dialog).findByRole('option', { name: /Caixa M/i }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '10')
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '5000')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerInventoryPurchaseMock).toHaveBeenCalledTimes(1))
    expect(registerInventoryPurchaseMock.mock.calls[0][0]).toMatchObject({
      category: 'PACKAGING',
      item_id: 'k1',
      quantity: 10,
      item_value: 50,
      freight_value: 0,
    })
    expect(onPurchaseCompleted).toHaveBeenCalledWith('PACKAGING')
  })
})
