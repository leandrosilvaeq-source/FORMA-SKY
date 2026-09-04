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
  registerFilamentPurchaseMock,
  toastMock,
} = vi.hoisted(() => ({
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  useFilamentTypesMock: vi.fn(),
  registerInventoryPurchaseMock: vi.fn(),
  registerFilamentPurchaseMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
vi.mock('@/hooks/useFilamentTypes', () => ({ useFilamentTypes: useFilamentTypesMock }))
vi.mock('@/lib/api/inventoryPurchases', () => ({
  registerInventoryPurchase: registerInventoryPurchaseMock,
  registerFilamentPurchase: registerFilamentPurchaseMock,
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

function filamentPurchaseResultFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    purchase_id: 'fp1',
    occurred_at: '2026-09-04T00:00:00Z',
    notes: null,
    freight_value: 30,
    subtotal_value: 300,
    total_value: 330,
    created_at: '2026-09-04T00:00:00Z',
    items: [],
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
    registerFilamentPurchaseMock.mockReset()
    mockAccessories([accessoryFixture()])
    mockPackaging([packagingFixture()])
    mockFilamentTypes([filamentTypeFixture()])
  })

  // Seleciona um tipo de filamento no seletor do item N (1-based) — cada
  // linha de item tem seu próprio combobox "Tipo de filamento — item N",
  // rótulo/id únicos para nunca colidir entre linhas (mesmo padrão de
  // digitar-e-clicar já usado para Acessório/Embalagem).
  async function selectFilamentType(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    itemIndex: number,
    query: string,
    optionName: string | RegExp,
  ) {
    await user.type(
      within(dialog).getByRole('combobox', { name: `Tipo de filamento — item ${itemIndex}` }),
      query,
    )
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
  // FILAMENTO — Compra de filamentos com múltiplos itens (2026-09-04)
  // ---------------------------------------------------------------------------

  it('Filamento: o título do diálogo muda para "Compra de filamentos"', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(
      within(dialog).getByRole('heading', { name: 'Compra de filamentos' }),
    ).toBeInTheDocument()
  })

  it('Filamento: a janela abre com exatamente 1 item vazio', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(within(dialog).getByText('Item 1')).toBeInTheDocument()
    expect(within(dialog).queryByText('Item 2')).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole('combobox', { name: 'Tipo de filamento — item 1' }),
    ).toBeInTheDocument()
  })

  it('Filamento: "Adicionar filamento" cria outro item', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    await user.click(within(dialog).getByRole('button', { name: /^adicionar filamento$/i }))
    expect(within(dialog).getByText('Item 2')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('combobox', { name: 'Tipo de filamento — item 2' }),
    ).toBeInTheDocument()
  })

  it('Filamento: "Remover item" remove a linha correspondente', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('button', { name: /^adicionar filamento$/i }))
    expect(within(dialog).getByText('Item 2')).toBeInTheDocument()

    const removeButtons = within(dialog).getAllByRole('button', { name: /^remover item$/i })
    await user.click(removeButtons[1])

    expect(within(dialog).getByText('Item 1')).toBeInTheDocument()
    expect(within(dialog).queryByText('Item 2')).not.toBeInTheDocument()
  })

  it('Filamento: não permite registrar a compra sem nenhum item (remove o único item e tenta enviar)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    await user.click(within(dialog).getByRole('button', { name: /^remover item$/i }))
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    expect(await within(dialog).findByText(/adicione ao menos um item/i)).toBeInTheDocument()
    expect(registerFilamentPurchaseMock).not.toHaveBeenCalled()
  })

  it('Filamento: cada item aceita um tipo de filamento diferente', async () => {
    mockFilamentTypes([
      filamentTypeFixture({
        filament_type_id: 't1',
        material: 'PLA',
        line: 'Matte',
        commercial_color: 'Preto',
      }),
      filamentTypeFixture({
        filament_type_id: 't2',
        material: 'PLA',
        line: 'Silk',
        commercial_color: 'Dourado',
      }),
    ])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('button', { name: /^adicionar filamento$/i }))

    await selectFilamentType(user, dialog, 1, 'Matte', 'PLA - Matte - Preto')
    await selectFilamentType(user, dialog, 2, 'Silk', 'PLA - Silk - Dourado')

    expect(
      within(dialog).getByRole('combobox', { name: 'Tipo de filamento — item 1' }),
    ).toHaveValue('PLA - Matte - Preto')
    expect(
      within(dialog).getByRole('combobox', { name: 'Tipo de filamento — item 2' }),
    ).toHaveValue('PLA - Silk - Dourado')
  })

  it('Filamento: cada item aceita uma marca diferente', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('button', { name: /^adicionar filamento$/i }))

    const manufacturerInputs = within(dialog).getAllByLabelText('Marca')
    await user.type(manufacturerInputs[0], 'Bambu Lab')
    await user.type(manufacturerInputs[1], 'Voolt')

    expect(within(dialog).getAllByLabelText('Marca')[0]).toHaveValue('Bambu Lab')
    expect(within(dialog).getAllByLabelText('Marca')[1]).toHaveValue('Voolt')
  })

  it('Filamento: Peso Líquido exibe "1.000 g" com ponto de milhar, nunca "1000g" sem formatação', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const group = within(dialog).getByRole('radiogroup', { name: 'Peso líquido — item 1' })
    expect(within(group).getByRole('radio', { name: '250 g' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: '500 g' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: '1.000 g' })).toBeInTheDocument()
    expect(within(group).queryByRole('radio', { name: '1000g' })).not.toBeInTheDocument()
    expect(within(group).queryByRole('radio', { name: '1000 g' })).not.toBeInTheDocument()
  })

  it('Filamento: nunca mostra um campo de "Código da cor" nem de "Peso bruto"', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectFilamentType(user, dialog, 1, 'PLA', 'PLA - Sólida - Preto')
    await user.click(within(dialog).getByRole('radio', { name: '1.000 g' }))

    expect(within(dialog).queryByLabelText(/código da cor/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/código do filamento/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/peso bruto/i)).not.toBeInTheDocument()
  })

  it('Filamento: quantidade do item precisa ser inteira e positiva (bloqueia zero)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectFilamentType(user, dialog, 1, 'PLA', 'PLA - Sólida - Preto')
    await user.click(within(dialog).getByRole('radio', { name: '1.000 g' }))
    await user.type(within(dialog).getAllByLabelText('Marca')[0], 'Bambu Lab')
    await user.type(within(dialog).getByLabelText('Valor unitário'), '9500')
    await user.type(within(dialog).getByLabelText('Quantidade'), '0')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    expect(await within(dialog).findByText(/deve ser maior ou igual a 1/i)).toBeInTheDocument()
    expect(registerFilamentPurchaseMock).not.toHaveBeenCalled()
  })

  it('Filamento: subtotal soma quantidade × valor unitário de todos os itens', async () => {
    mockFilamentTypes([
      filamentTypeFixture({
        filament_type_id: 't1',
        material: 'PLA',
        line: 'Matte',
        commercial_color: 'Preto',
      }),
      filamentTypeFixture({
        filament_type_id: 't2',
        material: 'PLA',
        line: 'Silk',
        commercial_color: 'Dourado',
      }),
    ])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('button', { name: /^adicionar filamento$/i }))

    // Item 1: quantidade 2, valor unitário R$ 95,00 -> 190,00
    await user.type(within(dialog).getAllByLabelText('Quantidade')[0], '2')
    await user.type(within(dialog).getAllByLabelText('Valor unitário')[0], '9500')
    // Item 2: quantidade 1, valor unitário R$ 110,00 -> 110,00
    await user.type(within(dialog).getAllByLabelText('Quantidade')[1], '1')
    await user.type(within(dialog).getAllByLabelText('Valor unitário')[1], '11000')
    // Frete não-zero só para distinguir Subtotal (300) de Total (320) na
    // asserção abaixo — a soma em si (quantidade × valor unitário de cada
    // item) já está completa antes desta linha.
    await user.type(within(dialog).getByLabelText('Frete total da compra'), '2000')

    // Subtotal = 190 + 110 = 300,00 (frete NUNCA entra nesta soma)
    expect(within(dialog).getByText(normalizedBRL(30000))).toBeInTheDocument()
  })

  it('Filamento: frete é registrado uma única vez (campo único em Dados gerais da compra, não por item)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('button', { name: /^adicionar filamento$/i }))

    expect(within(dialog).getAllByLabelText('Frete total da compra')).toHaveLength(1)
  })

  it('Filamento: total = subtotal + frete', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectFilamentType(user, dialog, 1, 'PLA', 'PLA - Sólida - Preto')
    await user.type(within(dialog).getByLabelText('Quantidade'), '2')
    await user.type(within(dialog).getByLabelText('Valor unitário'), '9500')
    await user.type(within(dialog).getByLabelText('Frete total da compra'), '3000')

    // Subtotal = 2×95 = 190,00; Frete = 30,00; Total = 220,00
    expect(within(dialog).getByText(normalizedBRL(19000))).toBeInTheDocument()
    expect(within(dialog).getByText(normalizedBRL(3000))).toBeInTheDocument()
    expect(within(dialog).getByText(normalizedBRL(22000))).toBeInTheDocument()
  })

  it('Filamento: sem nenhum tipo ativo, orienta cadastrar um tipo antes de comprar, e não mostra a lista de itens', async () => {
    mockFilamentTypes([])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(
      within(dialog).getByText('Cadastre um tipo de filamento antes de registrar a compra.'),
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('combobox', { name: /Tipo de filamento/ }),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: /^adicionar filamento$/i }),
    ).not.toBeInTheDocument()
  })

  it('Filamento: exemplo do pedido — 2 itens (tipos/marcas diferentes) geram UM cabeçalho com 2 itens no payload', async () => {
    mockFilamentTypes([
      filamentTypeFixture({
        filament_type_id: 't-matte',
        material: 'PLA',
        line: 'Matte',
        commercial_color: 'Preto',
      }),
      filamentTypeFixture({
        filament_type_id: 't-silk',
        material: 'PLA',
        line: 'Silk',
        commercial_color: 'Dourado',
      }),
    ])
    registerFilamentPurchaseMock.mockResolvedValue(filamentPurchaseResultFixture())
    const onPurchaseCompleted = vi.fn()
    render(<PurchaseDialog onPurchaseCompleted={onPurchaseCompleted} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.type(within(dialog).getByLabelText('Frete total da compra'), '3000')

    await selectFilamentType(user, dialog, 1, 'Matte', 'PLA - Matte - Preto')
    const firstWeightGroup = within(dialog).getAllByRole('radiogroup', { name: /Peso líquido/ })[0]
    await user.click(within(firstWeightGroup).getByRole('radio', { name: '1.000 g' }))
    await user.type(within(dialog).getAllByLabelText('Quantidade')[0], '2')
    await user.type(within(dialog).getAllByLabelText('Marca')[0], 'Bambu Lab')
    await user.type(within(dialog).getAllByLabelText('Valor unitário')[0], '9500')

    await user.click(within(dialog).getByRole('button', { name: /^adicionar filamento$/i }))
    await selectFilamentType(user, dialog, 2, 'Silk', 'PLA - Silk - Dourado')
    const weightGroups = within(dialog).getAllByRole('radiogroup', { name: /Peso líquido/ })
    await user.click(within(weightGroups[1]).getByRole('radio', { name: '1.000 g' }))
    await user.type(within(dialog).getAllByLabelText('Quantidade')[1], '1')
    await user.type(within(dialog).getAllByLabelText('Marca')[1], 'Voolt')
    await user.type(within(dialog).getAllByLabelText('Valor unitário')[1], '11000')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerFilamentPurchaseMock).toHaveBeenCalledTimes(1))
    const payload = registerFilamentPurchaseMock.mock.calls[0][0]
    expect(payload.freight_value).toBe(30)
    expect(payload.items).toHaveLength(2)
    expect(payload.items).toContainEqual({
      filament_type_id: 't-matte',
      manufacturer: 'Bambu Lab',
      nominal_weight_grams: 1000,
      quantity: 2,
      unit_value: 95,
    })
    expect(payload.items).toContainEqual({
      filament_type_id: 't-silk',
      manufacturer: 'Voolt',
      nominal_weight_grams: 1000,
      quantity: 1,
      unit_value: 110,
    })
    // Nunca cria/localiza tipo por nome — nenhum campo legado de identidade.
    expect(payload).not.toHaveProperty('category')
    expect(payload).not.toHaveProperty('material')
    expect(payload).not.toHaveProperty('manufacturer')
    expect(payload).not.toHaveProperty('line')
    expect(payload).not.toHaveProperty('commercial_color')
    expect(toastMock.success).toHaveBeenCalledWith('Compra registrada.')
    expect(onPurchaseCompleted).toHaveBeenCalledWith('FILAMENT')
  })

  it('Filamento: fornecedor/marca da compra nunca é enviado como campo do tipo — nada altera o cadastro do tipo escolhido', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(within(dialog).queryByLabelText(/^fornecedor$/i)).not.toBeInTheDocument()
    // "Marca" existe (é o campo do item, enviado como manufacturer do ITEM,
    // nunca do tipo) — a ausência aqui é só de um campo de fabricante do tipo.
    expect(within(dialog).getAllByLabelText('Marca').length).toBeGreaterThan(0)
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
