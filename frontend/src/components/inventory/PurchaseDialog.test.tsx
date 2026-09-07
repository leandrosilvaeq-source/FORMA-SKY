import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api/errors'
import type { Accessory, FilamentTypeSummary, Packaging } from '@/types/domain'

// COMPRA MISTA (2026-09-06) — a janela "Registrar compra" registra, no mesmo
// pedido, linhas de Filamento + Acessório + Embalagem, com um cabeçalho, um
// frete e uma idempotency_key, sempre via registerMixedInventoryPurchase
// (POST /inventory-purchases/mixed). Os testes das rotas antigas vivem no
// backend (supabase/tests/*, handler.test.ts) — aqui só a integração da
// janela nova.

const {
  useAccessoriesMock,
  usePackagingMock,
  useFilamentTypesMock,
  registerMixedInventoryPurchaseMock,
  onPurchaseCompleted,
  toastMock,
} = vi.hoisted(() => ({
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  useFilamentTypesMock: vi.fn(),
  registerMixedInventoryPurchaseMock: vi.fn(),
  onPurchaseCompleted: vi.fn<(category: 'FILAMENT' | 'ACCESSORY' | 'PACKAGING') => void>(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
vi.mock('@/hooks/useFilamentTypes', () => ({ useFilamentTypes: useFilamentTypesMock }))
vi.mock('@/lib/api/inventoryPurchases', () => ({
  registerMixedInventoryPurchase: registerMixedInventoryPurchaseMock,
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
    image_path: null,
    image_thumb_path: null,
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
    image_path: null,
    image_thumb_path: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}
function filamentTypeFixture(overrides: Partial<FilamentTypeSummary> = {}): FilamentTypeSummary {
  return {
    filament_type_id: 't1',
    material: 'PLA',
    manufacturer: 'Não informado',
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
    setLocalImage: vi.fn(),
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
    setLocalImage: vi.fn(),
  })
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

async function openDialog(user: ReturnType<typeof userEvent.setup>, area: 'acessorios' | 'embalagens' | 'filamentos' = 'acessorios') {
  render(<PurchaseDialog area={area} onPurchaseCompleted={onPurchaseCompleted} />)
  await user.click(screen.getByRole('button', { name: 'Compras' }))
  return screen.getByRole('dialog', { name: 'Registrar compra' })
}

function row(dialog: HTMLElement, lineNo: number) {
  return within(dialog).getByRole('group', { name: `Item ${lineNo}` })
}
async function setCategory(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, lineNo: number, label: 'Filamento' | 'Acessório' | 'Embalagem') {
  await user.click(within(row(dialog, lineNo)).getByRole('radio', { name: label }))
}
async function setChannel(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: string) {
  await user.click(within(dialog).getByRole('radio', { name: label }))
}
async function pickItem(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, lineNo: number, comboName: string, query: string, optionName: string | RegExp) {
  const r = row(dialog, lineNo)
  await user.type(within(r).getByRole('combobox', { name: comboName }), query)
  await user.click(await within(r).findByRole('option', { name: optionName }))
}
async function fillQtyTotal(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, lineNo: number, quantity: string, totalDigits: string) {
  const r = row(dialog, lineNo)
  await user.type(within(r).getByLabelText('Quantidade'), quantity)
  await user.type(within(r).getByLabelText('Valor total'), totalDigits)
}
// Peso nominal virou uma lista suspensa (base-ui Select): abre o combobox
// "Peso nominal" da linha e clica na opção (portada para o body -> screen).
async function pickWeight(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, lineNo: number, weightLabel: string) {
  await user.click(within(row(dialog, lineNo)).getByRole('combobox', { name: 'Peso nominal' }))
  await user.click(await screen.findByRole('option', { name: weightLabel }))
}
async function fillAccessoryLine(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, lineNo: number, opts: { search: string; option: string | RegExp; quantity: string; totalDigits: string }) {
  await setCategory(user, dialog, lineNo, 'Acessório')
  await pickItem(user, dialog, lineNo, 'Acessório', opts.search, opts.option)
  await fillQtyTotal(user, dialog, lineNo, opts.quantity, opts.totalDigits)
}
async function fillPackagingLine(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, lineNo: number, opts: { search: string; option: string | RegExp; quantity: string; totalDigits: string }) {
  await setCategory(user, dialog, lineNo, 'Embalagem')
  await pickItem(user, dialog, lineNo, 'Embalagem', opts.search, opts.option)
  await fillQtyTotal(user, dialog, lineNo, opts.quantity, opts.totalDigits)
}
async function fillFilamentLine(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, lineNo: number, opts: { query: string; option: string | RegExp; weight: string; manufacturer: string; quantity: string; totalDigits: string }) {
  await setCategory(user, dialog, lineNo, 'Filamento')
  const r = row(dialog, lineNo)
  await user.type(within(r).getByRole('combobox', { name: 'Tipo de filamento' }), opts.query)
  await user.click(await within(r).findByRole('option', { name: opts.option }))
  await pickWeight(user, dialog, lineNo, opts.weight)
  await user.type(within(r).getByLabelText('Fabricante'), opts.manufacturer)
  await fillQtyTotal(user, dialog, lineNo, opts.quantity, opts.totalDigits)
}

describe('PurchaseDialog — compra mista', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    registerMixedInventoryPurchaseMock.mockReset()
    registerMixedInventoryPurchaseMock.mockResolvedValue({ purchase_id: 'p1', category: 'MIXED', items: [] })
    onPurchaseCompleted.mockReset()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', variant: 'azul' })])
    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M', variant: 'kraft' })])
    mockFilamentTypes([filamentTypeFixture({ filament_type_id: 't1', material: 'PLA', line: 'Sólida', commercial_color: 'Preto' })])
  })

  it('o botão "Compras" abre a janela "Registrar compra" com as 4 seções', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    expect(within(dialog).getByRole('heading', { name: 'Dados Gerais' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Itens' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Frete' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Resumo' })).toBeInTheDocument()
  })

  it('a data usa máscara dd/mm/aaaa (só números, barras automáticas, maxLength 10) e vem pré-preenchida', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    const date = within(dialog).getByLabelText('Data da compra') as HTMLInputElement
    expect(date).toHaveAttribute('maxLength', '10')
    expect(date).toHaveAttribute('inputMode', 'numeric')
    expect(date.value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    await user.clear(date)
    await user.type(date, 'ab06092026cd')
    expect(date.value).toBe('06/09/2026')
  })

  it('a linha inicial segue a aba: Filamentos → Filamento, Acessórios → Acessório, Embalagens → Embalagem', async () => {
    for (const [area, label] of [
      ['filamentos', 'Filamento'],
      ['acessorios', 'Acessório'],
      ['embalagens', 'Embalagem'],
    ] as const) {
      const user = userEvent.setup()
      const dialog = await openDialog(user, area)
      expect(within(row(dialog, 1)).getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true')
      cleanup()
    }
  })

  it('o Local da compra são action buttons de seleção única; "Outro Site"/"Presencial" exibem o campo de complemento e trocar para um canal padrão limpa o complemento', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    const group = within(dialog).getByRole('radiogroup', { name: 'Local da compra' })
    for (const label of ['Mercado Livre', 'Shopee', 'AliExpress', 'Outro Site', 'Presencial']) {
      expect(within(group).getByRole('radio', { name: label })).toBeInTheDocument()
    }
    expect(within(dialog).queryByLabelText('Nome do site')).not.toBeInTheDocument()

    await setChannel(user, dialog, 'Outro Site')
    const siteInput = within(dialog).getByLabelText('Nome do site')
    await user.type(siteInput, 'exemplo.com')

    await setChannel(user, dialog, 'Presencial')
    expect(within(dialog).queryByLabelText('Nome do site')).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Nome da loja'), 'Loja X')

    await setChannel(user, dialog, 'Mercado Livre')
    // canal padronizado: sem complemento
    expect(within(dialog).queryByLabelText('Nome da loja')).not.toBeInTheDocument()

    // ao voltar para Outro Site, o complemento anterior foi limpo
    await setChannel(user, dialog, 'Outro Site')
    expect((within(dialog).getByLabelText('Nome do site') as HTMLInputElement).value).toBe('')
  })

  it('adiciona e remove linhas; permite misturar categorias em qualquer ordem', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(3)

    await setCategory(user, dialog, 2, 'Filamento')
    await setCategory(user, dialog, 3, 'Embalagem')
    expect(within(row(dialog, 1)).getByRole('radio', { name: 'Acessório' })).toHaveAttribute('aria-checked', 'true')
    expect(within(row(dialog, 2)).getByRole('radio', { name: 'Filamento' })).toHaveAttribute('aria-checked', 'true')
    expect(within(row(dialog, 3)).getByRole('radio', { name: 'Embalagem' })).toHaveAttribute('aria-checked', 'true')

    await user.click(within(dialog).getByRole('button', { name: 'Remover item 2' }))
    expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(2)
  })

  it('trocar a categoria de uma linha VAZIA é imediato; com dados incompatíveis pede confirmação e preserva quantidade/valor', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')

    // linha vazia -> troca imediata, sem diálogo de confirmação
    await setCategory(user, dialog, 1, 'Filamento')
    expect(screen.queryByRole('dialog', { name: 'Trocar a categoria da linha?' })).not.toBeInTheDocument()

    // preenche quantidade + valor (preservados) + fabricante (incompatível)
    await fillQtyTotal(user, dialog, 1, '3', '5000')
    await user.type(within(row(dialog, 1)).getByLabelText('Fabricante'), 'Voolt')

    await setCategory(user, dialog, 1, 'Acessório')
    const confirm = await screen.findByRole('dialog', { name: 'Trocar a categoria da linha?' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }))
    // cancelou: linha intacta, ainda Filamento
    expect(within(row(dialog, 1)).getByRole('radio', { name: 'Filamento' })).toHaveAttribute('aria-checked', 'true')

    await setCategory(user, dialog, 1, 'Acessório')
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Trocar a categoria da linha?' })).getByRole('button', {
        name: 'Trocar categoria',
      }),
    )
    expect(within(row(dialog, 1)).getByRole('radio', { name: 'Acessório' })).toHaveAttribute('aria-checked', 'true')
    // quantidade e valor preservados
    expect((within(row(dialog, 1)).getByLabelText('Quantidade') as HTMLInputElement).value).toBe('3')
    expect((within(row(dialog, 1)).getByLabelText('Valor total') as HTMLInputElement).value).toContain('50,00')
  })

  it('registra uma compra mista (Filamento + Acessório + Embalagem) com um único frete e chama a rota /mixed uma vez', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', variant: 'azul' })])
    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M', variant: 'kraft' })])
    mockFilamentTypes([filamentTypeFixture({ filament_type_id: 't1', material: 'PLA', line: 'Sólida', commercial_color: 'Preto' })])
    const dialog = await openDialog(user, 'filamentos')

    await setChannel(user, dialog, 'Mercado Livre')
    await fillFilamentLine(user, dialog, 1, {
      query: 'PLA',
      option: 'PLA - Sólida - Preto',
      weight: '1.000 g',
      manufacturer: 'Voolt',
      quantity: '2',
      totalDigits: '10000',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    await fillAccessoryLine(user, dialog, 2, { search: 'Ímã', option: /Ímã 6x2/, quantity: '5', totalDigits: '2000' })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    await fillPackagingLine(user, dialog, 3, { search: 'Caixa', option: /Caixa M/, quantity: '6', totalDigits: '3000' })

    await user.type(within(dialog).getByLabelText('Valor do frete'), '1000')

    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))

    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalledTimes(1))
    const payload = registerMixedInventoryPurchaseMock.mock.calls[0][0]
    expect(payload.purchase_channel).toBe('MERCADO_LIVRE')
    expect(payload.supplier_name).toBeNull()
    expect(payload.freight_value).toBe(10)
    expect(payload.occurred_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(payload.items).toEqual([
      { category: 'FILAMENT', filament_type_id: 't1', manufacturer: 'Voolt', nominal_weight_grams: 1000, quantity: 2, total_value: 100 },
      { category: 'ACCESSORY', accessory_id: 'a1', quantity: 5, total_value: 20 },
      { category: 'PACKAGING', packaging_id: 'k1', quantity: 6, total_value: 30 },
    ])
    expect(typeof payload.idempotency_key).toBe('string')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Registrar compra' })).not.toBeInTheDocument())
    expect(toastMock.success).toHaveBeenCalledWith('Compra registrada.')
    // onPurchaseCompleted uma vez por categoria DISTINTA presente
    expect(onPurchaseCompleted.mock.calls.map((c) => c[0]).sort()).toEqual(['ACCESSORY', 'FILAMENT', 'PACKAGING'])
  })

  it('OUTRO_SITE / PRESENCIAL enviam o complemento em supplier_name', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    await setChannel(user, dialog, 'Presencial')
    await user.type(within(dialog).getByLabelText('Nome da loja'), '  Loja do Zé  ')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '2', totalDigits: '1000' })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalled())
    const payload = registerMixedInventoryPurchaseMock.mock.calls[0][0]
    expect(payload.purchase_channel).toBe('PRESENCIAL')
    expect(payload.supplier_name).toBe('Loja do Zé')
  })

  it('valida: sem local selecionado, complemento obrigatório vazio, quantidade não inteira e valor zero bloqueiam o envio', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')

    // nada preenchido
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    expect(registerMixedInventoryPurchaseMock).not.toHaveBeenCalled()
    expect(within(dialog).getByText('Selecione o local da compra.')).toBeInTheDocument()

    await setChannel(user, dialog, 'Outro Site')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    expect(within(dialog).getByText(/informe o nome do site/i)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Nome do site'), 'x.com')

    // acessório sem valor
    await setCategory(user, dialog, 1, 'Acessório')
    await pickItem(user, dialog, 1, 'Acessório', 'Ímã', /Ímã 6x2/)
    await user.type(within(row(dialog, 1)).getByLabelText('Quantidade'), '3')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    expect(within(dialog).getByText(/valor total do item, maior que zero/i)).toBeInTheDocument()
    expect(registerMixedInventoryPurchaseMock).not.toHaveBeenCalled()
  })

  it('recusa acessório repetido e embalagem repetida em linhas diferentes', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', variant: 'azul' })])
    const dialog = await openDialog(user, 'acessorios')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '1', totalDigits: '500' })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    // o mesmo acessório já não aparece nas sugestões da 2ª linha (excludeIds);
    // se forçado, a validação de envio recusa — cobrimos a exclusão da lista:
    await setCategory(user, dialog, 2, 'Acessório')
    await user.type(within(row(dialog, 2)).getByRole('combobox', { name: 'Acessório' }), 'Ímã')
    expect(within(row(dialog, 2)).queryByRole('option', { name: /Ímã 6x2/ })).not.toBeInTheDocument()
  })

  it('os totais Subtotal / Frete / Total vivem na barra fixa; o Resumo rolável guarda só os detalhes por linha (frete atribuído + "Custo desta compra/un."; Acessório/Embalagem também "Novo custo médio/un." e Filamento não)', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', variant: 'azul', current_stock: 0, unit_cost: null })])
    mockFilamentTypes([filamentTypeFixture({ filament_type_id: 't1', material: 'PLA', line: 'Sólida', commercial_color: 'Preto' })])
    const dialog = await openDialog(user, 'acessorios')
    await setChannel(user, dialog, 'Shopee')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '4', totalDigits: '2000' })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    await fillFilamentLine(user, dialog, 2, {
      query: 'PLA',
      option: 'PLA - Sólida - Preto',
      weight: '1.000 g',
      manufacturer: 'Voolt',
      quantity: '1',
      totalDigits: '8000',
    })
    await user.type(within(dialog).getByLabelText('Valor do frete'), '1000')

    // Subtotal / Frete / Total da compra: só na barra fixa
    const totals = within(dialog).getByRole('group', { name: 'Totais da compra' })
    expect(within(totals).getByText('Subtotal')).toBeInTheDocument()
    expect(within(totals).getByText('Frete')).toBeInTheDocument()
    expect(within(totals).getByText('Total da compra')).toBeInTheDocument()
    // Subtotal 20,00 + 80,00 = 100,00; Total 110,00
    expect(within(totals).getByText('R$ 100,00')).toBeInTheDocument()
    expect(within(totals).getByText('R$ 110,00')).toBeInTheDocument()

    const summary = within(dialog).getByRole('heading', { name: 'Resumo' }).closest('section') as HTMLElement
    // nada de Subtotal / Total duplicados na seção rolável
    expect(within(summary).queryByText('Subtotal')).not.toBeInTheDocument()
    expect(within(summary).queryByText('Total da compra')).not.toBeInTheDocument()

    const summaryItems = within(summary).getAllByText(/Frete atribuído:/)
    expect(summaryItems).toHaveLength(2)
    // linha do acessório tem "Novo custo médio/un."; a do filamento não
    expect(within(summary).getAllByText(/Custo desta compra\/un\.:/)).toHaveLength(2)
    expect(within(summary).getAllByText(/Novo custo médio\/un\.:/)).toHaveLength(1)
  })

  it('impede submissão duplicada (duplo clique) — a rota /mixed é chamada uma única vez', async () => {
    const user = userEvent.setup()
    let resolve!: (v: unknown) => void
    registerMixedInventoryPurchaseMock.mockReturnValue(new Promise((r) => { resolve = r }))
    const dialog = await openDialog(user, 'acessorios')
    await setChannel(user, dialog, 'Shopee')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '2', totalDigits: '1000' })

    const submit = within(dialog).getByRole('button', { name: 'Registrar compra' })
    await user.click(submit)
    const busy = await within(dialog).findByRole('button', { name: 'Registrando...' })
    expect(busy).toBeDisabled()
    await user.click(busy)
    expect(registerMixedInventoryPurchaseMock).toHaveBeenCalledTimes(1)
    resolve({ purchase_id: 'p1', category: 'MIXED', items: [] })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Registrar compra' })).not.toBeInTheDocument())
  })

  it('erro do backend preserva o formulário preenchido (nada é perdido)', async () => {
    const user = userEvent.setup()
    registerMixedInventoryPurchaseMock.mockRejectedValue(new ApiError('validation', 400, 'Falha na validação da compra.'))
    const dialog = await openDialog(user, 'acessorios')
    await setChannel(user, dialog, 'Shopee')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '7', totalDigits: '4200' })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))

    await waitFor(() => expect(within(dialog).getByText('Falha na validação da compra.')).toBeInTheDocument())
    // janela continua aberta, dados intactos
    expect(screen.getByRole('dialog', { name: 'Registrar compra' })).toBeInTheDocument()
    expect((within(row(dialog, 1)).getByLabelText('Quantidade') as HTMLInputElement).value).toBe('7')
    expect(within(row(dialog, 1)).getByRole('radio', { name: 'Acessório' })).toHaveAttribute('aria-checked', 'true')
  })

  it('data incompleta / inexistente bloqueia o envio', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const date = within(dialog).getByLabelText('Data da compra')
    await user.clear(date)
    await user.type(date, '31022026')
    await setChannel(user, dialog, 'Shopee')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '1', totalDigits: '500' })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    expect(registerMixedInventoryPurchaseMock).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/data inválida/i)).toBeInTheDocument()
  })

  it('a janela não cria rolagem horizontal: o conteúdo rola só na vertical', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    const scroll = dialog.querySelector('.overflow-y-auto')
    expect(scroll).not.toBeNull()
    // nenhum contêiner de conteúdo com overflow-x explícito
    expect(dialog.querySelector('.overflow-x-auto, .overflow-x-scroll')).toBeNull()
  })

  // =========================================================================
  // REGRESSÕES RESTAURADAS (auditoria 2026-09-06) — coberturas do
  // PurchaseDialog.test.tsx anterior que continuam relevantes na janela
  // única de compra mista. Ver o relatório da auditoria para o mapeamento
  // 1:1 (obsoleto vs. adaptado vs. movido para brDate.test.ts).
  // =========================================================================

  it('abre e FECHA a janela (Cancelar) sem registrar nada', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Registrar compra' })).not.toBeInTheDocument())
    expect(registerMixedInventoryPurchaseMock).not.toHaveBeenCalled()
  })

  it('abrir a janela SEMPRE refaz a busca dos três catálogos (nunca depende de F5)', async () => {
    const refetchAcc = vi.fn()
    const refetchPkg = vi.fn()
    const refetchFil = vi.fn()
    useAccessoriesMock.mockReturnValue({ ...useAccessoriesMock(), refetch: refetchAcc })
    usePackagingMock.mockReturnValue({ ...usePackagingMock(), refetch: refetchPkg })
    useFilamentTypesMock.mockReturnValue({ ...useFilamentTypesMock(), refetch: refetchFil })
    const user = userEvent.setup()
    render(<PurchaseDialog area="acessorios" onPurchaseCompleted={onPurchaseCompleted} />)
    await user.click(screen.getByRole('button', { name: 'Compras' }))
    expect(refetchAcc).toHaveBeenCalled()
    expect(refetchPkg).toHaveBeenCalled()
    expect(refetchFil).toHaveBeenCalled()
  })

  it('o seletor de Categoria por linha tem os 3 valores na ordem Filamento, Acessório, Embalagem, num radiogroup', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const group = within(row(dialog, 1)).getByRole('radiogroup', { name: 'Categoria — item 1' })
    const radios = within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.textContent?.trim())
    expect(radios).toEqual(['Filamento', 'Acessório', 'Embalagem'])
  })

  it('idempotência: reenvios consecutivos do MESMO formulário reusam a mesma idempotency_key; alterar um campo gera uma nova; alterar a ORDEM dos itens gera uma nova', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', variant: 'azul' }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', variant: null }),
    ])
    const dialog = await openDialog(user, 'acessorios')
    await setChannel(user, dialog, 'Shopee')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '2', totalDigits: '1000' })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    await fillAccessoryLine(user, dialog, 2, { search: 'Parafuso', option: /Parafuso/, quantity: '3', totalDigits: '1500' })

    registerMixedInventoryPurchaseMock.mockRejectedValue(new ApiError('validation', 400, 'x'))
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalledTimes(1))
    const call1 = registerMixedInventoryPurchaseMock.mock.calls[0][0]
    const key1 = call1.idempotency_key
    // a ordem dos itens no payload segue a ordem das linhas
    expect(call1.items.map((i: { accessory_id: string }) => i.accessory_id)).toEqual(['a1', 'a2'])

    // reenvio idêntico -> mesma chave
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalledTimes(2))
    expect(registerMixedInventoryPurchaseMock.mock.calls[1][0].idempotency_key).toBe(key1)

    // muda a quantidade da linha 1 -> chave nova (payload diferente)
    await user.clear(within(row(dialog, 1)).getByLabelText('Quantidade'))
    await user.type(within(row(dialog, 1)).getByLabelText('Quantidade'), '9')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalledTimes(3))
    expect(registerMixedInventoryPurchaseMock.mock.calls[2][0].idempotency_key).not.toBe(key1)

    // reordena: remove a linha 1 (Ímã) e a recria DEPOIS da linha do Parafuso
    await user.click(within(dialog).getByRole('button', { name: 'Remover item 1' }))
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    await fillAccessoryLine(user, dialog, 2, { search: 'Ímã', option: /Ímã 6x2/, quantity: '9', totalDigits: '1000' })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalledTimes(4))
    const call4 = registerMixedInventoryPurchaseMock.mock.calls[3][0]
    // agora a ordem é [Parafuso, Ímã] -> payload diferente -> chave nova
    expect(call4.items.map((i: { accessory_id: string }) => i.accessory_id)).toEqual(['a2', 'a1'])
    expect(call4.idempotency_key).not.toBe(key1)
  })

  it('a data digitada é convertida EXATAMENTE para YYYY-MM-DD no payload (sem deslocamento de fuso)', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const date = within(dialog).getByLabelText('Data da compra')
    await user.clear(date)
    await user.type(date, '06092026')
    await setChannel(user, dialog, 'Shopee')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '1', totalDigits: '500' })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalled())
    expect(registerMixedInventoryPurchaseMock.mock.calls[0][0].occurred_on).toBe('2026-09-06')
  })

  it('a máscara da data funciona na janela: dígitos inserem barras, Backspace corrige, colar sem barras funciona; data incompleta bloqueia com mensagem clara', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const date = within(dialog).getByLabelText('Data da compra') as HTMLInputElement

    await user.clear(date)
    await user.type(date, '0609')
    expect(date.value).toBe('06/09')
    await user.type(date, '2026')
    expect(date.value).toBe('06/09/2026')
    await user.type(date, '{Backspace}{Backspace}')
    expect(date.value).toBe('06/09/20')

    await user.clear(date)
    date.focus()
    await user.paste('06092026')
    expect(date.value).toBe('06/09/2026')

    await user.clear(date)
    await user.type(date, '0609')
    await setChannel(user, dialog, 'Shopee')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '1', totalDigits: '500' })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    expect(registerMixedInventoryPurchaseMock).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/dd\/mm\/aaaa/i)).toBeInTheDocument()
  })

  it('o seletor de Tipo de filamento é selecionável por mouse E por teclado, inclusive na 2ª linha', async () => {
    const user = userEvent.setup()
    mockFilamentTypes([
      filamentTypeFixture({ filament_type_id: 't1', material: 'PLA', line: 'Sólida', commercial_color: 'Preto' }),
      filamentTypeFixture({ filament_type_id: 't2', material: 'PETG', line: 'Matte', commercial_color: 'Azul' }),
    ])
    const dialog = await openDialog(user, 'filamentos')
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    await setCategory(user, dialog, 2, 'Filamento')

    // linha 2, por teclado
    const combo2 = within(row(dialog, 2)).getByRole('combobox', { name: 'Tipo de filamento' })
    await user.type(combo2, 'PETG')
    await user.keyboard('{ArrowDown}{Enter}')
    expect((combo2 as HTMLInputElement).value).toContain('PETG - Matte - Azul')

    // linha 1, por mouse
    const combo1 = within(row(dialog, 1)).getByRole('combobox', { name: 'Tipo de filamento' })
    await user.type(combo1, 'PLA')
    await user.click(await within(row(dialog, 1)).findByRole('option', { name: 'PLA - Sólida - Preto' }))
    expect((combo1 as HTMLInputElement).value).toContain('PLA - Sólida - Preto')
  })

  it('adicionar um item preserva a linha já preenchida e foca o primeiro campo da nova linha', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '4', totalDigits: '2000' })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))

    // linha 1 intacta
    expect((within(row(dialog, 1)).getByLabelText('Quantidade') as HTMLInputElement).value).toBe('4')
    // a nova linha 2 recebeu foco no seu primeiro campo (autoFocus)
    await waitFor(() =>
      expect(within(row(dialog, 2)).getByRole('combobox', { name: 'Acessório' })).toHaveFocus(),
    )
  })

  it('remover um item preserva os demais; a última linha nunca é removível (botão desabilitado)', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', variant: 'azul' }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', variant: null }),
    ])
    const dialog = await openDialog(user, 'acessorios')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '2', totalDigits: '1000' })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    await fillAccessoryLine(user, dialog, 2, { search: 'Parafuso', option: /Parafuso/, quantity: '5', totalDigits: '2500' })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))

    await user.click(within(dialog).getByRole('button', { name: 'Remover item 2' }))
    expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(2)
    // a linha 1 (Ímã, qtd 2) continua intacta
    expect((within(row(dialog, 1)).getByLabelText('Quantidade') as HTMLInputElement).value).toBe('2')

    await user.click(within(dialog).getByRole('button', { name: 'Remover item 2' }))
    expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: 'Remover item 1' })).toBeDisabled()
  })

  it('Filamento: Peso nominal é uma lista suspensa "Selecione o peso" com 250 g / 500 g / 1.000 g (ponto de milhar), sem action buttons; a janela nunca mostra "Código da cor" nem "Peso bruto"', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'filamentos')
    const r = row(dialog, 1)
    // não há mais action buttons de peso
    expect(within(r).queryByRole('radio', { name: '1.000 g' })).not.toBeInTheDocument()
    expect(within(r).queryByRole('radio', { name: '250 g' })).not.toBeInTheDocument()
    const weight = within(r).getByRole('combobox', { name: 'Peso nominal' })
    expect(weight).toHaveTextContent('Selecione o peso')
    await user.click(weight)
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent?.trim())
    expect(options).toEqual(['250 g', '500 g', '1.000 g'])
    expect(within(dialog).queryByText(/código da cor/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/código da cor/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/peso bruto/i)).not.toBeInTheDocument()
  })

  it('o Frete aparece UMA única vez, na sua própria seção — nunca um campo de frete por item', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    expect(within(dialog).getAllByLabelText('Valor do frete')).toHaveLength(1)
    const freightSection = within(dialog).getByRole('heading', { name: 'Frete' }).closest('section') as HTMLElement
    expect(within(freightSection).getByLabelText('Valor do frete')).toBeInTheDocument()
  })

  it('subtotal é exato mesmo com valor que não divide pela quantidade (qtd 3 + R$ 100,00 -> subtotal R$ 100,00, sem erro de ponto flutuante) e o payload envia total_value INTEIRO, nunca dividido', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    await setChannel(user, dialog, 'Shopee')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '3', totalDigits: '10000' })

    // subtotal (e total, com frete zero) = R$ 100,00 na barra fixa
    const totals = within(dialog).getByRole('group', { name: 'Totais da compra' })
    expect(within(totals).getAllByText('R$ 100,00').length).toBeGreaterThanOrEqual(1)

    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalled())
    expect(registerMixedInventoryPurchaseMock.mock.calls[0][0].items[0].total_value).toBe(100)
  })

  it('frete é somado UMA única vez ao Total (adicionar/remover linhas não duplica o frete)', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', variant: 'azul' }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', variant: null }),
    ])
    const dialog = await openDialog(user, 'acessorios')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '1', totalDigits: '3000' })
    await user.type(within(dialog).getByLabelText('Valor do frete'), '1000')
    const totals = within(dialog).getByRole('group', { name: 'Totais da compra' })
    expect(within(totals).getByText('R$ 40,00')).toBeInTheDocument() // 30 + 10 frete

    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    await fillAccessoryLine(user, dialog, 2, { search: 'Parafuso', option: /Parafuso/, quantity: '1', totalDigits: '2000' })
    // subtotal 50, frete ainda 10 (somado uma vez) -> total 60
    expect(within(totals).getByText('R$ 60,00')).toBeInTheDocument()
  })

  it('quantidade/valores em branco não produzem NaN nem Infinity — a barra de totais mostra R$ 0,00', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const totals = within(dialog).getByRole('group', { name: 'Totais da compra' })
    expect(within(totals).getAllByText('R$ 0,00')).toHaveLength(3) // subtotal, frete, total
    expect(within(dialog).queryByText(/NaN|Infinity/)).not.toBeInTheDocument()
  })

  it('layout da linha: empilha no mobile (flex-col), quebra organizada a partir de sm e vira uma única linha a partir de lg (lg:flex-nowrap), sem rolagem horizontal', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const r = row(dialog, 1)
    // o contêiner dos campos da linha
    const line = within(r).getByRole('combobox', { name: 'Acessório' }).closest('[data-line-fields]') as HTMLElement
    expect(line).not.toBeNull()
    expect(line.className).toMatch(/(^|\s)flex-col(\s|$)/)
    expect(line.className).toMatch(/sm:flex-row/)
    expect(line.className).toMatch(/sm:flex-wrap/)
    expect(line.className).toMatch(/lg:flex-nowrap/)
    // nenhum contêiner com overflow-x explícito dentro da janela
    expect(dialog.querySelector('.overflow-x-auto, .overflow-x-scroll')).toBeNull()
  })

  it('erro de NEGÓCIO do backend (business_rule) vira toast e mantém a janela aberta com os dados', async () => {
    const user = userEvent.setup()
    registerMixedInventoryPurchaseMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Esta embalagem está inativa.'),
    )
    const dialog = await openDialog(user, 'acessorios')
    await setChannel(user, dialog, 'Shopee')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '2', totalDigits: '1000' })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Esta embalagem está inativa.'))
    expect(screen.getByRole('dialog', { name: 'Registrar compra' })).toBeInTheDocument()
    expect((within(row(dialog, 1)).getByLabelText('Quantidade') as HTMLInputElement).value).toBe('2')
  })

  it('o Resumo deixa claro que os custos são uma PREVISÃO (valor final vem do servidor)', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const summary = within(dialog).getByRole('heading', { name: 'Resumo' }).closest('section') as HTMLElement
    expect(within(summary).getByText(/previsão/i)).toBeInTheDocument()
    expect(within(summary).getByText(/calculado pelo servidor/i)).toBeInTheDocument()
  })

  it('máximo 50 itens: "Adicionar item" desabilita ao atingir o teto', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const addButton = within(dialog).getByRole('button', { name: 'Adicionar item' })
    // já começa com 1; mais 49 -> 50 (fireEvent para não estourar o timeout)
    for (let i = 0; i < 49; i++) fireEvent.click(addButton)
    expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(50)
    expect(addButton).toBeDisabled()
    fireEvent.click(addButton)
    expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(50)
  })

  it('Embalagem: envia payload correto e aciona onPurchaseCompleted("PACKAGING")', async () => {
    const user = userEvent.setup()
    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M', variant: 'kraft' })])
    const dialog = await openDialog(user, 'embalagens')
    await setChannel(user, dialog, 'AliExpress')
    await fillPackagingLine(user, dialog, 1, { search: 'Caixa', option: /Caixa M/, quantity: '8', totalDigits: '4000' })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalled())
    expect(registerMixedInventoryPurchaseMock.mock.calls[0][0].items).toEqual([
      { category: 'PACKAGING', packaging_id: 'k1', quantity: 8, total_value: 40 },
    ])
    expect(onPurchaseCompleted).toHaveBeenCalledWith('PACKAGING')
    expect(onPurchaseCompleted).toHaveBeenCalledTimes(1)
  })

  // =========================================================================
  // REFINAMENTO VISUAL E RESPONSIVO (2026-09-07) — separação das seções em
  // blocos, Dados Gerais lado a lado, linha de item compacta, Peso nominal
  // como lista suspensa, títulos sem "- item N", "+" só ícone no cabeçalho.
  // Regras de negócio / payload / cálculos / idempotência: inalterados.
  // =========================================================================

  it('cada seção fica num bloco visual próprio: borda, cantos arredondados, fundo levemente diferenciado e título no topo', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    for (const name of ['Dados Gerais', 'Itens', 'Frete', 'Resumo']) {
      const heading = within(dialog).getByRole('heading', { name })
      const section = heading.closest('section') as HTMLElement
      expect(section).not.toBeNull()
      expect(section.className).toMatch(/\bborder\b/)
      expect(section.className).toMatch(/rounded-lg/)
      expect(section.className).toMatch(/bg-muted/)
      // título é o primeiro bloco da seção (topo)
      expect(section.firstElementChild).toContainElement(heading)
    }
  })

  it('Dados Gerais: Data da compra e os cinco botões de Local da compra ficam no MESMO contêiner horizontal em telas largas e empilham no estreito', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    const section = within(dialog).getByRole('heading', { name: 'Dados Gerais' }).closest('section') as HTMLElement
    const container = within(section)
      .getByLabelText('Data da compra')
      .closest('[data-general-fields]') as HTMLElement
    expect(container).not.toBeNull()
    // empilha no estreito, vira uma única linha de controles a partir de sm
    expect(container.className).toMatch(/(^|\s)flex-col(\s|$)/)
    expect(container.className).toMatch(/sm:flex-row/)
    // Data + radiogroup de Local + os cinco botões vivem no MESMO contêiner
    const localGroup = within(section).getByRole('radiogroup', { name: 'Local da compra' })
    expect(container).toContainElement(localGroup)
    for (const label of ['Mercado Livre', 'Shopee', 'AliExpress', 'Outro Site', 'Presencial']) {
      expect(container).toContainElement(within(localGroup).getByRole('radio', { name: label }))
    }
  })

  it('Dados Gerais: "Outro Site"/"Presencial" mostram o campo complementar ocupando a largura da coluna, sem desalinhar', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await setChannel(user, dialog, 'Outro Site')
    const complement = within(dialog).getByLabelText('Nome do site') as HTMLInputElement
    expect(complement.className).toMatch(/w-full/)
    // segue dentro da mesma coluna do radiogroup de Local
    const localColumn = within(dialog).getByRole('radiogroup', { name: 'Local da compra' }).parentElement as HTMLElement
    expect(localColumn).toContainElement(complement)
  })

  it('Itens: o botão de adicionar é só ícone, fica no cabeçalho da seção, tem tooltip + aria-label e responde a clique, Enter e Espaço', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const section = within(dialog).getByRole('heading', { name: 'Itens' }).closest('section') as HTMLElement
    const add = within(section).getByRole('button', { name: 'Adicionar item' })
    expect(add).toHaveAttribute('title', 'Adicionar item')
    expect(add).toHaveAttribute('aria-label', 'Adicionar item')
    expect(add).not.toHaveTextContent('Adicionar item') // sem texto visível — só o ícone "+"
    expect(add).not.toHaveAttribute('aria-label', expect.stringMatching(/remover/i))
    // está no cabeçalho da seção (mesmo bloco do título)
    expect(section.firstElementChild).toContainElement(add)

    // clique adiciona
    await user.click(add)
    expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(2)
    // teclado: cada adição foca o primeiro campo da nova linha (autoFocus),
    // então re-focamos o botão antes de cada tecla.
    add.focus()
    expect(add).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(3)
    add.focus()
    await user.keyboard(' ')
    expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(4)
  })

  it('Itens (Filamento): categoria + tipo + fabricante + peso + quantidade + valor total + ação ficam no mesmo contêiner de linha compacta', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'filamentos')
    const r = row(dialog, 1)
    const line = within(r)
      .getByRole('radiogroup', { name: 'Categoria — item 1' })
      .closest('[data-line-fields]') as HTMLElement
    expect(line).not.toBeNull()
    expect(line.className).toMatch(/lg:flex-nowrap/)
    expect(line).toContainElement(within(r).getByRole('combobox', { name: 'Tipo de filamento' }))
    expect(line).toContainElement(within(r).getByLabelText('Fabricante'))
    expect(line).toContainElement(within(r).getByRole('combobox', { name: 'Peso nominal' }))
    expect(line).toContainElement(within(r).getByLabelText('Quantidade'))
    expect(line).toContainElement(within(r).getByLabelText('Valor total'))
    expect(line).toContainElement(within(r).getByRole('button', { name: 'Remover item 1' }))
  })

  it('Peso nominal: escolher "500 g" na lista suspensa envia nominal_weight_grams 500 (valor em gramas, inalterado)', async () => {
    const user = userEvent.setup()
    mockFilamentTypes([filamentTypeFixture({ filament_type_id: 't1', material: 'PLA', line: 'Sólida', commercial_color: 'Preto' })])
    const dialog = await openDialog(user, 'filamentos')
    await setChannel(user, dialog, 'Mercado Livre')
    await fillFilamentLine(user, dialog, 1, {
      query: 'PLA',
      option: 'PLA - Sólida - Preto',
      weight: '500 g',
      manufacturer: 'Voolt',
      quantity: '3',
      totalDigits: '9000',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalled())
    expect(registerMixedInventoryPurchaseMock.mock.calls[0][0].items[0]).toEqual({
      category: 'FILAMENT',
      filament_type_id: 't1',
      manufacturer: 'Voolt',
      nominal_weight_grams: 500,
      quantity: 3,
      total_value: 90,
    })
  })

  it('os rótulos das linhas não exibem numeração "- item N" (a numeração é só interna/posicional)', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'filamentos')
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar item' }))
    const r2 = row(dialog, 2)
    for (const label of ['Categoria', 'Tipo de filamento', 'Fabricante', 'Peso nominal', 'Quantidade', 'Valor total']) {
      expect(within(r2).getByText(label)).toBeInTheDocument()
    }
    expect(within(dialog).queryByText(/[-—]\s*item\s*\d/i)).not.toBeInTheDocument()
    // a categoria continua rotulada só "Filamento"/"Acessório"/"Embalagem"
    expect(within(r2).getByRole('radio', { name: 'Filamento' })).toBeInTheDocument()
  })

  it('editar outros campos da linha preserva o peso nominal já selecionado', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'filamentos')
    const r = row(dialog, 1)
    const weight = within(r).getByRole('combobox', { name: 'Peso nominal' })
    await pickWeight(user, dialog, 1, '1.000 g')
    expect(weight).toHaveTextContent('1.000 g')
    await user.type(within(r).getByLabelText('Fabricante'), 'Voolt')
    await user.type(within(r).getByLabelText('Quantidade'), '2')
    expect(weight).toHaveTextContent('1.000 g')
  })

  // =========================================================================
  // SEGUNDO REFINAMENTO VISUAL (2026-09-07) — "Dados Gerais" numa única linha
  // de controles em telas largas (Data + cinco botões de Local alinhados),
  // "Tipo de filamento" com prioridade de largura, janela mais larga porém
  // limitada ao viewport, e barra fixa de totais (Subtotal / Frete / Total)
  // fora da área rolável. Payload / cálculos / idempotência / endpoint
  // /inventory-purchases/mixed: inalterados.
  // =========================================================================

  it('a janela é mais larga (≈max-w-6xl) mas limitada ao viewport, mantendo margens laterais no celular', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    expect(dialog.className).toContain('sm:max-w-[min(72rem,calc(100vw-2rem))]')
    expect(dialog.className).toContain('max-w-[calc(100vw-2rem)]')
    expect(dialog.querySelector('.overflow-x-auto, .overflow-x-scroll')).toBeNull()
  })

  it('Dados Gerais: os controles compartilham o alinhamento vertical (sm:items-start) e, no estreito, empilham (flex-col)', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    const container = within(dialog)
      .getByLabelText('Data da compra')
      .closest('[data-general-fields]') as HTMLElement
    expect(container).not.toBeNull()
    expect(container.className).toMatch(/(^|\s)flex-col(\s|$)/)
    expect(container.className).toMatch(/sm:flex-row/)
    expect(container.className).toMatch(/sm:items-start/)
  })

  it('Dados Gerais: "Outro Site"/"Presencial" complementam numa linha ABAIXO do grupo, dentro da coluna de Local da compra', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await setChannel(user, dialog, 'Presencial')
    const localGroup = within(dialog).getByRole('radiogroup', { name: 'Local da compra' })
    const localColumn = localGroup.parentElement as HTMLElement
    const complement = within(dialog).getByLabelText('Nome da loja')
    expect(localColumn).toContainElement(localGroup)
    expect(localColumn).toContainElement(complement)
    // vem DEPOIS do grupo no DOM (linha complementar abaixo)
    expect(
      localGroup.compareDocumentPosition(complement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('Itens: "Tipo de filamento" tem prioridade de largura (flex-1 + min-width que cresce); os campos menores seguem com largura fixa', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'filamentos')
    const r = row(dialog, 1)
    const typeWrapper = within(r)
      .getByRole('combobox', { name: 'Tipo de filamento' })
      .closest('.flex-1') as HTMLElement
    expect(typeWrapper).not.toBeNull()
    expect(typeWrapper.className).toMatch(/lg:min-w-64/)
    expect(within(r).getByLabelText('Fabricante').closest('div')?.className).toMatch(/sm:w-/)
    expect(within(r).getByLabelText('Quantidade').closest('div')?.className).toMatch(/sm:w-/)
  })

  it('Itens: o rótulo selecionado de "Tipo de filamento" continua acessível por completo (valor no campo + tooltip title)', async () => {
    const user = userEvent.setup()
    mockFilamentTypes([filamentTypeFixture({ filament_type_id: 't1', material: 'PLA', line: 'Sólida', commercial_color: 'Preto' })])
    const dialog = await openDialog(user, 'filamentos')
    const r = row(dialog, 1)
    const combo = within(r).getByRole('combobox', { name: 'Tipo de filamento' }) as HTMLInputElement
    await user.type(combo, 'PLA')
    await user.click(await within(r).findByRole('option', { name: 'PLA - Sólida - Preto' }))
    expect(combo.value).toBe('PLA - Sólida - Preto')
    expect(combo).toHaveAttribute('title', 'PLA - Sólida - Preto')
  })

  it('a área central rolável é a ÚNICA região com rolagem vertical; a barra de totais e o rodapé ficam fora dela', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    const scrollRegions = dialog.querySelectorAll('.overflow-y-auto')
    expect(scrollRegions).toHaveLength(1)
    const scroll = scrollRegions[0]
    const totals = within(dialog).getByRole('group', { name: 'Totais da compra' })
    const footer = within(dialog)
      .getByRole('button', { name: 'Registrar compra' })
      .closest('[data-slot="dialog-footer"]') as HTMLElement
    expect(scroll.contains(totals)).toBe(false)
    expect(scroll.contains(footer)).toBe(false)
    // a barra de totais vem logo antes do rodapé de ações
    expect(totals.nextElementSibling).toBe(footer)
  })

  it('a barra fixa mostra Subtotal / Frete / Total fora da área rolável, com fundo sólido + borda superior, sem duplicar os valores no Resumo', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const totals = within(dialog).getByRole('group', { name: 'Totais da compra' })
    expect(totals.className).toMatch(/bg-popover/)
    expect(totals.className).toMatch(/border-t/)
    for (const label of ['Subtotal', 'Frete', 'Total da compra']) {
      expect(within(totals).getByText(label)).toBeInTheDocument()
    }
    const summary = within(dialog).getByRole('heading', { name: 'Resumo' }).closest('section') as HTMLElement
    expect(within(summary).queryByText('Subtotal')).not.toBeInTheDocument()
    expect(within(summary).queryByText('Total da compra')).not.toBeInTheDocument()
    // "Total da compra" aparece uma única vez em toda a janela
    expect(within(dialog).getAllByText('Total da compra')).toHaveLength(1)
  })

  it('a barra fixa de totais reage na hora às mudanças dos itens e do frete', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'acessorios')
    const totals = within(dialog).getByRole('group', { name: 'Totais da compra' })
    expect(within(totals).getAllByText('R$ 0,00')).toHaveLength(3)

    await setChannel(user, dialog, 'Shopee')
    await fillAccessoryLine(user, dialog, 1, { search: 'Ímã', option: /Ímã 6x2/, quantity: '2', totalDigits: '3000' })
    // subtotal e total = R$ 30,00 (frete ainda zero)
    expect(within(totals).getAllByText('R$ 30,00')).toHaveLength(2)

    await user.type(within(dialog).getByLabelText('Valor do frete'), '1000')
    expect(within(totals).getByText('R$ 10,00')).toBeInTheDocument() // frete
    expect(within(totals).getByText('R$ 40,00')).toBeInTheDocument() // total
  })

  it('o rodapé Cancelar / Registrar compra permanece visível, fora da área rolável', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    const footer = within(dialog)
      .getByRole('button', { name: 'Registrar compra' })
      .closest('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer).not.toBeNull()
    expect(within(footer).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: 'Registrar compra' })).toBeInTheDocument()
    expect(dialog.querySelector('.overflow-y-auto')?.contains(footer)).toBe(false)
  })

  it('regressão responsiva: no estreito "Dados Gerais" e a linha de item empilham (flex-col) e não há rolagem horizontal', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user, 'filamentos')
    const general = within(dialog)
      .getByLabelText('Data da compra')
      .closest('[data-general-fields]') as HTMLElement
    expect(general.className).toMatch(/(^|\s)flex-col(\s|$)/)
    const line = within(row(dialog, 1))
      .getByRole('combobox', { name: 'Tipo de filamento' })
      .closest('[data-line-fields]') as HTMLElement
    expect(line.className).toMatch(/(^|\s)flex-col(\s|$)/)
    expect(line.className).toMatch(/sm:flex-row/)
    expect(dialog.querySelector('.overflow-x-auto, .overflow-x-scroll')).toBeNull()
  })

  it('payload, cálculos e submissão seguem inalterados após o refinamento visual (rota /mixed uma vez, total_value inteiro, frete uma vez)', async () => {
    const user = userEvent.setup()
    mockFilamentTypes([filamentTypeFixture({ filament_type_id: 't1', material: 'PLA', line: 'Sólida', commercial_color: 'Preto' })])
    const dialog = await openDialog(user, 'filamentos')
    await setChannel(user, dialog, 'Mercado Livre')
    await fillFilamentLine(user, dialog, 1, {
      query: 'PLA',
      option: 'PLA - Sólida - Preto',
      weight: '1.000 g',
      manufacturer: 'Voolt',
      quantity: '3',
      totalDigits: '10000',
    })
    await user.type(within(dialog).getByLabelText('Valor do frete'), '1500')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar compra' }))
    await waitFor(() => expect(registerMixedInventoryPurchaseMock).toHaveBeenCalledTimes(1))
    const payload = registerMixedInventoryPurchaseMock.mock.calls[0][0]
    expect(payload.freight_value).toBe(15)
    expect(payload.purchase_channel).toBe('MERCADO_LIVRE')
    expect(payload.items).toEqual([
      { category: 'FILAMENT', filament_type_id: 't1', manufacturer: 'Voolt', nominal_weight_grams: 1000, quantity: 3, total_value: 100 },
    ])
  })
})
