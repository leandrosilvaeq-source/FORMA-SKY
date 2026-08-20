import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { CompanyForm, type CompanyFormValues, type ContactsStatus } from '@/components/companies/CompanyForm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCompanies } from '@/hooks/useCompanies'
import { useCustomers } from '@/hooks/useCustomers'
import { ApiError } from '@/lib/api/errors'
import {
  formatWhatsAppForDisplay,
  isValidInstagramHandle,
  isValidWhatsAppNumber,
  normalizeInstagramHandle,
  normalizeWhatsAppNumber,
} from '@/lib/forms/customerContact'
import type { Company } from '@/types/domain'

// Helpers de normalização/validação de contato reaproveitados de
// customerContact.ts (extraídos originalmente para Clientes, mas são
// funções puras que recebem só a string do campo — sem nenhuma dependência
// de Customer — logo compatíveis e seguras para Empresas também). Não
// renomeado/movido nesta rodada: o contrato já é genérico o bastante.
const CONTACT_LINK_CLASSNAME =
  'text-brand-primary hover:text-brand-primary-dark focus-visible:ring-brand-accent rounded outline-none hover:underline focus-visible:ring-2'

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

export function CompaniesPage() {
  const { companies, isLoading, error, refetch, create, update } = useCompanies()

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

      <div className="mt-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : companies.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma empresa cadastrada.</p>
        ) : (
          <Table className="table-fixed text-[16px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-auto w-[18%] py-2 whitespace-normal">Nome</TableHead>
                <TableHead className="h-auto w-[20%] py-2 whitespace-normal">Contato(s)</TableHead>
                <TableHead className="h-auto w-[13%] py-2 whitespace-normal">WhatsApp</TableHead>
                <TableHead className="h-auto w-[13%] py-2 whitespace-normal">Instagram</TableHead>
                <TableHead className="h-auto w-[19%] py-2 whitespace-normal">Observações</TableHead>
                <TableHead className="h-auto w-[7%] py-2 whitespace-normal">Ativo</TableHead>
                <TableHead className="h-auto w-[10%] py-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => {
                // Normalização só de APRESENTAÇÃO — nunca grava no banco.
                // Dado antigo em qualquer formato continua exatamente como
                // está até ser editado/salvo de novo pelo formulário; aqui só
                // decidimos como MOSTRAR e se vira link (mesmo padrão de
                // CustomersPage.tsx).
                const whatsappNormalized = company.whatsapp ? normalizeWhatsAppNumber(company.whatsapp) : ''
                const whatsappIsValid = isValidWhatsAppNumber(whatsappNormalized)
                const whatsappDisplay = whatsappIsValid
                  ? formatWhatsAppForDisplay(whatsappNormalized)
                  : (company.whatsapp ?? '—')

                const instagramNormalized = company.instagram ? normalizeInstagramHandle(company.instagram) : ''
                const instagramIsValid = isValidInstagramHandle(instagramNormalized)
                const instagramDisplay = instagramIsValid ? instagramNormalized : (company.instagram ?? '—')

                // null, vazio ou só espaços em branco viram "—" — nunca
                // tratados como "sem observação" de formas diferentes.
                const notesDisplay = company.notes && company.notes.trim() ? company.notes : '—'

                const contactNames = customerNamesByCompanyId.get(company.id) ?? []
                const contactsText = contactsCellText(customersStatus, contactNames)

                return (
                  <TableRow
                    key={company.id}
                    // Zebra striping com a paleta Forma: linha ímpar usa
                    // --brand-primary-soft diluído (/50), par fica branca,
                    // hover usa o mesmo tom sem diluir — mesmo padrão já
                    // aprovado em Clientes/Produtos.
                    className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft"
                  >
                    <TableCell className="truncate" title={company.name}>
                      {company.name}
                    </TableCell>
                    <TableCell className="truncate" title={contactNames.length > 0 ? contactNames.join(', ') : undefined}>
                      {contactsText}
                    </TableCell>
                    <TableCell className="truncate" title={whatsappDisplay !== '—' ? whatsappDisplay : undefined}>
                      {whatsappIsValid ? (
                        <a
                          href={`https://wa.me/${whatsappNormalized.slice(1)}`}
                          target="_blank"
                          rel="noreferrer"
                          className={CONTACT_LINK_CLASSNAME}
                          title={whatsappDisplay}
                        >
                          {whatsappDisplay}
                        </a>
                      ) : (
                        whatsappDisplay
                      )}
                    </TableCell>
                    <TableCell className="truncate" title={instagramDisplay !== '—' ? instagramDisplay : undefined}>
                      {instagramIsValid ? (
                        <a
                          href={`https://instagram.com/${instagramNormalized.slice(1)}`}
                          target="_blank"
                          rel="noreferrer"
                          className={CONTACT_LINK_CLASSNAME}
                          title={instagramDisplay}
                        >
                          {instagramDisplay}
                        </a>
                      ) : (
                        instagramDisplay
                      )}
                    </TableCell>
                    <TableCell className="truncate" title={notesDisplay !== '—' ? notesDisplay : undefined}>
                      {notesDisplay}
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
