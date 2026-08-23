import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'
import type { Accessory, Packaging } from '@/types/domain'

const { useAccessoriesMock, usePackagingMock, useAuthMock, toastMock } = vi.hoisted(() => ({
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
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
  overrides: Partial<{ isLoading: boolean; error: unknown; refetch: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }> = {},
) {
  useAccessoriesMock.mockReturnValue({
    accessories: list,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    create: overrides.create ?? vi.fn().mockResolvedValue(accessoryFixture()),
  })
}

function mockPackaging(
  list: Packaging[],
  overrides: Partial<{ isLoading: boolean; error: unknown; refetch: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }> = {},
) {
  usePackagingMock.mockReturnValue({
    packaging: list,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    create: overrides.create ?? vi.fn().mockResolvedValue(packagingFixture()),
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

// "Ativo" aparece tanto no cabeçalho da coluna quanto no badge de status —
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
    expect(screen.getByText(/cadastros mestre de acessórios e embalagens/i)).toBeInTheDocument()
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

  it('renderiza as 6 colunas esperadas', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    for (const label of ['Nome', 'Tamanho', 'Variante', 'Custo', 'Estoque mínimo', 'Ativo']) {
      expect(screen.getByRole('button', { name: `Ordenar coluna ${label}` })).toBeInTheDocument()
    }
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

  it('Ativo é só informativo (badge de texto), sem Switch nem ações de editar/excluir', () => {
    mockAccessories([accessoryFixture({ is_active: true }), accessoryFixture({ id: 'a2', name: 'Parafuso', is_active: false })])
    renderPage('acessorios')

    expect(within(getTableBody()).getByText('Ativo')).toBeInTheDocument()
    expect(within(getTableBody()).getByText('Inativo')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /excluir/i })).not.toBeInTheDocument()
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

  it('filtros Todos/Ativos/Inativos filtram corretamente', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã ativo', is_active: true }),
      accessoryFixture({ id: 'a2', name: 'Ímã inativo', is_active: false }),
    ])
    renderPage('acessorios')

    const filterGroup = screen.getByRole('radiogroup', { name: 'Filtrar acessórios por status' })
    expect(within(filterGroup).getByRole('radio', { name: 'Todos' })).toHaveAttribute('aria-checked', 'true')

    await user.click(within(filterGroup).getByRole('radio', { name: 'Ativos' }))
    expect(within(getTable()).getByText('Ímã ativo')).toBeInTheDocument()
    expect(within(getTable()).queryByText('Ímã inativo')).not.toBeInTheDocument()

    await user.click(within(filterGroup).getByRole('radio', { name: 'Inativos' }))
    expect(within(getTable()).getByText('Ímã inativo')).toBeInTheDocument()
    expect(within(getTable()).queryByText('Ímã ativo')).not.toBeInTheDocument()
  })

  it('busca e filtro combinam com AND lógico (só sobra o item que atende às duas condições)', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã ativo', is_active: true }),
      accessoryFixture({ id: 'a2', name: 'Ímã inativo', is_active: false }),
      accessoryFixture({ id: 'a3', name: 'Parafuso ativo', is_active: true }),
    ])
    renderPage('acessorios')

    await user.type(screen.getByRole('combobox', { name: 'Buscar acessórios' }), 'Ímã')
    await user.click(screen.getByRole('radio', { name: 'Ativos' }))

    // Só "Ímã ativo" atende busca ("Ímã") + filtro (Ativos) ao mesmo tempo —
    // "Ímã inativo" cai pelo filtro, "Parafuso ativo" cai pela busca.
    expect(within(getTable()).getByText('Ímã ativo')).toBeInTheDocument()
    expect(within(getTable()).queryByText('Ímã inativo')).not.toBeInTheDocument()
    expect(within(getTable()).queryByText('Parafuso ativo')).not.toBeInTheDocument()
  })

  it('o filtro de status é operável por teclado (foco + Enter)', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã ativo', is_active: true }),
      accessoryFixture({ id: 'a2', name: 'Ímã inativo', is_active: false }),
    ])
    renderPage('acessorios')

    const activeRadio = screen.getByRole('radio', { name: 'Ativos' })
    activeRadio.focus()
    await user.keyboard('{Enter}')

    expect(activeRadio).toHaveAttribute('aria-checked', 'true')
    expect(within(getTable()).queryByText('Ímã inativo')).not.toBeInTheDocument()
  })

  it('ordenação por Nome alterna crescente e decrescente sem mutar os dados originais', async () => {
    const user = userEvent.setup()
    const list = [
      accessoryFixture({ id: 'a1', name: 'Zebra' }),
      accessoryFixture({ id: 'a2', name: 'Abelha' }),
    ]
    mockAccessories(list)
    renderPage('acessorios')

    await applySort(user, 'Nome', 'Ordenar crescente')
    expect(getVisibleNamesInOrder()).toEqual(['Abelha', 'Zebra'])

    await applySort(user, 'Nome', 'Ordenar decrescente')
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

  it('botão "Limpar filtros" só aparece com filtro de status ativo e restaura "Todos"', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã ativo', is_active: true }),
      accessoryFixture({ id: 'a2', name: 'Ímã inativo', is_active: false }),
    ])
    renderPage('acessorios')

    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Ativos' }))
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))

    expect(screen.getByRole('radio', { name: 'Todos' })).toHaveAttribute('aria-checked', 'true')
    expect(within(getTable()).getByText('Ímã inativo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument()
  })

  it('ordenação por Custo trata valores nulos de forma determinística (sempre ao final)', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Sem custo', unit_cost: null }),
      accessoryFixture({ id: 'a2', name: 'Custo baixo', unit_cost: 1 }),
      accessoryFixture({ id: 'a3', name: 'Custo alto', unit_cost: 9 }),
    ])
    renderPage('acessorios')

    await applySort(user, 'Custo', 'Ordenar crescente')
    expect(getVisibleNamesInOrder()).toEqual(['Custo baixo', 'Custo alto', 'Sem custo'])

    await applySort(user, 'Custo', 'Ordenar decrescente')
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

  it('busca e filtro de Acessórios e Embalagens são independentes entre si', async () => {
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

    await user.click(within(filterGroup).getByRole('radio', { name: 'Ativos' }))
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

  it('Ativo é só um badge informativo: sem coluna Ações, sem checkbox de seleção, sem botões de editar/ativar/desativar/excluir', () => {
    mockPackaging([
      packagingFixture({ id: 'k1', is_active: true }),
      packagingFixture({ id: 'k2', name: 'Sacola Kraft', is_active: false }),
    ])
    renderPage('embalagens')

    expect(within(getTableBody()).getByText('Ativo')).toBeInTheDocument()
    expect(within(getTableBody()).getByText('Inativo')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /ações/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^ativar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /desativar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /excluir/i })).not.toBeInTheDocument()
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
