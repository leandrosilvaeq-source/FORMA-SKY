import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Company, Customer, LeadSource } from '@/types/domain'

// Sem campo "ativo": cliente novo nasce ativo pelo default do banco
// (customers.is_active not null default true) e ativar/desativar é sempre
// uma ação da listagem (CustomersPage), nunca deste formulário — mesmo em
// modo de edição, para não duplicar o mesmo controle em dois lugares.
export interface CustomerFormValues {
  name: string
  whatsapp: string | null
  instagram: string | null
  company_id: string | null
  acquisition_source_id: string | null
  notes: string | null
}

interface CustomerFormProps {
  initialValues?: Customer
  companies: Company[]
  leadSources: LeadSource[]
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: CustomerFormValues) => void
  onCancel: () => void
}

export function CustomerForm({
  initialValues,
  companies,
  leadSources,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: CustomerFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [whatsapp, setWhatsapp] = useState(initialValues?.whatsapp ?? '')
  const [instagram, setInstagram] = useState(initialValues?.instagram ?? '')
  const [companyId, setCompanyId] = useState<string | null>(initialValues?.company_id ?? null)
  const [acquisitionSourceId, setAcquisitionSourceId] = useState<string | null>(
    initialValues?.acquisition_source_id ?? null,
  )
  const [notes, setNotes] = useState(initialValues?.notes ?? '')
  const [nameError, setNameError] = useState<string | null>(null)

  const companyItems = [
    { label: 'Nenhuma empresa', value: null as string | null },
    ...companies.map((company) => ({ label: company.name, value: company.id as string | null })),
  ]
  const leadSourceItems = [
    { label: 'Nenhuma origem', value: null as string | null },
    ...leadSources.map((source) => ({ label: source.name, value: source.id as string | null })),
  ]

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError('Informe o nome do cliente.')
      return
    }
    setNameError(null)

    onSubmit({
      name: trimmedName,
      whatsapp: whatsapp.trim() ? whatsapp.trim() : null,
      instagram: instagram.trim() ? instagram.trim() : null,
      company_id: companyId,
      acquisition_source_id: acquisitionSourceId,
      notes: notes.trim() ? notes.trim() : null,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-name">Nome</Label>
        <Input id="customer-name" value={name} onChange={(event) => setName(event.target.value)} />
        {nameError && <p className="text-destructive text-sm">{nameError}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-whatsapp">WhatsApp</Label>
        <Input id="customer-whatsapp" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-instagram">Instagram</Label>
        <Input id="customer-instagram" value={instagram} onChange={(event) => setInstagram(event.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-company">Empresa</Label>
        <Select items={companyItems} value={companyId} onValueChange={(value) => setCompanyId(value)}>
          <SelectTrigger id="customer-company" className="w-full">
            <SelectValue placeholder="Selecione uma empresa" />
          </SelectTrigger>
          <SelectContent>
            {companyItems.map((item) => (
              <SelectItem key={item.value ?? 'none'} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-lead-source">Origem</Label>
        <Select
          items={leadSourceItems}
          value={acquisitionSourceId}
          onValueChange={(value) => setAcquisitionSourceId(value)}
        >
          <SelectTrigger id="customer-lead-source" className="w-full">
            <SelectValue placeholder="Selecione uma origem" />
          </SelectTrigger>
          <SelectContent>
            {leadSourceItems.map((item) => (
              <SelectItem key={item.value ?? 'none'} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-notes">Observações</Label>
        <Textarea id="customer-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}
