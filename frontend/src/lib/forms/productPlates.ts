// Funções puras usadas por ProductForm.tsx (seção "Composição" — estrutura
// produtiva por plates, 2026-08-29) — mesmo critério de
// lib/forms/productFilamentComposition.ts (arquivo companheiro, para a
// composição FLAT antiga, NUNCA alterado por esta migration): extraídas
// para cá para eliminar o warning react-refresh/only-export-components.
//
// Reaproveita os seletores de tipo de filamento (filterSelectableFilamentTypes/
// filamentTypeLabel/findFilamentTypeById) de productFilamentComposition.ts
// diretamente — mesma regra de "só tipos ativos, tipo já vinculado nunca
// some sozinho" — só a estrutura de linhas (agora aninhada em plates) é
// nova. Duplicidade de filamento é impedida DENTRO do mesmo plate apenas —
// o mesmo filamento em plates DIFERENTES é permitido (cada plate tem sua
// própria composição independente).

import { parseDurationToSeconds, formatSecondsToHHMM } from '@/lib/forms/durationField'
import { parseNumberField } from '@/lib/forms/numberField'
import {
  filamentTypeLabel,
  filterSelectableFilamentTypes,
  findFilamentTypeById,
  isFilamentRowInactive as isFilamentTypeRowInactive,
} from '@/lib/forms/productFilamentComposition'
import type { FilamentTypeSummary, ProductPlate, ProductPlateFilament } from '@/types/domain'

export { filamentTypeLabel, filterSelectableFilamentTypes, findFilamentTypeById }

export interface PlateFilamentRow {
  key: string
  filamentTypeId: string | null
  weight: string
}

export interface PlateRow {
  key: string
  // hh:mm (ProductForm exibe/edita só horas:minutos para o tempo de cada
  // plate — parseDurationToSeconds aceita esse e outros formatos livremente,
  // formatSecondsToHHMM sempre reformata de volta para hh:mm ao perder o
  // foco, mesmo padrão de handleDurationBlur já usado no campo de preço/
  // tempo antigo).
  timeInput: string
  filaments: PlateFilamentRow[]
}

let plateKeySeq = 0
export function nextPlateRowKey(): string {
  plateKeySeq += 1
  return `plate-row-${plateKeySeq}`
}

let plateFilamentKeySeq = 0
export function nextPlateFilamentRowKey(): string {
  plateFilamentKeySeq += 1
  return `plate-filament-row-${plateFilamentKeySeq}`
}

export function emptyPlateFilamentRow(): PlateFilamentRow {
  return { key: nextPlateFilamentRowKey(), filamentTypeId: null, weight: '' }
}

// Todo plate novo já nasce com 1 linha de filamento sugerida (nunca
// obrigatória no backend — set_product_production aceita 0 linhas — mas a
// UI sempre sugere ao menos uma, para não abrir um plate visualmente vazio
// por padrão).
export function emptyPlateRow(): PlateRow {
  return { key: nextPlateRowKey(), timeInput: '', filaments: [emptyPlateFilamentRow()] }
}

export function plateRowsFrom(
  plates: ProductPlate[],
  filamentsByPlateId: Map<string, ProductPlateFilament[]>,
): PlateRow[] {
  return plates.map((plate) => ({
    key: nextPlateRowKey(),
    timeInput: formatSecondsToHHMM(plate.production_time_seconds),
    filaments: (filamentsByPlateId.get(plate.id) ?? []).map((filament) => ({
      key: nextPlateFilamentRowKey(),
      filamentTypeId: filament.filament_type_id,
      weight: String(filament.weight_grams),
    })),
  }))
}

// Filamentos já escolhidos NESTE MESMO plate (exclui a própria linha
// atual) — escopo de duplicidade é só dentro do plate, nunca entre plates.
export function chosenFilamentTypeIdsInPlate(plate: PlateRow, excludingRowKey: string): Set<string> {
  return new Set(
    plate.filaments
      .filter((row) => row.key !== excludingRowKey)
      .map((row) => row.filamentTypeId)
      .filter((id): id is string => id !== null),
  )
}

export function hasInactiveFilamentSelectionInPlates(plates: PlateRow[], types: FilamentTypeSummary[]): boolean {
  return plates.some((plate) => plate.filaments.some((row) => isFilamentTypeRowInactive(row, types)))
}

// Peso automático de UM plate — soma best-effort dos pesos já válidos das
// linhas (linhas vazias/inválidas contam como 0 nesta soma "ao vivo" de
// pré-visualização — a validação real e estrita só acontece no submit,
// ver validatePlateRows abaixo).
export function autoPlateWeightGrams(plate: PlateRow): number {
  return plate.filaments.reduce((total, row) => {
    const parsed = parseNumberField(row.weight, 'peso', { min: 0 })
    return total + (parsed.value ?? 0)
  }, 0)
}

// Tempo (segundos) de UM plate — best-effort, mesmo critério do peso.
export function autoPlateTimeSeconds(plate: PlateRow): number {
  const result = parseDurationToSeconds(plate.timeInput)
  return result.ok ? (result.seconds ?? 0) : 0
}

export function autoTotalWeightGrams(plates: PlateRow[]): number {
  return plates.reduce((total, plate) => total + autoPlateWeightGrams(plate), 0)
}

export function autoTotalTimeSeconds(plates: PlateRow[]): number {
  return plates.reduce((total, plate) => total + autoPlateTimeSeconds(plate), 0)
}

export interface ValidatedPlateFilament {
  filament_type_id: string
  weight_grams: number
}

export interface ValidatedPlate {
  production_time_seconds: number
  filaments: ValidatedPlateFilament[]
}

export interface ValidatedPlates {
  items: ValidatedPlate[]
  // Erro de tempo do plate, indexado por plate.key.
  timeErrors: Record<string, string>
  // Erro de uma linha de filamento, indexado por
  // `${plate.key}:${filament.key}`.
  filamentErrors: Record<string, string>
}

// Valida TODOS os plates/filamentos antes de qualquer submit — nenhum
// plate exige ao menos 1 linha de filamento (0 é aceito, mesma decisão do
// backend), mas toda linha PRESENTE precisa ter tipo selecionado e peso >
// 0; tempo de cada plate é obrigatório (>= 0, nunca vazio — um plate sem
// tempo informado ainda não está pronto para ser salvo).
export function validatePlateRows(plates: PlateRow[]): ValidatedPlates {
  const timeErrors: Record<string, string> = {}
  const filamentErrors: Record<string, string> = {}
  const items: ValidatedPlate[] = []

  for (const plate of plates) {
    // Tempo em branco = 0 (plate ainda sem tempo definido) — nunca
    // obrigatório, mesmo comportamento opcional que "Tempo de Produção" já
    // tinha no formulário antigo (products.default_print_time_seconds é
    // nullable). Só um texto realmente inválido (não reconhecido por
    // parseDurationToSeconds) bloqueia o salvamento.
    const durationResult = parseDurationToSeconds(plate.timeInput)
    let productionTimeSeconds = 0
    if (!durationResult.ok) {
      timeErrors[plate.key] = durationResult.error
    } else {
      productionTimeSeconds = durationResult.seconds ?? 0
    }

    const seen = new Set<string>()
    const filaments: ValidatedPlateFilament[] = []
    for (const row of plate.filaments) {
      // Linha totalmente vazia (nunca tocada) é ignorada silenciosamente
      // só quando é a ÚNICA linha do plate — permite um plate "só com
      // tempo, sem composição ainda" sem forçar o usuário a remover a
      // linha sugerida por padrão manualmente.
      if (!row.filamentTypeId && !row.weight.trim() && plate.filaments.length === 1) {
        continue
      }

      if (!row.filamentTypeId) {
        filamentErrors[`${plate.key}:${row.key}`] = 'Selecione um tipo de filamento.'
        continue
      }
      if (seen.has(row.filamentTypeId)) {
        filamentErrors[`${plate.key}:${row.key}`] =
          'Este tipo de filamento já está neste plate — remova a linha duplicada.'
        continue
      }

      const weight = parseNumberField(row.weight, 'o peso', { required: true, min: 0.01 })
      if (weight.error) {
        filamentErrors[`${plate.key}:${row.key}`] = weight.error
        continue
      }

      seen.add(row.filamentTypeId)
      filaments.push({ filament_type_id: row.filamentTypeId, weight_grams: weight.value as number })
    }

    items.push({ production_time_seconds: productionTimeSeconds, filaments })
  }

  return { items, timeErrors, filamentErrors }
}
