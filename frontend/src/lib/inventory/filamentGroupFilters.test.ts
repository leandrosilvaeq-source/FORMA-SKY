import { describe, expect, it } from 'vitest'
import { groupFilamentTypes } from './filamentGroups'
import {
  EMPTY_FILAMENT_GROUP_FILTERS,
  filamentFilterOptions,
  filamentGroupFilterCount,
  filterFilamentGroups,
  isFilamentSpoolRangeInvalid,
  type FilamentGroupFilterState,
} from './filamentGroupFilters'
import type { FilamentTypeSummary } from '@/types/domain'

function typeFixture(overrides: Partial<FilamentTypeSummary> = {}): FilamentTypeSummary {
  return {
    filament_type_id: 't1',
    material: 'PLA',
    manufacturer: 'Voolt3D',
    line: 'Basic',
    commercial_color: 'Preto',
    color_code: null,
    minimum_stock_grams: null,
    is_active: true,
    total_available_grams: 0,
    usable_spool_count: 0,
    total_spool_count: 0,
    ...overrides,
  }
}

const types: FilamentTypeSummary[] = [
  typeFixture({
    filament_type_id: '1',
    material: 'PLA',
    line: 'Basic',
    commercial_color: 'Preto',
    usable_spool_count: 3,
  }),
  typeFixture({
    filament_type_id: '2',
    material: 'PLA',
    line: 'Matte',
    commercial_color: 'Branco',
    usable_spool_count: 1,
  }),
  typeFixture({
    filament_type_id: '3',
    material: 'PETG',
    line: 'Basic',
    commercial_color: 'Preto',
    usable_spool_count: 5,
  }),
  typeFixture({
    filament_type_id: '4',
    material: 'PETG',
    line: 'Matte',
    commercial_color: 'Vermelho',
    usable_spool_count: 0,
  }),
  typeFixture({
    filament_type_id: '5',
    material: 'TPU',
    line: 'Basic',
    commercial_color: 'Branco',
    usable_spool_count: 2,
  }),
]

const groups = groupFilamentTypes(types)

function state(overrides: Partial<FilamentGroupFilterState> = {}): FilamentGroupFilterState {
  return { ...EMPTY_FILAMENT_GROUP_FILTERS, ...overrides }
}

describe('filamentFilterOptions', () => {
  it('deriva as opções dos dados, sem duplicatas por maiúsculas/acentos/espaços', () => {
    const withDupes = [
      typeFixture({ filament_type_id: 'a', line: 'Basic', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 'b', line: ' basic ', commercial_color: 'PRETO' }),
      typeFixture({ filament_type_id: 'c', line: 'Matte', commercial_color: 'Vermelhão' }),
      typeFixture({ filament_type_id: 'd', line: 'Matte', commercial_color: 'vermelhao' }),
    ]
    const options = filamentFilterOptions(withDupes)
    expect(options.lines.map((o) => o.label)).toEqual(['Basic', 'Matte'])
    expect(options.colors.map((o) => o.label)).toEqual(['Preto', 'Vermelhão'])
  })

  it('materiais são os valores técnicos presentes, ordenados', () => {
    expect(filamentFilterOptions(types).materials.map((o) => o.value)).toEqual([
      'PETG',
      'PLA',
      'TPU',
    ])
  })

  it('inclui linha/cor que só existe em tipo inativo', () => {
    const withInactive = [typeFixture({ is_active: false, line: 'Silk', commercial_color: 'Ouro' })]
    const options = filamentFilterOptions(withInactive)
    expect(options.lines.map((o) => o.label)).toEqual(['Silk'])
    expect(options.colors.map((o) => o.label)).toEqual(['Ouro'])
  })
})

describe('matchesFilamentGroupFilters / filterFilamentGroups', () => {
  it('sem filtro: todos os grupos passam', () => {
    expect(filterFilamentGroups(groups, state())).toHaveLength(groups.length)
  })

  it('filtro de Material (OR dentro do grupo)', () => {
    const result = filterFilamentGroups(groups, state({ materials: new Set(['PLA', 'PETG']) }))
    expect(new Set(result.map((g) => g.material))).toEqual(new Set(['PLA', 'PETG']))
    expect(result.some((g) => g.material === 'TPU')).toBe(false)
  })

  it('filtro de Linha (OR dentro do grupo, por token normalizado)', () => {
    const result = filterFilamentGroups(groups, state({ lines: new Set(['matte']) }))
    expect(result.every((g) => g.lineLabel === 'Matte')).toBe(true)
    expect(result).toHaveLength(2)
  })

  it('filtro de Cor (OR dentro do grupo)', () => {
    const result = filterFilamentGroups(groups, state({ colors: new Set(['preto', 'branco']) }))
    expect(new Set(result.map((g) => g.colorLabel))).toEqual(new Set(['Preto', 'Branco']))
  })

  it('AND entre grupos: (Material PLA OU PETG) E (Linha Basic) E (Cor Preto)', () => {
    const result = filterFilamentGroups(
      groups,
      state({
        materials: new Set(['PLA', 'PETG']),
        lines: new Set(['basic']),
        colors: new Set(['preto']),
      }),
    )
    expect(result.map((g) => `${g.material}/${g.lineLabel}/${g.colorLabel}`)).toEqual([
      'PETG/Basic/Preto',
      'PLA/Basic/Preto',
    ])
  })

  it('faixa de rolos: somente mínimo (inclusivo)', () => {
    const result = filterFilamentGroups(groups, state({ minSpools: 2 }))
    expect(result.every((g) => g.usableSpoolCount >= 2)).toBe(true)
    expect(result.map((g) => g.usableSpoolCount).sort()).toEqual([2, 3, 5])
  })

  it('faixa de rolos: somente máximo (inclusivo)', () => {
    const result = filterFilamentGroups(groups, state({ maxSpools: 3 }))
    expect(result.every((g) => g.usableSpoolCount <= 3)).toBe(true)
  })

  it('faixa de rolos: intervalo [2, 5]', () => {
    const result = filterFilamentGroups(groups, state({ minSpools: 2, maxSpools: 5 }))
    expect(result.map((g) => g.usableSpoolCount).sort()).toEqual([2, 3, 5])
  })

  it('faixa de rolos: 0 a 0 = grupos sem rolo disponível', () => {
    const result = filterFilamentGroups(groups, state({ minSpools: 0, maxSpools: 0 }))
    expect(result.map((g) => g.usableSpoolCount)).toEqual([0])
  })

  it('mínimo > máximo é inválido: nunca aplica a faixa (todos passam nela)', () => {
    const filters = state({ minSpools: 5, maxSpools: 2 })
    expect(isFilamentSpoolRangeInvalid(filters)).toBe(true)
    expect(filterFilamentGroups(groups, filters)).toHaveLength(groups.length)
  })

  it('faixa combina com Material/Linha/Cor', () => {
    const result = filterFilamentGroups(
      groups,
      state({ materials: new Set(['PETG']), minSpools: 4 }),
    )
    expect(result.map((g) => `${g.material}/${g.colorLabel}`)).toEqual(['PETG/Preto'])
  })
})

describe('filamentGroupFilterCount', () => {
  it('conta cada seleção e cada lado da faixa', () => {
    expect(filamentGroupFilterCount(EMPTY_FILAMENT_GROUP_FILTERS)).toBe(0)
    expect(
      filamentGroupFilterCount(
        state({ materials: new Set(['PLA']), colors: new Set(['preto', 'branco']), minSpools: 1 }),
      ),
    ).toBe(4)
    expect(filamentGroupFilterCount(state({ minSpools: 0, maxSpools: 0 }))).toBe(2)
  })
})
