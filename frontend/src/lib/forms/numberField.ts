// Parsing/validação compartilhada para campos numéricos de formulário
// controlados como string (permite input vazio sem virar 0 acidentalmente).
// Usado por ProductForm e ProductPriceForm (Subetapa 4.3).

export interface ParseNumberFieldOptions {
  required?: boolean
  min?: number
  integer?: boolean
}

export interface ParseNumberFieldResult {
  value: number | undefined
  error: string | null
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

  const parsed = Number(trimmed)
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
