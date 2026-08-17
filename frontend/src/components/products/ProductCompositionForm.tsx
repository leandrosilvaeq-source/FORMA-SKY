import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { parseNumberField } from '@/lib/forms/numberField'
import type { UpdateProductCompositionInput } from '@/lib/api/productComposition'
import type { Accessory, Packaging, ProductAccessory, ProductPackaging } from '@/types/domain'

interface CompositionRow {
  key: string
  itemId: string | null
  quantity: string
}

let rowKeySeq = 0
function nextRowKey(): string {
  rowKeySeq += 1
  return `row-${rowKeySeq}`
}

function accessoryRowsFrom(items: ProductAccessory[]): CompositionRow[] {
  return items.map((item) => ({ key: nextRowKey(), itemId: item.accessory_id, quantity: String(item.quantity) }))
}

function packagingRowsFrom(items: ProductPackaging[]): CompositionRow[] {
  return items.map((item) => ({ key: nextRowKey(), itemId: item.packaging_id, quantity: String(item.quantity) }))
}

// Filtra as opções ofertadas para UMA linha do formulário:
// - o item já selecionado NAQUELA linha é sempre mantido, mesmo inativo —
//   um vínculo existente na composição não pode "sumir" da tela por causa
//   de uma desativação posterior do item (o usuário só o remove clicando
//   em "Remover", nunca silenciosamente);
// - itens já escolhidos em OUTRAS linhas são excluídos (impede duplicidade);
// - qualquer outro item inativo é excluído — não pode ser escolhido como
//   item NOVO, já que o backend (set_product_composition) sempre rejeita
//   accessory_id/packaging_id inativo.
export function filterSelectableItems<T extends { id: string; is_active: boolean }>(
  items: T[],
  chosenElsewhere: Set<string>,
  currentItemId: string | null,
): T[] {
  return items.filter((item) => {
    if (item.id === currentItemId) return true
    if (chosenElsewhere.has(item.id)) return false
    return item.is_active
  })
}

// Rótulo exibido no Select: marca visivelmente um item inativo já vinculado
// (em vez de mostrá-lo como se fosse um item ativo qualquer).
function itemLabel(item: { name: string; is_active: boolean }): string {
  return item.is_active ? item.name : `${item.name} (inativo)`
}

interface ValidatedRows {
  items: Array<{ id: string; quantity: number }>
  errors: Record<string, string>
}

function validateRows(rows: CompositionRow[], selectLabel: string): ValidatedRows {
  const errors: Record<string, string> = {}
  const items: Array<{ id: string; quantity: number }> = []

  for (const row of rows) {
    if (!row.itemId) {
      errors[row.key] = `Selecione ${selectLabel}.`
      continue
    }
    const quantity = parseNumberField(row.quantity, 'A quantidade', { required: true, integer: true, min: 1 })
    if (quantity.error) {
      errors[row.key] = quantity.error
      continue
    }
    items.push({ id: row.itemId, quantity: quantity.value as number })
  }

  return { items, errors }
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

  function addAccessoryRow() {
    setAccessoryRows((rows) => [...rows, { key: nextRowKey(), itemId: null, quantity: '' }])
  }
  function removeAccessoryRow(key: string) {
    setAccessoryRows((rows) => rows.filter((row) => row.key !== key))
  }
  function updateAccessoryRow(key: string, patch: Partial<CompositionRow>) {
    setAccessoryRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function addPackagingRow() {
    setPackagingRows((rows) => [...rows, { key: nextRowKey(), itemId: null, quantity: '' }])
  }
  function removePackagingRow(key: string) {
    setPackagingRows((rows) => rows.filter((row) => row.key !== key))
  }
  function updatePackagingRow(key: string, patch: Partial<CompositionRow>) {
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

    const accessoryResult = validateRows(accessoryRows, 'um acessório')
    const packagingResult = validateRows(packagingRows, 'uma embalagem')

    const allErrors = { ...accessoryResult.errors, ...packagingResult.errors }
    if (Object.keys(allErrors).length > 0) {
      setRowErrors(allErrors)
      return
    }
    setRowErrors({})

    onSubmit({ accessories: accessoryResult.items, packaging: packagingResult.items })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Acessórios</Label>
          <Button type="button" variant="outline" size="sm" onClick={addAccessoryRow}>
            Adicionar acessório
          </Button>
        </div>
        {accessoryRows.length === 0 && (
          <p className="text-muted-foreground text-sm">Nenhum acessório na composição.</p>
        )}
        {accessoryRows.map((row) => {
          const options = selectableAccessories(row.itemId).map((accessory) => ({
            label: itemLabel(accessory),
            value: accessory.id as string | null,
          }))
          return (
            <div key={row.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Select
                  items={options}
                  value={row.itemId}
                  onValueChange={(value) => updateAccessoryRow(row.key, { itemId: value })}
                >
                  <SelectTrigger aria-label="Acessório" className="w-full">
                    <SelectValue placeholder="Selecione um acessório" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((item) => (
                      <SelectItem key={item.value ?? 'none'} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="w-20 shrink-0"
                  inputMode="numeric"
                  aria-label="Quantidade do acessório"
                  value={row.quantity}
                  onChange={(event) => updateAccessoryRow(row.key, { quantity: event.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeAccessoryRow(row.key)}
                  aria-label="Remover acessório"
                >
                  Remover
                </Button>
              </div>
              {rowErrors[row.key] && <p className="text-destructive text-sm">{rowErrors[row.key]}</p>}
            </div>
          )
        })}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Embalagens</Label>
          <Button type="button" variant="outline" size="sm" onClick={addPackagingRow}>
            Adicionar embalagem
          </Button>
        </div>
        {packagingRows.length === 0 && (
          <p className="text-muted-foreground text-sm">Nenhuma embalagem na composição.</p>
        )}
        {packagingRows.map((row) => {
          const options = selectablePackaging(row.itemId).map((item) => ({
            label: itemLabel(item),
            value: item.id as string | null,
          }))
          return (
            <div key={row.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Select
                  items={options}
                  value={row.itemId}
                  onValueChange={(value) => updatePackagingRow(row.key, { itemId: value })}
                >
                  <SelectTrigger aria-label="Embalagem" className="w-full">
                    <SelectValue placeholder="Selecione uma embalagem" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((item) => (
                      <SelectItem key={item.value ?? 'none'} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="w-20 shrink-0"
                  inputMode="numeric"
                  aria-label="Quantidade da embalagem"
                  value={row.quantity}
                  onChange={(event) => updatePackagingRow(row.key, { quantity: event.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removePackagingRow(row.key)}
                  aria-label="Remover embalagem"
                >
                  Remover
                </Button>
              </div>
              {rowErrors[row.key] && <p className="text-destructive text-sm">{rowErrors[row.key]}</p>}
            </div>
          )
        })}
      </div>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}
