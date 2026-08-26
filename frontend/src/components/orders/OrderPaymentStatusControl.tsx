import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RegisterPaymentForm, type RegisterPaymentFormValues } from './RegisterPaymentForm'
import { registerPayment } from '@/lib/api/payments'
import { ApiError } from '@/lib/api/errors'
import type { PaymentStatus } from '@/types/domain'

// Mesmos rótulos de OrdersPage.tsx/OrderManagementPanel.tsx — duplicados de
// propósito (componente auto-contido), mesma decisão já registrada nos
// outros componentes de Pedidos. orders.payment_status é sempre DERIVADO
// por recalculate_order_financials() a partir dos pagamentos + total do
// pedido — nunca editado manualmente nem enviado direto ao backend por
// nenhuma tela; por isso este componente nunca escreve payment_status, só
// abre o mesmo fluxo de registro de pagamento que já provoca esse
// recálculo no banco.
const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  WAITING_PAYMENT: 'Aguardando pagamento',
  DEPOSIT_RECEIVED: 'Sinal recebido',
  PAID: 'Pago',
}

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

// Mesma classe-base do badge de OrderStatusControl.tsx — os dois controles
// de status da listagem (operacional e financeiro) precisam parecer a
// mesma família visual, nunca dois padrões diferentes.
const STATUS_BADGE_CLASSNAME =
  'inline-flex items-center rounded-md border px-2 py-1 text-sm font-medium border-input text-muted-foreground'

export interface OrderPaymentStatusControlProps {
  orderId: string
  orderNumber: string
  paymentStatus: PaymentStatus
  // Os 3 valores financeiros já vêm prontos de vw_order_summary (via
  // useOrders → OrderSummary), a mesma fonte que OrderManagementPanel usa
  // — nenhuma nova busca é feita aqui só para abrir o formulário.
  orderTotal: number
  totalPaid: number
  balanceDue: number
  // Mesmo contrato de OrderStatusControl.tsx: o chamador (OrdersPage) reage
  // refazendo a listagem (useOrders.refetch) após um pagamento registrado
  // com sucesso — isso atualiza automaticamente total pago/saldo devedor/
  // status financeiro desta própria linha (recalculados no backend, nunca
  // localmente) e as contagens dos filtros, sem nenhum estado duplicado
  // aqui.
  onChanged: () => void
}

// Controle compacto de status financeiro na própria listagem — reaproveita
// só o formulário e a função já existentes (RegisterPaymentForm.tsx +
// registerPayment(), a mesma que OrderManagementPanel/useOrderManagement já
// chamam), nunca uma segunda lógica de registro de pagamento ou de cálculo
// financeiro. Deliberadamente NÃO reaproveita o hook useOrderManagement
// (que busca resumo/pagamentos/histórico inteiros) — os 3 valores
// financeiros necessários já vêm prontos via props, buscar tudo de novo
// seria um custo de rede desnecessário só para abrir este formulário a
// partir da linha da tabela.
//
// register_payment() (supabase/migrations/20260814030351_
// create_order_business_functions.sql) não verifica orders.order_status em
// nenhum momento — só existência do pedido (FOR UPDATE) e a soma dos
// pagamentos nunca ficar negativa. Não há, portanto, nenhuma regra real do
// backend que bloqueie um novo pagamento/ajuste em um pedido CANCELLED,
// PAID ou com pagamento excedente — por isso este controle nunca vira um
// badge sem ação: o backend permite a operação em qualquer status, então a
// interface não inventa uma restrição que não existe no contrato.
export function OrderPaymentStatusControl({
  orderId,
  orderNumber,
  paymentStatus,
  orderTotal,
  totalPaid,
  balanceDue,
  onChanged,
}: OrderPaymentStatusControlProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const label = PAYMENT_STATUS_LABELS[paymentStatus]

  function closeDialog() {
    setIsDialogOpen(false)
    setError(null)
  }

  async function handleSubmit(values: RegisterPaymentFormValues) {
    setIsSubmitting(true)
    setError(null)
    try {
      await registerPayment({ ...values, order_id: orderId })
      toast.success('Pagamento registrado.')
      // Só fecha e só chama onChanged() depois da confirmação do backend —
      // nunca antes. O texto/valor exibidos no badge nunca mudam
      // localmente: só quando onChanged() (useOrders.refetch()) trouxer o
      // payment_status/total_paid/balance_due já recalculados de volta.
      closeDialog()
      onChanged()
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        title="Clique para registrar um pagamento"
        aria-label={`Registrar pagamento — status financeiro: ${label}`}
        onClick={() => setIsDialogOpen(true)}
        className={`${STATUS_BADGE_CLASSNAME} focus-visible:ring-brand-accent hover:border-brand-primary hover:text-brand-primary-dark cursor-pointer transition-colors outline-none focus-visible:ring-2`}
      >
        {label}
      </button>

      <Dialog open={isDialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>Pedido {orderNumber}.</DialogDescription>
          </DialogHeader>
          <RegisterPaymentForm
            orderTotal={orderTotal}
            balanceDue={balanceDue}
            currentTotalPaid={totalPaid}
            isSubmitting={isSubmitting}
            submitError={error}
            onSubmit={(values) => void handleSubmit(values)}
            onCancel={closeDialog}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
