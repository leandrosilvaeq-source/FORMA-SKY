// Funções puras para o campo de preço "bancário" de ProductPriceForm: o
// valor é sempre armazenado como um inteiro de centavos (nunca como reais
// em ponto flutuante acumulado), formatado só na hora de exibir/enviar.
// Dígito novo sempre entra pela direita (cents = cents*10 + dígito),
// Backspace sempre remove o dígito mais à direita (cents = trunc(cents/10))
// — o mesmo comportamento de caixa eletrônico/maquininha de cartão.

// numeric(10,2) no banco: até 8 dígitos inteiros + 2 decimais ->
// R$ 99.999.999,99 = 9999999999 centavos (10 dígitos).
export const MAX_CENTS = 9_999_999_999

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function appendDigit(cents: number, key: string): number | null {
  if (!/^[0-9]$/.test(key)) return null
  const next = cents * 10 + Number(key)
  return next > MAX_CENTS ? null : next
}

export function removeLastDigit(cents: number): number {
  return Math.trunc(cents / 10)
}

// Converte centavos (inteiro) para o número decimal esperado pelo contrato
// (new_price) via string, nunca por divisão de ponto flutuante acumulada —
// 1250 centavos -> "12.50" -> 12.5, sempre com exatamente duas casas.
export function centsToAmount(cents: number): number {
  const reais = Math.trunc(cents / 100)
  const centavos = Math.abs(cents % 100)
  return Number(`${reais}.${String(centavos).padStart(2, '0')}`)
}

export function formatCentsToBRL(cents: number): string {
  return currencyFormatter.format(centsToAmount(cents))
}

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '')
}

// Fallback de onChange para teclado virtual (mobile): o navegador já
// aplicou a edição ao valor formatado exibido (ex.: "R$ 1,250" depois de
// digitar um 0 no fim, ou "R$ 1,2" depois de apagar o último dígito) — a
// sequência COMPLETA de dígitos do resultado vira os novos centavos
// diretamente, nunca acumulada sobre o cents anterior (diferente de
// appendDigit). Sem dígito nenhum -> 0 centavos.
export function rawValueToCents(raw: string): number {
  const digits = digitsOnly(raw)
  return digits ? Number(digits) : 0
}

// Interpreta um texto colado no campo:
// - sem vírgula/ponto (ex.: "1250"): mesmo comportamento bancário da
//   digitação — a sequência de dígitos vira centavos diretamente;
// - com um separador decimal (ex.: "12,50", "R$ 12,50", "12.50"): o último
//   separador encontrado é tratado como decimal, os demais caracteres não
//   numéricos (símbolo de moeda, espaço, separador de milhar) são
//   descartados.
// Retorna null quando o resultado ultrapassaria MAX_CENTS.
export function parsePastedTextToCents(raw: string): number | null {
  const kept = raw.replace(/[^0-9.,]/g, '')

  if (!/[.,]/.test(kept)) {
    const digits = digitsOnly(kept)
    if (!digits) return 0
    const cents = Number(digits)
    return cents > MAX_CENTS ? null : cents
  }

  const lastSeparatorIndex = Math.max(kept.lastIndexOf(','), kept.lastIndexOf('.'))
  const integerPart = digitsOnly(kept.slice(0, lastSeparatorIndex)) || '0'
  const decimalPart = digitsOnly(kept.slice(lastSeparatorIndex + 1)).padEnd(2, '0').slice(0, 2)
  const cents = Number(`${integerPart}${decimalPart}`)

  if (Number.isNaN(cents)) return null
  return cents > MAX_CENTS ? null : cents
}
