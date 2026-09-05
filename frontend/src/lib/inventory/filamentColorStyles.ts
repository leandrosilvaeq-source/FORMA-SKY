// Mapeamento de estilo visual da Cor de filamento (2026-09-04) — separado de
// FilamentColorBadge.tsx (que fica só com o componente) para não misturar
// export de componente com export de função/constante no mesmo arquivo
// (react-refresh/only-export-components) e para permitir reaproveitar o
// mapeamento fora de React caso necessário (é uma função PURA, sem DOM).
//
// Reconhecimento: reaproveita EXATAMENTE normalizeFilamentToken (minúsculas
// + sem acentos + espaços colapsados), a mesma normalização já usada para
// consolidar a listagem de Filamentos por Cor — nunca uma segunda regra de
// comparação. Para nomes compostos (ex.: "Azul Bambu Lab"), a primeira
// palavra reconhecida no texto decide o estilo (aqui, "azul"); combinações
// de duas palavras (ex.: "Azul Escuro") são verificadas primeiro, para não
// perder o tom mais específico só porque a palavra-base sozinha também é
// reconhecida.
//
// Classes Tailwind ESTÁTICAS (nunca montadas por interpolação de partes) —
// cada entrada do mapa é uma string literal completa, para nunca ser
// removida pelo build de produção por não aparecer em nenhum lugar do
// código-fonte como texto reconhecível pelo Tailwind.
//
// Sem variantes dark: — esta aplicação não tem nenhum alternador de tema
// (confirmado por auditoria: nenhum ThemeProvider/prefers-color-scheme
// próprio da aplicação, só o tema interno do componente de toast) e nenhum
// outro badge desta mesma área (Situação, Inativo, Arquivado) usa dark:,
// então este também não usa, para permanecer visualmente coerente com eles.
import { normalizeFilamentToken } from '@/lib/inventory/filamentGroups'

// Cor desconhecida — mesmo padrão neutro já usado pelos badges "Inativo"
// (FilamentTypeDrawer.tsx) e "Arquivado" (FilamentsInventoryPage.tsx).
const UNKNOWN_COLOR_CLASSNAME = 'border-input text-muted-foreground'

// Combinações de DUAS palavras — verificadas antes das palavras isoladas.
const TWO_WORD_COLOR_CLASSNAMES: Record<string, string> = {
  'azul claro': 'border-sky-300 bg-sky-50 text-sky-700',
  'azul escuro': 'border-blue-400 bg-blue-100 text-blue-900',
  'verde claro': 'border-lime-300 bg-lime-50 text-lime-800',
  'verde escuro': 'border-green-500 bg-green-100 text-green-900',
  'rosa claro': 'border-pink-200 bg-pink-50 text-pink-700',
  'cinza escuro': 'border-gray-500 bg-gray-200 text-gray-900',
}

// Palavras isoladas — mapeamento inicial pedido, mais suas cores base
// (usadas quando o modificador "claro"/"escuro" não acompanha a cor, ex.:
// "Verde" sozinho). Amarelo e Dourado usam texto num tom mais escuro
// (-900) que os demais (-800) por pedido explícito de legibilidade sobre
// fundo claro. Branco usa fundo cinza-claro + borda visível (nunca branco
// puro sobre o fundo branco da página).
const SINGLE_WORD_COLOR_CLASSNAMES: Record<string, string> = {
  preto: 'border-neutral-700 bg-neutral-800 text-neutral-50',
  branco: 'border-slate-400 bg-slate-50 text-slate-700',
  cinza: 'border-gray-300 bg-gray-100 text-gray-700',
  vermelho: 'border-red-300 bg-red-50 text-red-800',
  azul: 'border-blue-300 bg-blue-50 text-blue-800',
  verde: 'border-green-300 bg-green-50 text-green-800',
  amarelo: 'border-yellow-300 bg-yellow-50 text-yellow-900',
  laranja: 'border-orange-300 bg-orange-50 text-orange-800',
  roxo: 'border-purple-300 bg-purple-50 text-purple-800',
  rosa: 'border-pink-300 bg-pink-50 text-pink-800',
  marrom: 'border-stone-400 bg-stone-100 text-stone-800',
  bege: 'border-stone-300 bg-stone-50 text-stone-700',
  dourado: 'border-amber-400 bg-yellow-50 text-yellow-900',
  prateado: 'border-slate-400 bg-slate-100 text-slate-700',
  bronze: 'border-orange-700 bg-orange-100 text-orange-900',
  transparente: 'border-dashed border-slate-300 bg-slate-50 text-slate-600',
  natural: 'border-neutral-300 bg-neutral-50 text-neutral-600',
}

// Resolve as classes de cor (só a parte variável — fundo/borda/texto) a
// partir do nome completo cadastrado. Nunca lança erro nem retorna string
// vazia: uma cor desconhecida sempre cai no estilo neutro.
export function resolveFilamentColorClassName(colorLabel: string): string {
  const words = normalizeFilamentToken(colorLabel).split(' ').filter(Boolean)

  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`
    const twoWordMatch = TWO_WORD_COLOR_CLASSNAMES[pair]
    if (twoWordMatch) return twoWordMatch
  }

  for (const word of words) {
    const singleWordMatch = SINGLE_WORD_COLOR_CLASSNAMES[word]
    if (singleWordMatch) return singleWordMatch
  }

  return UNKNOWN_COLOR_CLASSNAME
}
