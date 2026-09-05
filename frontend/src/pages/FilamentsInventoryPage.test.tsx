import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { FilamentSpool, FilamentTypeSummary } from '@/types/domain'

const {
  useFilamentTypesMock,
  useFilamentSpoolsMock,
  useFilamentSpoolCountsMock,
  useFilamentMovementsMock,
  useAuthMock,
  toastMock,
  registerFilamentPurchaseMock,
} = vi.hoisted(() => ({
  useFilamentTypesMock: vi.fn(),
  useFilamentSpoolsMock: vi.fn(),
  useFilamentSpoolCountsMock: vi.fn(),
  useFilamentMovementsMock: vi.fn(),
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  // Só para o describe "atualização automática sem F5" no fim deste arquivo
  // (2026-09-04) — registra uma compra de verdade pela janela real de
  // Compras, renderizada de dentro de InventoryPageShell (nunca mockada),
  // para provar a sincronização entre os dois diálogos.
  registerFilamentPurchaseMock: vi.fn(),
}))

vi.mock('@/hooks/useFilamentTypes', () => ({ useFilamentTypes: useFilamentTypesMock }))
vi.mock('@/hooks/useFilamentSpools', () => ({ useFilamentSpools: useFilamentSpoolsMock }))
vi.mock('@/hooks/useFilamentSpoolCounts', () => ({
  useFilamentSpoolCounts: useFilamentSpoolCountsMock,
}))
vi.mock('@/hooks/useFilamentMovements', () => ({ useFilamentMovements: useFilamentMovementsMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/lib/api/inventoryPurchases', () => ({
  registerFilamentPurchase: registerFilamentPurchaseMock,
  registerInventoryPurchase: vi.fn(),
}))

import { FilamentsInventoryPage } from './FilamentsInventoryPage'

function typeFixture(overrides: Partial<FilamentTypeSummary> = {}): FilamentTypeSummary {
  return {
    filament_type_id: 't1',
    material: 'PLA',
    manufacturer: 'Voolt3D',
    line: 'Sólida',
    commercial_color: 'Preto',
    color_code: null,
    minimum_stock_grams: 200,
    is_active: true,
    total_available_grams: 500,
    usable_spool_count: 1,
    total_spool_count: 1,
    ...overrides,
  }
}

function spoolFixture(overrides: Partial<FilamentSpool> = {}): FilamentSpool {
  return {
    id: 's1',
    code: 'RL-26-001',
    filament_type_id: 't1',
    nominal_weight_grams: 1000,
    current_net_weight_grams: 500,
    empty_spool_weight_grams: 200,
    received_at: null,
    opened_at: null,
    status: 'ABERTO',
    notes: null,
    is_active: true,
    created_at: '',
    updated_at: '',
    initial_gross_weight_grams: null,
    purchase_id: null,
    purchase_item_id: null,
    purchase_item_manufacturer: null,
    has_movement_history: false,
    ...overrides,
  }
}

// Plano de remoção padrão, derivado do fixture: com rolo -> ARCHIVED, sem
// rolo -> PHYSICALLY_DELETED. Testes de bloqueio/mudança de plano passam um
// getRemovalPlan explícito.
function defaultRemovalPlan(list: FilamentTypeSummary[]) {
  return vi.fn(async (id: string) => {
    const t = list.find((x) => x.filament_type_id === id)
    const hasInventory = (t?.total_spool_count ?? 0) > 0
    return {
      success: true as const,
      planned_result: hasInventory ? ('ARCHIVED' as const) : ('PHYSICALLY_DELETED' as const),
      spool_count: t?.total_spool_count ?? 0,
      active_spool_count: t?.total_spool_count ?? 0,
      active_order_numbers: [] as string[],
      has_movements: false,
      has_purchases: false,
      has_product_filaments: false,
      has_product_plate_filaments: false,
      has_order_selection: hasInventory,
    }
  })
}

function mockTypes(
  list: FilamentTypeSummary[],
  overrides: Partial<{
    isLoading: boolean
    error: unknown
    refetch: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    getRemovalPlan: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }> = {},
) {
  useFilamentTypesMock.mockReturnValue({
    types: list,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    create: overrides.create ?? vi.fn().mockResolvedValue(typeFixture()),
    update: overrides.update ?? vi.fn().mockResolvedValue(typeFixture()),
    getRemovalPlan: overrides.getRemovalPlan ?? defaultRemovalPlan(list),
    delete:
      overrides.delete ??
      vi.fn().mockResolvedValue({ success: true, result: 'ARCHIVED', archived_spool_count: 0 }),
  })
}

function mockSpools(
  list: FilamentSpool[],
  overrides: Partial<{
    isLoading: boolean
    error: unknown
    refetch: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    setLocalSpoolState: ReturnType<typeof vi.fn>
  }> = {},
) {
  useFilamentSpoolsMock.mockReturnValue({
    spools: list,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    create: overrides.create ?? vi.fn().mockResolvedValue(spoolFixture()),
    update: overrides.update ?? vi.fn().mockResolvedValue(spoolFixture()),
    delete: overrides.delete ?? vi.fn().mockResolvedValue(undefined),
    setLocalSpoolState: overrides.setLocalSpoolState ?? vi.fn(),
  })
}

function mockMovements(
  overrides: Partial<{
    movements: unknown[]
    isLoading: boolean
    loadError: unknown
    refetch: ReturnType<typeof vi.fn>
    isRegistering: boolean
    register: ReturnType<typeof vi.fn>
    isWeighing: boolean
    weigh: ReturnType<typeof vi.fn>
  }> = {},
) {
  useFilamentMovementsMock.mockReturnValue({
    movements: overrides.movements ?? [],
    isLoading: overrides.isLoading ?? false,
    loadError: overrides.loadError ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    isRegistering: overrides.isRegistering ?? false,
    register: overrides.register ?? vi.fn(),
    isWeighing: overrides.isWeighing ?? false,
    weigh: overrides.weigh ?? vi.fn(),
  })
}

const refetchCountsMock = vi.fn()

// Por padrão a contagem de rolos disponíveis é derivada dinamicamente do
// `usable_spool_count` dos tipos configurados em useFilamentTypesMock — só
// por conveniência de teste (o hook real faz a consulta correta em
// filament_spools). Testes que precisam provar a divergência
// (usable_spool_count != contagem real, erro, loading) sobrescrevem
// useFilamentSpoolCountsMock explicitamente via mockSpoolCounts.
function mockSpoolCounts(
  overrides: Partial<{
    countByTypeId: Map<string, number> | null
    isLoading: boolean
    error: unknown
    refetch: ReturnType<typeof vi.fn>
  }> = {},
) {
  useFilamentSpoolCountsMock.mockImplementation(() => {
    if ('countByTypeId' in overrides || overrides.isLoading !== undefined || overrides.error) {
      return {
        countByTypeId: overrides.countByTypeId ?? null,
        isLoading: overrides.isLoading ?? false,
        error: overrides.error ?? null,
        refetch: overrides.refetch ?? refetchCountsMock,
      }
    }
    const { types } = useFilamentTypesMock() as { types: FilamentTypeSummary[] }
    return {
      countByTypeId: new Map(types.map((type) => [type.filament_type_id, type.usable_spool_count])),
      isLoading: false,
      error: null,
      refetch: overrides.refetch ?? refetchCountsMock,
    }
  })
}

function renderPage() {
  useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
  return render(<FilamentsInventoryPage />, { wrapper: MemoryRouter })
}

// Linha da listagem principal (consolidada) por rótulo Material·Linha·Cor —
// o material aparece em várias linhas, então casa a linha que também tem a
// linha e a cor esperadas.
function getGroupRow(material: string, line: string, color: string): HTMLElement {
  const rows = within(screen.getByRole('table')).getAllByRole('row')
  const match = rows.find((row) => {
    const cells = within(row).queryAllByRole('cell')
    return (
      cells[0]?.textContent === material &&
      cells[1]?.textContent === line &&
      cells[2]?.textContent === color
    )
  })
  if (!match) throw new Error(`linha não encontrada: ${material} / ${line} / ${color}`)
  return match
}

function getVisibleGroupLabels(): string[] {
  const rows = within(screen.getByRole('table')).getAllByRole('row')
  return rows
    .map((row) => within(row).queryAllByRole('cell'))
    .filter((cells) => cells.length > 0)
    .map((cells) => `${cells[0].textContent}/${cells[1].textContent}/${cells[2].textContent}`)
}

// O botão externo continua "Ver rolos"; a JANELA aberta tem como título a
// identificação dinâmica do grupo (Material - Linha - Cor, Linha já com o
// rótulo de exibição consolidado — resolveFilamentLineDisplayLabel,
// 2026-09-05), então o diálogo é localizado por esse nome (default =
// fixture PLA/Sólida/Preto, exibido como "PLA - Sólido - Preto").
async function openDrawer(
  user: ReturnType<typeof userEvent.setup>,
  groupRow: HTMLElement,
  dialogName: string | RegExp = 'PLA - Sólido - Preto',
) {
  await user.click(within(groupRow).getByRole('button', { name: /^ver rolos/i }))
  return screen.getByRole('dialog', { name: dialogName })
}

function getSpoolsTable(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('table')
}

describe('FilamentsInventoryPage — listagem consolidada por Material + Linha + Cor', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    mockSpools([])
    mockMovements()
    mockSpoolCounts()
  })

  it('não exibe a coluna Fabricante nem o Switch "Ativo" na listagem principal', () => {
    mockTypes([typeFixture()])
    renderPage()
    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((h) => h.textContent ?? '')
    expect(headers.some((h) => /fabricante/i.test(h))).toBe(false)
    expect(within(screen.getByRole('table')).queryByRole('switch')).not.toBeInTheDocument()
    expect(headers.map((h) => h.replace(/Redimensionar coluna.*/i, '').trim())).toEqual([
      'Material',
      'Linha',
      'Cor',
      'Disponível',
      'Rolos disponíveis',
      'Estoque mínimo',
      'Situação',
      '',
    ])
  })

  it('dois fabricantes com mesmo Material + Linha + Cor viram UMA linha; peso e rolos são a soma consolidada', () => {
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        manufacturer: 'Voolt3D',
        total_available_grams: 500,
        usable_spool_count: 1,
      }),
      typeFixture({
        filament_type_id: 'b',
        manufacturer: 'National3D',
        total_available_grams: 300,
        usable_spool_count: 2,
      }),
    ])
    renderPage()

    const rows = within(screen.getByRole('table'))
      .getAllByRole('row')
      .filter((r) => within(r).queryAllByRole('cell').length > 0)
    expect(rows).toHaveLength(1)
    const cells = within(rows[0]).getAllByRole('cell')
    expect(cells[3].textContent).toBe('800g')
    expect(cells[4].textContent).toBe('3')
  })

  it('fabricante diferente não cria linha adicional; Material/Linha/Cor diferentes criam grupos distintos', () => {
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        manufacturer: 'A',
        material: 'PLA',
        line: 'Basic',
        commercial_color: 'Preto',
      }),
      typeFixture({
        filament_type_id: 'b',
        manufacturer: 'B',
        material: 'PLA',
        line: 'Basic',
        commercial_color: 'Preto',
      }),
      typeFixture({
        filament_type_id: 'c',
        manufacturer: 'C',
        material: 'PETG',
        line: 'Basic',
        commercial_color: 'Preto',
      }),
      typeFixture({
        filament_type_id: 'd',
        manufacturer: 'D',
        material: 'PLA',
        line: 'Matte',
        commercial_color: 'Preto',
      }),
    ])
    renderPage()
    expect(getVisibleGroupLabels()).toEqual([
      'PETG/Basic/Preto',
      'PLA/Basic/Preto',
      'PLA/Mate/Preto',
    ])
  })

  it('grafias equivalentes (maiúsculas/acentos/espaços) não criam linhas duplicadas', () => {
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        line: 'Basic',
        commercial_color: 'Vermelhão',
        total_available_grams: 100,
      }),
      typeFixture({
        filament_type_id: 'b',
        line: ' basic ',
        commercial_color: 'vermelhao',
        total_available_grams: 100,
      }),
    ])
    renderPage()
    const rows = within(screen.getByRole('table'))
      .getAllByRole('row')
      .filter((r) => within(r).queryAllByRole('cell').length > 0)
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getAllByRole('cell')[3].textContent).toBe('200g')
  })

  it('rolos arquivados/descartados/esgotados/zerados não entram na contagem consolidada (via view)', () => {
    // A view já exclui esses casos de usable_spool_count/total_available_grams;
    // a listagem só soma os agregados por grupo.
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        usable_spool_count: 2,
        total_spool_count: 6,
        total_available_grams: 400,
      }),
      typeFixture({
        filament_type_id: 'b',
        usable_spool_count: 0,
        total_spool_count: 3,
        total_available_grams: 0,
      }),
    ])
    renderPage()
    const cells = within(getGroupRow('PLA', 'Sólido', 'Preto')).getAllByRole('cell')
    expect(cells[3].textContent).toBe('400g')
    expect(cells[4].textContent).toBe('2')
  })

  it('a situação de estoque usa o disponível e o mínimo CONSOLIDADOS (maior mínimo dos tipos ativos)', () => {
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        is_active: true,
        minimum_stock_grams: 200,
        total_available_grams: 300,
      }),
      typeFixture({
        filament_type_id: 'b',
        is_active: true,
        minimum_stock_grams: 500,
        total_available_grams: 100,
      }),
    ])
    renderPage()
    // disponível consolidado 400 <= maior mínimo ativo 500 -> Estoque baixo
    expect(
      within(getGroupRow('PLA', 'Sólido', 'Preto')).getByText('Estoque baixo'),
    ).toBeInTheDocument()
  })

  it('Situação Normal usa badge verde (mesmo padrão de sucesso do sistema), com o texto "Normal"', () => {
    // Fixture padrão: disponível 500 > mínimo 200 -> normal.
    mockTypes([typeFixture()])
    renderPage()
    const badge = within(getGroupRow('PLA', 'Sólido', 'Preto')).getByText('Normal')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('emerald')
    expect(
      within(getGroupRow('PLA', 'Sólido', 'Preto')).queryByText('Estoque normal'),
    ).not.toBeInTheDocument()
  })

  it('demais situações (Estoque baixo/Sem estoque) preservam rótulo e cor atuais — só Normal mudou', () => {
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        commercial_color: 'Preto',
        minimum_stock_grams: 500,
        total_available_grams: 300,
      }),
      typeFixture({
        filament_type_id: 'b',
        commercial_color: 'Azul',
        minimum_stock_grams: null,
        total_available_grams: 0,
      }),
    ])
    renderPage()
    const lowBadge = within(getGroupRow('PLA', 'Sólido', 'Preto')).getByText('Estoque baixo')
    expect(lowBadge.className).toContain('amber')
    const emptyBadge = within(getGroupRow('PLA', 'Sólido', 'Azul')).getByText('Sem estoque')
    expect(emptyBadge.className).toContain('destructive')
  })

  it('coluna "Estoque mínimo" aparece e formata com ponto de milhar ("1.000 g")', () => {
    mockTypes([typeFixture({ minimum_stock_grams: 1000 })])
    renderPage()
    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((h) => (h.textContent ?? '').replace(/Redimensionar coluna.*/i, '').trim())
    expect(headers).toContain('Estoque mínimo')
    const cells = within(getGroupRow('PLA', 'Sólido', 'Preto')).getAllByRole('cell')
    expect(cells[5].textContent).toBe('1.000 g')
  })

  it('coluna "Estoque mínimo" mostra "—" quando o grupo não tem mínimo configurado (nenhum tipo ativo com limite)', () => {
    mockTypes([typeFixture({ minimum_stock_grams: null })])
    renderPage()
    const cells = within(getGroupRow('PLA', 'Sólido', 'Preto')).getAllByRole('cell')
    expect(cells[5].textContent).toBe('—')
  })

  it('coluna "Estoque mínimo" considera só tipos ATIVOS do grupo (mesma regra do resumo de "Ver rolos")', () => {
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        is_active: true,
        minimum_stock_grams: null,
      }),
      typeFixture({
        filament_type_id: 'b',
        is_active: false,
        minimum_stock_grams: 5000,
      }),
    ])
    renderPage()
    // O tipo inativo tem mínimo 5000, mas não conta — só o ativo (sem
    // mínimo) é considerado, então o grupo mostra "—".
    const cells = within(getGroupRow('PLA', 'Sólido', 'Preto')).getAllByRole('cell')
    expect(cells[5].textContent).toBe('—')
  })

  it('ordena por Material -> Linha -> Cor (rótulo consolidado), nunca por fabricante', () => {
    mockTypes([
      typeFixture({
        filament_type_id: '1',
        material: 'PLA',
        line: 'Basic',
        commercial_color: 'Verde',
        manufacturer: 'ZZZ',
      }),
      typeFixture({
        filament_type_id: '2',
        material: 'PLA',
        line: 'Basic',
        commercial_color: 'Amarelo',
        manufacturer: 'AAA',
      }),
      typeFixture({
        filament_type_id: '3',
        material: 'PETG',
        line: 'Matte',
        commercial_color: 'Azul',
        manufacturer: 'MMM',
      }),
    ])
    renderPage()
    expect(getVisibleGroupLabels()).toEqual([
      'PETG/Mate/Azul',
      'PLA/Basic/Amarelo',
      'PLA/Basic/Verde',
    ])
  })

  it('busca encontra por Material, Linha, Cor e por QUALQUER fabricante do grupo (mesmo sem coluna Fabricante)', async () => {
    mockTypes([
      typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 'b', manufacturer: 'National3D', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 'c', manufacturer: 'Outra', commercial_color: 'Azul' }),
    ])
    renderPage()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Buscar tipos de filamento'), 'national')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/Preto'])

    await user.clear(screen.getByLabelText('Buscar tipos de filamento'))
    await user.type(screen.getByLabelText('Buscar tipos de filamento'), 'azul')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/Azul'])
  })

  it('estado vazio específico quando busca/filtros não retornam nada', async () => {
    mockTypes([typeFixture()])
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Buscar tipos de filamento'), 'inexistente')
    expect(
      screen.getByText('Nenhum resultado para a busca e os filtros atuais.'),
    ).toBeInTheDocument()
  })

  it('estado vazio quando não há nenhum tipo cadastrado', () => {
    mockTypes([])
    renderPage()
    expect(screen.getByText('Nenhum tipo de filamento cadastrado.')).toBeInTheDocument()
  })
})

describe('FilamentsInventoryPage — coluna Cor como badge (2026-09-04)', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    mockSpools([])
    mockMovements()
    mockSpoolCounts()
  })

  it('1. a Cor aparece como badge (não mais texto solto) na linha do grupo', () => {
    mockTypes([typeFixture({ commercial_color: 'Preto' })])
    renderPage()
    const badge = within(getGroupRow('PLA', 'Sólido', 'Preto')).getByText('Preto')
    expect(badge.tagName).toBe('SPAN')
    expect(badge.className).toContain('rounded-md')
    expect(badge.className).toContain('border')
  })

  it('2. o mesmo badge é o que aparece em qualquer largura de tela — esta listagem consolidada nunca teve um card mobile separado (só a <table> com overflow-x-auto), então não há um segundo lugar para duplicar o mapeamento de cor', () => {
    mockTypes([typeFixture({ commercial_color: 'Azul' })])
    renderPage()
    // Um único elemento com o texto "Azul" no documento inteiro — não dois
    // (um de tabela, outro de card), confirmando que existe só UM caminho
    // de renderização para a Cor nesta listagem.
    expect(screen.getAllByText('Azul')).toHaveLength(1)
    expect(screen.getByText('Azul').className).toContain('rounded-md')
  })

  it('3. Preto recebe o estilo escuro próprio do mapeamento de cor', () => {
    mockTypes([typeFixture({ commercial_color: 'Preto' })])
    renderPage()
    expect(screen.getByText('Preto').className).toContain('neutral-800')
  })

  it('4. "Azul claro" recebe estilo azul (variante clara, distinta do "Azul" simples)', () => {
    mockTypes([typeFixture({ commercial_color: 'Azul claro' })])
    renderPage()
    expect(screen.getByText('Azul claro').className).toContain('sky')
  })

  it('5. Dourado permanece legível — texto num tom mais escuro (text-*-900)', () => {
    mockTypes([typeFixture({ commercial_color: 'Dourado' })])
    renderPage()
    expect(screen.getByText('Dourado').className).toContain('text-yellow-900')
  })

  it('6. Branco permanece visível — nunca fundo branco puro sobre o fundo branco da página', () => {
    mockTypes([typeFixture({ commercial_color: 'Branco' })])
    renderPage()
    const badge = screen.getByText('Branco')
    expect(badge.className).not.toContain('bg-white')
    expect(badge.className).toContain('border-slate-400')
  })

  it('7. a identificação da cor ignora acentos e caixa (grafias diferentes do mesmo tipo recebem o mesmo estilo)', () => {
    mockTypes([
      typeFixture({ filament_type_id: 'a', commercial_color: 'ROXO' }),
      typeFixture({ filament_type_id: 'b', commercial_color: 'roxo', line: 'Silk' }),
    ])
    renderPage()
    const upper = screen.getByText('ROXO')
    const lower = screen.getByText('roxo')
    expect(upper.className).toBe(lower.className)
    expect(upper.className).toContain('purple')
  })

  it('8. o texto original cadastrado é sempre preservado por completo dentro do badge', () => {
    mockTypes([typeFixture({ commercial_color: 'Azul Bambu Lab' })])
    renderPage()
    const badge = screen.getByText('Azul Bambu Lab')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('blue')
  })

  it('9. uma cor não reconhecida usa o estilo neutro, nunca texto invisível', () => {
    mockTypes([typeFixture({ commercial_color: 'Holográfico' })])
    renderPage()
    const badge = screen.getByText('Holográfico')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('border-input')
    expect(badge.className).toContain('text-muted-foreground')
  })

  it('10. Situação e as demais colunas continuam exatamente como antes — só a Cor virou badge', () => {
    mockTypes([typeFixture({ commercial_color: 'Preto', minimum_stock_grams: 200 })])
    renderPage()
    const row = getGroupRow('PLA', 'Sólido', 'Preto')
    expect(within(row).getByText('PLA')).toBeInTheDocument()
    expect(within(row).getByText('Sólido')).toBeInTheDocument()
    const situationBadge = within(row).getByText('Normal')
    expect(situationBadge.className).toContain('emerald')
    expect(within(row).getByText('500g')).toBeInTheDocument()
    expect(within(row).getByText('200 g')).toBeInTheDocument()
  })
})

describe('FilamentsInventoryPage — filtros Material / Linha / Cor', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    mockSpools([])
    mockMovements()
    mockSpoolCounts()
    mockTypes([
      typeFixture({
        filament_type_id: '1',
        material: 'PLA',
        line: 'Sólida',
        commercial_color: 'Preto',
      }),
      typeFixture({
        filament_type_id: '2',
        material: 'PLA',
        line: 'Matte',
        commercial_color: 'Branco',
      }),
      typeFixture({
        filament_type_id: '3',
        material: 'PETG',
        line: 'Sólida',
        commercial_color: 'Preto',
      }),
      typeFixture({
        filament_type_id: '4',
        material: 'TPU',
        line: 'Matte',
        commercial_color: 'Vermelho',
      }),
    ])
  })

  // Material/Linha (2026-09-05): action buttons de seleção única, sempre
  // visíveis (nunca um Popover) — os dois radiogroups são localizados pelo
  // mesmo aria-label passado a SingleSelectActionFilter.
  function materialFilterGroup(): HTMLElement {
    return screen.getByRole('radiogroup', { name: 'Filtrar por material' })
  }
  function lineFilterGroup(): HTMLElement {
    return screen.getByRole('radiogroup', { name: 'Filtrar por linha' })
  }

  // Cor continua um Popover multisseleção (inalterado) — mesmo helper de
  // sempre para marcar opções dentro dele.
  async function selectColorOptions(user: ReturnType<typeof userEvent.setup>, options: string[]) {
    await user.click(screen.getByRole('button', { name: /^Cor/ }))
    for (const option of options) {
      await user.click(await screen.findByRole('checkbox', { name: option }))
    }
    await user.click(screen.getByRole('heading', { level: 1 }))
  }

  it('Material aparece como action buttons — Todos, PLA, PETG, TPU, nesta ordem; "Todos" é o estado inicial', () => {
    renderPage()
    const radios = within(materialFilterGroup()).getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual(['Todos', 'PLA', 'PETG', 'TPU'])
    expect(within(materialFilterGroup()).getByRole('radio', { name: 'Todos' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('Linha aparece como action buttons — Todos + as 7 linhas oficiais, nesta ordem; "Todos" é o estado inicial', () => {
    renderPage()
    const radios = within(lineFilterGroup()).getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual([
      'Todos',
      'Sólido',
      'Silk',
      'Mate',
      'Velvet',
      'Translúcido',
      'Duocolor',
      'Tricolor',
    ])
    expect(within(lineFilterGroup()).getByRole('radio', { name: 'Todos' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('filtra por Material — só uma opção ativa por vez, aplicado imediatamente (sem F5)', async () => {
    renderPage()
    const user = userEvent.setup()
    const group = materialFilterGroup()

    await user.click(within(group).getByRole('radio', { name: 'PLA' }))
    expect(within(group).getByRole('radio', { name: 'PLA' })).toHaveAttribute('aria-checked', 'true')
    expect(within(group).getByRole('radio', { name: 'Todos' })).toHaveAttribute('aria-checked', 'false')
    expect(getVisibleGroupLabels().every((l) => l.startsWith('PLA'))).toBe(true)
    expect(getVisibleGroupLabels()).toHaveLength(2)

    // Escolher outro Material SUBSTITUI a seleção — nunca soma as duas.
    await user.click(within(group).getByRole('radio', { name: 'PETG' }))
    expect(within(group).getByRole('radio', { name: 'PLA' })).toHaveAttribute('aria-checked', 'false')
    expect(within(group).getByRole('radio', { name: 'PETG' })).toHaveAttribute('aria-checked', 'true')
    expect(getVisibleGroupLabels()).toEqual(['PETG/Sólido/Preto'])
  })

  it('filtra por Linha — só uma opção ativa por vez, casando com variações de grafia (Matte -> Mate)', async () => {
    renderPage()
    const user = userEvent.setup()
    const group = lineFilterGroup()

    await user.click(within(group).getByRole('radio', { name: 'Mate' }))
    expect(within(group).getByRole('radio', { name: 'Mate' })).toHaveAttribute('aria-checked', 'true')
    expect(getVisibleGroupLabels().sort()).toEqual(['PLA/Mate/Branco', 'TPU/Mate/Vermelho'])

    await user.click(within(group).getByRole('radio', { name: 'Sólido' }))
    expect(within(group).getByRole('radio', { name: 'Mate' })).toHaveAttribute('aria-checked', 'false')
    expect(getVisibleGroupLabels().sort()).toEqual(['PETG/Sólido/Preto', 'PLA/Sólido/Preto'])
  })

  it('clicar na opção JÁ ativa não dispara nova operação — continua selecionada, resultado inalterado', async () => {
    renderPage()
    const user = userEvent.setup()
    const group = materialFilterGroup()

    await user.click(within(group).getByRole('radio', { name: 'PLA' }))
    expect(getVisibleGroupLabels()).toHaveLength(2)
    await user.click(within(group).getByRole('radio', { name: 'PLA' }))
    expect(within(group).getByRole('radio', { name: 'PLA' })).toHaveAttribute('aria-checked', 'true')
    expect(getVisibleGroupLabels()).toHaveLength(2)
  })

  it('relação AND entre Material e Linha: PLA + Mate mostra só filamentos PLA da linha Mate', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(within(materialFilterGroup()).getByRole('radio', { name: 'PLA' }))
    await user.click(within(lineFilterGroup()).getByRole('radio', { name: 'Mate' }))
    expect(getVisibleGroupLabels()).toEqual(['PLA/Mate/Branco'])
  })

  it('combina Material + Linha com o filtro de Cor e com a busca (tudo em AND)', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(within(materialFilterGroup()).getByRole('radio', { name: 'PLA' }))
    await selectColorOptions(user, ['Preto'])
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/Preto'])

    await user.type(screen.getByLabelText('Buscar tipos de filamento'), 'branco')
    // Zero resultados -> a tabela some, dá lugar à mensagem de estado vazio
    // (nunca uma <table> sem linhas).
    expect(
      screen.getByText('Nenhum resultado para a busca e os filtros atuais.'),
    ).toBeInTheDocument()
  })

  it('"Limpar filtros" volta Material e Linha para "Todos" (e limpa Cor)', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(within(materialFilterGroup()).getByRole('radio', { name: 'PLA' }))
    await user.click(within(lineFilterGroup()).getByRole('radio', { name: 'Mate' }))
    expect(screen.getByRole('button', { name: /^Limpar filtros \(2\)/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Limpar filtros/ }))
    expect(screen.queryByRole('button', { name: /^Limpar filtros/ })).not.toBeInTheDocument()
    expect(within(materialFilterGroup()).getByRole('radio', { name: 'Todos' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(lineFilterGroup()).getByRole('radio', { name: 'Todos' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(getVisibleGroupLabels()).toHaveLength(4)
  })

  it('Sólido consolida Sólida, Solida, Solido e Sólido — o botão encontra todas as variações de grafia', async () => {
    mockTypes([
      typeFixture({ filament_type_id: '1', material: 'PLA', line: 'Sólida', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: '2', material: 'PLA', line: 'Solida', commercial_color: 'Branco' }),
      typeFixture({ filament_type_id: '3', material: 'PLA', line: 'Solido', commercial_color: 'Azul' }),
      typeFixture({ filament_type_id: '4', material: 'PLA', line: 'Sólido', commercial_color: 'Verde' }),
      typeFixture({ filament_type_id: '5', material: 'PLA', line: 'Silk', commercial_color: 'Preto' }),
    ])
    renderPage()
    const user = userEvent.setup()

    // Coluna Linha já mostra as 4 grafias como o mesmo rótulo consolidado.
    for (const color of ['Preto', 'Branco', 'Azul', 'Verde']) {
      expect(getVisibleGroupLabels()).toContain(`PLA/Sólido/${color}`)
    }

    await user.click(within(lineFilterGroup()).getByRole('radio', { name: 'Sólido' }))
    expect(getVisibleGroupLabels().sort()).toEqual([
      'PLA/Sólido/Azul',
      'PLA/Sólido/Branco',
      'PLA/Sólido/Preto',
      'PLA/Sólido/Verde',
    ])
  })

  it('o filtro de Linha tem sempre exatamente as 8 opções fixas, mesmo com várias grafias diferentes nos dados', () => {
    mockTypes([
      typeFixture({ filament_type_id: 'a', line: 'Sólida', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 'b', line: ' solido ', commercial_color: 'Branco' }),
      typeFixture({ filament_type_id: 'c', line: 'Matte', commercial_color: 'Azul' }),
      typeFixture({ filament_type_id: 'd', line: 'Linha Histórica Sem Alias', commercial_color: 'Verde' }),
    ])
    renderPage()
    const radios = within(lineFilterGroup()).getAllByRole('radio')
    expect(radios).toHaveLength(8)
    expect(radios.map((r) => r.textContent)).toEqual([
      'Todos',
      'Sólido',
      'Silk',
      'Mate',
      'Velvet',
      'Translúcido',
      'Duocolor',
      'Tricolor',
    ])
  })
})

describe('FilamentsInventoryPage — filtro de Nº de rolos disponíveis (mín/máx no cabeçalho)', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    mockSpools([])
    mockMovements()
    mockSpoolCounts()
    mockTypes([
      typeFixture({ filament_type_id: '1', commercial_color: 'A', usable_spool_count: 0 }),
      typeFixture({ filament_type_id: '2', commercial_color: 'B', usable_spool_count: 2 }),
      typeFixture({ filament_type_id: '3', commercial_color: 'C', usable_spool_count: 3 }),
      typeFixture({ filament_type_id: '4', commercial_color: 'D', usable_spool_count: 5 }),
    ])
  })

  async function setRange(user: ReturnType<typeof userEvent.setup>, min: string, max: string) {
    await user.click(
      screen.getByRole('button', { name: 'Filtrar por número de rolos disponíveis' }),
    )
    const minInput = await screen.findByLabelText('Mínimo')
    const maxInput = screen.getByLabelText('Máximo')
    await user.clear(minInput)
    if (min) await user.type(minInput, min)
    await user.clear(maxInput)
    if (max) await user.type(maxInput, max)
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))
  }

  it('somente mínimo (inclusivo)', async () => {
    renderPage()
    const user = userEvent.setup()
    await setRange(user, '2', '')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/B', 'PLA/Sólido/C', 'PLA/Sólido/D'])
  })

  it('somente máximo (inclusivo)', async () => {
    renderPage()
    const user = userEvent.setup()
    await setRange(user, '', '3')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/A', 'PLA/Sólido/B', 'PLA/Sólido/C'])
  })

  it('intervalo [2, 5]', async () => {
    renderPage()
    const user = userEvent.setup()
    await setRange(user, '2', '5')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/B', 'PLA/Sólido/C', 'PLA/Sólido/D'])
  })

  it('mínimo 0 e máximo 0 = grupos sem rolo disponível', async () => {
    renderPage()
    const user = userEvent.setup()
    await setRange(user, '0', '0')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/A'])
  })

  it('mínimo > máximo: avisa e não aplica a faixa', async () => {
    renderPage()
    const user = userEvent.setup()
    await setRange(user, '5', '2')
    expect(screen.getByText('O mínimo não pode ser maior que o máximo.')).toBeInTheDocument()
    expect(getVisibleGroupLabels()).toHaveLength(4)
  })

  it('limpa o filtro de faixa', async () => {
    renderPage()
    const user = userEvent.setup()
    await setRange(user, '3', '')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/C', 'PLA/Sólido/D'])
    // o menu continua aberto depois de "Aplicar" — "Limpar" está logo ali.
    await user.click(screen.getByRole('button', { name: 'Limpar' }))
    expect(getVisibleGroupLabels()).toHaveLength(4)
  })

  it('a faixa usa a contagem CONSOLIDADA e combina com os demais filtros', async () => {
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        material: 'PLA',
        commercial_color: 'X',
        usable_spool_count: 1,
      }),
      typeFixture({
        filament_type_id: 'b',
        material: 'PLA',
        commercial_color: 'X',
        usable_spool_count: 2,
      }),
      typeFixture({
        filament_type_id: 'c',
        material: 'PETG',
        commercial_color: 'Y',
        usable_spool_count: 4,
      }),
    ])
    renderPage()
    const user = userEvent.setup()
    // grupo PLA/Sólida/X consolida 1+2 = 3 rolos
    await setRange(user, '3', '3')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/X'])
  })
})

describe('FilamentsInventoryPage — ações da linha e painel "Ver rolos"', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    mockSpools([])
    mockMovements()
    mockSpoolCounts()
  })

  it('a linha consolidada só tem "Ver rolos" — nunca Editar/Excluir sobre um filament_type_id arbitrário', () => {
    mockTypes([
      typeFixture({ filament_type_id: 'a', manufacturer: 'A' }),
      typeFixture({ filament_type_id: 'b', manufacturer: 'B' }),
    ])
    renderPage()
    const row = getGroupRow('PLA', 'Sólido', 'Preto')
    const buttons = within(row)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(buttons).toEqual(['Ver rolos'])
  })

  it('o botão da linha continua "Ver rolos", mas a janela aberta tem como título a identificação do grupo (Material - Linha - Cor)', async () => {
    mockTypes([typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D' })])
    renderPage()
    const user = userEvent.setup()

    const row = getGroupRow('PLA', 'Sólido', 'Preto')
    // O botão que abre a janela não muda: rótulo visível "Ver rolos".
    const trigger = within(row).getByRole('button', { name: /^ver rolos/i })
    expect(trigger).toHaveTextContent('Ver rolos')

    const dialog = await openDrawer(user, row)
    // A janela é localizada pelo nome acessível = título dinâmico do grupo.
    expect(dialog).toBe(screen.getByRole('dialog', { name: 'PLA - Sólido - Preto' }))
    // O título fixo "Ver rolos" não se repete dentro da janela.
    expect(within(dialog).queryByText('Ver rolos')).not.toBeInTheDocument()
    // Bloco "Grupo" e resumo "Fabricantes:" foram removidos.
    expect(within(dialog).queryByText('Grupo')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/Fabricantes:/)).not.toBeInTheDocument()
    // A identificação não aparece duplicada como subtítulo (formato antigo
    // com separador "·").
    expect(within(dialog).queryByText('PLA · Sólida · Preto')).not.toBeInTheDocument()
    // A seção passou a se chamar "Rolos em estoque".
    expect(within(dialog).getByText('Rolos em estoque')).toBeInTheDocument()
    expect(within(dialog).queryByText('Tipos e fabricantes')).not.toBeInTheDocument()
    // Os cards de resumo continuam.
    for (const label of [
      'Disponível',
      'Rolos disponíveis',
      'Abertos',
      'Esgotados',
      'Estoque mínimo',
      'Situação',
    ]) {
      expect(within(dialog).getByText(label)).toBeInTheDocument()
    }
    // Ações do tipo agora são botões visíveis no rodapé (não mais um menu de
    // três pontos), e "Mostrar arquivados" continua ativo.
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    expect(within(typeActions).getByRole('button', { name: 'Novo rolo' })).toBeInTheDocument()
    expect(within(typeActions).getByRole('button', { name: 'Editar tipo' })).toBeInTheDocument()
    expect(within(typeActions).getByRole('button', { name: 'Desativar tipo' })).toBeInTheDocument()
    expect(within(typeActions).getByRole('button', { name: 'Excluir tipo' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Ações do tipo Voolt3D/i })).toBeNull()
    expect(within(dialog).getByRole('switch', { name: 'Mostrar arquivados' })).toBeInTheDocument()
  })

  it('"Ver rolos" abre TODOS os tipos/fabricantes do grupo, com a marca correta em cada rolo', async () => {
    mockTypes([
      typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D' }),
      typeFixture({ filament_type_id: 'b', manufacturer: 'National3D' }),
    ])
    mockSpools([
      spoolFixture({ id: 's1', code: 'RL-26-001', filament_type_id: 'a' }),
      spoolFixture({ id: 's2', code: 'RL-26-002', filament_type_id: 'b' }),
    ])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    // O resumo "Fabricantes: ..." foi removido do topo da janela; a
    // identificação do grupo agora é só o título. A coluna "Fabricante /
    // tipo" também foi removida da tabela (simplificação 2026-09-05) — o
    // fabricante de cada rolo continua visível pela coluna "Marca".
    expect(within(dialog).queryByText(/Fabricantes:/)).not.toBeInTheDocument()
    const table = getSpoolsTable(dialog)
    const rl1 = within(table).getByText('RL-26-001').closest('tr') as HTMLElement
    const rl2 = within(table).getByText('RL-26-002').closest('tr') as HTMLElement
    expect(within(rl1).getByText('Voolt3D')).toBeInTheDocument()
    expect(within(rl2).getByText('National3D')).toBeInTheDocument()
  })

  it('o rodapé traz um conjunto de botões por tipo/fabricante do grupo — cada botão age no tipo individual', async () => {
    const update = vi.fn().mockResolvedValue(typeFixture({ is_active: false }))
    mockTypes(
      [
        typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D' }),
        typeFixture({ filament_type_id: 'b', manufacturer: 'National3D' }),
      ],
      { update },
    )
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    // Nenhum menu de três pontos de tipo — os botões são visíveis, um grupo
    // por tipo, identificado pelo fabricante/cor.
    const nationalActions = within(dialog).getByRole('group', {
      name: /Ações do tipo National3D — Preto/i,
    })
    await user.click(within(nationalActions).getByRole('button', { name: 'Desativar tipo' }))
    await user.click(await screen.findByRole('button', { name: /^desativar$/i }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('b', { is_active: false }))
  })

  it('não há mais a antiga linha de tipo acima da tabela nem o menu de três pontos de tipo', async () => {
    mockTypes([
      typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D' }),
      typeFixture({ filament_type_id: 'b', manufacturer: 'National3D' }),
    ])
    mockSpools([spoolFixture({ id: 's1', code: 'RL-26-001', filament_type_id: 'a' })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    // O bloco data-testid="filament-type-row-*" foi removido.
    expect(within(dialog).queryByTestId('filament-type-row-a')).toBeNull()
    expect(within(dialog).queryByTestId('filament-type-row-b')).toBeNull()
    // Nenhum trigger de menu de três pontos de TIPO (o do rolo físico
    // continua e é testado à parte).
    expect(within(dialog).queryByRole('button', { name: /^Ações do tipo/i })).toBeNull()
    expect(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-001',
      }),
    ).toBeInTheDocument()
  })

  it('a listagem física vem logo abaixo de "Rolos em estoque" e antes do filtro e dos botões inferiores (desktop e mobile)', async () => {
    mockTypes([typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D' })])
    mockSpools([spoolFixture({ id: 's1', code: 'RL-26-001', filament_type_id: 'a' })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const heading = within(dialog).getByText('Rolos em estoque')
    const table = getSpoolsTable(dialog)
    // Card mobile do mesmo rolo (fora da <table>).
    const mobileCard = within(dialog).getByText(/^Marca:/i)
    const archivedSwitch = within(dialog).getByRole('switch', { name: 'Mostrar arquivados' })
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    const closeButton = within(dialog).getByRole('button', { name: 'Fechar' })

    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
    // título -> tabela -> card mobile -> filtro -> botões de tipo -> Fechar
    expect(heading.compareDocumentPosition(table) & FOLLOWING).toBeTruthy()
    expect(table.compareDocumentPosition(mobileCard) & FOLLOWING).toBeTruthy()
    expect(mobileCard.compareDocumentPosition(archivedSwitch) & FOLLOWING).toBeTruthy()
    expect(archivedSwitch.compareDocumentPosition(typeActions) & FOLLOWING).toBeTruthy()
    expect(typeActions.compareDocumentPosition(closeButton) & FOLLOWING).toBeTruthy()
  })

  it('grupo com mais de um tipo histórico: cada conjunto de botões age só no seu filament_type_id', async () => {
    const deleteType = vi
      .fn()
      .mockResolvedValue({ success: true, result: 'ARCHIVED', archived_spool_count: 1 })
    mockTypes(
      [
        typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D' }),
        typeFixture({ filament_type_id: 'b', manufacturer: 'National3D' }),
      ],
      { delete: deleteType },
    )
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const voolt = within(dialog).getByRole('group', { name: /Ações do tipo Voolt3D — Preto/i })
    const national = within(dialog).getByRole('group', {
      name: /Ações do tipo National3D — Preto/i,
    })
    // Cada conjunto é rotulado com o seu fabricante.
    expect(within(voolt).getByText('Voolt3D')).toBeInTheDocument()
    expect(within(national).getByText('National3D')).toBeInTheDocument()

    // typeFixture tem total_spool_count > 0 -> plano ARCHIVED -> variante
    // "Remover do estoque", e o DELETE leva expected_result 'ARCHIVED'.
    await user.click(within(national).getByRole('button', { name: 'Excluir tipo' }))
    await user.click(await screen.findByRole('button', { name: /^remover do estoque$/i }))

    await waitFor(() => expect(deleteType).toHaveBeenCalledWith('b', 'ARCHIVED'))
    expect(deleteType).toHaveBeenCalledTimes(1)
  })

  it('estado vazio: mensagem abaixo de "Rolos em estoque" e "Novo rolo" ainda cadastra o primeiro rolo', async () => {
    const create = vi.fn().mockResolvedValue(spoolFixture())
    mockTypes([typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D' })])
    mockSpools([], { create })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    expect(within(dialog).getByText('Nenhum rolo cadastrado para este grupo.')).toBeInTheDocument()

    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Novo rolo' }))
    await user.type(screen.getByLabelText(/peso nominal/i), '1000')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({ filament_type_id: 'a' })
  })

  it('editar um tipo movendo-o para outro Material/Linha/Cor: quando era o único tipo, o grupo some e o painel fecha', async () => {
    let currentTypes: FilamentTypeSummary[] = [
      typeFixture({ filament_type_id: 'a', commercial_color: 'Preto' }),
    ]
    const update = vi.fn().mockImplementation(async () => {
      currentTypes = [typeFixture({ filament_type_id: 'a', commercial_color: 'Azul' })]
      useFilamentTypesMock.mockReturnValue({
        types: currentTypes,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        create: vi.fn(),
        update,
        getRemovalPlan: vi.fn(),
        delete: vi.fn(),
      })
      return currentTypes[0]
    })
    useFilamentTypesMock.mockReturnValue({
      types: currentTypes,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      create: vi.fn(),
      update,
      getRemovalPlan: vi.fn(),
      delete: vi.fn(),
    })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Editar tipo' }))
    await user.clear(screen.getByLabelText('Cor'))
    await user.type(screen.getByLabelText('Cor'), 'Azul')
    await user.click(screen.getByRole('button', { name: /salvar altera/i }))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'PLA - Sólido - Preto' }),
      ).not.toBeInTheDocument(),
    )
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/Azul'])
  })

  it('remoção bloqueada por pedido ativo: o plano já vem BLOCKED_ACTIVE_ORDER — a mensagem de bloqueio aparece e não há botão destrutivo', async () => {
    const deleteType = vi.fn()
    const getRemovalPlan = vi.fn().mockResolvedValue({
      success: true,
      planned_result: 'BLOCKED_ACTIVE_ORDER',
      spool_count: 1,
      active_spool_count: 1,
      active_order_numbers: ['FS-26-010'],
      has_movements: true,
      has_purchases: false,
      has_product_filaments: false,
      has_product_plate_filaments: false,
      has_order_selection: true,
    })
    mockTypes([typeFixture()], { delete: deleteType, getRemovalPlan })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Excluir tipo' }))

    const confirm = await screen.findByRole('dialog', { name: 'Não é possível remover o tipo' })
    expect(
      within(confirm).getByText(
        /está sendo utilizado por pedido\(s\) ativo\(s\) e não pode ser removido\. Pedido\(s\): FS-26-010\./i,
      ),
    ).toBeInTheDocument()
    // Sem ação destrutiva: nem "Remover do estoque" nem "Excluir definitivamente".
    expect(
      within(confirm).queryByRole('button', { name: /^remover do estoque$/i }),
    ).not.toBeInTheDocument()
    expect(
      within(confirm).queryByRole('button', { name: /^excluir definitivamente$/i }),
    ).not.toBeInTheDocument()
    expect(within(confirm).getByRole('button', { name: 'Fechar' })).toBeInTheDocument()
    expect(deleteType).not.toHaveBeenCalled()
  })

  it('plano muda entre a conferência e a execução (REMOVAL_PLAN_CHANGED): mantém o diálogo, recarrega o plano e pede nova confirmação', async () => {
    const { ApiError } = await import('@/lib/api/errors')
    // 1ª consulta do plano: PHYSICALLY_DELETED. 2ª (após o erro): ARCHIVED.
    const getRemovalPlan = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        planned_result: 'PHYSICALLY_DELETED',
        spool_count: 0,
        active_spool_count: 0,
        active_order_numbers: [],
        has_movements: false,
        has_purchases: false,
        has_product_filaments: false,
        has_product_plate_filaments: false,
        has_order_selection: false,
      })
      .mockResolvedValue({
        success: true,
        planned_result: 'ARCHIVED',
        spool_count: 1,
        active_spool_count: 1,
        active_order_numbers: [],
        has_movements: false,
        has_purchases: true,
        has_product_filaments: false,
        has_product_plate_filaments: false,
        has_order_selection: false,
      })
    const deleteType = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'business_rule',
          409,
          'O plano de remoção mudou desde a conferência (agora: ARCHIVED). Recarregue as informações e confirme novamente.',
        ),
      )
    mockTypes([typeFixture({ filament_type_id: 'a', total_spool_count: 0 })], {
      delete: deleteType,
      getRemovalPlan,
    })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Excluir tipo' }))
    // Confirma a variante "permanente" que o 1º plano indicou.
    await user.click(await screen.findByRole('button', { name: /^excluir definitivamente$/i }))

    // O backend recusou por mudança de plano — nada foi removido, o diálogo
    // continua aberto, recarrega o plano (agora ARCHIVED) e pede nova
    // confirmação.
    expect(
      await screen.findByText(/As condições deste tipo mudaram desde a conferência/i),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /^remover do estoque$/i })).toBeInTheDocument()
    expect(getRemovalPlan).toHaveBeenCalledTimes(2)
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('o resumo consolidado do painel vem do backend (soma de vw_filament_type_summary), nunca recalculado dos rolos visíveis', async () => {
    mockTypes([typeFixture({ total_available_grams: 1300, minimum_stock_grams: 300 })])
    mockSpools([
      spoolFixture({ id: 's1', current_net_weight_grams: 400 }),
      spoolFixture({ id: 's2', current_net_weight_grams: 400 }),
    ])
    renderPage()
    const user = userEvent.setup()
    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    expect(within(dialog).getByText('1.300g')).toBeInTheDocument()
    expect(within(dialog).queryByText('800g')).not.toBeInTheDocument()
  })
})

describe('FilamentsInventoryPage — regressões do gerenciamento de rolos (preservadas)', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    refetchCountsMock.mockReset()
    mockMovements()
    mockSpoolCounts()
  })

  it('"Ajustar peso" registra o ajuste (diferença calculada), atualiza o saldo local e aciona o refetch do resumo', async () => {
    const setLocalSpoolState = vi.fn()
    const typesRefetch = vi.fn()
    const register = vi.fn().mockResolvedValue({
      id: 'm1',
      filament_type_id: 't1',
      spool_id: 's1',
      movement_type: 'POSITIVE_ADJUSTMENT',
      quantity_delta: 100,
      balance_before: 500,
      balance_after: 600,
      reason: 'Ajuste de peso líquido (janela Ver rolos)',
      reference_type: null,
      reference_id: null,
      idempotency_key: null,
      occurred_at: '2026-08-27T12:00:00Z',
      created_by: 'u1',
      created_at: '2026-08-27T12:00:00Z',
    })
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture()], { setLocalSpoolState })
    mockMovements({ register })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', { name: 'Ajustar peso do rolo RL-26-001' }),
    )
    const adjustDialog = await screen.findByRole('dialog', { name: 'Ajustar peso' })
    // Peso líquido atual é só leitura; o campo pede o NOVO PESO ABSOLUTO.
    expect(within(adjustDialog).getByText('500g')).toBeInTheDocument()
    await user.type(within(adjustDialog).getByLabelText('Novo peso líquido (g)'), '600')
    await user.click(within(adjustDialog).getByRole('button', { name: 'Salvar ajuste' }))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    // A diferença (600 - 500 = +100) é calculada aqui e gravada pela MESMA
    // rota de ajuste já existente — nunca um UPDATE direto do peso.
    expect(register.mock.calls[0][0]).toMatchObject({
      movement_type: 'POSITIVE_ADJUSTMENT',
      quantity: 100,
    })
    expect(setLocalSpoolState).toHaveBeenCalledWith('s1', {
      current_net_weight_grams: 600,
      status: undefined,
    })
    expect(typesRefetch).toHaveBeenCalledTimes(1)
    expect(toastMock.success).toHaveBeenCalledWith('Peso ajustado.')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Ajustar peso' })).not.toBeInTheDocument(),
    )
  })

  it('"Ajustar peso": campo obrigatório, não aceita negativo, mas aceita zero; impede envio duplicado', async () => {
    let resolveRegister: (value: unknown) => void = () => {}
    const register = vi.fn<(input: unknown) => Promise<unknown>>(
      () =>
        new Promise((resolve) => {
          resolveRegister = resolve
        }),
    )
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    mockMovements({ register })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', { name: 'Ajustar peso do rolo RL-26-001' }),
    )
    const adjustDialog = await screen.findByRole('dialog', { name: 'Ajustar peso' })
    const saveButton = within(adjustDialog).getByRole('button', { name: 'Salvar ajuste' })

    // Campo obrigatório.
    await user.click(saveButton)
    expect(await within(adjustDialog).findByText(/informe o novo peso líquido/i)).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()

    // Não aceita negativo.
    await user.type(within(adjustDialog).getByLabelText('Novo peso líquido (g)'), '-10')
    await user.click(saveButton)
    expect(
      await within(adjustDialog).findByText(/deve ser maior ou igual a 0/i),
    ).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()

    // Zero é um valor válido (zera o rolo).
    await user.clear(within(adjustDialog).getByLabelText('Novo peso líquido (g)'))
    await user.type(within(adjustDialog).getByLabelText('Novo peso líquido (g)'), '0')
    await user.click(saveButton)
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(register.mock.calls[0][0]).toMatchObject({ movement_type: 'NEGATIVE_ADJUSTMENT', quantity: 500 })

    // Enquanto a chamada não resolve, o botão vira "Salvando..." (desabilitado)
    // e um novo clique não dispara um segundo envio.
    const busyButton = within(adjustDialog).getByRole('button', { name: 'Salvando...' })
    expect(busyButton).toBeDisabled()
    await user.click(busyButton)
    expect(register).toHaveBeenCalledTimes(1)

    resolveRegister({ balance_after: 0 })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Ajustar peso' })).not.toBeInTheDocument(),
    )
  })

  it('"Ajustar peso" não vaza entre rolos diferentes: reabrir com outro rolo começa com o campo vazio', async () => {
    mockTypes([typeFixture()])
    mockSpools([
      spoolFixture({ id: 's1', code: 'RL-26-001', current_net_weight_grams: 500 }),
      spoolFixture({ id: 's2', code: 'RL-26-002', current_net_weight_grams: 300 }),
    ])
    mockMovements()
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const table = getSpoolsTable(dialog)

    await user.click(within(table).getByRole('button', { name: 'Ajustar peso do rolo RL-26-001' }))
    let adjustDialog = await screen.findByRole('dialog', { name: 'Ajustar peso' })
    await user.type(within(adjustDialog).getByLabelText('Novo peso líquido (g)'), '700')
    await user.click(within(adjustDialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Ajustar peso' })).not.toBeInTheDocument(),
    )

    await user.click(within(table).getByRole('button', { name: 'Ajustar peso do rolo RL-26-002' }))
    adjustDialog = await screen.findByRole('dialog', { name: 'Ajustar peso' })
    expect(within(adjustDialog).getByText('RL-26-002')).toBeInTheDocument()
    expect(within(adjustDialog).getByText('300g')).toBeInTheDocument()
    expect(within(adjustDialog).getByLabelText('Novo peso líquido (g)')).toHaveValue('')
  })

  it('rolo descartado: status e "Ajustar peso" ficam bloqueados; "Abrir rolo" não aparece; histórico continua acessível', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ status: 'DESCARTADO' })])
    mockMovements()
    renderPage()
    const user = userEvent.setup()
    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const row = within(getSpoolsTable(dialog)).getByText('RL-26-001').closest('tr') as HTMLElement

    expect(
      within(row).getByRole('button', { name: 'Status do rolo RL-26-001: Descartado' }),
    ).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Ajustar peso do rolo RL-26-001' })).toBeDisabled()

    await user.click(within(row).getByRole('button', { name: 'Mais ações para o rolo RL-26-001' }))
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Editar', 'Excluir rolo', 'Histórico'])

    await user.click(screen.getByRole('menuitem', { name: 'Histórico' }))
    expect(await screen.findByRole('dialog', { name: 'Histórico do rolo' })).toBeInTheDocument()
  })

  it('rolo SEM histórico: "Excluir rolo" faz exclusão física definitiva e a confirmação informa que é permanente', async () => {
    const typesRefetch = vi.fn()
    const deleteSpool = vi.fn().mockResolvedValue(undefined)
    const update = vi.fn()
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture({ has_movement_history: false })], { delete: deleteSpool, update })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-001',
      }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir rolo' }))

    const confirm = await screen.findByRole('dialog', { name: 'Excluir rolo' })
    expect(within(confirm).getByText(/permanente e não poderá ser desfeita/i)).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: /^excluir definitivamente$/i }))

    await waitFor(() => expect(deleteSpool).toHaveBeenCalledWith('s1'))
    expect(update).not.toHaveBeenCalled()
    expect(typesRefetch).toHaveBeenCalled()
  })

  it('rolo COM histórico: "Excluir rolo" NÃO chama DELETE — arquiva o rolo preservando o histórico, sem erro por movimentações', async () => {
    const typesRefetch = vi.fn()
    const update = vi.fn().mockResolvedValue(spoolFixture({ is_active: false }))
    const deleteSpool = vi.fn()
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture({ has_movement_history: true })], { update, delete: deleteSpool })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-001',
      }),
    )
    // Menu segue só com Editar, Excluir rolo e Histórico — sem Arquivar/
    // Desativar/Descartar, e sem "Abrir rolo" (o fixture já está ABERTO).
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Editar', 'Excluir rolo', 'Histórico'])
    await user.click(screen.getByRole('menuitem', { name: 'Excluir rolo' }))

    // Confirmação diferente: fala em remover do estoque ativo, sem a palavra "permanente".
    const confirm = await screen.findByRole('dialog', { name: 'Remover rolo do estoque' })
    expect(
      within(confirm).getByText(
        'Este rolo possui histórico. Ele será removido do estoque ativo, mas suas movimentações serão preservadas.',
      ),
    ).toBeInTheDocument()
    expect(within(confirm).queryByText(/permanente/i)).not.toBeInTheDocument()
    expect(within(confirm).queryByText(/Desative ou descarte o rolo/i)).not.toBeInTheDocument()
    expect(
      within(confirm).queryByText(/possui movimentações registradas e não pode ser excluído/i),
    ).not.toBeInTheDocument()

    await user.click(within(confirm).getByRole('button', { name: 'Remover do estoque' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { is_active: false }))
    expect(deleteSpool).not.toHaveBeenCalled()
    expect(toastMock.success).toHaveBeenCalledWith(
      'Rolo removido do estoque. Histórico preservado.',
    )
    expect(typesRefetch).toHaveBeenCalled()
  })

  it('depois de arquivar um rolo com histórico, ele some da listagem padrão e reaparece com "Mostrar arquivados"', async () => {
    const typesRefetch = vi.fn()
    const deleteSpool = vi.fn()
    const activeSpool = spoolFixture({ id: 's1', code: 'RL-26-001', has_movement_history: true })
    const archivedSpool = spoolFixture({
      id: 's1',
      code: 'RL-26-001',
      is_active: false,
      has_movement_history: true,
    })
    const update = vi.fn().mockImplementation(async () => {
      useFilamentSpoolsMock.mockReturnValue({
        spools: [archivedSpool],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        create: vi.fn(),
        update,
        delete: deleteSpool,
        setLocalSpoolState: vi.fn(),
      })
      return archivedSpool
    })
    mockTypes([typeFixture()], { refetch: typesRefetch })
    useFilamentSpoolsMock.mockReturnValue({
      spools: [activeSpool],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      create: vi.fn(),
      update,
      delete: deleteSpool,
      setLocalSpoolState: vi.fn(),
    })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    expect(within(getSpoolsTable(dialog)).getByText('RL-26-001')).toBeInTheDocument()

    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-001',
      }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir rolo' }))
    await user.click(await screen.findByRole('button', { name: 'Remover do estoque' }))

    // Sumiu da listagem padrão.
    await waitFor(() => expect(within(dialog).queryByText('RL-26-001')).not.toBeInTheDocument())
    // Reaparece, identificado como arquivado, ao marcar "Mostrar arquivados".
    await user.click(within(dialog).getByRole('switch', { name: 'Mostrar arquivados' }))
    const archivedRow = within(getSpoolsTable(dialog))
      .getByText('RL-26-001')
      .closest('tr') as HTMLElement
    expect(within(archivedRow).getByText('Arquivado')).toBeInTheDocument()
    // "Excluir rolo" não repete a remoção num rolo já arquivado.
    await user.click(
      within(archivedRow).getByRole('button', { name: 'Mais ações para o rolo RL-26-001' }),
    )
    expect(await screen.findByRole('menuitem', { name: 'Excluir rolo' })).toHaveAttribute(
      'data-disabled',
    )
  })

  it('mobile: "Excluir rolo" de um rolo com histórico usa a mesma confirmação de arquivamento', async () => {
    const update = vi.fn().mockResolvedValue(spoolFixture({ is_active: false }))
    const deleteSpool = vi.fn()
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ has_movement_history: true })], { update, delete: deleteSpool })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    // Card mobile (fora da <table>): mesmo componente de menu do rolo.
    const mobileCard = within(dialog)
      .getByText('Marca: Voolt3D')
      .closest('[data-slot="card"]') as HTMLElement
    await user.click(
      within(mobileCard).getByRole('button', { name: 'Mais ações para o rolo RL-26-001' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir rolo' }))

    const confirm = await screen.findByRole('dialog', { name: 'Remover rolo do estoque' })
    expect(within(confirm).queryByText(/permanente/i)).not.toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Remover do estoque' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { is_active: false }))
    expect(deleteSpool).not.toHaveBeenCalled()
  })

  it.todo(
    'rolo vinculado a um Pedido bloqueia exclusão física E arquivamento com mensagem de vínculo — pendente do motor Pedidos → Estoque (Módulo 3): não existe hoje nenhuma estrutura que ligue filament_spools a orders (reference_type/reference_id de filament_movements são campos reservados, nunca populados), então não há o que verificar sem inventar mock enganoso',
  )

  it('"Mostrar arquivados" só muda a visibilidade — nunca o resumo consolidado', async () => {
    mockTypes([typeFixture({ total_available_grams: 750, total_spool_count: 2 })])
    mockSpools([
      spoolFixture({ id: 's1', code: 'RL-26-001', is_active: true }),
      spoolFixture({ id: 's2', code: 'RL-26-002', is_active: false, has_movement_history: true }),
    ])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    expect(within(getSpoolsTable(dialog)).queryByText('RL-26-002')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('switch', { name: 'Mostrar arquivados' }))
    expect(within(getSpoolsTable(dialog)).getByText('RL-26-002')).toBeInTheDocument()
    expect(within(dialog).getByText('750g')).toBeInTheDocument()
  })

  it('"Novo rolo" por tipo cria o rolo com o filament_type_id daquele fabricante', async () => {
    const create = vi.fn().mockResolvedValue(spoolFixture())
    mockTypes([
      typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D' }),
      typeFixture({ filament_type_id: 'b', manufacturer: 'National3D' }),
    ])
    mockSpools([], { create })
    renderPage()
    const user = userEvent.setup()

    await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const nationalActions = screen.getByRole('group', { name: /Ações do tipo National3D — Preto/i })
    await user.click(within(nationalActions).getByRole('button', { name: 'Novo rolo' }))
    await user.type(screen.getByLabelText(/peso nominal/i), '1000')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({ filament_type_id: 'b' })
  })

  it('ajustar peso dentro de "Ver rolos" também aciona o refetch da contagem de rolos disponíveis', async () => {
    const register = vi.fn().mockResolvedValue({
      id: 'm1',
      filament_type_id: 't1',
      spool_id: 's1',
      movement_type: 'NEGATIVE_ADJUSTMENT',
      quantity_delta: -100,
      balance_before: 500,
      balance_after: 400,
      reason: 'Ajuste de peso líquido (janela Ver rolos)',
      reference_type: null,
      reference_id: null,
      idempotency_key: null,
      occurred_at: '2026-08-27T12:00:00Z',
      created_by: 'u1',
      created_at: '2026-08-27T12:00:00Z',
    })
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    mockMovements({ register })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', { name: 'Ajustar peso do rolo RL-26-001' }),
    )
    const adjustDialog = await screen.findByRole('dialog', { name: 'Ajustar peso' })
    await user.type(within(adjustDialog).getByLabelText('Novo peso líquido (g)'), '400')
    await user.click(within(adjustDialog).getByRole('button', { name: 'Salvar ajuste' }))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(register.mock.calls[0][0]).toMatchObject({
      movement_type: 'NEGATIVE_ADJUSTMENT',
      quantity: 100,
    })
    expect(refetchCountsMock).toHaveBeenCalled()
  })

  it('coluna "Peso Líquido" mostra só o peso líquido (sem nominal nem %); card mobile idem', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ current_net_weight_grams: 200, nominal_weight_grams: 1000 })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const table = getSpoolsTable(dialog)
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toContain('Peso Líquido')
    expect(headers).not.toContain('Peso')
    const netCell = within(table).getByText('RL-26-001').closest('tr') as HTMLElement
    expect(within(netCell).getByText('200g')).toBeInTheDocument()
    expect(within(netCell).queryByText(/1\.000g/)).not.toBeInTheDocument()
    expect(within(netCell).queryByText(/%/)).not.toBeInTheDocument()
    // Card mobile (fora da tabela).
    expect(within(dialog).getByText('Peso Líquido: 200g')).toBeInTheDocument()
  })

  it('tabela simplificada (2026-09-05): só Identificador, Marca, Peso Líquido, Status e Ações — sem "Fabricante / tipo", coluna própria de peso ou botão "Gerenciar"', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const table = getSpoolsTable(dialog)
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual(['Identificador', 'Marca', 'Peso Líquido', 'Status', 'Ações'])

    const row = within(table).getByText('RL-26-001').closest('tr') as HTMLElement
    // "Ajustar peso" (compacto, só ícone) e o menu de três pontos moram
    // juntos na coluna "Ações" — sem o botão "Gerenciar", removido.
    expect(within(row).getByRole('button', { name: 'Ajustar peso do rolo RL-26-001' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Mais ações para o rolo RL-26-001' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /gerenciar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^gerenciar/i })).not.toBeInTheDocument()
  })

  it('coluna "Marca" aparece na tabela de rolos, com o valor derivado do item da compra multi-item (purchase_item_manufacturer)', async () => {
    mockTypes([typeFixture({ manufacturer: 'National3D' })])
    mockSpools([spoolFixture({ purchase_item_id: 'pi1', purchase_item_manufacturer: 'Bambu Lab' })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const table = getSpoolsTable(dialog)
    const row = within(table).getByText('RL-26-001').closest('tr') as HTMLElement
    // A marca do ITEM da compra ("Bambu Lab") aparece — nunca o fabricante
    // do tipo ("National3D"), mesmo que os dois existam ao mesmo tempo.
    expect(within(row).getByText('Bambu Lab')).toBeInTheDocument()
    expect(within(row).queryByText('National3D')).not.toBeInTheDocument()
  })

  it('rolo antigo (sem purchase_item_id) usa o fabricante histórico do tipo como Marca', async () => {
    mockTypes([typeFixture({ manufacturer: 'National3D' })])
    mockSpools([spoolFixture({ purchase_item_id: null, purchase_item_manufacturer: null })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const table = getSpoolsTable(dialog)
    const row = within(table).getByText('RL-26-001').closest('tr') as HTMLElement
    expect(within(row).getByText('National3D')).toBeInTheDocument()
  })

  it('rolo sem marca real (fabricante do tipo = "Não informado") mostra "—" na coluna Marca', async () => {
    mockTypes([typeFixture({ manufacturer: 'Não informado' })])
    mockSpools([spoolFixture({ purchase_item_id: null, purchase_item_manufacturer: null })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const table = getSpoolsTable(dialog)
    const row = within(table).getByText('RL-26-001').closest('tr') as HTMLElement
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('card mobile também mostra "Marca"', async () => {
    mockTypes([typeFixture({ manufacturer: 'National3D' })])
    mockSpools([spoolFixture({ purchase_item_id: 'pi1', purchase_item_manufacturer: 'Voolt' })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    expect(within(dialog).getByText('Marca: Voolt')).toBeInTheDocument()
  })

  it('"Ajustar peso" abre a janela simplificada do rolo certo, com o peso líquido atual em modo leitura', async () => {
    mockTypes([typeFixture({ filament_type_id: 't1', manufacturer: 'MasterPrint' })])
    mockSpools([spoolFixture({ id: 's1', code: 'RL-26-002', current_net_weight_grams: 750 })])
    mockMovements()
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Ajustar peso do rolo RL-26-002',
      }),
    )

    const adjustDialog = await screen.findByRole('dialog', { name: 'Ajustar peso' })
    expect(within(adjustDialog).getByText('RL-26-002')).toBeInTheDocument()
    expect(within(adjustDialog).getByText('750g')).toBeInTheDocument()
    const newWeightField = within(adjustDialog).getByLabelText('Novo peso líquido (g)')
    expect(newWeightField).toBeInTheDocument()
    expect(newWeightField).not.toHaveAttribute('readonly')
    // Nenhum outro campo (motivo/data/operação) desta antiga janela "Gerenciar".
    expect(within(adjustDialog).queryByRole('radio', { name: 'Ajuste' })).not.toBeInTheDocument()
    expect(within(adjustDialog).queryByLabelText('Motivo/observação')).not.toBeInTheDocument()
  })

  it('menu de três pontos do rolo físico: "Editar", "Excluir rolo" e "Histórico" (sem "Abrir rolo" quando já ABERTO)', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-001',
      }),
    )
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Editar', 'Excluir rolo', 'Histórico'])
  })

  it('menu de três pontos: "Abrir rolo" aparece para um rolo LACRADO, muda o status para Aberto e some do menu depois', async () => {
    const update = vi.fn().mockResolvedValue(spoolFixture({ status: 'ABERTO' }))
    const typesRefetch = vi.fn()
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture({ status: 'LACRADO' })], { update })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-001',
      }),
    )
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Editar', 'Excluir rolo', 'Abrir rolo', 'Histórico'])

    await user.click(screen.getByRole('menuitem', { name: 'Abrir rolo' }))

    // Mesma rota de backend do dropdown de Status (update_filament_spool).
    await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { status: 'ABERTO' }))
    expect(toastMock.success).toHaveBeenCalledWith('Status atualizado.')
    expect(typesRefetch).toHaveBeenCalled()
  })

  it('"Abrir rolo" não aparece para um rolo já ABERTO nem para um rolo DESCARTADO', async () => {
    mockTypes([typeFixture()])
    mockSpools([
      spoolFixture({ id: 's1', code: 'RL-26-001', status: 'ABERTO' }),
      spoolFixture({ id: 's2', code: 'RL-26-002', status: 'DESCARTADO' }),
    ])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const table = getSpoolsTable(dialog)

    await user.click(within(table).getByRole('button', { name: 'Mais ações para o rolo RL-26-001' }))
    expect(screen.queryByRole('menuitem', { name: 'Abrir rolo' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(within(table).getByRole('button', { name: 'Mais ações para o rolo RL-26-002' }))
    expect(screen.queryByRole('menuitem', { name: 'Abrir rolo' })).not.toBeInTheDocument()
  })

  it('"Editar" no menu do rolo continua abrindo a edição do rolo', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-001',
      }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }))
    expect(await screen.findByRole('dialog', { name: 'Editar rolo' })).toBeInTheDocument()
  })

  it('"Excluir rolo": confirmação explícita cita o código e avisa que é permanente; confirma via o handler de exclusão', async () => {
    const deleteSpool = vi.fn().mockResolvedValue(undefined)
    const update = vi.fn()
    const typesRefetch = vi.fn()
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture()], { delete: deleteSpool, update })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-001',
      }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir rolo' }))

    const confirm = await screen.findByRole('dialog', { name: 'Excluir rolo' })
    expect(within(confirm).getByText(/"RL-26-001"/)).toBeInTheDocument()
    expect(within(confirm).getByText(/permanente/i)).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: /^excluir definitivamente$/i }))

    await waitFor(() => expect(deleteSpool).toHaveBeenCalledWith('s1'))
    expect(update).not.toHaveBeenCalled()
    expect(typesRefetch).toHaveBeenCalled()
  })

  it('"Histórico" abre a janela dedicada do rolo certo — nunca a antiga janela "Gerenciar"', async () => {
    mockTypes([typeFixture({ filament_type_id: 't1', manufacturer: 'MasterPrint' })])
    mockSpools([spoolFixture({ id: 's1', code: 'RL-26-002' })])
    mockMovements({
      movements: [
        {
          id: 'm1',
          filament_type_id: 't1',
          spool_id: 's1',
          movement_type: 'POSITIVE_ADJUSTMENT',
          quantity_delta: 100,
          balance_before: 500,
          balance_after: 600,
          reason: 'correção',
          reference_type: null,
          reference_id: null,
          idempotency_key: null,
          occurred_at: '2026-08-27T12:00:00Z',
          created_by: 'u1',
          created_at: '2026-08-27T12:00:00Z',
        },
      ],
    })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-002',
      }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Histórico' }))

    const historyDialog = await screen.findByRole('dialog', { name: 'Histórico do rolo' })
    expect(within(historyDialog).getByText('RL-26-002')).toBeInTheDocument()
    expect(within(historyDialog).getByText('Ajuste positivo')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'MasterPrint - Preto - Sólida' })).not.toBeInTheDocument()
    expect(screen.queryByText('Movimentar / Pesar / Histórico')).not.toBeInTheDocument()
  })

  it('"Histórico": estados de carregando, vazio e erro (reaproveitando FilamentMovementHistory)', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()
    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const table = getSpoolsTable(dialog)

    async function openHistory() {
      await user.click(within(table).getByRole('button', { name: 'Mais ações para o rolo RL-26-001' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Histórico' }))
      return screen.findByRole('dialog', { name: 'Histórico do rolo' })
    }

    // Carregando.
    mockMovements({ isLoading: true })
    let historyDialog = await openHistory()
    expect(within(historyDialog).getByText('Carregando histórico...')).toBeInTheDocument()
    await user.click(within(historyDialog).getByRole('button', { name: 'Fechar' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Histórico do rolo' })).not.toBeInTheDocument(),
    )

    // Vazio.
    mockMovements({ movements: [] })
    historyDialog = await openHistory()
    expect(within(historyDialog).getByText('Nenhuma movimentação registrada.')).toBeInTheDocument()
    await user.click(within(historyDialog).getByRole('button', { name: 'Fechar' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Histórico do rolo' })).not.toBeInTheDocument(),
    )

    // Erro.
    const { ApiError } = await import('@/lib/api/errors')
    mockMovements({ loadError: new ApiError('database', 500, 'Falha ao carregar histórico.') })
    historyDialog = await openHistory()
    expect(within(historyDialog).getByText('Falha ao carregar histórico.')).toBeInTheDocument()
  })

  it('dropdown de Status: mostra Lacrado/Aberto/Descartado, identifica a opção atual e não faz nada ao clicar nela de novo', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ status: 'LACRADO' })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const trigger = within(getSpoolsTable(dialog)).getByRole('button', {
      name: 'Status do rolo RL-26-001: Lacrado',
    })
    await user.click(trigger)
    const options = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(options).toEqual(['Lacrado', 'Aberto', 'Descartado'])
    // A opção atual (Lacrado) vem desabilitada — clicar nela não dispara nada.
    expect(screen.getByRole('menuitem', { name: 'Lacrado' })).toHaveAttribute('data-disabled')
    await user.click(screen.getByRole('menuitem', { name: 'Lacrado' }))
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('dropdown de Status: selecionar "Aberto" chama update_filament_spool (mesma rota de Editar) e atualiza a tabela sem F5', async () => {
    const typesRefetch = vi.fn()
    const update = vi.fn().mockResolvedValue(spoolFixture({ status: 'ABERTO' }))
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture({ status: 'LACRADO' })], { update })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', { name: 'Status do rolo RL-26-001: Lacrado' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Aberto' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { status: 'ABERTO' }))
    expect(toastMock.success).toHaveBeenCalledWith('Status atualizado.')
    expect(typesRefetch).toHaveBeenCalled()
  })

  it('dropdown de Status: mudar para "Descartado" pede confirmação antes de gravar; cancelar não chama o backend', async () => {
    const update = vi.fn().mockResolvedValue(spoolFixture({ status: 'DESCARTADO' }))
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ status: 'ABERTO' })], { update })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', { name: 'Status do rolo RL-26-001: Aberto' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Descartado' }))

    const confirm = await screen.findByRole('dialog', { name: 'Descartar rolo' })
    expect(within(confirm).getByText(/"RL-26-001"/)).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }))
    expect(update).not.toHaveBeenCalled()

    // Confirmando desta vez, o backend é chamado normalmente.
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', { name: 'Status do rolo RL-26-001: Aberto' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Descartado' }))
    await user.click(await screen.findByRole('button', { name: 'Descartar rolo' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { status: 'DESCARTADO' }))
  })
})

describe('FilamentsInventoryPage — contagem de rolos DISPONÍVEIS (regra: saldo > 0, nunca usable_spool_count)', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    refetchCountsMock.mockReset()
    mockSpools([])
    mockMovements()
  })

  it('a coluna mostra a contagem correta, NÃO usable_spool_count da view, quando os dois divergem', () => {
    // A view diria 5 rolos "utilizáveis"; a contagem real de rolos com
    // saldo > 0 é 2.
    mockTypes([typeFixture({ filament_type_id: 't1', usable_spool_count: 5 })])
    mockSpoolCounts({ countByTypeId: new Map([['t1', 2]]) })
    renderPage()
    expect(within(getGroupRow('PLA', 'Sólido', 'Preto')).getAllByRole('cell')[4].textContent).toBe(
      '2',
    )
  })

  it('dois fabricantes consolidados: soma das contagens corretas, sem duplicação', () => {
    mockTypes([
      typeFixture({ filament_type_id: 'a', manufacturer: 'A', usable_spool_count: 9 }),
      typeFixture({ filament_type_id: 'b', manufacturer: 'B', usable_spool_count: 9 }),
    ])
    mockSpoolCounts({
      countByTypeId: new Map([
        ['a', 1],
        ['b', 2],
      ]),
    })
    renderPage()
    expect(within(getGroupRow('PLA', 'Sólido', 'Preto')).getAllByRole('cell')[4].textContent).toBe(
      '3',
    )
  })

  it('grupo cujos rolos estão todos zerados (tipo ausente do mapa) conta 0 e o filtro 0–0 o encontra', async () => {
    mockTypes([
      typeFixture({ filament_type_id: 'a', commercial_color: 'Zerado', usable_spool_count: 4 }),
      typeFixture({ filament_type_id: 'b', commercial_color: 'Cheio', usable_spool_count: 4 }),
    ])
    mockSpoolCounts({ countByTypeId: new Map([['b', 3]]) })
    renderPage()
    const user = userEvent.setup()

    expect(within(getGroupRow('PLA', 'Sólido', 'Zerado')).getAllByRole('cell')[4].textContent).toBe(
      '0',
    )

    await user.click(
      screen.getByRole('button', { name: 'Filtrar por número de rolos disponíveis' }),
    )
    await user.clear(await screen.findByLabelText('Mínimo'))
    await user.type(screen.getByLabelText('Mínimo'), '0')
    await user.clear(screen.getByLabelText('Máximo'))
    await user.type(screen.getByLabelText('Máximo'), '0')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/Zerado'])
  })

  it('o filtro mínimo/máximo usa a contagem correta, não a da view', async () => {
    mockTypes([
      typeFixture({ filament_type_id: 'a', commercial_color: 'A', usable_spool_count: 9 }),
      typeFixture({ filament_type_id: 'b', commercial_color: 'B', usable_spool_count: 9 }),
      typeFixture({ filament_type_id: 'c', commercial_color: 'C', usable_spool_count: 9 }),
    ])
    mockSpoolCounts({
      countByTypeId: new Map([
        ['a', 1],
        ['b', 3],
        ['c', 5],
      ]),
    })
    renderPage()
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', { name: 'Filtrar por número de rolos disponíveis' }),
    )
    await user.type(await screen.findByLabelText('Mínimo'), '3')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/B', 'PLA/Sólido/C'])
  })

  it('listagem e drawer exibem a MESMA quantidade', async () => {
    mockTypes([typeFixture({ filament_type_id: 't1', usable_spool_count: 7 })])
    mockSpools([spoolFixture()])
    mockSpoolCounts({ countByTypeId: new Map([['t1', 2]]) })
    renderPage()
    const user = userEvent.setup()

    const row = getGroupRow('PLA', 'Sólido', 'Preto')
    expect(within(row).getAllByRole('cell')[4].textContent).toBe('2')
    const dialog = await openDrawer(user, row)
    const rolosField = within(dialog).getByText('Rolos disponíveis').parentElement as HTMLElement
    expect(within(rolosField).getByText('2')).toBeInTheDocument()
  })

  it('erro ao carregar a contagem: coluna e drawer mostram "—", filtro de faixa desabilitado, aviso com "Tentar novamente" — nunca cai em usable_spool_count', async () => {
    const { ApiError } = await import('@/lib/api/errors')
    mockTypes([typeFixture({ filament_type_id: 't1', usable_spool_count: 9 })])
    mockSpools([spoolFixture()])
    mockSpoolCounts({ error: new ApiError('database', 500, 'falhou') })
    renderPage()
    const user = userEvent.setup()

    expect(within(getGroupRow('PLA', 'Sólido', 'Preto')).getAllByRole('cell')[4].textContent).toBe(
      '—',
    )
    expect(screen.queryByText('9')).not.toBeInTheDocument()

    const banner = screen
      .getByText(/número de rolos disponíveis/i)
      .closest('[role="alert"]') as HTMLElement
    await user.click(within(banner).getByRole('button', { name: /tentar novamente/i }))
    expect(refetchCountsMock).toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'Filtrar por número de rolos disponíveis' }),
    )
    expect(await screen.findByText(/indisponível/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Mínimo')).not.toBeInTheDocument()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const rolosField = within(dialog).getByText('Rolos disponíveis').parentElement as HTMLElement
    expect(within(rolosField).getByText('—')).toBeInTheDocument()
  })

  it('enquanto a contagem carrega, a tabela espera (skeleton), sem mostrar número da view', () => {
    mockTypes([typeFixture({ usable_spool_count: 9 })])
    mockSpoolCounts({ isLoading: true, countByTypeId: null })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('FilamentsInventoryPage — Compras e ausência do código da cor', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    mockSpools([])
    mockMovements()
    mockSpoolCounts()
  })

  it('o botão "Compras" aparece na área Filamentos', async () => {
    mockTypes([typeFixture()])
    renderPage()
    expect(screen.getByRole('button', { name: /compras/i })).toBeInTheDocument()
  })

  it('o botão da listagem chama-se "Cadastrar novo tipo" e abre a janela "Novo tipo de filamento"', async () => {
    mockTypes([])
    renderPage()
    const user = userEvent.setup()
    expect(screen.queryByRole('button', { name: 'Novo tipo de filamento' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    expect(screen.getByRole('dialog', { name: 'Novo tipo de filamento' })).toBeInTheDocument()
  })

  it('"Novo tipo de filamento" nunca exibe um campo "Código da cor"', async () => {
    mockTypes([])
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    expect(screen.queryByLabelText(/código da cor/i)).not.toBeInTheDocument()
  })

  it('"Novo tipo de filamento" não exibe o campo Fabricante/Fornecedor nem o erro "Informe o fabricante"', async () => {
    const create = vi.fn().mockResolvedValue(typeFixture())
    mockTypes([], { create })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    expect(screen.queryByLabelText(/fabricante/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/fornecedor/i)).not.toBeInTheDocument()

    // Salvar só com Material + Linha + Cor: nada de erro de fabricante.
    await user.click(screen.getByRole('radio', { name: 'PLA' }))
    await user.click(screen.getByRole('radio', { name: 'Sólida' }))
    await user.type(screen.getByLabelText('Cor'), 'Preto')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(screen.queryByText(/informe o fabricante/i)).not.toBeInTheDocument()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  })

  it('Linha não aceita texto livre: só os action buttons oficiais aparecem, incluindo Matte', async () => {
    mockTypes([])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    const lineGroup = screen.getByRole('radiogroup', { name: 'Linha' })
    // Sem campo de texto livre para Linha (só o de Cor, que não muda).
    expect(within(lineGroup).queryByRole('textbox')).not.toBeInTheDocument()
    for (const option of [
      'Sólida',
      'Silk',
      'Matte',
      'Velvet',
      'Translúcido',
      'DuoColor',
      'Tricolor',
    ]) {
      expect(within(lineGroup).getByRole('radio', { name: option })).toBeInTheDocument()
    }
  })

  it('apenas uma opção de Linha fica selecionada por vez', async () => {
    mockTypes([])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    const lineGroup = screen.getByRole('radiogroup', { name: 'Linha' })
    await user.click(within(lineGroup).getByRole('radio', { name: 'Silk' }))
    expect(within(lineGroup).getByRole('radio', { name: 'Silk' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(lineGroup).getByRole('radio', { name: 'Sólida' })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    await user.click(within(lineGroup).getByRole('radio', { name: 'Matte' }))
    expect(within(lineGroup).getByRole('radio', { name: 'Matte' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(lineGroup).getByRole('radio', { name: 'Silk' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('a criação envia manufacturer: "Não informado" e Linha (Matte) corretamente', async () => {
    const create = vi.fn().mockResolvedValue(typeFixture())
    mockTypes([], { create })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    await user.click(screen.getByRole('radio', { name: 'PETG' }))
    await user.click(screen.getByRole('radio', { name: 'Matte' }))
    await user.type(screen.getByLabelText('Cor'), 'Vermelho')
    await user.type(screen.getByLabelText(/peso mínimo de alerta/i), '300')
    await user.type(screen.getByLabelText(/observações/i), 'lote de teste')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      material: 'PETG',
      manufacturer: 'Não informado',
      line: 'Matte',
      commercial_color: 'Vermelho',
      minimum_stock_grams: 300,
      notes: 'lote de teste',
    })
  })

  it('Linha é obrigatória: salvar sem escolher uma opção mostra o erro e não chama create', async () => {
    const create = vi.fn()
    mockTypes([], { create })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    await user.click(screen.getByRole('radio', { name: 'PLA' }))
    await user.type(screen.getByLabelText('Cor'), 'Preto')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(screen.getByText('Selecione a linha.')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('"Editar tipo de filamento" continua com o campo Fabricante para tipos históricos', async () => {
    mockTypes([typeFixture({ filament_type_id: 't1', manufacturer: 'National3D' })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo National3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Editar tipo' }))

    expect(screen.getByLabelText('Fabricante')).toHaveValue('National3D')
  })

  it('valor histórico de Linha (fora das opções oficiais) aparece selecionado na edição e é preservado ao salvar sem tocá-lo', async () => {
    const update = vi.fn().mockResolvedValue(typeFixture())
    mockTypes(
      [
        typeFixture({
          filament_type_id: 't1',
          manufacturer: 'National3D',
          line: 'Metálica Antiga',
        }),
      ],
      { update },
    )
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(
      user,
      getGroupRow('PLA', 'Metálica Antiga', 'Preto'),
      'PLA - Metálica Antiga - Preto',
    )
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo National3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Editar tipo' }))

    const lineGroup = screen.getByRole('radiogroup', { name: 'Linha' })
    // O valor histórico aparece como mais uma opção, já selecionada — as
    // oficiais continuam todas presentes, nenhuma foi substituída.
    expect(within(lineGroup).getByRole('radio', { name: 'Metálica Antiga' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    for (const option of [
      'Sólida',
      'Silk',
      'Matte',
      'Velvet',
      'Translúcido',
      'DuoColor',
      'Tricolor',
    ]) {
      expect(within(lineGroup).getByRole('radio', { name: option })).toHaveAttribute(
        'aria-checked',
        'false',
      )
    }

    // Salvar sem tocar em Linha preserva o valor histórico (nunca apagado
    // ou convertido em silêncio).
    await user.click(screen.getByRole('button', { name: /salvar altera/i }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][1]).toMatchObject({ line: 'Metálica Antiga' })
  })

  it('valor histórico de Linha pode ser substituído por uma opção oficial', async () => {
    const update = vi.fn().mockResolvedValue(typeFixture())
    mockTypes(
      [
        typeFixture({
          filament_type_id: 't1',
          manufacturer: 'National3D',
          line: 'Metálica Antiga',
        }),
      ],
      { update },
    )
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(
      user,
      getGroupRow('PLA', 'Metálica Antiga', 'Preto'),
      'PLA - Metálica Antiga - Preto',
    )
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo National3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Editar tipo' }))

    const lineGroup = screen.getByRole('radiogroup', { name: 'Linha' })
    await user.click(within(lineGroup).getByRole('radio', { name: 'Matte' }))
    await user.click(screen.getByRole('button', { name: /salvar altera/i }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][1]).toMatchObject({ line: 'Matte' })
  })

  it('Tricolor aparece entre as opções de Linha e pode ser selecionada e enviada', async () => {
    const create = vi.fn().mockResolvedValue(typeFixture())
    mockTypes([], { create })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    const lineGroup = screen.getByRole('radiogroup', { name: 'Linha' })
    expect(within(lineGroup).getByRole('radio', { name: 'Tricolor' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'PLA' }))
    await user.click(within(lineGroup).getByRole('radio', { name: 'Tricolor' }))
    expect(within(lineGroup).getByRole('radio', { name: 'Tricolor' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.type(screen.getByLabelText('Cor'), 'Vermelho')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    // Enviada e preservada com exatamente essa grafia.
    expect(create.mock.calls[0][0]).toMatchObject({ line: 'Tricolor' })
  })

  it('Cor sugere valores já cadastrados nos tipos já carregados', async () => {
    mockTypes([
      typeFixture({ filament_type_id: 't1', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 't2', commercial_color: 'Dourado' }),
    ])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    await user.type(screen.getByLabelText('Cor'), 'do')

    expect(await screen.findByRole('option', { name: 'Dourado' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Preto' })).not.toBeInTheDocument()
  })

  it('sugestões de Cor eliminam duplicações por diferença de maiúsculas/minúsculas e espaços', async () => {
    mockTypes([
      typeFixture({ filament_type_id: 't1', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 't2', commercial_color: 'preto' }),
      typeFixture({ filament_type_id: 't3', commercial_color: ' Preto ' }),
    ])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    await user.type(screen.getByLabelText('Cor'), 'pre')

    expect(await screen.findAllByRole('option', { name: 'Preto' })).toHaveLength(1)
  })

  it('busca de sugestão de Cor ignora maiúsculas/minúsculas e acentos', async () => {
    mockTypes([typeFixture({ filament_type_id: 't1', commercial_color: 'Verde Água' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    await user.type(screen.getByLabelText('Cor'), 'AGUA')

    expect(await screen.findByRole('option', { name: 'Verde Água' })).toBeInTheDocument()
  })

  it('continua permitindo cadastrar uma cor nova, mesmo sem nenhuma sugestão compatível', async () => {
    const create = vi.fn().mockResolvedValue(typeFixture())
    mockTypes([typeFixture({ filament_type_id: 't1', commercial_color: 'Preto' })], { create })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    await user.click(screen.getByRole('radio', { name: 'PLA' }))
    await user.click(screen.getByRole('radio', { name: 'Sólida' }))
    await user.type(screen.getByLabelText('Cor'), 'Roxo Fluorescente')
    expect(screen.queryByRole('option', { name: 'Roxo Fluorescente' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({ commercial_color: 'Roxo Fluorescente' })
  })

  it('selecionar uma sugestão de Cor preenche o campo com o valor cadastrado', async () => {
    mockTypes([typeFixture({ filament_type_id: 't1', commercial_color: 'Dourado' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cadastrar novo tipo' }))
    await user.type(screen.getByLabelText('Cor'), 'dou')
    await user.click(await screen.findByRole('option', { name: 'Dourado' }))

    expect(screen.getByLabelText('Cor')).toHaveValue('Dourado')
  })
})

describe('FilamentsInventoryPage — colunas redimensionáveis e persistidas', () => {
  afterEach(() => {
    window.localStorage.clear()
  })
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    mockSpools([])
    mockMovements()
    mockSpoolCounts()
    mockTypes([typeFixture()])
  })

  it('8 colunas viram 8 <col> no colgroup; nenhuma é "manufacturer"/"is_active"', () => {
    renderPage()
    expect(document.querySelectorAll('col')).toHaveLength(8)
  })

  it('todos os 8 cabeçalhos têm alça de redimensionamento (inclusive "Rolos disponíveis", que carrega o filtro de faixa)', () => {
    renderPage()
    for (const label of [
      'Material',
      'Linha',
      'Cor',
      'Disponível',
      'Rolos disponíveis',
      'Estoque mínimo',
      'Situação',
      'Ações',
    ]) {
      expect(
        screen.getByRole('separator', { name: `Redimensionar coluna ${label}` }),
      ).toBeInTheDocument()
    }
  })

  it('redimensionar uma coluna por teclado altera só aquela coluna', () => {
    renderPage()
    const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Material' })
    const otherBefore = (document.querySelectorAll('col')[1] as HTMLElement).style.width
    handle.focus()
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect((document.querySelectorAll('col')[1] as HTMLElement).style.width).toBe(otherBefore)
  })

  it('largura salva é restaurada após remontar; "Restaurar larguras" volta ao padrão', () => {
    const { unmount } = renderPage()
    const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Material' })
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 150, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 150, pointerId: 1 })
    const widened = (document.querySelectorAll('col')[0] as HTMLElement).style.width
    unmount()

    renderPage()
    expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe(widened)
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar larguras' }))
    expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('110px')
  })

  it('uma largura persistida da antiga coluna "manufacturer" não invalida as demais (é simplesmente ignorada)', () => {
    // Simula preferência antiga (com manufacturer/is_active) no formato do
    // usePersistentColumnWidths — as chaves removidas somem, as demais ficam.
    window.localStorage.setItem(
      'forma-sky:table-column-widths:v1:op-user:inventory-filaments',
      JSON.stringify({ material: 175, manufacturer: 999, is_active: 999, line: 165 }),
    )
    useAuthMock.mockReturnValue({
      session: { user: { id: 'op-user', email: 'op@formasky.com' } },
      signOut: vi.fn(),
    })
    render(<FilamentsInventoryPage />, { wrapper: MemoryRouter })
    const cols = document.querySelectorAll('col')
    expect(cols).toHaveLength(8)
    expect((cols[0] as HTMLElement).style.width).toBe('175px')
    expect((cols[1] as HTMLElement).style.width).toBe('165px')
  })

  it('a tabela continua num contêiner overflow-x-auto', () => {
    renderPage()
    expect(screen.getByRole('table').closest('.overflow-x-auto')).toBeInTheDocument()
  })
})

describe('FilamentsInventoryPage — remoção segura de tipo de filamento', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    refetchCountsMock.mockReset()
    mockSpools([])
    mockMovements()
    mockSpoolCounts()
  })

  it('tipo SEM rolos: confirmação de exclusão PERMANENTE (botão "Excluir definitivamente"), sem "Desative o tipo"', async () => {
    const deleteType = vi
      .fn()
      .mockResolvedValue({ success: true, result: 'PHYSICALLY_DELETED', archived_spool_count: 0 })
    mockTypes(
      [typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D', total_spool_count: 0 })],
      {
        delete: deleteType,
      },
    )
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Excluir tipo' }))

    // O plano (PHYSICALLY_DELETED — sem rolos e sem nenhuma referência) vem
    // do backend, não da presença de rolos.
    const confirm = await screen.findByRole('dialog', { name: 'Excluir tipo de filamento' })
    expect(within(confirm).getByText(/permanente e não poderá ser desfeita/i)).toBeInTheDocument()
    expect(within(confirm).queryByText(/Desative o tipo/i)).not.toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: /^excluir definitivamente$/i }))

    await waitFor(() => expect(deleteType).toHaveBeenCalledWith('a', 'PHYSICALLY_DELETED'))
    expect(toastMock.success).toHaveBeenCalledWith('Tipo de filamento excluído.')
  })

  it('tipo SEM rolos mas COM compra: o plano do backend é ARCHIVED — confirmação de arquivamento, nunca "permanente"', async () => {
    const deleteType = vi
      .fn()
      .mockResolvedValue({ success: true, result: 'ARCHIVED', archived_spool_count: 0 })
    // Sem rolos (total_spool_count 0), mas o backend enxerga uma compra ->
    // plano ARCHIVED. A interface NÃO pode mostrar "exclusão permanente".
    const getRemovalPlan = vi.fn().mockResolvedValue({
      success: true,
      planned_result: 'ARCHIVED',
      spool_count: 0,
      active_spool_count: 0,
      active_order_numbers: [],
      has_movements: false,
      has_purchases: true,
      has_product_filaments: false,
      has_product_plate_filaments: false,
      has_order_selection: false,
    })
    mockTypes(
      [typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D', total_spool_count: 0 })],
      { delete: deleteType, getRemovalPlan },
    )
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Excluir tipo' }))

    const confirm = await screen.findByRole('dialog', { name: 'Remover tipo do estoque' })
    expect(within(confirm).queryByText(/permanente/i)).not.toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: /^remover do estoque$/i }))

    await waitFor(() => expect(deleteType).toHaveBeenCalledWith('a', 'ARCHIVED'))
    expect(toastMock.success).toHaveBeenCalledWith(
      'Tipo removido do estoque. Histórico preservado.',
    )
  })

  it('tipo COM rolos: confirmação de ARQUIVAMENTO ("Remover tipo do estoque"), fala em preservar histórico, sem "permanente", botão "Remover do estoque"', async () => {
    const refetch = vi.fn()
    const deleteType = vi
      .fn()
      .mockResolvedValue({ success: true, result: 'ARCHIVED', archived_spool_count: 2 })
    mockTypes(
      [typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D', total_spool_count: 2 })],
      { delete: deleteType, refetch },
    )
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Excluir tipo' }))

    const confirm = await screen.findByRole('dialog', { name: 'Remover tipo do estoque' })
    expect(
      within(confirm).getByText(
        /retirados do estoque ativo\. Históricos, movimentações, compras e vínculos de pedidos finalizados são preservados/i,
      ),
    ).toBeInTheDocument()
    expect(within(confirm).queryByText(/permanente/i)).not.toBeInTheDocument()
    expect(within(confirm).queryByText(/Desative o tipo/i)).not.toBeInTheDocument()

    await user.click(within(confirm).getByRole('button', { name: /^remover do estoque$/i }))

    await waitFor(() => expect(deleteType).toHaveBeenCalledWith('a', 'ARCHIVED'))
    expect(toastMock.success).toHaveBeenCalledWith(
      'Tipo removido do estoque. Histórico preservado.',
    )
    // Recarrega tipos + contagem para refletir tipo/rolos arquivados no backend.
    expect(refetch).toHaveBeenCalled()
    expect(refetchCountsMock).toHaveBeenCalled()
  })

  it('após ARCHIVED, a listagem se atualiza — o grupo só-arquivado some da listagem padrão', async () => {
    const activeTypes = [
      typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D', total_spool_count: 1 }),
    ]
    const archivedTypes = [
      typeFixture({
        filament_type_id: 'a',
        manufacturer: 'Voolt3D',
        is_active: false,
        total_spool_count: 1,
      }),
    ]
    const getRemovalPlan = vi.fn().mockResolvedValue({
      success: true,
      planned_result: 'ARCHIVED',
      spool_count: 1,
      active_spool_count: 1,
      active_order_numbers: [],
      has_movements: false,
      has_purchases: false,
      has_product_filaments: false,
      has_product_plate_filaments: false,
      has_order_selection: false,
    })
    const deleteType = vi.fn().mockImplementation(async () => {
      useFilamentTypesMock.mockReturnValue({
        types: archivedTypes,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        getRemovalPlan,
        delete: deleteType,
      })
      return { success: true, result: 'ARCHIVED', archived_spool_count: 1 }
    })
    useFilamentTypesMock.mockReturnValue({
      types: activeTypes,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      getRemovalPlan,
      delete: deleteType,
    })
    renderPage()
    const user = userEvent.setup()

    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólido/Preto'])
    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Excluir tipo' }))
    await user.click(await screen.findByRole('button', { name: /^remover do estoque$/i }))

    // O grupo só-arquivado some da listagem operacional padrão.
    await waitFor(() =>
      expect(
        screen.getByText('Nenhum resultado para a busca e os filtros atuais.'),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // 2026-09-05: o controle "Mostrar tipos arquivados" foi removido da tela.
  // Um grupo totalmente arquivado (nenhum tipo ativo) fica oculto SEMPRE —
  // não há mais nenhuma forma de revelá-lo nesta tela. O registro em si
  // (filament_types) continua intacto no banco (nenhum UPDATE/DELETE por
  // esta mudança); só deixou de ter um caminho de exibição/"Ver rolos"
  // aqui.
  it('tipo (grupo) totalmente arquivado fica permanentemente oculto — nenhum controle nesta tela o revela', () => {
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        manufacturer: 'Voolt3D',
        commercial_color: 'Preto',
        is_active: false,
        total_spool_count: 1,
        usable_spool_count: 0,
        total_available_grams: 0,
      }),
    ])
    renderPage()

    expect(
      screen.getByText('Nenhum resultado para a busca e os filtros atuais.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Mostrar tipos arquivados' })).not.toBeInTheDocument()
  })

  it('"Excluir tipo" fica desabilitado num tipo já arquivado dentro de um grupo com outro tipo ainda ativo — não repete a remoção', async () => {
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        manufacturer: 'Voolt3D',
        commercial_color: 'Preto',
        is_active: true,
      }),
      typeFixture({
        filament_type_id: 'b',
        manufacturer: 'National3D',
        commercial_color: 'Preto',
        is_active: false,
        total_spool_count: 1,
      }),
    ])
    renderPage()
    const user = userEvent.setup()

    // O grupo continua visível (tem um tipo ATIVO) — sem precisar de nenhum
    // toggle. Dentro dele, o tipo arquivado (National3D) tem "Excluir tipo"
    // desabilitado; o tipo ativo (Voolt3D) continua normal.
    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const nationalActions = within(dialog).getByRole('group', {
      name: /Ações do tipo National3D — Preto/i,
    })
    expect(within(nationalActions).getByRole('button', { name: 'Excluir tipo' })).toBeDisabled()
    const voolt3dActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    expect(within(voolt3dActions).getByRole('button', { name: 'Excluir tipo' })).not.toBeDisabled()
  })

  it('o controle "Mostrar tipos arquivados" foi removido; "Mostrar arquivados" dos ROLOS continua preservado dentro de "Ver rolos" (conceito diferente)', async () => {
    mockTypes([typeFixture()])
    mockSpools([])
    renderPage()
    const user = userEvent.setup()

    expect(screen.queryByRole('switch', { name: 'Mostrar tipos arquivados' })).not.toBeInTheDocument()
    expect(screen.queryByText(/mostrar tipos arquivados/i)).not.toBeInTheDocument()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    expect(within(dialog).getByRole('switch', { name: 'Mostrar arquivados' })).toBeInTheDocument()
  })
})

// =============================================================================
// Atualização automática sem F5 (2026-09-04) — "corrija a atualização
// automática do fluxo de Filamentos". PurchaseDialog (via InventoryPageShell)
// NUNCA é mockado nestes testes — é o mesmo componente real usado pela
// aplicação, renderizado lado a lado com "Ver rolos" (diálogos aninhados,
// suportados pelo primitivo de Dialog do projeto) para provar a sincronização
// real entre os dois, sem depender de nenhum cache/query client central (o
// projeto não usa nenhum).
// =============================================================================
// Texto-fonte dos arquivos tocados por esta correção (2026-09-04) — usado só
// pelo teste "10. não usa window.location.reload" abaixo, via import.meta.glob
// (Vite/vitest, sem nenhuma dependência de módulos Node fora do escopo deste
// projeto de frontend). Precisa de caminhos ESTÁTICOS (literais), nunca uma
// variável — é o próprio Vite quem resolve isto em tempo de build/transform.
const sourceFilesTouchedByThisFix = import.meta.glob(
  [
    './FilamentsInventoryPage.tsx',
    '../components/inventory/FilamentTypeDrawer.tsx',
    '../components/inventory/PurchaseDialog.tsx',
    '../hooks/useFilamentTypes.ts',
    '../hooks/useFilamentSpools.ts',
    '../hooks/useFilamentSpoolCounts.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

describe('FilamentsInventoryPage — atualização automática sem F5', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    registerFilamentPurchaseMock.mockReset()
    mockMovements()
    mockSpoolCounts()
  })

  // Preenche e envia uma compra de Filamento pela janela REAL de Compras,
  // já aberta e com a categoria "Filamento" selecionada — mesmos passos que
  // um usuário faria, usados só neste describe (o fluxo completo da janela
  // já tem cobertura própria e exaustiva em PurchaseDialog.test.tsx).
  async function submitRealFilamentPurchase(
    user: ReturnType<typeof userEvent.setup>,
    typeOptionName: string,
  ) {
    await user.click(screen.getByRole('button', { name: 'Compras' }))
    const purchaseDialog = screen.getByRole('dialog', { name: 'Registrar compra' })
    await user.click(within(purchaseDialog).getByRole('radio', { name: 'Filamento' }))

    const filamentDialog = screen.getByRole('dialog', { name: 'Compra de filamentos' })
    await user.click(within(filamentDialog).getByRole('radio', { name: 'Mercado Livre' }))
    const itemRow = within(filamentDialog).getByRole('group', { name: 'Item 1' })
    await user.type(within(itemRow).getByRole('combobox', { name: 'Tipo — item 1' }), 'PLA')
    await user.click(await within(itemRow).findByRole('option', { name: typeOptionName }))
    await user.click(within(itemRow).getByRole('radio', { name: '1.000 g' }))
    await user.type(within(itemRow).getByLabelText('Quantidade'), '1')
    await user.type(within(itemRow).getByLabelText('Marca'), 'Bambu Lab')
    await user.type(within(itemRow).getByLabelText('Valor total'), '9500')

    await user.click(within(filamentDialog).getByRole('button', { name: /^registrar compra$/i }))
  }

  it('5./6. registrar uma compra e reabrir "Ver rolos" mostra o número de rolos e a Marca atualizados — nunca exige F5', async () => {
    // "Compras" e "Ver rolos" são diálogos de nível de página, não
    // aninhados entre si — abrir um torna o outro inacessível (mesmo
    // comportamento do primitivo de Dialog para diálogos independentes), ou
    // seja, uma compra NUNCA acontece com "Ver rolos" já aberto. O fluxo
    // real é: abrir "Ver rolos", FECHAR (o componente desmonta por
    // completo), registrar a compra por "Compras", e reabrir "Ver rolos" —
    // a reabertura remonta useFilamentSpools do zero e busca os rolos de
    // novo sozinha (nenhum código novo desta correção entra em jogo aqui;
    // é o comportamento de sempre do componente condicional). O `refetch`
    // mockado do PRIMEIRO useFilamentSpools nunca precisa ser chamado — é
    // uma instância nova, criada do zero na reabertura, que já nasce
    // buscando os dados atuais.
    mockTypes([typeFixture({ filament_type_id: 't1' })])
    const firstOpenSpools = [spoolFixture({ purchase_item_manufacturer: null })]
    const reopenedSpools = [
      spoolFixture({ purchase_item_manufacturer: null }),
      spoolFixture({
        id: 's2',
        code: 'RL-26-002',
        purchase_item_id: 'pi-new',
        purchase_item_manufacturer: 'Bambu Lab',
      }),
    ]
    useFilamentSpoolsMock
      .mockReturnValueOnce({
        spools: firstOpenSpools,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        setLocalSpoolState: vi.fn(),
      })
      .mockReturnValue({
        spools: reopenedSpools,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        setLocalSpoolState: vi.fn(),
      })
    registerFilamentPurchaseMock.mockResolvedValue({
      purchase_id: 'p1',
      occurred_at: '2026-09-04',
      notes: null,
      purchase_channel: 'MERCADO_LIVRE',
      freight_value: 0,
      subtotal_value: 95,
      total_value: 95,
      created_at: '2026-09-04T00:00:00Z',
      items: [],
    })
    renderPage()
    const user = userEvent.setup()

    const firstDrawer = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    expect(within(getSpoolsTable(firstDrawer)).queryByText('RL-26-002')).not.toBeInTheDocument()
    await user.click(within(firstDrawer).getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog', { name: 'PLA - Sólido - Preto' })).not.toBeInTheDocument()

    await submitRealFilamentPurchase(user, 'PLA - Sólida - Preto')
    await waitFor(() => expect(registerFilamentPurchaseMock).toHaveBeenCalledTimes(1))
    // handleFilamentSubmit fecha "Compra de filamentos" (e "Registrar
    // compra") sozinho ao suceder — confirma antes de reabrir "Ver rolos".
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Compra de filamentos' })).not.toBeInTheDocument(),
    )

    const reopenedDrawer = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    const table = getSpoolsTable(reopenedDrawer)
    expect(within(table).getByText('RL-26-002')).toBeInTheDocument()
    const newRow = within(table).getByText('RL-26-002').closest('tr') as HTMLElement
    expect(within(newRow).getByText('Bambu Lab')).toBeInTheDocument()
  })

  it('7. arquivar um tipo pelos botões da própria janela "Ver rolos" também refaz a busca de rolos do drawer (os rolos do tipo foram arquivados junto)', async () => {
    const spoolsRefetchMock = vi.fn()
    mockSpools([spoolFixture()], { refetch: spoolsRefetchMock })
    const deleteType = vi
      .fn()
      .mockResolvedValue({ success: true, result: 'ARCHIVED', archived_spool_count: 1 })
    mockTypes([typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D', total_spool_count: 1 })], {
      delete: deleteType,
    })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    expect(spoolsRefetchMock).not.toHaveBeenCalled()

    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Excluir tipo' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remover tipo do estoque' })
    await user.click(within(confirm).getByRole('button', { name: /^remover do estoque$/i }))

    await waitFor(() => expect(deleteType).toHaveBeenCalledWith('a', 'ARCHIVED'))
    await waitFor(() => expect(spoolsRefetchMock).toHaveBeenCalledTimes(1))
  })

  it('9. ações de DENTRO da janela "Ver rolos" (ex.: editar um rolo) nunca disparam uma segunda busca redundante de rolos — só a atualização local já existente', async () => {
    const spoolsRefetchMock = vi.fn()
    const update = vi.fn().mockResolvedValue(spoolFixture({ status: 'ABERTO' }))
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()], { refetch: spoolsRefetchMock, update })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólido', 'Preto'))
    // Escopo pela tabela desktop — em JSDOM as classes responsivas
    // (hidden/sm:block) não escondem o card mobile, então buscar o texto
    // direto no diálogo casaria com os dois (tabela e card) ao mesmo tempo.
    const table = getSpoolsTable(dialog)
    const row = within(table).getByText('RL-26-001').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Mais ações para o rolo RL-26-001' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }))
    await user.click(await screen.findByRole('button', { name: /^salvar altera/i }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    // A tabela já reflete a edição via atualização local (update() do
    // hook) — nenhuma busca extra de rolos foi necessária nem disparada.
    expect(spoolsRefetchMock).not.toHaveBeenCalled()
  })

  it('10. não usa window.location.reload nem qualquer navegação forçada para atualizar a tela', () => {
    // import.meta.glob (Vite, tipado por vite/client — sem depender de
    // módulos Node fora do escopo deste projeto de frontend) carrega o
    // TEXTO-FONTE dos arquivos tocados por esta correção.
    const contents = Object.values(sourceFilesTouchedByThisFix)
    expect(contents.length).toBe(6)
    for (const content of contents) {
      expect(content).not.toMatch(/location\.reload/)
      expect(content).not.toMatch(/window\.location\.href\s*=/)
    }
  })
})
