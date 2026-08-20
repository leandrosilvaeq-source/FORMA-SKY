import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { CustomerForm, type CustomerFormValues } from '@/components/customers/CustomerForm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCompanies } from '@/hooks/useCompanies'
import { useCustomers } from '@/hooks/useCustomers'
import { useLeadSources } from '@/hooks/useLeadSources'
import { ApiError } from '@/lib/api/errors'
import {
  formatWhatsAppForDisplay,
  isValidInstagramHandle,
  isValidWhatsAppNumber,
  normalizeInstagramHandle,
  normalizeWhatsAppNumber,
} from '@/lib/forms/customerContact'
import type { Customer } from '@/types/domain'

const CONTACT_LINK_CLASSNAME = 'text-brand-primary hover:text-brand-primary-dark hover:underline'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

export function CustomersPage() {
  const { customers, isLoading, error, refetch, create, update } = useCustomers()
  const { companies } = useCompanies()
  const { leadSources } = useLeadSources()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)

  // Nomes de empresa/origem resolvidos a partir dos dados já carregados por
  // useCompanies/useLeadSources — nenhuma consulta nova, nunca exibe UUID.
  const companyNameById = useMemo(() => new Map(companies.map((company) => [company.id, company.name])), [companies])
  const leadSourceNameById = useMemo(
    () => new Map(leadSources.map((source) => [source.id, source.name])),
    [leadSources],
  )

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

      <div className="mt-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : customers.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum cliente cadastrado.</p>
        ) : (
          <Table className="table-fixed text-[16px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-auto w-[22%] py-2 whitespace-normal">Nome</TableHead>
                <TableHead className="h-auto w-[18%] py-2 whitespace-normal">Empresa</TableHead>
                <TableHead className="h-auto w-[13%] py-2 whitespace-normal">WhatsApp</TableHead>
                <TableHead className="h-auto w-[13%] py-2 whitespace-normal">Instagram</TableHead>
                <TableHead className="h-auto w-[16%] py-2 whitespace-normal">Como nos conheceu</TableHead>
                <TableHead className="h-auto w-[8%] py-2 whitespace-normal">Ativo</TableHead>
                <TableHead className="h-auto w-[10%] py-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => {
                const companyName = customer.company_id ? (companyNameById.get(customer.company_id) ?? '—') : '—'
                const leadSourceName = customer.acquisition_source_id
                  ? (leadSourceNameById.get(customer.acquisition_source_id) ?? '—')
                  : '—'

                // Normalização só de APRESENTAÇÃO — nunca grava no banco.
                // Dado antigo em qualquer formato continua exatamente como
                // está até ser editado/salvo de novo; aqui só decidimos como
                // MOSTRAR e se vira link.
                const whatsappNormalized = customer.whatsapp ? normalizeWhatsAppNumber(customer.whatsapp) : ''
                const whatsappIsValid = isValidWhatsAppNumber(whatsappNormalized)
                const whatsappDisplay = whatsappIsValid
                  ? formatWhatsAppForDisplay(whatsappNormalized)
                  : (customer.whatsapp ?? '—')

                const instagramNormalized = customer.instagram ? normalizeInstagramHandle(customer.instagram) : ''
                const instagramIsValid = isValidInstagramHandle(instagramNormalized)
                const instagramDisplay = instagramIsValid ? instagramNormalized : (customer.instagram ?? '—')

                return (
                  <TableRow
                    key={customer.id}
                    // Zebra striping sutil com a paleta Forma: linha par usa
                    // --brand-primary-soft bem diluído (/50), ímpar fica no
                    // fundo neutro padrão, hover usa o mesmo tom sem diluir
                    // (mais perceptível, ainda dentro da paleta, nunca roxo
                    // forte/gradiente).
                    className="odd:bg-background even:bg-brand-primary-soft/50 hover:bg-brand-primary-soft"
                  >
                    <TableCell className="truncate" title={customer.name}>
                      {customer.name}
                    </TableCell>
                    <TableCell className="truncate" title={companyName !== '—' ? companyName : undefined}>
                      {companyName}
                    </TableCell>
                    <TableCell className="truncate" title={whatsappDisplay !== '—' ? whatsappDisplay : undefined}>
                      {whatsappIsValid ? (
                        <a
                          href={`https://wa.me/${whatsappNormalized.slice(1)}`}
                          target="_blank"
                          rel="noopener noreferrer"
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
                          rel="noopener noreferrer"
                          className={CONTACT_LINK_CLASSNAME}
                          title={instagramDisplay}
                        >
                          {instagramDisplay}
                        </a>
                      ) : (
                        instagramDisplay
                      )}
                    </TableCell>
                    <TableCell className="truncate" title={leadSourceName !== '—' ? leadSourceName : undefined}>
                      {leadSourceName}
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(customer)}
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
            <DialogTitle>{editingCustomer ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
            <DialogDescription>
              {editingCustomer ? 'Atualize os dados do cliente.' : 'Preencha os dados para cadastrar um novo cliente.'}
            </DialogDescription>
          </DialogHeader>
          <CustomerForm
            key={editingCustomer?.id ?? 'new'}
            initialValues={editingCustomer ?? undefined}
            companies={companies}
            leadSources={leadSources}
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
