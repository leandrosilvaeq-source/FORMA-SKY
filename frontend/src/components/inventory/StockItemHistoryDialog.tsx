import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { StockLevelBadge, getStockLevel } from './stockLevel'
import { StockMovementHistory } from './StockMovementHistory'
import { useStockMovements } from '@/hooks/useStockMovements'
import type { StockItemType } from '@/types/domain'

export interface StockHistoryItem {
  id: string
  name: string
  current_stock: number
  minimum_stock: number | null
}

export interface StockItemHistoryDialogProps {
  // ACCESSORY ou PACKAGING — filtra o histórico por item_type + item_id.
  itemType: StockItemType
  // Título completo já formatado pelo chamador ("Histórico do acessório" /
  // "Histórico da embalagem") — o componente nunca deriva artigo/gênero.
  title: string
  item: StockHistoryItem | null
  onClose: () => void
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

// Montado só enquanto `item` existe (key={item.id} no wrapper) —
// useStockMovements nunca é chamado com um id vazio/trocado sob o mesmo
// componente, então os históricos de itens diferentes nunca se misturam.
function StockItemHistoryContent({
  itemType,
  item,
}: {
  itemType: StockItemType
  item: StockHistoryItem
}) {
  const { movements, isLoading, loadError, refetch } = useStockMovements(itemType, item.id)
  const level = getStockLevel(item.current_stock, item.minimum_stock)

  return (
    <div className="flex flex-col gap-4">
      <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-2 gap-2 rounded-lg border px-3 py-2 sm:grid-cols-3">
        <SummaryField label="Disponível" value={String(item.current_stock)} />
        <SummaryField
          label="Estoque mínimo"
          value={item.minimum_stock !== null ? String(item.minimum_stock) : 'Não informado'}
        />
        <div className="flex flex-col gap-0.5">
          <p className="text-muted-foreground text-xs">Situação</p>
          <StockLevelBadge level={level} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Histórico</p>
        <StockMovementHistory
          movements={movements}
          isLoading={isLoading}
          error={loadError}
          onRetry={refetch}
          responsive
        />
      </div>
    </div>
  )
}

// Janela EXCLUSIVAMENTE de consulta (2026-09-06) — usada por Acessórios e
// Embalagens (itemType). Nenhum formulário de movimentação: só o resumo
// (Disponível / Estoque mínimo / Situação) e o histórico do item
// selecionado. Reaproveita a MESMA consulta (useStockMovements/
// listStockMovements, filtrada por item_type+item_id) e o MESMO componente
// de exibição (StockMovementHistory, em modo `responsive` — sem rolagem
// horizontal, cards em tela estreita).
export function StockItemHistoryDialog({ itemType, title, item, onClose }: StockItemHistoryDialogProps) {
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{item?.name}</DialogDescription>
        </DialogHeader>
        {item && <StockItemHistoryContent key={item.id} itemType={itemType} item={item} />}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
