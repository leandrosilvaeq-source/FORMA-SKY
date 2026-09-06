import { describe, expect, it } from 'vitest'
import { allocateFreightCents, predictUnitCostAfter } from './accessoryPurchaseCost'

describe('allocateFreightCents', () => {
  it('exemplo do pedido: A R$ 80,00, B R$ 20,00, frete R$ 15,00 -> A R$ 12,00, B R$ 3,00', () => {
    expect(allocateFreightCents([8000, 2000], 1500)).toEqual([1200, 300])
  })

  it('frete zero -> parcela zero para todas as linhas', () => {
    expect(allocateFreightCents([8000, 2000, 500], 0)).toEqual([0, 0, 0])
  })

  it('soma das parcelas é sempre exatamente o frete', () => {
    const cases: Array<[number[], number]> = [
      [[3333, 3333, 3334], 1000],
      [[1, 1, 1], 100],
      [[100, 200, 300, 400], 777],
      [[999999, 1], 12345],
      [[5000, 5000], 1],
    ]
    for (const [lines, freight] of cases) {
      const alloc = allocateFreightCents(lines, freight)
      expect(alloc.reduce((a, b) => a + b, 0)).toBe(freight)
      expect(alloc.every((c) => c >= 0)).toBe(true)
    }
  })

  it('maior resto: o centavo residual vai para a linha de maior fração, desempate por ordem', () => {
    // 3 linhas iguais, frete 100 -> 33,33,33 + 1 residual para a 1a (todas
    // empatam no resto -> menor índice ganha)
    expect(allocateFreightCents([1000, 1000, 1000], 100)).toEqual([34, 33, 33])
  })

  it('centavo residual segue a maior fração real quando os totais diferem', () => {
    // raw: 10*70=700 /100=7 r0 ; 10*30=300 /100=3 r0 -> sem residual
    expect(allocateFreightCents([7000, 3000], 1000)).toEqual([700, 300])
    // frete 101, subtotal 10000: A raw=101*7000=707000/10000=70 r7000 ;
    // B raw=101*3000=303000/10000=30 r3000 ; assigned=100 leftover=1 ->
    // maior resto = A
    expect(allocateFreightCents([7000, 3000], 101)).toEqual([71, 30])
  })

  it('determinístico: mesma entrada sempre produz o mesmo rateio', () => {
    const a = allocateFreightCents([1234, 5678, 9012], 999)
    const b = allocateFreightCents([1234, 5678, 9012], 999)
    expect(a).toEqual(b)
  })

  it('linha única recebe todo o frete', () => {
    expect(allocateFreightCents([2500], 500)).toEqual([500])
  })
})

describe('predictUnitCostAfter', () => {
  it('primeira compra com saldo zero e custo NULL define o custo pela nova entrada', () => {
    // 5 unidades, itens R$ 10,00, frete alocado R$ 2,00 -> R$ 12,00 / 5 = R$ 2,40
    expect(
      predictUnitCostAfter({
        balanceBefore: 0,
        unitCostBefore: null,
        quantity: 5,
        lineTotalCents: 1000,
        freightAllocatedCents: 200,
      }),
    ).toBe(2.4)
  })

  it('saldo anterior COM custo NULL: primeira compra define o custo, sem diluição pelo saldo', () => {
    // saldo 10, custo null, compra 5 un por R$ 10,00 sem frete -> R$ 10,00 / 5 = R$ 2,00
    expect(
      predictUnitCostAfter({
        balanceBefore: 10,
        unitCostBefore: null,
        quantity: 5,
        lineTotalCents: 1000,
        freightAllocatedCents: 0,
      }),
    ).toBe(2)
  })

  it('compra posterior usa média ponderada (exemplo do pedido)', () => {
    // saldo 10 × R$ 1,00 = R$ 10,00 ; entrada 5 un, itens R$ 10,00 + frete R$ 2,00
    // -> (1000 + 1000 + 200) / (10 + 5) = 2200 / 15 = 146,67 centavos -> R$ 1,47
    expect(
      predictUnitCostAfter({
        balanceBefore: 10,
        unitCostBefore: 1.0,
        quantity: 5,
        lineTotalCents: 1000,
        freightAllocatedCents: 200,
      }),
    ).toBe(1.47)
  })

  it('3 unidades por R$ 10,00, frete zero, custo NULL -> R$ 3,33 (custo derivado arredondado)', () => {
    expect(
      predictUnitCostAfter({
        balanceBefore: 0,
        unitCostBefore: null,
        quantity: 3,
        lineTotalCents: 1000,
        freightAllocatedCents: 0,
      }),
    ).toBe(3.33)
  })

  it('quantidade zero não gera divisão inválida', () => {
    expect(
      predictUnitCostAfter({
        balanceBefore: 5,
        unitCostBefore: 2,
        quantity: 0,
        lineTotalCents: 1000,
        freightAllocatedCents: 0,
      }),
    ).toBe(0)
  })
})
