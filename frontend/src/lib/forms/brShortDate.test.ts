import { describe, expect, it } from 'vitest'
import { formatDateToBrShort, maskBrShortDate, parseBrShortDate } from './brShortDate'

describe('maskBrShortDate', () => {
  it('insere as barras automaticamente ao digitar só números (050926 -> 05/09/26)', () => {
    expect(maskBrShortDate('050926')).toBe('05/09/26')
  })

  it('formata progressivamente, sem barra "solta" no fim de cada grupo', () => {
    expect(maskBrShortDate('')).toBe('')
    expect(maskBrShortDate('0')).toBe('0')
    expect(maskBrShortDate('05')).toBe('05')
    expect(maskBrShortDate('050')).toBe('05/0')
    expect(maskBrShortDate('0509')).toBe('05/09')
    expect(maskBrShortDate('05092')).toBe('05/09/2')
    expect(maskBrShortDate('050926')).toBe('05/09/26')
  })

  it('ignora qualquer caractere não numérico', () => {
    expect(maskBrShortDate('0a5b/0 9-2.6')).toBe('05/09/26')
    expect(maskBrShortDate('abc')).toBe('')
  })

  it('aceita colagem já com as barras (05/09/26 -> 05/09/26)', () => {
    expect(maskBrShortDate('05/09/26')).toBe('05/09/26')
  })

  it('aceita colagem sem as barras (050926 -> 05/09/26)', () => {
    expect(maskBrShortDate('050926')).toBe('05/09/26')
  })

  it('limita a 6 algarismos (8 caracteres exibidos), descartando o excesso', () => {
    expect(maskBrShortDate('05092612345')).toBe('05/09/26')
    expect(maskBrShortDate('05/09/2026')).toBe('05/09/20')
  })

  it('remover o último caractere reduz a máscara sem a barra "grudar" (simula Backspace)', () => {
    // O componente reaplica a máscara sobre o valor já com um caractere a
    // menos — como o campo faria a cada Backspace no fim do texto.
    expect(maskBrShortDate('05/09/2')).toBe('05/09/2')
    expect(maskBrShortDate('05/09/')).toBe('05/09')
    expect(maskBrShortDate('05/09')).toBe('05/09')
    expect(maskBrShortDate('05/0')).toBe('05/0')
    expect(maskBrShortDate('05/')).toBe('05')
    expect(maskBrShortDate('05')).toBe('05')
  })
})

describe('parseBrShortDate', () => {
  it('converte uma data válida dd/mm/aa para YYYY-MM-DD (05/09/26 -> 2026-09-05)', () => {
    expect(parseBrShortDate('05/09/26')).toEqual({ value: '2026-09-05', error: null })
  })

  it('interpreta o ano de 2 dígitos no intervalo 2000–2099 (00 -> 2000, 99 -> 2099)', () => {
    expect(parseBrShortDate('01/01/00').value).toBe('2000-01-01')
    expect(parseBrShortDate('31/12/99').value).toBe('2099-12-31')
  })

  it('converte pelos componentes da data — sem deslocamento de fuso horário (dia permanece 01)', () => {
    // Um parse de string "2026-01-01" em UTC poderia voltar 2025-12-31 em
    // fusos a oeste; aqui o dia informado tem que sair intacto.
    expect(parseBrShortDate('01/01/26').value).toBe('2026-01-01')
  })

  it('rejeita data incompleta (menos de 6 dígitos / sem as duas barras)', () => {
    expect(parseBrShortDate('05/09').value).toBeNull()
    expect(parseBrShortDate('05/09/').value).toBeNull()
    expect(parseBrShortDate('0509').value).toBeNull()
    expect(parseBrShortDate('05/09/2').value).toBeNull()
  })

  it('rejeita uma data inexistente como 31/02/26', () => {
    const result = parseBrShortDate('31/02/26')
    expect(result.value).toBeNull()
    expect(result.error).toMatch(/inválida/i)
  })

  it('rejeita 29/02 de um ano não bissexto (29/02/27)', () => {
    expect(parseBrShortDate('29/02/27').value).toBeNull()
  })

  it('aceita 29/02 de um ano bissexto (29/02/28)', () => {
    expect(parseBrShortDate('29/02/28').value).toBe('2028-02-29')
  })

  it('mensagem de erro de formato é clara e cita o exemplo', () => {
    expect(parseBrShortDate('').error).toMatch(/dd\/mm\/aa/i)
  })
})

describe('formatDateToBrShort', () => {
  it('formata uma data como dd/mm/aa com zero à esquerda', () => {
    expect(formatDateToBrShort(new Date(2026, 8, 5))).toBe('05/09/26')
    expect(formatDateToBrShort(new Date(2026, 11, 31))).toBe('31/12/26')
  })

  it('a saída de formatDateToBrShort passa intacta por maskBrShortDate e parseBrShortDate', () => {
    const masked = maskBrShortDate(formatDateToBrShort(new Date(2026, 8, 5)))
    expect(masked).toBe('05/09/26')
    expect(parseBrShortDate(masked).value).toBe('2026-09-05')
  })
})
