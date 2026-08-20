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

  describe('vírgula como separador decimal', () => {
    it('"10,50" e "10.50" são equivalentes a 10.5', () => {
      expect(parseNumberField('10,50', 'Preço', { required: true })).toEqual({ value: 10.5, error: null })
      expect(parseNumberField('10.50', 'Preço', { required: true })).toEqual({ value: 10.5, error: null })
    })

    it('"10,5" e "10.5" são equivalentes a 10.5', () => {
      expect(parseNumberField('10,5', 'Preço', { required: true })).toEqual({ value: 10.5, error: null })
      expect(parseNumberField('10.5', 'Preço', { required: true })).toEqual({ value: 10.5, error: null })
    })

    it('"0" e "0,00" continuam válidos e iguais a 0', () => {
      expect(parseNumberField('0', 'Preço', { required: true, min: 0 })).toEqual({ value: 0, error: null })
      expect(parseNumberField('0,00', 'Preço', { required: true, min: 0 })).toEqual({ value: 0, error: null })
    })

    it('"10,5,0" (mais de uma vírgula) é inválido', () => {
      expect(parseNumberField('10,5,0', 'Preço', { required: true }).error).toBe('Preço deve ser um número válido.')
    })

    it('"1.234,56" (separador de milhar + vírgula decimal) é inválido nesta etapa', () => {
      expect(parseNumberField('1.234,56', 'Preço', { required: true }).error).toBe(
        'Preço deve ser um número válido.',
      )
    })

    it('vírgula em campo integer ("1,5") é inválida — normaliza mas falha na checagem de inteiro', () => {
      expect(parseNumberField('1,5', 'Unidades por placa', { integer: true }).error).toBe(
        'Unidades por placa deve ser um número inteiro.',
      )
    })

    it('vírgula com valor negativo continua rejeitada pelo mínimo', () => {
      expect(parseNumberField('-1,50', 'Preço', { required: true, min: 0 }).error).toBe(
        'Preço deve ser maior ou igual a 0.',
      )
    })
  })
})
