import { describe, expect, it } from 'vitest'
import {
  formatWhatsAppForDisplay,
  isValidInstagramHandle,
  isValidWhatsAppNumber,
  normalizeInstagramHandle,
  normalizeWhatsAppNumber,
} from './customerContact'

describe('normalizeInstagramHandle', () => {
  it.each([
    ['@usuario', '@usuario'],
    ['usuario', '@usuario'],
    ['https://www.instagram.com/usuario/', '@usuario'],
    ['https://instagram.com/usuario?igsh=abc', '@usuario'],
    ['instagram.com/usuario', '@usuario'],
    ['www.instagram.com/usuario', '@usuario'],
    ['  @usuario  ', '@usuario'],
    ['   usuario   ', '@usuario'],
    ['', ''],
    ['   ', ''],
  ])('normaliza %s para %s', (input, expected) => {
    expect(normalizeInstagramHandle(input)).toBe(expected)
  })
})

describe('isValidInstagramHandle', () => {
  it('aceita handles reais (letras, dígitos, ponto, underscore, 1-30 caracteres)', () => {
    expect(isValidInstagramHandle('@usuario')).toBe(true)
    expect(isValidInstagramHandle('@user.name_123')).toBe(true)
    expect(isValidInstagramHandle('@az')).toBe(true)
  })

  it('rejeita valores que não parecem um handle real', () => {
    expect(isValidInstagramHandle('@john doe')).toBe(false)
    expect(isValidInstagramHandle('')).toBe(false)
    expect(isValidInstagramHandle('usuario')).toBe(false) // sem @: não é o formato normalizado
  })
})

describe('normalizeWhatsAppNumber', () => {
  it.each([
    ['41999999999', '+5541999999999'],
    ['(41) 99999-9999', '+5541999999999'],
    ['41 99999-9999', '+5541999999999'],
    ['+55 41 99999-9999', '+5541999999999'],
    ['+5541999999999', '+5541999999999'],
    ['5541999999999', '+5541999999999'],
    ['https://wa.me/5541999999999', '+5541999999999'],
    ['wa.me/5541999999999', '+5541999999999'],
    ['  41999999999  ', '+5541999999999'],
    ['', ''],
    ['   ', ''],
  ])('normaliza %s para %s', (input, expected) => {
    expect(normalizeWhatsAppNumber(input)).toBe(expected)
  })

  it('entrada claramente incompleta não inventa número: preserva o texto digitado (trim only)', () => {
    expect(normalizeWhatsAppNumber('123')).toBe('123')
    expect(normalizeWhatsAppNumber('  4199  ')).toBe('4199')
    expect(normalizeWhatsAppNumber('az')).toBe('az')
  })
})

describe('isValidWhatsAppNumber', () => {
  it('aceita E.164 BR de celular (11 dígitos) e fixo (10 dígitos)', () => {
    expect(isValidWhatsAppNumber('+5541999999999')).toBe(true)
    expect(isValidWhatsAppNumber('+554133334444')).toBe(true)
  })

  it('rejeita texto que não é um E.164 BR válido', () => {
    expect(isValidWhatsAppNumber('az')).toBe(false)
    expect(isValidWhatsAppNumber('123')).toBe(false)
    expect(isValidWhatsAppNumber('')).toBe(false)
  })
})

describe('formatWhatsAppForDisplay', () => {
  it('formata celular (9 dígitos após o DDD) como "+55 (DDD) 9NNNN-NNNN"', () => {
    expect(formatWhatsAppForDisplay('+5541999999999')).toBe('+55 (41) 99999-9999')
  })

  it('formata fixo (8 dígitos após o DDD) como "+55 (DDD) NNNN-NNNN"', () => {
    expect(formatWhatsAppForDisplay('+554133334444')).toBe('+55 (41) 3333-4444')
  })

  it('devolve o valor original quando não é um E.164 BR reconhecível', () => {
    expect(formatWhatsAppForDisplay('az')).toBe('az')
  })
})
