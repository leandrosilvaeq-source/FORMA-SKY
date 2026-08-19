import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { OrderForm } from '@/components/orders/OrderForm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCompanies } from '@/hooks/useCompanies'
import { useCustomers } from '@/hooks/useCustomers'
import { useLeadSources } from '@/hooks/useLeadSources'
import { useOrders } from '@/hooks/useOrders'
import { useProducts } from '@/hooks/useProducts'
import { ApiError } from '@/lib/api/errors'
import type { CreateOrderInput } from '@/lib/api/orders'
import type { OrderStatus, PaymentStatus } from '@/types/domain'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Reformata a string YYYY-MM-DD (formato de public.orders.expected_delivery_date
// e de <input type="date">) para DD/MM/YYYY. Puramente textual — nunca
// instancia Date a partir de uma data sem horário: new Date('YYYY-MM-DD') é
// interpretado como meia-noite UTC, e formatar isso de volta com
// toLocaleDateString('pt-BR') (fuso America/Sao_Paulo, UTC-3) mostraria o
// dia anterior. Determinístico e sem esse risco de fuso horário.
export function formatDateOnly(value: string | null): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${year}`
}

// Rótulos só para exibição — os valores em si (order_status/payment_status)
// nunca são alterados, só traduzidos na tela.
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

export function OrdersPage() {
  const { orders, isLoading, error, refetch, create } = useOrders()
  const { customers } = useCustomers()
  const { companies } = useCompanies()
  const { leadSources } = useLeadSources()
  const { products } = useProducts()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Nome do cliente resolvido a partir dos dados já carregados por
  // useCustomers — nenhuma consulta nova, nunca exibe UUID.
  const customerNameById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer.name])), [
    customers,
  ])

  function openCreateDialog() {
    setFormError(null)
    setIsDialogOpen(true)
  }

  async function handleSubmit(values: CreateOrderInput) {
    setIsSubmitting(true)
    setFormError(null)
    try {
      await create(values)
      toast.success('Pedido cadastrado.')
      setIsDialogOpen(false)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setFormError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppLayout>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium">Pedidos</h1>
        <Button onClick={openCreateDialog}>Novo pedido</Button>
      </div>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 mt-4 flex items-center justify-between rounded-lg border p-3 text-sm">
          <span>{toErrorMessage(error)}</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Tentar novamente
          </Button>
        </div>
      )}

      <div className="mt-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum pedido cadastrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº do pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Saldo devedor</TableHead>
                <TableHead>Prazo de entrega</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.order_id}>
                  <TableCell>{order.order_number}</TableCell>
                  <TableCell>{customerNameById.get(order.customer_id) ?? '—'}</TableCell>
                  <TableCell>{ORDER_STATUS_LABELS[order.order_status]}</TableCell>
                  <TableCell>{PAYMENT_STATUS_LABELS[order.payment_status]}</TableCell>
                  <TableCell>{formatCurrency(order.total_value)}</TableCell>
                  <TableCell>{formatCurrency(order.balance_due)}</TableCell>
                  <TableCell>{formatDateOnly(order.expected_delivery_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        {/* OrderForm é organizado em linhas compactas (rótulo + controle na
            mesma linha) com uma tabela de itens de 6 colunas (Produto,
            Preço, Quantidade com stepper -/+, Personalização, Total,
            Remover) — mais largo que os demais formulários do app. O
            DialogContent padrão (sm:max-w-sm, sem limite de altura) não
            comporta isso. Ajuste só neste dialog, via className (mesclado
            por cn()/twMerge — não altera components/ui/dialog.tsx nem os
            outros dialogs do app). sm:max-w-4xl (896px) dá margem
            confortável para a linha de item mais larga sem forçar scroll
            horizontal. gap-2 (em vez do gap-4 padrão) reduz o espaço entre
            cabeçalho e formulário — objetivo é caber inteiro em desktop
            padrão sem rolagem vertical; max-h-[90vh] + overflow-y-auto
            seguem como rede de segurança para pedidos com muitos itens.
            Abaixo do breakpoint sm, mantém o max-w-[calc(100%-2rem)]
            original (responsivo, sem scroll horizontal). */}
        <DialogContent className="sm:max-w-4xl max-h-[90vh] gap-2 overflow-y-auto">
          <DialogHeader className="gap-0.5">
            <DialogTitle>Novo pedido</DialogTitle>
            <DialogDescription>Preencha os dados para cadastrar um novo pedido de Catálogo.</DialogDescription>
          </DialogHeader>
          <OrderForm
            customers={customers}
            companies={companies}
            leadSources={leadSources}
            products={products}
            isSubmitting={isSubmitting}
            submitError={formError}
            onSubmit={(values) => void handleSubmit(values)}
            onCancel={() => setIsDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
