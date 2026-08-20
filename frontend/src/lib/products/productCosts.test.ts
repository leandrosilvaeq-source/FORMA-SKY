import { describe, expect, it } from 'vitest'
import { calculateComponentsSubtotal, resolveAccessoryLines, resolvePackagingLines } from './productCosts'

const accessoriesCatalog = [
  { id: 'a1', name: 'Ímã 6x2', is_active: true, unit_cost: 1.5 },
  { id: 'a2', name: 'Parafuso M3', is_active: false, unit_cost: 0.2 },
  { id: 'a3', name: 'LED', is_active: true, unit_cost: null },
]

const packagingCatalog = [
  { id: 'k1', name: 'Caixa M', is_active: true, unit_cost: 3 },
  { id: 'k2', name: 'Ziplock', is_active: false, unit_cost: null },
]

describe('resolveAccessoryLines', () => {
  it('composição vazia retorna lista vazia', () => {
    expect(resolveAccessoryLines([], accessoriesCatalog)).toEqual([])
  })

  it('resolve acessório ativo com custo: nome, situação, quantidade, custo e subtotal', () => {
    const result = resolveAccessoryLines([{ accessory_id: 'a1', quantity: 3 }], accessoriesCatalog)

    expect(result).toEqual([
      { key: 'a1', name: 'Ímã 6x2', status: 'active', quantity: 3, unitCost: 1.5, subtotal: 4.5 },
    ])
  })

  it('preserva a quantidade gravada, mesmo grande', () => {
    const result = resolveAccessoryLines([{ accessory_id: 'a1', quantity: 20 }], accessoriesCatalog)

    expect(result[0].quantity).toBe(20)
    expect(result[0].subtotal).toBe(30)
  })

  it('acessório inativo continua visível, com status "inactive"', () => {
    const result = resolveAccessoryLines([{ accessory_id: 'a2', quantity: 2 }], accessoriesCatalog)

    expect(result[0]).toEqual({ key: 'a2', name: 'Parafuso M3', status: 'inactive', quantity: 2, unitCost: 0.2, subtotal: 0.4 })
  })

  it('custo unitário nulo: unitCost e subtotal ficam null, nunca 0', () => {
    const result = resolveAccessoryLines([{ accessory_id: 'a3', quantity: 5 }], accessoriesCatalog)

    expect(result[0].unitCost).toBeNull()
    expect(result[0].subtotal).toBeNull()
  })

  it('accessory_id não encontrado no catálogo: status "missing", quantidade preservada, custo/subtotal null', () => {
    const result = resolveAccessoryLines([{ accessory_id: 'a9-does-not-exist', quantity: 7 }], accessoriesCatalog)

    expect(result[0]).toEqual({
      key: 'a9-does-not-exist',
      name: 'Item não encontrado',
      status: 'missing',
      quantity: 7,
      unitCost: null,
      subtotal: null,
    })
  })
})

describe('resolvePackagingLines', () => {
  it('composição vazia retorna lista vazia', () => {
    expect(resolvePackagingLines([], packagingCatalog)).toEqual([])
  })

  it('resolve embalagem ativa com custo', () => {
    const result = resolvePackagingLines([{ packaging_id: 'k1', quantity: 2 }], packagingCatalog)

    expect(result).toEqual([{ key: 'k1', name: 'Caixa M', status: 'active', quantity: 2, unitCost: 3, subtotal: 6 }])
  })

  it('embalagem inativa continua visível, com status "inactive"', () => {
    const result = resolvePackagingLines([{ packaging_id: 'k2', quantity: 1 }], packagingCatalog)

    expect(result[0].status).toBe('inactive')
    expect(result[0].unitCost).toBeNull()
    expect(result[0].subtotal).toBeNull()
  })

  it('packaging_id não encontrado: status "missing"', () => {
    const result = resolvePackagingLines([{ packaging_id: 'k9-does-not-exist', quantity: 4 }], packagingCatalog)

    expect(result[0].status).toBe('missing')
    expect(result[0].name).toBe('Item não encontrado')
    expect(result[0].quantity).toBe(4)
  })
})

describe('calculateComponentsSubtotal', () => {
  it('D. sem acessórios nem embalagens: status "empty", total 0, sem aviso', () => {
    expect(calculateComponentsSubtotal([], [])).toEqual({ status: 'empty', total: 0, hasIncompleteData: false })
  })

  it('A. todos os componentes com custo: status "complete", soma acessórios + embalagens', () => {
    const accessoryLines = resolveAccessoryLines([{ accessory_id: 'a1', quantity: 2 }], accessoriesCatalog) // 3.0
    const packagingLines = resolvePackagingLines([{ packaging_id: 'k1', quantity: 1 }], packagingCatalog) // 3.0

    const result = calculateComponentsSubtotal(accessoryLines, packagingLines)

    expect(result).toEqual({ status: 'complete', total: 6, hasIncompleteData: false })
  })

  it('B. parte dos componentes com custo: status "partial", soma só os conhecidos, aviso ligado', () => {
    const accessoryLines = resolveAccessoryLines(
      [
        { accessory_id: 'a1', quantity: 2 }, // 3.0, conhecido
        { accessory_id: 'a3', quantity: 1 }, // custo nulo
      ],
      accessoriesCatalog,
    )

    const result = calculateComponentsSubtotal(accessoryLines, [])

    expect(result).toEqual({ status: 'partial', total: 3, hasIncompleteData: true })
  })

  it('C. nenhum componente com custo informado: status "not_calculable", total 0, aviso ligado', () => {
    const accessoryLines = resolveAccessoryLines([{ accessory_id: 'a3', quantity: 1 }], accessoriesCatalog)
    const packagingLines = resolvePackagingLines([{ packaging_id: 'k2', quantity: 1 }], packagingCatalog)

    const result = calculateComponentsSubtotal(accessoryLines, packagingLines)

    expect(result).toEqual({ status: 'not_calculable', total: 0, hasIncompleteData: true })
  })

  it('item ausente (missing) conta como custo desconhecido para fins de parcial/aviso', () => {
    const accessoryLines = resolveAccessoryLines(
      [
        { accessory_id: 'a1', quantity: 1 }, // 1.5, conhecido
        { accessory_id: 'ghost', quantity: 1 }, // missing
      ],
      accessoriesCatalog,
    )

    const result = calculateComponentsSubtotal(accessoryLines, [])

    expect(result).toEqual({ status: 'partial', total: 1.5, hasIncompleteData: true })
  })

  it('não formata moeda: total é sempre número puro', () => {
    const accessoryLines = resolveAccessoryLines([{ accessory_id: 'a1', quantity: 3 }], accessoriesCatalog)

    const result = calculateComponentsSubtotal(accessoryLines, [])

    expect(typeof result.total).toBe('number')
    expect(result.total).toBe(4.5)
  })
})
