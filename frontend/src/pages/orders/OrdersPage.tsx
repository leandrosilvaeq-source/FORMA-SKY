import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { SortableColumnHeader } from '@/components/dataTable/SortableColumnHeader'
import { sortByColumn, type SortState } from '@/components/dataTable/sorting'
import { SearchAutocomplete, type SearchAutocompleteOption } from '@/components/search/SearchAutocomplete'
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
import { normalizeForSearch } from '@/lib/forms/textSearch'
import type { ItemType, OrderStatus, OrderSummary, PaymentMethod, PaymentStatus } from '@/types/domain'

const ORDER_SEARCH_LISTBOX_ID = 'order-search-listbox'

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

// Valor numérico real da data (AAAAMMDD), para ordenar cronologicamente —
// nunca pelo texto já formatado DD/MM/AAAA (que ordenaria como texto,
// misturando dia/mês/ano incorretamente).
function dateSortValue(value: string | null): number | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!match) return null
  const [, year, month, day] = match
  return Number(`${year}${month}${day}`)
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

// Uma linha "de exibição" pré-computada por pedido — os mesmos valores já
// resolvidos/traduzidos que a tabela mostra (nunca o código bruto do banco
// para status/método/cliente, por exigência explícita — ordenar e
// pesquisar pelo valor exibido, nunca o valor cru). item_names preservado
// como array (não só o texto já unido) porque a busca precisa comparar
// cada nome de produto individualmente, nunca o texto unido por vírgula
// (que poderia gerar falso positivo atravessando o separador).
interface OrderRow {
  order: OrderSummary
  clientText: string | null
  typesText: string | null
  productsText: string | null
  productNames: string[]
  statusText: string
  paymentStatusText: string
  paymentMethodText: string | null
  deliveryMethodText: string | null
}

function buildOrderRow(
  order: OrderSummary,
  customerNameById: Map<string, string>,
  companyNameById: Map<string, string>,
): OrderRow {
  // Coluna "Cliente": B2B (company_id preenchido) mostra o nome da
  // empresa; B2C (company_id nulo) mostra o nome do cliente. Nunca exibe
  // UUID — cai em null (exibido como "—") se o nome não for encontrado
  // nos dados já carregados.
  const clientText = order.company_id
    ? (companyNameById.get(order.company_id) ?? null)
    : (customerNameById.get(order.customer_id) ?? null)

  return {
    order,
    clientText,
    typesText: order.item_types.length > 0 ? order.item_types.map((type) => ITEM_TYPE_LABELS[type]).join(', ') : null,
    productsText: order.item_names.length > 0 ? order.item_names.join(', ') : null,
    productNames: order.item_names,
    statusText: ORDER_STATUS_LABELS[order.order_status],
    paymentStatusText: PAYMENT_STATUS_LABELS[order.payment_status],
    paymentMethodText: order.payment_method ? PAYMENT_METHOD_LABELS[order.payment_method] : null,
    deliveryMethodText: order.delivery_method && order.delivery_method.trim() ? order.delivery_method : null,
  }
}

type OrderSortColumn =
  | 'order_number'
  | 'client'
  | 'item_types'
  | 'item_names'
  | 'order_status'
  | 'payment_status'
  | 'payment_method'
  | 'delivery_method'
  | 'total_value'
  | 'balance_due'
  | 'expected_delivery_date'

function getOrderSortValue(row: OrderRow, column: OrderSortColumn): string | number | boolean | null {
  switch (column) {
    case 'order_number':
      return row.order.order_number
    case 'client':
      return row.clientText
    case 'item_types':
      return row.typesText
    case 'item_names':
      return row.productsText
    case 'order_status':
      return row.statusText
    case 'payment_status':
      return row.paymentStatusText
    case 'payment_method':
      return row.paymentMethodText
    case 'delivery_method':
      return row.deliveryMethodText
    case 'total_value':
      return row.order.total_value
    case 'balance_due':
      return row.order.balance_due
    case 'expected_delivery_date':
      return dateSortValue(row.order.expected_delivery_date)
  }
}

// Busca: número do pedido, nome do cliente/empresa exibido, ou nome de
// QUALQUER produto do pedido (nunca o texto já unido por vírgula — evita
// um falso positivo que atravessasse o separador ", "). Nunca considera
// status, valores ou método de pagamento.
function orderMatchesSearch(row: OrderRow, normalizedTerm: string): boolean {
  if (normalizeForSearch(row.order.order_number).includes(normalizedTerm)) return true
  if (row.clientText && normalizeForSearch(row.clientText).includes(normalizedTerm)) return true
  return row.productNames.some((name) => normalizeForSearch(name).includes(normalizedTerm))
}

type SuggestionKind = 'Pedido' | 'Cliente' | 'Produto'

// Sugestões derivadas do resultado JÁ filtrado+ordenado (rows recebido
// aqui é sempre sortedRows) — nunca de todos os pedidos brutos. Cada
// candidato (número do pedido / cliente / produto) só entra se ELE MESMO
// bater com o termo — um pedido pode aparecer no resultado porque seu
// número bateu, sem que isso signifique que o nome do cliente também
// bata; nunca oferece um cliente/produto que não corresponde de fato ao
// termo digitado. Chave estável = tipo + valor normalizado (nunca só o
// texto exibido, que poderia colidir entre tipos diferentes — ex.: um
// cliente e um produto chamados "Petlink").
function buildOrderSuggestions(rows: OrderRow[], normalizedTerm: string): SearchAutocompleteOption[] {
  const seenKeys = new Set<string>()
  const suggestions: SearchAutocompleteOption[] = []

  function addSuggestion(kind: SuggestionKind, label: string) {
    const normalizedLabel = normalizeForSearch(label)
    if (!normalizedLabel.includes(normalizedTerm)) return
    const key = `${kind}:${normalizedLabel}`
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    suggestions.push({
      id: `${kind.toLowerCase()}-${normalizedLabel.replace(/\s+/g, '-')}`,
      label,
      description: kind,
    })
  }

  for (const row of rows) {
    addSuggestion('Pedido', row.order.order_number)
    if (row.clientText) addSuggestion('Cliente', row.clientText)
    for (const name of row.productNames) addSuggestion('Produto', name)
  }

  return suggestions
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
  const [searchTerm, setSearchTerm] = useState('')
  const [sort, setSort] = useState<SortState<OrderSortColumn> | null>(null)

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

  // Linhas de exibição pré-computadas — nunca modificam `orders` (o array
  // vindo do hook), sempre uma cópia derivada nova via .map. Passo 1 da
  // integração pedida: montar os valores pesquisáveis reais de cada
  // pedido antes de filtrar.
  const rows = useMemo(
    () => orders.map((order) => buildOrderRow(order, customerNameById, companyNameById)),
    [orders, customerNameById, companyNameById],
  )

  // Passo 2: filtrar por número, cliente/empresa ou produto — local sobre
  // `rows` já carregadas, nenhuma nova chamada a useOrders/API a cada
  // tecla digitada.
  const filteredRows = useMemo(() => {
    const term = normalizeForSearch(searchTerm)
    if (!term) return rows
    return rows.filter((row) => orderMatchesSearch(row, term))
  }, [rows, searchTerm])

  // Passo 3: ordenar os pedidos filtrados. Nunca muta `orders`/`rows` —
  // sortByColumn sempre retorna uma cópia nova.
  const sortedRows = useMemo(() => sortByColumn(filteredRows, sort, getOrderSortValue), [filteredRows, sort])

  // Passo 4: tabela e sugestões usam o mesmo `sortedRows` — sugestões
  // sempre coerentes com a ordenação/filtro visualmente aplicados.
  const suggestions = useMemo(
    () => buildOrderSuggestions(sortedRows, normalizeForSearch(searchTerm)),
    [sortedRows, searchTerm],
  )

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

      <SearchAutocomplete
        className="mt-4 max-w-sm"
        value={searchTerm}
        onValueChange={setSearchTerm}
        suggestions={suggestions}
        onSelect={setSearchTerm}
        ariaLabel="Buscar pedido"
        placeholder="Buscar por pedido, cliente ou produto..."
        clearLabel="Limpar busca"
        listboxId={ORDER_SEARCH_LISTBOX_ID}
        listboxAriaLabel="Sugestões de pedido"
        noResultsText="Nenhum pedido encontrado."
      />

      <div className="mt-3">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum pedido cadastrado.</p>
        ) : sortedRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum pedido encontrado para esta busca.</p>
        ) : (
          // 12 colunas (Ações incluída): overflow-x-auto + min-w garante
          // rolagem horizontal controlada só em telas estreitas (nunca em
          // desktop amplo, onde o min-w cabe inteiro sem sobrar scroll).
          // table-fixed com larguras percentuais somando 100% mantém
          // truncamento/title previsível por coluna, mesmo padrão já
          // aprovado em Empresas.
          <div className="overflow-x-auto">
            <Table className="min-w-[1300px] table-fixed text-[16px]">
              <TableHeader>
                <TableRow>
                  <SortableColumnHeader
                    column="order_number"
                    label="Nº pedido"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[8%]"
                  />
                  <SortableColumnHeader
                    column="client"
                    label="Cliente"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[10%]"
                  />
                  <SortableColumnHeader
                    column="item_types"
                    label="Tipo(s)"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[9%]"
                  />
                  <SortableColumnHeader
                    column="item_names"
                    label="Produto(s)"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[12%]"
                  />
                  <SortableColumnHeader
                    column="order_status"
                    label="Status"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[8%]"
                  />
                  <SortableColumnHeader
                    column="payment_status"
                    label="Status financeiro"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[8%]"
                  />
                  <SortableColumnHeader
                    column="payment_method"
                    label="Método de pagamento"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[7%]"
                  />
                  <SortableColumnHeader
                    column="delivery_method"
                    label="Forma de entrega"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[8%]"
                  />
                  <SortableColumnHeader
                    column="total_value"
                    label="Total"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[7%]"
                  />
                  <SortableColumnHeader
                    column="balance_due"
                    label="Saldo devedor"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[8%]"
                  />
                  <SortableColumnHeader
                    column="expected_delivery_date"
                    label="Prazo"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[7%]"
                  />
                  <TableHead className="h-auto w-[8%] py-2 whitespace-normal">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map(
                  ({
                    order,
                    clientText,
                    typesText,
                    productsText,
                    statusText,
                    paymentStatusText,
                    paymentMethodText,
                    deliveryMethodText,
                  }) => (
                    <TableRow
                      key={order.order_id}
                      // Zebra striping com a paleta Forma: linha ímpar usa
                      // --brand-primary-soft diluído (/50), par fica
                      // branca, hover usa o mesmo tom sem diluir — mesmo
                      // padrão já aprovado em Clientes/Produtos/Empresas.
                      // Baseado na posição renderizada (nth-child via
                      // odd:/even:), então já reflete a ordem visual atual
                      // (busca + ordenação) sem nenhum cálculo extra.
                      className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft"
                    >
                      <TableCell className="truncate" title={order.order_number}>
                        {order.order_number}
                      </TableCell>
                      <TableCell className="truncate" title={clientText ?? undefined}>
                        {clientText ?? '—'}
                      </TableCell>
                      <TableCell className="truncate" title={typesText ?? undefined}>
                        {typesText ?? '—'}
                      </TableCell>
                      <TableCell className="truncate" title={productsText ?? undefined}>
                        {productsText ?? '—'}
                      </TableCell>
                      <TableCell className="truncate" title={statusText}>
                        {statusText}
                      </TableCell>
                      <TableCell className="truncate" title={paymentStatusText}>
                        {paymentStatusText}
                      </TableCell>
                      <TableCell className="truncate" title={paymentMethodText ?? undefined}>
                        {paymentMethodText ?? '—'}
                      </TableCell>
                      <TableCell className="truncate" title={deliveryMethodText ?? undefined}>
                        {deliveryMethodText ?? '—'}
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
                  ),
                )}
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
