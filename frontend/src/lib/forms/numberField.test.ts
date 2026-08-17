import { describe, expect, it } from 'vitest'
import { parseNumberField } from './numberField'

describe('parseNumberField', () => {
  it('returns undefined with no error for an empty optional field', () => {
    expect(parseNumberField('', 'Peso')).toEqual({ value: undefined, error: null })
    expect(parseNumberField('   ', 'Peso')).toEqual({ value: undefined, error: null })
  })

  it('requires a value when required is true', () => {
    expect(parseNumberField('', 'Preço', { required: true })).toEqual({
      value: undefined,
      error: 'Informe Preço.',
    })
  })

  it('rejects non-numeric input', () => {
    expect(parseNumberField('abc', 'Preço', { required: true }).error).toBe('Preço deve ser um número válido.')
  })

  it('rejects NaN-producing input explicitly', () => {
    const result = parseNumberField('1,5.3', 'Preço', { required: true })
    expect(result.value).toBeUndefined()
    expect(result.error).toBe('Preço deve ser um número válido.')
  })

  it('enforces a minimum', () => {
    expect(parseNumberField('-1', 'Preço', { required: true, min: 0 }).error).toBe(
      'Preço deve ser maior ou igual a 0.',
    )
    expect(parseNumberField('0', 'Preço', { required: true, min: 0 })).toEqual({ value: 0, error: null })
  })

  it('enforces integer values', () => {
    expect(parseNumberField('1.5', 'Unidades por placa', { integer: true }).error).toBe(
      'Unidades por placa deve ser um número inteiro.',
    )
    expect(parseNumberField('2', 'Unidades por placa', { integer: true })).toEqual({ value: 2, error: null })
  })

  it('parses a valid optional value', () => {
    expect(parseNumberField('12.34', 'Peso', { min: 0 })).toEqual({ value: 12.34, error: null })
  })
})
