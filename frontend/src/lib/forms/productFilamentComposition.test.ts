import { describe, expect, it } from 'vitest'
import {
  filamentRowsFrom,
  filamentTypeLabel,
  filterSelectableFilamentTypes,
  findFilamentTypeById,
  hasInactiveFilamentSelection,
  isFilamentRowInactive,
  validateFilamentRows,
  type FilamentCompositionRow,
} from './productFilamentComposition'
import type { FilamentTypeSummary, ProductFilament } from '@/types/domain'

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

describe('filamentRowsFrom', () => {
  it('mapeia composição existente para linhas de formulário, com chave própria por linha', () => {
    const filaments: ProductFilament[] = [
      { id: 'pf1', product_id: 'p1', filament_type_id: 'ft1', theoretical_weight_grams: 12.5, created_at: '' },
      { id: 'pf2', product_id: 'p1', filament_type_id: 'ft2', theoretical_weight_grams: 3, created_at: '' },
    ]
    const rows = filamentRowsFrom(filaments)

    expect(rows).toHaveLength(2)
    expect(rows[0].filamentTypeId).toBe('ft1')
    expect(rows[0].weight).toBe('12.5')
    expect(rows[1].filamentTypeId).toBe('ft2')
    expect(rows[1].weight).toBe('3')
    expect(new Set(rows.map((row) => row.key)).size).toBe(2)
  })
})

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
    const result = filterSelectableFilamentTypes([activeA, activeB, inactiveC], new Set(['ft1']), null)

    expect(result.map((type) => type.filament_type_id)).toEqual(['ft2'])
  })
})

describe('filamentTypeLabel', () => {
  it('mostra material · fabricante · linha · cor quando ativo', () => {
    expect(filamentTypeLabel(typeFixture())).toBe('PLA · Voolt3D · Sólida · Preto')
  })

  it('marca "(inativo)" quando is_active é false', () => {
    expect(filamentTypeLabel(typeFixture({ is_active: false }))).toBe('PLA · Voolt3D · Sólida · Preto (inativo)')
  })
})

describe('findFilamentTypeById', () => {
  const types = [typeFixture({ filament_type_id: 'ft1' }), typeFixture({ filament_type_id: 'ft2', commercial_color: 'Branco' })]

  it('encontra o tipo pelo filament_type_id', () => {
    expect(findFilamentTypeById(types, 'ft2')?.commercial_color).toBe('Branco')
  })

  it('retorna undefined para id nulo ou inexistente', () => {
    expect(findFilamentTypeById(types, null)).toBeUndefined()
    expect(findFilamentTypeById(types, 'ft9')).toBeUndefined()
  })
})

describe('isFilamentRowInactive / hasInactiveFilamentSelection', () => {
  const types = [typeFixture({ filament_type_id: 'ft1' }), typeFixture({ filament_type_id: 'ft2', is_active: false })]

  it('linha sem tipo selecionado não é inativa', () => {
    const row: FilamentCompositionRow = { key: 'r1', filamentTypeId: null, weight: '' }
    expect(isFilamentRowInactive(row, types)).toBe(false)
  })

  it('linha com tipo ativo não é inativa', () => {
    const row: FilamentCompositionRow = { key: 'r1', filamentTypeId: 'ft1', weight: '10' }
    expect(isFilamentRowInactive(row, types)).toBe(false)
  })

  it('linha com tipo inativo é inativa', () => {
    const row: FilamentCompositionRow = { key: 'r1', filamentTypeId: 'ft2', weight: '10' }
    expect(isFilamentRowInactive(row, types)).toBe(true)
  })

  it('hasInactiveFilamentSelection é true se QUALQUER linha tiver tipo inativo', () => {
    const rows: FilamentCompositionRow[] = [
      { key: 'r1', filamentTypeId: 'ft1', weight: '10' },
      { key: 'r2', filamentTypeId: 'ft2', weight: '5' },
    ]
    expect(hasInactiveFilamentSelection(rows, types)).toBe(true)
  })

  it('hasInactiveFilamentSelection é false quando nenhuma linha tem tipo inativo', () => {
    const rows: FilamentCompositionRow[] = [
      { key: 'r1', filamentTypeId: 'ft1', weight: '10' },
      { key: 'r2', filamentTypeId: null, weight: '' },
    ]
    expect(hasInactiveFilamentSelection(rows, types)).toBe(false)
  })
})

describe('validateFilamentRows', () => {
  it('exige tipo de filamento selecionado em cada linha', () => {
    const rows: FilamentCompositionRow[] = [{ key: 'r1', filamentTypeId: null, weight: '10' }]
    const result = validateFilamentRows(rows)

    expect(result.errors).toEqual({ r1: 'Selecione um tipo de filamento.' })
    expect(result.items).toEqual([])
  })

  it('exige peso teórico > 0 (impede zero)', () => {
    const rows: FilamentCompositionRow[] = [{ key: 'r1', filamentTypeId: 'ft1', weight: '0' }]
    const result = validateFilamentRows(rows)

    expect(result.errors.r1).toMatch(/maior ou igual a 0.01/)
    expect(result.items).toEqual([])
  })

  it('impede peso negativo', () => {
    const rows: FilamentCompositionRow[] = [{ key: 'r1', filamentTypeId: 'ft1', weight: '-5' }]
    const result = validateFilamentRows(rows)

    expect(result.errors.r1).toMatch(/maior ou igual a 0.01/)
  })

  it('exige peso informado (não vazio)', () => {
    const rows: FilamentCompositionRow[] = [{ key: 'r1', filamentTypeId: 'ft1', weight: '' }]
    const result = validateFilamentRows(rows)

    expect(result.errors.r1).toMatch(/informe/i)
  })

  it('aceita peso decimal com vírgula (padrão brasileiro) e com ponto', () => {
    const rows: FilamentCompositionRow[] = [
      { key: 'r1', filamentTypeId: 'ft1', weight: '12,5' },
      { key: 'r2', filamentTypeId: 'ft2', weight: '3.75' },
    ]
    const result = validateFilamentRows(rows)

    expect(result.errors).toEqual({})
    expect(result.items).toEqual([
      { id: 'ft1', theoretical_weight_grams: 12.5 },
      { id: 'ft2', theoretical_weight_grams: 3.75 },
    ])
  })

  it('permite múltiplos tipos de filamento válidos na mesma composição', () => {
    const rows: FilamentCompositionRow[] = [
      { key: 'r1', filamentTypeId: 'ft1', weight: '10' },
      { key: 'r2', filamentTypeId: 'ft2', weight: '20' },
      { key: 'r3', filamentTypeId: 'ft3', weight: '30' },
    ]
    const result = validateFilamentRows(rows)

    expect(result.errors).toEqual({})
    expect(result.items).toHaveLength(3)
  })

  it('rejeita o mesmo tipo de filamento repetido em duas linhas (defesa em profundidade, além do filtro de opções)', () => {
    const rows: FilamentCompositionRow[] = [
      { key: 'r1', filamentTypeId: 'ft1', weight: '10' },
      { key: 'r2', filamentTypeId: 'ft1', weight: '20' },
    ]
    const result = validateFilamentRows(rows)

    expect(result.errors.r2).toMatch(/já está na composição/i)
    // A primeira ocorrência é aceita normalmente.
    expect(result.items).toEqual([{ id: 'ft1', theoretical_weight_grams: 10 }])
  })
})
