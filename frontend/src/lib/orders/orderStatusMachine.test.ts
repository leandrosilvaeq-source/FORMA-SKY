import { describe, expect, it } from 'vitest'
import { canCancelOrder, getNextOrderStatus, isTerminalOrderStatus } from './orderStatusMachine'
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
