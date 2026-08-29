import type { OrderStatus } from '@/types/domain'

// "Atrasado" (2026-08-29) — auditado antes de implementar: NÃO é um status
// persistido (orders.order_status não tem esse valor, e nenhuma coluna
// "atraso"/"overdue" existe em nenhuma migration). Por isso é um indicador
// VISUAL derivado, calculado aqui em tempo de exibição — nunca um novo
// estado gravado no banco, nunca substitui order_status (o status
// operacional real continua sempre visível ao lado deste indicador, nunca
// no lugar dele).
//
// Regra: prazo de entrega (expected_delivery_date) já vencido (< hoje),
// para um pedido que ainda NÃO foi entregue nem cancelado (DELIVERED/
// CANCELLED nunca ficam "atrasados" — o fluxo já terminou).
export function isOrderOverdue(
  expectedDeliveryDate: string | null,
  orderStatus: OrderStatus,
  today: Date = new Date(),
): boolean {
  if (!expectedDeliveryDate) return false
  if (orderStatus === 'DELIVERED' || orderStatus === 'CANCELLED') return false

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expectedDeliveryDate)
  if (!match) return false
  const [, year, month, day] = match

  // Comparação puramente numérica (AAAAMMDD) — mesmo raciocínio já usado
  // por dateSortValue (OrdersPage.tsx): nunca via `new Date(string)`, que
  // interpretaria a data como meia-noite UTC e poderia comparar contra o
  // dia errado conforme o fuso local. `today` usa os componentes locais do
  // Date recebido (getFullYear/getMonth/getDate) — "hoje" da perspectiva de
  // quem está vendo a tela, não UTC.
  const expectedValue = Number(`${year}${month}${day}`)
  const todayValue = Number(
    `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`,
  )
  return expectedValue < todayValue
}
