import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

  // Data no histórico (2026-09-06): dd/mm/aa HH:mm no fuso America/Sao_Paulo,
  // sem alterar o valor gravado. Um movimento PURCHASE de compra (incl.
  // compra mista) grava occurred_at ancorado ao meio-dia SP.
  it('exibe occurred_at como dd/mm/aa HH:mm (America/Sao_Paulo), sem deslocar o dia', () => {
    render(
      <FilamentMovementHistory
        movements={[
          movementFixture({ movement_type: 'PURCHASE', occurred_at: '2026-09-06T15:00:00Z' }),
        ]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )
    // 2026-09-06 12:00 America/Sao_Paulo -> "06/09/26 12:00", nunca "06/09/2026" nem 05/09
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('06/09/26 12:00').length).toBeGreaterThan(0)
    expect(within(table).queryByText(/06\/09\/2026/)).not.toBeInTheDocument()
    expect(within(table).queryByText(/05\/09\/26/)).not.toBeInTheDocument()
  })

  // Achado real da validação manual (2026-08-28, primeira rodada): a coluna
  // Data invadia visualmente a coluna Tipo — causa raiz confirmada em
  // ui/table.tsx: TableCell herda `whitespace-nowrap` por padrão, e sem
  // `truncate` na célula de Data, um texto de data/hora mais largo que a
  // coluna (table-fixed só reserva o espaço, não corta o conteúdo)
  // desenhava por cima da célula seguinte.
  it('a célula de Data tem truncate — nunca invade a coluna Tipo', () => {
    render(<FilamentMovementHistory movements={[movementFixture()]} isLoading={false} error={null} onRetry={vi.fn()} />)

    // Escopado à tabela (desktop) — o mesmo texto de data também aparece no
    // card mobile equivalente, sempre presente no DOM junto com a tabela
    // (a alternância é só por CSS/breakpoint, não por montagem condicional).
    const table = screen.getByRole('table')
    const dateCell = within(table).getByText(/27\/08\/26/).closest('td')
    expect(dateCell).not.toBeNull()
    expect(dateCell?.className).toContain('truncate')
  })

  // Achado real da validação manual (2026-08-28, SEGUNDA rodada): o mesmo
  // truncate aplicado à célula de Tipo (fix da rodada anterior) cortava
  // rótulos mais longos do próprio Tipo (ex. "Ajuste por pesagem"), então o
  // texto completo deixava de aparecer. Tipo precisa poder quebrar linha em
  // vez de truncar — table-fixed já garante que isso nunca invade a coluna
  // seguinte, então não há motivo para escondê-lo atrás de "...".
  it('a célula de Tipo NUNCA usa truncate — permite quebra de linha para mostrar o rótulo completo', () => {
    render(
      <FilamentMovementHistory
        movements={[movementFixture({ movement_type: 'WEIGHING_ADJUSTMENT' })]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    const typeCell = screen.getByText('Ajuste por pesagem').closest('td')
    expect(typeCell).not.toBeNull()
    expect(typeCell?.className).not.toContain('truncate')
    expect(typeCell?.className).toContain('whitespace-normal')
    expect(typeCell?.className).toContain('break-words')
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

  // Achado da validação manual (2026-09-05): um min-w-[700px] antigo
  // forçava a tabela a ser mais larga que a janela "Histórico do rolo",
  // fazendo o wrapper `overflow-x-auto` (sempre presente no componente
  // base `Table`, ui/table.tsx, em toda tabela do projeto) exibir de fato
  // uma barra de rolagem horizontal. As colunas agora preenchem 100% do
  // contêiner (table-fixed, sem largura mínima fixa) — a tabela nunca
  // precisa de mais espaço do que o disponível, então o wrapper nunca
  // ativa a rolagem na prática.
  it('a tabela ocupa 100% do contêiner, sem largura mínima fixa', () => {
    render(<FilamentMovementHistory movements={[movementFixture()]} isLoading={false} error={null} onRetry={vi.fn()} />)
    const table = screen.getByRole('table')
    expect(table.className).toContain('w-full')
    expect(table.className).not.toMatch(/min-w-/)
  })

  // Requisito 2026-09-05: um motivo longo deve quebrar linha na própria
  // célula (mesmo tratamento já dado à coluna Tipo), nunca cortado por
  // truncate/ellipsis — o texto completo precisa ficar visível sem depender
  // só do tooltip.
  it('a célula de Motivo/Observação NUNCA usa truncate — permite quebra de linha para um motivo longo', () => {
    const longReason =
      'Ajuste registrado após pesagem física detalhada em balança de precisão do laboratório, motivo bastante extenso para testar a quebra de linha'
    render(
      <FilamentMovementHistory
        movements={[movementFixture({ reason: longReason })]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    const table = screen.getByRole('table')
    const reasonCell = within(table).getByText(longReason).closest('td')
    expect(reasonCell).not.toBeNull()
    expect(reasonCell?.className).not.toContain('truncate')
    expect(reasonCell?.className).toContain('whitespace-normal')
    expect(reasonCell?.className).toContain('break-words')
  })

  // Telas estreitas (2026-09-05): as linhas viram cards, preservando todos
  // os 5 campos exigidos — Data, Tipo, Quantidade, Saldo e
  // Motivo/Observação — nenhuma informação a menos que a tabela.
  it('em telas estreitas, cada movimentação vira um card com Data/Tipo/Quantidade/Saldo/Motivo — mesmos dados da tabela', () => {
    render(
      <FilamentMovementHistory
        movements={[
          movementFixture({
            movement_type: 'MANUAL_CONSUMPTION',
            quantity_delta: -50,
            balance_before: 600,
            balance_after: 550,
            reason: 'teste',
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    )

    const cards = document.querySelectorAll('[data-slot="card"]')
    expect(cards).toHaveLength(1)
    const card = within(cards[0] as HTMLElement)
    expect(card.getByText(/27\/08\/26/)).toBeInTheDocument()
    expect(card.getByText('Tipo: Consumo manual')).toBeInTheDocument()
    expect(card.getByText('Quantidade: -50g')).toBeInTheDocument()
    expect(card.getByText('Saldo: 600g → 550g')).toBeInTheDocument()
    expect(card.getByText('Motivo/Observação: teste')).toBeInTheDocument()
  })
})
