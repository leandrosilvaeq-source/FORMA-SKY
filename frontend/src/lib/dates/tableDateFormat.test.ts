import { describe, expect, it } from 'vitest'
import { formatTableDate, tableDateSortValue } from './tableDateFormat'

describe('formatTableDate', () => {
  it('valor nulo/ausente vira "—", sem full', () => {
    expect(formatTableDate(null)).toEqual({ short: '—', full: null })
    expect(formatTableDate(undefined)).toEqual({ short: '—', full: null })
    expect(formatTableDate('')).toEqual({ short: '—', full: null })
  })

  it('início do ano (01/01)', () => {
    expect(formatTableDate('2026-01-01')).toEqual({ short: '01/01/26', full: '01/01/2026' })
  })

  it('final do ano (31/12)', () => {
    expect(formatTableDate('2026-12-31')).toEqual({ short: '31/12/26', full: '31/12/2026' })
  })

  it('dia e mês com zero à esquerda preservados', () => {
    expect(formatTableDate('2026-09-04')).toEqual({ short: '04/09/26', full: '04/09/2026' })
  })

  it('data DATE pura (YYYY-MM-DD)', () => {
    expect(formatTableDate('2026-08-31')).toEqual({ short: '31/08/26', full: '31/08/2026' })
  })

  it('timestamp (YYYY-MM-DDTHH:mm:ss.sssZ) usa só a parte da data, sem tocar no horário', () => {
    expect(formatTableDate('2026-08-31T23:59:59.999Z')).toEqual({ short: '31/08/26', full: '31/08/2026' })
  })

  it('ausência de deslocamento de dia: qualquer horário do dia produz a mesma data — nunca instancia Date', () => {
    expect(formatTableDate('2026-08-31T00:00:00.000Z').short).toBe('31/08/26')
    expect(formatTableDate('2026-08-31T23:00:00.000Z').short).toBe('31/08/26')
  })

  it('texto que não bate com o padrão de data é devolvido como está, nunca reescrito às cegas', () => {
    expect(formatTableDate('não é uma data')).toEqual({ short: 'não é uma data', full: null })
  })

  it('ano com 2 dígitos vem sempre dos 2 últimos dígitos do ano completo', () => {
    expect(formatTableDate('1999-05-20').short).toBe('20/05/99')
    expect(formatTableDate('2000-05-20').short).toBe('20/05/00')
  })
})

describe('tableDateSortValue', () => {
  it('valor nulo/ausente vira null', () => {
    expect(tableDateSortValue(null)).toBeNull()
    expect(tableDateSortValue(undefined)).toBeNull()
  })

  it('usa o valor numérico real (AAAAMMDD), nunca o texto formatado', () => {
    expect(tableDateSortValue('2026-08-31')).toBe(20260831)
  })

  it('ordena corretamente mesmo com anos de 2 dígitos exibidos iguais (ex.: 1999 vs 2099)', () => {
    const y1999 = tableDateSortValue('1999-01-01') as number
    const y2099 = tableDateSortValue('2099-01-01') as number
    expect(y1999).toBeLessThan(y2099)
  })

  it('funciona igualmente para timestamp', () => {
    expect(tableDateSortValue('2026-08-31T10:00:00.000Z')).toBe(20260831)
  })

  it('texto que não bate com o padrão vira null', () => {
    expect(tableDateSortValue('não é uma data')).toBeNull()
  })
})
