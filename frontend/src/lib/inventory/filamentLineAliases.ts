// Consolidação visual das variações de grafia de "Linha" (2026-09-05) — ex.:
// Sólida/Solida/Solido/Sólido todas exibidas e filtradas sob um único
// "Sólido"; Mate/Matte sob "Mate"; Translucido/Translúcido sob
// "Translúcido"; "Duo Color"/Duocolor/DuoColor sob "Duocolor"; "Tri
// Color"/Tricolor/TriColor sob "Tricolor". Camada de APRESENTAÇÃO/FILTRAGEM
// apenas — nunca reescreve o valor armazenado (filament_types.line preserva
// sempre a grafia original; nenhum UPDATE é feito por este módulo).
//
// Reaproveita normalizeFilamentToken (mesma normalização de caixa/acento/
// espaço já usada para agrupar a listagem e para os filtros de Cor) — nunca
// uma segunda regra de comparação. Um único helper serve TANTO o filtro
// (Seção 3/4 do pedido) QUANTO a coluna "Linha" da tabela (Seção 5) — nunca
// duas normalizações divergentes.
import { normalizeFilamentToken } from './filamentGroups'

// As 7 Linhas oficiais mostradas como action buttons no filtro (mais
// "Todos") — grafia de EXIBIÇÃO, distinta das grafias aceitas pelo
// formulário de cadastro (FilamentTypeForm.LINE_OPTIONS, que grava "Sólida"/
// "Matte"/"DuoColor" literalmente). Um tipo cadastrado com qualquer uma das
// grafias mapeadas em LINE_ALIAS_BY_TOKEN aparece/filtra sob o rótulo
// correspondente aqui, mesmo que o valor gravado seja outro.
export const FILAMENT_LINE_FILTER_OPTIONS = [
  'Sólido',
  'Silk',
  'Mate',
  'Velvet',
  'Translúcido',
  'Duocolor',
  'Tricolor',
] as const

export type FilamentLineFilterOption = (typeof FILAMENT_LINE_FILTER_OPTIONS)[number]

// token normalizado (normalizeFilamentToken) -> rótulo de exibição oficial.
// Chaves sempre em minúsculas/sem acento/espaço único — nunca comparadas
// contra a grafia crua.
const LINE_ALIAS_BY_TOKEN: Record<string, FilamentLineFilterOption> = {
  solida: 'Sólido',
  solido: 'Sólido',
  silk: 'Silk',
  mate: 'Mate',
  matte: 'Mate',
  velvet: 'Velvet',
  translucido: 'Translúcido',
  duocolor: 'Duocolor',
  'duo color': 'Duocolor',
  tricolor: 'Tricolor',
  'tri color': 'Tricolor',
}

// Resolve a grafia real de Linha (como armazenada/exibida antes desta
// consolidação) para o rótulo de exibição consolidado. Usado TANTO pela
// coluna "Linha" da tabela QUANTO pela comparação do filtro — nunca duas
// normalizações divergentes. Uma grafia fora do mapa (valor histórico não
// oficial, ex. de antes de a Linha virar action buttons) cai no próprio
// valor original, sem quebra: nunca escondido nem substituído por algo
// errado, só não casa com nenhum dos 7 botões oficiais.
export function resolveFilamentLineDisplayLabel(rawLine: string): string {
  const token = normalizeFilamentToken(rawLine)
  return LINE_ALIAS_BY_TOKEN[token] ?? rawLine
}
