import { describe, expect, it } from 'vitest'
import { resolveFilamentLines } from './productFilamentLines'
import type { FilamentTypeSummary } from '@/types/domain'

function typeFixture(overrides: Partial<FilamentTypeSummary> = {}): FilamentTypeSummary {
  return {
    filament_type_id: 'ft1',
    material: 'PLA',
    manufacturer: 'Voolt3D',
    line: 'Sólida',
    commercial_color: 'Preto',
    color_code: null,
    minimum_stock_grams: null,
    is_active: true,
    total_available_grams: 1000,
    usable_spool_count: 1,
    total_spool_count: 1,
    ...overrides,
  }
}

const filamentTypesCatalog = [
  typeFixture({ filament_type_id: 'ft1' }),
  typeFixture({ filament_type_id: 'ft2', commercial_color: 'Branco', is_active: false }),
]

describe('resolveFilamentLines', () => {
  it('composição vazia retorna lista vazia', () => {
    expect(resolveFilamentLines([], filamentTypesCatalog)).toEqual([])
  })

  it('resolve tipo ativo: nome (material · fabricante · linha · cor), situação e peso teórico', () => {
    const result = resolveFilamentLines([{ filament_type_id: 'ft1', theoretical_weight_grams: 12.5 }], filamentTypesCatalog)

    expect(result).toEqual([
      { key: 'ft1', name: 'PLA · Voolt3D · Sólida · Preto', status: 'active', weightGrams: 12.5 },
    ])
  })

  it('tipo inativo continua visível, com status "inactive" — nunca escondido', () => {
    const result = resolveFilamentLines([{ filament_type_id: 'ft2', theoretical_weight_grams: 5 }], filamentTypesCatalog)

    expect(result[0]).toEqual({
      key: 'ft2',
      name: 'PLA · Voolt3D · Sólida · Branco',
      status: 'inactive',
      weightGrams: 5,
    })
  })

  it('filament_type_id não encontrado no catálogo: status "missing", peso preservado', () => {
    const result = resolveFilamentLines(
      [{ filament_type_id: 'ft9-does-not-exist', theoretical_weight_grams: 7 }],
      filamentTypesCatalog,
    )

    expect(result[0].status).toBe('missing')
    expect(result[0].name).toBe('Tipo de filamento não encontrado')
    expect(result[0].weightGrams).toBe(7)
  })

  it('resolve múltiplos tipos preservando a ordem', () => {
    const result = resolveFilamentLines(
      [
        { filament_type_id: 'ft1', theoretical_weight_grams: 10 },
        { filament_type_id: 'ft2', theoretical_weight_grams: 20 },
      ],
      filamentTypesCatalog,
    )

    expect(result.map((line) => line.key)).toEqual(['ft1', 'ft2'])
  })
})
