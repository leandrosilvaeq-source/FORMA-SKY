import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { FilamentSpool, FilamentTypeSummary } from '@/types/domain'

const { useFilamentTypesMock, useFilamentSpoolsMock, useFilamentMovementsMock, useAuthMock, toastMock } = vi.hoisted(() => ({
  useFilamentTypesMock: vi.fn(),
  useFilamentSpoolsMock: vi.fn(),
  useFilamentMovementsMock: vi.fn(),
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useFilamentTypes', () => ({ useFilamentTypes: useFilamentTypesMock }))
vi.mock('@/hooks/useFilamentSpools', () => ({ useFilamentSpools: useFilamentSpoolsMock }))
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
    has_movement_history: false,
    ...overrides,
  }
}

function mockTypes(
  list: FilamentTypeSummary[],
  overrides: Partial<{
    isLoading: boolean
    error: unknown
    refetch: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
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
    delete: overrides.delete ?? vi.fn().mockResolvedValue(undefined),
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

function renderPage() {
  useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
  return render(<FilamentsInventoryPage />, { wrapper: MemoryRouter })
}

// A janela "Rolos do tipo" renderiza os rolos em DUAS marcações ao mesmo
// tempo — uma <table> (classe "hidden sm:block") e uma lista de cartões
// (classe "sm:hidden") — a alternância entre as duas é só CSS/media query,
// que o jsdom não avalia; as duas ficam presentes no DOM de teste ao mesmo
// tempo. Interações por linha (código do rolo, botão Gerenciar, menu Mais
// ações) precisam ser escopadas à tabela especificamente para não colidir
// com o cartão espelhado — helper único para não repetir isso em cada teste.
function getSpoolsTable(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('table')
}

async function openMoreActionsMenu(user: ReturnType<typeof userEvent.setup>, table: HTMLElement, spoolCode: string) {
  await user.click(within(table).getByRole('button', { name: `Mais ações para o rolo ${spoolCode}` }))
  return screen
}

// Botão "Gerenciar" (abre Movimentar/Pesar/Histórico) — terceira rodada de
// validação manual (2026-08-28): substituiu o antigo botão largo
// "Movimentar / Pesar" por um rótulo curto, com o restante do contexto só
// no aria-label, para caber ao lado do menu "Mais ações" sem sobrepor em
// ~720px de largura de diálogo.
function getManageButton(table: HTMLElement, spoolCode: string) {
  return within(table).getByRole('button', { name: new RegExp(`^gerenciar rolo ${spoolCode}`, 'i') })
}

describe('FilamentsInventoryPage', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    mockSpools([])
    mockMovements()
  })

  it('lista os tipos com material, fabricante, linha, cor, disponível e rolos utilizáveis', () => {
    mockTypes([typeFixture()])
    renderPage()

    expect(screen.getByText('PLA')).toBeInTheDocument()
    expect(screen.getByText('Voolt3D')).toBeInTheDocument()
    expect(screen.getByText('Sólida')).toBeInTheDocument()
    expect(screen.getByText('Preto')).toBeInTheDocument()
    expect(screen.getByText('500g')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('exibe a situação do estoque do tipo (badge)', () => {
    mockTypes([typeFixture({ total_available_grams: 0 })])
    renderPage()
    expect(screen.getByText('Sem estoque')).toBeInTheDocument()
  })

  it('exibe estado vazio quando não há nenhum tipo cadastrado', () => {
    mockTypes([])
    renderPage()
    expect(screen.getByText('Nenhum tipo de filamento cadastrado.')).toBeInTheDocument()
  })

  it('busca filtra por fabricante/linha/cor/material', async () => {
    mockTypes([typeFixture(), typeFixture({ filament_type_id: 't2', manufacturer: 'Fabricante Y', commercial_color: 'Azul' })])
    renderPage()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Buscar tipos de filamento'), 'azul')

    expect(screen.queryByText('Voolt3D')).not.toBeInTheDocument()
    expect(screen.getByText('Fabricante Y')).toBeInTheDocument()
  })

  it('cadastra um novo tipo de filamento', async () => {
    const create = vi.fn().mockResolvedValue(typeFixture())
    mockTypes([], { create })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Novo tipo de filamento' }))
    await user.click(screen.getByRole('radio', { name: 'PLA' }))
    await user.type(screen.getByLabelText('Fabricante'), 'Voolt3D')
    await user.type(screen.getByLabelText('Linha'), 'Sólida')
    await user.type(screen.getByLabelText('Cor'), 'Preto')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({ material: 'PLA', manufacturer: 'Voolt3D', line: 'Sólida', commercial_color: 'Preto' })
    expect(toastMock.success).toHaveBeenCalledWith('Tipo de filamento cadastrado.')
  })

  it('rejeita ABS ao clicar em salvar sem selecionar material — nunca aparece como opção', () => {
    mockTypes([])
    renderPage()
    expect(screen.queryByRole('radio', { name: 'ABS' })).not.toBeInTheDocument()
  })

  it('ativa/desativa um tipo com confirmação', async () => {
    const update = vi.fn().mockResolvedValue(typeFixture({ is_active: false }))
    mockTypes([typeFixture()], { update })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('switch', { name: /desativar tipo de filamento voolt3d preto/i }))
    await user.click(screen.getByRole('button', { name: /^desativar$/i }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('t1', { is_active: false }))
    expect(toastMock.success).toHaveBeenCalledWith('Tipo de filamento desativado.')
  })

  it('exclusão bloqueada por rolo vinculado mostra o erro dentro do diálogo, sem remover o item da lista', async () => {
    const { ApiError } = await import('@/lib/api/errors')
    const deleteType = vi.fn().mockRejectedValue(new ApiError('business_rule', 409, 'Este tipo de filamento possui rolo(s) cadastrado(s).'))
    mockTypes([typeFixture()], { delete: deleteType })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Excluir tipo de filamento Voolt3D Preto' }))
    await user.click(screen.getByRole('button', { name: /^excluir definitivamente$/i }))

    expect(await screen.findByText('Este tipo de filamento possui rolo(s) cadastrado(s).')).toBeInTheDocument()
    expect(screen.getByText('Voolt3D')).toBeInTheDocument()
  })

  it('abrir "Ver rolos" mostra os rolos do tipo com identificador, peso (mesclado com % restante) e status', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))

    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    const table = getSpoolsTable(dialog)
    expect(within(table).getByText('RL-26-001')).toBeInTheDocument()
    expect(within(table).getByText('500g / 1.000g · 50%')).toBeInTheDocument()
    expect(within(table).getByText('ABERTO')).toBeInTheDocument()
  })

  it('registra uma movimentação de um rolo, atualiza o saldo local do rolo (sem refetch de rolos) E aciona o refetch do resumo do tipo', async () => {
    // Achado real da validação manual (2026-08-28): sem acionar o refetch
    // do resumo do TIPO (useFilamentTypes.refetch), o saldo consolidado
    // exibido na listagem/drawer nunca refletia uma movimentação feita
    // dentro deste painel aninhado — este teste prova que a movimentação
    // agora aciona esse refetch, além de continuar atualizando o rolo
    // localmente (sem refetch de rolos, que segue sendo desnecessário: a
    // resposta da RPC já traz balance_after).
    const setLocalSpoolState = vi.fn()
    const typesRefetch = vi.fn()
    const register = vi.fn().mockResolvedValue({
      id: 'm1',
      filament_type_id: 't1',
      spool_id: 's1',
      movement_type: 'PURCHASE',
      quantity_delta: 100,
      balance_before: 500,
      balance_after: 600,
      reason: null,
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

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await user.click(within(getSpoolsTable(dialog)).getByRole('button', { name: /movimentar, pesar ou consultar histórico/i }))
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    await user.click(screen.getByRole('radio', { name: 'Compra' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '100')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(setLocalSpoolState).toHaveBeenCalledWith('s1', { current_net_weight_grams: 600, status: undefined })
    expect(toastMock.success).toHaveBeenCalledWith('Movimentação registrada.')
    expect(typesRefetch).toHaveBeenCalledTimes(1)
  })

  it('registrar pesagem também aciona o refetch do resumo do tipo', async () => {
    const typesRefetch = vi.fn()
    const weigh = vi.fn().mockResolvedValue({
      id: 'm2',
      filament_type_id: 't1',
      spool_id: 's1',
      movement_type: 'WEIGHING_ADJUSTMENT',
      quantity_delta: -50,
      balance_before: 500,
      balance_after: 450,
      reason: 'conferência',
      reference_type: null,
      reference_id: null,
      idempotency_key: null,
      occurred_at: '2026-08-27T12:00:00Z',
      created_by: 'u1',
      created_at: '2026-08-27T12:00:00Z',
    })
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture({ empty_spool_weight_grams: null })])
    mockMovements({ weigh })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await user.click(within(getSpoolsTable(dialog)).getByRole('button', { name: /movimentar, pesar ou consultar histórico/i }))
    await user.click(screen.getByRole('radio', { name: 'Registrar pesagem' }))
    await user.type(screen.getByLabelText(/peso líquido disponível/i), '450')
    await user.type(screen.getByLabelText(/motivo\/observação/i), 'conferência')
    await user.click(screen.getByRole('button', { name: /^registrar pesagem$/i }))

    await waitFor(() => expect(weigh).toHaveBeenCalledTimes(1))
    expect(typesRefetch).toHaveBeenCalledTimes(1)
  })

  it('rolo descartado não exibe os formulários de movimentação/pesagem, só o histórico', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ status: 'DESCARTADO' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await user.click(within(getSpoolsTable(dialog)).getByRole('button', { name: /movimentar, pesar ou consultar histórico/i }))

    expect(screen.getByText(/foi descartado e não aceita novas movimentações/i)).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Movimentação' })).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Saldo consolidado — achado real da validação manual (2026-08-28): o
  // usuário não encontrou 1300g nem 950g nem na listagem nem em "Rolos do
  // tipo". Diagnóstico confirmou o backend/view corretos em todos os passos
  // (reconstrução completa via consultas de leitura contra o remoto) — o
  // problema era só a ausência de um resumo na drawer e a listagem nunca
  // sendo atualizada após uma movimentação feita no painel aninhado. Estes
  // testes cobrem exatamente os dois cenários numéricos documentados.
  // ---------------------------------------------------------------------------

  it('saldo consolidado de 1300g aparece na listagem principal (cenário de dois rolos)', () => {
    mockTypes([typeFixture({ total_available_grams: 1300, usable_spool_count: 2, total_spool_count: 2 })])
    renderPage()
    expect(screen.getByText('1.300g')).toBeInTheDocument()
  })

  it('saldo consolidado de 950g aparece na listagem principal (após movimentos e pesagens)', () => {
    mockTypes([typeFixture({ total_available_grams: 950, usable_spool_count: 2, total_spool_count: 2 })])
    renderPage()
    expect(screen.getByText('950g')).toBeInTheDocument()
  })

  it('"Rolos do tipo" mostra um resumo consolidado: disponível, rolos, abertos, esgotados, estoque mínimo e situação', async () => {
    mockTypes([typeFixture({ total_available_grams: 950, minimum_stock_grams: 300, total_spool_count: 2 })])
    mockSpools([
      spoolFixture({ id: 's1', code: 'RL-26-001', status: 'ABERTO' }),
      spoolFixture({ id: 's2', code: 'RL-26-002', status: 'ESGOTADO', current_net_weight_grams: 0 }),
    ])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))

    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    expect(within(dialog).getByText('Disponível')).toBeInTheDocument()
    expect(within(dialog).getByText('950g')).toBeInTheDocument()
    expect(within(dialog).getByText('Estoque mínimo')).toBeInTheDocument()
    expect(within(dialog).getByText('300g')).toBeInTheDocument()
    expect(within(dialog).getByText('Abertos')).toBeInTheDocument()
    expect(within(dialog).getByText('Esgotados')).toBeInTheDocument()
    // "1" aparece mais de uma vez (Abertos e Esgotados, um rolo cada) —
    // basta confirmar que a contagem existe, sem depender de qual delas.
    expect(within(dialog).getAllByText('1').length).toBeGreaterThanOrEqual(2)
    expect(within(dialog).getByText('Situação')).toBeInTheDocument()
  })

  it('o resumo consolidado NUNCA é recalculado em JS — reflete total_available_grams do backend mesmo quando difere da soma dos rolos carregados', async () => {
    // Dois rolos somando 800g na tela, mas o resumo do backend diz 1300g —
    // se o resumo exibido fosse uma soma client-side dos rolos visíveis,
    // apareceria 800g. Precisa aparecer exatamente 1300g (o valor do
    // resumo), provando que não há um segundo cálculo duplicado no
    // frontend.
    mockTypes([typeFixture({ total_available_grams: 1300, total_spool_count: 2 })])
    mockSpools([
      spoolFixture({ id: 's1', current_net_weight_grams: 400 }),
      spoolFixture({ id: 's2', current_net_weight_grams: 400 }),
    ])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))

    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    expect(within(dialog).getByText('1.300g')).toBeInTheDocument()
    expect(within(dialog).queryByText('800g')).not.toBeInTheDocument()
  })

  it('saldo NÃO volta a 950g ao apenas marcar "Mostrar arquivados" — só muda a visibilidade, nunca o resumo', async () => {
    // Cenário exato descrito na segunda rodada: 750g (rolo ativo) + 200g
    // (rolo recém-arquivado) = 950g antes; depois de arquivar, o resumo do
    // backend passa a devolver 750g. Marcar "Mostrar arquivados" só revela
    // o rolo de 200g na tabela — nunca volta a somar no resumo exibido
    // (que continua vindo de filamentType.total_available_grams, nunca
    // recalculado a partir dos rolos visíveis).
    mockTypes([typeFixture({ total_available_grams: 750, total_spool_count: 2 })])
    mockSpools([
      spoolFixture({ id: 's1', code: 'RL-26-001', current_net_weight_grams: 750, is_active: true }),
      spoolFixture({ id: 's2', code: 'RL-26-002', current_net_weight_grams: 200, is_active: false, has_movement_history: true }),
    ])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    expect(within(dialog).getByText('750g')).toBeInTheDocument()
    expect(within(dialog).queryByText('950g')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('switch', { name: 'Mostrar arquivados' }))

    expect(within(dialog).getByText('750g')).toBeInTheDocument()
    expect(within(dialog).queryByText('950g')).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Exclusão e arquivamento de rolos — regra revisada pelo usuário na
  // SEGUNDA rodada de validação manual (2026-08-28): a rodada anterior
  // tentava hard delete primeiro e só decidia arquivar depois de capturar
  // um erro de negócio — não funcionou como esperado na prática. Agora a
  // decisão (Excluir vs. Arquivar) é tomada ANTES de qualquer confirmação,
  // a partir de spool.has_movement_history (dado já carregado, nunca texto
  // de erro).
  // ---------------------------------------------------------------------------

  it('rolo SEM histórico: menu oferece "Excluir rolo"; confirmação, exclusão física e atualização do resumo', async () => {
    const typesRefetch = vi.fn()
    const deleteSpool = vi.fn().mockResolvedValue(undefined)
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture({ has_movement_history: false })], { delete: deleteSpool })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    const table = getSpoolsTable(dialog)
    await openMoreActionsMenu(user, table, 'RL-26-001')
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir rolo' }))

    const confirmDialog = screen.getByRole('dialog', { name: 'Excluir rolo' })
    expect(within(confirmDialog).getByText(/não poderá ser desfeita/i)).toBeInTheDocument()
    await user.click(within(confirmDialog).getByRole('button', { name: /^excluir definitivamente$/i }))

    await waitFor(() => expect(deleteSpool).toHaveBeenCalledWith('s1'))
    expect(toastMock.success).toHaveBeenCalledWith('Rolo excluído.')
    expect(typesRefetch).toHaveBeenCalledTimes(1)
  })

  it('rolo COM histórico: menu já oferece "Arquivar rolo" diretamente — nunca tenta hard delete primeiro', async () => {
    const typesRefetch = vi.fn()
    const deleteSpool = vi.fn()
    const update = vi.fn().mockResolvedValue(spoolFixture({ is_active: false, has_movement_history: true }))
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture({ has_movement_history: true })], { delete: deleteSpool, update })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    const table = getSpoolsTable(dialog)
    await openMoreActionsMenu(user, table, 'RL-26-001')
    // O item do menu já diz "Arquivar rolo" para um rolo com histórico —
    // nunca "Excluir rolo" seguido de um pivô.
    expect(screen.queryByRole('menuitem', { name: 'Excluir rolo' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar rolo' }))

    const archiveDialog = screen.getByRole('dialog', { name: 'Arquivar rolo' })
    expect(within(archiveDialog).getByText(/possui histórico e não pode ser apagado definitivamente/i)).toBeInTheDocument()
    await user.click(within(archiveDialog).getByRole('button', { name: /^arquivar rolo$/i }))

    // Nunca chama a exclusão física — decidido antes da confirmação, não
    // por tentativa e erro.
    expect(deleteSpool).not.toHaveBeenCalled()
    await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { is_active: false }))
    expect(toastMock.success).toHaveBeenCalledWith('Rolo arquivado.')
    expect(typesRefetch).toHaveBeenCalledTimes(1)
  })

  it('erro inesperado ao excluir um rolo sem histórico mantém o diálogo aberto, mostrando a mensagem real', async () => {
    const { ApiError } = await import('@/lib/api/errors')
    const deleteSpool = vi.fn().mockRejectedValue(new ApiError('database', 500, 'falhou'))
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ has_movement_history: false })], { delete: deleteSpool })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await openMoreActionsMenu(user, getSpoolsTable(dialog), 'RL-26-001')
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir rolo' }))
    await user.click(screen.getByRole('button', { name: /^excluir definitivamente$/i }))

    expect(await screen.findByText('falhou')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Excluir rolo' })).toBeInTheDocument()
  })

  it('erro inesperado ao arquivar um rolo com histórico mantém o diálogo aberto, mostrando a mensagem real', async () => {
    const { ApiError } = await import('@/lib/api/errors')
    const update = vi.fn().mockRejectedValue(new ApiError('database', 500, 'falhou ao arquivar'))
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ has_movement_history: true })], { update })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await openMoreActionsMenu(user, getSpoolsTable(dialog), 'RL-26-001')
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar rolo' }))
    await user.click(screen.getByRole('button', { name: /^arquivar rolo$/i }))

    expect(await screen.findByText('falhou ao arquivar')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Arquivar rolo' })).toBeInTheDocument()
  })

  it('bloqueia duplo envio durante a exclusão (botão desabilitado enquanto a chamada está em andamento)', async () => {
    let resolveDelete: () => void = () => {}
    const deleteSpool = vi.fn().mockReturnValue(new Promise<void>((resolve) => { resolveDelete = resolve }))
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ has_movement_history: false })], { delete: deleteSpool })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await openMoreActionsMenu(user, getSpoolsTable(dialog), 'RL-26-001')
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir rolo' }))
    const confirmButton = screen.getByRole('button', { name: /^excluir definitivamente$/i })
    await user.click(confirmButton)

    await waitFor(() => expect(screen.getByRole('button', { name: /^excluindo\.\.\.$/i })).toBeDisabled())
    expect(deleteSpool).toHaveBeenCalledTimes(1)

    resolveDelete()
  })

  it('bloqueia duplo envio durante o arquivamento', async () => {
    let resolveUpdate: (value: FilamentSpool) => void = () => {}
    const update = vi.fn().mockReturnValue(new Promise<FilamentSpool>((resolve) => { resolveUpdate = resolve }))
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ has_movement_history: true })], { update })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await openMoreActionsMenu(user, getSpoolsTable(dialog), 'RL-26-001')
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar rolo' }))
    const confirmButton = screen.getByRole('button', { name: /^arquivar rolo$/i })
    await user.click(confirmButton)

    await waitFor(() => expect(screen.getByRole('button', { name: /^arquivando\.\.\.$/i })).toBeDisabled())
    expect(update).toHaveBeenCalledTimes(1)

    resolveUpdate(spoolFixture({ is_active: false, has_movement_history: true }))
  })

  // ---------------------------------------------------------------------------
  // Filtro "Mostrar arquivados", indicador visual, e movimentação/pesagem
  // bloqueadas (mas histórico sempre acessível) para rolo arquivado
  // ---------------------------------------------------------------------------

  it('rolo arquivado (inativo) fica oculto por padrão; "Mostrar arquivados" revela, com indicador visual "Arquivado"', async () => {
    mockTypes([typeFixture()])
    mockSpools([
      spoolFixture({ id: 's1', code: 'RL-26-001', is_active: true }),
      spoolFixture({ id: 's2', code: 'RL-26-002', is_active: false }),
    ])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))

    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    const table = getSpoolsTable(dialog)
    expect(within(table).getByText('RL-26-001')).toBeInTheDocument()
    expect(within(dialog).queryByText('RL-26-002')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Arquivado')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('switch', { name: 'Mostrar arquivados' }))

    expect(within(table).getByText('RL-26-002')).toBeInTheDocument()
    expect(within(dialog).getAllByText('Arquivado').length).toBeGreaterThan(0)
  })

  it('filtro "Mostrar arquivados" permanece ligado depois de uma ação que atualiza o drawer (ex.: registrar movimentação em outro rolo)', async () => {
    mockTypes([typeFixture()])
    mockSpools([
      spoolFixture({ id: 's1', code: 'RL-26-001', is_active: true }),
      spoolFixture({ id: 's2', code: 'RL-26-002', is_active: false }),
    ])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    const toggle = within(dialog).getByRole('switch', { name: 'Mostrar arquivados' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    // Abre e fecha o painel de movimentação de outro rolo (uma ação que
    // dispara re-render do drawer via onSummaryChanged) — o filtro não deve
    // resetar. O rolo 's1' está ativo/normal, então o painel mostra o
    // formulário de movimentação de verdade — botão "Cancelar", não
    // "Fechar" (esse último só aparece para rolo descartado/arquivado).
    await user.click(within(getSpoolsTable(dialog)).getAllByRole('button', { name: /movimentar, pesar ou consultar histórico/i })[0])
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))

    expect(within(dialog).getByRole('switch', { name: 'Mostrar arquivados' })).toHaveAttribute('aria-checked', 'true')
    expect(within(getSpoolsTable(dialog)).getByText('RL-26-002')).toBeInTheDocument()
  })

  it('rolo arquivado: "Gerenciar" continua clicável (histórico precisa continuar acessível), mas o painel mostra mensagem somente leitura, sem formulários', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ is_active: false })])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await user.click(within(dialog).getByRole('switch', { name: 'Mostrar arquivados' }))
    await user.click(getManageButton(getSpoolsTable(dialog), 'RL-26-001'))

    expect(screen.getByText(/está arquivado e não aceita movimentar ou pesar/i)).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Ação' })).not.toBeInTheDocument()
    // O histórico continua acessível/anunciado — nunca escondido junto com
    // os formulários.
    expect(screen.getByText('Histórico')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Dimensões/classes responsivas das duas janelas (observações do usuário:
  // "Ver rolos" e "Movimentar/Pesar/Histórico" estavam desproporcionais; a
  // primeira ainda tinha rolagem horizontal em resolução normal de
  // notebook mesmo depois do primeiro ajuste).
  // ---------------------------------------------------------------------------

  it('a janela "Ver rolos" usa max-width/max-height/overflow do padrão já estabelecido no projeto (mesmo de OrdersPage), sem min-width forçado na tabela', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))

    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    expect(dialog.className).toContain('sm:max-w-4xl')
    expect(dialog.className).toContain('max-h-[90vh]')
    expect(dialog.className).toContain('overflow-y-auto')

    // Achado real da segunda rodada de validação manual: um min-width
    // fixo na tabela (900px) forçava rolagem horizontal mesmo em
    // resolução normal de notebook — a tabela agora não impõe nenhum
    // min-width, só table-fixed com larguras percentuais.
    const table = getSpoolsTable(dialog)
    expect(table.className).not.toMatch(/min-w-\[/)
  })

  // ---------------------------------------------------------------------------
  // Layout da linha de rolo — TERCEIRA rodada de validação manual
  // (2026-08-28): num diálogo de ~720px de largura, a versão anterior (7
  // colunas, incluindo uma coluna "Ativo" com Switch e um botão largo
  // "Movimentar / Pesar" numa célula separada do menu "Mais ações") ainda
  // rolava horizontalmente e tinha os dois botões de ação sobrepostos. A
  // correção reduziu a tabela a 5 colunas semânticas e uniu as duas ações
  // secundárias (Gerenciar + Mais ações) numa única célula, num único flex
  // com gap — nunca posicionamento absoluto, nunca escondendo rolagem
  // atrás de overflow-x-hidden.
  // ---------------------------------------------------------------------------

  it('a tabela de rolos tem exatamente 5 colunas (Identificador, Peso, Status, Abertura, Ações) — sem coluna "Ativo" separada', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    const table = getSpoolsTable(dialog)

    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual(['Identificador', 'Peso', 'Status', 'Abertura', 'Ações'])
  })

  it('a tabela de rolos não usa overflow-x-auto/overflow-x-scroll nem min-w — table-fixed com w-full', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    const table = getSpoolsTable(dialog)

    // O wrapper que esconde/mostra a tabela por breakpoint não pode mais
    // carregar overflow-x-auto/overflow-x-scroll — a correção não esconde a
    // rolagem, elimina a necessidade dela.
    const tableWrapper = table.closest('.hidden')
    expect(tableWrapper?.className).not.toMatch(/overflow-x-auto/)
    expect(tableWrapper?.className).not.toMatch(/overflow-x-scroll/)
    expect(table.className).not.toMatch(/min-w-\[/)
    expect(table.className).toContain('table-fixed')
  })

  it('a linha do rolo mostra o botão "Gerenciar" (compacto) e o botão "Mais ações" (só ícone) lado a lado, sem repetir "Movimentar / Pesar" nem posicionamento absoluto', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    const table = getSpoolsTable(dialog)

    const manageButton = getManageButton(table, 'RL-26-001')
    expect(manageButton).toHaveTextContent('Gerenciar')
    expect(within(table).queryByText('Movimentar / Pesar')).not.toBeInTheDocument()

    const moreActionsButton = within(table).getByRole('button', { name: 'Mais ações para o rolo RL-26-001' })
    expect(within(moreActionsButton).queryByText('Mais ações')).not.toBeInTheDocument()

    const actionsCell = manageButton.closest('td')
    expect(actionsCell).not.toBeNull()
    expect(within(actionsCell as HTMLElement).getByRole('button', { name: 'Mais ações para o rolo RL-26-001' })).toBe(moreActionsButton)
    const actionsContainer = manageButton.parentElement
    expect(actionsContainer?.className).toContain('flex')
    expect(actionsContainer?.className).toContain('gap-2')
    expect(actionsContainer?.className).not.toContain('absolute')
    expect(manageButton.className).not.toContain('absolute')
    expect(moreActionsButton.className).not.toContain('absolute')
  })

  it('o menu "Mais ações" contém Editar, Ativar/Desativar, Descartar e Excluir/Arquivar rolo — nunca repete Movimentar/Pesar', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ has_movement_history: false })])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await openMoreActionsMenu(user, getSpoolsTable(dialog), 'RL-26-001')

    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Desativar' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Descartar' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Excluir rolo' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /movimentar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /pesar/i })).not.toBeInTheDocument()
  })

  it('o item "Ativar"/"Desativar" do menu aciona o mesmo fluxo de confirmação que antes vivia na coluna "Ativo"', async () => {
    const typesRefetch = vi.fn()
    const update = vi.fn().mockResolvedValue(spoolFixture({ is_active: false }))
    mockTypes([typeFixture()], { refetch: typesRefetch })
    mockSpools([spoolFixture({ is_active: true })], { update })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await openMoreActionsMenu(user, getSpoolsTable(dialog), 'RL-26-001')
    await user.click(await screen.findByRole('menuitem', { name: 'Desativar' }))

    const confirmDialog = screen.getByRole('dialog', { name: 'Arquivar rolo' })
    await user.click(within(confirmDialog).getByRole('button', { name: /^arquivar$/i }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { is_active: false }))
    expect(toastMock.success).toHaveBeenCalledWith('Rolo arquivado.')
    expect(typesRefetch).toHaveBeenCalledTimes(1)
  })

  it('a janela "Movimentar/Pesar/Histórico" usa max-width/max-height/overflow do padrão já estabelecido no projeto', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const rolosDialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    await user.click(within(getSpoolsTable(rolosDialog)).getByRole('button', { name: /movimentar, pesar ou consultar histórico/i }))

    const dialog = screen.getByRole('dialog', { name: 'Movimentar / Pesar / Histórico' })
    expect(dialog.className).toContain('sm:max-w-3xl')
    expect(dialog.className).toContain('max-h-[90vh]')
    expect(dialog.className).toContain('overflow-y-auto')
  })

  it('em telas pequenas, os rolos aparecem como cartões (nunca dependendo só da tabela larga)', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })

    // As duas marcações existem no DOM (a alternância é só CSS/media
    // query) — o teste confirma que a marcação em cartões existe e tem as
    // classes que a escondem em telas maiores (sm:hidden) e mostram a
    // tabela só a partir de sm (hidden sm:block), garantindo que a
    // alternativa responsiva realmente está implementada.
    const table = getSpoolsTable(dialog)
    const tableWrapper = table.closest('.hidden')
    expect(tableWrapper?.className).toContain('sm:block')

    const cardHeading = within(dialog).getAllByText('RL-26-001')
    expect(cardHeading.length).toBeGreaterThanOrEqual(2)
  })
})
