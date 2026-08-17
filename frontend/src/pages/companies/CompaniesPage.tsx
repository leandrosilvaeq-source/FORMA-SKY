import { useState } from 'react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { CompanyForm, type CompanyFormValues } from '@/components/companies/CompanyForm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCompanies } from '@/hooks/useCompanies'
import { ApiError } from '@/lib/api/errors'
import type { Company } from '@/types/domain'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

export function CompaniesPage() {
  const { companies, isLoading, error, refetch, create, update } = useCompanies()

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
        <Button onClick={openCreateDialog}>Nova empresa</Button>
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
        ) : companies.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma empresa cadastrada.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Nome fantasia</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Instagram</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>{company.name}</TableCell>
                  <TableCell>{company.trade_name ?? '—'}</TableCell>
                  <TableCell>{company.document_number ?? '—'}</TableCell>
                  <TableCell>{company.whatsapp ?? '—'}</TableCell>
                  <TableCell>{company.instagram ?? '—'}</TableCell>
                  <TableCell>
                    <Switch
                      checked={company.is_active}
                      disabled={pendingToggleId === company.id}
                      onCheckedChange={() => void handleToggleActive(company)}
                      aria-label={company.is_active ? 'Desativar empresa' : 'Ativar empresa'}
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => openEditDialog(company)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
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
