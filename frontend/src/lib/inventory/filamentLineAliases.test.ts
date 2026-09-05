import { describe, expect, it } from 'vitest'
import { FILAMENT_LINE_FILTER_OPTIONS, resolveFilamentLineDisplayLabel } from './filamentLineAliases'

describe('resolveFilamentLineDisplayLabel', () => {
  it('consolida Sólida, Solida, Solido e Sólido em "Sólido"', () => {
    for (const raw of ['Sólida', 'Solida', 'Solido', 'Sólido', 'SÓLIDA', '  sólida  ']) {
      expect(resolveFilamentLineDisplayLabel(raw)).toBe('Sólido')
    }
  })

  it('consolida Mate e Matte em "Mate"', () => {
    for (const raw of ['Mate', 'Matte', 'MATTE', ' mate ']) {
      expect(resolveFilamentLineDisplayLabel(raw)).toBe('Mate')
    }
  })

  it('consolida Translucido e Translúcido em "Translúcido"', () => {
    for (const raw of ['Translucido', 'Translúcido', 'TRANSLÚCIDO']) {
      expect(resolveFilamentLineDisplayLabel(raw)).toBe('Translúcido')
    }
  })

  it('consolida Duo Color, Duocolor e DuoColor em "Duocolor"', () => {
    for (const raw of ['Duo Color', 'Duocolor', 'DuoColor', 'duo  color']) {
      expect(resolveFilamentLineDisplayLabel(raw)).toBe('Duocolor')
    }
  })

  it('consolida Tri Color, Tricolor e TriColor em "Tricolor"', () => {
    for (const raw of ['Tri Color', 'Tricolor', 'TriColor']) {
      expect(resolveFilamentLineDisplayLabel(raw)).toBe('Tricolor')
    }
  })

  it('Silk e Velvet passam sem alteração (já são a própria grafia oficial)', () => {
    expect(resolveFilamentLineDisplayLabel('Silk')).toBe('Silk')
    expect(resolveFilamentLineDisplayLabel('Velvet')).toBe('Velvet')
  })

  it('um valor histórico fora das 7 opções oficiais passa pela função sem alteração (nunca escondido/substituído)', () => {
    expect(resolveFilamentLineDisplayLabel('Basic')).toBe('Basic')
    expect(resolveFilamentLineDisplayLabel('Linha Antiga XYZ')).toBe('Linha Antiga XYZ')
  })

  it('FILAMENT_LINE_FILTER_OPTIONS tem exatamente as 7 opções, na ordem pedida', () => {
    expect(FILAMENT_LINE_FILTER_OPTIONS).toEqual([
      'Sólido',
      'Silk',
      'Mate',
      'Velvet',
      'Translúcido',
      'Duocolor',
      'Tricolor',
    ])
  })
})
