import { describe, expect, it } from 'vitest'
import { formatDateToBrDate, formatIsoDateToBrShort, formatMovementDateTime, maskBrDate, parseBrDate } from './brDate'

describe('maskBrDate', () => {
  it('insere as barras automaticamente ao digitar só números (06092026 -> 06/09/2026)', () => {
    expect(maskBrDate('06092026')).toBe('06/09/2026')
  })

  it('formata progressivamente, sem barra "solta" no fim de cada grupo', () => {
    expect(maskBrDate('')).toBe('')
    expect(maskBrDate('0')).toBe('0')
    expect(maskBrDate('06')).toBe('06')
    expect(maskBrDate('060')).toBe('06/0')
    expect(maskBrDate('0609')).toBe('06/09')
    expect(maskBrDate('06092')).toBe('06/09/2')
    expect(maskBrDate('06092026')).toBe('06/09/2026')
  })

  it('ignora qualquer caractere não numérico e aceita colagem já com barras', () => {
    expect(maskBrDate('0a6b/0 9-2.0.2.6')).toBe('06/09/2026')
    expect(maskBrDate('06/09/2026')).toBe('06/09/2026')
    expect(maskBrDate('abc')).toBe('')
  })

  it('limita a 8 algarismos (10 caracteres exibidos), descartando o excesso', () => {
    expect(maskBrDate('0609202699')).toBe('06/09/2026')
  })

  it('remover o último caractere reduz a máscara sem a barra "grudar" (simula Backspace)', () => {
    expect(maskBrDate('06/09/202')).toBe('06/09/202')
    expect(maskBrDate('06/09/')).toBe('06/09')
    expect(maskBrDate('06/09')).toBe('06/09')
    expect(maskBrDate('06/0')).toBe('06/0')
    expect(maskBrDate('06/')).toBe('06')
  })
})

describe('parseBrDate', () => {
  it('converte uma data válida dd/mm/aaaa para YYYY-MM-DD (06/09/2026 -> 2026-09-06)', () => {
    expect(parseBrDate('06/09/2026')).toEqual({ value: '2026-09-06', error: null })
  })

  it('converte pelos componentes — sem deslocamento de fuso (dia permanece 01)', () => {
    expect(parseBrDate('01/01/2026').value).toBe('2026-01-01')
    expect(parseBrDate('31/12/2026').value).toBe('2026-12-31')
  })

  it('rejeita data incompleta ou com ano de 2 dígitos', () => {
    expect(parseBrDate('06/09').value).toBeNull()
    expect(parseBrDate('06/09/').value).toBeNull()
    expect(parseBrDate('06/09/26').value).toBeNull()
    expect(parseBrDate('0609').value).toBeNull()
  })

  it('rejeita uma data inexistente (31/02/2026) e 29/02 de ano não bissexto', () => {
    expect(parseBrDate('31/02/2026').value).toBeNull()
    expect(parseBrDate('31/02/2026').error).toMatch(/inválida/i)
    expect(parseBrDate('29/02/2027').value).toBeNull()
  })

  it('aceita 29/02 de um ano bissexto (29/02/2028)', () => {
    expect(parseBrDate('29/02/2028').value).toBe('2028-02-29')
  })

  it('rejeita ano fora de 2000–2099', () => {
    expect(parseBrDate('06/09/1999').value).toBeNull()
    expect(parseBrDate('06/09/2100').value).toBeNull()
  })

  it('mensagem de erro de formato é clara e cita o exemplo dd/mm/aaaa', () => {
    expect(parseBrDate('').error).toMatch(/dd\/mm\/aaaa/i)
  })
})

describe('formatDateToBrDate', () => {
  it('formata uma Date como dd/mm/aaaa com zero à esquerda', () => {
    expect(formatDateToBrDate(new Date(2026, 8, 6))).toBe('06/09/2026')
    expect(formatDateToBrDate(new Date(2026, 0, 1))).toBe('01/01/2026')
  })

  it('a saída passa intacta por maskBrDate e parseBrDate (ida e volta)', () => {
    const masked = maskBrDate(formatDateToBrDate(new Date(2026, 8, 6)))
    expect(masked).toBe('06/09/2026')
    expect(parseBrDate(masked).value).toBe('2026-09-06')
  })
})

describe('formatIsoDateToBrShort (data pura, textual, sem fuso)', () => {
  it('exibe dd/mm/aa a partir do YYYY-MM-DD (ou do prefixo de um timestamp)', () => {
    expect(formatIsoDateToBrShort('2026-09-06')).toBe('06/09/26')
    expect(formatIsoDateToBrShort('2026-09-06T15:00:00Z')).toBe('06/09/26')
  })

  it('não desloca o dia por fuso — só separa os componentes do ISO', () => {
    expect(formatIsoDateToBrShort('2026-01-01')).toBe('01/01/26')
  })

  it('devolve a entrada malformada como está, sem lançar', () => {
    expect(formatIsoDateToBrShort('não é data')).toBe('não é data')
  })
})

describe('formatMovementDateTime (timestamp de movimento -> dd/mm/aa HH:mm em America/Sao_Paulo)', () => {
  it('06/09/2026 (compra mista, occurred_at ancorado ao meio-dia SP = 15:00 UTC) -> 06/09/26 12:00', () => {
    expect(formatMovementDateTime('2026-09-06T15:00:00Z')).toBe('06/09/26 12:00')
    expect(formatMovementDateTime('2026-09-06T15:00:00+00:00')).toBe('06/09/26 12:00')
  })

  it('nenhuma mudança de dia em America/Sao_Paulo: o meio-dia SP fica sempre no mesmo dia', () => {
    // 2026-09-06 12:00 America/Sao_Paulo, expresso em UTC
    expect(formatMovementDateTime('2026-09-06T15:00:00Z')).toMatch(/^06\/09\/26 /)
    // início do dia de negócio seguinte também não vaza para o dia anterior
    expect(formatMovementDateTime('2026-09-07T15:00:00Z')).toMatch(/^07\/09\/26 /)
  })

  it('movimentos ANTIGOS (timestamp real de um ajuste) continuam legíveis no mesmo formato', () => {
    // 2025-01-15 09:30 America/Sao_Paulo = 12:30 UTC
    expect(formatMovementDateTime('2025-01-15T12:30:00Z')).toBe('15/01/25 09:30')
  })

  it('converte explicitamente para o fuso de Sao_Paulo, não o do navegador', () => {
    // 23:30 UTC do dia 06 => 20:30 do dia 06 em Sao_Paulo (UTC-3)
    expect(formatMovementDateTime('2026-09-06T23:30:00Z')).toBe('06/09/26 20:30')
  })

  it('entrada inválida volta como está, sem lançar', () => {
    expect(formatMovementDateTime('sem data')).toBe('sem data')
  })
})
