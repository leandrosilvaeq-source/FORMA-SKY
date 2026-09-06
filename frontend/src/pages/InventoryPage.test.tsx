import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'
import type { Accessory, Packaging } from '@/types/domain'

const {
  useAccessoriesMock,
  usePackagingMock,
  useStockMovementsMock,
  useAuthMock,
  toastMock,
  getAccessoryCurrentStockMock,
  uploadEntityImageMock,
  removeEntityImageMock,
  signEntityImageUrlsMock,
  purgeEntityImagesMock,
} = vi.hoisted(() => ({
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  useStockMovementsMock: vi.fn(),
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  getAccessoryCurrentStockMock: vi.fn(),
  uploadEntityImageMock: vi.fn(),
  removeEntityImageMock: vi.fn(),
  signEntityImageUrlsMock: vi.fn(),
  purgeEntityImagesMock: vi.fn(),
}))

// Par "processado" fictício emitido pelo test double de EntityImageUploadField
// (o processamento real de canvas/WebP tem sua própria suíte —
// processEntityImage.test.ts / EntityImageUploadField.test.tsx).
const FAKE_PROCESSED = {
  original: new Blob(['o'], { type: 'image/webp' }),
  originalWidth: 1600,
  originalHeight: 900,
  thumb: new Blob(['t'], { type: 'image/webp' }),
  thumbWidth: 320,
  thumbHeight: 180,
  sourceWidth: 4000,
  sourceHeight: 2250,
}

vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
// Só getAccessoryCurrentStock é mockado — a releitura pré-envio do ajuste
// por quantidade absoluta (AccessoryStockAdjustDialog). O resto do módulo
// não é usado por InventoryPage (o hook useAccessories, totalmente mockado,
// cobre create/update/delete).
vi.mock('@/lib/api/accessories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/accessories')>()
  return { ...actual, getAccessoryCurrentStock: getAccessoryCurrentStockMock }
})
// StockMovementPanel (Módulo 3, Incremento 2) usa useStockMovements
// internamente — mockado aqui para que abrir "Movimentar estoque" nesta
// suíte nunca dependa de rede real. Default: histórico vazio, sem
// carregamento/erro — cada teste que precisa de outro cenário sobrescreve
// via useStockMovementsMock.mockReturnValue(...).
vi.mock('@/hooks/useStockMovements', () => ({ useStockMovements: useStockMovementsMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('sonner', () => ({ toast: toastMock }))

// Infraestrutura de foto principal (2026-09-06). A API é mockada; o campo de
// upload vira um test double leve com dois botões — a orquestração
// (criar-depois-enviar, substituir, remover, sem F5) é o que esta suíte
// exercita, não o processamento de imagem em si.
vi.mock('@/lib/api/entityImages', () => ({
  uploadEntityImage: uploadEntityImageMock,
  removeEntityImage: removeEntityImageMock,
  signEntityImageUrls: signEntityImageUrlsMock,
  purgeEntityImages: purgeEntityImagesMock,
}))
vi.mock('@/components/inventory/EntityImageUploadField', () => ({
  EntityImageUploadField: ({
    savedPreviewUrl,
    isUploading,
    disabled,
    onImageSelected,
    onImageRemoved,
  }: {
    savedPreviewUrl?: string | null
    isUploading?: boolean
    disabled?: boolean
    onImageSelected: (p: typeof FAKE_PROCESSED) => void
    onImageRemoved: () => void
  }) => (
    <div data-testid="entity-image-upload-field">
      {savedPreviewUrl ? <img src={savedPreviewUrl} alt="Prévia da foto de referência" /> : null}
      {isUploading ? <span>Enviando foto...</span> : null}
      <button type="button" disabled={disabled} onClick={() => onImageSelected(FAKE_PROCESSED)}>
        Escolher foto (teste)
      </button>
      <button type="button" disabled={disabled} onClick={() => onImageRemoved()}>
        Remover foto (teste)
      </button>
    </div>
  ),
}))

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
    setLocalImage: ReturnType<typeof vi.fn>
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
    setLocalImage: overrides.setLocalImage ?? vi.fn(),
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

// Acessórios (2026-09-06): "Editar" / "Ativar-Desativar" / "Excluir" vivem
// dentro do menu de três pontos de cada linha. Abre pelo nome acessível do
// gatilho e clica o item pedido.
async function clickAccessoryRowAction(
  user: ReturnType<typeof userEvent.setup>,
  accessoryName: string,
  action: 'Editar' | 'Ativar' | 'Desativar' | 'Excluir',
): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Mais ações — acessório ${accessoryName}` }))
  await user.click(await screen.findByRole('menuitem', { name: action }))
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

  it('Acessórios: colunas na ordem Acessório · Tamanho · Variante · Estoque mínimo · Disponível · Custo unitário · Ações (sem "Ativo")', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    const headerRow = within(getTable()).getAllByRole('row')[0]
    const headerLabels = within(headerRow)
      .getAllByRole('columnheader')
      .map((th) => (th.textContent ?? '').replace(/Redimensionar coluna.*/i, '').trim())
    expect(headerLabels).toEqual([
      'Acessório',
      'Tamanho',
      'Variante',
      'Estoque mínimo',
      'Disponível',
      'Custo unitário',
      'Ações', // Acessórios: "Ações" agora é VISÍVEL no cabeçalho (não sr-only)
    ])
    expect(screen.getByRole('separator', { name: 'Redimensionar coluna Ações' })).toBeInTheDocument()

    // as 6 colunas de dados são ordenáveis pelos rótulos novos
    for (const label of ['Acessório', 'Tamanho', 'Variante', 'Estoque mínimo', 'Disponível', 'Custo unitário']) {
      expect(screen.getByRole('button', { name: `Ordenar coluna ${label}` })).toBeInTheDocument()
    }
    // os rótulos antigos não aparecem mais como coluna
    expect(screen.queryByRole('button', { name: 'Ordenar coluna Nome' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ordenar coluna Custo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ordenar coluna Custo/un.' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ordenar coluna Saldo atual' })).not.toBeInTheDocument()
    // a coluna "Ativo" foi ocultada só em Acessórios
    expect(screen.queryByRole('button', { name: 'Ordenar coluna Ativo' })).not.toBeInTheDocument()
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

  it('Acessórios: a linha não tem Switch nem coluna "Ativo" — Ativar/Desativar está no menu de três pontos', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ is_active: true }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', is_active: false }),
    ])
    renderPage('acessorios')

    expect(within(getTableBody()).queryByRole('switch')).not.toBeInTheDocument()
    expect(within(getTableBody()).queryByText('Ativo')).not.toBeInTheDocument()
    expect(within(getTableBody()).queryByText('Inativo')).not.toBeInTheDocument()
    // nenhum botão de texto "Movimentar estoque"/"Gerenciar"
    expect(screen.queryByRole('button', { name: /Movimentar estoque/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gerenciar/i })).not.toBeInTheDocument()

    // acessório ATIVO -> menu oferece "Desativar"
    await user.click(screen.getByRole('button', { name: 'Mais ações — acessório Ímã 6x2' }))
    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Desativar' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Excluir' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    // acessório INATIVO -> menu oferece "Ativar"
    await user.click(screen.getByRole('button', { name: 'Mais ações — acessório Parafuso' }))
    expect(await screen.findByRole('menuitem', { name: 'Ativar' })).toBeInTheDocument()
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
    // a situação de cada registro continua acessível pelo menu de três
    // pontos (Ativar/Desativar) — o Switch/coluna "Ativo" foi ocultado
    expect(screen.getByRole('button', { name: 'Mais ações — acessório Ímã ativo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mais ações — acessório Ímã inativo' })).toBeInTheDocument()
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

  it('ordenação pelo cabeçalho renomeado "Custo unitário" trata valores nulos de forma determinística (sempre ao final)', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Sem custo', unit_cost: null }),
      accessoryFixture({ id: 'a2', name: 'Custo baixo', unit_cost: 1 }),
      accessoryFixture({ id: 'a3', name: 'Custo alto', unit_cost: 9 }),
    ])
    renderPage('acessorios')

    await applySort(user, 'Custo unitário', 'Ordenar crescente')
    expect(getVisibleNamesInOrder()).toEqual(['Custo baixo', 'Custo alto', 'Sem custo'])

    await applySort(user, 'Custo unitário', 'Ordenar decrescente')
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
    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')

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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
    expect(screen.getByLabelText('Nome')).toHaveValue('Ímã 6x2')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    await clickAccessoryRowAction(user, 'Parafuso', 'Editar')
    expect(screen.getByLabelText('Nome')).toHaveValue('Parafuso')
    expect(screen.getByLabelText('Variante')).toHaveValue('prata')
    expect(screen.getByLabelText('Estoque mínimo')).toHaveValue('3')
  })

  it('envia o payload exato ao editar um acessório (nome pós-trim, sem is_active/material/unit_cost/current_stock)', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture())
    mockAccessories([accessoryFixture()], { update })
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
    await user.click(screen.getByRole('radio', { name: 'Não se aplica' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', expect.objectContaining({ size: null })))
  })

  it('um tamanho legado é preservado quando o usuário não altera a seleção', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture())
    mockAccessories([accessoryFixture({ size: 'M3' })], { update })
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
    expect(screen.getByRole('radio', { name: 'M3' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', expect.objectContaining({ size: 'M3' })))
  })

  it('um tamanho legado pode ser substituído por uma opção oficial da lista', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture())
    mockAccessories([accessoryFixture({ size: 'M3' })], { update })
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
    await user.click(screen.getByRole('radio', { name: 'GG' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', expect.objectContaining({ size: 'GG' })))
  })

  it('sucesso fecha o diálogo e mostra um toast de confirmação', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ name: 'Ímã atualizado' }))
    mockAccessories([accessoryFixture()], { update })
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(searchInput).toHaveValue('Ímã')
  })

  it('botão "Editar" existe na listagem de Embalagens e abre "Editar embalagem" com payload correto', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(packagingFixture())
    mockPackaging([packagingFixture()], { update })
    renderPage('embalagens')

    // Embalagens mantém o botão de texto "Editar" na coluna Ações (inalterado)
    await user.click(within(getTableBody()).getByRole('button', { name: /^editar$/i }))
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

  it('o menu de cada acessório oferece "Desativar" quando ativo e "Ativar" quando inativo', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', is_active: true }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', is_active: false }),
    ])
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Mais ações — acessório Ímã 6x2' }))
    expect(await screen.findByRole('menuitem', { name: 'Desativar' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Ativar' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Mais ações — acessório Parafuso' }))
    expect(await screen.findByRole('menuitem', { name: 'Ativar' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Desativar' })).not.toBeInTheDocument()
  })

  it('clicar no switch abre um diálogo de confirmação com nome acessível, sem chamar a API ainda', async () => {
    const user = userEvent.setup()
    const update = vi.fn()
    mockAccessories([accessoryFixture({ is_active: true })], { update })
    renderPage('acessorios')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Desativar')

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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Desativar')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('confirmar ativação chama update com { is_active: true } (só essa chave), exatamente uma vez', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ is_active: true }))
    mockAccessories([accessoryFixture({ is_active: false })], { update })
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Ativar')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Desativar')
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

    await clickAccessoryRowAction(user, 'Parafuso', 'Ativar')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Desativar')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Desativar')
    await user.click(screen.getByRole('button', { name: 'Desativar' }))

    const processingButton = await screen.findByRole('button', { name: 'Desativando...' })
    expect(processingButton).toBeDisabled()
    expect(update).toHaveBeenCalledTimes(1)

    await user.click(processingButton)
    expect(update).toHaveBeenCalledTimes(1)

    resolveUpdate(accessoryFixture({ is_active: false }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('erro na mutation mantém o diálogo aberto e funcional, com mensagem clara (nunca toast)', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockRejectedValue(new ApiError('database', 500, 'Falha ao atualizar acessório.'))
    mockAccessories([accessoryFixture({ is_active: true })], { update })
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Desativar')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Desativar')
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(update).toHaveBeenCalled())

    expect(searchInput).toHaveValue('Ímã')
  })

  it('desativar um acessório NUNCA o esconde da listagem (sem filtro de status, ele continua visível, agora inativo)', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a1', name: 'Ímã 6x2', is_active: false }))
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', is_active: true })], { update })
    const { rerender } = renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Desativar')
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', { is_active: false }))

    // Simula a substituição do array local que o hook real faria.
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', is_active: false })], { update })
    rerender(<InventoryPage area="acessorios" />)

    // Continua na listagem — e o menu agora oferece "Ativar".
    expect(within(getTableBody()).getByText('Ímã 6x2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mais ações — acessório Ímã 6x2' }))
    expect(await screen.findByRole('menuitem', { name: 'Ativar' })).toBeInTheDocument()
  })

  it('o menu de três pontos e o diálogo de confirmação são operáveis por teclado', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ is_active: false }))
    mockAccessories([accessoryFixture({ is_active: true })], { update })
    renderPage('acessorios')

    const trigger = screen.getByRole('button', { name: 'Mais ações — acessório Ímã 6x2' })
    trigger.focus()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')

    await user.click(await screen.findByRole('menuitem', { name: 'Desativar' }))
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
    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')

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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('confirmar chama a exclusão exatamente uma vez com o id correto', async () => {
    const user = userEvent.setup()
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    mockAccessories([accessoryFixture()], { delete: deleteFn })
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
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

    await clickAccessoryRowAction(user, 'Parafuso', 'Excluir')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
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

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
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
    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
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

describe('InventoryPage — coluna Disponível e situação de estoque (Acessórios)', () => {
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

  it('permite ordenar a listagem pelo cabeçalho renomeado "Disponível"', async () => {
    const user = userEvent.setup()
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Baixo saldo', current_stock: 2 }),
      accessoryFixture({ id: 'a2', name: 'Alto saldo', current_stock: 50 }),
    ])
    renderPage('acessorios')

    await applySort(user, 'Disponível', 'Ordenar crescente')
    expect(getVisibleNamesInOrder()).toEqual(['Baixo saldo', 'Alto saldo'])

    await applySort(user, 'Disponível', 'Ordenar decrescente')
    expect(getVisibleNamesInOrder()).toEqual(['Alto saldo', 'Baixo saldo'])
  })
})

// ---------------------------------------------------------------------------
// Fixture de uma linha de stock_movements (o que register/listStockMovements
// devolvem) — só os campos que a UI lê.
// ---------------------------------------------------------------------------
type StockMovementRow = {
  id: string
  item_type: 'ACCESSORY' | 'PACKAGING'
  item_id: string
  movement_type: string
  quantity_delta: number
  balance_before: number
  balance_after: number
  reason: string | null
  reference_type: string | null
  reference_id: string | null
  idempotency_key: string | null
  occurred_at: string
  created_by: string
  created_at: string
}

function stockMovementRow(overrides: Partial<StockMovementRow> = {}): StockMovementRow {
  return {
    id: 'm1',
    item_type: 'ACCESSORY',
    item_id: 'a1',
    movement_type: 'POSITIVE_ADJUSTMENT',
    quantity_delta: 7,
    balance_before: 18,
    balance_after: 25,
    reason: 'Ajuste de saldo por contagem',
    reference_type: null,
    reference_id: null,
    idempotency_key: 'key-1',
    occurred_at: '2026-09-06T12:00:00Z',
    created_by: 'u1',
    created_at: '2026-09-06T12:00:00Z',
    ...overrides,
  }
}

// register mock que devolve uma linha com o balance_after coerente com o
// delta pedido (o padrão "sem concorrência": balance_after == quantidade
// pretendida).
function mockStockMovements(
  overrides: Partial<{
    movements: StockMovementRow[]
    isLoading: boolean
    loadError: unknown
    refetch: ReturnType<typeof vi.fn>
    isRegistering: boolean
    register: ReturnType<typeof vi.fn>
  }> = {},
) {
  useStockMovementsMock.mockReturnValue({
    movements: overrides.movements ?? [],
    isLoading: overrides.isLoading ?? false,
    loadError: overrides.loadError ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    isRegistering: overrides.isRegistering ?? false,
    register:
      overrides.register ??
      vi.fn(async ({ movement_type, quantity }: { movement_type: string; quantity: number }) => {
        const before = getAccessoryCurrentStockMock.mock.results.at(-1)?.value ?? 0
        const resolvedBefore = typeof before === 'number' ? before : await before
        const delta = movement_type === 'POSITIVE_ADJUSTMENT' ? quantity : -quantity
        return stockMovementRow({
          movement_type,
          quantity_delta: delta,
          balance_before: resolvedBefore,
          balance_after: resolvedBefore + delta,
        })
      }),
  })
}

describe('InventoryPage — Embalagens: painel "Movimentar estoque" (inalterado)', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    mockStockMovements()
  })

  it('Embalagens abrem o painel completo com o formulário de movimentação e a categoria correta', async () => {
    const user = userEvent.setup()
    mockPackaging([packagingFixture({ current_stock: 8 })])
    renderPage('embalagens')

    await user.click(screen.getByRole('button', { name: 'Movimentar estoque — embalagem Caixa M' }))

    const dialog = screen.getByRole('dialog', { name: 'Movimentar estoque' })
    expect(within(dialog).getByText('Embalagem')).toBeInTheDocument()
    // o formulário genérico de movimentação CONTINUA em Embalagens
    expect(within(dialog).getByRole('radiogroup', { name: 'Movimentação' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Acessórios (2026-09-06): "Movimentar estoque" foi substituído por "Ajuste"
// (quantidade absoluta -> diferença -> register_stock_movement) + "Histórico"
// (janela só de consulta). Não existe formulário genérico de movimentação em
// Acessórios.
// ---------------------------------------------------------------------------

describe('InventoryPage — Acessórios: janela "Ajustar quantidade"', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    getAccessoryCurrentStockMock.mockReset()
    mockStockMovements()
  })

  it('não há botão "Movimentar estoque"/"Gerenciar" em Acessórios — o botão "Ajuste" abre a janela do acessório correto, com a quantidade atual', async () => {
    const user = userEvent.setup()
    getAccessoryCurrentStockMock.mockResolvedValue(25)
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 25 }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', current_stock: 3 }),
    ])
    renderPage('acessorios')

    expect(screen.queryByRole('button', { name: /Movimentar estoque/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gerenciar/i })).not.toBeInTheDocument()

    const row = within(getTableBody())
      .getByText('Ímã 6x2')
      .closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Ajustar quantidade' }))

    const dialog = screen.getByRole('dialog', { name: 'Ajustar Quantidade' })
    // o nome do acessório aparece UMA ÚNICA vez (em destaque no corpo, nunca
    // também no título/descrição do diálogo)
    expect(within(dialog).getAllByText('Ímã 6x2')).toHaveLength(1)
    expect(within(dialog).getByText('Quantidade atual: 25')).toBeInTheDocument()
    // nunca a quantidade do OUTRO acessório
    expect(within(dialog).queryByText('Parafuso')).not.toBeInTheDocument()
  })

  it('trata a nova quantidade como valor ABSOLUTO — aumento: registra POSITIVE_ADJUSTMENT com |diferença|', async () => {
    const user = userEvent.setup()
    getAccessoryCurrentStockMock.mockResolvedValue(10)
    const register = vi.fn().mockResolvedValue(stockMovementRow({ balance_before: 10, balance_after: 15, quantity_delta: 5 }))
    mockStockMovements({ register })
    const setLocalStock = vi.fn()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 10 })], { setLocalStock })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '15')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(register.mock.calls[0][0]).toMatchObject({
      movement_type: 'POSITIVE_ADJUSTMENT',
      quantity: 5,
      reason: 'Ajuste de saldo por contagem',
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ajustar Quantidade' })).not.toBeInTheDocument())
    expect(toastMock.success).toHaveBeenCalledWith('Ajuste registrado.')
    expect(setLocalStock).toHaveBeenCalledWith('a1', 15)
  })

  it('redução: registra NEGATIVE_ADJUSTMENT com |diferença| (exemplo do pedido: 25 -> 18 => -7)', async () => {
    const user = userEvent.setup()
    getAccessoryCurrentStockMock.mockResolvedValue(25)
    const register = vi
      .fn()
      .mockResolvedValue(stockMovementRow({ movement_type: 'NEGATIVE_ADJUSTMENT', quantity_delta: -7, balance_before: 25, balance_after: 18 }))
    mockStockMovements({ register })
    const setLocalStock = vi.fn()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 25 })], { setLocalStock })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '18')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(register.mock.calls[0][0]).toMatchObject({ movement_type: 'NEGATIVE_ADJUSTMENT', quantity: 7 })
    expect(setLocalStock).toHaveBeenCalledWith('a1', 18)
  })

  it('aceita zero como nova quantidade (25 -> 0 => NEGATIVE_ADJUSTMENT de 25)', async () => {
    const user = userEvent.setup()
    getAccessoryCurrentStockMock.mockResolvedValue(25)
    const register = vi
      .fn()
      .mockResolvedValue(stockMovementRow({ movement_type: 'NEGATIVE_ADJUSTMENT', quantity_delta: -25, balance_before: 25, balance_after: 0 }))
    mockStockMovements({ register })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 25 })])
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '0')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))

    await waitFor(() => expect(register).toHaveBeenCalledWith(expect.objectContaining({ movement_type: 'NEGATIVE_ADJUSTMENT', quantity: 25 })))
  })

  it('recusa valor negativo — nenhuma releitura, nenhum register', async () => {
    const user = userEvent.setup()
    const register = vi.fn()
    mockStockMovements({ register })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 10 })])
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '-3')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))

    expect(register).not.toHaveBeenCalled()
    expect(getAccessoryCurrentStockMock).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Ajustar Quantidade' })).toBeInTheDocument()
  })

  it('recusa valor fracionado — nenhum register', async () => {
    const user = userEvent.setup()
    const register = vi.fn()
    mockStockMovements({ register })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 10 })])
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '10,5')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))

    expect(register).not.toHaveBeenCalled()
  })

  it('nova quantidade igual à atual: não cria movimentação e informa que não houve alteração', async () => {
    const user = userEvent.setup()
    getAccessoryCurrentStockMock.mockResolvedValue(10)
    const register = vi.fn()
    mockStockMovements({ register })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 10 })])
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '10')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))

    await waitFor(() => expect(getAccessoryCurrentStockMock).toHaveBeenCalled())
    expect(register).not.toHaveBeenCalled()
    expect(await screen.findByText(/nenhum ajuste foi registrado/i)).toBeInTheDocument()
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Ajustar Quantidade' })).toBeInTheDocument()
  })

  it('observação vazia envia o motivo padrão "Ajuste de saldo por contagem"; observação preenchida usa o texto do usuário', async () => {
    const user = userEvent.setup()
    getAccessoryCurrentStockMock.mockResolvedValue(10)
    const register = vi.fn().mockResolvedValue(stockMovementRow({ balance_before: 10, balance_after: 12, quantity_delta: 2 }))
    mockStockMovements({ register })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 10 })])
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '12')
    await user.type(screen.getByLabelText('Observação'), 'contagem do dia 06')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))

    await waitFor(() => expect(register).toHaveBeenCalledWith(expect.objectContaining({ reason: 'contagem do dia 06' })))
  })

  it('consulta o saldo novamente ANTES de enviar e recalcula a diferença sobre o valor mais recente', async () => {
    const user = userEvent.setup()
    // a tela mostra 25, mas o backend já está em 20 (mudança concorrente)
    getAccessoryCurrentStockMock.mockResolvedValue(20)
    const register = vi
      .fn()
      .mockResolvedValue(stockMovementRow({ movement_type: 'NEGATIVE_ADJUSTMENT', quantity_delta: -2, balance_before: 20, balance_after: 18 }))
    mockStockMovements({ register })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 25 })])
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '18')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))

    await waitFor(() => expect(getAccessoryCurrentStockMock).toHaveBeenCalledWith('a1'))
    // diferença calculada sobre 20 (releitura), não sobre 25 (tela): 18 - 20 = -2
    expect(register.mock.calls[0][0]).toMatchObject({ movement_type: 'NEGATIVE_ADJUSTMENT', quantity: 2 })
  })

  it('resultado simultâneo divergente (balance_after != pretendido): não mostra sucesso, atualiza o saldo retornado e avisa o usuário', async () => {
    const user = userEvent.setup()
    getAccessoryCurrentStockMock.mockResolvedValue(25)
    // usuário pretende 18; releitura diz 25; delta -7; mas o backend aplica
    // sobre um valor já diferente e devolve balance_after = 20 (!= 18)
    const register = vi
      .fn()
      .mockResolvedValue(stockMovementRow({ movement_type: 'NEGATIVE_ADJUSTMENT', quantity_delta: -7, balance_before: 27, balance_after: 20 }))
    mockStockMovements({ register })
    const setLocalStock = vi.fn()
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 25 })], { setLocalStock })
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '18')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))

    await waitFor(() => expect(register).toHaveBeenCalled())
    expect(toastMock.success).not.toHaveBeenCalled()
    // tela atualizada com o saldo REAL retornado
    expect(setLocalStock).toHaveBeenCalledWith('a1', 20)
    expect(await screen.findByText(/alterado por outra pessoa/i)).toBeInTheDocument()
    // a janela permanece aberta para o usuário revisar
    expect(screen.getByRole('dialog', { name: 'Ajustar Quantidade' })).toBeInTheDocument()
  })

  it('bloqueia envio duplicado durante o salvamento', async () => {
    const user = userEvent.setup()
    getAccessoryCurrentStockMock.mockResolvedValue(10)
    let resolveRegister: (v: StockMovementRow) => void = () => {}
    const register = vi.fn(
      () =>
        new Promise<StockMovementRow>((resolve) => {
          resolveRegister = resolve
        }),
    )
    mockStockMovements({ register })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 10 })])
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '15')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))

    const savingButton = await screen.findByRole('button', { name: 'Salvando...' })
    expect(savingButton).toBeDisabled()
    await user.click(savingButton)
    expect(register).toHaveBeenCalledTimes(1)

    resolveRegister(stockMovementRow({ balance_before: 10, balance_after: 15, quantity_delta: 5 }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ajustar Quantidade' })).not.toBeInTheDocument())
  })

  it('o ajuste NUNCA altera o Custo unitário exibido na listagem', async () => {
    const user = userEvent.setup()
    getAccessoryCurrentStockMock.mockResolvedValue(10)
    mockStockMovements({
      register: vi.fn().mockResolvedValue(stockMovementRow({ balance_before: 10, balance_after: 15, quantity_delta: 5 })),
    })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 10, unit_cost: 12.5 })])
    renderPage('acessorios')

    expect(within(getTableBody()).getByText(formatBRL(12.5))).toBeInTheDocument()

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '15')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ajustar Quantidade' })).not.toBeInTheDocument())

    // custo intacto (nenhuma chamada a update/registro tocou unit_cost)
    expect(within(getTableBody()).getByText(formatBRL(12.5))).toBeInTheDocument()
  })

  it('Cancelar fecha a janela sem consultar saldo nem registrar', async () => {
    const user = userEvent.setup()
    const register = vi.fn()
    mockStockMovements({ register })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 10 })])
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' }))
    await user.type(screen.getByLabelText('Nova quantidade'), '15')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog', { name: 'Ajustar Quantidade' })).not.toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
    expect(getAccessoryCurrentStockMock).not.toHaveBeenCalled()
  })

  it('interface refinada (2026-09-06): cabeçalho "Ações" visível, botão de ajuste só ícone com tooltip/aria-label, janela sem nome duplicado', async () => {
    const user = userEvent.setup()
    getAccessoryCurrentStockMock.mockResolvedValue(0)
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 0 })])
    renderPage('acessorios')

    // 1. "Ações" aparece visivelmente no cabeçalho da listagem
    expect(within(getTable()).getByText('Ações')).toBeInTheDocument()

    // 2. o texto "Ajuste" não aparece mais como botão na listagem
    expect(within(getTable()).queryByRole('button', { name: 'Ajuste' })).not.toBeInTheDocument()
    expect(within(getTable()).queryByText('Ajuste')).not.toBeInTheDocument()

    // 3 + 4. o botão é só ícone, com tooltip e aria-label "Ajustar quantidade";
    //        12. Histórico e menu de três pontos seguem inalterados na linha
    const adjustButton = within(getTableBody()).getByRole('button', { name: 'Ajustar quantidade' })
    expect(adjustButton).toHaveAttribute('title', 'Ajustar quantidade')
    expect(adjustButton).toHaveAttribute('aria-label', 'Ajustar quantidade')
    expect(adjustButton).toHaveTextContent('')
    expect(within(getTableBody()).getByRole('button', { name: 'Histórico' })).toBeInTheDocument()
    expect(
      within(getTableBody()).getByRole('button', { name: 'Mais ações — acessório Ímã 6x2' }),
    ).toBeInTheDocument()

    // 5 + 6. abre o acessório correto; título exatamente "Ajustar Quantidade"
    // (a partir daqui a listagem fica inerte sob o diálogo — só asserções no dialog)
    await user.click(adjustButton)
    const dialog = screen.getByRole('dialog', { name: 'Ajustar Quantidade' })
    expect(within(dialog).getByRole('heading', { name: 'Ajustar Quantidade' })).toBeInTheDocument()

    // 7. o nome do acessório aparece uma única vez
    expect(within(dialog).getAllByText('Ímã 6x2')).toHaveLength(1)

    // 8. "Quantidade atual: 0" é exibido
    expect(within(dialog).getByText('Quantidade atual: 0')).toBeInTheDocument()

    // 9 + 10 + 11. Nova quantidade, Observação, Cancelar e Salvar ajuste seguem presentes
    expect(within(dialog).getByLabelText('Nova quantidade')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Observação')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Salvar ajuste' })).toBeInTheDocument()
  })

  it('interface refinada (2026-09-06): Embalagens não sofreu alteração — cabeçalho de Ações sem texto visível e sem botão de ajuste', () => {
    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M' })])
    renderPage('embalagens')

    expect(within(getTable()).queryByText('Ações')).not.toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Redimensionar coluna Ações' })).toBeInTheDocument()
    expect(within(getTable()).queryByRole('button', { name: 'Ajustar quantidade' })).not.toBeInTheDocument()
    // o fluxo antigo "Movimentar estoque" continua intacto em Embalagens
    expect(within(getTableBody()).getByRole('button', { name: 'Movimentar estoque — embalagem Caixa M' })).toBeInTheDocument()
  })
})

describe('InventoryPage — Acessórios: janela "Histórico"', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    getAccessoryCurrentStockMock.mockReset()
  })

  it('o botão de Histórico é só ícone, com tooltip e aria-label "Histórico", e abre o acessório correto', async () => {
    const user = userEvent.setup()
    mockStockMovements({ movements: [] })
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 4, minimum_stock: 10 }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', current_stock: 30 }),
    ])
    renderPage('acessorios')

    const row = within(getTableBody())
      .getByText('Ímã 6x2')
      .closest('tr') as HTMLElement
    const historyButton = within(row).getByRole('button', { name: 'Histórico' })
    expect(historyButton).toHaveAttribute('title', 'Histórico')
    // só ícone: sem texto visível "Histórico" dentro do botão
    expect(historyButton).toHaveTextContent('')

    await user.click(historyButton)
    const dialog = screen.getByRole('dialog', { name: 'Histórico do acessório' })
    expect(within(dialog).getAllByText('Ímã 6x2').length).toBeGreaterThanOrEqual(1)
    expect(within(dialog).queryByText('Parafuso')).not.toBeInTheDocument()
  })

  it('mostra o resumo Disponível / Estoque mínimo / Situação e NÃO tem formulário de movimentação', async () => {
    const user = userEvent.setup()
    mockStockMovements({ movements: [] })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 4, minimum_stock: 10 })])
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Histórico' }))
    const dialog = screen.getByRole('dialog', { name: 'Histórico do acessório' })

    expect(within(dialog).getByText('Disponível')).toBeInTheDocument()
    expect(within(dialog).getByText('Estoque mínimo')).toBeInTheDocument()
    expect(within(dialog).getByText('Situação')).toBeInTheDocument()
    expect(within(dialog).getByText('Estoque baixo')).toBeInTheDocument()

    // nunca o formulário de movimentação
    expect(within(dialog).queryByRole('radiogroup', { name: 'Movimentação' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /registrar movimenta/i })).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Quantidade')).not.toBeInTheDocument()
  })

  it('estados: carregando, vazio e erro', async () => {
    const user = userEvent.setup()

    // carregando
    mockStockMovements({ isLoading: true })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' })])
    const { unmount } = renderPage('acessorios')
    await user.click(within(getTableBody()).getByRole('button', { name: 'Histórico' }))
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    unmount()

    // vazio
    mockStockMovements({ movements: [] })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' })])
    const second = renderPage('acessorios')
    await user.click(within(getTableBody()).getByRole('button', { name: 'Histórico' }))
    expect(screen.getByText('Nenhuma movimentação registrada.')).toBeInTheDocument()
    second.unmount()

    // erro
    mockStockMovements({ loadError: new ApiError('database', 500, 'Falha ao carregar o histórico.') })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' })])
    renderPage('acessorios')
    await user.click(within(getTableBody()).getByRole('button', { name: 'Histórico' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Falha ao carregar o histórico.')
  })

  it('lista as movimentações mais recentes primeiro, sem rolagem horizontal e com quebra de linha em textos longos', async () => {
    const user = userEvent.setup()
    const longReason =
      'Contagem de inventário periódico realizada pela equipe da manhã com conferência dupla item a item na prateleira'
    mockStockMovements({
      movements: [
        stockMovementRow({
          id: 'm2',
          movement_type: 'NEGATIVE_ADJUSTMENT',
          quantity_delta: -3,
          balance_before: 25,
          balance_after: 22,
          reason: longReason,
          occurred_at: '2026-09-06T15:00:00Z',
        }),
        stockMovementRow({
          id: 'm1',
          movement_type: 'POSITIVE_ADJUSTMENT',
          quantity_delta: 5,
          balance_before: 20,
          balance_after: 25,
          occurred_at: '2026-09-06T09:00:00Z',
        }),
      ],
    })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 22 })])
    renderPage('acessorios')

    await user.click(within(getTableBody()).getByRole('button', { name: 'Histórico' }))
    const dialog = screen.getByRole('dialog', { name: 'Histórico do acessório' })

    // desktop: a tabela ocupa 100% da largura do contêiner (w-full table-fixed)
    // e nada força mais largura que o contêiner — nenhum min-w, nenhum
    // style min-width — então nunca há barra de rolagem horizontal própria.
    const historyTable = within(dialog).getByRole('table')
    expect(historyTable.className).toMatch(/\bw-full\b/)
    expect(historyTable.className).toMatch(/\btable-fixed\b/)
    expect(historyTable.className).not.toMatch(/\bmin-w/)
    expect(historyTable.style.minWidth).toBe('')
    const tableContainer = historyTable.closest('[data-slot="table-container"]') as HTMLElement
    expect(tableContainer.className).not.toMatch(/\bmin-w/)
    // sem a coluna "Referência" (sempre "—" nesta etapa)
    expect(within(historyTable).queryByText('Referência')).not.toBeInTheDocument()

    // texto longo quebra linha (whitespace-normal break-words), nunca truncado
    const reasonCell = within(historyTable).getByText(longReason)
    expect(reasonCell.className).toMatch(/break-words/)
    expect(reasonCell.className).not.toMatch(/\btruncate\b/)

    // ordem: mais recente (15:00) antes da mais antiga (09:00)
    const rowsText = within(historyTable)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent ?? '')
    expect(rowsText[0]).toContain('-3')
    expect(rowsText[1]).toContain('+5')

    // tela estreita: cards (sm:hidden) com os mesmos campos rotulados —
    // Data, Tipo, Quantidade, Saldo, Motivo/Observação (JSDOM não aplica o
    // CSS responsivo, então os dois layouts coexistem no DOM).
    expect(within(dialog).getAllByText(/^Tipo:/).length).toBe(2)
    expect(within(dialog).getAllByText(/^Motivo\/Observação:/).length).toBe(2)
  })

  it('nunca mistura o histórico de acessórios diferentes: reabrir para outro acessório remonta a consulta', async () => {
    const user = userEvent.setup()
    mockStockMovements({ movements: [] })
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Ímã 6x2', current_stock: 4 }),
      accessoryFixture({ id: 'a2', name: 'Parafuso', current_stock: 30 }),
    ])
    renderPage('acessorios')

    const imaRow = within(getTableBody()).getByText('Ímã 6x2').closest('tr') as HTMLElement
    await user.click(within(imaRow).getByRole('button', { name: 'Histórico' }))
    expect(within(screen.getByRole('dialog')).getByText('Ímã 6x2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Fechar' }))

    const parafusoRow = within(getTableBody()).getByText('Parafuso').closest('tr') as HTMLElement
    await user.click(within(parafusoRow).getByRole('button', { name: 'Histórico' }))
    const dialog = screen.getByRole('dialog', { name: 'Histórico do acessório' })
    expect(within(dialog).getByText('Parafuso')).toBeInTheDocument()
    expect(within(dialog).queryByText('Ímã 6x2')).not.toBeInTheDocument()
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

  it('identificadores de coluna (Acessórios): 7 colunas viram 7 <col> no colgroup (sem "Ativo")', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')
    expect(document.querySelectorAll('col')).toHaveLength(7)
  })

  it('a coluna Ações de Acessórios não pode ser reduzida abaixo do mínimo da barra compacta (170px)', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')
    const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Ações' })

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: -9999, pointerId: 1 })

    const actionsCol = document.querySelectorAll('col')[6] as HTMLElement
    expect(Number.parseInt(actionsCol.style.width, 10)).toBe(170)
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

  it('regressão (Acessórios): "Ajuste" + Histórico (ícone) + menu de três pontos em uma única linha, sem "Movimentar estoque"', () => {
    mockAccessories([accessoryFixture()])
    renderPage('acessorios')

    const adjustButton = within(getTable()).getByRole('button', { name: 'Ajustar quantidade' })
    const actionsCell = adjustButton.closest('div')
    expect(actionsCell).toHaveClass('flex-nowrap')
    expect(actionsCell).not.toHaveClass('flex-wrap')

    expect(within(getTable()).getByRole('button', { name: 'Histórico' })).toBeInTheDocument()
    expect(
      within(getTable()).getByRole('button', { name: 'Mais ações — acessório Ímã 6x2' }),
    ).toBeInTheDocument()
    expect(within(getTable()).queryByRole('button', { name: /Movimentar estoque/i })).not.toBeInTheDocument()
    expect(within(getTable()).queryByRole('button', { name: /^Editar$/ })).not.toBeInTheDocument()
  })

  it('regressão: busca e ordenação continuam funcionando após o redimensionamento', async () => {
    mockAccessories([accessoryFixture()])
    const user = userEvent.setup()
    renderPage('acessorios')

    await applySort(user, 'Acessório', 'Ordenar crescente')
    expect(within(getTableBody()).getByText('Ímã 6x2')).toBeInTheDocument()
  })
})

// ===========================================================================
// Módulo 3 — foto principal do acessório (infraestrutura compartilhada,
// 2026-09-06). Integração só em Acessórios nesta rodada. O test double de
// EntityImageUploadField (topo do arquivo) expõe "Escolher foto (teste)" /
// "Remover foto (teste)"; a API entity-images é mockada.
// ===========================================================================
describe('InventoryPage — Acessórios: foto de referência (2026-09-06)', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    uploadEntityImageMock.mockReset()
    removeEntityImageMock.mockReset()
    signEntityImageUrlsMock.mockReset()
    signEntityImageUrlsMock.mockResolvedValue({ urls: {}, expires_in: 3600 })
    uploadEntityImageMock.mockResolvedValue({
      entity: 'accessories',
      id: 'a-new',
      image_path: 'accessories/a-new/v-original.webp',
      image_thumb_path: 'accessories/a-new/v-thumb.webp',
      image_url: 'https://signed/original',
      image_thumb_url: 'https://signed/thumb',
    })
    removeEntityImageMock.mockResolvedValue({ entity: 'accessories', id: 'a1', success: true })
    purgeEntityImagesMock.mockReset()
    purgeEntityImagesMock.mockResolvedValue({ entity: 'accessories', id: 'a1', success: true, purged: 2 })
  })

  it('listagem: acessório sem foto mostra placeholder; com foto mostra a miniatura assinada em lote', async () => {
    signEntityImageUrlsMock.mockResolvedValue({
      urls: { 'accessories/a2/t.webp': 'https://signed/a2-thumb' },
      expires_in: 3600,
    })
    mockAccessories([
      accessoryFixture({ id: 'a1', name: 'Sem foto' }),
      accessoryFixture({
        id: 'a2',
        name: 'Com foto',
        image_path: 'accessories/a2/o.webp',
        image_thumb_path: 'accessories/a2/t.webp',
      }),
    ])
    renderPage('acessorios')

    // uma única chamada de assinatura em lote, com o caminho distinto
    await waitFor(() => expect(signEntityImageUrlsMock).toHaveBeenCalledWith(['accessories/a2/t.webp']))

    const comFotoRow = within(getTableBody()).getByText('Com foto').closest('tr') as HTMLElement
    await waitFor(() =>
      expect(within(comFotoRow).getByRole('img')).toHaveAttribute('src', 'https://signed/a2-thumb'),
    )

    const semFotoRow = within(getTableBody()).getByText('Sem foto').closest('tr') as HTMLElement
    expect(within(semFotoRow).queryByRole('img')).not.toBeInTheDocument()
  })

  it('criar COM foto: cria o acessório primeiro e só então envia/vincula a foto pelo id retornado', async () => {
    const user = userEvent.setup()
    const create = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a-new', name: 'Fivela' }))
    const setLocalImage = vi.fn()
    mockAccessories([], { create, setLocalImage })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Novo acessório' }))
    await user.type(screen.getByLabelText('Nome'), 'Fivela')
    await user.type(screen.getByLabelText('Estoque mínimo'), '3')
    await user.click(screen.getByRole('button', { name: 'Escolher foto (teste)' }))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(uploadEntityImageMock).toHaveBeenCalledWith(
        'accessories',
        'a-new',
        expect.objectContaining({ original: expect.any(Blob), thumb: expect.any(Blob) }),
      ),
    )
    // a criação aconteceu ANTES do upload
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(uploadEntityImageMock.mock.invocationCallOrder[0])
    expect(setLocalImage).toHaveBeenCalledWith(
      'a-new',
      'accessories/a-new/v-original.webp',
      'accessories/a-new/v-thumb.webp',
    )
    expect(toastMock.success).toHaveBeenCalledWith('Acessório cadastrado.')
  })

  it('criar: falha no upload da foto NÃO desfaz a criação — acessório fica cadastrado, com aviso claro', async () => {
    const user = userEvent.setup()
    const create = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a-new', name: 'Fivela' }))
    mockAccessories([], { create })
    uploadEntityImageMock.mockRejectedValue(new ApiError('database', 502, 'storage down'))
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Novo acessório' }))
    await user.type(screen.getByLabelText('Nome'), 'Fivela')
    await user.type(screen.getByLabelText('Estoque mínimo'), '3')
    await user.click(screen.getByRole('button', { name: 'Escolher foto (teste)' }))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'O acessório foi criado, mas a foto não pôde ser salva. Você pode adicioná-la pela edição.',
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('criar SEM foto: não chama a API de imagens', async () => {
    const user = userEvent.setup()
    const create = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a-new' }))
    mockAccessories([], { create })
    renderPage('acessorios')

    await user.click(screen.getByRole('button', { name: 'Novo acessório' }))
    await user.type(screen.getByLabelText('Nome'), 'Sem foto')
    await user.type(screen.getByLabelText('Estoque mínimo'), '1')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Acessório cadastrado.'))
    expect(uploadEntityImageMock).not.toHaveBeenCalled()
  })

  it('editar: só abrir e cancelar não dispara nenhuma alteração de foto', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a1' }))
    mockAccessories(
      [
        accessoryFixture({
          id: 'a1',
          name: 'Ímã 6x2',
          image_path: 'accessories/a1/o.webp',
          image_thumb_path: 'accessories/a1/t.webp',
        }),
      ],
      { update },
    )
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

    expect(update).not.toHaveBeenCalled()
    expect(uploadEntityImageMock).not.toHaveBeenCalled()
    expect(removeEntityImageMock).not.toHaveBeenCalled()
  })

  it('editar: salvar sem mexer na foto preserva os caminhos (nenhuma chamada de imagem)', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a1' }))
    mockAccessories(
      [
        accessoryFixture({
          id: 'a1',
          name: 'Ímã 6x2',
          image_path: 'accessories/a1/o.webp',
          image_thumb_path: 'accessories/a1/t.webp',
        }),
      ],
      { update },
    )
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(uploadEntityImageMock).not.toHaveBeenCalled()
    expect(removeEntityImageMock).not.toHaveBeenCalled()
  })

  it('editar: escolher uma nova foto envia a substituição e atualiza a listagem sem F5', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a1' }))
    const setLocalImage = vi.fn()
    uploadEntityImageMock.mockResolvedValue({
      entity: 'accessories',
      id: 'a1',
      image_path: 'accessories/a1/new-original.webp',
      image_thumb_path: 'accessories/a1/new-thumb.webp',
      image_url: 'u',
      image_thumb_url: 'tu',
    })
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' })], { update, setLocalImage })
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Escolher foto (teste)' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() =>
      expect(uploadEntityImageMock).toHaveBeenCalledWith('accessories', 'a1', expect.any(Object)),
    )
    expect(setLocalImage).toHaveBeenCalledWith(
      'a1',
      'accessories/a1/new-original.webp',
      'accessories/a1/new-thumb.webp',
    )
    expect(toastMock.success).toHaveBeenCalledWith('Acessório atualizado.')
  })

  it('editar: remover a foto de um acessório que tem foto chama removeEntityImage e limpa a miniatura', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a1' }))
    const setLocalImage = vi.fn()
    mockAccessories(
      [
        accessoryFixture({
          id: 'a1',
          name: 'Ímã 6x2',
          image_path: 'accessories/a1/o.webp',
          image_thumb_path: 'accessories/a1/t.webp',
        }),
      ],
      { update, setLocalImage },
    )
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remover foto (teste)' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(removeEntityImageMock).toHaveBeenCalledWith('accessories', 'a1'))
    expect(setLocalImage).toHaveBeenCalledWith('a1', null, null)
    expect(uploadEntityImageMock).not.toHaveBeenCalled()
  })

  it('editar: falha ao enviar a nova foto preserva a foto anterior (sem setLocalImage) e avisa', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue(accessoryFixture({ id: 'a1' }))
    const setLocalImage = vi.fn()
    uploadEntityImageMock.mockRejectedValue(new ApiError('database', 502, 'storage down'))
    mockAccessories(
      [
        accessoryFixture({
          id: 'a1',
          name: 'Ímã 6x2',
          image_path: 'accessories/a1/o.webp',
          image_thumb_path: 'accessories/a1/t.webp',
        }),
      ],
      { update, setLocalImage },
    )
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Editar')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Escolher foto (teste)' }))
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Os dados foram salvos, mas a nova foto não pôde ser enviada. A foto anterior foi mantida.',
      ),
    )
    expect(setLocalImage).not.toHaveBeenCalled()
  })

  it('excluir um acessório COM foto: só depois da exclusão confirmada limpa a foto no bucket', async () => {
    const user = userEvent.setup()
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    mockAccessories(
      [
        accessoryFixture({
          id: 'a1',
          name: 'Ímã 6x2',
          image_path: 'accessories/a1/o.webp',
          image_thumb_path: 'accessories/a1/t.webp',
        }),
      ],
      { delete: deleteFn },
    )
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    await waitFor(() => expect(deleteFn).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(purgeEntityImagesMock).toHaveBeenCalledWith('accessories', 'a1'))
    // a exclusão do registro veio ANTES da limpeza da foto
    expect(deleteFn.mock.invocationCallOrder[0]).toBeLessThan(purgeEntityImagesMock.mock.invocationCallOrder[0])
    expect(toastMock.success).toHaveBeenCalledWith('Acessório excluído.')
  })

  it('exclusão BLOQUEADA (409): a foto é preservada — purge nunca é chamado', async () => {
    const user = userEvent.setup()
    const deleteFn = vi
      .fn()
      .mockRejectedValue(new ApiError('business_rule', 409, 'Este acessório já teve movimentação de estoque registrada. Desative o item.'))
    mockAccessories(
      [
        accessoryFixture({
          id: 'a1',
          name: 'Ímã 6x2',
          image_path: 'accessories/a1/o.webp',
          image_thumb_path: 'accessories/a1/t.webp',
        }),
      ],
      { delete: deleteFn },
    )
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    await waitFor(() => expect(deleteFn).toHaveBeenCalledWith('a1'))
    expect(purgeEntityImagesMock).not.toHaveBeenCalled()
    expect(await screen.findByText(/Desative o item/)).toBeInTheDocument()
  })

  it('excluir um acessório SEM foto: não chama purge', async () => {
    const user = userEvent.setup()
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    mockAccessories([accessoryFixture({ id: 'a1', name: 'Ímã 6x2' })], { delete: deleteFn })
    renderPage('acessorios')

    await clickAccessoryRowAction(user, 'Ímã 6x2', 'Excluir')
    await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Acessório excluído.'))
    expect(purgeEntityImagesMock).not.toHaveBeenCalled()
  })

  it('Embalagens: nenhuma miniatura na listagem e nenhum campo de foto no cadastro', async () => {
    const user = userEvent.setup()
    mockPackaging([packagingFixture({ id: 'k1', name: 'Caixa M' })])
    renderPage('embalagens')

    expect(within(getTableBody()).queryByRole('img')).not.toBeInTheDocument()
    expect(signEntityImageUrlsMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Nova embalagem' }))
    expect(screen.queryByTestId('entity-image-upload-field')).not.toBeInTheDocument()
  })
})
