import { useState } from 'react'
import { toast } from 'sonner'
import { StockMovementForm, type StockMovementFormValues } from './StockMovementForm'
import { StockMovementHistory } from './StockMovementHistory'
import { useStockMovements } from '@/hooks/useStockMovements'
import { ApiError } from '@/lib/api/errors'
import type { StockItemType } from '@/types/domain'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

export type StockLevel = 'empty' | 'low' | 'normal'

// Estoque baixo somente quando minimum_stock > 0 E current_stock <=
// minimum_stock (requisito explícito do pedido) — minimum_stock null ou 0
// nunca produz "baixo" (0/null significa "sem limiar definido", não
// "qualquer saldo conta como baixo"). Saldo zero é sempre "sem estoque",
// independente de minimum_stock.
export function getStockLevel(currentStock: number, minimumStock: number | null): StockLevel {
  if (currentStock <= 0) return 'empty'
  if (minimumStock !== null && minimumStock > 0 && currentStock <= minimumStock) return 'low'
  return 'normal'
}

const STOCK_LEVEL_LABELS: Record<StockLevel, string> = {
  empty: 'Sem estoque',
  low: 'Estoque baixo',
  normal: 'Estoque normal',
}

// "Destacar discretamente" (requisito do pedido) — badges pequenos, texto
// sempre presente (nunca só cor, para não depender de percepção de cor).
const STOCK_LEVEL_CLASSNAMES: Record<StockLevel, string> = {
  empty: 'border-destructive/40 bg-destructive/10 text-destructive',
  low: 'border-amber-300 bg-amber-50 text-amber-800',
  normal: 'border-input text-muted-foreground',
}

export function StockLevelBadge({ level }: { level: StockLevel }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STOCK_LEVEL_CLASSNAMES[level]}`}
    >
      {STOCK_LEVEL_LABELS[level]}
    </span>
  )
}

export interface StockMovementPanelProps {
  itemType: StockItemType
  itemId: string
  itemName: string
  // "Acessório"/"Embalagem" já formatado pelo chamador — este componente
  // nunca deriva o rótulo a partir de outra coisa.
  itemCategoryLabel: string
  currentStock: number
  minimumStock: number | null
  isActive: boolean
  // balance_after da movimentação recém-registrada — o chamador (InventoryPage)
  // aplica isso ao estado local via useAccessories/usePackaging.setLocalStock,
  // sem refetch.
  onStockChanged: (newStock: number) => void
  // Chamado só depois de sucesso — o chamador fecha o diálogo (mesmo
  // contrato de RegisterPaymentForm/InventoryItemForm: erro nunca fecha).
  onSuccess: () => void
  onClose: () => void
}

// Painel único (não diálogo aninhado): resumo do item + situação de estoque
// + formulário de movimentação + histórico recente, tudo visível de uma vez
// — mesmo espírito de OrderManagementPanel.tsx, mas com o formulário inline
// (não num Dialog dentro do Dialog), já que aqui há só uma ação principal
// por abertura, não várias ações independentes.
export function StockMovementPanel({
  itemType,
  itemId,
  itemName,
  itemCategoryLabel,
  currentStock,
  minimumStock,
  isActive,
  onStockChanged,
  onSuccess,
  onClose,
}: StockMovementPanelProps) {
  const { movements, isLoading, loadError, refetch, isRegistering, register } = useStockMovements(itemType, itemId)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const level = getStockLevel(currentStock, minimumStock)
  // Saldo inicial só é oferecido quando o saldo atual é zero E o histórico
  // (já carregado com sucesso) não tem nenhuma movimentação — enquanto o
  // histórico ainda está carregando (ou falhou), a opção fica indisponível
  // por padrão, nunca mostrada otimisticamente antes de ter certeza.
  const isEligibleForInitialBalance = currentStock === 0 && !isLoading && !loadError && movements.length === 0

  async function handleSubmit(values: StockMovementFormValues) {
    setSubmitError(null)
    try {
      const created = await register(values)
      toast.success('Movimentação registrada.')
      onStockChanged(created.balance_after)
      onSuccess()
    } catch (err) {
      setSubmitError(toErrorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-xs">{itemCategoryLabel}</p>
          <p className="text-base font-medium">{itemName}</p>
        </div>
        {!isActive && (
          <span className="border-input text-muted-foreground inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
            Inativo
          </span>
        )}
      </div>

      <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-2 gap-2 rounded-lg border px-3 py-2 sm:grid-cols-3">
        <Field label="Saldo atual" value={String(currentStock)} />
        <Field label="Estoque mínimo" value={minimumStock !== null ? String(minimumStock) : 'Não informado'} />
        <div className="flex flex-col gap-0.5">
          <p className="text-muted-foreground text-xs">Situação</p>
          <StockLevelBadge level={level} />
        </div>
      </div>

      <StockMovementForm
        currentStock={currentStock}
        isEligibleForInitialBalance={isEligibleForInitialBalance}
        isItemActive={isActive}
        isSubmitting={isRegistering}
        submitError={submitError}
        onSubmit={(values) => void handleSubmit(values)}
        onCancel={onClose}
      />

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Histórico</p>
        <StockMovementHistory movements={movements} isLoading={isLoading} error={loadError} onRetry={refetch} />
      </div>
    </div>
  )
}
