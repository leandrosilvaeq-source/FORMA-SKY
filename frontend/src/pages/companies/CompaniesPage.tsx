import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { ResizableTableHead } from '@/components/dataTable/ResizableTableHead'
import { RestoreColumnWidthsButton } from '@/components/dataTable/RestoreColumnWidthsButton'
import { SortableColumnHeader } from '@/components/dataTable/SortableColumnHeader'
import { sortByColumn, type SortState } from '@/components/dataTable/sorting'
import { TABLE_COMPACT_TEXT_CLASSNAME } from '@/components/dataTable/tableTypography'
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete'
import { CompanyForm, type CompanyFormValues, type ContactsStatus } from '@/components/companies/CompanyForm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCompanies } from '@/hooks/useCompanies'
import { useCustomers } from '@/hooks/useCustomers'
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
import type { Company } from '@/types/domain'

const COMPANIES_TABLE_ID = 'companies'
const COMPANIES_COLUMN_SPECS: ColumnWidthSpec[] = [
  { id: 'name', defaultWidth: 175, minWidth: 100, maxWidth: 400 },
  { id: 'contacts', defaultWidth: 210, minWidth: 100, maxWidth: 450 },
  { id: 'whatsapp', defaultWidth: 145, minWidth: 100, maxWidth: 300 },
  { id: 'instagram', defaultWidth: 145, minWidth: 100, maxWidth: 300 },
  { id: 'notes', defaultWidth: 200, minWidth: 100, maxWidth: 450 },
  { id: 'is_active', defaultWidth: 85, minWidth: 70, maxWidth: 180 },
  { id: 'actions', defaultWidth: 155, minWidth: 110, maxWidth: 300 },
]

// Helpers de normalização/validação de contato reaproveitados de
// customerContact.ts (extraídos originalmente para Clientes, mas são
// funções puras que recebem só a string do campo — sem nenhuma dependência
// de Customer — logo compatíveis e seguras para Empresas também). Não
// renomeado/movido nesta rodada: o contrato já é genérico o bastante.
const CONTACT_LINK_CLASSNAME =
  'text-brand-primary hover:text-brand-primary-dark focus-visible:ring-brand-accent rounded outline-none hover:underline focus-visible:ring-2'
const COMPANY_SEARCH_LISTBOX_ID = 'company-search-listbox'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

// Texto da coluna "Contato(s)" na LISTAGEM — "—" para "sem vínculo", igual
// às demais colunas vazias da tabela. O formulário usa um texto diferente
// ("Nenhum cliente vinculado") para o mesmo caso — ver CompanyForm.tsx.
function contactsCellText(status: ContactsStatus, names: string[]): string {
  if (status === 'loading') return 'Carregando contatos…'
  if (status === 'error') return 'Contato indisponível'
  return names.length > 0 ? names.join(', ') : '—'
}

// Uma linha "de exibição" pré-computada por empresa — os mesmos valores já
// normalizados/formatados que a tabela mostra (nunca o dado bruto do banco
// para WhatsApp/Instagram/Contato(s), por exigência explícita — ordenar
// pelo valor normalizado/exibido, não pelo texto cru gravado).
interface CompanyRow {
  company: Company
  contactsText: string
  contactsSortValue: string | null
  whatsappDisplay: string | null
  whatsappHref: string | null
  instagramDisplay: string | null
  instagramHref: string | null
  notes: string | null
}

function buildCompanyRow(
  company: Company,
  customersStatus: ContactsStatus,
  customerNamesByCompanyId: Map<string, string[]>,
): CompanyRow {
  const contactNames = customerNamesByCompanyId.get(company.id) ?? []
  const contactsText = contactsCellText(customersStatus, contactNames)
  const contactsSortValue = contactNames.length > 0 ? contactNames.join(', ') : null

  // Normalização só de APRESENTAÇÃO — nunca grava no banco. Dado antigo em
  // qualquer formato continua exatamente como está até ser editado/salvo
  // de novo pelo formulário; aqui só decidimos como MOSTRAR, se vira link,
  // e por qual valor ordenar (mesmo padrão de CustomersPage.tsx).
  const whatsappNormalized = company.whatsapp ? normalizeWhatsAppNumber(company.whatsapp) : ''
  const whatsappIsValid = isValidWhatsAppNumber(whatsappNormalized)
  const whatsappDisplay = whatsappIsValid ? formatWhatsAppForDisplay(whatsappNormalized) : (company.whatsapp ?? null)
  const whatsappHref = whatsappIsValid ? `https://wa.me/${whatsappNormalized.slice(1)}` : null

  const instagramNormalized = company.instagram ? normalizeInstagramHandle(company.instagram) : ''
  const instagramIsValid = isValidInstagramHandle(instagramNormalized)
  const instagramDisplay = instagramIsValid ? instagramNormalized : (company.instagram ?? null)
  const instagramHref = instagramIsValid ? `https://instagram.com/${instagramNormalized.slice(1)}` : null

  const notes = company.notes && company.notes.trim() ? company.notes : null

  return {
    company,
    contactsText,
    contactsSortValue,
    whatsappDisplay,
    whatsappHref,
    instagramDisplay,
    instagramHref,
    notes,
  }
}

type CompanySortColumn = 'name' | 'contacts' | 'whatsapp' | 'instagram' | 'notes' | 'is_active'

function getCompanySortValue(row: CompanyRow, column: CompanySortColumn): string | boolean | null {
  switch (column) {
    case 'name':
      return row.company.name
    case 'contacts':
      return row.contactsSortValue
    case 'whatsapp':
      return row.whatsappDisplay
    case 'instagram':
      return row.instagramDisplay
    case 'notes':
      return row.notes
    case 'is_active':
      return row.company.is_active
  }
}

export function CompaniesPage() {
  const { companies, isLoading, error, refetch, create, update } = useCompanies()
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const columnWidths = usePersistentColumnWidths(COMPANIES_TABLE_ID, userId, COMPANIES_COLUMN_SPECS)

  // Reaproveita a mesma consulta já usada em Clientes — só leitura aqui,
  // nunca create/update: o vínculo cliente↔empresa continua administrado
  // exclusivamente no módulo Clientes (CustomerForm/CustomersPage). Uma
  // única busca de TODOS os clientes, agrupada no frontend por company_id
  // (useMemo abaixo) — nunca uma consulta por empresa.
  const {
    customers,
    isLoading: isCustomersLoading,
    error: customersError,
    refetch: refetchCustomers,
  } = useCustomers()

  const customersStatus: ContactsStatus = isCustomersLoading ? 'loading' : customersError ? 'error' : 'ready'

  const customerNamesByCompanyId = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const customer of customers) {
      if (!customer.company_id) continue
      const names = map.get(customer.company_id) ?? []
      names.push(customer.name)
      map.set(customer.company_id, names)
    }
    // Ordem alfabética determinística — não depende da ordem de retorno da
    // consulta (já vem ordenada por nome, mas não confiamos nisso aqui).
    for (const names of map.values()) {
      names.sort((a, b) => a.localeCompare(b))
    }
    return map
  }, [customers])

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sort, setSort] = useState<SortState<CompanySortColumn> | null>(null)

  // Linhas de exibição pré-computadas — nunca modificam `companies` (o
  // array vindo do hook), sempre uma cópia derivada nova via .map.
  const rows = useMemo(
    () => companies.map((company) => buildCompanyRow(company, customersStatus, customerNamesByCompanyId)),
    [companies, customersStatus, customerNamesByCompanyId],
  )

  // Busca: só pelo nome (company.name), local sobre `rows` já carregadas —
  // nenhuma nova chamada a useCompanies/API a cada tecla digitada.
  const filteredRows = useMemo(() => {
    const term = normalizeForSearch(searchTerm)
    if (!term) return rows
    return rows.filter((row) => normalizeForSearch(row.company.name).includes(term))
  }, [rows, searchTerm])

  // Ordenação aplicada DEPOIS do filtro de busca (filtra primeiro, ordena o
  // resultado filtrado em seguida). Nunca muta `companies`/`rows` —
  // sortByColumn sempre retorna uma cópia nova.
  const sortedRows = useMemo(() => sortByColumn(filteredRows, sort, getCompanySortValue), [filteredRows, sort])

  // Sugestões do autocomplete: mesma lista já filtrada+ordenada que a
  // tabela mostra (respeita a ordenação visual ativa), deduplicada por
  // company.id — nunca duas sugestões idênticas quando a mesma referência
  // aparece repetida no array vindo do hook.
  const suggestions = useMemo(() => {
    const seenIds = new Set<string>()
    const result: Array<{ id: string; label: string }> = []
    for (const row of sortedRows) {
      if (seenIds.has(row.company.id)) continue
      seenIds.add(row.company.id)
      result.push({ id: row.company.id, label: row.company.name })
    }
    return result
  }, [sortedRows])

  function openCreateDialog() {
    setEditingCompany(null)
    setFormError(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(company: Company) {
    setEditingCompany(company)
    setFormError(null)
    setIsDialogOpen(true)
  }

  async function handleSubmit(values: CompanyFormValues) {
    setIsSubmitting(true)
    setFormError(null)
    try {
      if (editingCompany) {
        await update(editingCompany.id, values)
        toast.success('Empresa atualizada.')
      } else {
        await create(values)
        toast.success('Empresa cadastrada.')
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

  async function handleToggleActive(company: Company) {
    setPendingToggleId(company.id)
    try {
      await update(company.id, { is_active: !company.is_active })
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setPendingToggleId(null)
    }
  }

  return (
    <AppLayout>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium">Empresas</h1>
        <Button
          onClick={openCreateDialog}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
        >
          Nova empresa
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

      {/* Falha só nos CONTATOS (clientes) não esconde a listagem de
          empresas — cada linha mostra "Contato indisponível" na própria
          coluna; este banner só oferece um retry único e explícito. */}
      {customersError && (
        <div className="border-destructive/50 bg-destructive/10 mt-4 flex items-center justify-between rounded-lg border p-3 text-sm">
          <span>Não foi possível carregar os contatos vinculados às empresas.</span>
          <Button variant="outline" size="sm" onClick={refetchCustomers}>
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
        ariaLabel="Buscar empresa"
        placeholder="Buscar empresa..."
        clearLabel="Limpar busca"
        listboxId={COMPANY_SEARCH_LISTBOX_ID}
        listboxAriaLabel="Sugestões de empresa"
        noResultsText="Nenhuma empresa encontrada."
      />

      <div className="mt-3">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : companies.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma empresa cadastrada.</p>
        ) : sortedRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma empresa encontrada para esta busca.</p>
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
                {COMPANIES_COLUMN_SPECS.map((spec) => (
                  <col key={spec.id} style={{ width: columnWidths.getWidth(spec.id) }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <SortableColumnHeader
                    column="name"
                    label="Empresa"
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
                    column="contacts"
                    label="Contato(s)"
                    sort={sort}
                    onSortChange={setSort}
                    resize={{
                      width: columnWidths.getWidth('contacts'),
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
                {sortedRows.map(({ company, contactsText, whatsappDisplay, whatsappHref, instagramDisplay, instagramHref, notes }) => {
                  const contactNames = customerNamesByCompanyId.get(company.id) ?? []
                  return (
                    <TableRow
                      key={company.id}
                      // Zebra striping com a paleta Forma: linha ímpar usa
                      // --brand-primary-soft diluído (/50), par fica branca,
                      // hover usa o mesmo tom sem diluir — mesmo padrão já
                      // aprovado em Clientes/Produtos. Baseado na posição
                      // renderizada (nth-child via odd:/even:), então já
                      // reflete a ordem visual atual (busca + ordenação) sem
                      // nenhum cálculo extra.
                      className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft"
                    >
                      <TableCell className="truncate" title={company.name}>
                        {company.name}
                      </TableCell>
                      <TableCell className="truncate" title={contactNames.length > 0 ? contactNames.join(', ') : undefined}>
                        {contactsText}
                      </TableCell>
                      <TableCell className="truncate" title={whatsappDisplay ?? undefined}>
                        {whatsappHref ? (
                          <a
                            href={whatsappHref}
                            target="_blank"
                            rel="noreferrer"
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
                            rel="noreferrer"
                            className={CONTACT_LINK_CLASSNAME}
                            title={instagramDisplay ?? undefined}
                          >
                            {instagramDisplay}
                          </a>
                        ) : (
                          (instagramDisplay ?? '—')
                        )}
                      </TableCell>
                      <TableCell className="truncate" title={notes ?? undefined}>
                        {notes ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={company.is_active}
                          disabled={pendingToggleId === company.id}
                          onCheckedChange={() => void handleToggleActive(company)}
                          aria-label={`${company.is_active ? 'Desativar' : 'Ativar'} ${company.name}`}
                          className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(company)}
                          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                        >
                          Editar
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCompany ? 'Editar empresa' : 'Nova empresa'}</DialogTitle>
            <DialogDescription>
              {editingCompany ? 'Atualize os dados da empresa.' : 'Preencha os dados para cadastrar uma nova empresa.'}
            </DialogDescription>
          </DialogHeader>
          <CompanyForm
            key={editingCompany?.id ?? 'new'}
            initialValues={editingCompany ?? undefined}
            // Empresa nova nunca pode ter cliente vinculado ainda (não tem
            // id) — sempre "ready"/[] neste caso, independente do estado da
            // consulta de clientes. Editando, reflete o status real.
            contactsStatus={editingCompany ? customersStatus : 'ready'}
            contactNames={editingCompany ? (customerNamesByCompanyId.get(editingCompany.id) ?? []) : []}
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
