// Consolidação da listagem de Filamentos por Material + Linha + Cor
// (2026-09-01) — a coluna Fabricante saiu da listagem principal, mas o
// fabricante continua íntegro no banco, no cadastro do tipo/rolo, nas
// compras, no histórico e nos detalhes de "Ver rolos". Estas funções são
// PURAS (sem React/DOM) — operam só sobre os resumos já carregados de
// vw_filament_type_summary; nunca fazem consulta, nunca mutam a entrada.

import { PT_BR_COLLATOR } from '@/components/dataTable/sorting'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import type { FilamentMaterial, FilamentTypeSummary } from '@/types/domain'

// Chave de agrupamento por token: minúsculas + sem acentos (normalizeForSearch)
// + espaços internos colapsados. "Basic  Matte" e "basic matte" caem no
// mesmo token; cores/linhas realmente distintas nunca colidem (o token é o
// texto inteiro normalizado, nunca um prefixo).
export function normalizeFilamentToken(value: string): string {
  return normalizeForSearch(value).replace(/\s+/g, ' ')
}

// Rótulo canônico legível de um conjunto de grafias equivalentes: a mais
// frequente (comparada já aparada de bordas); empate resolve pela ordem
// alfabética pt-BR (determinístico, nunca depende da ordem de chegada).
export function pickCanonicalLabel(values: string[]): string {
  const counts = new Map<string, number>()
  for (const value of values) {
    const trimmed = value.trim()
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1)
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || PT_BR_COLLATOR.compare(a[0], b[0]),
  )[0][0]
}

export interface FilamentGroup {
  // material + token(linha) + token(cor) — identidade estável do grupo.
  key: string
  // Valor técnico do material (PLA/PETG/TPU) — já normalizado no domínio.
  material: FilamentMaterial
  // Rótulos canônicos legíveis para exibição (a partir das grafias reais
  // dos tipos do grupo).
  lineLabel: string
  colorLabel: string
  // Somatórios consolidados (vindos de vw_filament_type_summary, um tipo
  // aparece uma única vez na view — nenhum rolo é contado duas vezes).
  availableGrams: number
  usableSpoolCount: number
  // Estoque mínimo consolidado: MAIOR limite entre os tipos ATIVOS do grupo
  // (fabricantes diferentes representam o mesmo estoque comercial — somar os
  // limites multiplicaria o mínimo artificialmente). null quando nenhum
  // tipo ativo do grupo tem limite definido.
  minimumStockGrams: number | null
  // Fabricantes presentes no grupo — únicos, ordenados. Continua visível em
  // "Ver rolos" e em cada rolo; só sai da listagem principal.
  manufacturers: string[]
  // Tipos (filament_type_id) que compõem o grupo — usados por "Ver rolos"
  // para carregar os rolos de TODOS eles numa única consulta.
  filamentTypeIds: string[]
  types: FilamentTypeSummary[]
}

// Agrupa os resumos de tipo por Material + Linha + Cor e devolve os grupos
// já ordenados de forma determinística por Material -> Linha -> Cor (rótulo
// consolidado) — nunca pela ordem/fabricante do primeiro tipo.
export function groupFilamentTypes(types: FilamentTypeSummary[]): FilamentGroup[] {
  const byKey = new Map<string, FilamentTypeSummary[]>()
  for (const type of types) {
    // JSON.stringify de uma tupla: chave sem separador que possa colidir
    // com um texto real de linha/cor.
    const key = JSON.stringify([
      type.material,
      normalizeFilamentToken(type.line),
      normalizeFilamentToken(type.commercial_color),
    ])
    const existing = byKey.get(key)
    if (existing) existing.push(type)
    else byKey.set(key, [type])
  }

  const groups: FilamentGroup[] = []
  for (const [key, groupTypes] of byKey) {
    const activeMinimums = groupTypes
      .filter((type) => type.is_active && type.minimum_stock_grams !== null)
      .map((type) => type.minimum_stock_grams as number)

    groups.push({
      key,
      material: groupTypes[0].material,
      lineLabel: pickCanonicalLabel(groupTypes.map((type) => type.line)),
      colorLabel: pickCanonicalLabel(groupTypes.map((type) => type.commercial_color)),
      availableGrams: groupTypes.reduce((sum, type) => sum + type.total_available_grams, 0),
      usableSpoolCount: groupTypes.reduce((sum, type) => sum + type.usable_spool_count, 0),
      minimumStockGrams: activeMinimums.length > 0 ? Math.max(...activeMinimums) : null,
      manufacturers: [...new Set(groupTypes.map((type) => type.manufacturer))].sort((a, b) =>
        PT_BR_COLLATOR.compare(a, b),
      ),
      filamentTypeIds: groupTypes.map((type) => type.filament_type_id),
      types: groupTypes,
    })
  }

  return groups.sort(
    (a, b) =>
      PT_BR_COLLATOR.compare(a.material, b.material) ||
      PT_BR_COLLATOR.compare(a.lineLabel, b.lineLabel) ||
      PT_BR_COLLATOR.compare(a.colorLabel, b.colorLabel),
  )
}

// Busca local sobre um grupo consolidado — Material, Linha, Cor (rótulos
// consolidados) e QUALQUER fabricante do grupo. Mesmo sem a coluna
// Fabricante, digitar o nome de um fabricante localiza o grupo. Código de
// rolo não entra: a listagem principal não carrega rolos (só "Ver rolos"),
// então buscar por código nunca foi suportado aqui.
export function matchesFilamentGroupSearch(group: FilamentGroup, normalizedTerm: string): boolean {
  if (!normalizedTerm) return true
  return (
    normalizeForSearch(group.material).includes(normalizedTerm) ||
    normalizeForSearch(group.lineLabel).includes(normalizedTerm) ||
    normalizeForSearch(group.colorLabel).includes(normalizedTerm) ||
    group.manufacturers.some((manufacturer) =>
      normalizeForSearch(manufacturer).includes(normalizedTerm),
    )
  )
}
