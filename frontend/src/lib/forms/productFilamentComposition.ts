// Funções puras usadas por FilamentCompositionForm.tsx — mesmo critério de
// lib/forms/productComposition.ts (arquivo companheiro, para
// Acessórios/Embalagens, NUNCA alterado por este incremento): extraídas
// para cá para eliminar o warning react-refresh/only-export-components
// (um arquivo de componente só pode exportar o próprio componente).
//
// Deliberadamente um arquivo NOVO e independente de productComposition.ts,
// não uma extensão dele — "peso teórico em gramas" (decimal, sem teto) tem
// forma e regras diferentes de "quantidade" (inteiro, Select 1-20): tipos
// diferentes (FilamentTypeRow vs CompositionRow), sem herdar nenhuma
// suposição de intervalo fixo. Mesmo padrão de "tabela de filamento é
// paralela e independente de acessórios/embalagens" já usado no banco
// (product_filaments/set_product_filaments, migration 20260827113000).

import { parseNumberField } from '@/lib/forms/numberField'
import type { FilamentTypeSummary, ProductFilament } from '@/types/domain'

export interface FilamentCompositionRow {
  key: string
  filamentTypeId: string | null
  weight: string
}

let rowKeySeq = 0
export function nextFilamentRowKey(): string {
  rowKeySeq += 1
  return `filament-row-${rowKeySeq}`
}

export function filamentRowsFrom(items: ProductFilament[]): FilamentCompositionRow[] {
  return items.map((item) => ({
    key: nextFilamentRowKey(),
    filamentTypeId: item.filament_type_id,
    weight: String(item.theoretical_weight_grams),
  }))
}

// Mesma lógica de filterSelectableItems (productComposition.ts), adaptada
// ao formato de FilamentTypeSummary (chave primária é filament_type_id, não
// id) — o tipo já selecionado NAQUELA linha é sempre mantido mesmo inativo
// (nunca some da tela por desativação posterior); tipos já escolhidos em
// OUTRAS linhas são excluídos (impede duplicidade); qualquer outro tipo
// inativo é excluído das opções para uma seleção NOVA, já que
// set_product_filaments sempre rejeita filament_type_id inativo.
export function filterSelectableFilamentTypes(
  types: FilamentTypeSummary[],
  chosenElsewhere: Set<string>,
  currentFilamentTypeId: string | null,
): FilamentTypeSummary[] {
  return types.filter((type) => {
    if (type.filament_type_id === currentFilamentTypeId) return true
    if (chosenElsewhere.has(type.filament_type_id)) return false
    return type.is_active
  })
}

// Mesmo formato "material · fabricante · linha · cor" já usado em
// FilamentTypeDrawer.tsx (typeLabel) — marca visivelmente um tipo inativo
// já vinculado, mesmo idioma de itemLabel (productComposition.ts).
export function filamentTypeLabel(type: FilamentTypeSummary): string {
  const base = `${type.material} · ${type.manufacturer} · ${type.line} · ${type.commercial_color}`
  return type.is_active ? base : `${base} (inativo)`
}

export function findFilamentTypeById(
  types: FilamentTypeSummary[],
  filamentTypeId: string | null,
): FilamentTypeSummary | undefined {
  if (filamentTypeId === null) return undefined
  return types.find((type) => type.filament_type_id === filamentTypeId)
}

export function isFilamentRowInactive(row: FilamentCompositionRow, types: FilamentTypeSummary[]): boolean {
  const type = findFilamentTypeById(types, row.filamentTypeId)
  return type ? !type.is_active : false
}

export function hasInactiveFilamentSelection(rows: FilamentCompositionRow[], types: FilamentTypeSummary[]): boolean {
  return rows.some((row) => isFilamentRowInactive(row, types))
}

export interface ValidatedFilamentRows {
  items: Array<{ id: string; theoretical_weight_grams: number }>
  errors: Record<string, string>
}

// Peso teórico: decimal (aceita vírgula OU ponto — parseNumberField já
// normaliza os dois, requisito "peso decimal brasileiro"), sempre > 0, sem
// teto artificial (ao contrário da quantidade 1-20 de Acessórios/
// Embalagens, gramas de filamento não têm um limite natural pequeno).
// Duplicidade de tipo é impedida na ORIGEM (filterSelectableFilamentTypes
// nunca oferece um tipo já escolhido noutra linha), mas revalidada aqui
// como defesa em profundidade — nunca confia só na UI para essa garantia.
export function validateFilamentRows(rows: FilamentCompositionRow[]): ValidatedFilamentRows {
  const errors: Record<string, string> = {}
  const items: Array<{ id: string; theoretical_weight_grams: number }> = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!row.filamentTypeId) {
      errors[row.key] = 'Selecione um tipo de filamento.'
      continue
    }
    if (seen.has(row.filamentTypeId)) {
      errors[row.key] = 'Este tipo de filamento já está na composição — remova a linha duplicada.'
      continue
    }

    const weight = parseNumberField(row.weight, 'o peso teórico', { required: true, min: 0.01 })
    if (weight.error) {
      errors[row.key] = weight.error
      continue
    }

    seen.add(row.filamentTypeId)
    items.push({ id: row.filamentTypeId, theoretical_weight_grams: weight.value as number })
  }

  return { items, errors }
}
