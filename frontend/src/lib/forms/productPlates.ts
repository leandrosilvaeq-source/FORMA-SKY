// Funções puras usadas por ProductForm.tsx (seção "Composição" — estrutura
// produtiva por plates) e por OrderForm.tsx (seção "Cores e filamentos" —
// seleção de filamento por unidade+plate de um item CATALOG).
//
// Migration 20260829180000_add_categories_plate_weight_and_order_colors.sql
// (ainda não aplicada) retirou TODA composição de filamento do cadastro do
// Produto: product_plates.weight_grams passa a ser uma coluna DIRETA
// (informada no formulário, nunca mais somada de linhas de filamento por
// plate) e a escolha de filamento/cor migrou inteiramente para o Pedido
// (order_item_unit_plate_filaments). Por isso PlateRow abaixo perdeu o
// campo `filaments` que tinha antes desta migration — ProductForm.tsx não
// seleciona mais nenhum filamento.
//
// Os 3 seletores de tipo de filamento abaixo (filterSelectableFilamentTypes/
// filamentTypeLabel/findFilamentTypeById) continuam existindo porque
// OrderForm.tsx passa a ser o único consumidor a partir desta migration —
// mesma regra de sempre: "só tipos ativos para uma seleção NOVA, tipo já
// vinculado nunca some sozinho por ter ficado inativo depois".

import { parseDurationToSeconds, formatSecondsAdaptive } from '@/lib/forms/durationField'
import { parseNumberField } from '@/lib/forms/numberField'
import type { FilamentTypeSummary, ProductPlate } from '@/types/domain'

// Mesma lógica de filterSelectableItems (productComposition.ts, Acessórios/
// Embalagens), adaptada ao formato de FilamentTypeSummary (chave primária é
// filament_type_id, não id) — o tipo já selecionado NAQUELA seleção é sempre
// mantido mesmo inativo (nunca some da tela por desativação posterior);
// tipos já escolhidos em OUTRAS seleções do MESMO escopo (ex.: mesma unidade
// e plate, em OrderForm.tsx) podem ser excluídos pelo chamador via
// `chosenElsewhere`; qualquer outro tipo inativo é excluído das opções para
// uma seleção NOVA.
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

export interface PlateRow {
  key: string
  // Tempo do plate como texto livre — parseDurationToSeconds aceita vários
  // formatos (hh:mm, hh:mm:ss, 18h32, 19m44, 32min20, 1,5h, 90m…). Ao
  // pré-preencher a EDIÇÃO usamos formatSecondsAdaptive: hh:mm quando o
  // valor salvo não tem segundos, hh:mm:ss quando tem — nunca truncando os
  // segundos que já estavam persistidos.
  timeInput: string
  // Peso direto do plate (g) — texto livre, validado no submit. Substitui a
  // soma de linhas de filamento que existia antes desta migration.
  weightInput: string
}

let plateKeySeq = 0
export function nextPlateRowKey(): string {
  plateKeySeq += 1
  return `plate-row-${plateKeySeq}`
}

export function emptyPlateRow(): PlateRow {
  return { key: nextPlateRowKey(), timeInput: '', weightInput: '' }
}

export function plateRowsFrom(plates: ProductPlate[]): PlateRow[] {
  return plates
    .slice()
    .sort((a, b) => a.plate_number - b.plate_number)
    .map((plate) => ({
      key: nextPlateRowKey(),
      timeInput: formatSecondsAdaptive(plate.production_time_seconds),
      weightInput: String(plate.weight_grams),
    }))
}

// Compatibilidade com Produtos legados que, por algum motivo, ainda não têm
// nenhuma linha em product_plates ao carregar a edição (não deveria
// acontecer após o backfill da migration 20260829180000, que cobre todo
// Produto existente — ver Seção 16 dessa migration — mas esta função evita
// que ProductForm abra a edição com uma composição vazia e apague
// silenciosamente peso/tempo que só estavam em default_weight_grams/
// default_print_time_seconds, caso algum caso de borda escape do backfill).
// Só chamada pelo carregamento da edição (ProductsPage.tsx) quando
// plates.length === 0; nunca durante a criação (initialValues não existe).
export function plateRowsFromLegacyWeight(
  defaultWeightGrams: number | null,
  defaultTimeSeconds: number | null,
): PlateRow[] {
  if (defaultWeightGrams === null && defaultTimeSeconds === null) return []

  return [
    {
      key: nextPlateRowKey(),
      timeInput: defaultTimeSeconds !== null ? formatSecondsAdaptive(defaultTimeSeconds) : '',
      weightInput: defaultWeightGrams !== null ? String(defaultWeightGrams) : '',
    },
  ]
}

// Peso (g) de UM plate — best-effort, linha inválida/vazia conta como 0
// nesta soma "ao vivo" de pré-visualização (a validação real e estrita só
// acontece no submit, ver validatePlateRows abaixo).
export function autoPlateWeightGrams(plate: PlateRow): number {
  const parsed = parseNumberField(plate.weightInput, 'peso', { min: 0 })
  return parsed.value ?? 0
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

export interface ValidatedPlate {
  production_time_seconds: number
  weight_grams: number
}

export interface ValidatedPlates {
  items: ValidatedPlate[]
  // Erro de tempo do plate, indexado por plate.key.
  timeErrors: Record<string, string>
  // Erro de peso do plate, indexado por plate.key.
  weightErrors: Record<string, string>
}

// Valida TODOS os plates antes de qualquer submit — tempo é opcional (em
// branco = 0, mesmo comportamento que "Tempo de Produção" já tinha no
// formulário antigo, já que products.default_print_time_seconds é
// nullable), mas peso é OBRIGATÓRIO e deve ser > 0 (um plate sem peso
// informado nunca é um plate válido — diferente do tempo, que pode ser
// preenchido depois).
export function validatePlateRows(plates: PlateRow[]): ValidatedPlates {
  const timeErrors: Record<string, string> = {}
  const weightErrors: Record<string, string> = {}
  const items: ValidatedPlate[] = []

  for (const plate of plates) {
    const durationResult = parseDurationToSeconds(plate.timeInput)
    let productionTimeSeconds = 0
    if (!durationResult.ok) {
      timeErrors[plate.key] = durationResult.error
    } else {
      productionTimeSeconds = durationResult.seconds ?? 0
    }

    const weightResult = parseNumberField(plate.weightInput, 'o peso do plate', {
      required: true,
      min: 0.01,
    })
    let weightGrams = 0
    if (weightResult.error) {
      weightErrors[plate.key] = weightResult.error
    } else {
      weightGrams = weightResult.value as number
    }

    items.push({ production_time_seconds: productionTimeSeconds, weight_grams: weightGrams })
  }

  return { items, timeErrors, weightErrors }
}
