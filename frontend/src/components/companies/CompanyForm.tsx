import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { normalizeInstagramHandle, normalizeWhatsAppNumber } from '@/lib/forms/customerContact'
import type { Company } from '@/types/domain'

const CANCEL_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark'
const SAVE_BUTTON_CLASSNAME = 'bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark'

// Sem campo "ativo": empresa nova nasce ativa pelo default do banco
// (companies.is_active not null default true) e ativar/desativar é sempre
// uma ação da listagem (CompaniesPage), nunca deste formulário — mesmo em
// modo de edição, para não duplicar o mesmo controle em dois lugares.
//
// Sem campos "nome fantasia" e "documento" (removidos da interface, não do
// domínio — regra aprovada: só os campos que aparecem no formulário
// aparecem na listagem). O formulário nunca lê nem envia trade_name/
// document_number — em handleSubmit as duas chaves são omitidas do objeto
// por completo, nunca enviadas como null nem string vazia. update()/
// createCompany() só escrevem as colunas presentes no payload
// (lib/api/companies.ts, UpdateCompanyInput/CreateCompanyInput já têm as
// duas opcionais), então omitir as chaves preserva os valores já gravados
// no banco sem tocá-los — nunca apaga/sobrescreve um nome fantasia ou
// documento existente ao editar outros campos, e nunca inventa um valor ao
// criar uma empresa nova.
export interface CompanyFormValues {
  name: string
  trade_name?: string | null
  document_number?: string | null
  whatsapp: string | null
  instagram: string | null
  notes: string | null
}

// "Contato(s)" é informação somente de leitura, derivada dos clientes cujo
// company_id aponta para esta empresa — o vínculo continua administrado
// exclusivamente no módulo Clientes (CustomerForm/CustomersPage). Este
// formulário nunca lê nem grava esse vínculo: contactsStatus/contactNames
// só chegam prontos (já resolvidos) via prop, calculados uma vez em
// CompaniesPage.tsx a partir de useCustomers() — nunca uma consulta nova
// por empresa. 'loading'/'error' distinguem "ainda não sei" de "sei que não
// há ninguém vinculado" (só este último mostra "Nenhum cliente vinculado").
export type ContactsStatus = 'loading' | 'error' | 'ready'

interface CompanyFormProps {
  initialValues?: Company
  contactsStatus: ContactsStatus
  contactNames: string[]
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: CompanyFormValues) => void
  onCancel: () => void
}

function contactsDisplayText(status: ContactsStatus, names: string[]): string {
  if (status === 'loading') return 'Carregando contatos…'
  if (status === 'error') return 'Contato indisponível'
  return names.length > 0 ? names.join(', ') : 'Nenhum cliente vinculado'
}

export function CompanyForm({
  initialValues,
  contactsStatus,
  contactNames,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: CompanyFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [whatsapp, setWhatsapp] = useState(initialValues?.whatsapp ?? '')
  const [instagram, setInstagram] = useState(initialValues?.instagram ?? '')
  const [notes, setNotes] = useState(initialValues?.notes ?? '')
  const [nameError, setNameError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError('Informe o nome da empresa.')
      return
    }
    setNameError(null)

    onSubmit({
      name: trimmedName,
      // trade_name/document_number nunca são incluídos aqui de propósito —
      // ver comentário em CompanyFormValues.
      //
      // WhatsApp/Instagram seguem exatamente o mesmo comportamento de
      // Clientes (CustomerForm.tsx): só normalizam, nunca bloqueiam o envio.
      whatsapp: normalizeWhatsAppNumber(whatsapp) || null,
      instagram: normalizeInstagramHandle(instagram) || null,
      notes: notes.trim() ? notes.trim() : null,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="company-name">Nome</Label>
        <Input
          id="company-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'company-name-error' : undefined}
        />
        {nameError && (
          <p id="company-name-error" className="text-destructive text-sm">
            {nameError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="company-whatsapp">WhatsApp</Label>
        <Input id="company-whatsapp" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="company-instagram">Instagram</Label>
        <Input id="company-instagram" value={instagram} onChange={(event) => setInstagram(event.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="company-notes">Observações</Label>
        <Textarea id="company-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Contato(s)</Label>
        <p className="text-sm font-medium">{contactsDisplayText(contactsStatus, contactNames)}</p>
        <p className="text-muted-foreground text-xs">Os vínculos são administrados no módulo Clientes.</p>
      </div>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className={CANCEL_BUTTON_CLASSNAME}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting} className={SAVE_BUTTON_CLASSNAME}>
          {isSubmitting ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}
