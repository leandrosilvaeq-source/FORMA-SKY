import { useMemo, useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { ResizableTableHead } from '@/components/dataTable/ResizableTableHead'
import { RestoreColumnWidthsButton } from '@/components/dataTable/RestoreColumnWidthsButton'
import { SortableColumnHeader } from '@/components/dataTable/SortableColumnHeader'
import { sortByColumn, type SortState } from '@/components/dataTable/sorting'
import {
  TABLE_COMPACT_ACTION_TEXT_CLASSNAME,
  TABLE_COMPACT_TEXT_CLASSNAME,
} from '@/components/dataTable/tableTypography'
import { SearchAutocomplete, type SearchAutocompleteOption } from '@/components/search/SearchAutocomplete'
import { OrderEditForm } from '@/components/orders/OrderEditForm'
import { OrderForm, type OrderFormSubmitValues } from '@/components/orders/OrderForm'
import { OrderManagementPanel } from '@/components/orders/OrderManagementPanel'
import { OrderPaymentStatusControl } from '@/components/orders/OrderPaymentStatusControl'
import { OrderStatusControl } from '@/components/orders/OrderStatusControl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { useAllProductPlateCounts } from '@/hooks/useAllProductPlateCounts'
import { useAuth } from '@/context/AuthContext'
import { useCompanies } from '@/hooks/useCompanies'
import { useCustomers } from '@/hooks/useCustomers'
import { useFilamentTypes } from '@/hooks/useFilamentTypes'
import { useLeadSources } from '@/hooks/useLeadSources'
import { useOrders } from '@/hooks/useOrders'
import { usePersistentColumnWidths } from '@/hooks/usePersistentColumnWidths'
import { useProducts } from '@/hooks/useProducts'
import { ApiError } from '@/lib/api/errors'
import { updateQuoteOrder, type CreateOrderInput } from '@/lib/api/orders'
import { formatTableDate, tableDateSortValue } from '@/lib/dates/tableDateFormat'
import { isOrderOverdue } from '@/lib/orders/orderOverdue'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import type { ColumnWidthSpec } from '@/lib/tables/columnWidths'
import { cn } from '@/lib/utils'
import type { ItemType, OrderStatus, OrderSummary, PaymentMethod, PaymentStatus } from '@/types/domain'

const ORDER_SEARCH_LISTBOX_ID = 'order-search-listbox'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// dd/mm/aa (rodada de padronização das listagens — ano de 2 dígitos, antes
// dd/mm/aaaa) — delega ao formatador compartilhado (lib/dates/tableDateFormat.ts,
// extraído desta mesma function). Mantido exportado por compatibilidade com
// o teste dedicado; nunca usado fora da apresentação em tabela (payload,
// formulário e diálogos continuam com seus próprios formatos, intocados).
export function formatDateOnly(value: string | null): string {
  return formatTableDate(value).short
}

// Valor numérico real da data (AAAAMMDD), para ordenar cronologicamente —
// nunca pelo texto já formatado (que ordenaria como texto, misturando
// dia/mês/ano incorretamente — mais ainda com ano de 2 dígitos).
function dateSortValue(value: string | null): number | null {
  return tableDateSortValue(value)
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

// Unificado (2026-08-29): usado só para ORDENAR a coluna "Status
// financeiro" (o texto exibido de fato vem de OrderPaymentStatusControl,
// que computa seu próprio rótulo) — mantido igual ao rótulo visível para a
// ordenação bater com o que a badge mostra.
const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  WAITING_PAYMENT: 'Ag. Pagamento',
  DEPOSIT_RECEIVED: 'Ag. Pagamento',
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

type OrderStatusFilterValue = 'all' | OrderStatus

// Mesma ordem/rótulos de ORDER_STATUS_LABELS, com "Todos" primeiro (padrão)
// — nenhum status novo inventado, os 8 valores são exatamente os de
// orders.order_status (Migration 7).
const ORDER_STATUS_FILTER_OPTIONS: Array<{ value: OrderStatusFilterValue; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'QUOTE', label: ORDER_STATUS_LABELS.QUOTE },
  { value: 'WAITING_APPROVAL', label: ORDER_STATUS_LABELS.WAITING_APPROVAL },
  { value: 'APPROVED', label: ORDER_STATUS_LABELS.APPROVED },
  { value: 'IN_PRODUCTION_QUEUE', label: ORDER_STATUS_LABELS.IN_PRODUCTION_QUEUE },
  { value: 'IN_PRODUCTION', label: ORDER_STATUS_LABELS.IN_PRODUCTION },
  { value: 'WAITING_DELIVERY', label: ORDER_STATUS_LABELS.WAITING_DELIVERY },
  { value: 'DELIVERED', label: ORDER_STATUS_LABELS.DELIVERED },
  { value: 'CANCELLED', label: ORDER_STATUS_LABELS.CANCELLED },
]

function matchesOrderStatusFilter(row: OrderRow, filter: OrderStatusFilterValue): boolean {
  return filter === 'all' || row.order.order_status === filter
}

// Mesmo idioma visual/semântico de StatusFilter em InventoryPage.tsx
// (radiogroup de botões nativos, focáveis/ativáveis por teclado sem roving
// tabindex) — reaproveitado aqui, nunca uma interação nova inventada.
// Contagem por status calculada sobre `rows` (já filtradas pela busca, mas
// nunca pelo próprio filtro de status — senão a contagem de cada opção
// mudaria conforme a opção ativa, o que confundiria mais do que ajudaria) —
// sempre local, nenhuma chamada nova à API.
function OrderStatusFilterBar({
  rows,
  value,
  onChange,
}: {
  rows: OrderRow[]
  value: OrderStatusFilterValue
  onChange: (next: OrderStatusFilterValue) => void
}) {
  const counts = useMemo(() => {
    const map = new Map<OrderStatusFilterValue, number>()
    map.set('all', rows.length)
    for (const row of rows) {
      map.set(row.order.order_status, (map.get(row.order.order_status) ?? 0) + 1)
    }
    return map
  }, [rows])

  return (
    <div role="radiogroup" aria-label="Filtrar pedidos por status" className="flex flex-wrap gap-2">
      {ORDER_STATUS_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
            value === option.value
              ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
              : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {option.label} ({counts.get(option.value) ?? 0})
        </button>
      ))}
    </div>
  )
}

// Colunas redimensionáveis (rodada de padronização das listagens) —
// defaultWidth soma ≈1615px, próximo do min-w-[1600px] anterior. minWidth
// da coluna "actions" (320px) é deliberadamente o suficiente para os 3
// controles (Alterar pedido/Gerenciar pedido/Excluir) nunca quebrarem em 2
// linhas mesmo no menor tamanho permitido pelo arraste — nenhum outro
// limite deste arquivo é tão crítico quanto este.
const ORDERS_TABLE_ID = 'orders'
const ORDERS_COLUMN_SPECS: ColumnWidthSpec[] = [
  { id: 'order_number', defaultWidth: 90, minWidth: 70, maxWidth: 200 },
  { id: 'client', defaultWidth: 170, minWidth: 100, maxWidth: 400 },
  { id: 'item_types', defaultWidth: 100, minWidth: 70, maxWidth: 250 },
  { id: 'item_names', defaultWidth: 160, minWidth: 100, maxWidth: 400 },
  { id: 'order_status', defaultWidth: 145, minWidth: 100, maxWidth: 320 },
  { id: 'payment_status', defaultWidth: 130, minWidth: 100, maxWidth: 300 },
  { id: 'payment_method', defaultWidth: 70, minWidth: 60, maxWidth: 150 },
  { id: 'delivery_method', defaultWidth: 130, minWidth: 80, maxWidth: 300 },
  { id: 'total_value', defaultWidth: 85, minWidth: 70, maxWidth: 200 },
  { id: 'balance_due', defaultWidth: 100, minWidth: 70, maxWidth: 200 },
  { id: 'expected_delivery_date', defaultWidth: 85, minWidth: 70, maxWidth: 150 },
  { id: 'actions', defaultWidth: 350, minWidth: 320, maxWidth: 500 },
]

export function OrdersPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const columnWidths = usePersistentColumnWidths(ORDERS_TABLE_ID, userId, ORDERS_COLUMN_SPECS)
  const { orders, isLoading, error, refetch, createWithPayment, remove } = useOrders()
  const { customers } = useCustomers()
  const { companies } = useCompanies()
  const { leadSources } = useLeadSources()
  const { products } = useProducts()
  // "Cores e filamentos" (migration 20260829180000, ainda não aplicada) —
  // mesma lista de filamentos ativos/inativos já usada em Estoque, e a
  // contagem de plates por Produto (product_id -> nº de plates), ambos
  // repassados para OrderForm/OrderEditForm decidirem quantas linhas
  // "Plate N" oferecer por item CATALOG.
  const { types: filamentTypes } = useFilamentTypes()
  const { plateCountByProductId } = useAllProductPlateCounts()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sort, setSort] = useState<SortState<OrderSortColumn> | null>(null)
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilterValue>('all')

  // Exclusão física protegida (2026-08-29) — mesmo padrão de InventoryPage.tsx/
  // CustomersPage.tsx: deleteError fica dentro do próprio diálogo de
  // confirmação (nunca vira toast) porque delete_order devolve uma
  // mensagem de negócio (409: status/pagamento/aprovação) que o usuário
  // precisa ver ali mesmo, com o diálogo continuando aberto. O pedido só
  // sai da lista local depois do await resolver com sucesso.
  const [deletingOrder, setDeletingOrder] = useState<OrderSummary | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Diálogo de edição ("Alterar pedido") — orderId presente = aberto, nulo
  // = fechado. isSubmitting/submitError seguem o MESMO padrão já usado
  // para o diálogo de criação (estado aqui na página, não dentro do
  // formulário) — OrderEditForm só busca os dados (getOrder/
  // listOrderItems) e monta o OrderForm compartilhado; quem chama
  // updateQuoteOrder() de fato é esta página, via onSubmit.
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null)
  const [isEditSubmitting, setIsEditSubmitting] = useState(false)
  const [editFormError, setEditFormError] = useState<string | null>(null)

  // Diálogo de gerenciamento ("Gerenciar pedido") — orderId presente =
  // aberto. Todo o estado de ações (mudança de status, pagamento) fica
  // dentro de OrderManagementPanel/useOrderManagement; esta página só
  // precisa saber QUAL pedido está aberto e reagir quando uma ação
  // terminar (onChanged -> refetch da listagem).
  const [managingOrderId, setManagingOrderId] = useState<string | null>(null)

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

  // Passo 2.5: filtro rápido por status — sempre local sobre `filteredRows`
  // (já filtradas pela busca), nunca uma nova chamada à API. Combina
  // corretamente com a busca: os dois filtros são independentes (AND
  // lógico), a ordem entre eles não importa matematicamente, só a
  // convenção já usada nas demais listagens (busca → filtro → ordenação).
  const statusFilteredRows = useMemo(
    () => filteredRows.filter((row) => matchesOrderStatusFilter(row, statusFilter)),
    [filteredRows, statusFilter],
  )

  // Passo 3: ordenar os pedidos filtrados. Nunca muta `orders`/`rows` —
  // sortByColumn sempre retorna uma cópia nova.
  const sortedRows = useMemo(() => sortByColumn(statusFilteredRows, sort, getOrderSortValue), [statusFilteredRows, sort])

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

  function openManageDialog(orderId: string) {
    setManagingOrderId(orderId)
  }

  function closeManageDialog() {
    setManagingOrderId(null)
  }

  // Cliente/Empresa já resolvido a partir de `rows` (mesma técnica exibida
  // na coluna Cliente da tabela) — repassado ao painel de gerenciamento
  // como texto pronto, nunca uma nova consulta a customers/companies
  // dentro do painel.
  const managingOrderClientLabel = managingOrderId
    ? (rows.find((row) => row.order.order_id === managingOrderId)?.clientText ?? null)
    : null

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

  // "Novo Pedido" com Forma de pagamento (2026-08-29): OrderForm em
  // mode="create" (o único uso deste diálogo) sempre inclui
  // payment_condition no objeto emitido — createWithPayment() chama
  // create_order_with_payment(), que cria o pedido e (conforme a condição)
  // registra o pagamento inicial numa única transação no banco. Nunca
  // createOrder() "puro" aqui.
  async function handleSubmit(values: OrderFormSubmitValues) {
    setIsSubmitting(true)
    setFormError(null)
    try {
      await createWithPayment({
        ...values,
        payment_condition: values.payment_condition ?? 'ON_DELIVERY',
      })
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

  function openDeleteDialog(order: OrderSummary) {
    setDeletingOrder(order)
    setDeleteError(null)
    setIsDeleteDialogOpen(true)
  }

  // delete_order (Edge Function -> RPC) já bloqueia com 409 quando o
  // pedido está fora de QUOTE/CANCELLED ou tem pagamento/aprovação/versão
  // vinculados, com uma mensagem que já explica o motivo — exibida aqui tal
  // qual, sem reescrever. Em bloqueio/erro, o pedido permanece exatamente
  // como estava (nenhuma cascata) e o diálogo continua aberto e funcional.
  async function handleConfirmDelete() {
    if (!deletingOrder) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await remove(deletingOrder.order_id)
      toast.success(`Pedido ${deletingOrder.order_number} excluído.`)
      setIsDeleteDialogOpen(false)
    } catch (err) {
      setDeleteError(toErrorMessage(err))
    } finally {
      setIsDeleting(false)
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

      {!isLoading && orders.length > 0 && (
        <div className="mt-3">
          <OrderStatusFilterBar rows={filteredRows} value={statusFilter} onChange={setStatusFilter} />
        </div>
      )}

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
          <p className="text-muted-foreground text-sm">
            {searchTerm.trim() ? 'Nenhum pedido encontrado para esta busca.' : 'Nenhum pedido encontrado para este status.'}
          </p>
        ) : (
          // 12 colunas (Ações incluída): overflow-x-auto + min-w (agora
          // dinâmico, soma das larguras atuais — ver columnWidths.totalWidthPx)
          // garante rolagem horizontal controlada só em telas estreitas
          // (nunca em desktop amplo). colgroup + table-fixed: cada <col>
          // define a largura real da coluna (nunca mais % fixo) — o
          // usuário pode redimensionar qualquer uma arrastando a borda
          // direita do cabeçalho; a largura escolhida fica salva por
          // usuário+tabela (usePersistentColumnWidths). minWidth da coluna
          // "actions" (320px, ver ORDERS_COLUMN_SPECS) nunca permite os 3
          // controles quebrarem em 2 linhas mesmo no menor arraste possível.
          <div className="overflow-x-auto">
            <div className="mb-1 flex justify-end">
              <RestoreColumnWidthsButton onClick={columnWidths.resetWidths} />
            </div>
            <Table
              className={cn('table-fixed', TABLE_COMPACT_TEXT_CLASSNAME)}
              style={{ minWidth: columnWidths.totalWidthPx }}
            >
              <colgroup>
                {ORDERS_COLUMN_SPECS.map((spec) => (
                  <col key={spec.id} style={{ width: columnWidths.getWidth(spec.id) }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <SortableColumnHeader
                    column="order_number"
                    label="Nº pedido"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('order_number'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="client"
                    label="Cliente"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('client'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="item_types"
                    label="Tipo(s)"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('item_types'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="item_names"
                    label="Produto(s)"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('item_names'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="order_status"
                    label="Status"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('order_status'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="payment_status"
                    label="Status financeiro"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('payment_status'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="payment_method"
                    label="Método de pagamento"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('payment_method'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="delivery_method"
                    label="Forma de entrega"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('delivery_method'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="total_value"
                    label="Total"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('total_value'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="balance_due"
                    label="Saldo devedor"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('balance_due'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="expected_delivery_date"
                    label="Prazo"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('expected_delivery_date'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <ResizableTableHead
                    columnId="actions"
                    columnLabel="Ações"
                    resize={{
                      width: columnWidths.getWidth('actions'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  >
                    Ações
                  </ResizableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map(
                  ({
                    order,
                    clientText,
                    typesText,
                    productsText,
                    paymentMethodText,
                    deliveryMethodText,
                  }) => {
                    const deliveryDate = formatTableDate(order.expected_delivery_date)
                    return (
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
                      <TableCell className="truncate">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <OrderStatusControl
                            orderId={order.order_id}
                            orderNumber={order.order_number}
                            status={order.order_status}
                            onChanged={refetch}
                            compact
                          />
                          {/* "Atrasado" — indicador visual derivado (nunca
                              um status persistido), sempre ao lado do
                              status operacional real, nunca no lugar dele. */}
                          {isOrderOverdue(order.expected_delivery_date, order.order_status) && (
                            <span className="border-destructive/40 bg-destructive/10 text-destructive inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium">
                              Atrasado
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="truncate">
                        <OrderPaymentStatusControl
                          orderId={order.order_id}
                          orderNumber={order.order_number}
                          paymentStatus={order.payment_status}
                          orderTotal={order.total_receivable}
                          totalPaid={order.total_paid}
                          balanceDue={order.balance_due}
                          onChanged={refetch}
                          compact
                        />
                      </TableCell>
                      <TableCell className="truncate" title={paymentMethodText ?? undefined}>
                        {paymentMethodText ?? '—'}
                      </TableCell>
                      <TableCell className="truncate" title={deliveryMethodText ?? undefined}>
                        {deliveryMethodText ?? '—'}
                      </TableCell>
                      <TableCell className="truncate">{formatCurrency(order.total_value)}</TableCell>
                      <TableCell className="truncate">{formatCurrency(order.balance_due)}</TableCell>
                      <TableCell className="truncate" title={deliveryDate.full ?? undefined}>
                        {deliveryDate.short}
                      </TableCell>
                      <TableCell>
                        {/* Rodada corretiva: flex-wrap permitia os 3
                            controles quebrarem em 2 linhas quando a coluna
                            era estreita — flex-nowrap + items-center os
                            mantém sempre numa linha só, centralizados
                            verticalmente (a coluna agora reserva largura
                            suficiente, ver comentário acima da <Table>).
                            shrink-0 em cada botão é rede de segurança extra
                            contra compressão. Padding horizontal dos 2
                            botões de texto reduzido de px-2.5 (padrão do
                            size="sm") para px-2 antes de mexer na fonte,
                            conforme pedido — texto completo preservado nos
                            dois, nunca substituído por ícone. */}
                        <div className="flex flex-nowrap items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(order.order_id)}
                            className={cn(
                              'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0 px-2',
                              TABLE_COMPACT_ACTION_TEXT_CLASSNAME,
                            )}
                          >
                            Alterar pedido
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openManageDialog(order.order_id)}
                            className={cn(
                              'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0 px-2',
                              TABLE_COMPACT_ACTION_TEXT_CLASSNAME,
                            )}
                          >
                            Gerenciar pedido
                          </Button>
                          {/* Ícone de lixeira, variant="destructive" sutil
                              (mesmo padrão de CustomersPage.tsx/
                              InventoryPage.tsx) — nunca compete
                              visualmente com os dois botões outline acima.
                              aria-label/title carregam o número do pedido.
                              size="icon-sm" (mesmo padrão já usado nos
                              botões de remover linha de Produtos/Composição)
                              é mais compacto que "sm" com só um ícone. */}
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon-sm"
                            onClick={() => openDeleteDialog(order)}
                            aria-label={`Excluir pedido ${order.order_number}`}
                            title={`Excluir pedido ${order.order_number}`}
                            className="shrink-0"
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    )
                  },
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
            filamentTypes={filamentTypes}
            productPlateCounts={plateCountByProductId}
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
              filamentTypes={filamentTypes}
              productPlateCounts={plateCountByProductId}
              isSubmitting={isEditSubmitting}
              submitError={editFormError}
              onSubmit={(values) => void handleEditSubmit(values)}
              onCancel={closeEditDialog}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={managingOrderId !== null} onOpenChange={(open) => !open && closeManageDialog()}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gerenciar pedido</DialogTitle>
            <DialogDescription>
              Status, aprovação, pagamentos e histórico do pedido, usando só a máquina de estados e as
              funções já existentes no backend.
            </DialogDescription>
          </DialogHeader>
          {managingOrderId && (
            <OrderManagementPanel
              orderId={managingOrderId}
              clientLabel={managingOrderClientLabel}
              onClose={closeManageDialog}
              onChanged={refetch}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir pedido</DialogTitle>
            <DialogDescription>
              {deletingOrder &&
                `Tem certeza que deseja excluir o pedido ${deletingOrder.order_number}? Esta ação é permanente e não pode ser desfeita.`}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-destructive text-sm">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeleting}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
            >
              Cancelar
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleConfirmDelete()} disabled={isDeleting}>
              {isDeleting ? 'Excluindo...' : 'Excluir definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
