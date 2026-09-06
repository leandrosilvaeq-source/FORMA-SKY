import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

// Referência curta da compra que originou a movimentação (2026-09-06):
// "Ref. <8 primeiros caracteres do id>" — nunca o UUID completo, que
// prejudicaria a leitura. Só para movimentações de compra
// (reference_type === 'PURCHASE'); qualquer outra referência (ou nenhuma)
// não mostra nada.
function purchaseShortRef(movement: StockMovement): string | null {
  if (movement.reference_type !== 'PURCHASE' || !movement.reference_id) return null
  return `Ref. ${movement.reference_id.slice(0, 8)}`
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
  // `responsive` (2026-09-06): usado só pela janela dedicada de Histórico de
  // Acessórios (AccessoryHistoryDialog). Sem ele, o layout é EXATAMENTE o de
  // sempre — 6 colunas dentro de um contêiner overflow-x-auto — preservado
  // integralmente para o painel "Movimentar estoque" de Embalagens
  // (StockMovementPanel), que não passa este prop. Com ele: desktop em
  // tabela de largura total (sem rolagem horizontal), 5 colunas (a coluna
  // "Referência", sempre "—" nesta etapa, sai), textos longos quebram
  // linha; telas estreitas usam um card por movimentação — mesmo padrão já
  // aprovado em FilamentMovementHistory.tsx.
  responsive?: boolean
}

// Histórico imutável — nenhuma ação de editar/excluir em nenhuma linha
// (mesma regra de order_status_history/payment_status_history em
// OrderManagementPanel.tsx). Nenhum dado técnico (id/item_id/created_by/
// reference_id) é exibido — só o que é legível para o usuário decidir algo.
export function StockMovementHistory({
  movements,
  isLoading,
  error,
  onRetry,
  responsive = false,
}: StockMovementHistoryProps) {
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

  if (responsive) {
    return (
      <>
        {/* Desktop: tabela de largura TOTAL do contêiner, sem min-w nem
            overflow-x-auto — 5 colunas somam 100% (table-fixed) e o texto
            variável (Tipo/Motivo) quebra linha em vez de forçar mais
            espaço. Nenhuma informação escondida só para eliminar a
            rolagem. Mesma abordagem de FilamentMovementHistory.tsx. */}
        <div className="hidden sm:block">
          <Table className="w-full table-fixed text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="h-auto w-[16%] py-2 whitespace-normal">Data</TableHead>
                <TableHead className="h-auto w-[22%] py-2 whitespace-normal">Tipo</TableHead>
                <TableHead className="h-auto w-[12%] py-2 text-right whitespace-normal">
                  Quantidade
                </TableHead>
                <TableHead className="h-auto w-[17%] py-2 text-right whitespace-normal">Saldo</TableHead>
                <TableHead className="h-auto w-[33%] py-2 whitespace-normal">
                  Motivo/Observação
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((movement) => {
                const delta = formatSignedQuantity(movement.quantity_delta)
                const shortRef = purchaseShortRef(movement)
                return (
                  <TableRow key={movement.id}>
                    <TableCell className="truncate" title={formatDateTime(movement.occurred_at)}>
                      {formatDateTime(movement.occurred_at)}
                    </TableCell>
                    <TableCell
                      className="whitespace-normal break-words"
                      title={movementTypeLabel(movement.movement_type)}
                    >
                      {movementTypeLabel(movement.movement_type)}
                      {shortRef && (
                        <span className="text-muted-foreground block text-xs">{shortRef}</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium',
                        delta.isPositive ? 'text-brand-primary-dark' : 'text-destructive',
                      )}
                    >
                      {delta.text}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {movement.balance_before} → {movement.balance_after}
                    </TableCell>
                    <TableCell className="whitespace-normal break-words" title={movement.reason ?? undefined}>
                      {movement.reason ?? '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {/* Telas estreitas: um card por movimentação — nenhum campo a menos
            que a tabela (Data, Tipo, Quantidade, Saldo, Motivo/Observação). */}
        <div className="flex flex-col gap-2 sm:hidden">
          {movements.map((movement) => {
            const delta = formatSignedQuantity(movement.quantity_delta)
            const shortRef = purchaseShortRef(movement)
            return (
              <Card key={movement.id} size="sm">
                <CardContent className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{formatDateTime(movement.occurred_at)}</span>
                  <span className="text-muted-foreground text-xs break-words">
                    Tipo: {movementTypeLabel(movement.movement_type)}
                    {shortRef ? ` · ${shortRef}` : ''}
                  </span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      delta.isPositive ? 'text-brand-primary-dark' : 'text-destructive',
                    )}
                  >
                    Quantidade: {delta.text}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Saldo: {movement.balance_before} → {movement.balance_after}
                  </span>
                  <span className="text-muted-foreground text-xs break-words">
                    Motivo/Observação: {movement.reason ?? '—'}
                  </span>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </>
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
