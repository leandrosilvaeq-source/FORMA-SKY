import { createElement } from 'react'

// Nível de estoque (sem estoque / baixo / normal) + badge de exibição.
// Extraído de StockMovementPanel.tsx (2026-09-06) para um módulo neutro: os
// diálogos de Ajuste/Histórico e a listagem de Estoque consomem estas peças
// sem depender do painel de movimentação completo. Todos os consumidores
// (StockMovementPanel, FilamentTypeDrawer, FilamentsInventoryPage,
// InventoryPage) importam daqui diretamente — este é o único ponto de
// definição.

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

// Sem JSX (arquivo .ts) — createElement evita converter este módulo em .tsx
// só por um <span>. Comportamento e classes idênticos ao badge anterior.
export function StockLevelBadge({ level }: { level: StockLevel }) {
  return createElement(
    'span',
    {
      className: `inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STOCK_LEVEL_CLASSNAMES[level]}`,
    },
    STOCK_LEVEL_LABELS[level],
  )
}
