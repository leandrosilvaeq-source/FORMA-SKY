import { describe, expect, it } from 'vitest'
import {
  autoTotalTimeSeconds,
  autoTotalWeightGrams,
  emptyPlateRow,
  filamentTypeLabel,
  filterSelectableFilamentTypes,
  findFilamentTypeById,
  plateRowsFrom,
  plateRowsFromLegacyWeight,
  validatePlateRows,
  type PlateRow,
} from './productPlates'
import type { FilamentTypeSummary, ProductPlate } from '@/types/domain'

function plate(overrides: Partial<ProductPlate> = {}): ProductPlate {
  return {
    id: 'pp1',
    product_id: 'p1',
    plate_number: 1,
    production_time_seconds: 3600,
    weight_grams: 40,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

// Testes dos seletores de tipo de filamento trazidos de
// productFilamentComposition.ts (removido na limpeza de código órfão de
// 2026-08-29 — companheiro do diálogo antigo FilamentCompositionForm.tsx,
// sem nenhum consumidor de escrita restante) para productPlates.ts. A
// partir da migration 20260829180000_add_categories_plate_weight_and_order_colors.sql
// (ainda não aplicada) estes 3 seletores passam a ser consumidos por
// OrderForm.tsx (seção "Cores e filamentos"), não mais por ProductForm.tsx
// (que perdeu toda composição de filamento) — mesmos casos de teste,
// comportamento inalterado.

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

describe('filterSelectableFilamentTypes (tipos inativos)', () => {
  const activeA = typeFixture({ filament_type_id: 'ft1' })
  const activeB = typeFixture({ filament_type_id: 'ft2' })
  const inactiveC = typeFixture({ filament_type_id: 'ft3', is_active: false })

  it('exclui tipos inativos das opções para uma linha nova (sem seleção)', () => {
    const result = filterSelectableFilamentTypes([activeA, activeB, inactiveC], new Set(), null)

    expect(result.map((type) => type.filament_type_id)).toEqual(['ft1', 'ft2'])
  })

  it('mantém o tipo inativo se ele for o selecionado atual da própria linha', () => {
    const result = filterSelectableFilamentTypes([activeA, activeB, inactiveC], new Set(), 'ft3')

    expect(result.map((type) => type.filament_type_id)).toEqual(['ft1', 'ft2', 'ft3'])
  })

  it('exclui tipos já escolhidos em outras linhas, mesmo ativos (impede duplicidade)', () => {
    const result = filterSelectableFilamentTypes(
      [activeA, activeB, inactiveC],
      new Set(['ft1']),
      null,
    )

    expect(result.map((type) => type.filament_type_id)).toEqual(['ft2'])
  })
})

describe('filamentTypeLabel', () => {
  it('mostra material · fabricante · linha · cor quando ativo', () => {
    expect(filamentTypeLabel(typeFixture())).toBe('PLA · Voolt3D · Sólida · Preto')
  })

  it('marca "(inativo)" quando is_active é false', () => {
    expect(filamentTypeLabel(typeFixture({ is_active: false }))).toBe(
      'PLA · Voolt3D · Sólida · Preto (inativo)',
    )
  })
})

describe('findFilamentTypeById', () => {
  const types = [
    typeFixture({ filament_type_id: 'ft1' }),
    typeFixture({ filament_type_id: 'ft2', commercial_color: 'Branco' }),
  ]

  it('encontra o tipo pelo filament_type_id', () => {
    expect(findFilamentTypeById(types, 'ft2')?.commercial_color).toBe('Branco')
  })

  it('retorna undefined para id nulo ou inexistente', () => {
    expect(findFilamentTypeById(types, null)).toBeUndefined()
    expect(findFilamentTypeById(types, 'ft9')).toBeUndefined()
  })
})

// Peso direto do plate (2026-08-29, migration 20260829180000) — substitui a
// antiga composição por linhas de filamento. emptyPlateRow/validatePlateRows/
// autoTotal* cobrem o novo formato {key, timeInput, weightInput}.

describe('emptyPlateRow', () => {
  it('nasce sem tempo nem peso preenchidos (nenhuma composição sugerida por padrão)', () => {
    const row = emptyPlateRow()
    expect(row.timeInput).toBe('')
    expect(row.weightInput).toBe('')
  })
})

describe('autoTotalWeightGrams / autoTotalTimeSeconds', () => {
  it('soma peso e tempo de todos os plates informados', () => {
    const plates: PlateRow[] = [
      { key: 'p1', timeInput: '01:00', weightInput: '100' },
      { key: 'p2', timeInput: '00:30', weightInput: '50.5' },
    ]
    expect(autoTotalWeightGrams(plates)).toBeCloseTo(150.5)
    expect(autoTotalTimeSeconds(plates)).toBe(3600 + 1800)
  })

  it('trata peso/tempo inválidos ou vazios como 0 (pré-visualização best-effort)', () => {
    const plates: PlateRow[] = [{ key: 'p1', timeInput: '', weightInput: '' }]
    expect(autoTotalWeightGrams(plates)).toBe(0)
    expect(autoTotalTimeSeconds(plates)).toBe(0)
  })
})

describe('validatePlateRows', () => {
  it('exige peso > 0 para cada plate — plate sem peso gera erro em weightErrors', () => {
    const plates: PlateRow[] = [{ key: 'p1', timeInput: '01:00', weightInput: '' }]
    const result = validatePlateRows(plates)
    expect(result.weightErrors.p1).toBeTruthy()
    expect(result.items[0].weight_grams).toBe(0)
  })

  it('tempo em branco é aceito como 0 (nunca obrigatório)', () => {
    const plates: PlateRow[] = [{ key: 'p1', timeInput: '', weightInput: '100' }]
    const result = validatePlateRows(plates)
    expect(result.timeErrors.p1).toBeUndefined()
    expect(result.items[0]).toEqual({ production_time_seconds: 0, weight_grams: 100 })
  })

  it('plate totalmente válido não gera nenhum erro', () => {
    const plates: PlateRow[] = [{ key: 'p1', timeInput: '02:15', weightInput: '35.2' }]
    const result = validatePlateRows(plates)
    expect(result.timeErrors).toEqual({})
    expect(result.weightErrors).toEqual({})
    expect(result.items).toEqual([{ production_time_seconds: 8100, weight_grams: 35.2 }])
  })
})

describe('plateRowsFrom — pré-preenchimento da edição preserva os segundos salvos', () => {
  it('plate com segundos exatos abre como hh:mm:ss (nunca truncado para hh:mm)', () => {
    const rows = plateRowsFrom([plate({ production_time_seconds: 1845, weight_grams: 40 })])
    expect(rows[0].timeInput).toBe('00:30:45')
    expect(rows[0].weightInput).toBe('40')
  })

  it('plate em minutos redondos continua abrindo como hh:mm (sem :00 supérfluo)', () => {
    const rows = plateRowsFrom([plate({ production_time_seconds: 3600 })])
    expect(rows[0].timeInput).toBe('01:00')
  })

  it('round-trip sem tocar no campo: plateRowsFrom -> validatePlateRows devolve os mesmos segundos', () => {
    const rows = plateRowsFrom([
      plate({ id: 'a', plate_number: 1, production_time_seconds: 1845, weight_grams: 40 }),
      plate({ id: 'b', plate_number: 2, production_time_seconds: 7261, weight_grams: 12.5 }),
    ])
    const result = validatePlateRows(rows)
    expect(result.timeErrors).toEqual({})
    expect(result.items).toEqual([
      { production_time_seconds: 1845, weight_grams: 40 },
      { production_time_seconds: 7261, weight_grams: 12.5 },
    ])
  })

  it('ordena por plate_number antes de mapear', () => {
    const rows = plateRowsFrom([
      plate({ id: 'b', plate_number: 2, production_time_seconds: 120, weight_grams: 5 }),
      plate({ id: 'a', plate_number: 1, production_time_seconds: 60, weight_grams: 10 }),
    ])
    expect(rows.map((r) => r.weightInput)).toEqual(['10', '5'])
  })
})

describe('plateRowsFromLegacyWeight', () => {
  it('devolve array vazio quando não há peso nem tempo legado', () => {
    expect(plateRowsFromLegacyWeight(null, null)).toEqual([])
  })

  it('sintetiza um único Plate 1 a partir de peso/tempo legados', () => {
    const rows = plateRowsFromLegacyWeight(120, 3600)
    expect(rows).toHaveLength(1)
    expect(rows[0].weightInput).toBe('120')
    expect(rows[0].timeInput).toBe('01:00')
  })

  it('Produto legado cujo tempo tem segundos: preserva os segundos ao abrir a edição', () => {
    const rows = plateRowsFromLegacyWeight(120, 1845)
    expect(rows[0].timeInput).toBe('00:30:45')
  })
})
