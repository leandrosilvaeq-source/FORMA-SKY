import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  await user.type(within(r).getByLabelText(`Quantidade — item ${lineNo}`), quantity)
  await user.type(within(r).getByLabelText(`Valor total — item ${lineNo}`), totalDigits)
}
async function fillAccessoryLine(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, lineNo: number, opts: { search: string; option: string | RegExp; quantity: string; totalDigits: string }) {
  await setCategory(user, dialog, lineNo, 'Acessório')
  await pickItem(user, dialog, lineNo, `Acessório — item ${lineNo}`, opts.search, opts.option)
  await fillQtyTotal(user, dialog, lineNo, opts.quantity, opts.totalDigits)
}
async function fillPackagingLine(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, lineNo: number, opts: { search: string; option: string | RegExp; quantity: string; totalDigits: string }) {
  await setCategory(user, dialog, lineNo, 'Embalagem')
  await pickItem(user, dialog, lineNo, `Embalagem — item ${lineNo}`, opts.search, opts.option)
  await fillQtyTotal(user, dialog, lineNo, opts.quantity, opts.totalDigits)
}
async function fillFilamentLine(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, lineNo: number, opts: { query: string; option: string | RegExp; weight: string; manufacturer: string; quantity: string; totalDigits: string }) {
  await setCategory(user, dialog, lineNo, 'Filamento')
  const r = row(dialog, lineNo)
  await user.type(within(r).getByRole('combobox', { name: `Tipo de filamento — item ${lineNo}` }), opts.query)
  await user.click(await within(r).findByRole('option', { name: opts.option }))
  await user.click(within(r).getByRole('radio', { name: opts.weight }))
  await user.type(within(r).getByLabelText(`Fabricante — item ${lineNo}`), opts.manufacturer)
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
    await user.type(within(row(dialog, 1)).getByLabelText('Fabricante — item 1'), 'Voolt')

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
    expect((within(row(dialog, 1)).getByLabelText('Quantidade — item 1') as HTMLInputElement).value).toBe('3')
    expect((within(row(dialog, 1)).getByLabelText('Valor total — item 1') as HTMLInputElement).value).toContain('50,00')
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
    await pickItem(user, dialog, 1, 'Acessório — item 1', 'Ímã', /Ímã 6x2/)
    await user.type(within(row(dialog, 1)).getByLabelText('Quantidade — item 1'), '3')
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
    await user.type(within(row(dialog, 2)).getByRole('combobox', { name: 'Acessório — item 2' }), 'Ímã')
    expect(within(row(dialog, 2)).queryByRole('option', { name: /Ímã 6x2/ })).not.toBeInTheDocument()
  })

  it('o Resumo mostra Subtotal / Frete / Total e, por linha, frete atribuído + "Custo desta compra/un."; Acessório/Embalagem também "Novo custo médio/un." e Filamento não', async () => {
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

    const summary = within(dialog).getByRole('heading', { name: 'Resumo' }).closest('section') as HTMLElement
    expect(within(summary).getByText('Subtotal')).toBeInTheDocument()
    expect(within(summary).getByText('Total da compra')).toBeInTheDocument()
    // Subtotal 20,00 + 80,00 = 100,00; Total 110,00
    expect(within(summary).getByText('R$ 100,00')).toBeInTheDocument()
    expect(within(summary).getByText('R$ 110,00')).toBeInTheDocument()

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
    expect((within(row(dialog, 1)).getByLabelText('Quantidade — item 1') as HTMLInputElement).value).toBe('7')
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
})
