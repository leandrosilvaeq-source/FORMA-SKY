// Funções puras usadas por ProductCompositionForm.tsx — extraídas para cá
// (em vez de exportadas junto do componente) para eliminar o warning
// react-refresh/only-export-components: um arquivo de componente só pode
// exportar o próprio componente para o Fast Refresh funcionar.

import { parseNumberField } from '@/lib/forms/numberField'
import type { ProductAccessory, ProductPackaging } from '@/types/domain'

export interface CompositionRow {
  key: string
  itemId: string | null
  quantity: string
}

let rowKeySeq = 0
export function nextRowKey(): string {
  rowKeySeq += 1
  return `row-${rowKeySeq}`
}

export function accessoryRowsFrom(items: ProductAccessory[]): CompositionRow[] {
  return items.map((item) => ({ key: nextRowKey(), itemId: item.accessory_id, quantity: String(item.quantity) }))
}

export function packagingRowsFrom(items: ProductPackaging[]): CompositionRow[] {
  return items.map((item) => ({ key: nextRowKey(), itemId: item.packaging_id, quantity: String(item.quantity) }))
}

// Filtra as opções ofertadas para UMA linha do formulário:
// - o item já selecionado NAQUELA linha é sempre mantido, mesmo inativo —
//   um vínculo existente na composição não pode "sumir" da tela por causa
//   de uma desativação posterior do item (o usuário só o remove clicando
//   em Remover, nunca silenciosamente);
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
export function itemLabel(item: { name: string; is_active: boolean }): string {
  return item.is_active ? item.name : `${item.name} (inativo)`
}

export function findItemById<T extends { id: string }>(items: T[], id: string | null): T | undefined {
  if (id === null) return undefined
  return items.find((item) => item.id === id)
}

// true quando a linha tem um item selecionado e esse item está inativo —
// usado tanto para o aviso persistente por linha quanto para bloquear o
// salvamento enquanto qualquer item inativo permanecer na composição.
export function isRowInactive(row: CompositionRow, items: Array<{ id: string; is_active: boolean }>): boolean {
  const item = findItemById(items, row.itemId)
  return item ? !item.is_active : false
}

export function hasInactiveSelection(
  rows: CompositionRow[],
  items: Array<{ id: string; is_active: boolean }>,
): boolean {
  return rows.some((row) => isRowInactive(row, items))
}

// Quantidade agora é escolhida num Select com exatamente as opções 1-20
// (nunca digitação livre) — mas uma composição já salva pode ter uma
// quantidade fora desse intervalo (a coluna no banco só exige > 0, sem teto
// de 20; ver supabase/migrations/20260816150000_..._composition_tables.sql).
// MIN/MAX_QUANTITY e QUANTITY_OPTIONS definem o intervalo hoje oferecido
// como opção nova; isQuantityOutOfRange identifica um valor pré-existente
// que caiu fora dele, para nunca ser corrigido/truncado silenciosamente.
export const MIN_QUANTITY = 1
export const MAX_QUANTITY = 20
export const QUANTITY_OPTIONS: number[] = Array.from(
  { length: MAX_QUANTITY - MIN_QUANTITY + 1 },
  (_, index) => index + MIN_QUANTITY,
)

export function isQuantityOutOfRange(quantity: string): boolean {
  const trimmed = quantity.trim()
  if (!trimmed || !/^-?\d+$/.test(trimmed)) return false
  const parsed = Number(trimmed)
  return parsed < MIN_QUANTITY || parsed > MAX_QUANTITY
}

export function hasOutOfRangeQuantity(rows: CompositionRow[]): boolean {
  return rows.some((row) => isQuantityOutOfRange(row.quantity))
}

export interface ValidatedRows {
  items: Array<{ id: string; quantity: number }>
  errors: Record<string, string>
}

export function validateRows(rows: CompositionRow[], selectLabel: string): ValidatedRows {
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
    if ((quantity.value as number) > MAX_QUANTITY) {
      errors[row.key] = `A quantidade deve estar entre ${MIN_QUANTITY} e ${MAX_QUANTITY}.`
      continue
    }
    items.push({ id: row.itemId, quantity: quantity.value as number })
  }

  return { items, errors }
}
