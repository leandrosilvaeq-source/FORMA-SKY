import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ApiError } from '@/lib/api/errors'
import { cn } from '@/lib/utils'
import type { FilamentMovement, FilamentMovementType } from '@/types/domain'

// Rótulos amigáveis para os 9 movement_type de filamento
// (register_filament_movement/register_filament_weighing, migration
// 20260827110000). Um tipo futuro desconhecido nunca quebra a tela —
// movementTypeLabel() cai de volta no valor bruto.
const MOVEMENT_TYPE_LABELS: Partial<Record<FilamentMovementType, string>> = {
  INITIAL_BALANCE: 'Saldo inicial',
  PURCHASE: 'Compra',
  RETURN: 'Devolução',
  POSITIVE_ADJUSTMENT: 'Ajuste positivo',
  NEGATIVE_ADJUSTMENT: 'Ajuste negativo',
  MANUAL_CONSUMPTION: 'Consumo manual',
  LOSS: 'Perda/Avaria',
  SAMPLE_TEST: 'Amostra/Teste',
  WEIGHING_ADJUSTMENT: 'Ajuste por pesagem',
}

function movementTypeLabel(type: string): string {
  return MOVEMENT_TYPE_LABELS[type as FilamentMovementType] ?? type
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}g`
}

// quantity_delta já carrega o sinal correto — nunca recalculado aqui, só
// formatado.
function formatSignedQuantity(delta: number): { text: string; isPositive: boolean } {
  return { text: `${delta > 0 ? '+' : ''}${formatGrams(delta)}`, isPositive: delta > 0 }
}

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

export interface FilamentMovementHistoryProps {
  movements: FilamentMovement[]
  isLoading: boolean
  error: ApiError | null
  onRetry: () => void
}

// Histórico imutável — nenhuma ação de editar/excluir em nenhuma linha,
// mesmo padrão de StockMovementHistory.tsx.
export function FilamentMovementHistory({ movements, isLoading, error, onRetry }: FilamentMovementHistoryProps) {
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
      <Table className="min-w-[700px] table-fixed text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="h-auto w-[16%] py-2 whitespace-normal">Data</TableHead>
            <TableHead className="h-auto w-[22%] py-2 whitespace-normal">Tipo</TableHead>
            <TableHead className="h-auto w-[12%] py-2 text-right whitespace-normal">Quantidade</TableHead>
            <TableHead className="h-auto w-[17%] py-2 text-right whitespace-normal">Saldo</TableHead>
            <TableHead className="h-auto w-[33%] py-2 whitespace-normal">Motivo/Observação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movements.map((movement) => {
            const delta = formatSignedQuantity(movement.quantity_delta)
            return (
              <TableRow key={movement.id}>
                {/* Data/Hora: table-fixed constrange a LARGURA da coluna,
                    mas TableCell herda whitespace-nowrap por padrão (ver
                    ui/table.tsx) — sem truncate/overflow-hidden aqui, um
                    texto de data mais longo que a coluna transbordava
                    visualmente por cima da coluna Tipo em vez de quebrar ou
                    cortar (achado real da validação manual, 2026-08-28).
                    truncate resolve definitivamente: nunca invade a coluna
                    seguinte, mesmo num valor de data anormalmente longo. Só
                    a Data usa truncate — é um valor atômico de formato fixo,
                    nunca precisa ser lido por extenso além do que já cabe. */}
                <TableCell className="truncate" title={formatDateTime(movement.occurred_at)}>
                  {formatDateTime(movement.occurred_at)}
                </TableCell>
                {/* Tipo: NUNCA truncate aqui (achado real da validação
                    manual seguinte, 2026-08-28 — segunda rodada: o mesmo
                    truncate que corrigiu a invasão de Data cortava rótulos
                    mais longos do próprio Tipo, ex. "Ajuste por pesagem").
                    whitespace-normal + break-words permite quebra de linha
                    controlada dentro da própria coluna (table-fixed já
                    impede invadir a coluna seguinte) — o texto completo
                    fica sempre visível, sem depender só do tooltip. */}
                <TableCell className="whitespace-normal break-words" title={movementTypeLabel(movement.movement_type)}>
                  {movementTypeLabel(movement.movement_type)}
                </TableCell>
                <TableCell
                  className={cn('text-right font-medium', delta.isPositive ? 'text-brand-primary-dark' : 'text-destructive')}
                >
                  {delta.text}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatGrams(movement.balance_before)} → {formatGrams(movement.balance_after)}
                </TableCell>
                <TableCell className="truncate" title={movement.reason ?? undefined}>
                  {movement.reason ?? '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
