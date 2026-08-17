import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Company } from '@/types/domain'

// Sem campo "ativo": empresa nova nasce ativa pelo default do banco
// (companies.is_active not null default true) e ativar/desativar é sempre
// uma ação da listagem (CompaniesPage), nunca deste formulário — mesmo em
// modo de edição, para não duplicar o mesmo controle em dois lugares.
export interface CompanyFormValues {
  name: string
  trade_name: string | null
  document_number: string | null
  whatsapp: string | null
  instagram: string | null
  notes: string | null
}

interface CompanyFormProps {
  initialValues?: Company
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: CompanyFormValues) => void
  onCancel: () => void
}

export function CompanyForm({ initialValues, isSubmitting, submitError, onSubmit, onCancel }: CompanyFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [tradeName, setTradeName] = useState(initialValues?.trade_name ?? '')
  const [documentNumber, setDocumentNumber] = useState(initialValues?.document_number ?? '')
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
      trade_name: tradeName.trim() ? tradeName.trim() : null,
      document_number: documentNumber.trim() ? documentNumber.trim() : null,
      whatsapp: whatsapp.trim() ? whatsapp.trim() : null,
      instagram: instagram.trim() ? instagram.trim() : null,
      notes: notes.trim() ? notes.trim() : null,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="company-name">Nome</Label>
        <Input id="company-name" value={name} onChange={(event) => setName(event.target.value)} />
        {nameError && <p className="text-destructive text-sm">{nameError}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="company-trade-name">Nome fantasia</Label>
        <Input id="company-trade-name" value={tradeName} onChange={(event) => setTradeName(event.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="company-document-number">Documento</Label>
        <Input
          id="company-document-number"
          value={documentNumber}
          onChange={(event) => setDocumentNumber(event.target.value)}
        />
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
