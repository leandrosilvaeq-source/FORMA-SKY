import { describe, expect, it } from 'vitest'
import {
  countAvailableSpoolsByType,
  distinctFilamentColors,
  groupFilamentTypes,
  isFilamentSpoolAvailable,
  matchesFilamentGroupSearch,
  normalizeFilamentToken,
} from './filamentGroups'
import type { FilamentSpoolStatus, FilamentTypeSummary } from '@/types/domain'

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

function spoolRow(
  overrides: Partial<{
    id: string
    filament_type_id: string
    is_active: boolean
    status: FilamentSpoolStatus
    current_net_weight_grams: number
  }> = {},
) {
  return {
    id: 's1',
    filament_type_id: 't1',
    is_active: true,
    status: 'ABERTO' as FilamentSpoolStatus,
    current_net_weight_grams: 100,
    ...overrides,
  }
}

describe('normalizeFilamentToken', () => {
  it('minúsculas, sem acento, espaços internos colapsados, borda aparada', () => {
    expect(normalizeFilamentToken('  Basic   Matte ')).toBe('basic matte')
    expect(normalizeFilamentToken('Vermelhão')).toBe('vermelhao')
  })
})

describe('isFilamentSpoolAvailable — regra aprovada (is_active, status ok, saldo > 0)', () => {
  it.each([
    ['ativo, ABERTO, 100g', spoolRow({ status: 'ABERTO', current_net_weight_grams: 100 }), true],
    [
      'ativo, LACRADO, 1000g',
      spoolRow({ status: 'LACRADO', current_net_weight_grams: 1000 }),
      true,
    ],
    ['ativo, ABERTO, 0g', spoolRow({ status: 'ABERTO', current_net_weight_grams: 0 }), false],
    ['ativo, LACRADO, 0g', spoolRow({ status: 'LACRADO', current_net_weight_grams: 0 }), false],
    ['ativo, ABERTO, -5g', spoolRow({ status: 'ABERTO', current_net_weight_grams: -5 }), false],
    ['ativo, ESGOTADO, 0g', spoolRow({ status: 'ESGOTADO', current_net_weight_grams: 0 }), false],
    [
      'ativo, DESCARTADO, 500g',
      spoolRow({ status: 'DESCARTADO', current_net_weight_grams: 500 }),
      false,
    ],
    [
      'inativo/arquivado, 500g',
      spoolRow({ is_active: false, current_net_weight_grams: 500 }),
      false,
    ],
  ])('%s -> %s', (_label, spool, expected) => {
    expect(isFilamentSpoolAvailable(spool)).toBe(expected)
  })
})

describe('countAvailableSpoolsByType', () => {
  it('conta por filament_type_id, aplicando a regra, cada spool.id no máximo uma vez', () => {
    const counts = countAvailableSpoolsByType([
      spoolRow({ id: 's1', filament_type_id: 'a', current_net_weight_grams: 100 }),
      spoolRow({
        id: 's2',
        filament_type_id: 'a',
        status: 'LACRADO',
        current_net_weight_grams: 1000,
      }),
      spoolRow({ id: 's3', filament_type_id: 'a', current_net_weight_grams: 0 }), // zerado -> fora
      spoolRow({ id: 's4', filament_type_id: 'b', current_net_weight_grams: 250 }),
      spoolRow({ id: 's4', filament_type_id: 'b', current_net_weight_grams: 250 }), // id repetido -> não dobra
      spoolRow({
        id: 's5',
        filament_type_id: 'b',
        status: 'ESGOTADO',
        current_net_weight_grams: 0,
      }),
    ])
    expect(counts.get('a')).toBe(2)
    expect(counts.get('b')).toBe(1)
  })

  it('tipo sem nenhum rolo disponível não aparece no mapa (get -> undefined)', () => {
    const counts = countAvailableSpoolsByType([
      spoolRow({ id: 's1', filament_type_id: 'a', current_net_weight_grams: 0 }),
    ])
    expect(counts.get('a')).toBeUndefined()
  })
})

describe('groupFilamentTypes — consolidação por Material + Linha + Cor', () => {
  it('dois fabricantes com mesmo Material + Linha + Cor viram UMA linha', () => {
    const groups = groupFilamentTypes([
      typeFixture({ filament_type_id: 'a', manufacturer: 'Voolt3D' }),
      typeFixture({ filament_type_id: 'b', manufacturer: '3D Fila' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].filamentTypeIds.sort()).toEqual(['a', 'b'])
    expect(groups[0].manufacturers).toEqual(['3D Fila', 'Voolt3D'])
  })

  it('peso disponível = soma da view; rolos disponíveis = soma do mapa de contagem (NUNCA usable_spool_count)', () => {
    const groups = groupFilamentTypes(
      [
        typeFixture({ filament_type_id: 'a', total_available_grams: 500, usable_spool_count: 9 }),
        typeFixture({ filament_type_id: 'b', total_available_grams: 300.5, usable_spool_count: 9 }),
      ],
      new Map([
        ['a', 1],
        ['b', 2],
      ]),
    )
    expect(groups[0].availableGrams).toBe(800.5)
    expect(groups[0].availableSpoolCount).toBe(3)
  })

  it('sem mapa de contagem: availableSpoolCount = null (nunca cai na view)', () => {
    const [group] = groupFilamentTypes([typeFixture({ usable_spool_count: 5 })])
    expect(group.availableSpoolCount).toBeNull()
  })

  it('tipo ausente do mapa conta como 0 rolos disponíveis', () => {
    const [group] = groupFilamentTypes(
      [typeFixture({ filament_type_id: 'a' }), typeFixture({ filament_type_id: 'b' })],
      new Map([['a', 2]]),
    )
    expect(group.availableSpoolCount).toBe(2)
  })

  it('fabricante diferente não cria linha adicional; Material/Linha/Cor diferentes criam grupos distintos', () => {
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
      typeFixture({
        filament_type_id: 'e',
        material: 'PLA',
        line: 'Basic',
        commercial_color: 'Preto',
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

  it('rótulo canônico = grafia mais frequente (empate: ordem pt-BR)', () => {
    const [group] = groupFilamentTypes([
      typeFixture({ filament_type_id: 'a', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 'b', commercial_color: 'Preto' }),
      typeFixture({ filament_type_id: 'c', commercial_color: 'PRETO' }),
    ])
    expect(group.colorLabel).toBe('Preto')
  })

  it('estoque mínimo consolidado = maior limite entre os tipos ATIVOS (nunca soma); null se nenhum ativo tem limite', () => {
    const [withMin] = groupFilamentTypes([
      typeFixture({ filament_type_id: 'a', is_active: true, minimum_stock_grams: 200 }),
      typeFixture({ filament_type_id: 'b', is_active: true, minimum_stock_grams: 500 }),
      typeFixture({ filament_type_id: 'c', is_active: false, minimum_stock_grams: 9000 }),
    ])
    expect(withMin.minimumStockGrams).toBe(500)

    const [noMin] = groupFilamentTypes([
      typeFixture({ filament_type_id: 'a', is_active: true, minimum_stock_grams: null }),
      typeFixture({ filament_type_id: 'b', is_active: false, minimum_stock_grams: 300 }),
    ])
    expect(noMin.minimumStockGrams).toBeNull()
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

describe('distinctFilamentColors — sugestões de Cor (2026-09-04)', () => {
  it('elimina duplicações por diferença de maiúsculas/minúsculas e espaços de borda', () => {
    const colors = distinctFilamentColors([
      typeFixture({ commercial_color: 'Preto' }),
      typeFixture({ commercial_color: 'preto' }),
      typeFixture({ commercial_color: ' Preto ' }),
    ])
    expect(colors).toEqual(['Preto'])
  })

  it('preserva a grafia mais frequente; empate resolve por ordem alfabética pt-BR', () => {
    const colors = distinctFilamentColors([
      typeFixture({ commercial_color: 'preto' }),
      typeFixture({ commercial_color: 'Preto' }),
      typeFixture({ commercial_color: 'Preto' }),
    ])
    expect(colors).toEqual(['Preto'])
  })

  it('cores realmente distintas nunca colidem, devolvidas em ordem alfabética pt-BR', () => {
    const colors = distinctFilamentColors([
      typeFixture({ commercial_color: 'Dourado' }),
      typeFixture({ commercial_color: 'Azul' }),
      typeFixture({ commercial_color: 'Branco' }),
    ])
    expect(colors).toEqual(['Azul', 'Branco', 'Dourado'])
  })

  it('considera tipos ativos e arquivados (uma cor histórica continua uma sugestão válida)', () => {
    const colors = distinctFilamentColors([
      typeFixture({ commercial_color: 'Verde', is_active: false }),
    ])
    expect(colors).toEqual(['Verde'])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(distinctFilamentColors([])).toEqual([])
  })
})
