import { describe, expect, it } from 'vitest'
import {
  filamentTypeLabel,
  filterSelectableFilamentTypes,
  findFilamentTypeById,
  hasInactiveFilamentSelectionInPlates,
} from './productPlates'
import type { FilamentTypeSummary } from '@/types/domain'

// Testes dos seletores de tipo de filamento trazidos de
// productFilamentComposition.ts (removido na limpeza de código órfão de
// 2026-08-29 — companheiro do diálogo antigo FilamentCompositionForm.tsx,
// sem nenhum consumidor de escrita restante) para productPlates.ts, seu
// único consumidor real hoje. Mesmos casos de teste, movidos junto com o
// código — nenhum comportamento novo, nenhuma cobertura perdida.

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

describe('hasInactiveFilamentSelectionInPlates (via isFilamentTypeRowInactive interno)', () => {
  // isFilamentTypeRowInactive não é exportado (só usado internamente por
  // hasInactiveFilamentSelectionInPlates) — testado indiretamente aqui,
  // igual a como já era usado dentro de ProductForm.test.tsx antes desta
  // limpeza; os casos abaixo isolam especificamente o comportamento por
  // linha/tipo que antes tinha um teste próprio em
  // productFilamentComposition.test.ts (removido).
  const types = [typeFixture({ filament_type_id: 'ft1' }), typeFixture({ filament_type_id: 'ft2', is_active: false })]

  it('plate sem nenhuma linha com tipo selecionado não é considerado inativo', () => {
    const plates = [{ key: 'p1', timeInput: '', filaments: [{ key: 'r1', filamentTypeId: null, weight: '' }] }]
    expect(hasInactiveFilamentSelectionInPlates(plates, types)).toBe(false)
  })

  it('plate com uma linha de tipo ativo não é considerado inativo', () => {
    const plates = [{ key: 'p1', timeInput: '', filaments: [{ key: 'r1', filamentTypeId: 'ft1', weight: '10' }] }]
    expect(hasInactiveFilamentSelectionInPlates(plates, types)).toBe(false)
  })

  it('plate com uma linha de tipo inativo é considerado inativo', () => {
    const plates = [{ key: 'p1', timeInput: '', filaments: [{ key: 'r1', filamentTypeId: 'ft2', weight: '10' }] }]
    expect(hasInactiveFilamentSelectionInPlates(plates, types)).toBe(true)
  })

  it('é true se QUALQUER plate tiver QUALQUER linha com tipo inativo', () => {
    const plates = [
      { key: 'p1', timeInput: '', filaments: [{ key: 'r1', filamentTypeId: 'ft1', weight: '10' }] },
      { key: 'p2', timeInput: '', filaments: [{ key: 'r2', filamentTypeId: 'ft2', weight: '5' }] },
    ]
    expect(hasInactiveFilamentSelectionInPlates(plates, types)).toBe(true)
  })
})
