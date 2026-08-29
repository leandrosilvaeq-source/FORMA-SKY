import { useEffect, useState } from 'react'
import { OrderForm, type OrderFormInitialValues } from './OrderForm'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getOrder, type CreateOrderInput } from '@/lib/api/orders'
import { listOrderItems } from '@/lib/api/orderItems'
import { ApiError } from '@/lib/api/errors'
import type { Company, Customer, LeadSource, Order, OrderItem, OrderStatus, PaymentStatus, Product } from '@/types/domain'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

// Mesmos rótulos de OrdersPage.tsx — duplicados de propósito (componente
// auto-contido, sem depender de exports de página).
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

// Unificado (2026-08-29): "Aguardando pagamento"/"Sinal recebido" viram
// "Ag. Pagamento" na apresentação — mesmo texto, informação atual (não é
// histórico), mesma decisão de OrderManagementPanel.tsx/
// OrderPaymentStatusControl.tsx. Valores internos de PaymentStatus nunca
// mudam.
const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  WAITING_PAYMENT: 'Ag. Pagamento',
  DEPOSIT_RECEIVED: 'Ag. Pagamento',
  PAID: 'Pago',
}

// A edição completa (update_quote_order, via PUT /orders/:id/full) só é
// permitida quando o pedido está em QUOTE e todos os itens atuais são
// CATALOG — mesma regra imposta pela RPC no banco, replicada aqui só para
// a UI recusar proativamente (nunca deixa o usuário tentar salvar algo
// que o backend rejeitaria).
function buildReadOnlyMessage(order: Order, items: OrderItem[]): string | null {
  if (order.order_status !== 'QUOTE') {
    return `Este pedido está em "${ORDER_STATUS_LABELS[order.order_status]}" — nesta versão, só pedidos em Orçamento (QUOTE) podem ser totalmente editados.`
  }
  if (items.some((item) => item.item_type !== 'CATALOG')) {
    return 'Este pedido tem item Personalizado ou Spot — nesta versão, só pedidos com itens de Catálogo podem ser totalmente editados.'
  }
  return null
}

export interface OrderEditFormProps {
  orderId: string
  customers: Customer[]
  companies: Company[]
  leadSources: LeadSource[]
  products: Product[]
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: CreateOrderInput) => void
  onCancel: () => void
}

export function OrderEditForm({
  orderId,
  customers,
  companies,
  leadSources,
  products,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: OrderEditFormProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])

  useEffect(() => {
    // Sem setIsLoading(true)/setLoadError(null) síncronos aqui: os valores
    // iniciais (isLoading=true, loadError=null) já cobrem isso — este
    // componente é sempre remontado do zero a cada abertura do diálogo
    // (OrdersPage nunca reaproveita a mesma instância para orderId
    // diferente), então este efeito roda exatamente uma vez por montagem.
    let cancelled = false

    Promise.all([getOrder(orderId), listOrderItems(orderId)])
      .then(([orderData, itemsData]) => {
        if (cancelled) return
        setOrder(orderData)
        setItems(itemsData)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(toErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [orderId])

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  if (loadError || !order) {
    return (
      <div className="border-destructive/50 bg-destructive/10 flex items-center justify-between rounded-lg border p-3 text-sm">
        <span>{loadError ?? 'Não foi possível carregar o pedido.'}</span>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Fechar
        </Button>
      </div>
    )
  }

  const readOnlyMessage = buildReadOnlyMessage(order, items)

  const initialValues: OrderFormInitialValues = {
    companyId: order.company_id,
    customerId: order.customer_id,
    leadSourceId: order.lead_source_id,
    paymentMethod: order.payment_method,
    deliveryMethod: order.delivery_method,
    shippingCost: order.shipping_cost,
    expectedDeliveryDate: order.expected_delivery_date,
    notes: order.notes,
    // product_id é garantido não-nulo aqui: readOnlyMessage já teria
    // recusado o modo de edição se algum item não fosse CATALOG (só
    // CATALOG exige/tem product_id preenchido — CUSTOM/SPOT nunca chegam
    // a este ponto do componente).
    items: items.map((item) => ({
      productId: item.product_id as string,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      personalizationFee: item.personalization_fee,
    })),
  }

  return (
    <OrderForm
      mode="edit"
      orderNumber={order.order_number}
      orderStatusLabel={ORDER_STATUS_LABELS[order.order_status]}
      paymentStatusLabel={PAYMENT_STATUS_LABELS[order.payment_status]}
      initialValues={initialValues}
      readOnly={readOnlyMessage !== null}
      readOnlyMessage={readOnlyMessage ?? undefined}
      customers={customers}
      companies={companies}
      leadSources={leadSources}
      products={products}
      isSubmitting={isSubmitting}
      submitError={submitError}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}
