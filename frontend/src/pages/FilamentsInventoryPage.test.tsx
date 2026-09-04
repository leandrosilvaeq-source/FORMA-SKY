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
} = vi.hoisted(() => ({
  useFilamentTypesMock: vi.fn(),
  useFilamentSpoolsMock: vi.fn(),
  useFilamentSpoolCountsMock: vi.fn(),
  useFilamentMovementsMock: vi.fn(),
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useFilamentTypes', () => ({ useFilamentTypes: useFilamentTypesMock }))
vi.mock('@/hooks/useFilamentSpools', () => ({ useFilamentSpools: useFilamentSpoolsMock }))
vi.mock('@/hooks/useFilamentSpoolCounts', () => ({
  useFilamentSpoolCounts: useFilamentSpoolCountsMock,
}))
vi.mock('@/hooks/useFilamentMovements', () => ({ useFilamentMovements: useFilamentMovementsMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('sonner', () => ({ toast: toastMock }))

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
// identificação dinâmica do grupo (Material - Linha - Cor), então o diálogo
// é localizado por esse nome (default = fixture PLA/Sólida/Preto).
async function openDrawer(
  user: ReturnType<typeof userEvent.setup>,
  groupRow: HTMLElement,
  dialogName: string | RegExp = 'PLA - Sólida - Preto',
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
      'PLA/Matte/Preto',
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
    const cells = within(getGroupRow('PLA', 'Sólida', 'Preto')).getAllByRole('cell')
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
      within(getGroupRow('PLA', 'Sólida', 'Preto')).getByText('Estoque baixo'),
    ).toBeInTheDocument()
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
      'PETG/Matte/Azul',
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
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/Preto'])

    await user.clear(screen.getByLabelText('Buscar tipos de filamento'))
    await user.type(screen.getByLabelText('Buscar tipos de filamento'), 'azul')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/Azul'])
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
        line: 'Basic',
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
        line: 'Basic',
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

  // Abre o menu de um filtro (se ainda não estiver aberto) e marca N opções
  // sem re-clicar o gatilho (o Popover não-modal continua aberto entre os
  // cliques).
  async function selectFilterOptions(
    user: ReturnType<typeof userEvent.setup>,
    button: RegExp,
    options: string[],
  ) {
    await user.click(screen.getByRole('button', { name: button }))
    for (const option of options) {
      await user.click(await screen.findByRole('checkbox', { name: option }))
    }
    // Fecha o menu clicando fora (no título da tabela), para o próximo
    // filtro poder abrir sem colisão de popovers.
    await user.click(screen.getByRole('heading', { level: 1 }))
  }

  it('filtra por Material (OR dentro do grupo)', async () => {
    renderPage()
    const user = userEvent.setup()
    await selectFilterOptions(user, /^Material/, ['PLA', 'PETG'])
    expect(getVisibleGroupLabels().every((l) => l.startsWith('PLA') || l.startsWith('PETG'))).toBe(
      true,
    )
    expect(getVisibleGroupLabels().some((l) => l.startsWith('TPU'))).toBe(false)
    expect(screen.getByRole('button', { name: 'Material (2)' })).toBeInTheDocument()
  })

  it('filtra por Linha e por Cor', async () => {
    renderPage()
    const user = userEvent.setup()
    await selectFilterOptions(user, /^Linha/, ['Basic'])
    expect(getVisibleGroupLabels()).toEqual(['PETG/Basic/Preto', 'PLA/Basic/Preto'])
    await selectFilterOptions(user, /^Cor/, ['Preto'])
    expect(getVisibleGroupLabels()).toEqual(['PETG/Basic/Preto', 'PLA/Basic/Preto'])
  })

  it('AND entre grupos: (Material PLA OU PETG) E (Linha Basic) E (Cor Preto)', async () => {
    renderPage()
    const user = userEvent.setup()
    await selectFilterOptions(user, /^Material/, ['PLA', 'PETG'])
    await selectFilterOptions(user, /^Linha/, ['Basic'])
    await selectFilterOptions(user, /^Cor/, ['Preto'])
    expect(getVisibleGroupLabels()).toEqual(['PETG/Basic/Preto', 'PLA/Basic/Preto'])
  })

  it('combina com a busca', async () => {
    renderPage()
    const user = userEvent.setup()
    await selectFilterOptions(user, /^Cor/, ['Preto'])
    await user.type(screen.getByLabelText('Buscar tipos de filamento'), 'petg')
    expect(getVisibleGroupLabels()).toEqual(['PETG/Basic/Preto'])
  })

  it('limpa um filtro individualmente e limpa todos', async () => {
    renderPage()
    const user = userEvent.setup()
    await selectFilterOptions(user, /^Material/, ['PLA'])
    await selectFilterOptions(user, /^Linha/, ['Basic'])
    expect(screen.getByRole('button', { name: /^Limpar filtros \(2\)/ })).toBeInTheDocument()

    // limpar só Material (dentro do próprio menu)
    await user.click(screen.getByRole('button', { name: 'Material (1)' }))
    await user.click(await screen.findByRole('button', { name: 'Limpar' }))
    await user.click(screen.getByRole('heading', { level: 1 }))
    expect(screen.getByRole('button', { name: 'Material' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Linha (1)' })).toBeInTheDocument()

    // limpar todos
    await user.click(screen.getByRole('button', { name: /^Limpar filtros/ }))
    expect(screen.queryByRole('button', { name: /^Limpar filtros/ })).not.toBeInTheDocument()
    expect(getVisibleGroupLabels()).toHaveLength(4)
  })

  it('as opções de filtro não têm duplicatas por maiúsculas/acentos/espaços', async () => {
    mockTypes([
      typeFixture({ filament_type_id: 'a', line: 'Basic', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 'b', line: ' basic ', commercial_color: 'PRETO' }),
      typeFixture({ filament_type_id: 'c', line: 'Matte', commercial_color: 'Vermelhão' }),
    ])
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Linha/ }))
    const lineOptions = await screen.findAllByRole('checkbox')
    expect(lineOptions).toHaveLength(2)
    expect(screen.getByRole('checkbox', { name: 'Basic' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Matte' })).toBeInTheDocument()
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
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/B', 'PLA/Sólida/C', 'PLA/Sólida/D'])
  })

  it('somente máximo (inclusivo)', async () => {
    renderPage()
    const user = userEvent.setup()
    await setRange(user, '', '3')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/A', 'PLA/Sólida/B', 'PLA/Sólida/C'])
  })

  it('intervalo [2, 5]', async () => {
    renderPage()
    const user = userEvent.setup()
    await setRange(user, '2', '5')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/B', 'PLA/Sólida/C', 'PLA/Sólida/D'])
  })

  it('mínimo 0 e máximo 0 = grupos sem rolo disponível', async () => {
    renderPage()
    const user = userEvent.setup()
    await setRange(user, '0', '0')
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/A'])
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
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/C', 'PLA/Sólida/D'])
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
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/X'])
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
    const row = getGroupRow('PLA', 'Sólida', 'Preto')
    const buttons = within(row)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(buttons).toEqual(['Ver rolos'])
  })

  it('o botão da linha continua "Ver rolos", mas a janela aberta tem como título a identificação do grupo (Material - Linha - Cor)', async () => {
    mockTypes([typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D' })])
    renderPage()
    const user = userEvent.setup()

    const row = getGroupRow('PLA', 'Sólida', 'Preto')
    // O botão que abre a janela não muda: rótulo visível "Ver rolos".
    const trigger = within(row).getByRole('button', { name: /^ver rolos/i })
    expect(trigger).toHaveTextContent('Ver rolos')

    const dialog = await openDrawer(user, row)
    // A janela é localizada pelo nome acessível = título dinâmico do grupo.
    expect(dialog).toBe(screen.getByRole('dialog', { name: 'PLA - Sólida - Preto' }))
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

  it('"Ver rolos" abre TODOS os tipos/fabricantes do grupo, com o fabricante visível em cada rolo', async () => {
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    // O resumo "Fabricantes: ..." foi removido do topo da janela; a
    // identificação do grupo agora é só o título. O fabricante continua
    // visível por rolo na tabela abaixo.
    expect(within(dialog).queryByText(/Fabricantes:/)).not.toBeInTheDocument()
    const table = getSpoolsTable(dialog)
    const rl1 = within(table).getByText('RL-26-001').closest('tr') as HTMLElement
    const rl2 = within(table).getByText('RL-26-002').closest('tr') as HTMLElement
    expect(within(rl1).getByText('Voolt3D · Sólida · Preto')).toBeInTheDocument()
    expect(within(rl2).getByText('National3D · Sólida · Preto')).toBeInTheDocument()
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    const heading = within(dialog).getByText('Rolos em estoque')
    const table = getSpoolsTable(dialog)
    // Card mobile do mesmo rolo (fora da <table>).
    const mobileCard = within(dialog).getByText(/Fabricante \/ tipo:/i)
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Editar tipo' }))
    await user.clear(screen.getByLabelText('Cor'))
    await user.type(screen.getByLabelText('Cor'), 'Azul')
    await user.click(screen.getByRole('button', { name: /salvar altera/i }))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'PLA - Sólida - Preto' }),
      ).not.toBeInTheDocument(),
    )
    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/Azul'])
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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
    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

  it('registrar movimentação (Ajuste) atualiza o saldo local do rolo e aciona o refetch do resumo', async () => {
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
      reason: 'pesagem real',
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: /movimentar, pesar ou consultar histórico/i,
      }),
    )
    await user.click(screen.getByRole('radio', { name: 'Ajuste' }))
    await user.type(screen.getByLabelText('Novo peso líquido (g)'), '600')
    await user.type(screen.getByLabelText('Motivo/observação'), 'pesagem real')
    await user.click(screen.getByRole('button', { name: 'Confirmar ajuste' }))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(register.mock.calls[0][0]).toMatchObject({
      movement_type: 'POSITIVE_ADJUSTMENT',
      quantity: 100,
    })
    expect(setLocalSpoolState).toHaveBeenCalledWith('s1', {
      current_net_weight_grams: 600,
      status: undefined,
    })
    expect(typesRefetch).toHaveBeenCalledTimes(1)
  })

  it('rolo descartado: só o histórico, sem área de movimentação/pesagem', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ status: 'DESCARTADO' })])
    renderPage()
    const user = userEvent.setup()
    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: /movimentar, pesar ou consultar histórico/i,
      }),
    )
    expect(screen.getByText(/foi descartado e não aceita novas movimentações/i)).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Ação' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Operação' })).not.toBeInTheDocument()
  })

  it('rolo SEM histórico: "Excluir rolo" faz exclusão física definitiva e a confirmação informa que é permanente', async () => {
    const typesRefetch = vi.fn()
    const deleteSpool = vi.fn().mockResolvedValue(undefined)
    const update = vi.fn()
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture({ has_movement_history: false })], { delete: deleteSpool, update })
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-001',
      }),
    )
    // Menu segue só com Editar e Excluir rolo — sem Arquivar/Desativar/Descartar.
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Editar', 'Excluir rolo'])
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    // Card mobile (fora da <table>): mesmo componente de menu do rolo.
    const mobileCard = within(dialog)
      .getByText('Fabricante / tipo: Voolt3D · Sólida · Preto')
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    const nationalActions = screen.getByRole('group', { name: /Ações do tipo National3D — Preto/i })
    await user.click(within(nationalActions).getByRole('button', { name: 'Novo rolo' }))
    await user.type(screen.getByLabelText(/peso nominal/i), '1000')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({ filament_type_id: 'b' })
  })

  it('movimentar/pesar dentro de "Ver rolos" também aciona o refetch da contagem de rolos disponíveis', async () => {
    const register = vi.fn().mockResolvedValue({
      id: 'm1',
      filament_type_id: 't1',
      spool_id: 's1',
      movement_type: 'NEGATIVE_ADJUSTMENT',
      quantity_delta: -100,
      balance_before: 500,
      balance_after: 400,
      reason: 'correção',
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: /movimentar, pesar ou consultar histórico/i,
      }),
    )
    await user.click(screen.getByRole('radio', { name: 'Registrar perda' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '100')
    await user.type(screen.getByLabelText('Motivo/observação'), 'material contaminado')
    await user.click(screen.getByRole('button', { name: 'Registrar perda' }))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(register.mock.calls[0][0]).toMatchObject({ movement_type: 'LOSS', quantity: 100 })
    expect(refetchCountsMock).toHaveBeenCalled()
  })

  it('coluna "Peso Líquido" mostra só o peso líquido (sem nominal nem %); card mobile idem', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ current_net_weight_grams: 200, nominal_weight_grams: 1000 })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

  it('nova coluna "Ajustar peso" fica entre "Status" e "Ações", com botão rotulado pelo código do rolo', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    const table = getSpoolsTable(dialog)
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual([
      'Identificador',
      'Fabricante / tipo',
      'Peso Líquido',
      'Status',
      'Ajustar peso',
      'Ações',
    ])
    const row = within(table).getByText('RL-26-001').closest('tr') as HTMLElement
    const adjustButton = within(row).getByRole('button', { name: 'Ajustar peso do rolo RL-26-001' })
    expect(adjustButton).toHaveTextContent('Ajustar peso')
  })

  it('"Ajustar peso" abre a janela de gerenciamento do rolo certo já com "Ajuste" selecionado', async () => {
    mockTypes([typeFixture({ filament_type_id: 't1', manufacturer: 'MasterPrint' })])
    mockSpools([spoolFixture({ id: 's1', code: 'RL-26-002' })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Ajustar peso do rolo RL-26-002',
      }),
    )

    const manageDialog = await screen.findByRole('dialog', { name: 'MasterPrint - Preto - Sólida' })
    expect(within(manageDialog).getByRole('radio', { name: 'Ajuste' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(manageDialog).getByLabelText('Novo peso líquido (g)')).toBeInTheDocument()
  })

  it('menu de três pontos do rolo físico tem só "Editar" e "Excluir rolo"', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: 'Mais ações para o rolo RL-26-001',
      }),
    )
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Editar', 'Excluir rolo'])
  })

  it('"Editar" no menu do rolo continua abrindo a edição do rolo', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

  it('janela "Gerenciar": cabeçalho é só "Marca - Cor - Tipo" + código (uma vez), sem "Movimentar / Pesar / Histórico"', async () => {
    mockTypes([typeFixture({ filament_type_id: 't1', manufacturer: 'MasterPrint' })])
    mockSpools([spoolFixture({ id: 's1', code: 'RL-26-002' })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: /movimentar, pesar ou consultar histórico/i,
      }),
    )
    const manageDialog = await screen.findByRole('dialog', { name: 'MasterPrint - Preto - Sólida' })
    expect(
      within(manageDialog).queryByText('Movimentar / Pesar / Histórico'),
    ).not.toBeInTheDocument()
    expect(within(manageDialog).getAllByText('RL-26-002')).toHaveLength(1)
  })

  it('janela "Gerenciar": resumo tem só Peso Líquido, Status e Peso Disponível (nesta ordem), sem Peso nominal nem % restante', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ current_net_weight_grams: 320, nominal_weight_grams: 1000 })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: /movimentar, pesar ou consultar histórico/i,
      }),
    )
    const manageDialog = await screen.findByRole('dialog', { name: 'Voolt3D - Preto - Sólida' })
    const labels = within(manageDialog)
      .getAllByText(/^(Peso Líquido|Status|Peso Disponível|Peso nominal|% restante)$/)
      .map((el) => el.textContent)
    expect(labels).toEqual(['Peso Líquido', 'Status', 'Peso Disponível'])
    // Sem reserva implementada: Peso Disponível == Peso Líquido.
    expect(within(manageDialog).getAllByText('320g')).toHaveLength(2)
    expect(within(manageDialog).queryByText(/%/)).not.toBeInTheDocument()
  })

  it('janela "Gerenciar": operações são só "Registrar perda" e "Ajuste"; "Registrar pesagem" preservada', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    await user.click(
      within(getSpoolsTable(dialog)).getByRole('button', {
        name: /movimentar, pesar ou consultar histórico/i,
      }),
    )
    const manageDialog = await screen.findByRole('dialog', { name: 'Voolt3D - Preto - Sólida' })
    // Aba de pesagem preservada.
    expect(
      within(manageDialog).getByRole('radio', { name: 'Registrar pesagem' }),
    ).toBeInTheDocument()
    expect(within(manageDialog).getByText('Histórico')).toBeInTheDocument()
    // Operações de movimentação.
    expect(within(manageDialog).getByRole('radio', { name: 'Registrar perda' })).toBeInTheDocument()
    expect(within(manageDialog).getByRole('radio', { name: 'Ajuste' })).toBeInTheDocument()
    for (const gone of ['Entrada', 'Compra', 'Devolução']) {
      expect(within(manageDialog).queryByRole('radio', { name: gone })).not.toBeInTheDocument()
    }
    expect(
      within(manageDialog).queryByRole('radiogroup', { name: 'Tipo de movimentação' }),
    ).not.toBeInTheDocument()
  })

  it('o atalho "Ajustar peso" não vaza: abrir depois pelo botão "Gerenciar" começa sem operação selecionada', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ id: 's1', code: 'RL-26-001' })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    const table = getSpoolsTable(dialog)

    // 1) Abre pelo atalho: "Ajuste" pré-selecionado.
    await user.click(within(table).getByRole('button', { name: 'Ajustar peso do rolo RL-26-001' }))
    let manageDialog = await screen.findByRole('dialog', { name: 'Voolt3D - Preto - Sólida' })
    expect(within(manageDialog).getByRole('radio', { name: 'Ajuste' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Voolt3D - Preto - Sólida' }),
      ).not.toBeInTheDocument(),
    )

    // 2) Reabre o MESMO rolo pelo botão "Gerenciar": nenhuma operação marcada.
    await user.click(
      within(table).getByRole('button', { name: /movimentar, pesar ou consultar histórico/i }),
    )
    manageDialog = await screen.findByRole('dialog', { name: 'Voolt3D - Preto - Sólida' })
    expect(within(manageDialog).getByRole('radio', { name: 'Ajuste' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(within(manageDialog).getByRole('radio', { name: 'Registrar perda' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
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
    expect(within(getGroupRow('PLA', 'Sólida', 'Preto')).getAllByRole('cell')[4].textContent).toBe(
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
    expect(within(getGroupRow('PLA', 'Sólida', 'Preto')).getAllByRole('cell')[4].textContent).toBe(
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

    expect(within(getGroupRow('PLA', 'Sólida', 'Zerado')).getAllByRole('cell')[4].textContent).toBe(
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

    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/Zerado'])
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

    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/B', 'PLA/Sólida/C'])
  })

  it('listagem e drawer exibem a MESMA quantidade', async () => {
    mockTypes([typeFixture({ filament_type_id: 't1', usable_spool_count: 7 })])
    mockSpools([spoolFixture()])
    mockSpoolCounts({ countByTypeId: new Map([['t1', 2]]) })
    renderPage()
    const user = userEvent.setup()

    const row = getGroupRow('PLA', 'Sólida', 'Preto')
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

    expect(within(getGroupRow('PLA', 'Sólida', 'Preto')).getAllByRole('cell')[4].textContent).toBe(
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

  it('"Novo tipo de filamento" nunca exibe um campo "Código da cor"', async () => {
    mockTypes([])
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Novo tipo de filamento' }))
    expect(screen.queryByLabelText(/código da cor/i)).not.toBeInTheDocument()
  })

  it('"Novo tipo de filamento" não exibe o campo Fabricante/Fornecedor nem o erro "Informe o fabricante"', async () => {
    const create = vi.fn().mockResolvedValue(typeFixture())
    mockTypes([], { create })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Novo tipo de filamento' }))
    expect(screen.queryByLabelText(/fabricante/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/fornecedor/i)).not.toBeInTheDocument()

    // Salvar só com Material + Linha + Cor: nada de erro de fabricante.
    await user.click(screen.getByRole('radio', { name: 'PLA' }))
    await user.type(screen.getByLabelText('Linha'), 'Sólida')
    await user.type(screen.getByLabelText('Cor'), 'Preto')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(screen.queryByText(/informe o fabricante/i)).not.toBeInTheDocument()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  })

  it('a criação envia manufacturer: "Não informado" e os demais campos corretamente', async () => {
    const create = vi.fn().mockResolvedValue(typeFixture())
    mockTypes([], { create })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Novo tipo de filamento' }))
    await user.click(screen.getByRole('radio', { name: 'PETG' }))
    await user.type(screen.getByLabelText('Linha'), 'Matte')
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

  it('"Editar tipo de filamento" continua com o campo Fabricante para tipos históricos', async () => {
    mockTypes([typeFixture({ filament_type_id: 't1', manufacturer: 'National3D' })])
    renderPage()
    const user = userEvent.setup()

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo National3D — Preto/i,
    })
    await user.click(within(typeActions).getByRole('button', { name: 'Editar tipo' }))

    expect(screen.getByLabelText('Fabricante')).toHaveValue('National3D')
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

  it('7 colunas viram 7 <col> no colgroup; nenhuma é "manufacturer"/"is_active"', () => {
    renderPage()
    expect(document.querySelectorAll('col')).toHaveLength(7)
  })

  it('todos os 7 cabeçalhos têm alça de redimensionamento (inclusive "Rolos disponíveis", que carrega o filtro de faixa)', () => {
    renderPage()
    for (const label of [
      'Material',
      'Linha',
      'Cor',
      'Disponível',
      'Rolos disponíveis',
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
    expect(cols).toHaveLength(7)
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

    expect(getVisibleGroupLabels()).toEqual(['PLA/Sólida/Preto'])
    const dialog = await openDrawer(user, getGroupRow('PLA', 'Sólida', 'Preto'))
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

  it('tipo arquivado fica oculto por padrão; "Mostrar tipos arquivados" o revela com selo "Arquivado" e "Ver rolos" acessível', async () => {
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
    const user = userEvent.setup()

    // Oculto por padrão.
    expect(
      screen.getByText('Nenhum resultado para a busca e os filtros atuais.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Mostrar tipos arquivados' }))

    const row = getGroupRow('PLA', 'Sólida', 'Preto')
    expect(within(row).getByText('Arquivado')).toBeInTheDocument()
    // Não conta como disponibilidade: 0g e 0 rolos.
    const cells = within(row).getAllByRole('cell')
    expect(cells[3].textContent).toBe('0g')
    // "Ver rolos" continua acessível para consultar o histórico preservado.
    expect(within(row).getByRole('button', { name: /^ver rolos/i })).toBeInTheDocument()
  })

  it('"Excluir tipo" fica desabilitado num tipo já arquivado — não repete a remoção', async () => {
    mockTypes([
      typeFixture({
        filament_type_id: 'a',
        manufacturer: 'Voolt3D',
        commercial_color: 'Preto',
        is_active: false,
        total_spool_count: 1,
      }),
    ])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('switch', { name: 'Mostrar tipos arquivados' }))
    const row = getGroupRow('PLA', 'Sólida', 'Preto')
    const dialog = await openDrawer(user, row)
    const typeActions = within(dialog).getByRole('group', {
      name: /Ações do tipo Voolt3D — Preto/i,
    })
    expect(within(typeActions).getByRole('button', { name: 'Excluir tipo' })).toBeDisabled()
  })

  it('o controle "Mostrar tipos arquivados" começa desligado e é um switch próximo dos filtros (não confundir com "Mostrar arquivados" dos rolos)', () => {
    mockTypes([typeFixture()])
    renderPage()
    const toggle = screen.getByRole('switch', { name: 'Mostrar tipos arquivados' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    // O "Mostrar arquivados" (rolos) NÃO aparece na página — só dentro da janela "Ver rolos".
    expect(screen.queryByRole('switch', { name: 'Mostrar arquivados' })).not.toBeInTheDocument()
  })
})
