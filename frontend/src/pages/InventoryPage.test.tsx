import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'
import type { Accessory, Packaging } from '@/types/domain'

const { useAccessoriesMock, usePackagingMock, useStockMovementsMock, useAuthMock, toastMock } = vi.hoisted(() => ({
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  useStockMovementsMock: vi.fn(),
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
// StockMovementPanel (Módulo 3, Incremento 2) usa useStockMovements
// internamente — mockado aqui para que abrir "Movimentar estoque" nesta
// suíte nunca dependa de rede real. Default: histórico vazio, sem
// carregamento/erro — cada teste que precisa de outro cenário sobrescreve
// via useStockMovementsMock.mockReturnValue(...).
vi.mock('@/hooks/useStockMovements', () => ({ useStockMovements: useStockMovementsMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { InventoryPage } from './InventoryPage'

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

function mockAccessories(
  list: Accessory[],
  overrides: Partial<{
    isLoading: boolean
    error: unknown
    refetch: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    setLocalStock: ReturnType<typeof vi.fn>
  }> = {},
) {
  useAccessoriesMock.mockReturnValue({
    accessories: list,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    create: overrides.create ?? vi.fn().mockResolvedValue(accessoryFixture()),
    update: overrides.update ?? vi.fn().mockResolvedValue(accessoryFixture()),
    delete: overrides.delete ?? vi.fn().mockResolvedValue(undefined),
    setLocalStock: overrides.setLocalStock ?? vi.fn(),
  })
}

function mockPackaging(
  list: Packaging[],
  overrides: Partial<{
    isLoading: boolean
    error: unknown
    refetch: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    setLocalStock: ReturnType<typeof vi.fn>
  }> = {},
) {
  usePackagingMock.mockReturnValue({
    packaging: list,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    create: overrides.create ?? vi.fn().mockResolvedValue(packagingFixture()),
    update: overrides.update ?? vi.fn().mockResolvedValue(packagingFixture()),
    delete: overrides.delete ?? vi.fn().mockResolvedValue(undefined),
    setLocalStock: overrides.setLocalStock ?? vi.fn(),
  })
}

function renderPage(area: 'acessorios' | 'embalagens' = 'acessorios') {
  useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
  return render(<InventoryPage area={area} />, { wrapper: MemoryRouter })
}

function getTable(): HTMLElement {
  return screen.getByRole('table')
}

// getByText compara contra o texto do DOM ja normalizado pela
// Testing Library (qualquer sequencia de espaco, incluindo o caractere
// de espaco sem quebra que toLocaleString('pt-BR', { style: 'currency' })
// insere entre "R$" e o valor, vira um unico espaco comum) - por isso a
// string de comparacao tambem precisa passar pela mesma normalizacao, ou
// a assercao nunca bate.
function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ')
}

// "Ativo" aparece no cabeçalho da coluna (botão "Ordenar coluna Ativo") —
// helpers abaixo escopam a busca só ao corpo da tabela (tbody), nunca ao
// cabeçalho.
function getTableBody(): HTMLElement {
  const tbody = getTable().querySelector('tbody')
  if (!tbody) throw new Error('tbody não encontrado na tabela')
  return tbody as HTMLElement
}

async function applySort(
  user: ReturnType<typeof userEvent.setup>,
  columnLabel: string,
  option: 'Ordenar crescente' | 'Ordenar decrescente' | 'Remover ordenação',
): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Ordenar coluna ${columnLabel}` }))
  await user.click(await screen.findByRole('menuitem', { name: option }))
}

function getVisibleNamesInOrder(): string[] {
  const dataRows = within(getTable())
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('cell').length > 0)
  return dataRows.map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

describe('InventoryPage', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('mostra o título "Estoque" e uma descrição curta', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    expect(screen.getByRole('heading', { name: 'Estoque' })).toBeInTheDocument()
    expect(screen.getByText(/cadastros mestre de acessórios, embalagens e filamentos/i)).toBeInTheDocument()
  })

  it('navegação interna marca "Acessórios" como área ativa em area="acessorios"', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    const accessoriesLink = screen.getByRole('link', { name: 'Acessórios' })
    const packagingLink = screen.getByRole('link', { name: 'Embalagens' })
    expect(accessoriesLink).toHaveAttribute('aria-current', 'page')
    expect(accessoriesLink).toHaveAttribute('href', '/estoque/acessorios')
    expect(packagingLink).not.toHaveAttribute('aria-current')
    expect(packagingLink).toHaveAttribute('href', '/estoque/embalagens')
  })

  it('navegação interna marca "Embalagens" como área ativa em area="embalagens"', () => {
    mockPackaging([packagingFixture()])
    renderPage('embalagens')

    expect(screen.getByRole('link', { name: 'Embalagens' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Acessórios' })).not.toHaveAttribute('aria-current')
  })

  it('estado de carregamento usa role="status" e não mostra a tabela', () => {
    mockAccessories([], { isLoading: true })
    renderPage('acessorios')

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('estado de erro usa role="alert" e permite tentar novamente', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockAccessories([], { error: new ApiError('database', 500, 'Falha ao carregar acessórios.'), refetch })
    renderPage('acessorios')

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Falha ao carregar acessórios.')).toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Tentar novamente' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('lista vazia mostra "Nenhum acessório cadastrado."', () => {
    mockAccessories([])
    renderPage('acessorios')

    expect(screen.getByRole('status')).toHaveTextContent('Nenhum acessório cadastrado.')
  })

  it('lista vazia mostra "Nenhuma embalagem cadastrada." na área de embalagens', () => {
    mockPackaging([])
    renderPage('embalagens')

    expect(screen.getByText('Nenhuma embalagem cadastrada.')).toBeInTheDocument()
  })

  it('busca sem correspondência mostra "Nenhum resultado encontrado." (diferente de lista vazia)', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ name: 'Ímã 6x2' })])
    renderPage('acessorios')

    await user.type(screen.getByRole('combobox', { name: 'Buscar acessórios' }), 'não existe')

    expect(screen.getByText('Nenhum resultado encontrado.')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum acessório cadastrado.')).not.toBeInTheDocument()
  })

  it('renderiza as 6 colunas esperadas — com "Acessório" e "Custo/un." nos cabeçalhos renomeados', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    for (const label of ['Acessório', 'Tamanho', 'Variante', 'Custo/un.', 'Estoque mínimo', 'Ativo']) {
      expect(screen.getByRole('button', { name: `Ordenar coluna ${label}` })).toBeInTheDocument()
    }
    // os rótulos antigos não aparecem mais como nome de coluna
    expect(screen.queryByRole('button', { name: 'Ordenar coluna Nome' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ordenar coluna Custo' })).not.toBeInTheDocument()
  })

  it('size nulo é exibido como "Não se aplica"', () => {
    mockAccessories([accessoryFixture({ size: null })])
    renderPage('acessorios')

    expect(within(getTable()).getByText('Não se aplica')).toBeInTheDocument()
  })

  it('um tamanho legado fora de PP/P/M/G/GG é exibido exatamente como está gravado', () => {
    mockAccessories([accessoryFixture({ size: 'M3' })])
    renderPage('acessorios')

    expect(within(getTable()).getByText('M3')).toBeInTheDocument()
  })

  it('unit_cost nulo é exibido como "Não informado", nunca R$ 0,00', () => {
    mockAccessories([accessoryFixture({ unit_cost: null })])
    renderPage('acessorios')

    expect(within(getTable()).getByText('Não informado')).toBeInTheDocument()
    expect(within(getTable()).queryByText(formatBRL(0))).not.toBeInTheDocument()
  })

  it('unit_cost existente é formatado em moeda brasileira', () => {
    mockAccessories([accessoryFixture({ unit_cost: 12.5 })])
    renderPage('acessorios')

    expect(within(getTable()).getByText(formatBRL(12.5))).toBeInTheDocument()
  })

  it('Ativo é um Switch funcional (não mais um badge de texto), sem botões de ativar/desativar', () => {
    mockAccessories([accessoryFixture({ is_active: true }), accessoryFixture({ id: 'a2', name: 'Parafuso', is_active: false })])
    renderPage('acessorios')

    expect(within(getTableBody()).getByRole('switch', { name: 'Desativar acessório Ímã 6x2' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(getTableBody()).getByRole('switch', { name: 'Ativar acessório Parafuso' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(within(getTableBody()).queryByText('Ativo')).not.toBeInTheDocument()
    expect(within(getTableBody()).queryByText('Inativo')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^ativar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /desativar/i })).not.toBeInTheDocument()
    // "Excluir" existe como ação por linha (coberto em detalhe na suíte de
    // exclusão abaixo) — aqui só confirmamos que está presente.
    expect(within(getTableBody()).getByRole('button', { name: 'Excluir acessório Ímã 6x2' })).toBeInTheDocument()
  })

  it('busca por nome filtra a listagem, ignorando maiúsculas/minúsculas e espaços de borda', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' }), accessoryFixture({ id: 'a2', name: 'Parafuso M3' })])
    renderPage('acessorios')

    await user.type(screen.getByRole('combobox', { name: 'Buscar acessórios' }), '  IMÃ  ')

    expect(within(getTable()).getByText('Ímã 6x2')).toBeInTheDocument()
    expect(within(getTable()).queryByText('Parafuso M3')).not.toBeInTheDocument()
  })

  it('busca por tamanho filtra a listagem', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', size: 'M' }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', size: 'GG' }),
    ])
    renderPage('acessorios')

    await user.type(screen.getByRole('combobox', { name: 'Buscar acessórios' }), 'gg')

    expect(within(getTable()).getByText('Parafuso')).toBeInTheDocument()
    expect(within(getTable()).queryByText('Ímã 6x2')).not.toBeInTheDocument()
  })

  it('busca por variante filtra a listagem', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', variant: 'azul' }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', variant: 'prata' }),
    ])
    renderPage('acessorios')

    await user.type(screen.getByRole('combobox', { name: 'Buscar acessórios' }), 'prata')

    expect(within(getTable()).getByText('Parafuso')).toBeInTheDocument()
    expect(within(getTable()).queryByText('Ímã 6x2')).not.toBeInTheDocument()
  })

  it('botão de limpar busca aparece com conteúdo e restaura a listagem completa', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' }), accessoryFixture({ id: 'a2', name: 'Parafuso' })])
    renderPage('acessorios')

    const searchInput = screen.getByRole('combobox', { name: 'Buscar acessórios' })
    await user.type(searchInput, 'Ímã')
    expect(within(getTable()).queryByText('Parafuso')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Limpar busca' }))

    expect(searchInput).toHaveValue('')
    expect(within(getTable()).getByText('Parafuso')).toBeInTheDocument()
  })

  it('não existe filtro de status em Acessórios — a listagem mostra ativos E inativos ao mesmo tempo', () => {
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã ativo', is_active: true }),
      accessoryFixture({ id: 'a2', name: 'Ímã inativo', is_active: false }),
    ])
    renderPage('acessorios')

    // o controle Todos/Ativos/Inativos foi removido de Acessórios
    expect(
      screen.queryByRole('radiogroup', { name: 'Filtrar acessórios por status' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Todos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Ativos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Inativos' })).not.toBeInTheDocument()

    // a listagem se comporta como o antigo estado "Todos": mostra os dois
    expect(within(getTable()).getByText('Ímã ativo')).toBeInTheDocument()
    expect(within(getTable()).getByText('Ímã inativo')).toBeInTheDocument()
    // a coluna que identifica a situação de cada registro (Switch "Ativo")
    // continua presente
    expect(screen.getByRole('button', { name: 'Ordenar coluna Ativo' })).toBeInTheDocument()
    expect(
      within(getTableBody()).getByRole('switch', { name: 'Desativar acessório Ímã ativo' }),
    ).toBeInTheDocument()
    expect(
      within(getTableBody()).getByRole('switch', { name: 'Ativar acessório Ímã inativo' }),
    ).toBeInTheDocument()
  })

  it('a busca de Acessórios continua funcionando por si só (não há filtro de status para combinar)', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã ativo', is_active: true }),
      accessoryFixture({ id: 'a2', name: 'Ímã inativo', is_active: false }),
      accessoryFixture({ id: 'a3', name: 'Parafuso ativo', is_active: true }),
    ])
    renderPage('acessorios')

    await user.type(screen.getByRole('combobox', { name: 'Buscar acessórios' }), 'Ímã')

    // "Ímã" mantém tanto o ativo quanto o inativo (sem filtro de status) e
    // descarta "Parafuso ativo".
    expect(within(getTable()).getByText('Ímã ativo')).toBeInTheDocument()
    expect(within(getTable()).getByText('Ímã inativo')).toBeInTheDocument()
    expect(within(getTable()).queryByText('Parafuso ativo')).not.toBeInTheDocument()
  })

  it('ordenação pelo cabeçalho renomeado "Acessório" alterna crescente e decrescente sem mutar os dados originais', async () => {
    const user = userEvent.setup()
    const list = [
      accessoryFixture({ id: 'a1', name: 'Zebra' }),
      accessoryFixture({ id: 'a2', name: 'Abelha' }),
    ]
    mockAccessories(list)
    renderPage('acessorios')

    await applySort(user, 'Acessório', 'Ordenar crescente')
    expect(getVisibleNamesInOrder()).toEqual(['Abelha', 'Zebra'])

    await applySort(user, 'Acessório', 'Ordenar decrescente')
    expect(getVisibleNamesInOrder()).toEqual(['Zebra', 'Abelha'])

    // O array original passado ao componente nunca é reordenado in-place.
    expect(list[0].name).toBe('Zebra')
    expect(list[1].name).toBe('Abelha')
  })

  it('mostra o contador de resultados e o atualiza conforme a busca', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' }), accessoryFixture({ id: 'a2', name: 'Parafuso' })])
    renderPage('acessorios')

    expect(screen.getByText('2 resultados')).toBeInTheDocument()

    await user.type(screen.getByRole('combobox', { name: 'Buscar acessórios' }), 'Ímã')
    expect(screen.getByText('1 resultado')).toBeInTheDocument()
  })

  it('ordenação pelo cabeçalho renomeado "Custo/un." trata valores nulos de forma determinística (sempre ao final)', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Sem custo', unit_cost: null }),
      accessoryFixture({ id: 'a2', name: 'Custo baixo', unit_cost: 1 }),
      accessoryFixture({ id: 'a3', name: 'Custo alto', unit_cost: 9 }),
    ])
    renderPage('acessorios')

    await applySort(user, 'Custo/un.', 'Ordenar crescente')
    expect(getVisibleNamesInOrder()).toEqual(['Custo baixo', 'Custo alto', 'Sem custo'])

    await applySort(user, 'Custo/un.', 'Ordenar decrescente')
    expect(getVisibleNamesInOrder()).toEqual(['Custo alto', 'Custo baixo', 'Sem custo'])
  })

  it('a listagem de Embalagens usa o mesmo padrão de colunas e formatação', () => {
    mockPackaging([packagingFixture({ size: null, unit_cost: null })])
    renderPage('embalagens')

    for (const label of ['Nome', 'Tamanho', 'Variante', 'Custo', 'Estoque mínimo', 'Ativo']) {
      expect(screen.getByRole('button', { name: `Ordenar coluna ${label}` })).toBeInTheDocument()
    }
    expect(within(getTableBody()).getByText('Não se aplica')).toBeInTheDocument()
    expect(within(getTableBody()).getByText('Não informado')).toBeInTheDocument()
  })

  it('busca e filtro de Embalagens usam placeholder/rótulos próprios de embalagens', () => {
    mockPackaging([packagingFixture()])
    renderPage('embalagens')

    expect(screen.getByRole('combobox', { name: 'Buscar embalagens' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Filtrar embalagens por status' })).toBeInTheDocument()
  })

  it('a busca de Acessórios e Embalagens é independente entre si', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' })])
    const { unmount } = renderPage('acessorios')
    const accessoriesSearch = screen.getByRole('combobox', { name: 'Buscar acessórios' })
    await user.type(accessoriesSearch, 'ímã')
    expect(accessoriesSearch).toHaveValue('ímã')
    unmount()

    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M' })])
    renderPage('embalagens')
    const packagingSearch = screen.getByRole('combobox', { name: 'Buscar embalagens' })
    expect(packagingSearch).toHaveValue('')
  })
})

// Cobertura dedicada da área Embalagens (/estoque/embalagens) — mesmo
// componente compartilhado de Acessórios (InventoryAreaPanel), mas
// verificada aqui explicitamente item a item, sem depender só das
// asserções cruzadas acima.
describe('InventoryPage — área Embalagens (/estoque/embalagens)', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('renderiza a página com título "Estoque" e a aba "Embalagens" ativa', () => {
    mockPackaging([packagingFixture()])
    renderPage('embalagens')

    expect(screen.getByRole('heading', { name: 'Estoque' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Embalagens' })).toHaveAttribute('aria-current', 'page')
  })

  it('estado de carregamento usa role="status" e não mostra a tabela', () => {
    mockPackaging([], { isLoading: true })
    renderPage('embalagens')

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('estado de erro usa role="alert" e permite tentar novamente', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockPackaging([], { error: new ApiError('database', 500, 'Falha ao carregar embalagens.'), refetch })
    renderPage('embalagens')

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Falha ao carregar embalagens.')).toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Tentar novamente' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('lista vazia mostra "Nenhuma embalagem cadastrada."', () => {
    mockPackaging([])
    renderPage('embalagens')

    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma embalagem cadastrada.')
  })

  it('exibe os registros de embalagens carregados', () => {
    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M' }), packagingFixture({ id: 'k2', name: 'Sacola Kraft' })])
    renderPage('embalagens')

    expect(within(getTable()).getByText('Caixa M')).toBeInTheDocument()
    expect(within(getTable()).getByText('Sacola Kraft')).toBeInTheDocument()
  })

  it('busca rápida filtra por nome, ignorando maiúsculas/minúsculas e espaços de borda', async () => {
    const user = userEvent.setup()
    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M' }), packagingFixture({ id: 'k2', name: 'Sacola Kraft' })])
    renderPage('embalagens')

    await user.type(screen.getByRole('combobox', { name: 'Buscar embalagens' }), '  caixa  ')

    expect(within(getTable()).getByText('Caixa M')).toBeInTheDocument()
    expect(within(getTable()).queryByText('Sacola Kraft')).not.toBeInTheDocument()
  })

  it('busca sem correspondência mostra "Nenhum resultado encontrado."', async () => {
    const user = userEvent.setup()
    mockPackaging([packagingFixture({ name: 'Caixa M' })])
    renderPage('embalagens')

    await user.type(screen.getByRole('combobox', { name: 'Buscar embalagens' }), 'não existe')

    expect(screen.getByText('Nenhum resultado encontrado.')).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma embalagem cadastrada.')).not.toBeInTheDocument()
  })

  it('filtros Todos/Ativos/Inativos filtram corretamente e "Limpar filtros" restaura "Todos"', async () => {
    const user = userEvent.setup()
    mockPackaging([
      packagingFixture({ id: 'k1', name: 'Caixa ativa', is_active: true }),
      packagingFixture({ id: 'k2', name: 'Caixa inativa', is_active: false }),
    ])
    renderPage('embalagens')

    const filterGroup = screen.getByRole('radiogroup', { name: 'Filtrar embalagens por status' })
    expect(within(filterGroup).getByRole('radio', { name: 'Todos' })).toHaveAttribute('aria-checked', 'true')

    // operável por teclado (foco + Enter) — cobertura antes exercida também
    // pelo filtro de Acessórios, que foi removido nesta rodada.
    const activeRadio = within(filterGroup).getByRole('radio', { name: 'Ativos' })
    activeRadio.focus()
    await user.keyboard('{Enter}')
    expect(activeRadio).toHaveAttribute('aria-checked', 'true')
    expect(within(getTable()).getByText('Caixa ativa')).toBeInTheDocument()
    expect(within(getTable()).queryByText('Caixa inativa')).not.toBeInTheDocument()

    await user.click(within(filterGroup).getByRole('radio', { name: 'Inativos' }))
    expect(within(getTable()).getByText('Caixa inativa')).toBeInTheDocument()
    expect(within(getTable()).queryByText('Caixa ativa')).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))

    expect(within(filterGroup).getByRole('radio', { name: 'Todos' })).toHaveAttribute('aria-checked', 'true')
    expect(within(getTable()).getByText('Caixa ativa')).toBeInTheDocument()
    expect(within(getTable()).getByText('Caixa inativa')).toBeInTheDocument()
  })

  it('com o filtro "Ativos", um item que vira inativo some da listagem assim que o array local é atualizado', async () => {
    // Cobertura antes feita na área Acessórios (filtro removido nesta
    // rodada) — o filtro de Embalagens continua e a mesma reatividade via
    // useMemo precisa seguir valendo.
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(packagingFixture({ id: 'k1', name: 'Caixa M', is_active: false }))
    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M', is_active: true })], { update })
    const { rerender } = renderPage('embalagens')

    await user.click(screen.getByRole('radio', { name: 'Ativos' }))
    expect(within(getTableBody()).getByText('Caixa M')).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Desativar embalagem Caixa M' }))
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('k1', { is_active: false }))

    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M', is_active: false })], { update })
    rerender(<InventoryPage area="embalagens" />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Caixa M')).not.toBeInTheDocument()
    expect(screen.getByText('Nenhum resultado encontrado.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Ativos' })).toHaveAttribute('aria-checked', 'true')
  })

  it('ordenação por Nome alterna crescente e decrescente', async () => {
    const user = userEvent.setup()
    mockPackaging([
      packagingFixture({ id: 'k1', name: 'Sacola Kraft' }),
      packagingFixture({ id: 'k2', name: 'Caixa M' }),
    ])
    renderPage('embalagens')

    await applySort(user, 'Nome', 'Ordenar crescente')
    expect(getVisibleNamesInOrder()).toEqual(['Caixa M', 'Sacola Kraft'])

    await applySort(user, 'Nome', 'Ordenar decrescente')
    expect(getVisibleNamesInOrder()).toEqual(['Sacola Kraft', 'Caixa M'])
  })

  it('tamanho vazio é exibido como "Não se aplica"', () => {
    mockPackaging([packagingFixture({ size: null })])
    renderPage('embalagens')

    expect(within(getTable()).getByText('Não se aplica')).toBeInTheDocument()
  })

  it('custo nulo é exibido como "Não informado", nunca R$ 0,00', () => {
    mockPackaging([packagingFixture({ unit_cost: null })])
    renderPage('embalagens')

    expect(within(getTable()).getByText('Não informado')).toBeInTheDocument()
    expect(within(getTable()).queryByText(formatBRL(0))).not.toBeInTheDocument()
  })

  it('custo existente é formatado em moeda brasileira', () => {
    mockPackaging([packagingFixture({ unit_cost: 7.9 })])
    renderPage('embalagens')

    expect(within(getTable()).getByText(formatBRL(7.9))).toBeInTheDocument()
  })

  it('Ativo é um Switch funcional: coluna de Ações sem rótulo, sem checkbox de seleção, sem botões de ativar/desativar', () => {
    mockPackaging([
      packagingFixture({ id: 'k1', is_active: true }),
      packagingFixture({ id: 'k2', name: 'Sacola Kraft', is_active: false }),
    ])
    renderPage('embalagens')

    expect(within(getTableBody()).getByRole('switch', { name: 'Desativar embalagem Caixa M' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(getTableBody()).getByRole('switch', { name: 'Ativar embalagem Sacola Kraft' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(within(getTableBody()).queryByText('Ativo')).not.toBeInTheDocument()
    expect(within(getTableBody()).queryByText('Inativo')).not.toBeInTheDocument()
    // A coluna de ações existe (botões "Editar"/"Excluir" por linha), mas o
    // próprio cabeçalho não tem NENHUM texto visível "Ações" — o nome
    // acessível do <th> (padronização das listagens, rodada 2026-08-31) vem
    // só da alça de redimensionamento ("Redimensionar coluna Ações"), nunca
    // de um rótulo de coluna próprio.
    expect(within(getTable()).queryByText('Ações')).not.toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Redimensionar coluna Ações' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^ativar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /desativar/i })).not.toBeInTheDocument()
    expect(within(getTableBody()).getByRole('button', { name: 'Excluir embalagem Caixa M' })).toBeInTheDocument()
  })
})

// Cadastro de novos itens (criação) — o próprio InventoryItemForm.test.tsx
// já cobre campos/opções/validações em isolamento; os testes abaixo cobrem
// só a integração com a página (botão certo por área, abrir/fechar,
// payload exato enviado a create(), sucesso/erro/duplo-envio).
describe('InventoryPage — cadastro de novos itens', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('exibe "Novo acessório" na área Acessórios, nunca "Nova embalagem"', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    expect(screen.getByRole('button', { name: 'Novo acessório' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nova embalagem' })).not.toBeInTheDocument()
  })

  it('exibe "Nova embalagem" na área Embalagens, nunca "Novo acessório"', () => {
    mockPackaging([packagingFixture()])
    renderPage('embalagens')

    expect(screen.getByRole('button', { name: 'Nova embalagem' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Novo acessório' })).not.toBeInTheDocument()
  })

  it('abre o formulário de novo acessório e fecha ao cancelar, sem chamar create()', async () => {
    const user = userEvent.setup()
    const create = vi.fn()
    mockAccessories([accessoryFixture()], { create })
    renderPage('acessorios')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Novo acessório' }))
    expect(screen.getByRole('dialog', { name: 'Novo acessório' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Nome'), 'Ímã que não deve ser salvo')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('abre o formulário de nova embalagem com título e descrição próprios', async () => {
    const user = userEvent.setup()
    mockPackaging([packagingFixture()])
    renderPage('embalagens')

    await user.click(screen.getByRole('button', { name: 'Nova embalagem' }))

    expect(screen.getByRole('dialog', { name: 'Nova embalagem' })).toBeInTheDocument()
    expect(screen.getByText('Preencha os dados para cadastrar uma nova embalagem.')).toBeInTheDocument()
  })

  it('envia o payload exato para um novo acessório (trim aplicado, sem is_active/material/unit_cost/current_stock)', async () => {
    const user = userEvent.setup()
    const create = vi.fn().mockResolvedValue(accessoryFixture())
    mockAccessories([], { create })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Novo acessório' }))
    await user.type(screen.getByLabelText('Nome'), '  Parafuso M3  ')
    await user.click(screen.getByRole('radio', { name: 'M' }))
    await user.type(screen.getByLabelText('Variante'), '  prata  ')
    await user.type(screen.getByLabelText('Estoque mínimo'), '8')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Parafuso M3',
        size: 'M',
        variant: 'prata',
        minimum_stock: 8,
      }),
    )
    // Nenhuma chave além dessas 4 é enviada — nem is_active, nem
    // material/unit_cost/current_stock, que não existem no formulário.
    expect(Object.keys(create.mock.calls[0][0])).toEqual(['name', 'size', 'variant', 'minimum_stock'])
  })

  it('envia o payload exato para uma nova embalagem', async () => {
    const user = userEvent.setup()
    const create = vi.fn().mockResolvedValue(packagingFixture())
    mockPackaging([], { create })
    renderPage('embalagens')

    await user.click(screen.getByRole('button', { name: 'Nova embalagem' }))
    await user.type(screen.getByLabelText('Nome'), 'Caixa G')
    await user.click(screen.getByRole('radio', { name: 'G' }))
    await user.type(screen.getByLabelText('Estoque mínimo'), '2')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Caixa G',
        size: 'G',
        variant: null,
        minimum_stock: 2,
      }),
    )
  })

  it('sucesso fecha o diálogo e mostra um toast de confirmação', async () => {
    const user = userEvent.setup()
    const create = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a-new', name: 'Ímã novo' }))
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Parafuso' })], { create })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Novo acessório' }))
    await user.type(screen.getByLabelText('Nome'), 'Ímã novo')
    await user.type(screen.getByLabelText('Estoque mínimo'), '1')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toastMock.success).toHaveBeenCalledWith('Acessório cadastrado.')
  })

  it('erro de validação mantém o diálogo aberto, preserva os valores e mostra a mensagem dentro do formulário (nunca toast)', async () => {
    const user = userEvent.setup()
    const create = vi.fn().mockRejectedValue(new ApiError('validation', 400, 'Campo inválido: name.'))
    mockAccessories([], { create })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Novo acessório' }))
    await user.type(screen.getByLabelText('Nome'), 'Ímã 6x2')
    await user.type(screen.getByLabelText('Estoque mínimo'), '1')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Campo inválido: name.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Ímã 6x2')
    expect(screen.getByLabelText('Estoque mínimo')).toHaveValue('1')
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('falha de autenticação (401) é tratada via toast, sem fechar o diálogo nem perder os valores', async () => {
    const user = userEvent.setup()
    const create = vi.fn().mockRejectedValue(new ApiError('authorization', 401, 'Sessão expirada. Faça login novamente.'))
    mockAccessories([], { create })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Novo acessório' }))
    await user.type(screen.getByLabelText('Nome'), 'Ímã 6x2')
    await user.type(screen.getByLabelText('Estoque mínimo'), '1')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Sessão expirada. Faça login novamente.'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Ímã 6x2')
  })

  it('impede submissão duplicada: o botão fica desabilitado durante o envio e não reenvia', async () => {
    const user = userEvent.setup()
    let resolveCreate: (value: Accessory) => void = () => {}
    const create = vi.fn(
      () =>
        new Promise<Accessory>((resolve) => {
          resolveCreate = resolve
        }),
    )
    mockAccessories([], { create })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Novo acessório' }))
    await user.type(screen.getByLabelText('Nome'), 'Ímã 6x2')
    await user.type(screen.getByLabelText('Estoque mínimo'), '1')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    const savingButton = await screen.findByRole('button', { name: 'Salvando...' })
    expect(savingButton).toBeDisabled()
    expect(create).toHaveBeenCalledTimes(1)

    // Botão desabilitado: um segundo clique não reenvia.
    await user.click(savingButton)
    expect(create).toHaveBeenCalledTimes(1)

    resolveCreate(accessoryFixture())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

// Edição de itens existentes — o próprio InventoryItemForm.test.tsx já
// cobre pré-preenchimento/tamanho legado/validações em isolamento; os
// testes abaixo cobrem só a integração com a página (botão "Editar" por
// linha, abrir/fechar com os dados certos, payload exato enviado a
// update(), sucesso/erro/duplo-envio, busca/filtro preservados).
describe('InventoryPage — edição de itens existentes', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('botão "Editar" existe em cada linha da listagem de Acessórios e abre "Editar acessório" pré-preenchido', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))

    expect(screen.getByRole('dialog', { name: 'Editar acessório' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Ímã 6x2')
    expect(screen.getByLabelText('Variante')).toHaveValue('azul')
    expect(screen.getByLabelText('Estoque mínimo')).toHaveValue('10')
    expect(screen.getByRole('radio', { name: 'M' })).toHaveAttribute('aria-checked', 'true')
  })

  it('cancelar a edição fecha o diálogo sem chamar update()', async () => {
    const user = userEvent.setup()
    const update = vi.fn()
    mockAccessories([accessoryFixture()], { update })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    await user.clear(screen.getByLabelText('Nome'))
    await user.type(screen.getByLabelText('Nome'), 'Não deve ser salvo')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('reabrir a edição para um registro diferente não preserva os valores do anterior', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2' }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', size: 'G', variant: 'prata', minimum_stock: 3 }),
    ])
    renderPage('acessorios')

    const rows = within(getTableBody()).getAllByRole('row')
    await user.click(within(rows[0]).getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('Ímã 6x2')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    await user.click(within(rows[1]).getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('Parafuso')
    expect(screen.getByLabelText('Variante')).toHaveValue('prata')
    expect(screen.getByLabelText('Estoque mínimo')).toHaveValue('3')
  })

  it('envia o payload exato ao editar um acessório (nome pós-trim, sem is_active/material/unit_cost/current_stock)', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture())
    mockAccessories([accessoryFixture()], { update })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    await user.clear(screen.getByLabelText('Nome'))
    await user.type(screen.getByLabelText('Nome'), '  Ímã atualizado  ')
    await user.clear(screen.getByLabelText('Variante'))
    await user.type(screen.getByLabelText('Variante'), '  prata  ')
    await user.clear(screen.getByLabelText('Estoque mínimo'))
    await user.type(screen.getByLabelText('Estoque mínimo'), '7')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('a1', {
        name: 'Ímã atualizado',
        size: 'M',
        variant: 'prata',
        minimum_stock: 7,
      }),
    )
    expect(Object.keys(update.mock.calls[0][1])).toEqual(['name', 'size', 'variant', 'minimum_stock'])
  })

  it('tamanho "Não se aplica" é enviado como null na edição', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture())
    mockAccessories([accessoryFixture({ size: 'M' })], { update })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('radio', { name: 'Não se aplica' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', expect.objectContaining({ size: null })))
  })

  it('um tamanho legado é preservado quando o usuário não altera a seleção', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture())
    mockAccessories([accessoryFixture({ size: 'M3' })], { update })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('radio', { name: 'M3' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', expect.objectContaining({ size: 'M3' })))
  })

  it('um tamanho legado pode ser substituído por uma opção oficial da lista', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture())
    mockAccessories([accessoryFixture({ size: 'M3' })], { update })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('radio', { name: 'GG' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', expect.objectContaining({ size: 'GG' })))
  })

  it('sucesso fecha o diálogo e mostra um toast de confirmação', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ name: 'Ímã atualizado' }))
    mockAccessories([accessoryFixture()], { update })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    await user.clear(screen.getByLabelText('Nome'))
    await user.type(screen.getByLabelText('Nome'), 'Ímã atualizado')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toastMock.success).toHaveBeenCalledWith('Acessório atualizado.')
  })

  it('erro de validação mantém o diálogo aberto, preserva os valores e mostra a mensagem dentro do formulário (nunca toast)', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockRejectedValue(new ApiError('validation', 400, 'Campo inválido: name.'))
    mockAccessories([accessoryFixture()], { update })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    await user.clear(screen.getByLabelText('Nome'))
    await user.type(screen.getByLabelText('Nome'), 'Nome inválido')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByText('Campo inválido: name.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Nome inválido')
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('falha de autenticação (401) na edição é tratada via toast, sem fechar o diálogo nem perder os valores', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockRejectedValue(new ApiError('authorization', 401, 'Sessão expirada. Faça login novamente.'))
    mockAccessories([accessoryFixture()], { update })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Sessão expirada. Faça login novamente.'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('impede edição duplicada: o botão fica desabilitado durante o envio e não reenvia', async () => {
    const user = userEvent.setup()
    let resolveUpdate: (value: Accessory) => void = () => {}
    const update = vi.fn(
      () =>
        new Promise<Accessory>((resolve) => {
          resolveUpdate = resolve
        }),
    )
    mockAccessories([accessoryFixture()], { update })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    const savingButton = await screen.findByRole('button', { name: 'Salvando...' })
    expect(savingButton).toBeDisabled()
    expect(update).toHaveBeenCalledTimes(1)

    await user.click(savingButton)
    expect(update).toHaveBeenCalledTimes(1)

    resolveUpdate(accessoryFixture())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('editar não limpa a busca ativa na listagem', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture())
    mockAccessories(
      [accessoryFixture({ id: 'a1', name: 'Ímã 6x2' }), accessoryFixture({ id: 'a2', name: 'Parafuso', is_active: false })],
      { update },
    )
    renderPage('acessorios')

    const searchInput = screen.getByRole('combobox', { name: 'Buscar acessórios' })
    await user.type(searchInput, 'Ímã')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(searchInput).toHaveValue('Ímã')
  })

  it('botão "Editar" existe na listagem de Embalagens e abre "Editar embalagem" com payload correto', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(packagingFixture())
    mockPackaging([packagingFixture()], { update })
    renderPage('embalagens')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('dialog', { name: 'Editar embalagem' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Caixa M')

    await user.clear(screen.getByLabelText('Nome'))
    await user.type(screen.getByLabelText('Nome'), 'Caixa G')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('k1', {
        name: 'Caixa G',
        size: 'M',
        variant: 'kraft',
        minimum_stock: 5,
      }),
    )
  })
})

// Ativação/desativação — a coluna "Ativo" é um Switch funcional, mas clicar
// nele NUNCA chama a API diretamente: sempre abre um diálogo de
// confirmação primeiro (mesmo padrão acessível de Dialog já usado por
// criação/edição/exclusão, nunca window.confirm); só "Ativar"/"Desativar"
// dentro do diálogo envia { is_active } via o mesmo update() já usado pela
// edição (nenhuma rota nova). O hook (useAccessories/usePackaging) está
// mockado nestes testes de página — a garantia de "substituição local +
// ordenação preservada + estado anterior preservado em erro" já é coberta
// em useAccessories.test.ts/usePackaging.test.ts; aqui cobrimos a
// integração com a página (abrir confirmação, cancelar sem chamar API,
// confirmar chama uma vez com payload exato, bloquear clique duplicado,
// sucesso/erro, busca/filtro preservados, acessibilidade).
describe('InventoryPage — ativação e desativação', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('os switches refletem o estado atual de cada item (ativo = marcado, inativo = desmarcado)', () => {
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', is_active: true }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', is_active: false }),
    ])
    renderPage('acessorios')

    expect(screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Ativar acessório Parafuso' })).toHaveAttribute('aria-checked', 'false')
  })

  it('clicar no switch abre um diálogo de confirmação com nome acessível, sem chamar a API ainda', async () => {
    const user = userEvent.setup()
    const update = vi.fn()
    mockAccessories([accessoryFixture({ is_active: true })], { update })
    renderPage('acessorios')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' }))

    const dialog = screen.getByRole('dialog', { name: 'Desativar acessório' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/Ímã 6x2/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Desativar' })).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('cancelar fecha o diálogo sem chamar a API', async () => {
    const user = userEvent.setup()
    const update = vi.fn()
    mockAccessories([accessoryFixture({ is_active: true })], { update })
    renderPage('acessorios')

    await user.click(screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('confirmar ativação chama update com { is_active: true } (só essa chave), exatamente uma vez', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ is_active: true }))
    mockAccessories([accessoryFixture({ is_active: false })], { update })
    renderPage('acessorios')

    await user.click(screen.getByRole('switch', { name: 'Ativar acessório Ímã 6x2' }))
    expect(screen.getByRole('dialog', { name: 'Ativar acessório' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ativar' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith('a1', { is_active: true })
    expect(Object.keys(update.mock.calls[0][1])).toEqual(['is_active'])
  })

  it('confirmar desativação chama update com { is_active: false } (só essa chave)', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ is_active: false }))
    mockAccessories([accessoryFixture({ is_active: true })], { update })
    renderPage('acessorios')

    await user.click(screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Desativar' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', { is_active: false }))
    expect(Object.keys(update.mock.calls[0][1])).toEqual(['is_active'])
  })

  it('ativar uma embalagem inativa chama update com { is_active: true }', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(packagingFixture({ is_active: true }))
    mockPackaging([packagingFixture({ is_active: false })], { update })
    renderPage('embalagens')

    await user.click(screen.getByRole('switch', { name: 'Ativar embalagem Caixa M' }))
    expect(screen.getByRole('dialog', { name: 'Ativar embalagem' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ativar' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('k1', { is_active: true }))
  })

  it('desativar uma embalagem ativa chama update com { is_active: false }', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(packagingFixture({ is_active: false }))
    mockPackaging([packagingFixture({ is_active: true })], { update })
    renderPage('embalagens')

    await user.click(screen.getByRole('switch', { name: 'Desativar embalagem Caixa M' }))
    await user.click(screen.getByRole('button', { name: 'Desativar' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('k1', { is_active: false }))
  })

  it('reativar um item previamente desativado funciona (ativação e desativação são simétricas)', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ is_active: true }))
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Parafuso', is_active: false })], { update })
    renderPage('acessorios')

    await user.click(screen.getByRole('switch', { name: 'Ativar acessório Parafuso' }))
    expect(screen.getByRole('dialog', { name: 'Ativar acessório' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ativar' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', { is_active: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toastMock.success).toHaveBeenCalledWith('Acessório ativado.')
  })

  it('sucesso mostra uma mensagem clara e fecha o diálogo', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ is_active: false }))
    mockAccessories([accessoryFixture({ is_active: true })], { update })
    renderPage('acessorios')

    await user.click(screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Desativar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toastMock.success).toHaveBeenCalledWith('Acessório desativado.')
  })

  it('impede confirmação duplicada: o botão de confirmar fica desabilitado e mostra estado de processamento', async () => {
    const user = userEvent.setup()
    let resolveUpdate: (value: Accessory) => void = () => {}
    const update = vi.fn(
      () =>
        new Promise<Accessory>((resolve) => {
          resolveUpdate = resolve
        }),
    )
    mockAccessories([accessoryFixture({ is_active: true })], { update })
    renderPage('acessorios')

    await user.click(screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Desativar' }))

    const processingButton = await screen.findByRole('button', { name: 'Desativando...' })
    expect(processingButton).toBeDisabled()
    expect(update).toHaveBeenCalledTimes(1)

    await user.click(processingButton)
    expect(update).toHaveBeenCalledTimes(1)

    resolveUpdate(accessoryFixture({ is_active: false }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('o switch do item fica desabilitado só durante a requisição de fato (depois de confirmar)', async () => {
    const user = userEvent.setup()
    let resolveUpdate: (value: Accessory) => void = () => {}
    const update = vi.fn(
      () =>
        new Promise<Accessory>((resolve) => {
          resolveUpdate = resolve
        }),
    )
    mockAccessories(
      [
        accessoryFixture({ id: 'a1', name: 'Ímã 6x2', is_active: true }),
        accessoryFixture({ id: 'a2', name: 'Parafuso', is_active: true }),
      ],
      { update },
    )
    renderPage('acessorios')

    const firstToggle = screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' })
    const secondToggle = screen.getByRole('switch', { name: 'Desativar acessório Parafuso' })
    await user.click(firstToggle)
    await user.click(screen.getByRole('button', { name: 'Desativar' }))

    expect(firstToggle).toHaveAttribute('aria-disabled', 'true')
    expect(secondToggle).not.toHaveAttribute('aria-disabled', 'true')

    resolveUpdate(accessoryFixture({ is_active: false }))
    await waitFor(() => expect(firstToggle).not.toHaveAttribute('aria-disabled', 'true'))
  })

  it('erro na mutation mantém o diálogo aberto e funcional, com mensagem clara (nunca toast)', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockRejectedValue(new ApiError('database', 500, 'Falha ao atualizar acessório.'))
    mockAccessories([accessoryFixture({ is_active: true })], { update })
    renderPage('acessorios')

    await user.click(screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Desativar' }))

    expect(await screen.findByText('Falha ao atualizar acessório.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()

    // O diálogo continua funcional: cancelar ainda fecha normalmente.
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ativar/desativar não limpa a busca ativa', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ is_active: false }))
    mockAccessories(
      [
        accessoryFixture({ id: 'a1', name: 'Ímã 6x2', is_active: true }),
        accessoryFixture({ id: 'a2', name: 'Parafuso', is_active: true }),
      ],
      { update },
    )
    renderPage('acessorios')

    const searchInput = screen.getByRole('combobox', { name: 'Buscar acessórios' })
    await user.type(searchInput, 'Ímã')

    await user.click(screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(update).toHaveBeenCalled())

    expect(searchInput).toHaveValue('Ímã')
  })

  it('desativar um acessório NUNCA o esconde da listagem (sem filtro de status, ele continua visível, agora inativo)', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a1', name: 'Ímã 6x2', is_active: false }))
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', is_active: true })], { update })
    const { rerender } = renderPage('acessorios')

    await user.click(screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', { is_active: false }))

    // Simula a substituição do array local que o hook real faria.
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', is_active: false })], { update })
    rerender(<InventoryPage area="acessorios" />)

    // Continua na listagem — só o Switch reflete a inatividade.
    expect(within(getTableBody()).getByText('Ímã 6x2')).toBeInTheDocument()
    expect(
      within(getTableBody()).getByRole('switch', { name: 'Ativar acessório Ímã 6x2' }),
    ).toHaveAttribute('aria-checked', 'false')
  })

  it('nome acessível do switch identifica a ação e o item; switch e diálogo são operáveis por teclado', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ is_active: false }))
    mockAccessories([accessoryFixture({ is_active: true })], { update })
    renderPage('acessorios')

    const toggle = screen.getByRole('switch', { name: 'Desativar acessório Ímã 6x2' })
    toggle.focus()
    expect(toggle).toHaveFocus()

    await user.keyboard(' ')
    expect(screen.getByRole('dialog', { name: 'Desativar acessório' })).toBeInTheDocument()

    const confirmButton = screen.getByRole('button', { name: 'Desativar' })
    confirmButton.focus()
    expect(confirmButton).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', { is_active: false }))
  })
})

// Exclusão física segura — o backend (delete_accessory/delete_packaging,
// Edge Functions accessories/packaging) já bloqueia com 409 quando há
// vínculo em product_accessories/product_packaging, nunca cascateia, e
// devolve uma mensagem que já orienta desativar em vez de excluir; aqui
// cobrimos só a integração com a página (abrir confirmação, cancelar sem
// chamar a API, confirmar chama uma vez, sucesso remove a linha e fecha o
// diálogo, bloqueio mantém o item e a tela funcional, acessibilidade,
// independência entre Acessórios e Embalagens).
describe('InventoryPage — exclusão física segura', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('botão "Excluir" abre um diálogo de confirmação com nome acessível, informando o item e que é permanente', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Excluir acessório Ímã 6x2' }))

    const dialog = screen.getByRole('dialog', { name: 'Excluir acessório' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/Ímã 6x2/)).toBeInTheDocument()
    expect(within(dialog).getByText(/permanente/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Excluir definitivamente' })).toBeInTheDocument()
  })

  it('cancelar fecha o diálogo sem chamar a API de exclusão', async () => {
    const user = userEvent.setup()
    const deleteFn = vi.fn()
    mockAccessories([accessoryFixture()], { delete: deleteFn })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Excluir acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('confirmar chama a exclusão exatamente uma vez com o id correto', async () => {
    const user = userEvent.setup()
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    mockAccessories([accessoryFixture()], { delete: deleteFn })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Excluir acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    await waitFor(() => expect(deleteFn).toHaveBeenCalledTimes(1))
    expect(deleteFn).toHaveBeenCalledWith('a1')
  })

  it('sucesso fecha o diálogo, mostra um toast de confirmação e preserva a busca ativa', async () => {
    const user = userEvent.setup()
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' }), accessoryFixture({ id: 'a2', name: 'Parafuso' })], {
      delete: deleteFn,
    })
    renderPage('acessorios')

    const searchInput = screen.getByRole('combobox', { name: 'Buscar acessórios' })
    await user.type(searchInput, 'Parafuso')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Excluir acessório Parafuso' }))
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toastMock.success).toHaveBeenCalledWith('Acessório excluído.')
    expect(searchInput).toHaveValue('Parafuso')
  })

  it('sucesso remove apenas a linha excluída, preservando as demais', async () => {
    const user = userEvent.setup()
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' }), accessoryFixture({ id: 'a2', name: 'Parafuso' })], {
      delete: deleteFn,
    })
    const { rerender } = renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Excluir acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))
    await waitFor(() => expect(deleteFn).toHaveBeenCalledWith('a1'))

    // O hook real removeria só o item excluído do array local — como o
    // hook está mockado neste teste de página, simulamos essa substituição
    // remockando o retorno e forçando um novo render.
    mockAccessories([accessoryFixture({ id: 'a2', name: 'Parafuso' })], { delete: deleteFn })
    rerender(<InventoryPage area="acessorios" />)

    expect(within(getTableBody()).queryByText('Ímã 6x2')).not.toBeInTheDocument()
    expect(within(getTableBody()).getByText('Parafuso')).toBeInTheDocument()
  })

  it('impede confirmação duplicada: o botão fica desabilitado e mostra estado de processamento durante a exclusão', async () => {
    const user = userEvent.setup()
    let resolveDelete: () => void = () => {}
    const deleteFn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve
        }),
    )
    mockAccessories([accessoryFixture()], { delete: deleteFn })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Excluir acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    const processingButton = await screen.findByRole('button', { name: 'Excluindo...' })
    expect(processingButton).toBeDisabled()
    expect(deleteFn).toHaveBeenCalledTimes(1)

    await user.click(processingButton)
    expect(deleteFn).toHaveBeenCalledTimes(1)

    resolveDelete()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('item vinculado a produto (bloqueio 409) permanece na lista, mantém o diálogo funcional e orienta desativar', async () => {
    const user = userEvent.setup()
    const deleteFn = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'business_rule',
          409,
          'Este acessório está vinculado a um produto e não pode ser excluído. Desative o item.',
        ),
      )
    mockAccessories([accessoryFixture()], { delete: deleteFn })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Excluir acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    expect(
      await screen.findByText('Este acessório está vinculado a um produto e não pode ser excluído. Desative o item.'),
    ).toBeInTheDocument()
    // O diálogo continua aberto e funcional — o item nunca some da tabela.
    // Nota: enquanto o diálogo está aberto, o restante da página fica
    // aria-hidden (padrão de modal acessível) — screen.getByText ainda
    // encontra o texto (não filtra por aria-hidden como getByRole faz),
    // então usamos texto simples aqui em vez de getTableBody()/getByRole.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Ímã 6x2')).toBeInTheDocument()
    expect(toastMock.error).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(getTableBody()).getByText('Ímã 6x2')).toBeInTheDocument()
  })

  // Módulo 3, Incremento 1 (migration 20260827093000_update_accessory_
  // packaging_delete_guards.sql): delete_accessory agora também bloqueia
  // por histórico de movimentação de estoque, além do bloqueio já existente
  // por vínculo a produto — mesmo contrato de erro (business_rule/409), a
  // mensagem chega ao frontend já sem o marcador ACCESSORY_HAS_STOCK_HISTORY:
  // (removido por _shared/errors.ts no backend).
  it('item de acessório com histórico de movimentação de estoque (bloqueio 409) permanece na lista e orienta desativar', async () => {
    const user = userEvent.setup()
    const deleteFn = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'business_rule',
          409,
          'Este acessório já teve movimentação de estoque registrada e não pode ser excluído. Desative o item.',
        ),
      )
    mockAccessories([accessoryFixture()], { delete: deleteFn })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Excluir acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    expect(
      await screen.findByText('Este acessório já teve movimentação de estoque registrada e não pode ser excluído. Desative o item.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Ímã 6x2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(within(getTableBody()).getByText('Ímã 6x2')).toBeInTheDocument()
  })

  it('erro inesperado na exclusão mantém o item e a tela funcional, com mensagem clara', async () => {
    const user = userEvent.setup()
    const deleteFn = vi.fn().mockRejectedValue(new ApiError('database', 500, 'Falha ao excluir acessório.'))
    mockAccessories([accessoryFixture()], { delete: deleteFn })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Excluir acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    expect(await screen.findByText('Falha ao excluir acessório.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Ímã 6x2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(within(getTableBody()).getByText('Ímã 6x2')).toBeInTheDocument()
  })

  it('o diálogo é operável por teclado e mantém foco visível (foco em "Cancelar" + Enter fecha)', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Excluir acessório Ímã 6x2' }))
    const cancelButton = screen.getByRole('button', { name: 'Cancelar' })
    cancelButton.focus()
    expect(cancelButton).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('excluir uma embalagem chama a API própria de embalagens, independente de acessórios', async () => {
    const user = userEvent.setup()
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    mockPackaging([packagingFixture()], { delete: deleteFn })
    renderPage('embalagens')

    await user.click(screen.getByRole('button', { name: 'Excluir embalagem Caixa M' }))
    expect(screen.getByRole('dialog', { name: 'Excluir embalagem' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    await waitFor(() => expect(deleteFn).toHaveBeenCalledWith('k1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toastMock.success).toHaveBeenCalledWith('Embalagem excluída.')
  })

  it('item de embalagem vinculado a produto (bloqueio 409) permanece na lista e orienta desativar', async () => {
    const user = userEvent.setup()
    const deleteFn = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'business_rule',
          409,
          'Esta embalagem está vinculada a um produto e não pode ser excluída. Desative o item.',
        ),
      )
    mockPackaging([packagingFixture()], { delete: deleteFn })
    renderPage('embalagens')

    await user.click(screen.getByRole('button', { name: 'Excluir embalagem Caixa M' }))
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    expect(
      await screen.findByText('Esta embalagem está vinculada a um produto e não pode ser excluída. Desative o item.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Caixa M')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(within(getTableBody()).getByText('Caixa M')).toBeInTheDocument()
  })

  it('item de embalagem com histórico de movimentação de estoque (bloqueio 409) permanece na lista e orienta desativar', async () => {
    const user = userEvent.setup()
    const deleteFn = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'business_rule',
          409,
          'Esta embalagem já teve movimentação de estoque registrada e não pode ser excluída. Desative o item.',
        ),
      )
    mockPackaging([packagingFixture()], { delete: deleteFn })
    renderPage('embalagens')

    await user.click(screen.getByRole('button', { name: 'Excluir embalagem Caixa M' }))
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    expect(
      await screen.findByText('Esta embalagem já teve movimentação de estoque registrada e não pode ser excluída. Desative o item.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Caixa M')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(within(getTableBody()).getByText('Caixa M')).toBeInTheDocument()
  })

  it('cancelar a exclusão de um item não afeta o estado de busca/filtro da outra área (independência)', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' })])
    const { unmount } = renderPage('acessorios')
    await user.click(screen.getByRole('button', { name: 'Excluir acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    unmount()

    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M' })])
    renderPage('embalagens')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(getTableBody()).getByText('Caixa M')).toBeInTheDocument()
  })
})

// =============================================================================
// Módulo 3, Incremento 2 — coluna "Saldo atual", situação de estoque e
// painel "Movimentar estoque" (StockMovementPanel, via useStockMovements
// mockado no topo do arquivo).
// =============================================================================

describe('InventoryPage — coluna Saldo atual e situação de estoque', () => {
  it('exibe o saldo atual numérico na coluna correspondente', () => {
    mockAccessories([accessoryFixture({ current_stock: 42 })])
    renderPage('acessorios')
    expect(within(getTableBody()).getByText('42')).toBeInTheDocument()
  })

  it('saldo zero mostra o badge "Sem estoque"', () => {
    mockAccessories([accessoryFixture({ current_stock: 0, minimum_stock: 5 })])
    renderPage('acessorios')
    expect(screen.getByText('Sem estoque')).toBeInTheDocument()
  })

  it('estoque baixo (minimum_stock > 0 e current_stock <= minimum_stock) mostra o badge "Estoque baixo"', () => {
    mockAccessories([accessoryFixture({ current_stock: 3, minimum_stock: 5 })])
    renderPage('acessorios')
    expect(screen.getByText('Estoque baixo')).toBeInTheDocument()
  })

  it('current_stock igual a minimum_stock também conta como "Estoque baixo" (<=, não <)', () => {
    mockAccessories([accessoryFixture({ current_stock: 5, minimum_stock: 5 })])
    renderPage('acessorios')
    expect(screen.getByText('Estoque baixo')).toBeInTheDocument()
  })

  it('saldo acima do mínimo mostra "Estoque normal"', () => {
    mockAccessories([accessoryFixture({ current_stock: 20, minimum_stock: 5 })])
    renderPage('acessorios')
    expect(screen.getByText('Estoque normal')).toBeInTheDocument()
  })

  it('estoque mínimo null nunca produz "Estoque baixo", mesmo com saldo pequeno', () => {
    mockAccessories([accessoryFixture({ current_stock: 1, minimum_stock: null })])
    renderPage('acessorios')
    expect(screen.getByText('Estoque normal')).toBeInTheDocument()
    expect(screen.queryByText('Estoque baixo')).not.toBeInTheDocument()
  })

  it('estoque mínimo zero nunca produz "Estoque baixo" (0 = sem limiar definido, não "qualquer saldo é baixo")', () => {
    mockAccessories([accessoryFixture({ current_stock: 1, minimum_stock: 0 })])
    renderPage('acessorios')
    expect(screen.getByText('Estoque normal')).toBeInTheDocument()
  })

  it('permite ordenar a listagem por Saldo atual', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Baixo saldo', current_stock: 2 }),
      accessoryFixture({ id: 'a2', name: 'Alto saldo', current_stock: 50 }),
    ])
    renderPage('acessorios')

    await applySort(user, 'Saldo atual', 'Ordenar crescente')
    expect(getVisibleNamesInOrder()).toEqual(['Baixo saldo', 'Alto saldo'])

    await applySort(user, 'Saldo atual', 'Ordenar decrescente')
    expect(getVisibleNamesInOrder()).toEqual(['Alto saldo', 'Baixo saldo'])
  })
})

describe('InventoryPage — painel "Movimentar estoque" (StockMovementPanel)', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    useStockMovementsMock.mockReturnValue({
      movements: [],
      isLoading: false,
      loadError: null,
      refetch: vi.fn(),
      isRegistering: false,
      register: vi.fn().mockResolvedValue({
        id: 'm1',
        item_type: 'ACCESSORY',
        item_id: 'a1',
        movement_type: 'PURCHASE',
        quantity_delta: 10,
        balance_before: 0,
        balance_after: 10,
        reason: null,
        reference_type: null,
        reference_id: null,
        idempotency_key: 'key-1',
        occurred_at: '2026-08-27T12:00:00Z',
        created_by: 'u1',
        created_at: '2026-08-27T12:00:00Z',
      }),
    })
  })

  it('um único botão "Movimentar estoque" por linha abre o painel', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ current_stock: 10 })])
    renderPage('acessorios')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Movimentar estoque — acessório Ímã 6x2' }))

    const dialog = screen.getByRole('dialog', { name: 'Movimentar estoque' })
    expect(dialog).toBeInTheDocument()
    // "Ímã 6x2" aparece duas vezes dentro do diálogo (DialogDescription +
    // resumo do próprio StockMovementPanel) — nunca ambíguo para o usuário
    // (são duas exibições legítimas do mesmo nome), mas exige getAllByText
    // aqui em vez de getByText.
    expect(within(dialog).getAllByText('Ímã 6x2').length).toBeGreaterThanOrEqual(1)
  })

  it('o painel mostra o resumo correto: categoria, saldo atual e estoque mínimo', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ current_stock: 15, minimum_stock: 5 })])
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Movimentar estoque — acessório Ímã 6x2' }))

    const dialog = screen.getByRole('dialog', { name: 'Movimentar estoque' })
    expect(within(dialog).getByText('Acessório')).toBeInTheDocument()
    expect(within(dialog).getByText('15')).toBeInTheDocument()
    expect(within(dialog).getByText('5')).toBeInTheDocument()
  })

  it('embalagens abrem o painel com itemType/categoria corretos (independência entre áreas)', async () => {
    const user = userEvent.setup()
    mockPackaging([packagingFixture({ current_stock: 8 })])
    renderPage('embalagens')

    await user.click(screen.getByRole('button', { name: 'Movimentar estoque — embalagem Caixa M' }))

    const dialog = screen.getByRole('dialog', { name: 'Movimentar estoque' })
    expect(within(dialog).getByText('Embalagem')).toBeInTheDocument()
  })

  it('registrar uma movimentação com sucesso: toast, atualização local do saldo (setLocalStock) e fechamento do painel', async () => {
    const setLocalStock = vi.fn()
    mockAccessories([accessoryFixture({ id: 'a1', current_stock: 0 })], { setLocalStock })
    const user = userEvent.setup()
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Movimentar estoque — acessório Ímã 6x2' }))
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    await user.click(screen.getByRole('radio', { name: 'Compra' }))
    await user.type(screen.getByLabelText('Quantidade'), '10')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toastMock.success).toHaveBeenCalledWith('Movimentação registrada.')
    expect(setLocalStock).toHaveBeenCalledWith('a1', 10)
  })

  it('erro real do backend mantém o painel aberto com a mensagem exibida', async () => {
    useStockMovementsMock.mockReturnValue({
      movements: [],
      isLoading: false,
      loadError: null,
      refetch: vi.fn(),
      isRegistering: false,
      register: vi.fn().mockRejectedValue(new ApiError('business_rule', 409, 'saldo insuficiente para esta operação')),
    })
    mockAccessories([accessoryFixture({ current_stock: 2 })])
    const user = userEvent.setup()
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Movimentar estoque — acessório Ímã 6x2' }))
    await user.click(screen.getByRole('radio', { name: 'Saída' }))
    await user.click(screen.getByRole('radio', { name: 'Uso interno' }))
    await user.type(screen.getByLabelText('Quantidade'), '1')
    await user.type(screen.getByLabelText(/motivo\/observação/i), 'teste')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    expect(await screen.findByText('saldo insuficiente para esta operação')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('item inativo: painel abre normalmente e sinaliza "Inativo"', async () => {
    const user = userEvent.setup()
    mockAccessories([accessoryFixture({ is_active: false })])
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Movimentar estoque — acessório Ímã 6x2' }))
    const dialog = screen.getByRole('dialog', { name: 'Movimentar estoque' })
    expect(within(dialog).getByText('Inativo')).toBeInTheDocument()
    expect(within(dialog).getByRole('radiogroup', { name: 'Movimentação' })).toBeInTheDocument()
  })

  it('histórico carregando é exibido dentro do painel', async () => {
    useStockMovementsMock.mockReturnValue({
      movements: [],
      isLoading: true,
      loadError: null,
      refetch: vi.fn(),
      isRegistering: false,
      register: vi.fn(),
    })
    const user = userEvent.setup()
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Movimentar estoque — acessório Ímã 6x2' }))
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('fechar o painel sem salvar (Cancelar) não chama register nem setLocalStock', async () => {
    const register = vi.fn()
    const setLocalStock = vi.fn()
    useStockMovementsMock.mockReturnValue({
      movements: [],
      isLoading: false,
      loadError: null,
      refetch: vi.fn(),
      isRegistering: false,
      register,
    })
    mockAccessories([accessoryFixture()], { setLocalStock })
    const user = userEvent.setup()
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Movimentar estoque — acessório Ímã 6x2' }))
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
    expect(setLocalStock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Módulo 3, Incremento 5 (Compras) — botão "Compras" compartilhado pelo
// InventoryPageShell, presente nas áreas Acessórios e Embalagens (a terceira
// área, Filamentos, é coberta por FilamentsInventoryPage.test.tsx). O
// diálogo em si (campos/validação/submissão por categoria) é coberto
// integralmente por PurchaseDialog.test.tsx — aqui só confirmamos que o
// botão aparece (nunca duplicado) em cada área e abre o mesmo diálogo.
// ---------------------------------------------------------------------------

describe('InventoryPage — botão "Compras" (Módulo 3, Incremento 5)', () => {
  it('o botão "Compras" aparece na área Acessórios e abre "Registrar compra"', async () => {
    mockAccessories([accessoryFixture()])
    mockPackaging([packagingFixture()])
    const user = userEvent.setup()
    renderPage('acessorios')

    const buttons = screen.getAllByRole('button', { name: 'Compras' })
    expect(buttons).toHaveLength(1)
    await user.click(buttons[0])
    expect(screen.getByRole('dialog', { name: 'Registrar compra' })).toBeInTheDocument()
  })

  it('o botão "Compras" aparece na área Embalagens e abre "Registrar compra"', async () => {
    mockAccessories([accessoryFixture()])
    mockPackaging([packagingFixture()])
    const user = userEvent.setup()
    renderPage('embalagens')

    const buttons = screen.getAllByRole('button', { name: 'Compras' })
    expect(buttons).toHaveLength(1)
    await user.click(buttons[0])
    expect(screen.getByRole('dialog', { name: 'Registrar compra' })).toBeInTheDocument()
  })
})

// Padronização das listagens (tipografia compacta, colunas redimensionáveis
// e persistidas). Sem coluna de data em Acessórios/Embalagens. A cobertura
// genérica da infraestrutura compartilhada mora em columnWidths.test.ts/
// usePersistentColumnWidths.test.ts/ColumnResizeHandle.test.tsx — aqui só
// confirma que InventoryAreaPanel (compartilhado pelas duas áreas) conecta
// tudo isso corretamente, com isolamento entre Acessórios e Embalagens
// (mesmo componente, tableId diferente).
describe('InventoryPage — colunas redimensionáveis e persistidas (padronização das listagens)', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('fonte compacta: a tabela usa a classe compartilhada de tipografia compacta (13.6px)', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')
    expect(screen.getByRole('table')).toHaveClass('text-[13.6px]')
  })

  it('presença das alças: cabeçalhos ordenáveis e o cabeçalho de Ações têm separador de redimensionamento', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')
    expect(screen.getByRole('separator', { name: 'Redimensionar coluna Acessório' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Redimensionar coluna Ações' })).toBeInTheDocument()
  })

  it('identificadores de coluna: 8 colunas viram 8 <col> no colgroup', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')
    expect(document.querySelectorAll('col')).toHaveLength(8)
  })

  it('a coluna Ações nunca pode ser reduzida abaixo do mínimo necessário para "Editar" + "Movimentar estoque" + "Excluir" (300px)', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')
    const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Ações' })

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: -9999, pointerId: 1 })

    const actionsCol = document.querySelectorAll('col')[7] as HTMLElement
    expect(Number.parseInt(actionsCol.style.width, 10)).toBe(300)
  })

  it('redimensionar uma coluna por teclado altera só aquela coluna, nunca as demais', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')
    const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Acessório' })
    const otherWidthBefore = (document.querySelectorAll('col')[1] as HTMLElement).style.width

    handle.focus()
    fireEvent.keyDown(handle, { key: 'ArrowRight' })

    expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('185px')
    expect((document.querySelectorAll('col')[1] as HTMLElement).style.width).toBe(otherWidthBefore)
  })

  it('largura salva é restaurada após remontar a página', () => {
    mockAccessories([accessoryFixture()])
    const { unmount } = renderPage('acessorios')
    const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Acessório' })

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 160, pointerId: 1 })
    unmount()

    renderPage('acessorios')
    expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('235px')
  })

  it('"Restaurar larguras" volta a coluna redimensionada ao padrão desta tabela', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')
    const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Acessório' })
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 160, pointerId: 1 })
    expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('235px')

    fireEvent.click(screen.getByRole('button', { name: 'Restaurar larguras' }))

    expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('175px')
  })

  it('isolamento: largura salva em Acessórios nunca afeta Embalagens (mesmo componente, tableId diferente)', () => {
    mockAccessories([accessoryFixture()])
    const { unmount } = renderPage('acessorios')
    const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Acessório' })
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 160, pointerId: 1 })
    expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('235px')
    unmount()

    mockPackaging([packagingFixture()])
    renderPage('embalagens')
    expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('175px')
  })

  it('rolagem horizontal disponível: a tabela continua dentro de um contêiner overflow-x-auto', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')
    const scrollContainer = screen.getByRole('table').closest('.overflow-x-auto')
    expect(scrollContainer).toBeInTheDocument()
  })

  it('regressão: as ações "Editar", "Movimentar estoque" e "Excluir" continuam em uma única linha, sem quebra', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')
    const actionsCell = within(getTable()).getByRole('button', { name: 'Editar' }).closest('div')
    expect(actionsCell).toHaveClass('flex-nowrap')
    expect(actionsCell).not.toHaveClass('flex-wrap')
    expect(within(getTable()).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(
      within(getTable()).getByRole('button', { name: /^Movimentar estoque/ }),
    ).toBeInTheDocument()
    expect(within(getTable()).getByRole('button', { name: /^Excluir/ })).toBeInTheDocument()
  })

  it('regressão: busca e ordenação continuam funcionando após o redimensionamento', async () => {
    mockAccessories([accessoryFixture()])
    const user = userEvent.setup()
    renderPage('acessorios')

    await applySort(user, 'Acessório', 'Ordenar crescente')
    expect(within(getTableBody()).getByText('Ímã 6x2')).toBeInTheDocument()
  })
})
