import { useId, type ComponentType } from 'react'
import { EllipsisIcon, UsersIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LeadSource } from '@/types/domain'

// Extraído de frontend/src/components/orders/OrderForm.tsx ("Entrou em
// contato por") — único dono do padrão visual/semântico de origem/lead
// source no projeto. frontend/src/components/customers/CustomerForm.tsx
// ("Como nos conheceu:") reutiliza este mesmo componente, agora com um só
// lugar para manter ícones/ordem/rótulos, em vez da cópia duplicada que
// existia antes. Nenhuma lógica de negócio (estado selecionado, payload)
// vive aqui — só apresentação; cada formulário continua dono do próprio
// estado (leadSourceId/acquisitionSourceId) e decide o que fazer com o id
// selecionado.

export type IconComponent = ComponentType<{ className?: string }>

// lucide-react (^1.31.0) não inclui ícones de marca de rede social (conferido
// diretamente no pacote: nenhum Instagram/Facebook/WhatsApp/TikTok entre os
// 6068 ícones exportados) — SVGs inline mínimos só para essas 4 marcas, sem
// adicionar dependência nova. Usam as cores oficiais de cada marca (não a
// paleta Forma — só o estado selecionado do botão ao redor usa
// --brand-primary/-dark/-soft) no mesmo formato de componente (className)
// dos ícones lucide usados ao lado deles. Exportados porque
// CustomerForm.tsx também os usa diretamente nos campos de contato
// WhatsApp/Instagram (fora do picker de origem).
export function InstagramIcon({ className }: { className?: string }) {
  // Gradiente característico da marca (aproximação amplamente usada do
  // gradiente oficial do Instagram) — id único via useId() para não colidir
  // caso o componente seja renderizado mais de uma vez na mesma página.
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
export function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#1877F2" className={className} aria-hidden="true">
      <path d="M13.5 21v-8.5H16l.5-3.5h-3V6.8c0-1 .3-1.8 1.8-1.8h2V1.8C16.9 1.7 15.7 1.6 14.4 1.6c-3 0-4.9 1.8-4.9 5.1v2.4H6.5V12h3v9h4Z" />
    </svg>
  )
}
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#25D366" className={className} aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.2-.7.8-.8 1-.2.2-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.4 7.4 0 0 1-1.4-1.7c-.1-.2 0-.4.1-.5l.4-.4c.1-.1.2-.3.2-.4a.5.5 0 0 0 0-.5c-.1-.1-.6-1.4-.8-1.9-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.6 1.1 2.8.1.2 2 3 4.8 4.2a16 16 0 0 0 1.6.6c.7.2 1.3.2 1.8.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.4-.3Z" />
    </svg>
  )
}
// Efeito "glitch" característico da marca: a mesma nota musical desenhada 3
// vezes, deslocada em ciano e vermelho/rosa por trás, preta por cima —
// exatamente como o logo oficial do TikTok é construído.
export function TikTokIcon({ className }: { className?: string }) {
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
  // Só as origens sem marca própria (Indicação/Outros) usam a cor Forma no
  // ícone — Instagram/WhatsApp/Facebook/TikTok já carregam a cor oficial da
  // marca no próprio desenho (fill fixo/gradiente), então não recebem esta
  // classe.
  className?: string
}

// Ícone por origem, indexado pelo nome real de public.lead_sources (nunca
// pelo id, que é gerado — se um nome não estiver mapeado, cai no ícone
// genérico de "outros" em vez de quebrar a renderização). Nomes/IDs
// persistidos no banco não são alterados por causa disso — só a
// apresentação visual.
const LEAD_SOURCE_ICONS: Record<string, LeadSourceIconConfig> = {
  'Indicação / boca a boca': { Icon: UsersIcon, className: 'text-brand-primary' },
  Instagram: { Icon: InstagramIcon },
  WhatsApp: { Icon: WhatsAppIcon },
  Facebook: { Icon: FacebookIcon },
  TikTok: { Icon: TikTokIcon },
  Outros: { Icon: EllipsisIcon, className: 'text-brand-primary' },
}
const DEFAULT_LEAD_SOURCE_ICON: LeadSourceIconConfig = { Icon: EllipsisIcon, className: 'text-brand-primary' }

// Rótulo abreviado só para exibição visual (caber em uma linha em desktop)
// — indexado pelo nome real, nunca substitui source.name no aria-label, no
// payload (o id selecionado continua sendo source.id) ou em qualquer outro
// lugar. Origens sem entrada aqui mostram o nome completo normalmente.
const LEAD_SOURCE_SHORT_LABELS: Record<string, string> = {
  'Indicação / boca a boca': 'Indicação',
}

// Ordem de exibição aprovada — nomes reais de public.lead_sources
// (supabase/migrations/20260813194021_create_lookup_tables.sql). Só
// reordena no frontend; nenhum registro é criado/alterado no banco.
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

export interface LeadSourcePickerProps {
  id?: string
  leadSources: LeadSource[]
  selectedId: string | null
  onToggle: (id: string) => void
  ariaLabel: string
  disabled?: boolean
  // Nome acessível de cada botão — por padrão, o próprio nome da origem
  // (mesmo comportamento já validado em OrderForm.tsx, nunca alterado por
  // este parâmetro opcional). CustomerForm.tsx sobrescreve com um prefixo
  // ("Como nos conheceu: WhatsApp") porque o mesmo formulário também tem
  // campos de contato literalmente chamados "WhatsApp"/"Instagram" — sem
  // o prefixo, getByLabelText(/whatsapp/i) (usado pelos testes desses
  // campos de contato, que este trabalho não deve tocar) passaria a casar
  // também com o botão de origem, quebrando uma busca que antes era única.
  getOptionAriaLabel?: (source: LeadSource) => string
}

// Cards verticais (ícone grande em cima, nome embaixo, conteúdo
// centralizado). w-20/h-20 fixos mantêm largura/altura uniformes entre os
// cards; flex-wrap deixa quebrar para a linha seguinte em telas estreitas,
// sem overflow horizontal. Só origens ativas (source.is_active) aparecem —
// uma origem desativada nunca pode ser escolhida num cliente/pedido novo ou
// editado, mesmo que já estivesse associada antes de ser desativada (nesse
// caso ela simplesmente não aparece entre as opções, sem alterar o valor já
// persistido).
export function LeadSourcePicker({
  id,
  leadSources,
  selectedId,
  onToggle,
  ariaLabel,
  disabled = false,
  getOptionAriaLabel = (source) => source.name,
}: LeadSourcePickerProps) {
  const activeLeadSources = sortLeadSourcesForDisplay(leadSources.filter((source) => source.is_active))

  return (
    <div id={id} role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {activeLeadSources.map((source) => {
        const { Icon, className: iconClassName } = LEAD_SOURCE_ICONS[source.name] ?? DEFAULT_LEAD_SOURCE_ICON
        // Rótulo visível abreviado só para "Indicação / boca a boca" (o
        // mais longo, responsável pela quebra de linha em desktop) —
        // aria-label preserva o nome real completo como nome acessível,
        // mesmo com o texto na tela encurtado. Nome/ID persistidos no
        // banco (source.id, usado em onToggle/payload) continuam intocados.
        const displayLabel = LEAD_SOURCE_SHORT_LABELS[source.name] ?? source.name
        const selected = selectedId === source.id
        return (
          <button
            key={source.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={getOptionAriaLabel(source)}
            disabled={disabled}
            onClick={() => onToggle(source.id)}
            className={cn(
              'focus-visible:ring-brand-accent flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border p-1.5 text-center transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                : 'border-input bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className={cn('size-8 shrink-0', iconClassName)} />
            <span className="line-clamp-1 text-xs leading-tight font-medium">{displayLabel}</span>
          </button>
        )
      })}
    </div>
  )
}
