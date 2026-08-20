// Parsing/validação compartilhada para campos numéricos de formulário
// controlados como string (permite input vazio sem virar 0 acidentalmente).
// Usado por ProductForm, ProductPriceForm, ProductCompositionForm e
// OrderForm — aceita vírgula ou ponto como separador decimal (ver
// normalizeDecimalSeparator abaixo), então qualquer alteração aqui afeta
// todos esses formulários.

export interface ParseNumberFieldOptions {
  required?: boolean
  min?: number
  integer?: boolean
}

export interface ParseNumberFieldResult {
  value: number | undefined
  error: string | null
}

// Aceita vírgula OU ponto como separador decimal (nunca os dois juntos, e
// nunca mais de um do mesmo tipo) — "10,50"/"10.50"/"10,5"/"10.5" são
// equivalentes. Não implementa separador de milhar nesta etapa: qualquer
// combinação de vírgula E ponto no mesmo valor (ex.: "1.234,56", "1,5.3")
// é tratada como formato ambíguo e rejeitada, assim como mais de uma
// vírgula ("10,5,0") ou mais de um ponto ("10.5.0"). Retorna null para
// "não dá pra normalizar com segurança" — o chamador converte isso no
// mesmo erro de "número inválido" já usado para texto não numérico.
function normalizeDecimalSeparator(trimmed: string): string | null {
  const commaCount = (trimmed.match(/,/g) ?? []).length
  const dotCount = (trimmed.match(/\./g) ?? []).length

  if (commaCount > 0 && dotCount > 0) return null
  if (commaCount > 1 || dotCount > 1) return null
  if (commaCount === 1) return trimmed.replace(',', '.')
  return trimmed
}

export function parseNumberField(
  raw: string,
  label: string,
  options: ParseNumberFieldOptions = {},
): ParseNumberFieldResult {
  const trimmed = raw.trim()
  if (!trimmed) {
    if (options.required) return { value: undefined, error: `Informe ${label}.` }
    return { value: undefined, error: null }
  }

  const normalized = normalizeDecimalSeparator(trimmed)
  if (normalized === null) {
    return { value: undefined, error: `${label} deve ser um número válido.` }
  }

  const parsed = Number(normalized)
  if (Number.isNaN(parsed)) {
    return { value: undefined, error: `${label} deve ser um número válido.` }
  }
  if (options.integer && !Number.isInteger(parsed)) {
    return { value: undefined, error: `${label} deve ser um número inteiro.` }
  }
  if (options.min !== undefined && parsed < options.min) {
    return { value: undefined, error: `${label} deve ser maior ou igual a ${options.min}.` }
  }
  return { value: parsed, error: null }
}
