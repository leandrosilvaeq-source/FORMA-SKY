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
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete'
import { CustomerForm, type CustomerFormValues } from '@/components/customers/CustomerForm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCompanies } from '@/hooks/useCompanies'
import { useCustomers } from '@/hooks/useCustomers'
import { useLeadSources } from '@/hooks/useLeadSources'
import { usePersistentColumnWidths } from '@/hooks/usePersistentColumnWidths'
import { ApiError } from '@/lib/api/errors'
import {
  formatWhatsAppForDisplay,
  isValidInstagramHandle,
  isValidWhatsAppNumber,
  normalizeInstagramHandle,
  normalizeWhatsAppNumber,
} from '@/lib/forms/customerContact'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import type { ColumnWidthSpec } from '@/lib/tables/columnWidths'
import { cn } from '@/lib/utils'
import type { Customer } from '@/types/domain'

const CONTACT_LINK_CLASSNAME = 'text-brand-primary hover:text-brand-primary-dark hover:underline'
const CUSTOMER_SEARCH_LISTBOX_ID = 'customer-search-listbox'
const CUSTOMERS_TABLE_ID = 'customers'
const CUSTOMERS_COLUMN_SPECS: ColumnWidthSpec[] = [
  { id: 'name', defaultWidth: 180, minWidth: 100, maxWidth: 400 },
  { id: 'company', defaultWidth: 155, minWidth: 90, maxWidth: 350 },
  { id: 'whatsapp', defaultWidth: 145, minWidth: 100, maxWidth: 300 },
  { id: 'instagram', defaultWidth: 145, minWidth: 100, maxWidth: 300 },
  { id: 'leadSource', defaultWidth: 155, minWidth: 90, maxWidth: 350 },
  { id: 'notes', defaultWidth: 170, minWidth: 100, maxWidth: 400 },
  { id: 'is_active', defaultWidth: 95, minWidth: 80, maxWidth: 180 },
  { id: 'actions', defaultWidth: 155, minWidth: 130, maxWidth: 300 },
]

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

// Uma linha "de exibição" pré-computada por cliente: os mesmos valores já
// normalizados/formatados que a tabela mostra (nunca o dado bruto do
// banco para WhatsApp/Instagram, por exigência explícita — ordenar pelo
// valor normalizado/exibido, não pelo texto cru gravado).
interface CustomerRow {
  customer: Customer
  companyName: string | null
  leadSourceName: string | null
  whatsappDisplay: string | null
  whatsappHref: string | null
  instagramDisplay: string | null
  instagramHref: string | null
  notes: string | null
}

function buildCustomerRow(
  customer: Customer,
  companyNameById: Map<string, string>,
  leadSourceNameById: Map<string, string>,
): CustomerRow {
  const companyName = customer.company_id ? (companyNameById.get(customer.company_id) ?? null) : null
  const leadSourceName = customer.acquisition_source_id
    ? (leadSourceNameById.get(customer.acquisition_source_id) ?? null)
    : null

  // Normalização só de APRESENTAÇÃO — nunca grava no banco. Dado antigo em
  // qualquer formato continua exatamente como está até ser editado/salvo
  // de novo; aqui só decidimos como MOSTRAR, se vira link, e por qual
  // valor ordenar.
  const whatsappNormalized = customer.whatsapp ? normalizeWhatsAppNumber(customer.whatsapp) : ''
  const whatsappIsValid = isValidWhatsAppNumber(whatsappNormalized)
  const whatsappDisplay = whatsappIsValid
    ? formatWhatsAppForDisplay(whatsappNormalized)
    : (customer.whatsapp ?? null)
  const whatsappHref = whatsappIsValid ? `https://wa.me/${whatsappNormalized.slice(1)}` : null

  const instagramNormalized = customer.instagram ? normalizeInstagramHandle(customer.instagram) : ''
  const instagramIsValid = isValidInstagramHandle(instagramNormalized)
  const instagramDisplay = instagramIsValid ? instagramNormalized : (customer.instagram ?? null)
  const instagramHref = instagramIsValid ? `https://instagram.com/${instagramNormalized.slice(1)}` : null

  return {
    customer,
    companyName,
    leadSourceName,
    whatsappDisplay,
    whatsappHref,
    instagramDisplay,
    instagramHref,
    notes: customer.notes,
  }
}

type SortColumn = 'name' | 'company' | 'whatsapp' | 'instagram' | 'leadSource' | 'notes' | 'is_active'

function getSortValue(row: CustomerRow, column: SortColumn): string | boolean | null {
  switch (column) {
    case 'name':
      return row.customer.name
    case 'company':
      return row.companyName
    case 'whatsapp':
      return row.whatsappDisplay
    case 'instagram':
      return row.instagramDisplay
    case 'leadSource':
      return row.leadSourceName
    case 'notes':
      return row.notes
    case 'is_active':
      return row.customer.is_active
  }
}

export function CustomersPage() {
  const { customers, isLoading, error, refetch, create, update, remove } = useCustomers()
  const { companies } = useCompanies()
  const { leadSources } = useLeadSources()
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const columnWidths = usePersistentColumnWidths(CUSTOMERS_TABLE_ID, userId, CUSTOMERS_COLUMN_SPECS)

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sort, setSort] = useState<SortState<SortColumn> | null>(null)

  // Exclusão física protegida (2026-08-29) — mesmo padrão de InventoryPage.tsx
  // (Acessórios/Embalagens): deleteError fica dentro do próprio diálogo de
  // confirmação (nunca vira toast) porque delete_customer devolve uma
  // mensagem de negócio (409, "cliente vinculado a pedido/empresa") que o
  // usuário precisa ver ali mesmo, com o diálogo continuando aberto para
  // decidir o próximo passo. O cliente só sai da lista local depois do
  // await resolver com sucesso.
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Nomes de empresa/origem resolvidos a partir dos dados já carregados por
  // useCompanies/useLeadSources — nenhuma consulta nova, nunca exibe UUID.
  const companyNameById = useMemo(() => new Map(companies.map((company) => [company.id, company.name])), [companies])

  // Empresas oferecidas no formulário: só ativas, exceto a empresa já
  // vinculada ao cliente em edição (se ela tiver sido desativada depois do
  // vínculo, continua aparecendo/selecionada — nunca perde o vínculo
  // existente por causa de uma desativação posterior). listCompanies()
  // continua trazendo ativas e inativas sem filtro nenhum, porque a tela de
  // Empresas precisa exibir as duas — o filtro é só para a lista oferecida
  // aqui, no formulário de Clientes.
  const availableCompanies = useMemo(
    () =>
      companies.filter((company) => company.is_active || company.id === editingCustomer?.company_id),
    [companies, editingCustomer],
  )
  const leadSourceNameById = useMemo(
    () => new Map(leadSources.map((source) => [source.id, source.name])),
    [leadSources],
  )

  // Linhas de exibição pré-computadas — nunca modificam `customers` (o
  // array vindo do hook), sempre uma cópia derivada nova via .map.
  const rows = useMemo(
    () => customers.map((customer) => buildCustomerRow(customer, companyNameById, leadSourceNameById)),
    [customers, companyNameById, leadSourceNameById],
  )

  // Busca: só pelo nome (customer.name), local sobre `rows` já carregadas —
  // nenhuma nova chamada a useCustomers/API a cada tecla digitada.
  const filteredRows = useMemo(() => {
    const term = normalizeForSearch(searchTerm)
    if (!term) return rows
    return rows.filter((row) => normalizeForSearch(row.customer.name).includes(term))
  }, [rows, searchTerm])

  // Ordenação aplicada DEPOIS do filtro de busca (filtra primeiro, ordena o
  // resultado filtrado em seguida).
  const sortedRows = useMemo(() => sortByColumn(filteredRows, sort, getSortValue), [filteredRows, sort])

  // Sugestões do autocomplete: mesma lista já filtrada+ordenada que a
  // tabela mostra (respeita a ordenação visual ativa), só deduplicada por
  // customer.id — nunca duas sugestões idênticas quando a mesma referência
  // aparece repetida no array vindo do hook. Nenhum novo cálculo de busca,
  // nenhuma chamada nova a useCustomers/API.
  const suggestions = useMemo(() => {
    const seenIds = new Set<string>()
    const result: Array<{ id: string; label: string }> = []
    for (const row of sortedRows) {
      if (seenIds.has(row.customer.id)) continue
      seenIds.add(row.customer.id)
      result.push({ id: row.customer.id, label: row.customer.name })
    }
    return result
  }, [sortedRows])

  function openCreateDialog() {
    setEditingCustomer(null)
    setFormError(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(customer: Customer) {
    setEditingCustomer(customer)
    setFormError(null)
    setIsDialogOpen(true)
  }

  async function handleSubmit(values: CustomerFormValues) {
    setIsSubmitting(true)
    setFormError(null)
    try {
      if (editingCustomer) {
        await update(editingCustomer.id, values)
        toast.success('Cliente atualizado.')
      } else {
        await create(values)
        toast.success('Cliente cadastrado.')
      }
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

  async function handleToggleActive(customer: Customer) {
    setPendingToggleId(customer.id)
    try {
      await update(customer.id, { is_active: !customer.is_active })
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setPendingToggleId(null)
    }
  }

  function openDeleteDialog(customer: Customer) {
    setDeletingCustomer(customer)
    setDeleteError(null)
    setIsDeleteDialogOpen(true)
  }

  // delete_customer (Edge Function -> RPC) já bloqueia com 409 quando o
  // cliente tem pedido (CUSTOMER_HAS_ORDERS:) ou empresa (CUSTOMER_HAS_COMPANY:)
  // vinculados, com uma mensagem que já orienta desativar em vez de excluir
  // — exibida aqui tal qual, sem reescrever. Em bloqueio/erro, o cliente
  // permanece exatamente como estava (nenhum vínculo é removido, nenhuma
  // cascata) e o diálogo continua aberto e funcional.
  async function handleConfirmDelete() {
    if (!deletingCustomer) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await remove(deletingCustomer.id)
      toast.success('Cliente excluído.')
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
        <h1 className="font-heading text-2xl font-medium">Clientes</h1>
        <Button
          onClick={openCreateDialog}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
        >
          Novo cliente
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
        className="mt-4 max-w-xs"
        value={searchTerm}
        onValueChange={setSearchTerm}
        suggestions={suggestions}
        onSelect={setSearchTerm}
        ariaLabel="Buscar cliente"
        placeholder="Buscar cliente..."
        clearLabel="Limpar busca"
        listboxId={CUSTOMER_SEARCH_LISTBOX_ID}
        listboxAriaLabel="Sugestões de cliente"
        noResultsText="Nenhum cliente encontrado."
      />

      <div className="mt-3">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : customers.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum cliente cadastrado.</p>
        ) : sortedRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum cliente encontrado para esta busca.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="mb-1 flex justify-end">
              <RestoreColumnWidthsButton onClick={columnWidths.resetWidths} />
            </div>
            <Table
              className={cn('table-fixed', TABLE_COMPACT_TEXT_CLASSNAME)}
              style={{ minWidth: columnWidths.totalWidthPx }}
            >
              <colgroup>
                {CUSTOMERS_COLUMN_SPECS.map((spec) => (
                  <col key={spec.id} style={{ width: columnWidths.getWidth(spec.id) }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <SortableColumnHeader
                    column="name"
                    label="Cliente"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('name'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="company"
                    label="Empresa"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('company'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="whatsapp"
                    label="WhatsApp"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('whatsapp'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="instagram"
                    label="Instagram"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('instagram'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="leadSource"
                    label="Como nos conheceu"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('leadSource'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="notes"
                    label="Observações"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('notes'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                  <SortableColumnHeader
                    column="is_active"
                    label="Ativo"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('is_active'),
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
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map(({ customer, companyName, leadSourceName, whatsappDisplay, whatsappHref, instagramDisplay, instagramHref, notes }) => (
                  <TableRow
                    key={customer.id}
                    // Zebra striping com a paleta Forma: linha ímpar usa
                    // --brand-primary-soft diluído (/50), par fica branca,
                    // hover usa o mesmo tom sem diluir (mais perceptível,
                    // ainda dentro da paleta, nunca roxo forte/gradiente).
                    // Baseado na posição renderizada (nth-child via
                    // odd:/even:), então já reflete a ordem visual atual
                    // (busca + ordenação) sem nenhum cálculo extra.
                    className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft"
                  >
                    <TableCell className="truncate" title={customer.name}>
                      {customer.name}
                    </TableCell>
                    <TableCell className="truncate" title={companyName ?? undefined}>
                      {companyName ?? '—'}
                    </TableCell>
                    <TableCell className="truncate" title={whatsappDisplay ?? undefined}>
                      {whatsappHref ? (
                        <a
                          href={whatsappHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={CONTACT_LINK_CLASSNAME}
                          title={whatsappDisplay ?? undefined}
                        >
                          {whatsappDisplay}
                        </a>
                      ) : (
                        (whatsappDisplay ?? '—')
                      )}
                    </TableCell>
                    <TableCell className="truncate" title={instagramDisplay ?? undefined}>
                      {instagramHref ? (
                        <a
                          href={instagramHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={CONTACT_LINK_CLASSNAME}
                          title={instagramDisplay ?? undefined}
                        >
                          {instagramDisplay}
                        </a>
                      ) : (
                        (instagramDisplay ?? '—')
                      )}
                    </TableCell>
                    <TableCell className="truncate" title={leadSourceName ?? undefined}>
                      {leadSourceName ?? '—'}
                    </TableCell>
                    <TableCell className="truncate" title={notes ?? undefined}>
                      {notes ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={customer.is_active}
                        disabled={pendingToggleId === customer.id}
                        onCheckedChange={() => void handleToggleActive(customer)}
                        aria-label={customer.is_active ? 'Desativar cliente' : 'Ativar cliente'}
                        className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(customer)}
                          className={cn(
                            'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark',
                            TABLE_COMPACT_ACTION_TEXT_CLASSNAME,
                          )}
                        >
                          Editar
                        </Button>
                        {/* Ícone de lixeira (não texto): variant="destructive"
                            já é intencionalmente sutil (bg-destructive/10),
                            mesmo padrão de InventoryPage.tsx. aria-label e
                            title (tooltip nativo) carregam o nome completo do
                            cliente — o botão em si não tem texto visível. */}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openDeleteDialog(customer)}
                          aria-label={`Excluir cliente ${customer.name}`}
                          title={`Excluir cliente ${customer.name}`}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        {/* Ampliada (mesma referência de largura de "Novo Pedido" em
            OrdersPage.tsx) para caber os cards de "Como nos conheceu:" sem
            quebrar demais em telas médias — max-h/overflow evita corte em
            telas baixas, mesmo padrão já usado nos diálogos maiores do
            projeto. */}
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCustomer ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
            <DialogDescription>
              {editingCustomer ? 'Atualize os dados do cliente.' : 'Preencha os dados para cadastrar um novo cliente.'}
            </DialogDescription>
          </DialogHeader>
          <CustomerForm
            key={editingCustomer?.id ?? 'new'}
            initialValues={editingCustomer ?? undefined}
            companies={availableCompanies}
            leadSources={leadSources}
            isSubmitting={isSubmitting}
            submitError={formError}
            onSubmit={(values) => void handleSubmit(values)}
            onCancel={() => setIsDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir cliente</DialogTitle>
            <DialogDescription>
              {deletingCustomer &&
                `Tem certeza que deseja excluir "${deletingCustomer.name}"? Esta ação é permanente e não pode ser desfeita.`}
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
