import { describe, expect, it } from 'vitest'
import {
  MAX_QUANTITY,
  MIN_QUANTITY,
  QUANTITY_OPTIONS,
  accessoryRowsFrom,
  filterSelectableItems,
  findItemById,
  hasInactiveSelection,
  hasOutOfRangeQuantity,
  isQuantityOutOfRange,
  isRowInactive,
  itemLabel,
  packagingRowsFrom,
  validateRows,
  type CompositionRow,
} from './productComposition'
import type { ProductAccessory, ProductPackaging } from '@/types/domain'

describe('accessoryRowsFrom / packagingRowsFrom', () => {
  it('mapeia composição existente para linhas de formulário, com chave própria por linha', () => {
    const accessories: ProductAccessory[] = [
      { id: 'pa1', product_id: 'p1', accessory_id: 'a1', quantity: 2, created_at: '' },
      { id: 'pa2', product_id: 'p1', accessory_id: 'a2', quantity: 1, created_at: '' },
    ]
    const rows = accessoryRowsFrom(accessories)

    expect(rows).toHaveLength(2)
    expect(rows[0].itemId).toBe('a1')
    expect(rows[0].quantity).toBe('2')
    expect(rows[1].itemId).toBe('a2')
    expect(new Set(rows.map((row) => row.key)).size).toBe(2)
  })

  it('mapeia embalagens existentes para linhas de formulário', () => {
    const packaging: ProductPackaging[] = [{ id: 'pk1', product_id: 'p1', packaging_id: 'k1', quantity: 3, created_at: '' }]
    const rows = packagingRowsFrom(packaging)

    expect(rows).toEqual([{ key: rows[0].key, itemId: 'k1', quantity: '3' }])
  })
})

describe('filterSelectableItems (itens inativos)', () => {
  const activeA = { id: 'x1', is_active: true }
  const activeB = { id: 'x2', is_active: true }
  const inactiveC = { id: 'x3', is_active: false }

  it('exclui itens inativos das opções para uma linha nova (sem seleção)', () => {
    const result = filterSelectableItems([activeA, activeB, inactiveC], new Set(), null)

    expect(result.map((item) => item.id)).toEqual(['x1', 'x2'])
  })

  it('mantém o item inativo se ele for o selecionado atual da própria linha', () => {
    const result = filterSelectableItems([activeA, activeB, inactiveC], new Set(), 'x3')

    expect(result.map((item) => item.id)).toEqual(['x1', 'x2', 'x3'])
  })

  it('exclui itens já escolhidos em outras linhas, mesmo ativos', () => {
    const result = filterSelectableItems([activeA, activeB, inactiveC], new Set(['x1']), null)

    expect(result.map((item) => item.id)).toEqual(['x2'])
  })
})

describe('itemLabel', () => {
  it('mostra só o nome quando ativo', () => {
    expect(itemLabel({ name: 'Ímã 6x2', is_active: true })).toBe('Ímã 6x2')
  })

  it('marca "(inativo)" quando is_active é false', () => {
    expect(itemLabel({ name: 'Ímã 6x2', is_active: false })).toBe('Ímã 6x2 (inativo)')
  })
})

describe('findItemById', () => {
  const items = [
    { id: 'a1', name: 'Ímã' },
    { id: 'a2', name: 'Parafuso' },
  ]

  it('encontra o item pelo id', () => {
    expect(findItemById(items, 'a2')).toEqual({ id: 'a2', name: 'Parafuso' })
  })

  it('retorna undefined para id nulo ou inexistente', () => {
    expect(findItemById(items, null)).toBeUndefined()
    expect(findItemById(items, 'a9')).toBeUndefined()
  })
})

describe('isRowInactive / hasInactiveSelection', () => {
  const items = [
    { id: 'a1', is_active: true },
    { id: 'a2', is_active: false },
  ]

  it('linha sem item selecionado não é inativa', () => {
    const row: CompositionRow = { key: 'r1', itemId: null, quantity: '' }
    expect(isRowInactive(row, items)).toBe(false)
  })

  it('linha com item ativo não é inativa', () => {
    const row: CompositionRow = { key: 'r1', itemId: 'a1', quantity: '1' }
    expect(isRowInactive(row, items)).toBe(false)
  })

  it('linha com item inativo é inativa', () => {
    const row: CompositionRow = { key: 'r1', itemId: 'a2', quantity: '1' }
    expect(isRowInactive(row, items)).toBe(true)
  })

  it('hasInactiveSelection é true se QUALQUER linha tiver item inativo', () => {
    const rows: CompositionRow[] = [
      { key: 'r1', itemId: 'a1', quantity: '1' },
      { key: 'r2', itemId: 'a2', quantity: '1' },
    ]
    expect(hasInactiveSelection(rows, items)).toBe(true)
  })

  it('hasInactiveSelection é false quando nenhuma linha tem item inativo', () => {
    const rows: CompositionRow[] = [
      { key: 'r1', itemId: 'a1', quantity: '1' },
      { key: 'r2', itemId: null, quantity: '' },
    ]
    expect(hasInactiveSelection(rows, items)).toBe(false)
  })
})

describe('validateRows', () => {
  it('exige item selecionado em cada linha', () => {
    const rows: CompositionRow[] = [{ key: 'r1', itemId: null, quantity: '2' }]
    const result = validateRows(rows, 'um acessório')

    expect(result.errors).toEqual({ r1: 'Selecione um acessório.' })
    expect(result.items).toEqual([])
  })

  it('exige quantidade inteira >= 1', () => {
    const rows: CompositionRow[] = [{ key: 'r1', itemId: 'a1', quantity: '0' }]
    const result = validateRows(rows, 'um acessório')

    expect(result.errors).toEqual({ r1: 'A quantidade deve ser maior ou igual a 1.' })
  })

  it('retorna os itens válidos convertidos', () => {
    const rows: CompositionRow[] = [
      { key: 'r1', itemId: 'a1', quantity: '2' },
      { key: 'r2', itemId: 'a2', quantity: '5' },
    ]
    const result = validateRows(rows, 'um acessório')

    expect(result.errors).toEqual({})
    expect(result.items).toEqual([
      { id: 'a1', quantity: 2 },
      { id: 'a2', quantity: 5 },
    ])
  })

  it('rejeita quantidade acima de 20, sem enviar', () => {
    const rows: CompositionRow[] = [{ key: 'r1', itemId: 'a1', quantity: '21' }]
    const result = validateRows(rows, 'um acessório')

    expect(result.errors).toEqual({ r1: 'A quantidade deve estar entre 1 e 20.' })
    expect(result.items).toEqual([])
  })

  it('aceita o limite exato de 20', () => {
    const rows: CompositionRow[] = [{ key: 'r1', itemId: 'a1', quantity: '20' }]
    const result = validateRows(rows, 'um acessório')

    expect(result.errors).toEqual({})
    expect(result.items).toEqual([{ id: 'a1', quantity: 20 }])
  })
})

describe('QUANTITY_OPTIONS / isQuantityOutOfRange / hasOutOfRangeQuantity', () => {
  it('QUANTITY_OPTIONS contém exatamente os inteiros de 1 a 20', () => {
    expect(QUANTITY_OPTIONS).toHaveLength(20)
    expect(QUANTITY_OPTIONS[0]).toBe(1)
    expect(QUANTITY_OPTIONS[19]).toBe(20)
    expect(MIN_QUANTITY).toBe(1)
    expect(MAX_QUANTITY).toBe(20)
  })

  it('quantidade vazia (linha nova, ainda não escolhida) não é considerada fora do intervalo', () => {
    expect(isQuantityOutOfRange('')).toBe(false)
  })

  it('quantidades dentro de 1-20 não são fora do intervalo', () => {
    expect(isQuantityOutOfRange('1')).toBe(false)
    expect(isQuantityOutOfRange('20')).toBe(false)
    expect(isQuantityOutOfRange('10')).toBe(false)
  })

  it('quantidades fora de 1-20 são identificadas', () => {
    expect(isQuantityOutOfRange('21')).toBe(true)
    expect(isQuantityOutOfRange('0')).toBe(true)
    expect(isQuantityOutOfRange('-3')).toBe(true)
    expect(isQuantityOutOfRange('999')).toBe(true)
  })

  it('hasOutOfRangeQuantity é true se QUALQUER linha estiver fora do intervalo', () => {
    const rows: CompositionRow[] = [
      { key: 'r1', itemId: 'a1', quantity: '5' },
      { key: 'r2', itemId: 'a2', quantity: '50' },
    ]
    expect(hasOutOfRangeQuantity(rows)).toBe(true)
  })

  it('hasOutOfRangeQuantity é false quando todas as linhas estão dentro do intervalo (ou vazias)', () => {
    const rows: CompositionRow[] = [
      { key: 'r1', itemId: 'a1', quantity: '5' },
      { key: 'r2', itemId: null, quantity: '' },
    ]
    expect(hasOutOfRangeQuantity(rows)).toBe(false)
  })
})
