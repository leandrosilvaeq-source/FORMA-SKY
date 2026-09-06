import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StockMovementPanel } from './StockMovementPanel'
import { getStockLevel } from './stockLevel'
import { ApiError } from '@/lib/api/errors'
import type { StockMovement } from '@/types/domain'

const { useStockMovementsMock, toastMock } = vi.hoisted(() => ({
  useStockMovementsMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useStockMovements', () => ({ useStockMovements: useStockMovementsMock }))
vi.mock('sonner', () => ({ toast: toastMock }))

function movementFixture(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
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
    idempotency_key: null,
    occurred_at: '2026-08-27T12:00:00Z',
    created_by: 'u1',
    created_at: '2026-08-27T12:00:00Z',
    ...overrides,
  }
}

function mockHook(
  overrides: Partial<{
    movements: StockMovement[]
    isLoading: boolean
    loadError: ApiError | null
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
    register: overrides.register ?? vi.fn().mockResolvedValue(movementFixture()),
  })
}

function renderPanel(
  overrides: Partial<{
    currentStock: number
    minimumStock: number | null
    isActive: boolean
  }> = {},
) {
  const onStockChanged = vi.fn()
  const onSuccess = vi.fn()
  const onClose = vi.fn()
  render(
    <StockMovementPanel
      itemType="ACCESSORY"
      itemId="a1"
      itemName="Ímã 6x2"
      itemCategoryLabel="Acessório"
      currentStock={overrides.currentStock ?? 10}
      // 'minimumStock' in overrides (não ??): null é um valor explícito e
      // legítimo (sem estoque mínimo definido), diferente de "não
      // fornecido" — ?? trataria os dois casos como iguais e sempre cairia
      // no default 5, mascarando o teste de minimumStock=null.
      minimumStock={'minimumStock' in overrides ? (overrides.minimumStock ?? null) : 5}
      isActive={overrides.isActive ?? true}
      onStockChanged={onStockChanged}
      onSuccess={onSuccess}
      onClose={onClose}
    />,
  )
  return { onStockChanged, onSuccess, onClose }
}

describe('StockMovementPanel', () => {
  beforeEach(() => {
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    mockHook()
  })

  describe('getStockLevel', () => {
    it('saldo zero é sempre "empty", mesmo sem estoque mínimo definido', () => {
      expect(getStockLevel(0, null)).toBe('empty')
      expect(getStockLevel(0, 10)).toBe('empty')
    })

    it('estoque baixo só quando minimum_stock > 0 e current_stock <= minimum_stock', () => {
      expect(getStockLevel(5, 10)).toBe('low')
      expect(getStockLevel(10, 10)).toBe('low')
    })

    it('minimum_stock null ou 0 nunca produz "low"', () => {
      expect(getStockLevel(5, null)).toBe('normal')
      expect(getStockLevel(5, 0)).toBe('normal')
    })

    it('saldo acima do mínimo é "normal"', () => {
      expect(getStockLevel(20, 10)).toBe('normal')
    })
  })

  it('exibe nome, categoria, saldo atual e estoque mínimo do item', () => {
    renderPanel({ currentStock: 15, minimumStock: 5 })
    expect(screen.getByText('Ímã 6x2')).toBeInTheDocument()
    expect(screen.getByText('Acessório')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('exibe "Não informado" quando não há estoque mínimo definido', () => {
    renderPanel({ minimumStock: null })
    expect(screen.getByText('Não informado')).toBeInTheDocument()
  })

  it('exibe a situação do estoque (badge)', () => {
    renderPanel({ currentStock: 0, minimumStock: 5 })
    expect(screen.getByText('Sem estoque')).toBeInTheDocument()
  })

  it('sinaliza claramente quando o item está inativo', () => {
    renderPanel({ isActive: false })
    expect(screen.getByText('Inativo')).toBeInTheDocument()
  })

  it('não exibe o rótulo "Inativo" para um item ativo', () => {
    renderPanel({ isActive: true })
    expect(screen.queryByText('Inativo')).not.toBeInTheDocument()
  })

  it('não impede a abertura do painel para item inativo — formulário e histórico continuam visíveis', () => {
    renderPanel({ isActive: false })
    expect(screen.getByRole('radiogroup', { name: 'Movimentação' })).toBeInTheDocument()
  })

  it('Saldo inicial elegível: saldo zero e histórico vazio já carregado', async () => {
    mockHook({ movements: [], isLoading: false })
    const user = userEvent.setup()
    renderPanel({ currentStock: 0 })
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    expect(screen.getByRole('radio', { name: 'Saldo inicial' })).toBeInTheDocument()
  })

  it('Saldo inicial inelegível: já existe histórico', async () => {
    mockHook({ movements: [movementFixture()], isLoading: false })
    const user = userEvent.setup()
    renderPanel({ currentStock: 0 })
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    expect(screen.queryByRole('radio', { name: 'Saldo inicial' })).not.toBeInTheDocument()
  })

  it('Saldo inicial inelegível: saldo atual diferente de zero', async () => {
    mockHook({ movements: [], isLoading: false })
    const user = userEvent.setup()
    renderPanel({ currentStock: 5 })
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    expect(screen.queryByRole('radio', { name: 'Saldo inicial' })).not.toBeInTheDocument()
  })

  it('Saldo inicial inelegível enquanto o histórico ainda está carregando', async () => {
    mockHook({ movements: [], isLoading: true })
    const user = userEvent.setup()
    renderPanel({ currentStock: 0 })
    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    expect(screen.queryByRole('radio', { name: 'Saldo inicial' })).not.toBeInTheDocument()
  })

  it('renderiza o histórico recebido do hook', () => {
    mockHook({ movements: [movementFixture({ movement_type: 'RETURN' })] })
    renderPanel()
    expect(screen.getByText('Devolução')).toBeInTheDocument()
  })

  it('envia a movimentação, mostra toast de sucesso, atualiza o saldo e fecha', async () => {
    const registered = movementFixture({ balance_after: 20 })
    const register = vi.fn().mockResolvedValue(registered)
    mockHook({ register })
    const user = userEvent.setup()
    const { onStockChanged, onSuccess } = renderPanel({ currentStock: 10 })

    await user.click(screen.getByRole('radio', { name: 'Entrada' }))
    await user.click(screen.getByRole('radio', { name: 'Compra' }))
    await user.type(screen.getByLabelText('Quantidade'), '10')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(toastMock.success).toHaveBeenCalledWith('Movimentação registrada.')
    expect(onStockChanged).toHaveBeenCalledWith(20)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('erro real do backend fica visível no formulário e o painel não fecha nem chama onStockChanged', async () => {
    const register = vi.fn().mockRejectedValue(new ApiError('business_rule', 409, 'saldo insuficiente para esta operação'))
    mockHook({ register })
    const user = userEvent.setup()
    const { onStockChanged, onSuccess } = renderPanel({ currentStock: 10 })

    await user.click(screen.getByRole('radio', { name: 'Saída' }))
    await user.click(screen.getByRole('radio', { name: 'Uso interno' }))
    await user.type(screen.getByLabelText('Quantidade'), '5')
    await user.type(screen.getByLabelText(/motivo\/observação/i), 'teste')
    await user.click(screen.getByRole('button', { name: /^registrar movimentação$/i }))

    expect(await screen.findByText('saldo insuficiente para esta operação')).toBeInTheDocument()
    expect(onStockChanged).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('botão Cancelar do formulário fecha o painel (onClose)', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPanel()
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
