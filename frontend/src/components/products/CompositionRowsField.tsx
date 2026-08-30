// Um bloco (Acessórios OU Embalagens): título + botão Adicionar + linhas
// inline (Select do item + Select de quantidade + remover), extraído de
// ProductCompositionForm.tsx nesta rodada para ser reaproveitado também
// dentro de ProductForm.tsx (Seção "Acessórios e Embalagem" passou a ser
// inline, sem abrir uma segunda janela — ver comentário em ProductForm.tsx).
// Puramente apresentacional: quem chama é dono do estado das linhas
// (rows/onAdd/onUpdate/onRemove) e da validação (rowErrors).
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  filterSelectableItems,
  findItemById,
  isQuantityOutOfRange,
  isRowInactive,
  itemLabel,
  quantitySelectOptions,
  type CompositionRow,
} from '@/lib/forms/productComposition'

const SELECT_TRIGGER_CLASSNAME =
  'focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-full min-w-0'
const QUANTITY_TRIGGER_CLASSNAME =
  'focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-20 shrink-0'
const REMOVE_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0'
const ADD_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark'
const INACTIVE_ITEM_MESSAGE = 'Este item está inativo. Remova-o da composição para poder salvar.'
const QUANTITY_OUT_OF_RANGE_MESSAGE =
  'Quantidade fora do intervalo permitido (1 a 20). Selecione um valor válido para salvar.'

interface CompositionItemLike {
  id: string
  name: string
  is_active: boolean
}

export interface CompositionRowsFieldProps<T extends CompositionItemLike> {
  title: string
  addLabel: string
  emptyMessage: string
  itemAriaLabel: string
  itemPlaceholder: string
  quantityAriaLabel: string
  items: T[]
  rows: CompositionRow[]
  disabled: boolean
  rowErrors: Record<string, string>
  stableOutOfRangeByKey: Record<string, string>
  onAdd: () => void
  onUpdate: (key: string, patch: Partial<CompositionRow>) => void
  onRemove: (key: string) => void
}

export function CompositionRowsField<T extends CompositionItemLike>({
  title,
  addLabel,
  emptyMessage,
  itemAriaLabel,
  itemPlaceholder,
  quantityAriaLabel,
  items,
  rows,
  disabled,
  rowErrors,
  stableOutOfRangeByKey,
  onAdd,
  onUpdate,
  onRemove,
}: CompositionRowsFieldProps<T>) {
  function selectableItems(currentItemId: string | null) {
    const chosen = new Set(rows.map((row) => row.itemId).filter((id): id is string => id !== null))
    return filterSelectableItems(items, chosen, currentItemId)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{title}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAdd}
          disabled={disabled}
          className={ADD_BUTTON_CLASSNAME}
        >
          {addLabel}
        </Button>
      </div>
      {rows.length === 0 && <p className="text-muted-foreground text-sm">{emptyMessage}</p>}
      {rows.map((row, index) => {
        const options = selectableItems(row.itemId).map((item) => ({
          label: itemLabel(item),
          value: item.id as string | null,
        }))
        const selectedItem = findItemById(items, row.itemId)
        const inactive = isRowInactive(row, items)
        const outOfRange = isQuantityOutOfRange(row.quantity)
        const quantityOptions = quantitySelectOptions(stableOutOfRangeByKey[row.key])
        const removeLabel = selectedItem
          ? `Remover ${selectedItem.name}`
          : `Remover ${itemAriaLabel.toLowerCase()} (linha ${index + 1})`
        return (
          <div key={row.key} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Select
                items={options}
                value={row.itemId}
                disabled={disabled}
                onValueChange={(value) => onUpdate(row.key, { itemId: value })}
              >
                <SelectTrigger
                  aria-label={itemAriaLabel}
                  title={selectedItem?.name}
                  className={SELECT_TRIGGER_CLASSNAME}
                >
                  <SelectValue placeholder={itemPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((item) => (
                    <SelectItem
                      key={item.value ?? 'none'}
                      value={item.value}
                      title={item.label}
                      className="truncate"
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                items={quantityOptions}
                value={row.quantity || null}
                disabled={disabled}
                onValueChange={(value) => onUpdate(row.key, { quantity: value ?? '' })}
              >
                <SelectTrigger
                  aria-label={quantityAriaLabel}
                  className={QUANTITY_TRIGGER_CLASSNAME}
                >
                  <SelectValue placeholder="Qtd." />
                </SelectTrigger>
                <SelectContent>
                  {quantityOptions.map((item) => (
                    <SelectItem key={item.value ?? 'none'} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => onRemove(row.key)}
                disabled={disabled}
                aria-label={removeLabel}
                className={REMOVE_BUTTON_CLASSNAME}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            {inactive && <p className="text-destructive text-sm">{INACTIVE_ITEM_MESSAGE}</p>}
            {!inactive && outOfRange && (
              <p className="text-destructive text-sm">{QUANTITY_OUT_OF_RANGE_MESSAGE}</p>
            )}
            {!inactive && !outOfRange && rowErrors[row.key] && (
              <p className="text-destructive text-sm">{rowErrors[row.key]}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
