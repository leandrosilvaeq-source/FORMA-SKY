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

  it('abrir "Ver rolos" mostra os rolos do tipo com identificador, pesos, % restante e status', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))

    const dialog = screen.getByRole('dialog', { name: 'Rolos do tipo' })
    expect(within(dialog).getByText('RL-26-001')).toBeInTheDocument()
    expect(within(dialog).getByText('50%')).toBeInTheDocument()
    expect(within(dialog).getByText('ABERTO')).toBeInTheDocument()
  })

  it('registra uma movimentação de um rolo e atualiza o saldo local (sem refetch)', async () => {
    const setLocalSpoolState = vi.fn()
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
    mockTypes([typeFixture()])
    mockSpools([spoolFixture()], { setLocalSpoolState })
    mockMovements({ register })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    await user.click(screen.getByRole('button', { name: /movimentar, pesar ou consultar histórico/i }))
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    await user.click(screen.getByRole('radio', { name: 'Compra' }))
    await user.type(screen.getByLabelText('Quantidade (g)'), '100')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(setLocalSpoolState).toHaveBeenCalledWith('s1', { current_net_weight_grams: 600, status: undefined })
    expect(toastMock.success).toHaveBeenCalledWith('Movimentação registrada.')
  })

  it('rolo descartado não exibe os formulários de movimentação/pesagem, só o histórico', async () => {
    mockTypes([typeFixture()])
    mockSpools([spoolFixture({ status: 'DESCARTADO' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Ver rolos' }))
    await user.click(screen.getByRole('button', { name: /movimentar, pesar ou consultar histórico/i }))

    expect(screen.getByText(/foi descartado e não aceita novas movimentações/i)).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Movimentação' })).not.toBeInTheDocument()
  })
})
