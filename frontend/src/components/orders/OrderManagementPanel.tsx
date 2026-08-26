import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RegisterPaymentForm, type RegisterPaymentFormValues } from './RegisterPaymentForm'
import { useOrderManagement } from '@/hooks/useOrderManagement'
import { ApiError } from '@/lib/api/errors'
import { canCancelOrder, getNextOrderStatus, isTerminalOrderStatus } from '@/lib/orders/orderStatusMachine'
import type { OrderStatus, PaymentMethod, PaymentStatus, PaymentType } from '@/types/domain'

// Mesmos rótulos de OrdersPage.tsx/OrderEditForm.tsx — duplicados de
// propósito (componente auto-contido, sem depender de exports de página),
// mesma decisão já registrada em OrderEditForm.tsx.
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

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  WAITING_PAYMENT: 'Aguardando pagamento',
  DEPOSIT_RECEIVED: 'Sinal recebido',
  PAID: 'Pago',
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  CARTAO: 'Cartão',
}

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  SINAL: 'Sinal',
  FINAL: 'Final',
  INTEGRAL: 'Integral',
  AJUSTE: 'Ajuste',
}

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

// Uma linha de exibição unificada, combinando as duas fontes de histórico
// imutável (order_status_history/payment_status_history) e os próprios
// pagamentos (payments — também um registro imutável, append-only, mesmo
// sem ser literalmente uma tabela "_history") num único timeline
// cronológico. Nenhum dado é inventado: cada campo vem direto de uma das
// três fontes já lidas por useOrderManagement.
interface HistoryRow {
  key: string
  changedAt: string
  kind: 'Status' | 'Financeiro' | 'Pagamento'
  description: string
  amountText: string | null
}

function buildHistoryRows(
  statusHistory: ReturnType<typeof useOrderManagement>['statusHistory'],
  paymentStatusHistory: ReturnType<typeof useOrderManagement>['paymentStatusHistory'],
  payments: ReturnType<typeof useOrderManagement>['payments'],
): HistoryRow[] {
  const rows: HistoryRow[] = []

  for (const entry of statusHistory) {
    rows.push({
      key: `status-${entry.id}`,
      changedAt: entry.changed_at,
      kind: 'Status',
      description: entry.from_status
        ? `${ORDER_STATUS_LABELS[entry.from_status]} → ${ORDER_STATUS_LABELS[entry.to_status]}`
        : ORDER_STATUS_LABELS[entry.to_status],
      amountText: null,
    })
  }

  for (const entry of paymentStatusHistory) {
    rows.push({
      key: `payment-status-${entry.id}`,
      changedAt: entry.changed_at,
      kind: 'Financeiro',
      description: entry.from_status
        ? `${PAYMENT_STATUS_LABELS[entry.from_status]} → ${PAYMENT_STATUS_LABELS[entry.to_status]}`
        : PAYMENT_STATUS_LABELS[entry.to_status],
      amountText: null,
    })
  }

  for (const payment of payments) {
    rows.push({
      key: `payment-${payment.id}`,
      changedAt: payment.paid_at,
      kind: 'Pagamento',
      description: `${PAYMENT_TYPE_LABELS[payment.payment_type]} — ${PAYMENT_METHOD_LABELS[payment.payment_method]}`,
      amountText: formatCurrency(payment.amount),
    })
  }

  // Mais recente primeiro. changed_at/paid_at como chave primária; `key`
  // (nunca reordenado por igualdade de timestamp) como desempate
  // determinístico — mesmo raciocínio já usado para item_names em
  // vw_order_summary (id como desempate estável).
  return rows.sort((a, b) => {
    const diff = new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()
    if (diff !== 0) return diff
    return a.key.localeCompare(b.key)
  })
}

export interface OrderManagementPanelProps {
  orderId: string
  // Nome do cliente ou da empresa já resolvido pelo chamador (mesma técnica
  // de OrdersPage.tsx: nunca uma nova consulta a customers/companies aqui
  // dentro, o painel não sabe nada sobre como esse nome foi resolvido).
  clientLabel: string | null
  onClose: () => void
  // Avisa o chamador (OrdersPage) para refazer a listagem depois de
  // qualquer ação bem-sucedida (mudança de status ou pagamento) — mesmo
  // padrão já usado por handleEditSubmit/handleSubmit em OrdersPage.tsx.
  onChanged: () => void
}

export function OrderManagementPanel({ orderId, clientLabel, onClose, onChanged }: OrderManagementPanelProps) {
  const {
    summary,
    payments,
    statusHistory,
    paymentStatusHistory,
    isLoading,
    loadError,
    refetch,
    isChangingStatus,
    changeStatus,
    isRegisteringPayment,
    registerPaymentForOrder,
  } = useOrderManagement(orderId)

  const [confirmTarget, setConfirmTarget] = useState<OrderStatus | null>(null)
  const [statusActionError, setStatusActionError] = useState<string | null>(null)
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  async function handleConfirmStatusChange() {
    if (!confirmTarget) return
    setStatusActionError(null)
    try {
      await changeStatus(confirmTarget)
      toast.success(
        confirmTarget === 'CANCELLED'
          ? 'Pedido cancelado.'
          : `Status atualizado para "${ORDER_STATUS_LABELS[confirmTarget]}".`,
      )
      setConfirmTarget(null)
      onChanged()
    } catch (err) {
      setStatusActionError(toErrorMessage(err))
    }
  }

  async function handleRegisterPayment(values: RegisterPaymentFormValues) {
    setPaymentError(null)
    try {
      await registerPaymentForOrder(values)
      toast.success('Pagamento registrado.')
      setIsPaymentDialogOpen(false)
      onChanged()
    } catch (err) {
      setPaymentError(toErrorMessage(err))
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  if (loadError || !summary) {
    return (
      <div className="border-destructive/50 bg-destructive/10 flex items-center justify-between rounded-lg border p-3 text-sm">
        <span>{loadError ? toErrorMessage(loadError) : 'Não foi possível carregar o pedido.'}</span>
        <Button type="button" variant="outline" size="sm" onClick={refetch}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  const nextStatus = getNextOrderStatus(summary.order_status)
  const canCancel = canCancelOrder(summary.order_status)
  const terminal = isTerminalOrderStatus(summary.order_status)
  const historyRows = buildHistoryRows(statusHistory, paymentStatusHistory, payments)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Pedido {summary.order_number}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Cliente/Empresa" value={clientLabel ?? '—'} />
          <Field label="Status" value={ORDER_STATUS_LABELS[summary.order_status]} />
          <Field label="Situação financeira" value={PAYMENT_STATUS_LABELS[summary.payment_status]} />
          <Field label="Total do pedido" value={formatCurrency(summary.total_receivable)} />
          <Field label="Total pago" value={formatCurrency(summary.total_paid)} />
          <Field label="Saldo devedor" value={formatCurrency(summary.balance_due)} />
        </CardContent>
        {summary.has_overpayment && (
          <CardContent>
            <p className="text-brand-primary-dark text-sm">
              Pagamento excedente: {formatCurrency(summary.overpayment_amount)}.
            </p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ações</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field
            label="Próxima ação permitida"
            value={
              terminal
                ? summary.order_status === 'CANCELLED'
                  ? 'Nenhuma — pedido cancelado.'
                  : 'Nenhuma — pedido entregue.'
                : nextStatus
                  ? `Avançar para "${ORDER_STATUS_LABELS[nextStatus]}"`
                  : 'Nenhuma.'
            }
          />
          <div className="flex flex-wrap gap-2">
            {!terminal && nextStatus && (
              <Button
                type="button"
                onClick={() => setConfirmTarget(nextStatus)}
                disabled={isChangingStatus}
                className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
              >
                Avançar para &quot;{ORDER_STATUS_LABELS[nextStatus]}&quot;
              </Button>
            )}
            {!terminal && canCancel && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmTarget('CANCELLED')}
                disabled={isChangingStatus}
              >
                Cancelar pedido
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPaymentError(null)
                setIsPaymentDialogOpen(true)
              }}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
            >
              Registrar pagamento
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pagamentos</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum pagamento registrado.</p>
          ) : (
            <Table className="table-fixed text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-auto w-[20%] py-2 whitespace-normal">Data</TableHead>
                  <TableHead className="h-auto w-[20%] py-2 whitespace-normal">Tipo</TableHead>
                  <TableHead className="h-auto w-[20%] py-2 whitespace-normal">Método</TableHead>
                  <TableHead className="h-auto w-[20%] py-2 text-right whitespace-normal">Valor</TableHead>
                  <TableHead className="h-auto w-[20%] py-2 whitespace-normal">Observações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{formatDateTime(payment.paid_at)}</TableCell>
                    <TableCell>{PAYMENT_TYPE_LABELS[payment.payment_type]}</TableCell>
                    <TableCell>{PAYMENT_METHOD_LABELS[payment.payment_method]}</TableCell>
                    <TableCell className="text-right">{formatCurrency(payment.amount)}</TableCell>
                    <TableCell className="truncate" title={payment.notes ?? undefined}>
                      {payment.notes ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          {historyRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum evento registrado.</p>
          ) : (
            <Table className="table-fixed text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-auto w-[20%] py-2 whitespace-normal">Data</TableHead>
                  <TableHead className="h-auto w-[15%] py-2 whitespace-normal">Tipo</TableHead>
                  <TableHead className="h-auto w-[45%] py-2 whitespace-normal">Descrição</TableHead>
                  <TableHead className="h-auto w-[20%] py-2 text-right whitespace-normal">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{formatDateTime(row.changedAt)}</TableCell>
                    <TableCell>{row.kind}</TableCell>
                    <TableCell className="truncate" title={row.description}>
                      {row.description}
                    </TableCell>
                    <TableCell className="text-right">{row.amountText ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Fechar
        </Button>
      </DialogFooter>

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmTarget === 'CANCELLED' ? 'Cancelar pedido' : `Avançar para "${confirmTarget ? ORDER_STATUS_LABELS[confirmTarget] : ''}"`}
            </DialogTitle>
            <DialogDescription>
              {confirmTarget === 'CANCELLED'
                ? `Tem certeza que deseja cancelar o pedido ${summary.order_number}? Esta ação encerra o fluxo do pedido — nenhuma outra transição de status será possível depois.`
                : `Tem certeza que deseja avançar o pedido ${summary.order_number} para "${confirmTarget ? ORDER_STATUS_LABELS[confirmTarget] : ''}"?`}
            </DialogDescription>
          </DialogHeader>
          {statusActionError && (
            <p role="alert" className="text-destructive text-sm">
              {statusActionError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmTarget(null)} disabled={isChangingStatus}>
              Voltar
            </Button>
            <Button
              type="button"
              variant={confirmTarget === 'CANCELLED' ? 'destructive' : 'default'}
              onClick={() => void handleConfirmStatusChange()}
              disabled={isChangingStatus}
              className={confirmTarget === 'CANCELLED' ? undefined : 'bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark'}
            >
              {isChangingStatus ? 'Confirmando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>Pedido {summary.order_number}.</DialogDescription>
          </DialogHeader>
          <RegisterPaymentForm
            currentTotalPaid={summary.total_paid}
            isSubmitting={isRegisteringPayment}
            submitError={paymentError}
            onSubmit={(values) => void handleRegisterPayment(values)}
            onCancel={() => setIsPaymentDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
