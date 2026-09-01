// Parsing/formatação puros para o campo "Tempo total de impressão"
// (ProductForm.tsx) e para a exibição de tempo na Ficha Técnica do Produto
// (ProductDetailPage.tsx) — nenhuma dependência de DOM/React, reutilizado
// pelos dois lugares (nunca duplicado). Armazenamento interno é sempre um
// número inteiro de segundos (products.default_print_time_seconds); nunca
// usa Date/Date-math para representar uma duração (duração não é um
// instante no tempo).
//
// Formatos aceitos na entrada (todos convertidos para segundos inteiros):
//   - "HH:MM:SS" (3 blocos separados por ':') — sempre horas:minutos:segundos;
//   - "A:B" (2 blocos) — HH:MM quando A < 24, MM:SS quando A >= 24 (um valor
//     de "hora" >= 24 não faz sentido, então é reinterpretado como MM:SS);
//     para minutos:segundos com o primeiro bloco < 24, a unidade precisa ser
//     explícita (ex.: "12m30s"), nunca "12:30" (que sempre vira 12h30min);
//   - sufixos de unidade combináveis: "Xh", "Ym"/"Ymin", "Zs", em qualquer
//     combinação presente (ex.: "1h30min", "30m45s", "45s", "90m"), com ou
//     sem espaço entre os blocos;
//   - horas decimais, com vírgula OU ponto ("1,5h", "1.5h") ou mesmo sem
//     nenhuma unidade ("1,5", "1.5" — um número puro é sempre interpretado
//     como horas);
//   - vazio (após trim) -> null (sem duração informada, campo opcional);
//   - qualquer valor negativo ou texto não reconhecível -> erro.
//
// Minutos/segundos que excedem 59 sempre "carregam" para a unidade
// superior — nunca por regra especial, e sim porque todo resultado é
// reduzido para um total de segundos único (horas*3600 + minutos*60 +
// segundos) antes de qualquer formatação; reformatar esse total já produz
// o carry corretamente (ex.: "90:00" -> interpretado como 90min0s = 5400s
// -> formatado de volta como "01:30:00").
//
// Horas decimais nunca passam por parseFloat()/multiplicação de ponto
// flutuante: a parte fracionária é convertida por aritmética inteira
// (numerador/denominador exatos), evitando o erro clássico de IEEE 754
// (ex.: 1.1 * 3600 podendo dar 3959.9999999999995 em vez de 3960).

export interface DurationParseSuccess {
  ok: true
  // null representa "nenhuma duração informada" (campo vazio) — distinto
  // de 0 (duração de zero segundos, explicitamente digitada e válida).
  seconds: number | null
}

export interface DurationParseFailure {
  ok: false
  error: string
}

export type DurationParseResult = DurationParseSuccess | DurationParseFailure

export const DURATION_HELP_TEXT = 'Aceita 18:32, 18h32, 19m44, 32min20, 1h30min, 1,5h ou 90m.'

const INVALID_MESSAGE = `Duração inválida. ${DURATION_HELP_TEXT}`
const NEGATIVE_MESSAGE = 'A duração não pode ser negativa.'
// Só para as formas compostas "<horas>h<minutos>" e "<min>m<seg>" /
// "<min>min<seg>" (ex.: "18h32", "19m44", "32min20"): o número depois de
// "h" é minuto e o número depois de "m"/"min" é segundo — fora de 0-59 o
// valor é rejeitado, nunca normalizado em silêncio (diferente de "90m" ou
// "01:90:00", que continuam carregando para a unidade superior).
const MINUTES_AFTER_H_MESSAGE = 'Os minutos após "h" devem estar entre 0 e 59 (ex.: 18h32).'
const SECONDS_AFTER_M_MESSAGE =
  'Os segundos após "m" ou "min" devem estar entre 0 e 59 (ex.: 19m44).'

// "1,5" / "1.5" -> intPart="1", fracPart="5". Nunca usa parseFloat: a
// fração é tratada como numerador/denominador inteiros exatos
// (3600 * numerador / denominador), arredondada só uma vez no final.
function decimalHoursToSeconds(raw: string): number {
  const normalized = raw.replace(',', '.')
  const [intPart, fracPart = ''] = normalized.split('.')
  const hours = Number(intPart || '0')
  const hourSeconds = hours * 3600
  if (!fracPart) return hourSeconds

  const numerator = Number(fracPart)
  const denominator = 10 ** fracPart.length
  const fracSeconds = Math.round((3600 * numerator) / denominator)
  return hourSeconds + fracSeconds
}

function fromParts(hours: number, minutes: number, seconds: number): DurationParseResult {
  return { ok: true, seconds: hours * 3600 + minutes * 60 + seconds }
}

const COLON_RE = /^(\d+):(\d+)(?::(\d+))?$/
// Combinação de sufixos "Xh", "Ym"/"Ymin", "Zs" — cada bloco é opcional,
// mas ao menos um precisa estar presente (checado depois do exec()).
// Espaço opcional entre blocos e entre o número e sua unidade.
const UNIT_SUFFIX_RE = /^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/i
// Formas compostas com um número "solto" logo após a unidade final, sem
// sufixo próprio — complementam UNIT_SUFFIX_RE (que exige a unidade em cada
// bloco). Só disparam quando a string TERMINA em dígitos imediatamente
// depois de "h" ou "m"/"min"; "18h", "90m", "1h30m", "30m45s" etc. não
// batem aqui e continuam pelo caminho de UNIT_SUFFIX_RE.
const HOURS_MINUTES_RE = /^(\d+)\s*h\s*(\d+)$/i
const MINUTES_SECONDS_RE = /^(\d+)\s*m(?:in)?\s*(\d+)$/i
const BARE_NUMBER_RE = /^\d+(?:[.,]\d+)?$/

export function parseDurationToSeconds(raw: string): DurationParseResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, seconds: null }

  if (trimmed.startsWith('-')) {
    return { ok: false, error: NEGATIVE_MESSAGE }
  }

  const colonMatch = COLON_RE.exec(trimmed)
  if (colonMatch) {
    const [, a, b, c] = colonMatch
    if (c !== undefined) {
      // Três blocos: sempre HH:MM:SS, qualquer que seja a magnitude.
      return fromParts(Number(a), Number(b), Number(c))
    }
    // Dois blocos: HH:MM quando o primeiro bloco é um valor de hora
    // plausível (< 24); MM:SS quando o primeiro bloco já ultrapassa 24
    // (não pode ser hora) — "12:30" nunca é minutos:segundos, mesmo que o
    // usuário quisesse dizer "12min30s" (para isso, a unidade precisa ser
    // explícita: "12m30s").
    const first = Number(a)
    const second = Number(b)
    if (first >= 24) {
      return fromParts(0, first, second)
    }
    return fromParts(first, second, 0)
  }

  const unitMatch = UNIT_SUFFIX_RE.exec(trimmed)
  if (
    unitMatch &&
    (unitMatch[1] !== undefined || unitMatch[2] !== undefined || unitMatch[3] !== undefined)
  ) {
    const [, hoursPart, minutesPart, secondsPart] = unitMatch
    let totalSeconds = 0
    if (hoursPart !== undefined) totalSeconds += decimalHoursToSeconds(hoursPart)
    if (minutesPart !== undefined) totalSeconds += Number(minutesPart) * 60
    if (secondsPart !== undefined) totalSeconds += Number(secondsPart)
    return { ok: true, seconds: totalSeconds }
  }

  // "18h32" -> 18 h e 32 min (o número depois de "h" é sempre minuto).
  const hoursMinutesMatch = HOURS_MINUTES_RE.exec(trimmed)
  if (hoursMinutesMatch) {
    const hours = Number(hoursMinutesMatch[1])
    const minutes = Number(hoursMinutesMatch[2])
    if (minutes > 59) return { ok: false, error: MINUTES_AFTER_H_MESSAGE }
    return fromParts(hours, minutes, 0)
  }

  // "19m44" / "32min20" -> minutos e segundos (o número depois de "m"/"min"
  // é sempre segundo). Minutos não têm teto (carregam para hora ao formatar);
  // segundos precisam estar em 0-59.
  const minutesSecondsMatch = MINUTES_SECONDS_RE.exec(trimmed)
  if (minutesSecondsMatch) {
    const minutes = Number(minutesSecondsMatch[1])
    const secs = Number(minutesSecondsMatch[2])
    if (secs > 59) return { ok: false, error: SECONDS_AFTER_M_MESSAGE }
    return fromParts(0, minutes, secs)
  }

  if (BARE_NUMBER_RE.test(trimmed)) {
    // Número puro, sem unidade e sem ':' -> sempre interpretado como horas
    // (decimais inclusive): "1,5" e "1.5" viram 01:30:00.
    return { ok: true, seconds: decimalHoursToSeconds(trimmed) }
  }

  return { ok: false, error: INVALID_MESSAGE }
}

export function formatSecondsToHHMMSS(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  // Horas sem limite artificial: um valor de 3 dígitos (ex.: "100") nunca é
  // truncado — padStart só acrescenta zeros quando faltam, nunca remove.
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

// Variante hh:mm (sem segundos) — usada pelo campo "Tempo de produção" de
// cada plate (estrutura produtiva por plates, ProductForm.tsx) e pelo
// total geral de tempo de produção, ambos armazenados internamente em
// segundos (mesma unidade de sempre) mas exibidos só em horas:minutos, sem
// casas de segundo — soma de horas > 24 não é truncada (mesmo padStart sem
// teto de formatSecondsToHHMMSS). Segundos restantes, se houver, são
// truncados na EXIBIÇÃO apenas (nunca perdidos no valor armazenado — só
// arredondados para baixo ao formatar, igual a Math.floor de qualquer
// unidade menor que a exibida).
export function formatSecondsToHHMM(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}`
}

// hh:mm quando não sobra nenhum segundo; hh:mm:ss quando há segundos. Usada
// para pré-preencher, na EDIÇÃO de um Produto, o campo de tempo de cada
// plate e do ajuste manual de totais — o valor precisa reabrir EXATAMENTE
// como foi salvo, e formatSecondsToHHMM truncaria os segundos (um novo
// "Salvar" sem tocar no campo então os perderia). Também usada para exibir
// o total de produção quando ele tem segundos. Nunca descarta segundos: o
// caso "sem segundos" continua idêntico a formatSecondsToHHMM.
export function formatSecondsAdaptive(totalSeconds: number): string {
  return totalSeconds % 60 === 0
    ? formatSecondsToHHMM(totalSeconds)
    : formatSecondsToHHMMSS(totalSeconds)
}
