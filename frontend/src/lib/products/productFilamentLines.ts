// Função pura de resolução para a seção "Filamentos" da Ficha Técnica do
// Produto (Módulo 3, Incremento 6A). Arquivo NOVO e independente de
// productCosts.ts (Acessórios/Embalagens, NUNCA alterado por este
// incremento) — filamento não tem custo unitário cadastrado
// (filament_types não tem coluna unit_cost), então não participa do
// "Subtotal de componentes" já existente; nenhuma alteração naquele
// cálculo. Somente leitura: nenhuma automação de consumo lê isto.

import type { CompositionLineStatus } from '@/lib/products/productCosts'
import type { FilamentTypeSummary } from '@/types/domain'

export interface ResolvedFilamentLine {
  key: string
  name: string
  status: CompositionLineStatus
  weightGrams: number
}

function filamentTypeName(type: FilamentTypeSummary): string {
  return `${type.material} · ${type.manufacturer} · ${type.line} · ${type.commercial_color}`
}

export function resolveFilamentLines(
  items: Array<{ filament_type_id: string; theoretical_weight_grams: number }>,
  filamentTypes: FilamentTypeSummary[],
): ResolvedFilamentLine[] {
  return items.map((item) => {
    const found = filamentTypes.find((type) => type.filament_type_id === item.filament_type_id)

    if (!found) {
      return {
        key: item.filament_type_id,
        name: 'Tipo de filamento não encontrado',
        status: 'missing',
        weightGrams: item.theoretical_weight_grams,
      }
    }

    return {
      key: item.filament_type_id,
      name: filamentTypeName(found),
      status: found.is_active ? 'active' : 'inactive',
      weightGrams: item.theoretical_weight_grams,
    }
  })
}
