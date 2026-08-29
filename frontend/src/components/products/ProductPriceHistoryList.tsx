import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ProductPriceHistoryStatus } from '@/hooks/useProductPriceHistory'
import type { ProductPriceHistory } from '@/types/domain'

// "Editar produto" — seção "Histórico de preços": somente leitura, mais
// recente primeiro (o hook já devolve nessa ordem — order by effective_from
// desc), independente das seções "Dados do produto"/"Preço" acima (nunca
// dispara nem depende de nenhum salvamento). Estados de carregamento/erro/
// vazio próprios, mesmo padrão já usado em toda a Ficha Técnica/diálogos de
// composição deste projeto.

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

interface ProductPriceHistoryListProps {
  status: ProductPriceHistoryStatus
  history: ProductPriceHistory[]
  errorMessage: string | null
  onRetry: () => void
}

export function ProductPriceHistoryList({ status, history, errorMessage, onRetry }: ProductPriceHistoryListProps) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Histórico de preços</h3>

      {(status === 'idle' || status === 'loading') && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {status === 'error' && (
        <div className="border-destructive/50 bg-destructive/10 flex items-center justify-between rounded-lg border p-3 text-sm">
          <span>{errorMessage}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      )}

      {status === 'success' && history.length === 0 && (
        <p className="text-muted-foreground text-sm">Nenhum histórico de preço registrado.</p>
      )}

      {status === 'success' && history.length > 0 && (
        <div className="overflow-x-auto">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Data e hora</TableHead>
                <TableHead>Preço</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="truncate" title={formatDateTime(entry.effective_from)}>
                    {formatDateTime(entry.effective_from)}
                  </TableCell>
                  <TableCell>{formatBRL(entry.price)}</TableCell>
                  <TableCell>{entry.effective_to === null ? 'Vigente' : 'Anterior'}</TableCell>
                  <TableCell className="truncate" title={entry.reason ?? undefined}>
                    {entry.reason ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
