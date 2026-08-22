import { useState, type FormEvent } from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { InstagramIcon, LeadSourcePicker, WhatsAppIcon } from '@/components/leadSources/LeadSourcePicker'
import { normalizeInstagramHandle, normalizeWhatsAppNumber, isValidWhatsAppNumber } from '@/lib/forms/customerContact'
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

  const instagramPreview = normalizeInstagramHandle(instagram)
  const whatsappPreview = normalizeWhatsAppNumber(whatsapp)

  function handleLeadSourceToggle(id: string) {
    setAcquisitionSourceId((current) => (current === id ? null : id))
  }

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
      whatsapp: normalizeWhatsAppNumber(whatsapp) || null,
      instagram: normalizeInstagramHandle(instagram) || null,
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
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <WhatsAppIcon className="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4" />
            <Input
              id="customer-whatsapp"
              className="pl-8"
              placeholder="(41) 99999-9999 ou cole um link wa.me"
              value={whatsapp}
              onChange={(event) => setWhatsapp(event.target.value)}
            />
          </div>
          {isValidWhatsAppNumber(whatsappPreview) && (
            <a
              href={`https://wa.me/${whatsappPreview.slice(1)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-primary hover:text-brand-primary-dark shrink-0"
              aria-label={`Abrir conversa no WhatsApp com ${whatsappPreview}`}
              title={`Abrir conversa no WhatsApp com ${whatsappPreview}`}
            >
              <ExternalLinkIcon className="size-4" />
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-instagram">Instagram</Label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <InstagramIcon className="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4" />
            <Input
              id="customer-instagram"
              className="pl-8"
              placeholder="@usuario ou cole o link do perfil"
              value={instagram}
              onChange={(event) => setInstagram(event.target.value)}
            />
          </div>
          {instagramPreview && (
            <a
              href={`https://instagram.com/${instagramPreview.slice(1)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-primary hover:text-brand-primary-dark shrink-0"
              aria-label={`Abrir perfil ${instagramPreview} do Instagram em nova aba`}
              title={`Abrir ${instagramPreview} no Instagram`}
            >
              <ExternalLinkIcon className="size-4" />
            </a>
          )}
        </div>
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
        {/* Texto visível, não um <label htmlFor> (o radiogroup — um <div>
            — não é um alvo válido de rotulagem HTML nativa, o mesmo motivo
            pelo qual "Entrou em contato por:" em OrderForm.tsx também é só
            texto solto, nunca um <label> associado). O nome acessível real
            do grupo vem do aria-label abaixo. Mesmo componente/padrão
            visual de "Entrou em contato por" — ver
            components/leadSources/LeadSourcePicker.tsx. */}
        <Label>Como nos conheceu:</Label>
        <LeadSourcePicker
          leadSources={leadSources}
          selectedId={acquisitionSourceId}
          onToggle={handleLeadSourceToggle}
          ariaLabel="Como nos conheceu"
          // Prefixo necessário aqui (e só aqui): este formulário também tem
          // campos de contato chamados "WhatsApp"/"Instagram" — sem o
          // prefixo, o nome acessível de uma origem colidiria com o nome
          // acessível do campo de contato homônimo.
          getOptionAriaLabel={(source) => `Como nos conheceu: ${source.name}`}
        />
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
