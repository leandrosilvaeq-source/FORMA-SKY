import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FilamentMovementHistory } from './FilamentMovementHistory'
import { ApiError } from '@/lib/api/errors'
import type { FilamentMovement } from '@/types/domain'

function movementFixture(overrides: Partial<FilamentMovement> = {}): FilamentMovement {
  return {
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
    ...overrides,
  }
}

describe('FilamentMovementHistory', () => {
  it('renderiza carregando, vazio e erro corretamente', () => {
    const { rerender } = render(<FilamentMovementHistory movements={[]} isLoading error={null} onRetry={vi.fn()} />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    rerender(<FilamentMovementHistory movements={[]} isLoading={false} error={null} onRetry={vi.fn()} />)
    expect(screen.getByText('Nenhuma movimentação registrada.')).toBeInTheDocument()

    rerender(
      <FilamentMovementHistory
        movements={[]}
        isLoading={false}
        error={new ApiError('database', 500, 'falhou')}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('falhou')).toBeInTheDocument()
  })

  // Achado real da validação manual (2026-08-28): a coluna Data invadia
  // visualmente a coluna Tipo — causa raiz confirmada em ui/table.tsx:
  // TableCell herda `whitespace-nowrap` por padrão, e sem `truncate`
  // (overflow-hidden + text-overflow) na própria célula de Data, um texto
  // de data/hora mais largo que a coluna (table-fixed só reserva o espaço,
  // não corta o conteúdo) desenhava por cima da célula seguinte. Este teste
  // documenta a classe que efetivamente resolve o problema — nunca
  // reaparece sem quebrar este teste.
  it('a célula de Data tem a mesma proteção contra transbordo (truncate) já usada em Tipo/Motivo — nunca invade a coluna seguinte', () => {
    render(<FilamentMovementHistory movements={[movementFixture()]} isLoading={false} error={null} onRetry={vi.fn()} />)

    const dateCell = screen.getByText(/27\/08\/2026/).closest('td')
    const typeCell = screen.getByText('Compra').closest('td')
    expect(dateCell).not.toBeNull()
    expect(typeCell).not.toBeNull()
    expect(dateCell?.className).toContain('truncate')
    expect(typeCell?.className).toContain('truncate')
  })

  it('exibe tipo/quantidade/saldo/motivo formatados, com fallback legível para um movement_type desconhecido', () => {
    render(
      <FilamentMovementHistory
        movements={[
          movementFixture({ movement_type: 'MANUAL_CONSUMPTION', quantity_delta: -50, balance_before: 600, balance_after: 550, reason: 'teste' }),
          movementFixture({ id: 'm2', movement_type: 'FUTURE_TYPE' as never }),
        ]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('Consumo manual')).toBeInTheDocument()
    expect(screen.getByText('-50g')).toBeInTheDocument()
    expect(screen.getByText('600g → 550g')).toBeInTheDocument()
    expect(screen.getByText('teste')).toBeInTheDocument()
    expect(screen.getByText('FUTURE_TYPE')).toBeInTheDocument()
  })

  it('quantidade positiva exibe sinal e cor diferentes de negativa', () => {
    render(
      <FilamentMovementHistory
        movements={[movementFixture({ id: 'a', quantity_delta: 100 }), movementFixture({ id: 'b', quantity_delta: -50 })]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('+100g').className).toContain('text-brand-primary-dark')
    expect(screen.getByText('-50g').className).toContain('text-destructive')
  })

  it('a tabela tem largura mínima e rolagem horizontal controlada (mesmo padrão das demais tabelas do projeto)', () => {
    render(<FilamentMovementHistory movements={[movementFixture()]} isLoading={false} error={null} onRetry={vi.fn()} />)
    const table = screen.getByRole('table')
    expect(table.className).toContain('min-w-[720px]')
  })
})
