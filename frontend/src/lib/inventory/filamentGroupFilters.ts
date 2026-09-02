// Filtros da listagem consolidada de Filamentos (2026-09-01) — PUROS, sem
// React. Três grupos multisseleção (Material, Linha, Cor) + faixa de Nº de
// rolos disponíveis (mínimo/máximo). OR dentro de cada grupo; AND entre
// grupos e contra a faixa de rolos.

import { PT_BR_COLLATOR } from '@/components/dataTable/sorting'
import {
  normalizeFilamentToken,
  pickCanonicalLabel,
  type FilamentGroup,
} from '@/lib/inventory/filamentGroups'
import type { FilamentTypeSummary } from '@/types/domain'

export interface FilamentFilterOption {
  // Token normalizado — a identidade guardada no estado do filtro (nunca a
  // grafia crua, para não duplicar por maiúsculas/acentos/espaços).
  value: string
  // Rótulo canônico legível (grafia mais frequente).
  label: string
}

export interface FilamentGroupFilterState {
  // Materiais são valores técnicos (PLA/PETG/TPU) — guardados como estão.
  materials: Set<string>
  // Linhas e Cores guardam TOKENS normalizados.
  lines: Set<string>
  colors: Set<string>
  // Faixa inclusiva de rolos disponíveis consolidados. null = sem limite
  // naquele lado.
  minSpools: number | null
  maxSpools: number | null
}

export const EMPTY_FILAMENT_GROUP_FILTERS: FilamentGroupFilterState = {
  materials: new Set(),
  lines: new Set(),
  colors: new Set(),
  minSpools: null,
  maxSpools: null,
}

function canonicalByToken(values: string[]): FilamentFilterOption[] {
  // token -> grafias reais que caem nele (para escolher o rótulo canônico).
  const byToken = new Map<string, string[]>()
  for (const value of values) {
    const token = normalizeFilamentToken(value)
    if (!token) continue
    const spellings = byToken.get(token) ?? []
    spellings.push(value)
    byToken.set(token, spellings)
  }
  return [...byToken.entries()]
    .map(([token, spellings]) => ({ value: token, label: pickCanonicalLabel(spellings) }))
    .sort((a, b) => PT_BR_COLLATOR.compare(a.label, b.label))
}

// Opções dos três filtros, derivadas dos tipos carregados (não dos grupos —
// assim uma linha/cor que só existe em tipos inativos ainda aparece como
// opção, mesmo comportamento das opções de filtro de Produtos). Sem
// duplicatas por maiúsculas/acentos/espaços (a chave é o token).
export function filamentFilterOptions(types: FilamentTypeSummary[]): {
  materials: FilamentFilterOption[]
  lines: FilamentFilterOption[]
  colors: FilamentFilterOption[]
} {
  const materials = [...new Set(types.map((type) => type.material))]
    .sort((a, b) => PT_BR_COLLATOR.compare(a, b))
    .map((material) => ({ value: material, label: material }))
  return {
    materials,
    lines: canonicalByToken(types.map((type) => type.line)),
    colors: canonicalByToken(types.map((type) => type.commercial_color)),
  }
}

export function filamentGroupFilterCount(filters: FilamentGroupFilterState): number {
  return (
    filters.materials.size +
    filters.lines.size +
    filters.colors.size +
    (filters.minSpools !== null ? 1 : 0) +
    (filters.maxSpools !== null ? 1 : 0)
  )
}

export function hasActiveFilamentGroupFilters(filters: FilamentGroupFilterState): boolean {
  return filamentGroupFilterCount(filters) > 0
}

// mínimo > máximo é um estado inválido — o chamador bloqueia/avisa e nunca
// aplica o filtro nesse caso (retorna true para todos).
export function isFilamentSpoolRangeInvalid(filters: FilamentGroupFilterState): boolean {
  return (
    filters.minSpools !== null &&
    filters.maxSpools !== null &&
    filters.minSpools > filters.maxSpools
  )
}

export function matchesFilamentGroupFilters(
  group: FilamentGroup,
  filters: FilamentGroupFilterState,
): boolean {
  if (filters.materials.size > 0 && !filters.materials.has(group.material)) return false
  if (filters.lines.size > 0 && !filters.lines.has(normalizeFilamentToken(group.lineLabel)))
    return false
  if (filters.colors.size > 0 && !filters.colors.has(normalizeFilamentToken(group.colorLabel)))
    return false

  // A faixa usa a contagem CONSOLIDADA de rolos DISPONÍVEIS (saldo > 0).
  // Quando ela ainda não está disponível (null: carregando ou erro), a
  // faixa não pode ser avaliada e nunca descarta o grupo — a interface
  // também desabilita o controle nesse caso, nunca cai no número da view.
  if (!isFilamentSpoolRangeInvalid(filters) && group.availableSpoolCount !== null) {
    if (filters.minSpools !== null && group.availableSpoolCount < filters.minSpools) return false
    if (filters.maxSpools !== null && group.availableSpoolCount > filters.maxSpools) return false
  }
  return true
}

export function filterFilamentGroups(
  groups: FilamentGroup[],
  filters: FilamentGroupFilterState,
): FilamentGroup[] {
  return groups.filter((group) => matchesFilamentGroupFilters(group, filters))
}
