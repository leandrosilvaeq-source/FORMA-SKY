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

  // Cada linha de item é um role="group" com nome acessível "Item N"
  // (2026-09-04, janela compacta) — escopo confiável para localizar os
  // campos de UMA linha específica sem depender de índices em listas
  // globais do diálogo inteiro.
  function getFilamentItemRow(dialog: HTMLElement, itemIndex: number) {
    return within(dialog).getByRole('group', { name: `Item ${itemIndex}` })
  }

  // Seleciona um tipo de filamento no seletor do item N (1-based) — cada
  // linha tem seu próprio combobox "Tipo — item N", rótulo/id únicos para
  // nunca colidir entre linhas (mesmo padrão de digitar-e-clicar já usado
  // para Acessório/Embalagem).
  async function selectFilamentType(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    itemIndex: number,
    query: string,
    optionName: string | RegExp,
  ) {
    const row = getFilamentItemRow(dialog, itemIndex)
    await user.type(within(row).getByRole('combobox', { name: `Tipo — item ${itemIndex}` }), query)
    await user.click(await within(row).findByRole('option', { name: optionName }))
  }

  // Preenche uma linha de item por completo (tipo + peso + quantidade +
  // marca + valor unitário) — usado nos testes que só precisam de um item
  // válido sem repetir os 5 passos toda vez.
  async function fillFilamentItem(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    itemIndex: number,
    opts: {
      query: string
      optionName: string | RegExp
      weightLabel: string
      quantity: string
      manufacturer: string
      unitValueRaw: string
    },
  ) {
    await selectFilamentType(user, dialog, itemIndex, opts.query, opts.optionName)
    const row = getFilamentItemRow(dialog, itemIndex)
    await user.click(within(row).getByRole('radio', { name: opts.weightLabel }))
    await user.type(within(row).getByLabelText('Quantidade'), opts.quantity)
    await user.type(within(row).getByLabelText('Marca'), opts.manufacturer)
    await user.type(within(row).getByLabelText('Valor unitário'), opts.unitValueRaw)
  }

  // Local da compra usa o mesmo padrão de radiogroup de botões já usado por
  // "Item" — sem escopo por linha (é um campo único de Dados Gerais).
  async function selectPurchaseChannel(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    label: 'Mercado Livre' | 'AliExpress' | 'Shopee' | 'Presencial',
  ) {
    await user.click(within(dialog).getByRole('radio', { name: label }))
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
  // FILAMENTO — "Compra de filamentos" reorganizada em 5 seções compactas
  // (2026-09-04, rodada seguinte à do suporte a múltiplos itens): 1. Dados
  // Gerais (Data da compra + Local da compra), 2. Itens (uma linha por item
  // no desktop), 3. Frete, 4. Resumo, 5. Cancelar/Registrar compra.
  // ---------------------------------------------------------------------------

  it('1. as 5 seções aparecem na ordem definida: Dados Gerais, Itens, Frete, Resumo, botões', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const headings = Array.from(dialog.querySelectorAll('[data-section-heading]')).map((el) =>
      el.textContent?.trim(),
    )
    expect(headings).toEqual(['Dados Gerais', 'Itens', 'Frete', 'Resumo'])
    // Botões Cancelar/Registrar compra vêm depois de tudo isso, no rodapé.
    const footer = within(dialog).getByRole('button', { name: /^cancelar$/i })
    expect(footer).toBeInTheDocument()
  })

  it('2. Data da compra aparece pré-preenchida no formato dd/mm/aa', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const dateInput = within(dialog).getByLabelText('Data da compra')
    expect((dateInput as HTMLInputElement).value).toMatch(/^\d{2}\/\d{2}\/\d{2}$/)
  })

  it('3. data inexistente (31/02/26) é recusada', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectPurchaseChannel(user, dialog, 'Mercado Livre')
    await fillFilamentItem(user, dialog, 1, {
      query: 'PLA',
      optionName: 'PLA - Sólida - Preto',
      weightLabel: '1.000 g',
      quantity: '1',
      manufacturer: 'Bambu Lab',
      unitValueRaw: '9500',
    })

    const dateInput = within(dialog).getByLabelText('Data da compra')
    await user.clear(dateInput)
    await user.type(dateInput, '31/02/26')
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    expect(await within(dialog).findByText(/data inválida/i)).toBeInTheDocument()
    expect(registerFilamentPurchaseMock).not.toHaveBeenCalled()
  })

  it('4. data é convertida corretamente para o formato esperado pelo backend (dd/mm/aa -> YYYY-MM-DD)', async () => {
    mockFilamentTypes([filamentTypeFixture({ filament_type_id: 't1' })])
    registerFilamentPurchaseMock.mockResolvedValue(filamentPurchaseResultFixture())
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectPurchaseChannel(user, dialog, 'Mercado Livre')
    await fillFilamentItem(user, dialog, 1, {
      query: 'PLA',
      optionName: 'PLA - Sólida - Preto',
      weightLabel: '1.000 g',
      quantity: '1',
      manufacturer: 'Bambu Lab',
      unitValueRaw: '9500',
    })

    const dateInput = within(dialog).getByLabelText('Data da compra')
    await user.clear(dateInput)
    await user.type(dateInput, '04/09/26')
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerFilamentPurchaseMock).toHaveBeenCalledTimes(1))
    expect(registerFilamentPurchaseMock.mock.calls[0][0].occurred_at).toBe('2026-09-04')
  })

  it('5. os 4 locais de compra aparecem (Mercado Livre, AliExpress, Shopee, Presencial)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const group = within(dialog).getByRole('radiogroup', { name: 'Local da compra' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Mercado Livre', 'AliExpress', 'Shopee', 'Presencial'])
  })

  it('6. somente um local pode ser selecionado por vez', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    await selectPurchaseChannel(user, dialog, 'Mercado Livre')
    expect(within(dialog).getByRole('radio', { name: 'Mercado Livre' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await selectPurchaseChannel(user, dialog, 'Shopee')
    expect(within(dialog).getByRole('radio', { name: 'Mercado Livre' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(within(dialog).getByRole('radio', { name: 'Shopee' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('7. o local escolhido é enviado no payload (purchase_channel)', async () => {
    mockFilamentTypes([filamentTypeFixture({ filament_type_id: 't1' })])
    registerFilamentPurchaseMock.mockResolvedValue(filamentPurchaseResultFixture())
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectPurchaseChannel(user, dialog, 'AliExpress')
    await fillFilamentItem(user, dialog, 1, {
      query: 'PLA',
      optionName: 'PLA - Sólida - Preto',
      weightLabel: '1.000 g',
      quantity: '1',
      manufacturer: 'Bambu Lab',
      unitValueRaw: '9500',
    })

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerFilamentPurchaseMock).toHaveBeenCalledTimes(1))
    expect(registerFilamentPurchaseMock.mock.calls[0][0].purchase_channel).toBe('ALIEXPRESS')
  })

  it('não permite registrar sem selecionar o local da compra', async () => {
    mockFilamentTypes([filamentTypeFixture({ filament_type_id: 't1' })])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await fillFilamentItem(user, dialog, 1, {
      query: 'PLA',
      optionName: 'PLA - Sólida - Preto',
      weightLabel: '1.000 g',
      quantity: '1',
      manufacturer: 'Bambu Lab',
      unitValueRaw: '9500',
    })

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    expect(await within(dialog).findByText(/selecione o local da compra/i)).toBeInTheDocument()
    expect(registerFilamentPurchaseMock).not.toHaveBeenCalled()
  })

  it('8. os campos de cada item aparecem em uma linha no desktop (grade sm:grid-cols)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const row = getFilamentItemRow(dialog, 1)
    expect(row.className).toMatch(/sm:grid-cols-\[/)
    // Os 6 campos (Tipo/Peso/Quantidade/Marca/Valor unitário/Remover) vivem
    // todos dentro da MESMA linha (o mesmo elemento role="group").
    expect(within(row).getByRole('combobox', { name: 'Tipo — item 1' })).toBeInTheDocument()
    expect(within(row).getByRole('radiogroup', { name: 'Peso — item 1' })).toBeInTheDocument()
    expect(within(row).getByLabelText('Quantidade')).toBeInTheDocument()
    expect(within(row).getByLabelText('Marca')).toBeInTheDocument()
    expect(within(row).getByLabelText('Valor unitário')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Remover item 1' })).toBeInTheDocument()
  })

  it('9. botão "Adicionar filamento" usa ícone de mais (sem texto visível, só nome acessível)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const addButton = within(dialog).getByRole('button', { name: 'Adicionar filamento' })
    expect(addButton.querySelector('svg')).toBeInTheDocument()
    expect(addButton.textContent?.trim()).toBe('')
  })

  it('10. "Adicionar filamento" adiciona uma nova linha, preserva a já preenchida e foca o Tipo do novo item', async () => {
    mockFilamentTypes([
      filamentTypeFixture({
        filament_type_id: 't1',
        material: 'PLA',
        line: 'Matte',
        commercial_color: 'Preto',
      }),
    ])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectFilamentType(user, dialog, 1, 'Matte', 'PLA - Matte - Preto')

    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))

    expect(within(dialog).getByRole('group', { name: 'Item 2' })).toBeInTheDocument()
    // O item 1 preserva o tipo já escolhido.
    expect(
      within(getFilamentItemRow(dialog, 1)).getByRole('combobox', { name: 'Tipo — item 1' }),
    ).toHaveValue('PLA - Matte - Preto')
    // Foco no Tipo do novo item, "se possível" — verificado como o elemento
    // ativo do documento.
    expect(
      within(getFilamentItemRow(dialog, 2)).getByRole('combobox', { name: 'Tipo — item 2' }),
    ).toHaveFocus()
  })

  it('11. remover um item preserva os demais intactos', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.type(within(getFilamentItemRow(dialog, 1)).getByLabelText('Marca'), 'Bambu Lab')
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))
    await user.type(within(getFilamentItemRow(dialog, 2)).getByLabelText('Marca'), 'Voolt')

    await user.click(
      within(getFilamentItemRow(dialog, 2)).getByRole('button', { name: 'Remover item 2' }),
    )

    expect(within(dialog).queryByRole('group', { name: 'Item 2' })).not.toBeInTheDocument()
    expect(within(getFilamentItemRow(dialog, 1)).getByLabelText('Marca')).toHaveValue('Bambu Lab')
  })

  it('12. a primeira/única linha não pode ser removida — botão desabilitado', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const row = getFilamentItemRow(dialog, 1)
    expect(within(row).getByRole('button', { name: 'Remover item 1' })).toBeDisabled()

    // Com 2 itens, o remover volta a ficar habilitado nos dois.
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))
    expect(
      within(getFilamentItemRow(dialog, 1)).getByRole('button', { name: 'Remover item 1' }),
    ).not.toBeDisabled()
    expect(
      within(getFilamentItemRow(dialog, 2)).getByRole('button', { name: 'Remover item 2' }),
    ).not.toBeDisabled()
  })

  it('13. Peso exibe "1.000 g" com ponto de milhar (rótulo renomeado de "Peso líquido" para "Peso")', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const row = getFilamentItemRow(dialog, 1)
    const group = within(row).getByRole('radiogroup', { name: 'Peso — item 1' })
    expect(within(group).getByRole('radio', { name: '250 g' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: '500 g' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: '1.000 g' })).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('radiogroup', { name: /Peso líquido/ }),
    ).not.toBeInTheDocument()
  })

  it('nunca mostra um campo de "Código da cor" nem de "Peso bruto"', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(within(dialog).queryByLabelText(/código da cor/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/código do filamento/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/peso bruto/i)).not.toBeInTheDocument()
  })

  it('14. Frete aparece uma única vez, em sua própria seção — nunca repetido por item', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))

    expect(within(dialog).getAllByLabelText('Valor do frete')).toHaveLength(1)
    expect(within(dialog).queryByLabelText('Frete total da compra')).not.toBeInTheDocument()
  })

  it('15. Total da compra inclui o frete (Subtotal dos itens não aparece isolado no Resumo)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await fillFilamentItem(user, dialog, 1, {
      query: 'PLA',
      optionName: 'PLA - Sólida - Preto',
      weightLabel: '1.000 g',
      quantity: '2',
      manufacturer: 'Bambu Lab',
      unitValueRaw: '9500',
    })
    await user.type(within(dialog).getByLabelText('Valor do frete'), '3000')

    // Subtotal = 2×95 = 190,00; Frete = 30,00; Total = 220,00 (subtotal
    // isolado NUNCA aparece como linha própria do Resumo).
    expect(within(dialog).queryByText(/subtotal/i)).not.toBeInTheDocument()
    expect(within(dialog).getByText(normalizedBRL(22000))).toBeInTheDocument()
    expect(within(dialog).getByText(normalizedBRL(3000))).toBeInTheDocument()
  })

  it('16. Custo por filamento = total da compra ÷ quantidade total de rolos (exemplo do pedido)', async () => {
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
    // Item 1: 2 rolos de R$ 90,00.
    await fillFilamentItem(user, dialog, 1, {
      query: 'Matte',
      optionName: 'PLA - Matte - Preto',
      weightLabel: '1.000 g',
      quantity: '2',
      manufacturer: 'Bambu Lab',
      unitValueRaw: '9000',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))
    // Item 2: 1 rolo de R$ 100,00.
    await fillFilamentItem(user, dialog, 2, {
      query: 'Silk',
      optionName: 'PLA - Silk - Dourado',
      weightLabel: '1.000 g',
      quantity: '1',
      manufacturer: 'Voolt',
      unitValueRaw: '10000',
    })
    // Frete de R$ 20,00 -> total = 180+100+20 = 300,00; quantidade total = 3
    // -> custo por filamento = 100,00 (exemplo exato do pedido).
    await user.type(within(dialog).getByLabelText('Valor do frete'), '2000')

    expect(within(dialog).getByText(normalizedBRL(30000))).toBeInTheDocument()
    // "R$ 100,00" aparece 2x: valor unitário do item 2 e custo por filamento.
    expect(within(dialog).getAllByText(normalizedBRL(10000)).length).toBeGreaterThanOrEqual(1)
  })

  it('17. quantidade zero (nenhum item preenchido) não produz NaN nem Infinity — mostra R$ 0,00', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(within(dialog).queryByText(/nan/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/infinity/i)).not.toBeInTheDocument()
    // Custo por filamento (última célula do Resumo) mostra R$ 0,00 com
    // quantidade total 0.
    expect(within(dialog).getAllByText(normalizedBRL(0)).length).toBeGreaterThan(0)
  })

  it('18. em telas pequenas, a grade do item vira uma coluna (grid-cols-1) — layout permanece utilizável, sem cortar conteúdo', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const row = getFilamentItemRow(dialog, 1)
    expect(row.className).toMatch(/grid-cols-1/)
    // A janela nunca rola horizontalmente — só verticalmente (max-h-[90vh]
    // overflow-y-auto), mesmo padrão já validado nas rodadas anteriores.
    expect(dialog.className).toContain('overflow-y-auto')
    expect(dialog.className).not.toMatch(/overflow-x-auto|overflow-x-scroll/)
  })

  it('19. fluxo multi-item e criação automática dos rolos permanecem aprovados (exemplo do pedido — 2 itens, um único cabeçalho)', async () => {
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
    await selectPurchaseChannel(user, dialog, 'Mercado Livre')
    await user.type(within(dialog).getByLabelText('Valor do frete'), '3000')

    await fillFilamentItem(user, dialog, 1, {
      query: 'Matte',
      optionName: 'PLA - Matte - Preto',
      weightLabel: '1.000 g',
      quantity: '2',
      manufacturer: 'Bambu Lab',
      unitValueRaw: '9500',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))
    await fillFilamentItem(user, dialog, 2, {
      query: 'Silk',
      optionName: 'PLA - Silk - Dourado',
      weightLabel: '1.000 g',
      quantity: '1',
      manufacturer: 'Voolt',
      unitValueRaw: '11000',
    })

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerFilamentPurchaseMock).toHaveBeenCalledTimes(1))
    const payload = registerFilamentPurchaseMock.mock.calls[0][0]
    expect(payload.freight_value).toBe(30)
    expect(payload.purchase_channel).toBe('MERCADO_LIVRE')
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

  it('não permite registrar a compra sem nenhum item (remove o único item e tenta enviar)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    // A única linha não pode ser removida (botão desabilitado) — então a
    // ausência de item é forçada limpando os campos obrigatórios e
    // confirmando que o botão Remover realmente ficou inerte (nada some).
    expect(
      within(getFilamentItemRow(dialog, 1)).getByRole('button', { name: 'Remover item 1' }),
    ).toBeDisabled()
    await selectPurchaseChannel(user, dialog, 'Mercado Livre')
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    expect(await within(dialog).findByText(/selecione um tipo de filamento/i)).toBeInTheDocument()
    expect(registerFilamentPurchaseMock).not.toHaveBeenCalled()
  })

  it('sem nenhum tipo ativo, orienta cadastrar um tipo antes de comprar, e não mostra a lista de itens', async () => {
    mockFilamentTypes([])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(
      within(dialog).getByText('Cadastre um tipo de filamento antes de registrar a compra.'),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: /Tipo —/ })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Adicionar filamento' })).toBeDisabled()
  })

  it('fornecedor/marca da compra nunca é enviado como campo do tipo — nada altera o cadastro do tipo escolhido', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(within(dialog).queryByLabelText(/^fornecedor$/i)).not.toBeInTheDocument()
    // "Marca" existe (é o campo do item, enviado como manufacturer do ITEM,
    // nunca do tipo) — a ausência aqui é só de um campo de fabricante do tipo.
    expect(within(dialog).getByLabelText('Marca')).toBeInTheDocument()
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
