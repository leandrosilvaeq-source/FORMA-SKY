import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { getAriaSort, type SortState } from './sorting'

export interface SortableColumnHeaderProps<TColumn extends string> {
  column: TColumn
  label: string
  sort: SortState<TColumn> | null
  onSortChange: (next: SortState<TColumn> | null) => void
  className?: string
}

// Cabeçalho de coluna ordenável — extraído de CustomersPage.tsx (primeira
// implementação validada) para ser reutilizado sem duplicar em
// ProductsPage.tsx. Ícone compacto (estado neutro ChevronsUpDown; ativo
// ArrowUp/ArrowDown na cor Forma) que abre um dropdown estilo "filtro de
// tabela do Excel" com as 3 opções. aria-sort no <th> (nativo, sempre
// presente: ascending/descending/none) e nome acessível do botão "Ordenar
// coluna {label}" cobrem a acessibilidade exigida; Menu (@base-ui/react) já
// fecha no Esc e ao selecionar um item (closeOnClick padrão), e é
// navegável por teclado nativamente.
export function SortableColumnHeader<TColumn extends string>({
  column,
  label,
  sort,
  onSortChange,
  className,
}: SortableColumnHeaderProps<TColumn>) {
  const isActive = sort?.column === column
  const direction = isActive ? sort.direction : null

  return (
    <TableHead className={cn('h-auto py-2 whitespace-normal', className)} aria-sort={getAriaSort(sort, column)}>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Ordenar coluna ${label}`}
            className={cn(
              'focus-visible:ring-brand-accent inline-flex size-5 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2',
              isActive ? 'text-brand-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {direction === 'asc' ? (
              <ArrowUpIcon className="size-3.5" />
            ) : direction === 'desc' ? (
              <ArrowDownIcon className="size-3.5" />
            ) : (
              <ChevronsUpDownIcon className="size-3.5" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onSortChange({ column, direction: 'asc' })}>
              Ordenar crescente
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSortChange({ column, direction: 'desc' })}>
              Ordenar decrescente
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSortChange(null)}>Remover ordenação</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TableHead>
  )
}
