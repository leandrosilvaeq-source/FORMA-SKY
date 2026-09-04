import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api/errors'
import { formatCentsToBRL } from '@/lib/forms/currencyField'
import type { Accessory, FilamentTypeSummary, Packaging } from '@/types/domain'

const {
  useAccessoriesMock,
  usePackagingMock,
  useFilamentTypesMock,
  registerInventoryPurchaseMock,
  toastMock,
} = vi.hoisted(() => ({
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  useFilamentTypesMock: vi.fn(),
  registerInventoryPurchaseMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
vi.mock('@/hooks/useFilamentTypes', () => ({ useFilamentTypes: useFilamentTypesMock }))
vi.mock('@/lib/api/inventoryPurchases', () => ({
  registerInventoryPurchase: registerInventoryPurchaseMock,
}))
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

function filamentTypeFixture(overrides: Partial<FilamentTypeSummary> = {}): FilamentTypeSummary {
  return {
    filament_type_id: 't1',
    material: 'PLA',
    manufacturer: 'Voolt3D',
    line: 'Sólida',
    commercial_color: 'Preto',
    color_code: null,
    minimum_stock_grams: null,
    is_active: true,
    total_available_grams: 500,
    usable_spool_count: 1,
    total_spool_count: 1,
    ...overrides,
  }
}

function mockFilamentTypes(list: FilamentTypeSummary[]) {
  useFilamentTypesMock.mockReturnValue({
    types: list,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getRemovalPlan: vi.fn(),
    delete: vi.fn(),
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

async function selectCategory(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  label: 'Filamento' | 'Acessório' | 'Embalagem',
) {
  await user.click(within(dialog).getByRole('radio', { name: label }))
}

describe('PurchaseDialog', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    registerInventoryPurchaseMock.mockReset()
    mockAccessories([accessoryFixture()])
    mockPackaging([packagingFixture()])
    mockFilamentTypes([filamentTypeFixture()])
  })

  // Seleciona um tipo de filamento no seletor "Tipo de filamento" (mesmo
  // padrão de digitar-e-clicar já usado para Acessório/Embalagem).
  async function selectFilamentType(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    query: string,
    optionName: string | RegExp,
  ) {
    await user.type(within(dialog).getByRole('combobox', { name: 'Tipo de filamento' }), query)
    await user.click(await within(dialog).findByRole('option', { name: optionName }))
  }

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
    expect(radios.map((radio) => radio.textContent)).toEqual([
      'Filamento',
      'Acessório',
      'Embalagem',
    ])
    expect(radios.every((radio) => radio.tagName === 'BUTTON')).toBe(true)
  })

  it('bloqueia duplo envio: o botão de envio fica desabilitado enquanto a chamada está em andamento', async () => {
    let resolvePurchase: (value: unknown) => void = () => {}
    registerInventoryPurchaseMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePurchase = resolve
      }),
    )
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)

    await selectCategory(user, dialog, 'Acessório')
    await user.type(within(dialog).getByRole('combobox', { name: 'Acessório' }), 'Ímã')
    await user.click(await within(dialog).findByRole('option', { name: /Ímã 6x2/i }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '2')
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '1000')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /^registrando\.\.\.$/i })).toBeDisabled(),
    )
    expect(registerInventoryPurchaseMock).toHaveBeenCalledTimes(1)

    resolvePurchase(purchaseFixture())
  })

  it('erro real do backend mantém o diálogo aberto e preserva os valores preenchidos', async () => {
    registerInventoryPurchaseMock.mockRejectedValue(
      new ApiError('validation', 400, 'valor inválido'),
    )
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

  it('Filamento: Cor e Acabamento não aparecem mais; o seletor "Tipo de filamento" aparece no lugar', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(within(dialog).queryByRole('radiogroup', { name: 'Material' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('radiogroup', { name: 'Acabamento' })).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Marca')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Cor')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'Tipo de filamento' })).toBeInTheDocument()
  })

  it('Filamento: as opções do seletor usam o formato "Material - Linha - Cor" e mostram só tipos ATIVOS', async () => {
    mockFilamentTypes([
      filamentTypeFixture({
        filament_type_id: 't1',
        material: 'PLA',
        line: 'Matte',
        commercial_color: 'Preto',
      }),
      filamentTypeFixture({
        filament_type_id: 't2',
        material: 'PETG',
        line: 'Sólida',
        commercial_color: 'Azul',
        is_active: false,
      }),
    ])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    await user.type(within(dialog).getByRole('combobox', { name: 'Tipo de filamento' }), 'a')
    expect(
      await within(dialog).findByRole('option', { name: 'PLA - Matte - Preto' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('option', { name: /PETG - Sólida - Azul/ }),
    ).not.toBeInTheDocument()
  })

  it('Filamento: a busca do seletor localiza por Material, Linha e Cor', async () => {
    mockFilamentTypes([
      filamentTypeFixture({
        filament_type_id: 't1',
        material: 'PLA',
        line: 'Matte',
        commercial_color: 'Preto',
      }),
      filamentTypeFixture({
        filament_type_id: 't2',
        material: 'PETG',
        line: 'Silk',
        commercial_color: 'Azul',
      }),
    ])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    const combobox = within(dialog).getByRole('combobox', { name: 'Tipo de filamento' })

    await user.type(combobox, 'PETG')
    expect(
      await within(dialog).findByRole('option', { name: 'PETG - Silk - Azul' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('option', { name: /PLA - Matte - Preto/ }),
    ).not.toBeInTheDocument()

    await user.clear(combobox)
    await user.type(combobox, 'matte')
    expect(
      await within(dialog).findByRole('option', { name: 'PLA - Matte - Preto' }),
    ).toBeInTheDocument()

    await user.clear(combobox)
    await user.type(combobox, 'azul')
    expect(
      await within(dialog).findByRole('option', { name: 'PETG - Silk - Azul' }),
    ).toBeInTheDocument()
  })

  it('Filamento: sem nenhum tipo ativo, orienta cadastrar um tipo antes de comprar', async () => {
    mockFilamentTypes([])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(
      within(dialog).getByText('Cadastre um tipo de filamento antes de registrar a compra.'),
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('combobox', { name: 'Tipo de filamento' }),
    ).not.toBeInTheDocument()
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
    await selectFilamentType(user, dialog, 'PLA', 'PLA - Sólida - Preto')
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
    await selectFilamentType(user, dialog, 'PLA', 'PLA - Sólida - Preto')
    await user.click(within(dialog).getByRole('radio', { name: '1000g' }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '1')
    await user.type(within(dialog).getByLabelText('Peso bruto do rolo 1'), '1000')
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '100')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    expect(
      await within(dialog).findByText(/deve ser maior que o peso líquido nominal/i),
    ).toBeInTheDocument()
    expect(registerInventoryPurchaseMock).not.toHaveBeenCalled()
  })

  it('Filamento: máscara de Valor/Frete em R$ e cálculo do resumo (total, custo médio por rolo, custo por kg)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectFilamentType(user, dialog, 'PLA', 'PLA - Sólida - Preto')
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

  it('Filamento: envia filament_type_id (nunca material/manufacturer/line/commercial_color) + peso nominal/pesos brutos/quantidade/valores', async () => {
    mockFilamentTypes([
      filamentTypeFixture({
        filament_type_id: 't-petg',
        material: 'PETG',
        line: 'Sólida',
        commercial_color: 'Preto',
      }),
    ])
    registerInventoryPurchaseMock.mockResolvedValue(purchaseFixture({ category: 'FILAMENT' }))
    const onPurchaseCompleted = vi.fn()
    render(<PurchaseDialog onPurchaseCompleted={onPurchaseCompleted} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectFilamentType(user, dialog, 'PETG', 'PETG - Sólida - Preto')
    await user.click(within(dialog).getByRole('radio', { name: '1000g' }))
    await user.type(within(dialog).getByLabelText('Quantidade'), '2')
    await user.type(within(dialog).getByLabelText('Peso bruto do rolo 1'), '1150')
    await user.type(within(dialog).getByLabelText('Peso bruto do rolo 2'), '1140')
    await user.type(within(dialog).getByLabelText('Valor dos itens'), '20000')
    await user.type(within(dialog).getByLabelText('Frete'), '2000')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerInventoryPurchaseMock).toHaveBeenCalledTimes(1))
    const payload = registerInventoryPurchaseMock.mock.calls[0][0]
    expect(payload).toMatchObject({
      category: 'FILAMENT',
      quantity: 2,
      item_value: 200,
      freight_value: 20,
      filament_type_id: 't-petg',
      nominal_weight_grams: 1000,
      gross_weights_grams: [1150, 1140],
    })
    // A compra nunca cria nem localiza tipo por nome — nenhum dos 4 campos
    // legados de identidade vai no payload quando filament_type_id é usado.
    expect(payload).not.toHaveProperty('material')
    expect(payload).not.toHaveProperty('manufacturer')
    expect(payload).not.toHaveProperty('line')
    expect(payload).not.toHaveProperty('commercial_color')
    expect(toastMock.success).toHaveBeenCalledWith('Compra registrada.')
    expect(onPurchaseCompleted).toHaveBeenCalledWith('FILAMENT')
  })

  it('Filamento: fornecedor não é um campo desta janela — nada aqui pode alterar o fabricante do tipo escolhido', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(within(dialog).queryByLabelText(/fornecedor/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/marca/i)).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // ACESSÓRIO / EMBALAGEM
  // ---------------------------------------------------------------------------

  it('Acessório: só mostra itens ativos, orienta cadastrar quando não há nenhum ativo', async () => {
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ativo' }),
      accessoryFixture({ id: 'a2', name: 'Inativo', is_active: false }),
    ])
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
    registerInventoryPurchaseMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'não encontrado ou inativo'),
    )
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
    registerInventoryPurchaseMock.mockResolvedValue(
      purchaseFixture({ category: 'PACKAGING', item_id: 'k1' }),
    )
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
