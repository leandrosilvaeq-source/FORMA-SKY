import type { PaymentType } from '@/types/domain'

// Inferência automática de payments.payment_type (2026-08-29) — o campo
// "Tipo de pagamento" foi removido da interface de Registrar pagamento; o
// backend (payments.payment_type) continua exigindo um dos 4 valores, só
// deixa de ser escolhido manualmente. Regras exatamente como pedido:
//   - valor positivo menor que o saldo devedor -> SINAL;
//   - valor positivo igual ao saldo devedor, sem pagamento anterior -> INTEGRAL;
//   - valor positivo igual ao saldo devedor, com pagamento anterior -> FINAL;
//   - valor negativo (ajuste negativo, via o mesmo Switch já existente) -> AJUSTE.
// Zero e valores acima do saldo continuam bloqueados ANTES desta função ser
// chamada (RegisterPaymentForm.tsx valida isso primeiro) — esta função
// nunca é chamada com um valor inválido; "igual ao saldo" é comparado
// depois de já confirmar amountValue <= balanceDue no chamador.
export function inferPaymentType(amountValue: number, balanceDue: number, currentTotalPaid: number): PaymentType {
  if (amountValue < 0) return 'AJUSTE'
  if (amountValue < balanceDue) return 'SINAL'
  return currentTotalPaid > 0 ? 'FINAL' : 'INTEGRAL'
}
