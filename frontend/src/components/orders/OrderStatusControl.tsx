import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { changeOrderStatus } from '@/lib/api/orders'
import { ApiError } from '@/lib/api/errors'
import { canCancelOrder, getNextOrderStatus, isTerminalOrderStatus } from '@/lib/orders/orderStatusMachine'
import type { OrderStatus } from '@/types/domain'

// Mesmos rótulos de OrdersPage.tsx/OrderEditForm.tsx/OrderManagementPanel.tsx
// — duplicados de propósito (componente auto-contido), mesma decisão já
// registrada nos outros três.
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  QUOTE: 'Orçamento',
  WAITING_APPROVAL: 'Aguardando aprovação',
  APPROVED: 'Aprovado',
  IN_PRODUCTION_QUEUE: 'Fila de produção',
  IN_PRODUCTION: 'Em produção',
  WAITING_DELIVERY: 'Aguardando entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
}

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

// Badge estático — mesmo texto do status, sem nenhuma interação. Usado para
// pedidos terminais (DELIVERED/CANCELLED, onde a máquina de estados não
// permite mais nenhuma transição) e como base visual do botão interativo
// abaixo, para os dois nunca parecerem elementos totalmente diferentes.
const STATUS_BADGE_CLASSNAME =
  'inline-flex items-center rounded-md border px-2 py-1 text-sm font-medium border-input text-muted-foreground'

export interface OrderStatusControlProps {
  orderId: string
  orderNumber: string
  status: OrderStatus
  // Chamado após uma transição bem-sucedida — o chamador (OrdersPage)
  // reage refazendo a listagem (useOrders.refetch), o que atualiza
  // automaticamente esta própria linha, as contagens dos filtros e a
  // listagem inteira (mesmo pipeline reativo já existente, nenhum estado
  // duplicado aqui).
  onChanged: () => void
}

// Controle compacto de status na própria listagem — reaproveita só as
// REGRAS já existentes (orderStatusMachine.ts + changeOrderStatus, a mesma
// função que OrderManagementPanel/useOrderManagement já chamam), nunca uma
// segunda máquina de estados. Deliberadamente NÃO reaproveita o hook
// useOrderManagement (que busca resumo/pagamentos/histórico inteiros) —
// seria um custo de rede desnecessário só para trocar um status a partir da
// linha da tabela; chama changeOrderStatus() diretamente, mesma função que
// o hook usa por baixo.
export function OrderStatusControl({ orderId, orderNumber, status, onChanged }: OrderStatusControlProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<OrderStatus | null>(null)
  const [isChanging, setIsChanging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const terminal = isTerminalOrderStatus(status)

  if (terminal) {
    return <span className={STATUS_BADGE_CLASSNAME}>{ORDER_STATUS_LABELS[status]}</span>
  }

  const nextStatus = getNextOrderStatus(status)
  const canCancel = canCancelOrder(status)

  function closeMenu() {
    setIsMenuOpen(false)
    setConfirmTarget(null)
    setError(null)
  }

  async function handleConfirm() {
    if (!confirmTarget) return
    setIsChanging(true)
    setError(null)
    try {
      await changeOrderStatus(orderId, confirmTarget)
      toast.success(
        confirmTarget === 'CANCELLED'
          ? `Pedido ${orderNumber} cancelado.`
          : `Pedido ${orderNumber}: status atualizado para "${ORDER_STATUS_LABELS[confirmTarget]}".`,
      )
      closeMenu()
      onChanged()
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setIsChanging(false)
    }
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setIsMenuOpen(true)}
        className={`${STATUS_BADGE_CLASSNAME} focus-visible:ring-brand-accent hover:border-brand-primary hover:text-brand-primary-dark cursor-pointer transition-colors outline-none focus-visible:ring-2`}
      >
        {ORDER_STATUS_LABELS[status]}
      </button>

      <Dialog open={isMenuOpen} onOpenChange={(open) => !open && closeMenu()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Alterar status — {orderNumber}</DialogTitle>
            <DialogDescription>Status atual: {ORDER_STATUS_LABELS[status]}.</DialogDescription>
          </DialogHeader>

          {!confirmTarget ? (
            <div className="flex flex-col gap-2">
              {nextStatus && (
                <Button
                  type="button"
                  onClick={() => setConfirmTarget(nextStatus)}
                  className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
                >
                  Avançar para &quot;{ORDER_STATUS_LABELS[nextStatus]}&quot;
                </Button>
              )}
              {canCancel && (
                <Button type="button" variant="destructive" onClick={() => setConfirmTarget('CANCELLED')}>
                  Cancelar pedido
                </Button>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm">
                {confirmTarget === 'CANCELLED'
                  ? `Tem certeza que deseja cancelar o pedido ${orderNumber}? Esta ação encerra o fluxo do pedido — nenhuma outra transição de status será possível depois.`
                  : `Tem certeza que deseja avançar o pedido ${orderNumber} para "${ORDER_STATUS_LABELS[confirmTarget]}"?`}
              </p>
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirmTarget(null)} disabled={isChanging}>
                  Voltar
                </Button>
                <Button
                  type="button"
                  variant={confirmTarget === 'CANCELLED' ? 'destructive' : 'default'}
                  onClick={() => void handleConfirm()}
                  disabled={isChanging}
                  className={
                    confirmTarget === 'CANCELLED' ? undefined : 'bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark'
                  }
                >
                  {isChanging ? 'Confirmando...' : 'Confirmar'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
