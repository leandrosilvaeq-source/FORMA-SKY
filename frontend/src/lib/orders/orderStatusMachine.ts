// Espelha exatamente a máquina de estados validada em
// change_order_status() (supabase/migrations/20260814030351_
// create_order_business_functions.sql, com a correção de
// 20260829150000_add_order_initial_status_classification.sql) — nenhuma
// regra nova é inventada aqui, só a mesma sequência linear e a mesma
// condição de cancelamento já implementadas na RPC. Este módulo NUNCA
// decide se uma transição é permitida do ponto de vista do backend (a RPC
// continua sendo a única fonte de verdade) — só decide quais BOTÕES faz
// sentido oferecer na interface para não sugerir uma ação que a RPC
// certamente rejeitaria (pular estado, avançar um pedido terminal,
// cancelar após o início da produção). Item SPOT sem tempo de pesquisa/
// modelagem registrado NÃO é mais um motivo de rejeição (decisão do
// usuário, 2026-08-29) — search_time_status é só informativo/histórico,
// nunca lido por change_order_status().

import type { OrderStatus } from '@/types/domain'

export const ORDER_STATUS_SEQUENCE: readonly OrderStatus[] = [
  'QUOTE',
  'WAITING_APPROVAL',
  'APPROVED',
  'IN_PRODUCTION_QUEUE',
  'IN_PRODUCTION',
  'WAITING_DELIVERY',
  'DELIVERED',
]

// Próximo status da sequência linear, ou null quando o status atual é
// terminal (DELIVERED, CANCELLED) ou não pertence à sequência de avanço.
export function getNextOrderStatus(current: OrderStatus): OrderStatus | null {
  const index = ORDER_STATUS_SEQUENCE.indexOf(current)
  if (index === -1 || index === ORDER_STATUS_SEQUENCE.length - 1) return null
  return ORDER_STATUS_SEQUENCE[index + 1]
}

// Cancelamento só é permitido antes de IN_PRODUCTION — mesma condição de
// change_order_status: v_current_pos >= array_position(sequence,
// 'IN_PRODUCTION') bloqueia (CANCELLED nunca está na sequência, então
// indexOf resulta -1 e cai fora, correto: um pedido já cancelado não pode
// ser cancelado de novo).
export function canCancelOrder(current: OrderStatus): boolean {
  const index = ORDER_STATUS_SEQUENCE.indexOf(current)
  const inProductionIndex = ORDER_STATUS_SEQUENCE.indexOf('IN_PRODUCTION')
  return index !== -1 && index < inProductionIndex
}

// Congelamento das cores/filamentos por unidade+plate (rodada corretiva,
// migration 20260829180000_add_categories_plate_weight_and_order_colors.sql,
// ainda não aplicada) — allow-list EXPLÍCITA e tipada, espelhando ao pé da
// letra a mesma allow-list de update_order_item_production_colors() na RPC
// (`if v_order_status not in ('QUOTE', 'WAITING_APPROVAL', 'APPROVED',
// 'IN_PRODUCTION_QUEUE') then raise ORDER_PRODUCTION_COLORS_FROZEN:`).
//
// Deliberadamente NUNCA calculada a partir da posição em
// ORDER_STATUS_SEQUENCE (como canCancelOrder faz) — coincidir com a
// posição atual de IN_PRODUCTION é um acidente da ordem hoje, não a regra
// em si: um status novo inserido ANTES de IN_PRODUCTION nessa sequência no
// futuro ficaria liberado aqui por posição, mas continuaria bloqueado na
// RPC (que só conhece os 4 nomes exatos abaixo) — a falha teria que ser
// seguro dos dois lados, e um cálculo posicional falha de forma insegura
// (libera por omissão). Por isso a comparação é sempre por PERTENCIMENTO a
// um conjunto fechado de nomes: qualquer status fora dele — incluindo um
// desconhecido/futuro — cai no `false` por padrão, nunca no `true`.
const PRODUCTION_COLOR_EDITABLE_STATUSES = new Set<OrderStatus>([
  'QUOTE',
  'WAITING_APPROVAL',
  'APPROVED',
  'IN_PRODUCTION_QUEUE',
])

export function canEditProductionColors(current: OrderStatus): boolean {
  return PRODUCTION_COLOR_EDITABLE_STATUSES.has(current)
}

// DELIVERED e CANCELLED nunca mostram avanço de status nem cancelamento —
// exigência explícita desta rodada, redundante com getNextOrderStatus
// retornando null e canCancelOrder retornando false para os dois, mas
// exposta como uma função própria para o componente não precisar combinar
// as duas condições toda vez que só quer saber "este pedido está
// encerrado?".
export function isTerminalOrderStatus(current: OrderStatus): boolean {
  return current === 'DELIVERED' || current === 'CANCELLED'
}
