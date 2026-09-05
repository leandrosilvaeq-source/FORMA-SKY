import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  FILAMENT_SPOOL_STATUS_LABELS,
  resolveFilamentSpoolStatusClassName,
} from '@/lib/inventory/filamentSpoolStatusStyles'
import { cn } from '@/lib/utils'
import type { FilamentSpoolStatus } from '@/types/domain'

// Só estes 3 são atribuíveis pelo usuário aqui — ESGOTADO é sempre
// consequência automática do saldo chegar a 0
// (register_filament_movement/register_filament_weighing), nunca uma
// escolha manual nesta lista. Um rolo hoje ESGOTADO ainda aparece com seu
// próprio rótulo/cor no botão — só não é uma das opções do menu.
const SELECTABLE_STATUSES: FilamentSpoolStatus[] = ['LACRADO', 'ABERTO', 'DESCARTADO']

export interface FilamentSpoolStatusControlProps {
  spoolCode: string
  status: FilamentSpoolStatus
  // Desabilita o gatilho inteiro — rolo arquivado ou uma mudança de status
  // já em andamento para este rolo. DESCARTADO (terminal, ver
  // update_filament_spool/FILAMENT_SPOOL_DISCARD_IS_FINAL) é sempre
  // desabilitado aqui dentro, independente deste valor.
  disabled?: boolean
  onSelect: (status: FilamentSpoolStatus) => void
}

// Badge de Status interativo (2026-09-05) — substitui o texto plano
// anterior (FilamentTypeDrawer). Clicar na opção JÁ selecionada não dispara
// onSelect (mesmo clique, nenhuma operação nova) — o próprio
// DropdownMenuItem da opção atual vem `disabled`, então nem chega a chamar
// onClick.
export function FilamentSpoolStatusControl({
  spoolCode,
  status,
  disabled = false,
  onSelect,
}: FilamentSpoolStatusControlProps) {
  const label = FILAMENT_SPOOL_STATUS_LABELS[status]
  const isTerminal = status === 'DESCARTADO'
  const triggerDisabled = disabled || isTerminal

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Status do rolo ${spoolCode}: ${label}`}
        disabled={triggerDisabled}
        className={cn(
          'focus-visible:ring-brand-accent inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-70',
          resolveFilamentSpoolStatusClassName(status),
        )}
      >
        {label}
        <ChevronDownIcon className="size-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {SELECTABLE_STATUSES.map((option) => {
          const isCurrent = option === status
          return (
            <DropdownMenuItem
              key={option}
              disabled={isCurrent}
              onClick={() => onSelect(option)}
              className={cn(
                'gap-1.5',
                option === 'DESCARTADO' && 'text-destructive data-highlighted:text-destructive',
              )}
            >
              <CheckIcon
                className={cn('size-3.5 shrink-0', !isCurrent && 'invisible')}
                aria-hidden="true"
              />
              {FILAMENT_SPOOL_STATUS_LABELS[option]}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
