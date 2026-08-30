import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { CompositionRowsField } from '@/components/products/CompositionRowsField'
import {
  accessoryRowsFrom,
  hasOutOfRangeQuantity,
  isQuantityOutOfRange,
  nextRowKey,
  packagingRowsFrom,
  validateRows,
  type CompositionRow,
} from '@/lib/forms/productComposition'
import type { UpdateProductCompositionInput } from '@/lib/api/productComposition'
import type { Accessory, Packaging, ProductAccessory, ProductPackaging } from '@/types/domain'

const BLOCKED_BY_INVALID_QUANTITY_MESSAGE = 'Selecione uma quantidade entre 1 e 20 antes de salvar.'

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
  const [accessoryRows, setAccessoryRows] = useState<CompositionRow[]>(() =>
    accessoryRowsFrom(initialAccessories),
  )
  const [packagingRows, setPackagingRows] = useState<CompositionRow[]>(() =>
    packagingRowsFrom(initialPackaging),
  )
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)

  // Snapshot fixo (por row.key) das quantidades já fora de 1-20 no momento
  // em que a composição foi carregada — nunca recalculado depois, para a
  // opção extra do Select não desaparecer no meio da interação (ver
  // comentário de quantitySelectOptions).
  const [stableOutOfRangeByKey] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const row of [...accessoryRows, ...packagingRows]) {
      if (isQuantityOutOfRange(row.quantity)) map[row.key] = row.quantity
    }
    return map
  })

  // Item inativo VINCULADO ANTERIORMENTE (rodada corretiva 2026-08-30) —
  // deliberadamente NUNCA bloqueia o salvamento aqui: permanece visível
  // marcado como inativo (itemLabel), editável na quantidade e removível a
  // qualquer momento, mas o usuário não é obrigado a removê-lo só para
  // salvar outra alteração. Continuar selecionado e ainda assim tentar
  // salvar É permitido pelo frontend — se o item permanecer na linha, o
  // payload o envia normalmente (set_product_composition é quem decide se
  // aceita ou rejeita um accessory_id/packaging_id hoje inativo; um erro
  // real do backend, se houver, aparece via submitError, nunca escondido).
  // filterSelectableItems (lib/forms/productComposition.ts) já garante que
  // um item inativo NUNCA aparece como opção NOVA em nenhuma linha (nem
  // aqui nem depois de removido) — a única forma de ele existir numa linha
  // é ter sido carregado de um vínculo já existente.

  // Quantidade pré-existente fora de 1-20 (a coluna no banco só exige > 0,
  // sem teto) — nunca corrigida/truncada automaticamente, só o usuário
  // escolhendo um valor válido no Select libera o salvamento. Regra
  // inalterada nesta rodada (só o bloqueio por item inativo foi removido).
  const hasInvalidQuantity =
    hasOutOfRangeQuantity(accessoryRows) || hasOutOfRangeQuantity(packagingRows)
  const isBlocked = hasInvalidQuantity

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

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
        <CompositionRowsField
          title="Acessórios"
          addLabel="Adicionar acessório"
          emptyMessage="Nenhum acessório na composição."
          itemAriaLabel="Acessório"
          itemPlaceholder="Selecione um acessório"
          quantityAriaLabel="Quantidade do acessório"
          items={accessories}
          rows={accessoryRows}
          disabled={isSubmitting}
          rowErrors={rowErrors}
          stableOutOfRangeByKey={stableOutOfRangeByKey}
          onAdd={addAccessoryRow}
          onUpdate={updateAccessoryRow}
          onRemove={removeAccessoryRow}
        />

        <CompositionRowsField
          title="Embalagens"
          addLabel="Adicionar embalagem"
          emptyMessage="Nenhuma embalagem na composição."
          itemAriaLabel="Embalagem"
          itemPlaceholder="Selecione uma embalagem"
          quantityAriaLabel="Quantidade da embalagem"
          items={packaging}
          rows={packagingRows}
          disabled={isSubmitting}
          rowErrors={rowErrors}
          stableOutOfRangeByKey={stableOutOfRangeByKey}
          onAdd={addPackagingRow}
          onUpdate={updatePackagingRow}
          onRemove={removePackagingRow}
        />

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
