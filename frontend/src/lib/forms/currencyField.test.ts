import { describe, expect, it } from 'vitest'
import {
  MAX_CENTS,
  appendDigit,
  centsToAmount,
  formatCentsToBRL,
  parsePastedTextToCents,
  rawValueToCents,
  removeLastDigit,
} from './currencyField'

describe('appendDigit', () => {
  it('acumula dígitos da direita para a esquerda: 0 -> 1 -> 12 -> 125 -> 1250', () => {
    let cents = 0
    cents = appendDigit(cents, '1') as number
    expect(cents).toBe(1)
    cents = appendDigit(cents, '2') as number
    expect(cents).toBe(12)
    cents = appendDigit(cents, '5') as number
    expect(cents).toBe(125)
    cents = appendDigit(cents, '0') as number
    expect(cents).toBe(1250)
  })

  it('rejeita tecla não numérica', () => {
    expect(appendDigit(10, 'a')).toBeNull()
    expect(appendDigit(10, ',')).toBeNull()
  })

  it('retorna null ao ultrapassar MAX_CENTS', () => {
    expect(appendDigit(MAX_CENTS, '9')).toBeNull()
    expect(appendDigit(MAX_CENTS, '0')).toBeNull()
  })

  it('no limite exato ainda é aceito', () => {
    expect(appendDigit(999999999, '9')).toBe(MAX_CENTS)
  })
})

describe('removeLastDigit', () => {
  it('remove o dígito mais à direita: 1250 -> 125 -> 12 -> 1 -> 0', () => {
    expect(removeLastDigit(1250)).toBe(125)
    expect(removeLastDigit(125)).toBe(12)
    expect(removeLastDigit(12)).toBe(1)
    expect(removeLastDigit(1)).toBe(0)
  })

  it('backspace em 0 continua 0', () => {
    expect(removeLastDigit(0)).toBe(0)
  })
})

describe('centsToAmount', () => {
  it('converte centavos para reais com duas casas, sem acumular ponto flutuante', () => {
    expect(centsToAmount(1250)).toBe(12.5)
    expect(centsToAmount(0)).toBe(0)
    expect(centsToAmount(1)).toBe(0.01)
    expect(centsToAmount(125050)).toBe(1250.5)
  })

  it('preserva duas casas mesmo em valores redondos', () => {
    expect(centsToAmount(150000)).toBe(1500)
  })
})

describe('formatCentsToBRL', () => {
  it('formata em Real brasileiro conforme os exemplos do requisito', () => {
    expect(formatCentsToBRL(0)).toMatch(/R\$\s*0,00/)
    expect(formatCentsToBRL(1)).toMatch(/R\$\s*0,01/)
    expect(formatCentsToBRL(12)).toMatch(/R\$\s*0,12/)
    expect(formatCentsToBRL(125)).toMatch(/R\$\s*1,25/)
    expect(formatCentsToBRL(1250)).toMatch(/R\$\s*12,50/)
    expect(formatCentsToBRL(125050)).toMatch(/R\$\s*1\.250,50/)
  })
})

describe('parsePastedTextToCents', () => {
  it('"12,50" colado vira 1250 centavos', () => {
    expect(parsePastedTextToCents('12,50')).toBe(1250)
  })

  it('"R$ 12,50" colado vira 1250 centavos', () => {
    expect(parsePastedTextToCents('R$ 12,50')).toBe(1250)
  })

  it('"1250" colado (sem separador) segue o comportamento bancário: vira 1250 centavos', () => {
    expect(parsePastedTextToCents('1250')).toBe(1250)
  })

  it('"12.50" (ponto decimal) colado vira 1250 centavos', () => {
    expect(parsePastedTextToCents('12.50')).toBe(1250)
  })

  it('texto sem nenhum dígito vira 0', () => {
    expect(parsePastedTextToCents('R$')).toBe(0)
  })

  it('retorna null quando o valor colado ultrapassa MAX_CENTS', () => {
    expect(parsePastedTextToCents('999.999.999,99')).toBeNull()
  })
})

describe('rawValueToCents (fallback de onChange para teclado virtual)', () => {
  it('"R$ 0,001" -> dígitos "0001" -> 1 centavo', () => {
    expect(rawValueToCents('R$ 0,001')).toBe(1)
  })

  it('"R$ 0,012" -> dígitos "0012" -> 12 centavos', () => {
    expect(rawValueToCents('R$ 0,012')).toBe(12)
  })

  it('"R$ 1,250" -> dígitos "1250" -> 1250 centavos', () => {
    expect(rawValueToCents('R$ 1,250')).toBe(1250)
  })

  it('"R$ 1,2" (depois de apagar o último dígito de R$ 1,25) -> 12 centavos', () => {
    expect(rawValueToCents('R$ 1,2')).toBe(12)
  })

  it('sem nenhum dígito -> 0 centavos', () => {
    expect(rawValueToCents('R$ ')).toBe(0)
    expect(rawValueToCents('')).toBe(0)
  })
})
