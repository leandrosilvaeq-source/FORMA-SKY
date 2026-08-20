import { useId, useState, type ComponentType, type FormEvent } from 'react'
import { EllipsisIcon, ExternalLinkIcon, UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { normalizeInstagramHandle, normalizeWhatsAppNumber, isValidWhatsAppNumber } from '@/lib/forms/customerContact'
import { cn } from '@/lib/utils'
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

// Duplicado de frontend/src/components/orders/OrderForm.tsx (mesmo padrão
// visual/semântico já aprovado para "Entrou em contato por") — cópia
// mínima intencional nesta rodada, não uma refatoração. Uma extração para
// um helper compartilhado (ex.: components/shared/leadSourceIcons.tsx)
// seria segura (funções puras, sem estado), mas amplia o escopo tocando
// OrderForm.tsx; ver ressalva no relatório final.
type IconComponent = ComponentType<{ className?: string }>

const LEAD_SOURCE_DISPLAY_ORDER = [
  'Indicação / boca a boca',
  'Instagram',
  'WhatsApp',
  'Facebook',
  'TikTok',
  'Outros',
]

function sortLeadSourcesForDisplay(sources: LeadSource[]): LeadSource[] {
  return [...sources].sort((a, b) => {
    const rankA = LEAD_SOURCE_DISPLAY_ORDER.indexOf(a.name)
    const rankB = LEAD_SOURCE_DISPLAY_ORDER.indexOf(b.name)
    const safeA = rankA === -1 ? LEAD_SOURCE_DISPLAY_ORDER.length : rankA
    const safeB = rankB === -1 ? LEAD_SOURCE_DISPLAY_ORDER.length : rankB
    return safeA - safeB
  })
}

function InstagramIcon({ className }: { className?: string }) {
  const gradientId = useId()
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={gradientId} cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#feda75" />
          <stop offset="25%" stopColor="#fa7e1e" />
          <stop offset="50%" stopColor="#d62976" />
          <stop offset="75%" stopColor="#962fbf" />
          <stop offset="100%" stopColor="#4f5bd5" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill={`url(#${gradientId})`} />
      <rect x="6.5" y="6.5" width="11" height="11" rx="3.5" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="17.8" cy="6.2" r="1.3" fill="#fff" />
    </svg>
  )
}
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#1877F2" className={className} aria-hidden="true">
      <path d="M13.5 21v-8.5H16l.5-3.5h-3V6.8c0-1 .3-1.8 1.8-1.8h2V1.8C16.9 1.7 15.7 1.6 14.4 1.6c-3 0-4.9 1.8-4.9 5.1v2.4H6.5V12h3v9h4Z" />
    </svg>
  )
}
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#25D366" className={className} aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.2-.7.8-.8 1-.2.2-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.4 7.4 0 0 1-1.4-1.7c-.1-.2 0-.4.1-.5l.4-.4c.1-.1.2-.3.2-.4a.5.5 0 0 0 0-.5c-.1-.1-.6-1.4-.8-1.9-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.6 1.1 2.8.1.2 2 3 4.8 4.2a16 16 0 0 0 1.6.6c.7.2 1.3.2 1.8.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.4-.3Z" />
    </svg>
  )
}
function TikTokIcon({ className }: { className?: string }) {
  const notePath =
    'M16.6 5.8a4.8 4.8 0 0 1-3.8-4.7h-3.4v14.6a2.9 2.9 0 1 1-2-2.7v-3.5a6.3 6.3 0 1 0 5.4 6.2V9.4a8.1 8.1 0 0 0 4.7 1.5V7.5a4.8 4.8 0 0 1-.9-1.7Z'
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={notePath} fill="#25F4EE" transform="translate(-0.8 -0.8)" />
      <path d={notePath} fill="#FE2C55" transform="translate(0.8 0.8)" />
      <path d={notePath} fill="#000" />
    </svg>
  )
}

interface LeadSourceIconConfig {
  Icon: IconComponent
  className?: string
}

const LEAD_SOURCE_ICONS: Record<string, LeadSourceIconConfig> = {
  'Indicação / boca a boca': { Icon: UsersIcon, className: 'text-brand-primary' },
  Instagram: { Icon: InstagramIcon },
  WhatsApp: { Icon: WhatsAppIcon },
  Facebook: { Icon: FacebookIcon },
  TikTok: { Icon: TikTokIcon },
  Outros: { Icon: EllipsisIcon, className: 'text-brand-primary' },
}
const DEFAULT_LEAD_SOURCE_ICON: LeadSourceIconConfig = { Icon: EllipsisIcon, className: 'text-brand-primary' }

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
  // Só origens ativas podem ser escolhidas num cliente novo/editado — mesmo
  // filtro já aplicado em OrderForm para "Entrou em contato por".
  const activeLeadSources = sortLeadSourcesForDisplay(leadSources.filter((source) => source.is_active))

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
        <Label htmlFor="customer-lead-source">Origem</Label>
        <div id="customer-lead-source" role="radiogroup" aria-label="Origem" className="flex flex-wrap gap-1.5">
          {activeLeadSources.map((source) => {
            const { Icon, className: iconClassName } = LEAD_SOURCE_ICONS[source.name] ?? DEFAULT_LEAD_SOURCE_ICON
            const selected = acquisitionSourceId === source.id
            return (
              <button
                key={source.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleLeadSourceToggle(source.id)}
                className={cn(
                  'focus-visible:ring-brand-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                  selected
                    ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                    : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className={cn('size-5 shrink-0', iconClassName)} />
                {source.name}
              </button>
            )
          })}
        </div>
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
