import { describe, expect, it } from 'vitest'
import {
  groupFilamentTypes,
  matchesFilamentGroupSearch,
  normalizeFilamentToken,
} from './filamentGroups'
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

describe('normalizeFilamentToken', () => {
  it('minúsculas, sem acento, espaços internos colapsados, borda aparada', () => {
    expect(normalizeFilamentToken('  Basic   Matte ')).toBe('basic matte')
    expect(normalizeFilamentToken('Vermelhão')).toBe('vermelhao')
  })
})

describe('groupFilamentTypes — consolidação por Material + Linha + Cor', () => {
  it('dois fabricantes com mesmo Material + Linha + Cor viram UMA linha', () => {
    const groups = groupFilamentTypes([
      typeFixture({
        filament_type_id: 'a',
        manufacturer: 'Voolt3D',
        total_available_grams: 500,
        usable_spool_count: 1,
      }),
      typeFixture({
        filament_type_id: 'b',
        manufacturer: '3D Fila',
        total_available_grams: 300,
        usable_spool_count: 2,
      }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].filamentTypeIds.sort()).toEqual(['a', 'b'])
    expect(groups[0].manufacturers).toEqual(['3D Fila', 'Voolt3D'])
  })

  it('soma o peso disponível e o número de rolos disponíveis de todos os tipos do grupo', () => {
    const [group] = groupFilamentTypes([
      typeFixture({ filament_type_id: 'a', total_available_grams: 500, usable_spool_count: 1 }),
      typeFixture({ filament_type_id: 'b', total_available_grams: 300.5, usable_spool_count: 2 }),
    ])
    expect(group.availableGrams).toBe(800.5)
    expect(group.usableSpoolCount).toBe(3)
  })

  it('fabricante diferente (mesmo Material/Linha/Cor) NÃO cria linha adicional', () => {
    const groups = groupFilamentTypes([
      typeFixture({ filament_type_id: 'a', manufacturer: 'A' }),
      typeFixture({ filament_type_id: 'b', manufacturer: 'B' }),
      typeFixture({ filament_type_id: 'c', manufacturer: 'C' }),
    ])
    expect(groups).toHaveLength(1)
  })

  it('Material, Linha ou Cor diferentes criam grupos distintos', () => {
    const groups = groupFilamentTypes([
      typeFixture({
        filament_type_id: 'a',
        material: 'PLA',
        line: 'Basic',
        commercial_color: 'Preto',
      }),
      typeFixture({
        filament_type_id: 'b',
        material: 'PETG',
        line: 'Basic',
        commercial_color: 'Preto',
      }),
      typeFixture({
        filament_type_id: 'c',
        material: 'PLA',
        line: 'Matte',
        commercial_color: 'Preto',
      }),
      typeFixture({
        filament_type_id: 'd',
        material: 'PLA',
        line: 'Basic',
        commercial_color: 'Branco',
      }),
    ])
    expect(groups).toHaveLength(4)
  })

  it('normaliza maiúsculas/acentos/espaços — grafias equivalentes caem no mesmo grupo', () => {
    const groups = groupFilamentTypes([
      typeFixture({ filament_type_id: 'a', line: 'Basic', commercial_color: 'Vermelhão' }),
      typeFixture({ filament_type_id: 'b', line: ' basic ', commercial_color: 'vermelhao' }),
      typeFixture({ filament_type_id: 'c', line: 'BASIC', commercial_color: 'VERMELHÃO' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].filamentTypeIds).toHaveLength(3)
  })

  it('preserva um rótulo canônico legível (grafia mais frequente; empate = ordem pt-BR)', () => {
    const [group] = groupFilamentTypes([
      typeFixture({ filament_type_id: 'a', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 'b', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 'c', commercial_color: 'PRETO' }),
    ])
    expect(group.colorLabel).toBe('Preto')
  })

  it('estoque mínimo consolidado = maior limite entre os tipos ATIVOS (nunca soma)', () => {
    const [group] = groupFilamentTypes([
      typeFixture({ filament_type_id: 'a', is_active: true, minimum_stock_grams: 200 }),
      typeFixture({ filament_type_id: 'b', is_active: true, minimum_stock_grams: 500 }),
      typeFixture({ filament_type_id: 'c', is_active: false, minimum_stock_grams: 9000 }),
    ])
    expect(group.minimumStockGrams).toBe(500)
  })

  it('estoque mínimo consolidado = null quando nenhum tipo ativo tem limite', () => {
    const [group] = groupFilamentTypes([
      typeFixture({ filament_type_id: 'a', is_active: true, minimum_stock_grams: null }),
      typeFixture({ filament_type_id: 'b', is_active: false, minimum_stock_grams: 300 }),
    ])
    expect(group.minimumStockGrams).toBeNull()
  })

  it('rolos arquivados/DESCARTADO/ESGOTADO/zerados já não entram em usable_spool_count (via view) — a soma consolidada só repassa', () => {
    // A view (vw_filament_type_summary) já exclui is_active=false e
    // status ESGOTADO/DESCARTADO de usable_spool_count/total_available_grams.
    // A consolidação apenas soma esses agregados por grupo.
    const [group] = groupFilamentTypes([
      typeFixture({
        filament_type_id: 'a',
        usable_spool_count: 2,
        total_spool_count: 5,
        total_available_grams: 400,
      }),
      typeFixture({
        filament_type_id: 'b',
        usable_spool_count: 0,
        total_spool_count: 3,
        total_available_grams: 0,
      }),
    ])
    expect(group.usableSpoolCount).toBe(2)
    expect(group.availableGrams).toBe(400)
  })

  it('ordena por Material -> Linha -> Cor (rótulo consolidado), nunca por fabricante', () => {
    const groups = groupFilamentTypes([
      typeFixture({
        filament_type_id: '1',
        material: 'PETG',
        line: 'Basic',
        commercial_color: 'Azul',
        manufacturer: 'ZZZ',
      }),
      typeFixture({
        filament_type_id: '2',
        material: 'PLA',
        line: 'Matte',
        commercial_color: 'Verde',
        manufacturer: 'AAA',
      }),
      typeFixture({
        filament_type_id: '3',
        material: 'PLA',
        line: 'Basic',
        commercial_color: 'Branco',
        manufacturer: 'YYY',
      }),
      typeFixture({
        filament_type_id: '4',
        material: 'PLA',
        line: 'Basic',
        commercial_color: 'Amarelo',
        manufacturer: 'BBB',
      }),
    ])
    expect(groups.map((g) => `${g.material}/${g.lineLabel}/${g.colorLabel}`)).toEqual([
      'PETG/Basic/Azul',
      'PLA/Basic/Amarelo',
      'PLA/Basic/Branco',
      'PLA/Matte/Verde',
    ])
  })
})

describe('matchesFilamentGroupSearch', () => {
  const [group] = groupFilamentTypes([
    typeFixture({
      filament_type_id: 'a',
      material: 'PLA',
      line: 'Basic',
      commercial_color: 'Preto',
      manufacturer: 'Voolt3D',
    }),
    typeFixture({
      filament_type_id: 'b',
      material: 'PLA',
      line: 'Basic',
      commercial_color: 'Preto',
      manufacturer: 'National3D',
    }),
  ])

  it('termo vazio casa tudo', () => {
    expect(matchesFilamentGroupSearch(group, '')).toBe(true)
  })

  it('encontra por Material, Linha e Cor consolidados (sem acento/maiúsculas)', () => {
    expect(matchesFilamentGroupSearch(group, 'pla')).toBe(true)
    expect(matchesFilamentGroupSearch(group, 'basic')).toBe(true)
    expect(matchesFilamentGroupSearch(group, 'pret')).toBe(true)
  })

  it('encontra por QUALQUER fabricante do grupo, mesmo sem coluna Fabricante', () => {
    expect(matchesFilamentGroupSearch(group, 'national')).toBe(true)
    expect(matchesFilamentGroupSearch(group, 'voolt')).toBe(true)
  })

  it('não casa termo ausente', () => {
    expect(matchesFilamentGroupSearch(group, 'petg')).toBe(false)
  })
})
