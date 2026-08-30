import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { filamentTypeLabel } from '@/lib/forms/productPlates'
import type { FilamentTypeSummary } from '@/types/domain'

// Seção "Cores e filamentos" (migration 20260829180000_add_categories_plate_weight_and_order_colors.sql,
// ainda não aplicada) — a escolha de filamento/cor saiu do cadastro do
// Produto e passou a acontecer aqui, no Pedido, por UNIDADE e por PLATE de
// cada item CATALOG. Componente reaproveitado por OrderForm.tsx (criação/
// edição de itens do Pedido) e por qualquer tela de completar cores depois
// da criação (PATCH /orders/:id/production-colors) — a chave de cada item
// (`key`) é só um identificador estável escolhido pelo chamador (linha do
// formulário em criação, order_item_id em edição), nunca interpretada aqui.
//
// SEMPRE opcional: o Pedido pode entrar na Fila de produção com cores
// pendentes ou parciais — só o início EFETIVO da produção é bloqueado (ver
// change_order_status/validate_order_production_readiness na migration).
// Este componente nunca impede submit nem marca erro de validação; só
// exibe o aviso informativo abaixo e os indicadores Completo/Pendente.
//
// Sem peso por cor (fora de escopo desta rodada — módulo de Produção
// futuro): só a lista de filament_type_id por unidade+plate.

export interface ProductionColorItem {
  key: string
  label: string
  quantity: number
  plateCount: number
}

// value: chave composta `${itemKey}:${unit}:${plate}` -> filament_type_id[].
// Uma chave ausente do objeto equivale a "nenhuma cor selecionada ainda"
// para aquele plate — nunca uma distinção entre "ausente" e "array vazio".
export type ProductionColorsValue = Record<string, string[]>

export interface ProductionColorsPickerProps {
  items: ProductionColorItem[]
  filamentTypes: FilamentTypeSummary[]
  value: ProductionColorsValue
  onChange: (next: ProductionColorsValue) => void
  disabled?: boolean
  // Presente = o Pedido já passou do início da produção (congelamento —
  // ver update_order_item_production_colors/ORDER_PRODUCTION_COLORS_FROZEN:
  // na migration): o picker abre por padrão (mostra a configuração
  // congelada sem exigir um clique extra) e troca o aviso informativo
  // padrão por esta mensagem. O chamador continua responsável por também
  // passar disabled=true junto — este prop só troca o texto/abertura
  // inicial, nunca desabilita sozinho.
  frozenMessage?: string
}

export function colorKey(itemKey: string, unit: number, plate: number): string {
  return `${itemKey}:${unit}:${plate}`
}

function plateComplete(value: ProductionColorsValue, itemKey: string, unit: number, plate: number): boolean {
  return (value[colorKey(itemKey, unit, plate)] ?? []).length > 0
}

function itemComplete(value: ProductionColorsValue, item: ProductionColorItem): boolean {
  for (let unit = 1; unit <= item.quantity; unit += 1) {
    for (let plate = 1; plate <= item.plateCount; plate += 1) {
      if (!plateComplete(value, item.key, unit, plate)) return false
    }
  }
  return true
}

function CompletionBadge({ complete }: { complete: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        complete ? 'bg-brand-primary-soft text-brand-primary-dark' : 'bg-muted text-muted-foreground',
      )}
    >
      {complete ? 'Completo' : 'Pendente'}
    </span>
  )
}

function FilamentToggleGroup({
  ariaLabel,
  filamentTypes,
  selectedIds,
  onToggle,
  disabled,
}: {
  ariaLabel: string
  filamentTypes: FilamentTypeSummary[]
  selectedIds: string[]
  onToggle: (filamentTypeId: string) => void
  disabled?: boolean
}) {
  const selectedSet = new Set(selectedIds)
  // Só tipos ativos para uma seleção NOVA — um tipo já selecionado
  // permanece visível/marcado mesmo se ficou inativo depois (nunca some
  // silenciosamente da tela).
  const options = filamentTypes.filter((type) => type.is_active || selectedSet.has(type.filament_type_id))

  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.length === 0 && <span className="text-muted-foreground text-xs">Nenhum filamento cadastrado.</span>}
      {options.map((type) => (
        <button
          key={type.filament_type_id}
          type="button"
          role="checkbox"
          aria-checked={selectedSet.has(type.filament_type_id)}
          disabled={disabled}
          onClick={() => onToggle(type.filament_type_id)}
          className={cn(
            'focus-visible:ring-brand-accent rounded-md border px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
            selectedSet.has(type.filament_type_id)
              ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
              : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {filamentTypeLabel(type)}
        </button>
      ))}
    </div>
  )
}

function ProductionColorsItemSection({
  item,
  filamentTypes,
  value,
  onChange,
  disabled,
}: {
  item: ProductionColorItem
  filamentTypes: FilamentTypeSummary[]
  value: ProductionColorsValue
  onChange: (next: ProductionColorsValue) => void
  disabled?: boolean
}) {
  // Confirmação antes de "Aplicar cores da Unidade 1 a todas" sobrescrever
  // uma unidade que já tinha alguma cor selecionada — nunca perde seleção
  // preenchida silenciosamente, mesmo padrão de confirmação já usado em
  // ProductForm.tsx (remoção de plate preenchido).
  const [applyToAllPending, setApplyToAllPending] = useState(false)

  function toggleColor(unit: number, plate: number, filamentTypeId: string) {
    const key = colorKey(item.key, unit, plate)
    const current = value[key] ?? []
    const next = current.includes(filamentTypeId)
      ? current.filter((id) => id !== filamentTypeId)
      : [...current, filamentTypeId]
    onChange({ ...value, [key]: next })
  }

  function unit1Selections(): Array<{ plate: number; ids: string[] }> {
    const result: Array<{ plate: number; ids: string[] }> = []
    for (let plate = 1; plate <= item.plateCount; plate += 1) {
      result.push({ plate, ids: value[colorKey(item.key, 1, plate)] ?? [] })
    }
    return result
  }

  function anyOtherUnitHasSelection(): boolean {
    for (let unit = 2; unit <= item.quantity; unit += 1) {
      for (let plate = 1; plate <= item.plateCount; plate += 1) {
        if ((value[colorKey(item.key, unit, plate)] ?? []).length > 0) return true
      }
    }
    return false
  }

  function applyUnit1ToAll() {
    const source = unit1Selections()
    const next = { ...value }
    for (let unit = 2; unit <= item.quantity; unit += 1) {
      for (const { plate, ids } of source) {
        next[colorKey(item.key, unit, plate)] = [...ids]
      }
    }
    onChange(next)
    setApplyToAllPending(false)
  }

  function requestApplyToAll() {
    if (anyOtherUnitHasSelection()) {
      setApplyToAllPending(true)
      return
    }
    applyUnit1ToAll()
  }

  return (
    <div className="border-input flex flex-col gap-2 rounded-lg border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {item.label} · {item.quantity} {item.quantity === 1 ? 'unidade' : 'unidades'}
        </span>
        <CompletionBadge complete={itemComplete(value, item)} />
      </div>

      {item.quantity > 1 && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={requestApplyToAll}
          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark self-start"
        >
          Aplicar cores da Unidade 1 a todas
        </Button>
      )}

      {applyToAllPending && (
        <div className="border-destructive/50 bg-destructive/10 flex flex-col gap-2 rounded-md border p-2 text-xs">
          <p>Outras unidades já têm cores selecionadas. Sobrescrever com as cores da Unidade 1?</p>
          <div className="flex gap-2">
            <Button type="button" size="xs" variant="destructive" onClick={applyUnit1ToAll}>
              Sobrescrever
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={() => setApplyToAllPending(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {Array.from({ length: item.quantity }, (_, index) => index + 1).map((unit) => (
          <div key={unit} className="flex flex-col gap-1.5 border-t pt-2 first:border-t-0 first:pt-0">
            <span className="text-muted-foreground text-xs font-semibold">Unidade {unit}</span>
            {Array.from({ length: item.plateCount }, (_, index) => index + 1).map((plate) => (
              <div key={plate} className="flex flex-col gap-1 pl-2">
                <span className="text-xs">Plate {plate}</span>
                <FilamentToggleGroup
                  ariaLabel={`Cores da Unidade ${unit}, Plate ${plate} — ${item.label}`}
                  filamentTypes={filamentTypes}
                  selectedIds={value[colorKey(item.key, unit, plate)] ?? []}
                  onToggle={(id) => toggleColor(unit, plate, id)}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProductionColorsPicker({
  items,
  filamentTypes,
  value,
  onChange,
  disabled,
  frozenMessage,
}: ProductionColorsPickerProps) {
  const [isOpen, setIsOpen] = useState(frozenMessage !== undefined)

  if (items.length === 0) return null

  return (
    <div className="border-input rounded-lg border p-2">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 px-1 py-1 text-left"
      >
        <span className="text-sm font-medium">Cores e filamentos</span>
        {isOpen ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
      </button>

      {isOpen && (
        <div className="flex flex-col gap-3 px-1 pt-2">
          <p className={cn('text-xs', frozenMessage ? 'text-destructive' : 'text-muted-foreground')}>
            {frozenMessage ?? 'As cores podem ser definidas agora ou antes de iniciar a produção.'}
          </p>
          {items.map((item) => (
            <ProductionColorsItemSection
              key={item.key}
              item={item}
              filamentTypes={filamentTypes}
              value={value}
              onChange={onChange}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}
