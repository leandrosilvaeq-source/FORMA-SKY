import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  registerAccessoryPurchaseMock,
  toastMock,
} = vi.hoisted(() => ({
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  useFilamentTypesMock: vi.fn(),
  registerInventoryPurchaseMock: vi.fn(),
  registerFilamentPurchaseMock: vi.fn(),
  registerAccessoryPurchaseMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
vi.mock('@/hooks/useFilamentTypes', () => ({ useFilamentTypes: useFilamentTypesMock }))
vi.mock('@/lib/api/inventoryPurchases', () => ({
  registerInventoryPurchase: registerInventoryPurchaseMock,
  registerFilamentPurchase: registerFilamentPurchaseMock,
  registerAccessoryPurchase: registerAccessoryPurchaseMock,
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

// Devolve os mocks usados (nunca só configura) — permite a um teste capturar
// `refetch` e afirmar quando ele foi chamado (2026-09-04, correção da
// atualização automática do fluxo de Filamentos).
function mockFilamentTypes(list: FilamentTypeSummary[]) {
  const mocks = {
    types: list,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getRemovalPlan: vi.fn(),
    delete: vi.fn(),
  }
  useFilamentTypesMock.mockReturnValue(mocks)
  return mocks
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

function accessoryPurchaseResultFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    purchase_id: 'ap1',
    category: 'ACCESSORY',
    quantity: 1,
    item_value: 10,
    freight_value: 0,
    total_value: 10,
    supplier_name: null,
    notes: null,
    occurred_at: '2026-09-06T00:00:00Z',
    created_at: '2026-09-06T00:00:00Z',
    items: [],
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
    registerAccessoryPurchaseMock.mockReset()
    registerAccessoryPurchaseMock.mockResolvedValue(accessoryPurchaseResultFixture())
    mockAccessories([accessoryFixture()])
    mockPackaging([packagingFixture()])
    mockFilamentTypes([filamentTypeFixture()])
  })

  // Preenche uma linha da grade de "Compra de acessórios" (role="group"
  // "Item N", 1-based): seleciona o acessório (digitar-e-clicar), a
  // quantidade e o "Valor total" (campo bancário — dígitos entram pela
  // direita).
  async function fillAccessoryRow(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    itemIndex: number,
    opts: { search: string; option: string | RegExp; quantity: string; totalDigits: string },
  ) {
    const row = within(dialog).getByRole('group', { name: `Item ${itemIndex}` })
    await user.type(
      within(row).getByRole('combobox', { name: `Acessório — item ${itemIndex}` }),
      opts.search,
    )
    await user.click(await within(row).findByRole('option', { name: opts.option }))
    await user.type(within(row).getByLabelText('Quantidade'), opts.quantity)
    await user.type(within(row).getByLabelText('Valor total'), opts.totalDigits)
  }

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
  // marca + valor total) — usado nos testes que só precisam de um item
  // válido sem repetir os 5 passos toda vez. `totalValueRaw` é o quanto o
  // usuário pagou por TODOS os rolos da linha (2026-09-05, campo renomeado
  // de "Valor unitário" para "Valor total"), nunca o preço de um rolo só.
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
      totalValueRaw: string
    },
  ) {
    await selectFilamentType(user, dialog, itemIndex, opts.query, opts.optionName)
    const row = getFilamentItemRow(dialog, itemIndex)
    await user.click(within(row).getByRole('radio', { name: opts.weightLabel }))
    await user.type(within(row).getByLabelText('Quantidade'), opts.quantity)
    await user.type(within(row).getByLabelText('Marca'), opts.manufacturer)
    await user.type(within(row).getByLabelText('Valor total'), opts.totalValueRaw)
  }

  // Local da compra usa o mesmo padrão de radiogroup de botões já usado por
  // "Item" — sem escopo por linha (é um campo único de Dados Gerais).
  async function selectPurchaseChannel(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    label: 'Mercado Livre' | 'AliExpress' | 'Shopee' | 'Presencial' | 'Site' | 'Outro',
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
    registerAccessoryPurchaseMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePurchase = resolve
      }),
    )
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)

    await selectCategory(user, dialog, 'Acessório')
    await fillAccessoryRow(user, dialog, 1, {
      search: 'Ímã',
      option: /Ímã 6x2/i,
      quantity: '2',
      totalDigits: '1000',
    })

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /^registrando\.\.\.$/i })).toBeDisabled(),
    )
    expect(registerAccessoryPurchaseMock).toHaveBeenCalledTimes(1)

    resolvePurchase(accessoryPurchaseResultFixture())
  })

  it('erro real do backend mantém o diálogo aberto e preserva os valores preenchidos', async () => {
    registerAccessoryPurchaseMock.mockRejectedValue(
      new ApiError('validation', 400, 'valor inválido'),
    )
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)

    await selectCategory(user, dialog, 'Acessório')
    await fillAccessoryRow(user, dialog, 1, {
      search: 'Ímã',
      option: /Ímã 6x2/i,
      quantity: '3',
      totalDigits: '500',
    })
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    expect(await within(dialog).findByText('valor inválido')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Compra de acessórios' })).toBeInTheDocument()
    const row = within(dialog).getByRole('group', { name: 'Item 1' })
    expect(within(row).getByLabelText('Quantidade')).toHaveValue('3')
  })

  it('idempotência: reenviar o mesmo formulário sem alterações reusa a mesma idempotency_key', async () => {
    registerAccessoryPurchaseMock.mockRejectedValueOnce(new ApiError('database', 500, 'falhou'))
    registerAccessoryPurchaseMock.mockResolvedValueOnce(accessoryPurchaseResultFixture())
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)

    await selectCategory(user, dialog, 'Acessório')
    await fillAccessoryRow(user, dialog, 1, {
      search: 'Ímã',
      option: /Ímã 6x2/i,
      quantity: '1',
      totalDigits: '100',
    })

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))
    await waitFor(() => expect(registerAccessoryPurchaseMock).toHaveBeenCalledTimes(1))
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))
    await waitFor(() => expect(registerAccessoryPurchaseMock).toHaveBeenCalledTimes(2))

    const firstKey = registerAccessoryPurchaseMock.mock.calls[0][0].idempotency_key
    const secondKey = registerAccessoryPurchaseMock.mock.calls[1][0].idempotency_key
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

  // ---------------------------------------------------------------------------
  // CORREÇÃO (2026-09-04) — "corrija a atualização automática do fluxo de
  // Filamentos": este useFilamentTypes() é uma instância PRÓPRIA de
  // PurchaseDialog, independente da usada por FilamentsInventoryPage.tsx (o
  // projeto não tem um cache/query client compartilhado). Sem refazer a
  // busca ao abrir, um tipo cadastrado/editado/arquivado na página de
  // Filamentos nunca aparecia (ou continuava aparecendo desatualizado) neste
  // seletor até um F5. Ver também useFilamentTypes.test.ts ("refetch() busca
  // a lista de novo...") para a prova de que refetch() de fato traz dados
  // atualizados — aqui só se prova que a ABERTURA da janela o aciona.
  // ---------------------------------------------------------------------------

  it('abrir a janela de Compras sempre refaz a busca de tipos de filamento (nunca depende de F5 para ver um tipo novo/editado/arquivado)', async () => {
    const mocks = mockFilamentTypes([filamentTypeFixture()])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Compras' }))
    expect(mocks.refetch).toHaveBeenCalledTimes(1)

    // Fechar e reabrir busca de novo — cada abertura é uma oportunidade de
    // ver dados atualizados, nunca só a primeira.
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))
    await user.click(screen.getByRole('button', { name: 'Compras' }))
    expect(mocks.refetch).toHaveBeenCalledTimes(2)
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
      totalValueRaw: '9500',
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
      totalValueRaw: '9500',
    })

    const dateInput = within(dialog).getByLabelText('Data da compra')
    await user.clear(dateInput)
    await user.type(dateInput, '04/09/26')
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerFilamentPurchaseMock).toHaveBeenCalledTimes(1))
    expect(registerFilamentPurchaseMock.mock.calls[0][0].occurred_at).toBe('2026-09-04')
  })

  // ---------------------------------------------------------------------------
  // Máscara automática dd/mm/aa da Data da compra (2026-09-05) — o usuário
  // digita SÓ números; as barras aparecem sozinhas; colagem com/sem barras;
  // Backspace corrige normalmente. A conversão para YYYY-MM-DD (contrato da
  // API inalterado) é coberta pelo teste "4." acima; a lógica pura da
  // máscara/conversão tem sua própria suíte em lib/forms/brShortDate.test.ts.
  // ---------------------------------------------------------------------------

  it('Data da compra: placeholder dd/mm/aa, inputMode numérico e nome acessível', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const dateInput = within(dialog).getByLabelText('Data da compra') as HTMLInputElement
    expect(dateInput).toHaveAttribute('placeholder', 'dd/mm/aa')
    expect(dateInput).toHaveAttribute('inputmode', 'numeric')
  })

  it('Data da compra: digitar 050926 insere as barras automaticamente (05/09/26)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const dateInput = within(dialog).getByLabelText('Data da compra') as HTMLInputElement
    await user.clear(dateInput)
    await user.type(dateInput, '050926')
    expect(dateInput.value).toBe('05/09/26')
  })

  it('Data da compra: caracteres não numéricos digitados são ignorados', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const dateInput = within(dialog).getByLabelText('Data da compra') as HTMLInputElement
    await user.clear(dateInput)
    await user.type(dateInput, '0a5b0c9d2e6')
    expect(dateInput.value).toBe('05/09/26')
  })

  it('Data da compra: colar 050926 (sem barras) resulta em 05/09/26', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const dateInput = within(dialog).getByLabelText('Data da compra') as HTMLInputElement
    await user.clear(dateInput)
    await user.click(dateInput)
    await user.paste('050926')
    expect(dateInput.value).toBe('05/09/26')
  })

  it('Data da compra: colar 05/09/26 (com barras) resulta em 05/09/26', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const dateInput = within(dialog).getByLabelText('Data da compra') as HTMLInputElement
    await user.clear(dateInput)
    await user.click(dateInput)
    await user.paste('05/09/26')
    expect(dateInput.value).toBe('05/09/26')
  })

  it('Data da compra: Backspace permite corrigir a data digitada', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const dateInput = within(dialog).getByLabelText('Data da compra') as HTMLInputElement
    await user.clear(dateInput)
    await user.type(dateInput, '050926')
    expect(dateInput.value).toBe('05/09/26')
    // Apaga os 2 dígitos do ano (a barra final some junto, sem "grudar") e
    // digita outro ano.
    await user.type(dateInput, '{Backspace}{Backspace}')
    expect(dateInput.value).toBe('05/09')
    await user.type(dateInput, '27')
    expect(dateInput.value).toBe('05/09/27')
  })

  it('Data da compra: data incompleta é rejeitada no envio, com mensagem clara', async () => {
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
      totalValueRaw: '9500',
    })

    const dateInput = within(dialog).getByLabelText('Data da compra')
    await user.clear(dateInput)
    await user.type(dateInput, '0509')
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    expect(
      await within(dialog).findByText(/informe a data no formato dd\/mm\/aa/i),
    ).toBeInTheDocument()
    expect(registerFilamentPurchaseMock).not.toHaveBeenCalled()
  })

  it('Data da compra: com a máscara, uma compra válida ainda envia occurred_at (YYYY-MM-DD), total_value e frete corretos', async () => {
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
      quantity: '2',
      manufacturer: 'Bambu Lab',
      totalValueRaw: '19000', // R$ 190,00
    })
    await user.type(within(dialog).getByLabelText('Valor do frete'), '2000') // R$ 20,00

    const dateInput = within(dialog).getByLabelText('Data da compra')
    await user.clear(dateInput)
    await user.type(dateInput, '050926')
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerFilamentPurchaseMock).toHaveBeenCalledTimes(1))
    const payload = registerFilamentPurchaseMock.mock.calls[0][0]
    expect(payload.occurred_at).toBe('2026-09-05')
    expect(payload.freight_value).toBe(20)
    expect(payload.items).toContainEqual(expect.objectContaining({ quantity: 2, total_value: 190 }))
  })

  // ---------------------------------------------------------------------------
  // Lista de sugestões do campo "Tipo — item N" (2026-09-05) — o painel
  // precisa ser TOTALMENTE OPACO e ficar acima dos itens seguintes (era
  // possível ver o Item 2 por baixo da lista aberta no Item 1).
  // ---------------------------------------------------------------------------

  it('lista do Tipo: fundo opaco (bg-popover, sem alpha), borda e sombra visíveis, z alto, rolagem só vertical', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const row = within(dialog).getByRole('group', { name: 'Item 1' })
    await user.type(within(row).getByRole('combobox', { name: 'Tipo — item 1' }), 'PLA')
    const listbox = await within(row).findByRole('listbox')

    expect(listbox.className).toContain('bg-popover')
    // Nenhuma cor de fundo com transparência (ex.: bg-popover/80).
    expect(listbox.className).not.toMatch(/bg-[a-z-]+\/\d/)
    expect(listbox.className).toContain('border')
    expect(listbox.className).toContain('shadow-md')
    expect(listbox.className).toContain('z-50')
    expect(listbox.className).toContain('max-h-64')
    expect(listbox.className).toContain('overflow-y-auto')
    expect(listbox.className).toContain('overflow-x-hidden')
    // Largura alinhada ao campo.
    expect(listbox.className).toContain('inset-x-0')
  })

  it('lista do Tipo: o wrapper sobe para z-30 enquanto aberta (para cobrir os itens seguintes) e volta a z-20 ao fechar', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))

    const row1 = within(dialog).getByRole('group', { name: 'Item 1' })
    const combo1 = within(row1).getByRole('combobox', { name: 'Tipo — item 1' })
    const wrapper1 = combo1.closest('div') as HTMLElement
    expect(wrapper1.className).toContain('z-20')
    expect(wrapper1.className).not.toContain('z-30')

    await user.type(combo1, 'PLA')
    await within(row1).findByRole('listbox')
    expect(wrapper1.className).toContain('z-30')

    await user.keyboard('{Escape}')
    expect(wrapper1.className).toContain('z-20')
    expect(wrapper1.className).not.toContain('z-30')
  })

  it('lista do Tipo: continua selecionável por mouse E por teclado, inclusive no Item 2', async () => {
    mockFilamentTypes([
      filamentTypeFixture({ filament_type_id: 't1', commercial_color: 'Preto' }),
      filamentTypeFixture({ filament_type_id: 't2', commercial_color: 'Azul' }),
    ])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))

    // Item 1 — seleção por mouse.
    const row1 = within(dialog).getByRole('group', { name: 'Item 1' })
    await user.type(within(row1).getByRole('combobox', { name: 'Tipo — item 1' }), 'PLA')
    await user.click(await within(row1).findByRole('option', { name: 'PLA - Sólida - Preto' }))
    expect((within(row1).getByRole('combobox', { name: 'Tipo — item 1' }) as HTMLInputElement).value).toBe(
      'PLA - Sólida - Preto',
    )

    // Item 2 — seleção por teclado (ArrowDown até "Azul", Enter).
    const row2 = within(dialog).getByRole('group', { name: 'Item 2' })
    const combo2 = within(row2).getByRole('combobox', { name: 'Tipo — item 2' })
    await user.type(combo2, 'PLA')
    await within(row2).findByRole('listbox')
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect((combo2 as HTMLInputElement).value).toBe('PLA - Sólida - Azul')
  })

  it('5. os 6 locais de compra aparecem (Mercado Livre, AliExpress, Shopee, Presencial, Site, Outro)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    const group = within(dialog).getByRole('radiogroup', { name: 'Local da compra' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Mercado Livre', 'AliExpress', 'Shopee', 'Presencial', 'Site', 'Outro'])
  })

  it('Site e Outro são enviados no payload com os valores internos SITE/OUTRO', async () => {
    mockFilamentTypes([filamentTypeFixture({ filament_type_id: 't1' })])
    registerFilamentPurchaseMock.mockResolvedValue(filamentPurchaseResultFixture())
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectPurchaseChannel(user, dialog, 'Site')
    await fillFilamentItem(user, dialog, 1, {
      query: 'PLA',
      optionName: 'PLA - Sólida - Preto',
      weightLabel: '1.000 g',
      quantity: '1',
      manufacturer: 'Bambu Lab',
      totalValueRaw: '9500',
    })

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerFilamentPurchaseMock).toHaveBeenCalledTimes(1))
    expect(registerFilamentPurchaseMock.mock.calls[0][0].purchase_channel).toBe('SITE')
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
      totalValueRaw: '9500',
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
      totalValueRaw: '9500',
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
    // Os 6 campos (Tipo/Peso/Quantidade/Marca/Valor total/Remover) vivem
    // todos dentro da MESMA linha (o mesmo elemento role="group").
    expect(within(row).getByRole('combobox', { name: 'Tipo — item 1' })).toBeInTheDocument()
    expect(within(row).getByRole('radiogroup', { name: 'Peso — item 1' })).toBeInTheDocument()
    expect(within(row).getByLabelText('Quantidade')).toBeInTheDocument()
    expect(within(row).getByLabelText('Marca')).toBeInTheDocument()
    expect(within(row).getByLabelText('Valor total')).toBeInTheDocument()
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
      // Valor total da linha (2 rolos) — não mais "por rolo".
      totalValueRaw: '19000',
    })
    await user.type(within(dialog).getByLabelText('Valor do frete'), '3000')

    // Subtotal = 190,00 (Valor total do item, usado diretamente — nunca
    // quantity×unit_value); Frete = 30,00; Total = 220,00 (subtotal isolado
    // NUNCA aparece como linha própria do Resumo).
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
    // Item 1: 2 rolos, Valor total R$ 180,00 (R$ 90,00 cada).
    await fillFilamentItem(user, dialog, 1, {
      query: 'Matte',
      optionName: 'PLA - Matte - Preto',
      weightLabel: '1.000 g',
      quantity: '2',
      manufacturer: 'Bambu Lab',
      totalValueRaw: '18000',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))
    // Item 2: 1 rolo, Valor total R$ 100,00.
    await fillFilamentItem(user, dialog, 2, {
      query: 'Silk',
      optionName: 'PLA - Silk - Dourado',
      weightLabel: '1.000 g',
      quantity: '1',
      manufacturer: 'Voolt',
      totalValueRaw: '10000',
    })
    // Frete de R$ 20,00 -> total = 180+100+20 = 300,00; quantidade total = 3
    // -> custo por filamento = 100,00 (exemplo exato do pedido).
    await user.type(within(dialog).getByLabelText('Valor do frete'), '2000')

    expect(within(dialog).getByText(normalizedBRL(30000))).toBeInTheDocument()
    // "R$ 100,00" aparece 2x: Valor total do item 2 e custo por filamento.
    expect(within(dialog).getAllByText(normalizedBRL(10000)).length).toBeGreaterThanOrEqual(1)
  })

  // ---------------------------------------------------------------------------
  // "Valor unitário" -> "Valor total" (2026-09-05) — o usuário informa quanto
  // pagou por TODOS os rolos da linha, nunca o preço de um rolo só. O valor
  // individual (unit_value) é derivado internamente só no envio; o RESUMO
  // exibido aqui nunca reconstrói a partir dele (usa sempre o total em
  // centavos informado, exato).
  // ---------------------------------------------------------------------------

  it('campo "Valor unitário" não aparece mais em nenhum item', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')

    expect(within(dialog).queryByLabelText('Valor unitário')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Valor unitário')).not.toBeInTheDocument()
  })

  it('"Valor total" aparece em cada item — dois itens podem ter totais diferentes, cada um com seu próprio campo', async () => {
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
    await fillFilamentItem(user, dialog, 1, {
      query: 'Matte',
      optionName: 'PLA - Matte - Preto',
      weightLabel: '500 g',
      quantity: '1',
      manufacturer: 'Bambu Lab',
      totalValueRaw: '5000',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))
    await fillFilamentItem(user, dialog, 2, {
      query: 'Silk',
      optionName: 'PLA - Silk - Dourado',
      weightLabel: '250 g',
      quantity: '1',
      manufacturer: 'Voolt',
      totalValueRaw: '7500',
    })

    // toHaveValue compara a string EXATA do atributo value (sem a
    // normalização de espaço que normalizedBRL faz para getByText) — usa
    // formatCentsToBRL diretamente, o mesmo formatador real do componente.
    const row1 = getFilamentItemRow(dialog, 1)
    const row2 = getFilamentItemRow(dialog, 2)
    expect(within(row1).getByLabelText('Valor total')).toHaveValue(formatCentsToBRL(5000))
    expect(within(row2).getByLabelText('Valor total')).toHaveValue(formatCentsToBRL(7500))
  })

  it('"Valor total" é obrigatório e deve ser maior que zero — não registra a compra com o campo vazio ou zerado', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectPurchaseChannel(user, dialog, 'Mercado Livre')
    await selectFilamentType(user, dialog, 1, 'PLA', 'PLA - Sólida - Preto')
    const row = getFilamentItemRow(dialog, 1)
    await user.click(within(row).getByRole('radio', { name: '1.000 g' }))
    await user.type(within(row).getByLabelText('Quantidade'), '1')
    await user.type(within(row).getByLabelText('Marca'), 'Bambu Lab')

    // Campo nunca tocado (vazio).
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))
    expect(
      await within(dialog).findByText('Informe o valor total do item, maior que zero.'),
    ).toBeInTheDocument()
    expect(registerFilamentPurchaseMock).not.toHaveBeenCalled()

    // Campo digitado e depois zerado explicitamente.
    await user.type(within(row).getByLabelText('Valor total'), '500')
    await user.clear(within(row).getByLabelText('Valor total'))
    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))
    expect(
      await within(dialog).findByText('Informe o valor total do item, maior que zero.'),
    ).toBeInTheDocument()
    expect(registerFilamentPurchaseMock).not.toHaveBeenCalled()
  })

  it('subtotal soma os Valores totais dos itens; frete é somado apenas UMA vez ao Total da compra', async () => {
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
    await fillFilamentItem(user, dialog, 1, {
      query: 'Matte',
      optionName: 'PLA - Matte - Preto',
      weightLabel: '1.000 g',
      quantity: '3',
      manufacturer: 'Bambu Lab',
      totalValueRaw: '15000',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))
    await fillFilamentItem(user, dialog, 2, {
      query: 'Silk',
      optionName: 'PLA - Silk - Dourado',
      weightLabel: '1.000 g',
      quantity: '1',
      manufacturer: 'Voolt',
      totalValueRaw: '5000',
    })
    await user.type(within(dialog).getByLabelText('Valor do frete'), '1000')

    // Subtotal = 150,00 + 50,00 = 200,00; Frete = 10,00 (uma única vez,
    // nunca por item); Total da compra = 210,00.
    expect(within(dialog).getByText(normalizedBRL(21000))).toBeInTheDocument()
    expect(within(dialog).getByText(normalizedBRL(1000))).toBeInTheDocument()
  })

  it('quantidade 3 e Valor total R$ 100,00 não alteram o subtotal exibido (sem erro de ponto flutuante ao dividir por 3)', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await fillFilamentItem(user, dialog, 1, {
      query: 'PLA',
      optionName: 'PLA - Sólida - Preto',
      weightLabel: '250 g',
      quantity: '3',
      manufacturer: 'Bambu Lab',
      totalValueRaw: '10000',
    })

    // Sem frete: Total da compra (= subtotal) continua exatamente
    // R$ 100,00 — nunca R$ 99,99/R$ 100,01 por arredondamento de
    // 100/3 = 33,333... O cálculo exibido usa o total em centavos informado
    // diretamente, nunca quantity × unit_value arredondado.
    expect(within(dialog).getByText(normalizedBRL(10000))).toBeInTheDocument()
    expect(within(dialog).queryByText(normalizedBRL(9999))).not.toBeInTheDocument()
    expect(within(dialog).queryByText(normalizedBRL(10001))).not.toBeInTheDocument()
  })

  it('payload envia o total_value informado diretamente — nunca dividido pelo frontend, mesmo quando a divisão por quantidade não é exata', async () => {
    registerFilamentPurchaseMock.mockResolvedValue(filamentPurchaseResultFixture())
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Filamento')
    await selectPurchaseChannel(user, dialog, 'Mercado Livre')
    await fillFilamentItem(user, dialog, 1, {
      query: 'PLA',
      optionName: 'PLA - Sólida - Preto',
      weightLabel: '250 g',
      quantity: '3',
      manufacturer: 'Bambu Lab',
      totalValueRaw: '10000',
    })

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerFilamentPurchaseMock).toHaveBeenCalledTimes(1))
    const payload = registerFilamentPurchaseMock.mock.calls[0][0]
    // 100,00 ÷ 3 não é exato — mas o frontend nunca divide: envia total_value
    // = 100 tal como digitado. A derivação de unit_value (arredondada ao
    // centavo) acontece só dentro de register_filament_purchase (backend).
    expect(payload.items).toContainEqual(expect.objectContaining({ quantity: 3, total_value: 100 }))
    expect(payload.items[0]).not.toHaveProperty('unit_value')
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
      // Valor total da linha (2 rolos) = R$ 190,00 — enviado tal como digitado.
      totalValueRaw: '19000',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar filamento' }))
    await fillFilamentItem(user, dialog, 2, {
      query: 'Silk',
      optionName: 'PLA - Silk - Dourado',
      weightLabel: '1.000 g',
      quantity: '1',
      manufacturer: 'Voolt',
      totalValueRaw: '11000',
    })

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerFilamentPurchaseMock).toHaveBeenCalledTimes(1))
    const payload = registerFilamentPurchaseMock.mock.calls[0][0]
    expect(payload.freight_value).toBe(30)
    expect(payload.purchase_channel).toBe('MERCADO_LIVRE')
    expect(payload.items).toHaveLength(2)
    // total_value é enviado diretamente, exatamente como digitado — nunca
    // dividido pela quantidade no frontend (2026-09-05, migration
    // 20260905160000: o backend passou a aceitar total_value e derivar
    // unit_value internamente).
    expect(payload.items).toContainEqual({
      filament_type_id: 't-matte',
      manufacturer: 'Bambu Lab',
      nominal_weight_grams: 1000,
      quantity: 2,
      total_value: 190,
    })
    expect(payload.items).toContainEqual({
      filament_type_id: 't-silk',
      manufacturer: 'Voolt',
      nominal_weight_grams: 1000,
      quantity: 1,
      total_value: 110,
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

    await user.type(within(dialog).getByRole('combobox', { name: 'Acessório — item 1' }), 'a')
    expect(screen.queryByRole('option', { name: /Inativo/i })).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /Ativo/i })).toBeInTheDocument()
  })

  it('Acessório: nenhum item ativo cadastrado orienta cadastrar na aba Acessórios', async () => {
    mockAccessories([])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')

    expect(within(dialog).getByText(/cadastre um na aba Acessórios/i)).toBeInTheDocument()
  })

  it('Acessório: envia o payload multi-item correto (total_value direto, sem unit_cost/freight_allocated) e aciona onPurchaseCompleted("ACCESSORY")', async () => {
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', variant: 'azul' }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', variant: null }),
    ])
    registerAccessoryPurchaseMock.mockResolvedValue(accessoryPurchaseResultFixture())
    const onPurchaseCompleted = vi.fn()
    render(<PurchaseDialog onPurchaseCompleted={onPurchaseCompleted} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')

    await fillAccessoryRow(user, dialog, 1, {
      search: 'Ímã',
      option: /Ímã 6x2/i,
      quantity: '4',
      totalDigits: '4000',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar outro acessório' }))
    await fillAccessoryRow(user, dialog, 2, {
      search: 'Parafuso',
      option: /Parafuso/i,
      quantity: '10',
      totalDigits: '1000',
    })
    await user.type(within(dialog).getByLabelText('Fornecedor (opcional)'), 'Loja X')
    await user.type(within(dialog).getByLabelText('Valor do frete'), '500')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(registerAccessoryPurchaseMock).toHaveBeenCalledTimes(1))
    const payload = registerAccessoryPurchaseMock.mock.calls[0][0]
    expect(payload).toMatchObject({
      freight_value: 5,
      supplier_name: 'Loja X',
      items: [
        { accessory_id: 'a1', quantity: 4, total_value: 40 },
        { accessory_id: 'a2', quantity: 10, total_value: 10 },
      ],
    })
    expect(payload.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(payload.idempotency_key).toBeTruthy()
    // O frontend NUNCA envia unit_cost, freight_allocated nem saldos.
    expect(JSON.stringify(payload)).not.toMatch(/unit_cost|freight_allocated|balance_before|balance_after/)
    expect(toastMock.success).toHaveBeenCalledWith('Compra registrada.')
    expect(onPurchaseCompleted).toHaveBeenCalledWith('ACCESSORY')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Acessório: quantidade ausente bloqueia o envio', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')
    const row = within(dialog).getByRole('group', { name: 'Item 1' })
    await user.type(
      within(row).getByRole('combobox', { name: 'Acessório — item 1' }),
      'Ímã',
    )
    await user.click(await within(row).findByRole('option', { name: /Ímã 6x2/i }))
    await user.type(within(row).getByLabelText('Valor total'), '100')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))
    expect(await within(dialog).findByText(/^informe a quantidade/i)).toBeInTheDocument()
    expect(registerAccessoryPurchaseMock).not.toHaveBeenCalled()
  })

  it('Acessório: valor total zero bloqueia o envio', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')
    const row = within(dialog).getByRole('group', { name: 'Item 1' })
    await user.type(within(row).getByRole('combobox', { name: 'Acessório — item 1' }), 'Ímã')
    await user.click(await within(row).findByRole('option', { name: /Ímã 6x2/i }))
    await user.type(within(row).getByLabelText('Quantidade'), '2')

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))
    expect(await within(dialog).findByText(/informe o valor total do item/i)).toBeInTheDocument()
    expect(registerAccessoryPurchaseMock).not.toHaveBeenCalled()
  })

  it('Acessório: o mesmo acessório não pode aparecer em duas linhas', async () => {
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')

    await fillAccessoryRow(user, dialog, 1, {
      search: 'Ímã',
      option: /Ímã 6x2/i,
      quantity: '1',
      totalDigits: '100',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar outro acessório' }))
    // A 2a linha nem oferece o acessório já escolhido na 1a
    const row2 = within(dialog).getByRole('group', { name: 'Item 2' })
    await user.type(within(row2).getByRole('combobox', { name: 'Acessório — item 2' }), 'Ímã')
    expect(screen.queryByRole('option', { name: /Ímã 6x2/i })).not.toBeInTheDocument()
  })

  it('Acessório: erro de negócio do backend vira toast, nunca fecha o diálogo', async () => {
    registerAccessoryPurchaseMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'está inativo'),
    )
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')
    await fillAccessoryRow(user, dialog, 1, {
      search: 'Ímã',
      option: /Ímã 6x2/i,
      quantity: '1',
      totalDigits: '100',
    })

    await user.click(within(dialog).getByRole('button', { name: /^registrar compra$/i }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('está inativo'))
    expect(registerAccessoryPurchaseMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Compra de acessórios' })).toBeInTheDocument()
  })

  it('Acessório: começa com uma linha; adicionar cria a linha 2; remover volta a 1; a última nunca é removível', async () => {
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã' }),
      accessoryFixture({ id: 'a2', name: 'Parafuso' }),
    ])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')

    expect(within(dialog).getByRole('group', { name: 'Item 1' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('group', { name: 'Item 2' })).not.toBeInTheDocument()
    // a única linha não pode ser removida
    expect(
      within(within(dialog).getByRole('group', { name: 'Item 1' })).getByRole('button', {
        name: 'Remover item 1',
      }),
    ).toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'Adicionar outro acessório' }))
    expect(within(dialog).getByRole('group', { name: 'Item 2' })).toBeInTheDocument()

    await user.click(
      within(within(dialog).getByRole('group', { name: 'Item 2' })).getByRole('button', {
        name: 'Remover item 2',
      }),
    )
    expect(within(dialog).queryByRole('group', { name: 'Item 2' })).not.toBeInTheDocument()
  })

  it('Acessório: não passa de 50 itens (botão "Adicionar outro acessório" desabilita no teto)', async () => {
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã' })])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')

    // fireEvent.click (síncrono) evita o pipeline completo do userEvent 49x —
    // o objetivo aqui é só o teto de 50, não a interação fina.
    const addButton = within(dialog).getByRole('button', { name: 'Adicionar outro acessório' })
    for (let i = 0; i < 60 && !(addButton as HTMLButtonElement).disabled; i++) {
      fireEvent.click(addButton)
    }
    await waitFor(() =>
      expect(within(dialog).getAllByRole('group', { name: /^Item \d+$/ })).toHaveLength(50),
    )
    expect(addButton).toBeDisabled()
  })

  it('Acessório: subtotal soma os "Valor total" das linhas; frete é somado UMA vez ao Total da compra', async () => {
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã' }),
      accessoryFixture({ id: 'a2', name: 'Parafuso' }),
    ])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')

    await fillAccessoryRow(user, dialog, 1, {
      search: 'Ímã',
      option: /Ímã/i,
      quantity: '2',
      totalDigits: '3000', // R$ 30,00
    })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar outro acessório' }))
    await fillAccessoryRow(user, dialog, 2, {
      search: 'Parafuso',
      option: /Parafuso/i,
      quantity: '5',
      totalDigits: '2000', // R$ 20,00
    })
    await user.type(within(dialog).getByLabelText('Valor do frete'), '1000') // R$ 10,00

    const resumo = within(dialog).getByText('Resumo').closest('div') as HTMLElement
    expect(within(resumo).getByText(normalizedBRL(5000))).toBeInTheDocument() // Subtotal 50,00
    expect(within(resumo).getByText(normalizedBRL(6000))).toBeInTheDocument() // Total 60,00
  })

  it('Acessório: previsão do Custo unitário aparece rotulada como previsão (valor final do servidor)', async () => {
    // saldo 10 × R$ 1,00 ; compra 5 un por R$ 10,00 sem frete
    // -> (1000 + 1000) / 15 = 133,33 centavos -> R$ 1,33
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', variant: 'azul', current_stock: 10, unit_cost: 1 })])
    render(<PurchaseDialog onPurchaseCompleted={vi.fn()} />)
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await selectCategory(user, dialog, 'Acessório')
    await fillAccessoryRow(user, dialog, 1, {
      search: 'Ímã',
      option: /Ímã 6x2/i,
      quantity: '5',
      totalDigits: '1000',
    })

    expect(within(dialog).getByText(/Custo unitário previsto/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/Ímã 6x2 — azul:/)).toBeInTheDocument()
    expect(within(dialog).getByText(normalizedBRL(133))).toBeInTheDocument()
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
