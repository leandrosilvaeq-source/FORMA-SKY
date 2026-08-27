import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ApiError } from '@/lib/api/errors'
import { cn } from '@/lib/utils'
import type { StockMovement, StockMovementType } from '@/types/domain'

// Rótulos amigáveis para as 8 movement_type manuais desta etapa
// (register_stock_movement(), migration 20260827090000). Um tipo futuro
// desconhecido (ex.: RESERVATION/CONSUMPTION, ainda não implementados —
// Incrementos 5/7/8) nunca quebra a tela: movementTypeLabel() abaixo cai de
// volta no valor bruto em vez de lançar/renderizar undefined.
const MOVEMENT_TYPE_LABELS: Partial<Record<StockMovementType, string>> = {
  INITIAL_BALANCE: 'Saldo inicial',
  PURCHASE: 'Compra',
  RETURN: 'Devolução',
  POSITIVE_ADJUSTMENT: 'Ajuste positivo',
  NEGATIVE_ADJUSTMENT: 'Ajuste negativo',
  LOSS: 'Perda/Avaria',
  SAMPLE_DONATION: 'Amostra/Doação',
  INTERNAL_USE: 'Uso interno',
}

function movementTypeLabel(type: string): string {
  return MOVEMENT_TYPE_LABELS[type as StockMovementType] ?? type
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// quantity_delta já carrega o sinal correto (entrada: positivo; saída:
// negativo) diretamente do backend — nunca recalculado aqui, só formatado.
function formatSignedQuantity(delta: number): { text: string; isPositive: boolean } {
  return { text: delta > 0 ? `+${delta}` : String(delta), isPositive: delta > 0 }
}

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

export interface StockMovementHistoryProps {
  movements: StockMovement[]
  isLoading: boolean
  error: ApiError | null
  onRetry: () => void
}

// Histórico imutável — nenhuma ação de editar/excluir em nenhuma linha
// (mesma regra de order_status_history/payment_status_history em
// OrderManagementPanel.tsx). Nenhum dado técnico (id/item_id/created_by/
// reference_id) é exibido — só o que é legível para o usuário decidir algo.
export function StockMovementHistory({ movements, isLoading, error, onRetry }: StockMovementHistoryProps) {
  if (isLoading) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <span className="sr-only">Carregando histórico...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div
        role="alert"
        className="border-destructive/50 bg-destructive/10 flex items-center justify-between rounded-lg border p-3 text-sm"
      >
        <span>{toErrorMessage(error)}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  if (movements.length === 0) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Nenhuma movimentação registrada.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table className="table-fixed text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="h-auto w-[18%] py-2 whitespace-normal">Data</TableHead>
            <TableHead className="h-auto w-[18%] py-2 whitespace-normal">Tipo</TableHead>
            <TableHead className="h-auto w-[12%] py-2 text-right whitespace-normal">Quantidade</TableHead>
            <TableHead className="h-auto w-[14%] py-2 text-right whitespace-normal">Saldo</TableHead>
            <TableHead className="h-auto w-[26%] py-2 whitespace-normal">Motivo/Observação</TableHead>
            <TableHead className="h-auto w-[12%] py-2 whitespace-normal">Referência</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movements.map((movement) => {
            const delta = formatSignedQuantity(movement.quantity_delta)
            return (
              <TableRow key={movement.id}>
                <TableCell>{formatDateTime(movement.occurred_at)}</TableCell>
                <TableCell className="truncate" title={movementTypeLabel(movement.movement_type)}>
                  {movementTypeLabel(movement.movement_type)}
                </TableCell>
                <TableCell
                  className={cn('text-right font-medium', delta.isPositive ? 'text-brand-primary-dark' : 'text-destructive')}
                >
                  {delta.text}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {movement.balance_before} → {movement.balance_after}
                </TableCell>
                <TableCell className="truncate" title={movement.reason ?? undefined}>
                  {movement.reason ?? '—'}
                </TableCell>
                <TableCell className="truncate" title={movement.reference_type ?? undefined}>
                  {movement.reference_type ?? '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
