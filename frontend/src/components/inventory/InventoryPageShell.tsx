import { Link } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { PurchaseDialog } from '@/components/inventory/PurchaseDialog'
import { cn } from '@/lib/utils'
import type { InventoryPurchaseCategory } from '@/types/domain'

// Extraído de InventoryPage.tsx nesta rodada (Módulo 3, Incremento 4 —
// filamentos) especificamente para permitir uma TERCEIRA área (Filamentos)
// sem import circular: FilamentsInventoryPage.tsx precisa do mesmo
// shell/nav que AccessoriesInventoryPage/PackagingInventoryPage já usavam
// dentro de InventoryPage.tsx — extrair para um arquivo compartilhado evita
// que InventoryPage.tsx precise importar FilamentsInventoryPage.tsx (que
// por sua vez importaria de volta InventoryPage.tsx).
export type InventoryArea = 'acessorios' | 'embalagens' | 'filamentos'

const INVENTORY_AREA_ITEMS: Array<{ key: InventoryArea; to: string; label: string }> = [
  { key: 'acessorios', to: '/estoque/acessorios', label: 'Acessórios' },
  { key: 'embalagens', to: '/estoque/embalagens', label: 'Embalagens' },
  { key: 'filamentos', to: '/estoque/filamentos', label: 'Filamentos' },
]

// Navegação interna entre as três áreas — mesmo idioma visual/semântico já
// usado pela navegação principal (AppLayout): Link + aria-current="page" +
// cor/peso tipográfico somados (nunca só cor).
export function InventoryAreaNav({ area }: { area: InventoryArea }) {
  return (
    <nav aria-label="Áreas do Estoque" className="border-border mt-4 flex items-center gap-1 border-b">
      {INVENTORY_AREA_ITEMS.map((item) => {
        const isActive = item.key === area
        return (
          <Link
            key={item.key}
            to={item.to}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-brand-accent -mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2',
              isActive
                ? 'border-brand-primary text-brand-primary-dark font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground font-normal',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

// Módulo 3, Incremento 5 (Compras) — pedido do usuário em 2026-08-28: um
// botão "Compras" destacado, único, compartilhado pelas três áreas (nunca
// duplicado por página) — reaproveita este shell, já usado pelas três, em
// vez de cada página renderizar o próprio PurchaseDialog. onPurchaseCompleted
// é opcional: FilamentsInventoryPage/AccessoriesInventoryPage/
// PackagingInventoryPage passam a própria função de refetch (só chamada
// quando a categoria comprada é a da área atual — comprar um acessório
// enquanto a aba Filamentos está aberta não precisa refazer a busca de
// filamentos, por exemplo).
export function InventoryPageShell({
  area,
  onPurchaseCompleted,
  children,
}: {
  area: InventoryArea
  onPurchaseCompleted?: (category: InventoryPurchaseCategory) => void
  children: React.ReactNode
}) {
  return (
    <AppLayout>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium">Estoque</h1>
        <PurchaseDialog onPurchaseCompleted={onPurchaseCompleted ?? (() => {})} />
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        Consulte os cadastros mestre de acessórios, embalagens e filamentos usados na composição de produtos.
      </p>
      <InventoryAreaNav area={area} />
      {children}
    </AppLayout>
  )
}
