import { describe, expect, it } from 'vitest'
import { canCancelOrder, canEditProductionColors, getNextOrderStatus, isTerminalOrderStatus } from './orderStatusMachine'
import type { OrderStatus } from '@/types/domain'

describe('getNextOrderStatus', () => {
  it.each([
    ['QUOTE', 'WAITING_APPROVAL'],
    ['WAITING_APPROVAL', 'APPROVED'],
    ['APPROVED', 'IN_PRODUCTION_QUEUE'],
    ['IN_PRODUCTION_QUEUE', 'IN_PRODUCTION'],
    ['IN_PRODUCTION', 'WAITING_DELIVERY'],
    ['WAITING_DELIVERY', 'DELIVERED'],
  ] satisfies Array<[OrderStatus, OrderStatus]>)('%s -> %s (avança exatamente uma posição, nunca pula)', (current, expected) => {
    expect(getNextOrderStatus(current)).toBe(expected)
  })

  it('DELIVERED não tem próximo status (terminal)', () => {
    expect(getNextOrderStatus('DELIVERED')).toBeNull()
  })

  it('CANCELLED não tem próximo status (terminal, fora da sequência de avanço)', () => {
    expect(getNextOrderStatus('CANCELLED')).toBeNull()
  })
})

describe('canCancelOrder', () => {
  it.each(['QUOTE', 'WAITING_APPROVAL', 'APPROVED', 'IN_PRODUCTION_QUEUE'] satisfies OrderStatus[])(
    '%s permite cancelamento (antes de IN_PRODUCTION)',
    (status) => {
      expect(canCancelOrder(status)).toBe(true)
    },
  )

  it.each(['IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED'] satisfies OrderStatus[])(
    '%s bloqueia cancelamento (a partir de IN_PRODUCTION, inclusive, ou já terminal)',
    (status) => {
      expect(canCancelOrder(status)).toBe(false)
    },
  )
})

// Congelamento de cores (rodada corretiva, migration 20260829180000, ainda
// não aplicada) — allow-list EXPLÍCITA (nunca calculada pela posição em
// ORDER_STATUS_SEQUENCE), espelhando ao pé da letra a allow-list de
// update_order_item_production_colors() na RPC. Cada um dos 8 status reais
// é comprovado individualmente abaixo (nunca só um it.each agregado), mais
// um valor desconhecido/futuro simulado — a prova de que a regra falha de
// forma SEGURA (bloqueia por padrão) para qualquer nome fora do conjunto
// fechado, nunca libera por omissão como uma comparação posicional faria.
describe('canEditProductionColors', () => {
  it('QUOTE -> true', () => {
    expect(canEditProductionColors('QUOTE')).toBe(true)
  })

  it('WAITING_APPROVAL -> true', () => {
    expect(canEditProductionColors('WAITING_APPROVAL')).toBe(true)
  })

  it('APPROVED -> true', () => {
    expect(canEditProductionColors('APPROVED')).toBe(true)
  })

  it('IN_PRODUCTION_QUEUE -> true', () => {
    expect(canEditProductionColors('IN_PRODUCTION_QUEUE')).toBe(true)
  })

  it('IN_PRODUCTION -> false', () => {
    expect(canEditProductionColors('IN_PRODUCTION')).toBe(false)
  })

  it('WAITING_DELIVERY -> false', () => {
    expect(canEditProductionColors('WAITING_DELIVERY')).toBe(false)
  })

  it('DELIVERED -> false', () => {
    expect(canEditProductionColors('DELIVERED')).toBe(false)
  })

  it('CANCELLED -> false', () => {
    expect(canEditProductionColors('CANCELLED')).toBe(false)
  })

  // Um status desconhecido/futuro (nunca inserido em ORDER_STATUS_SEQUENCE
  // nem no conjunto fechado da allow-list) precisa falhar de forma segura
  // — bloqueado por padrão, nunca liberado. O cast é deliberado: simula um
  // valor que o backend/banco poderia devolver antes do tipo TS ser
  // atualizado (ex.: uma migration futura acrescentando um status novo),
  // cenário que uma comparação posicional (index < inProductionIndex)
  // liberaria incorretamente se o novo status entrasse ANTES de
  // IN_PRODUCTION na sequência — a allow-list por pertencimento nunca cai
  // nessa armadilha, porque não conhece "posições", só os 4 nomes exatos.
  it('valor desconhecido/futuro simulado -> false (falha segura, nunca libera por omissão)', () => {
    expect(canEditProductionColors('SOME_FUTURE_STATUS' as OrderStatus)).toBe(false)
  })
})

describe('isTerminalOrderStatus', () => {
  it.each(['DELIVERED', 'CANCELLED'] satisfies OrderStatus[])('%s é terminal', (status) => {
    expect(isTerminalOrderStatus(status)).toBe(true)
  })

  it.each([
    'QUOTE',
    'WAITING_APPROVAL',
    'APPROVED',
    'IN_PRODUCTION_QUEUE',
    'IN_PRODUCTION',
    'WAITING_DELIVERY',
  ] satisfies OrderStatus[])('%s não é terminal', (status) => {
    expect(isTerminalOrderStatus(status)).toBe(false)
  })
})
