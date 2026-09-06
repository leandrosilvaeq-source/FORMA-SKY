import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StockMovementHistory } from './StockMovementHistory'
import { ApiError } from '@/lib/api/errors'
import type { StockMovement } from '@/types/domain'

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

describe('StockMovementHistory', () => {
  it('estado de carregamento', () => {
    render(<StockMovementHistory movements={[]} isLoading error={null} onRetry={vi.fn()} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('estado vazio', () => {
    render(<StockMovementHistory movements={[]} isLoading={false} error={null} onRetry={vi.fn()} />)
    expect(screen.getByText('Nenhuma movimentação registrada.')).toBeInTheDocument()
  })

  it('estado de erro exibe a mensagem real e um botão de tentar novamente', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <StockMovementHistory
        movements={[]}
        isLoading={false}
        error={new ApiError('database', 500, 'Falha ao carregar histórico.')}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Falha ao carregar histórico.')
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renderiza uma movimentação com tipo amigável, sinal, saldo antes/depois e motivo', () => {
    render(
      <StockMovementHistory
        movements={[movementFixture({ movement_type: 'LOSS', quantity_delta: -3, balance_before: 10, balance_after: 7, reason: 'quebrou' })]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('Perda/Avaria')).toBeInTheDocument()
    expect(screen.getByText('-3')).toBeInTheDocument()
    expect(screen.getByText('10 → 7')).toBeInTheDocument()
    expect(screen.getByText('quebrou')).toBeInTheDocument()
  })

  it('quantidade de entrada exibe sinal de mais', () => {
    render(
      <StockMovementHistory
        movements={[movementFixture({ movement_type: 'PURCHASE', quantity_delta: 5, balance_before: 0, balance_after: 5 })]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('+5')).toBeInTheDocument()
  })

  it('motivo/referência ausentes mostram travessão, nunca vazio', () => {
    render(
      <StockMovementHistory
        movements={[movementFixture({ reason: null, reference_type: null })]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('mais recentes primeiro: a ordem de renderização segue exatamente a ordem do array recebido (já ordenado pelo hook/API)', () => {
    render(
      <StockMovementHistory
        movements={[
          movementFixture({ id: 'm2', occurred_at: '2026-08-27T10:00:00Z', movement_type: 'PURCHASE' }),
          movementFixture({ id: 'm1', occurred_at: '2026-08-26T10:00:00Z', movement_type: 'RETURN' }),
        ]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )
    const rows = screen.getAllByRole('row').slice(1) // primeira linha é o cabeçalho
    expect(rows[0]).toHaveTextContent('Compra')
    expect(rows[1]).toHaveTextContent('Devolução')
  })

  it('fallback legível para movement_type desconhecido (ex.: um tipo futuro ainda não mapeado) não quebra a tela', () => {
    render(
      <StockMovementHistory
        movements={[movementFixture({ movement_type: 'RESERVATION' as StockMovement['movement_type'] })]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('RESERVATION')).toBeInTheDocument()
  })

  it('nunca exibe UUID (id/item_id/created_by) em nenhuma célula', () => {
    render(
      <StockMovementHistory
        movements={[movementFixture({ id: '11111111-1111-1111-1111-111111111111', created_by: '22222222-2222-2222-2222-222222222222' })]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.queryByText(/11111111-1111/)).not.toBeInTheDocument()
    expect(screen.queryByText(/22222222-2222/)).not.toBeInTheDocument()
  })

  it('histórico é imutável: nenhum botão de editar/excluir em nenhuma linha', () => {
    render(
      <StockMovementHistory movements={[movementFixture()]} isLoading={false} error={null} onRetry={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /excluir/i })).not.toBeInTheDocument()
  })

  it('modo responsivo: uma compra (reference_type PURCHASE) mostra "Compra" + referência curta, sem UUID completo', () => {
    const purchaseId = 'abcd1234-5678-90ab-cdef-1234567890ab'
    render(
      <StockMovementHistory
        movements={[
          movementFixture({
            movement_type: 'PURCHASE',
            reference_type: 'PURCHASE',
            reference_id: purchaseId,
            reason: 'Fornecedor: Loja X — reposição',
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        responsive
      />,
    )
    // "Compra" e "Ref. abcd1234" aparecem; o UUID completo nunca
    expect(screen.getAllByText('Compra').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ref. abcd1234').length).toBeGreaterThan(0)
    expect(screen.queryByText(new RegExp(purchaseId))).not.toBeInTheDocument()
    expect(screen.getAllByText(/Fornecedor: Loja X — reposição/).length).toBeGreaterThan(0)
  })

  it('modo responsivo: movimentação sem referência de compra não mostra "Ref."', () => {
    render(
      <StockMovementHistory
        movements={[movementFixture({ movement_type: 'POSITIVE_ADJUSTMENT', reference_type: null, reason: 'contagem' })]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        responsive
      />,
    )
    expect(screen.queryByText(/^Ref\. /)).not.toBeInTheDocument()
  })
})
