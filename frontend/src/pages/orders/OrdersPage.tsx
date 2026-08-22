import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { OrderEditForm } from '@/components/orders/OrderEditForm'
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
import { updateQuoteOrder, type CreateOrderInput } from '@/lib/api/orders'
import type { ItemType, OrderStatus, OrderSummary, PaymentMethod, PaymentStatus } from '@/types/domain'

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

// item_types (vw_order_summary, migration
// 20260821014342_extend_order_summary_and_payment_method.sql) já vem
// deduplicado e em ordem alfabética determinística — só traduzido aqui
// para exibição.
const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  CATALOG: 'Catálogo',
  CUSTOM: 'Personalizado',
  SPOT: 'Spot',
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  CARTAO: 'Cartão',
}

function formatItemTypes(types: ItemType[]): string {
  return types.length > 0 ? types.map((type) => ITEM_TYPE_LABELS[type]).join(', ') : '—'
}

// Nomes de todos os itens (order_items.item_name), já na ordem de criação
// vinda da view — cobre CATALOG/CUSTOM/SPOT igualmente, nunca tenta
// resolver nome via product_id (CUSTOM/SPOT não têm).
function formatItemNames(names: string[]): string {
  return names.length > 0 ? names.join(', ') : '—'
}

function formatPaymentMethod(method: PaymentMethod | null): string {
  return method ? PAYMENT_METHOD_LABELS[method] : '—'
}

// delivery_method já é gravado em português livre pelo formulário ('Em
// mãos'/'Correios'/'Transportadora', sem CHECK constraint no banco) — só
// repassa o valor como está, sem dicionário de tradução; "—" só quando
// ausente/vazio.
function formatDeliveryMethod(value: string | null): string {
  return value && value.trim() ? value : '—'
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

  // Diálogo de edição ("Alterar pedido") — orderId presente = aberto, nulo
  // = fechado. isSubmitting/submitError seguem o MESMO padrão já usado
  // para o diálogo de criação (estado aqui na página, não dentro do
  // formulário) — OrderEditForm só busca os dados (getOrder/
  // listOrderItems) e monta o OrderForm compartilhado; quem chama
  // updateQuoteOrder() de fato é esta página, via onSubmit.
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null)
  const [isEditSubmitting, setIsEditSubmitting] = useState(false)
  const [editFormError, setEditFormError] = useState<string | null>(null)

  // Nome do cliente resolvido a partir dos dados já carregados por
  // useCustomers — nenhuma consulta nova, nunca exibe UUID.
  const customerNameById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer.name])), [
    customers,
  ])
  // Idem para empresa — mesma técnica, reaproveitando useCompanies() já
  // buscado para alimentar o formulário (nenhuma consulta nova).
  const companyNameById = useMemo(() => new Map(companies.map((company) => [company.id, company.name])), [
    companies,
  ])

  // Coluna "Cliente": B2B (company_id preenchido) mostra o nome da
  // empresa; B2C (company_id nulo) mostra o nome do cliente. Nunca exibe
  // UUID — cai em "—" se o nome não for encontrado nos dados já
  // carregados (mesma garantia de customerNameById isolado).
  function resolveClientCellText(order: OrderSummary): string {
    if (order.company_id) {
      return companyNameById.get(order.company_id) ?? '—'
    }
    return customerNameById.get(order.customer_id) ?? '—'
  }

  function openCreateDialog() {
    setFormError(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(orderId: string) {
    setEditFormError(null)
    setEditingOrderId(orderId)
  }

  function closeEditDialog() {
    setEditingOrderId(null)
  }

  // Único caminho de escrita do modo edição: PUT /orders/:id/full ->
  // update_quote_order(), atômico (cabeçalho + itens numa só chamada) —
  // nunca createOrder, nunca updateOrder + add/update/removeOrderItem em
  // sequência. Erro SEMPRE mantém o diálogo aberto com os valores
  // digitados (mensagem inline, nunca toast, para nunca ficar escondida
  // atrás do próprio diálogo).
  async function handleEditSubmit(values: CreateOrderInput) {
    if (!editingOrderId) return
    setIsEditSubmitting(true)
    setEditFormError(null)
    try {
      await updateQuoteOrder(editingOrderId, values)
      toast.success('Pedido atualizado.')
      setEditingOrderId(null)
      refetch()
    } catch (err) {
      setEditFormError(toErrorMessage(err))
    } finally {
      setIsEditSubmitting(false)
    }
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
        <Button
          onClick={openCreateDialog}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
        >
          Novo pedido
        </Button>
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
          // 12 colunas (Ações incluída): overflow-x-auto + min-w garante
          // rolagem horizontal controlada só em telas estreitas (nunca em
          // desktop amplo, onde o min-w cabe inteiro sem sobrar scroll).
          // table-fixed com larguras percentuais somando 100% mantém
          // truncamento/title previsível por coluna, mesmo padrão já
          // aprovado em Empresas. Larguras das 11 colunas anteriores só
          // encolheram o suficiente para abrir espaço para Ações — nenhuma
          // coluna foi removida ou teve seu conteúdo prejudicado.
          <div className="overflow-x-auto">
            <Table className="min-w-[1300px] table-fixed text-[16px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-auto w-[8%] py-2 whitespace-normal">Nº pedido</TableHead>
                  <TableHead className="h-auto w-[10%] py-2 whitespace-normal">Cliente</TableHead>
                  <TableHead className="h-auto w-[9%] py-2 whitespace-normal">Tipo(s)</TableHead>
                  <TableHead className="h-auto w-[12%] py-2 whitespace-normal">Produto(s)</TableHead>
                  <TableHead className="h-auto w-[8%] py-2 whitespace-normal">Status</TableHead>
                  <TableHead className="h-auto w-[8%] py-2 whitespace-normal">Status financeiro</TableHead>
                  <TableHead className="h-auto w-[7%] py-2 whitespace-normal">Método de pagamento</TableHead>
                  <TableHead className="h-auto w-[8%] py-2 whitespace-normal">Forma de entrega</TableHead>
                  <TableHead className="h-auto w-[7%] py-2 whitespace-normal">Total</TableHead>
                  <TableHead className="h-auto w-[8%] py-2 whitespace-normal">Saldo devedor</TableHead>
                  <TableHead className="h-auto w-[7%] py-2 whitespace-normal">Prazo</TableHead>
                  <TableHead className="h-auto w-[8%] py-2 whitespace-normal">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const clientCellText = resolveClientCellText(order)
                  const typesText = formatItemTypes(order.item_types)
                  const productsText = formatItemNames(order.item_names)
                  const paymentMethodText = formatPaymentMethod(order.payment_method)
                  const deliveryMethodText = formatDeliveryMethod(order.delivery_method)
                  const statusText = ORDER_STATUS_LABELS[order.order_status]
                  const paymentStatusText = PAYMENT_STATUS_LABELS[order.payment_status]

                  return (
                    <TableRow
                      key={order.order_id}
                      // Zebra striping com a paleta Forma: linha ímpar usa
                      // --brand-primary-soft diluído (/50), par fica
                      // branca, hover usa o mesmo tom sem diluir — mesmo
                      // padrão já aprovado em Clientes/Produtos/Empresas.
                      className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft"
                    >
                      <TableCell className="truncate" title={order.order_number}>
                        {order.order_number}
                      </TableCell>
                      <TableCell className="truncate" title={clientCellText !== '—' ? clientCellText : undefined}>
                        {clientCellText}
                      </TableCell>
                      <TableCell className="truncate" title={typesText !== '—' ? typesText : undefined}>
                        {typesText}
                      </TableCell>
                      <TableCell className="truncate" title={productsText !== '—' ? productsText : undefined}>
                        {productsText}
                      </TableCell>
                      <TableCell className="truncate" title={statusText}>
                        {statusText}
                      </TableCell>
                      <TableCell className="truncate" title={paymentStatusText}>
                        {paymentStatusText}
                      </TableCell>
                      <TableCell
                        className="truncate"
                        title={paymentMethodText !== '—' ? paymentMethodText : undefined}
                      >
                        {paymentMethodText}
                      </TableCell>
                      <TableCell
                        className="truncate"
                        title={deliveryMethodText !== '—' ? deliveryMethodText : undefined}
                      >
                        {deliveryMethodText}
                      </TableCell>
                      <TableCell className="truncate">{formatCurrency(order.total_value)}</TableCell>
                      <TableCell className="truncate">{formatCurrency(order.balance_due)}</TableCell>
                      <TableCell className="truncate">{formatDateOnly(order.expected_delivery_date)}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(order.order_id)}
                          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                        >
                          Alterar pedido
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
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

      {/* Mesma estrutura/tamanho de DialogContent do diálogo de criação
          acima — "visualmente igual ao formulário Novo pedido", conforme
          aprovado — já que OrderEditForm agora monta o mesmíssimo
          OrderForm (mode="edit"), só pré-preenchido. */}
      <Dialog open={editingOrderId !== null} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] gap-2 overflow-y-auto">
          <DialogHeader className="gap-0.5">
            <DialogTitle>Alterar pedido</DialogTitle>
            <DialogDescription>
              Só pedidos em Orçamento (QUOTE) com itens de Catálogo podem ser totalmente editados nesta versão.
            </DialogDescription>
          </DialogHeader>
          {editingOrderId && (
            <OrderEditForm
              orderId={editingOrderId}
              customers={customers}
              companies={companies}
              leadSources={leadSources}
              products={products}
              isSubmitting={isEditSubmitting}
              submitError={editFormError}
              onSubmit={(values) => void handleEditSubmit(values)}
              onCancel={closeEditDialog}
            />
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
