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
// ainda não aplicada) — espelha exatamente a allow-list de
// update_order_item_production_colors() na RPC: editável só em
// QUOTE/WAITING_APPROVAL/APPROVED/IN_PRODUCTION_QUEUE (antes do início real
// da produção); bloqueado em IN_PRODUCTION/WAITING_DELIVERY/DELIVERED/
// CANCELLED. CANCELLED nunca está em ORDER_STATUS_SEQUENCE (indexOf = -1),
// então cai fora corretamente, igual a canCancelOrder. Função própria
// (mesmo cálculo de canCancelOrder hoje) para o caso de as duas regras
// divergirem no futuro — nunca combine as duas condições no chamador.
export function canEditProductionColors(current: OrderStatus): boolean {
  const index = ORDER_STATUS_SEQUENCE.indexOf(current)
  const inProductionIndex = ORDER_STATUS_SEQUENCE.indexOf('IN_PRODUCTION')
  return index !== -1 && index < inProductionIndex
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
