import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  QUANTITY_OPTIONS,
  accessoryRowsFrom,
  filterSelectableItems,
  findItemById,
  hasInactiveSelection,
  hasOutOfRangeQuantity,
  isQuantityOutOfRange,
  isRowInactive,
  itemLabel,
  nextRowKey,
  packagingRowsFrom,
  validateRows,
  type CompositionRow,
} from '@/lib/forms/productComposition'
import type { UpdateProductCompositionInput } from '@/lib/api/productComposition'
import type { Accessory, Packaging, ProductAccessory, ProductPackaging } from '@/types/domain'

const SELECT_TRIGGER_CLASSNAME = 'focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-full min-w-0'
const QUANTITY_TRIGGER_CLASSNAME =
  'focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-20 shrink-0'
const REMOVE_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0'
const ADD_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark'
const INACTIVE_ITEM_MESSAGE = 'Este item está inativo. Remova-o da composição para poder salvar.'
const BLOCKED_BY_INACTIVE_MESSAGE = 'Remova os itens inativos da composição antes de salvar.'
const QUANTITY_OUT_OF_RANGE_MESSAGE =
  'Quantidade fora do intervalo permitido (1 a 20). Selecione um valor válido para salvar.'
const BLOCKED_BY_INVALID_QUANTITY_MESSAGE = 'Selecione uma quantidade entre 1 e 20 antes de salvar.'

// Opções fixas 1-20 exibidas no Select de quantidade, mais uma opção extra
// (marcada) para uma quantidade pré-existente fora desse intervalo — o valor
// atual continua visível no lugar de sumir/ficar em branco, nunca corrigido
// em silêncio. `extraValue` deve vir de um valor ESTÁVEL (capturado uma vez
// na montagem, não recalculado a cada render a partir do valor atual da
// linha): recalcular a partir do valor atual faz a opção selecionada
// desaparecer da lista no exato render em que o usuário a troca por uma
// válida, o que confunde o Select do base-ui e reverte a seleção para vazio.
function quantitySelectOptions(extraValue: string | undefined): Array<{ label: string; value: string | null }> {
  const base = QUANTITY_OPTIONS.map((n) => ({ label: String(n), value: String(n) }))
  if (extraValue !== undefined) {
    return [{ label: `${extraValue} (fora do intervalo)`, value: extraValue }, ...base]
  }
  return base
}

interface ProductCompositionFormProps {
  accessories: Accessory[]
  packaging: Packaging[]
  initialAccessories: ProductAccessory[]
  initialPackaging: ProductPackaging[]
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: UpdateProductCompositionInput) => void
  onCancel: () => void
}

export function ProductCompositionForm({
  accessories,
  packaging,
  initialAccessories,
  initialPackaging,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: ProductCompositionFormProps) {
  const [accessoryRows, setAccessoryRows] = useState<CompositionRow[]>(() => accessoryRowsFrom(initialAccessories))
  const [packagingRows, setPackagingRows] = useState<CompositionRow[]>(() => packagingRowsFrom(initialPackaging))
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)

  // Snapshot fixo (por row.key) das quantidades já fora de 1-20 no momento
  // em que a composição foi carregada — nunca recalculado depois, para a
  // opção extra do Select não desaparecer no meio da interação (ver
  // comentário de quantitySelectOptions). Linhas novas nunca entram aqui.
  const [stableOutOfRangeByKey] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const row of [...accessoryRows, ...packagingRows]) {
      if (isQuantityOutOfRange(row.quantity)) map[row.key] = row.quantity
    }
    return map
  })

  // Bloqueia o salvamento inteiro enquanto QUALQUER linha (acessório ou
  // embalagem) apontar para um item hoje inativo — o backend
  // (set_product_composition) rejeita a composição inteira nesse caso, então
  // barramos aqui antes de tentar, com uma mensagem clara em vez do erro cru
  // do banco. O item nunca é removido automaticamente: só some da tela
  // quando o próprio usuário clica em Remover.
  const hasInactiveItem = hasInactiveSelection(accessoryRows, accessories) || hasInactiveSelection(packagingRows, packaging)

  // Mesma lógica de bloqueio do item inativo, mas para uma quantidade
  // pré-existente fora de 1-20 (a coluna no banco só exige > 0, sem teto) —
  // nunca corrigida/truncada automaticamente, só o usuário escolhendo um
  // valor válido no Select libera o salvamento.
  const hasInvalidQuantity = hasOutOfRangeQuantity(accessoryRows) || hasOutOfRangeQuantity(packagingRows)
  const isBlocked = hasInactiveItem || hasInvalidQuantity

  function addAccessoryRow() {
    setAccessoryRows((rows) => [...rows, { key: nextRowKey(), itemId: null, quantity: '' }])
  }
  function removeAccessoryRow(key: string) {
    setBlockedMessage(null)
    setAccessoryRows((rows) => rows.filter((row) => row.key !== key))
  }
  function updateAccessoryRow(key: string, patch: Partial<CompositionRow>) {
    setBlockedMessage(null)
    setAccessoryRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function addPackagingRow() {
    setPackagingRows((rows) => [...rows, { key: nextRowKey(), itemId: null, quantity: '' }])
  }
  function removePackagingRow(key: string) {
    setBlockedMessage(null)
    setPackagingRows((rows) => rows.filter((row) => row.key !== key))
  }
  function updatePackagingRow(key: string, patch: Partial<CompositionRow>) {
    setBlockedMessage(null)
    setPackagingRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function selectableAccessories(currentItemId: string | null) {
    const chosen = new Set(accessoryRows.map((row) => row.itemId).filter((id): id is string => id !== null))
    return filterSelectableItems(accessories, chosen, currentItemId)
  }

  function selectablePackaging(currentItemId: string | null) {
    const chosen = new Set(packagingRows.map((row) => row.itemId).filter((id): id is string => id !== null))
    return filterSelectableItems(packaging, chosen, currentItemId)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (hasInactiveItem) {
      setBlockedMessage(BLOCKED_BY_INACTIVE_MESSAGE)
      return
    }
    if (hasInvalidQuantity) {
      setBlockedMessage(BLOCKED_BY_INVALID_QUANTITY_MESSAGE)
      return
    }

    const accessoryResult = validateRows(accessoryRows, 'um acessório')
    const packagingResult = validateRows(packagingRows, 'uma embalagem')

    const allErrors = { ...accessoryResult.errors, ...packagingResult.errors }
    if (Object.keys(allErrors).length > 0) {
      setRowErrors(allErrors)
      return
    }
    setRowErrors({})
    setBlockedMessage(null)

    onSubmit({ accessories: accessoryResult.items, packaging: packagingResult.items })
  }

  return (
    <form className="flex max-h-[70vh] flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Acessórios</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addAccessoryRow}
              disabled={isSubmitting}
              className={ADD_BUTTON_CLASSNAME}
            >
              Adicionar acessório
            </Button>
          </div>
          {accessoryRows.length === 0 && (
            <p className="text-muted-foreground text-sm">Nenhum acessório na composição.</p>
          )}
          {accessoryRows.map((row, index) => {
            const options = selectableAccessories(row.itemId).map((accessory) => ({
              label: itemLabel(accessory),
              value: accessory.id as string | null,
            }))
            const selectedAccessory = findItemById(accessories, row.itemId)
            const inactive = isRowInactive(row, accessories)
            const outOfRange = isQuantityOutOfRange(row.quantity)
            const quantityOptions = quantitySelectOptions(stableOutOfRangeByKey[row.key])
            const removeLabel = selectedAccessory
              ? `Remover ${selectedAccessory.name}`
              : `Remover acessório (linha ${index + 1})`
            return (
              <div key={row.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Select
                    items={options}
                    value={row.itemId}
                    disabled={isSubmitting}
                    onValueChange={(value) => updateAccessoryRow(row.key, { itemId: value })}
                  >
                    <SelectTrigger aria-label="Acessório" title={selectedAccessory?.name} className={SELECT_TRIGGER_CLASSNAME}>
                      <SelectValue placeholder="Selecione um acessório" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((item) => (
                        <SelectItem key={item.value ?? 'none'} value={item.value} title={item.label} className="truncate">
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    items={quantityOptions}
                    value={row.quantity || null}
                    disabled={isSubmitting}
                    onValueChange={(value) => updateAccessoryRow(row.key, { quantity: value ?? '' })}
                  >
                    <SelectTrigger aria-label="Quantidade do acessório" className={QUANTITY_TRIGGER_CLASSNAME}>
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
                    onClick={() => removeAccessoryRow(row.key)}
                    disabled={isSubmitting}
                    aria-label={removeLabel}
                    className={REMOVE_BUTTON_CLASSNAME}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {inactive && <p className="text-destructive text-sm">{INACTIVE_ITEM_MESSAGE}</p>}
                {!inactive && outOfRange && <p className="text-destructive text-sm">{QUANTITY_OUT_OF_RANGE_MESSAGE}</p>}
                {!inactive && !outOfRange && rowErrors[row.key] && (
                  <p className="text-destructive text-sm">{rowErrors[row.key]}</p>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Embalagens</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addPackagingRow}
              disabled={isSubmitting}
              className={ADD_BUTTON_CLASSNAME}
            >
              Adicionar embalagem
            </Button>
          </div>
          {packagingRows.length === 0 && (
            <p className="text-muted-foreground text-sm">Nenhuma embalagem na composição.</p>
          )}
          {packagingRows.map((row, index) => {
            const options = selectablePackaging(row.itemId).map((item) => ({
              label: itemLabel(item),
              value: item.id as string | null,
            }))
            const selectedPackaging = findItemById(packaging, row.itemId)
            const inactive = isRowInactive(row, packaging)
            const outOfRange = isQuantityOutOfRange(row.quantity)
            const quantityOptions = quantitySelectOptions(stableOutOfRangeByKey[row.key])
            const removeLabel = selectedPackaging
              ? `Remover ${selectedPackaging.name}`
              : `Remover embalagem (linha ${index + 1})`
            return (
              <div key={row.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Select
                    items={options}
                    value={row.itemId}
                    disabled={isSubmitting}
                    onValueChange={(value) => updatePackagingRow(row.key, { itemId: value })}
                  >
                    <SelectTrigger
                      aria-label="Embalagem"
                      title={selectedPackaging?.name}
                      className={SELECT_TRIGGER_CLASSNAME}
                    >
                      <SelectValue placeholder="Selecione uma embalagem" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((item) => (
                        <SelectItem key={item.value ?? 'none'} value={item.value} title={item.label} className="truncate">
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    items={quantityOptions}
                    value={row.quantity || null}
                    disabled={isSubmitting}
                    onValueChange={(value) => updatePackagingRow(row.key, { quantity: value ?? '' })}
                  >
                    <SelectTrigger aria-label="Quantidade da embalagem" className={QUANTITY_TRIGGER_CLASSNAME}>
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
                    onClick={() => removePackagingRow(row.key)}
                    disabled={isSubmitting}
                    aria-label={removeLabel}
                    className={REMOVE_BUTTON_CLASSNAME}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {inactive && <p className="text-destructive text-sm">{INACTIVE_ITEM_MESSAGE}</p>}
                {!inactive && outOfRange && <p className="text-destructive text-sm">{QUANTITY_OUT_OF_RANGE_MESSAGE}</p>}
                {!inactive && !outOfRange && rowErrors[row.key] && (
                  <p className="text-destructive text-sm">{rowErrors[row.key]}</p>
                )}
              </div>
            )
          })}
        </div>

        {blockedMessage && <p className="text-destructive text-sm">{blockedMessage}</p>}
        {submitError && <p className="text-destructive text-sm">{submitError}</p>}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting || isBlocked}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
        >
          {isSubmitting ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}
