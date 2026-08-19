import { Fragment, useId, useState, type ComponentType, type FormEvent, type ReactNode } from 'react'
import { EllipsisIcon, HandIcon, MinusIcon, PackageIcon, PlusIcon, Trash2Icon, TruckIcon, UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { parseNumberField } from '@/lib/forms/numberField'
import type { CreateOrderInput, OrderItemInput } from '@/lib/api/orders'
import type { Company, Customer, LeadSource, Product } from '@/types/domain'

type SaleType = 'B2C' | 'B2B'
type DeliveryMethod = 'Em mãos' | 'Correios' | 'Transportadora'

const SALE_TYPE_ITEMS: Array<{ label: string; value: SaleType }> = [
  { label: 'B2C', value: 'B2C' },
  { label: 'B2B', value: 'B2B' },
]

const DELIVERY_METHODS: DeliveryMethod[] = ['Em mãos', 'Correios', 'Transportadora']

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

type IconComponent = ComponentType<{ className?: string }>

// lucide-react (^1.31.0) não inclui ícones de marca de rede social (conferido
// diretamente no pacote: nenhum Instagram/Facebook/WhatsApp/TikTok entre os
// 6068 ícones exportados) — SVGs inline mínimos só para essas 4 marcas, sem
// adicionar dependência nova. Usam as cores oficiais de cada marca (não a
// paleta Forma — só o estado selecionado do botão ao redor usa
// --brand-primary/-dark/-soft) no mesmo formato de componente (className)
// dos ícones lucide usados ao lado deles.
function InstagramIcon({ className }: { className?: string }) {
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
// Efeito "glitch" característico da marca: a mesma nota musical desenhada 3
// vezes, deslocada em ciano e vermelho/rosa por trás, preta por cima —
// exatamente como o logo oficial do TikTok é construído.
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
// payload (lead_source_id continua sendo source.id) ou em qualquer outro
// lugar. Origens sem entrada aqui mostram o nome completo normalmente.
const LEAD_SOURCE_SHORT_LABELS: Record<string, string> = {
  'Indicação / boca a boca': 'Indicação',
}

const DELIVERY_METHOD_ICONS: Record<DeliveryMethod, IconComponent> = {
  'Em mãos': HandIcon,
  Correios: PackageIcon,
  Transportadora: TruckIcon,
}

function sortLeadSourcesForDisplay(sources: LeadSource[]): LeadSource[] {
  return [...sources].sort((a, b) => {
    const rankA = LEAD_SOURCE_DISPLAY_ORDER.indexOf(a.name)
    const rankB = LEAD_SOURCE_DISPLAY_ORDER.indexOf(b.name)
    const safeA = rankA === -1 ? LEAD_SOURCE_DISPLAY_ORDER.length : rankA
    const safeB = rankB === -1 ? LEAD_SOURCE_DISPLAY_ORDER.length : rankB
    return safeA - safeB
  })
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Linha compacta padrão do formulário: rótulo numerado à esquerda, controle
// à direita, os dois na mesma linha sempre que houver largura (quebra só em
// telas estreitas, via flex-wrap). Erro de validação, quando presente,
// aparece abaixo da borda — nunca reserva espaço quando não há erro.
function SectionRow({
  number,
  label,
  children,
  error,
  className,
}: {
  number: number
  label: string
  children: ReactNode
  error?: string | null
  className?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          'border-input flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border px-3 py-1.5',
          className,
        )}
      >
        <span className="text-sm font-medium sm:w-52 sm:shrink-0">
          {number}. {label}
        </span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {error && <p className="text-destructive px-3 text-xs">{error}</p>}
    </div>
  )
}

interface ItemRow {
  key: string
  productId: string | null
  quantity: string
  unitPrice: string
  personalizationFee: string
}

let rowKeySeq = 0
function nextRowKey(): string {
  rowKeySeq += 1
  return `item-${rowKeySeq}`
}

function emptyRow(): ItemRow {
  // quantity nasce em '1' (nunca vazia): tanto a linha inicial do formulário
  // quanto qualquer linha criada por "Adicionar item" já começam com a
  // quantidade mínima válida, sem exigir um clique em "+" antes de valer 1.
  return { key: nextRowKey(), productId: null, quantity: '1', unitPrice: '', personalizationFee: '' }
}

// Preview local do total da linha (mesma fórmula usada em validateItems, sem
// o termo de desconto — removido da interface nesta rodada). Puramente
// apresentacional: o total real de cada order_item continua sendo a coluna
// gerada total_price no banco, nunca recalculada aqui como fonte da verdade.
function computeRowTotal(row: ItemRow): number {
  const quantity = Number.parseFloat(row.quantity)
  const unitPrice = Number.parseFloat(row.unitPrice)
  const fee = Number.parseFloat(row.personalizationFee)
  const q = Number.isFinite(quantity) ? quantity : 0
  const p = Number.isFinite(unitPrice) ? unitPrice : 0
  const f = Number.isFinite(fee) ? fee : 0
  return q * p + f
}

interface OrderFormProps {
  customers: Customer[]
  companies: Company[]
  leadSources: LeadSource[]
  products: Product[]
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: CreateOrderInput) => void
  onCancel: () => void
}

export function OrderForm({
  customers,
  companies,
  leadSources,
  products,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: OrderFormProps) {
  const [saleType, setSaleType] = useState<SaleType>('B2C')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [leadSourceId, setLeadSourceId] = useState<string | null>(null)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | ''>('')
  const [shippingCost, setShippingCost] = useState('')
  const [items, setItems] = useState<ItemRow[]>([emptyRow()])

  const [headerErrors, setHeaderErrors] = useState<Record<string, string>>({})
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({})

  // Só ativos podem ser escolhidos para um pedido novo — nenhum destes
  // filtros muta customers/companies/leadSources/products (props originais
  // preservados intactos, só as listas locais de opção são reduzidas).
  const activeProducts = products.filter((product) => product.is_active)
  const activeCustomers = customers.filter((customer) => customer.is_active)
  const activeCompanies = companies.filter((company) => company.is_active)
  const activeLeadSources = sortLeadSourcesForDisplay(leadSources.filter((source) => source.is_active))

  const customerItems = activeCustomers.map((customer) => ({
    label: customer.name,
    value: customer.id as string | null,
  }))
  const companyItems = [
    { label: 'Nenhuma empresa', value: null as string | null },
    ...activeCompanies.map((company) => ({ label: company.name, value: company.id as string | null })),
  ]

  const showShipping = deliveryMethod === 'Correios' || deliveryMethod === 'Transportadora'

  // Numeração visual das seções: recalculada a cada render para continuar
  // coerente com o layout quando Empresa (só B2B) ou Frete (só
  // Correios/Transportadora) entram/saem de cena — nunca deixa buraco na
  // sequência.
  let sectionNumber = 1
  const saleTypeSectionNumber = sectionNumber++
  const itemTypeSectionNumber = sectionNumber++
  const companySectionNumber = saleType === 'B2B' ? sectionNumber++ : null
  const customerSectionNumber = sectionNumber++
  const leadSourceSectionNumber = sectionNumber++
  const itemsSectionNumber = sectionNumber++
  const deliverySectionNumber = sectionNumber++
  // Última seção numerada — nenhum incremento necessário depois desta.
  const shippingSectionNumber = showShipping ? sectionNumber : null

  // Ao sair de B2B, limpa companyId — garante que uma empresa escolhida
  // antes não fique "fantasma" no estado se o usuário voltar para B2B
  // depois. customerId nunca é tocado aqui: continua obrigatório e válido
  // nos dois modos, sem relação alguma com o tipo de venda.
  function handleSaleTypeChange(value: SaleType) {
    setSaleType(value)
    if (value === 'B2C') setCompanyId(null)
  }

  function handleDeliveryMethodChange(value: DeliveryMethod) {
    setDeliveryMethod(value)
    // Ao voltar para "Em mãos", limpa o valor de frete do estado — o
    // submit já força shipping_cost: null quando o campo está escondido,
    // esta linha só evita que um valor digitado antes reapareça
    // "fantasma" se o usuário voltar para Correios/Transportadora depois.
    if (value === 'Em mãos') setShippingCost('')
  }

  function handleLeadSourceToggle(id: string) {
    setLeadSourceId((current) => (current === id ? null : id))
  }

  function addItemRow() {
    setItems((rows) => [...rows, emptyRow()])
  }
  function removeItemRow(key: string) {
    setItems((rows) => (rows.length > 1 ? rows.filter((row) => row.key !== key) : rows))
  }
  function updateItemRow(key: string, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function incrementQuantity(key: string) {
    setItems((rows) =>
      rows.map((row) => {
        if (row.key !== key) return row
        const current = Number.parseInt(row.quantity, 10)
        const next = Number.isInteger(current) && current > 0 ? current + 1 : 1
        return { ...row, quantity: String(next) }
      }),
    )
  }
  function decrementQuantity(key: string) {
    setItems((rows) =>
      rows.map((row) => {
        if (row.key !== key) return row
        const current = Number.parseInt(row.quantity, 10)
        const next = Number.isInteger(current) ? Math.max(1, current - 1) : 1
        return { ...row, quantity: String(next) }
      }),
    )
  }

  function handleProductChange(key: string, productId: string | null) {
    const product = productId ? activeProducts.find((item) => item.id === productId) : undefined
    updateItemRow(key, {
      productId,
      // "ao selecionar produto, preencher inicialmente unit_price com
      // default_price, mas permitir edição": refeito a cada seleção de
      // produto (inclusive troca de produto numa linha já preenchida),
      // nunca mais tocado depois disso.
      unitPrice: product ? String(product.default_price) : '',
    })
  }

  function validateItems(): { items: OrderItemInput[]; errors: Record<string, string> } {
    const errors: Record<string, string> = {}
    const validated: OrderItemInput[] = []

    for (const row of items) {
      if (!row.productId) {
        errors[row.key] = 'Selecione um produto.'
        continue
      }
      const product = activeProducts.find((item) => item.id === row.productId)
      if (!product) {
        errors[row.key] = 'Produto inválido ou inativo — selecione outro.'
        continue
      }

      const quantity = parseNumberField(row.quantity, 'A quantidade', { required: true, integer: true, min: 1 })
      if (quantity.error) {
        errors[row.key] = quantity.error
        continue
      }

      const unitPrice = parseNumberField(row.unitPrice, 'O preço unitário', { required: true, min: 0 })
      if (unitPrice.error) {
        errors[row.key] = unitPrice.error
        continue
      }

      const personalizationFee = parseNumberField(row.personalizationFee, 'A taxa de personalização', { min: 0 })
      if (personalizationFee.error) {
        errors[row.key] = personalizationFee.error
        continue
      }

      validated.push({
        item_type: 'CATALOG',
        product_id: row.productId,
        item_name: product.name,
        quantity: quantity.value as number,
        unit_price: unitPrice.value as number,
        ...(personalizationFee.value !== undefined ? { personalization_fee: personalizationFee.value } : {}),
      })
    }

    return { items: validated, errors }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const newHeaderErrors: Record<string, string> = {}
    if (!customerId) newHeaderErrors.customer_id = 'Selecione um cliente.'
    if (saleType === 'B2B' && !companyId) newHeaderErrors.company_id = 'Selecione uma empresa.'

    let shippingCostField: ReturnType<typeof parseNumberField> = { value: undefined, error: null }
    if (showShipping) {
      shippingCostField = parseNumberField(shippingCost, 'O frete', { min: 0 })
      if (shippingCostField.error) newHeaderErrors.shipping_cost = shippingCostField.error
    }

    const { items: validatedItems, errors: newItemErrors } = validateItems()

    if (Object.keys(newHeaderErrors).length > 0 || Object.keys(newItemErrors).length > 0) {
      setHeaderErrors(newHeaderErrors)
      setItemErrors(newItemErrors)
      return
    }
    setHeaderErrors({})
    setItemErrors({})

    onSubmit({
      customer_id: customerId as string,
      // Força null em B2C independente do valor de companyId no estado —
      // não confia só na visibilidade condicional do campo Empresa (que já
      // limpa companyId ao trocar para B2C em handleSaleTypeChange, mas
      // esta é a garantia definitiva do contrato, robusta a qualquer
      // sequência de troca de aba).
      company_id: saleType === 'B2B' ? companyId : null,
      // lead_source_id OMITIDO quando não escolhido (não enviado como null)
      // — deixa create_order() aplicar sua própria herança de
      // customers.acquisition_source_id, sem replicar essa regra aqui.
      ...(leadSourceId ? { lead_source_id: leadSourceId } : {}),
      // Prazo de entrega, Desconto e Observações não fazem parte do
      // desenho aprovado desta rodada — omitidos com segurança (campos
      // opcionais no contrato real, sem consequência de negócio).
      expected_delivery_date: null,
      delivery_method: deliveryMethod ? deliveryMethod : null,
      // Força null quando Frete está escondido (Em mãos ou nenhuma forma
      // de entrega escolhida ainda), mesma garantia de company_id acima —
      // nunca confia só no estado local shippingCost já ter sido limpo.
      shipping_cost: showShipping ? (shippingCostField.value ?? null) : null,
      discount_value: null,
      notes: null,
      items: validatedItems,
    })
  }

  const orderTotal = items.reduce((sum, row) => sum + computeRowTotal(row), 0)

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <SectionRow number={saleTypeSectionNumber} label="Tipo de venda">
        <div role="radiogroup" aria-label="Tipo de venda" className="border-input inline-flex rounded-md border p-0.5">
          {SALE_TYPE_ITEMS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={saleType === item.value}
              onClick={() => handleSaleTypeChange(item.value)}
              className={cn(
                'focus-visible:ring-brand-accent rounded-sm px-4 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                saleType === item.value
                  ? 'bg-brand-primary text-brand-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </SectionRow>

      <SectionRow number={itemTypeSectionNumber} label="Tipo de item">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <input
              type="checkbox"
              checked
              aria-label="Catálogo"
              className="accent-brand-primary size-4 rounded"
              // Único tipo funcional nesta rodada: sempre marcado, nunca
              // desabilitado (visualmente "disponível", ao contrário de
              // Personalizado/Spot). Sem estado próprio para alternar — um
              // clique é revertido de volta para true no mesmo evento,
              // antes do próximo paint, então nunca aparece desmarcado.
              onChange={(event) => {
                event.currentTarget.checked = true
              }}
            />
            Catálogo
          </label>
          <label className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={false} disabled aria-label="Personalizado" className="size-4 rounded" />
            Personalizado
            <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[0.65rem]">
              Em breve
            </span>
          </label>
          <label className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={false} disabled aria-label="Spot" className="size-4 rounded" />
            Spot
            <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[0.65rem]">
              Em breve
            </span>
          </label>
        </div>
      </SectionRow>

      {saleType === 'B2B' && (
        <SectionRow number={companySectionNumber as number} label="Empresa" error={headerErrors.company_id}>
          <Select items={companyItems} value={companyId} onValueChange={(value) => setCompanyId(value)}>
            <SelectTrigger aria-label="Empresa" size="sm" className="w-full">
              <SelectValue placeholder="Selecione a empresa" />
            </SelectTrigger>
            <SelectContent>
              {companyItems.map((item) => (
                <SelectItem key={item.value ?? 'none'} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SectionRow>
      )}

      <SectionRow number={customerSectionNumber} label="Cliente/Contato" error={headerErrors.customer_id}>
        <Select items={customerItems} value={customerId} onValueChange={(value) => setCustomerId(value)}>
          <SelectTrigger aria-label="Cliente/Contato" size="sm" className="w-full">
            <SelectValue placeholder="Selecione o cliente ou contato" />
          </SelectTrigger>
          <SelectContent>
            {customerItems.map((item) => (
              <SelectItem key={item.value ?? 'none'} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SectionRow>

      <SectionRow number={leadSourceSectionNumber} label="Entrou em contato por:">
        <div role="radiogroup" aria-label="Entrou em contato por" className="flex flex-wrap gap-1">
          {activeLeadSources.map((source) => {
            const { Icon, className: iconClassName } = LEAD_SOURCE_ICONS[source.name] ?? DEFAULT_LEAD_SOURCE_ICON
            // Rótulo visível abreviado só para "Indicação / boca a boca" (o
            // mais longo, responsável pela quebra de linha em desktop) —
            // aria-label preserva o nome real completo como nome acessível,
            // mesmo com o texto na tela encurtado. Nome/ID persistidos no
            // banco (source.id, usado em handleLeadSourceToggle/payload)
            // continuam intocados.
            const displayLabel = LEAD_SOURCE_SHORT_LABELS[source.name] ?? source.name
            return (
              <button
                key={source.id}
                type="button"
                role="radio"
                aria-checked={leadSourceId === source.id}
                aria-label={source.name}
                onClick={() => handleLeadSourceToggle(source.id)}
                className={cn(
                  'focus-visible:ring-brand-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2',
                  leadSourceId === source.id
                    ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                    : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className={cn('size-5 shrink-0', iconClassName)} />
                {displayLabel}
              </button>
            )
          })}
        </div>
      </SectionRow>

      <div className="border-input rounded-lg border p-2">
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-sm font-medium">{itemsSectionNumber}. Itens</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={addItemRow}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
          >
            <PlusIcon /> Adicionar item
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-brand-primary-dark hover:bg-brand-primary-dark">
              <TableHead className="text-brand-primary-foreground h-7 text-xs">Produto</TableHead>
              <TableHead className="text-brand-primary-foreground h-7 text-xs">Preço</TableHead>
              <TableHead className="text-brand-primary-foreground h-7 text-xs">Quantidade</TableHead>
              <TableHead className="text-brand-primary-foreground h-7 text-xs">Personalização</TableHead>
              <TableHead className="text-brand-primary-foreground h-7 text-xs">Total</TableHead>
              <TableHead className="h-7 w-9" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => {
              const productOptions = activeProducts.map((product) => ({
                label: product.name,
                value: product.id as string | null,
              }))
              return (
                <Fragment key={row.key}>
                  <TableRow>
                    <TableCell className="p-1.5">
                      <Select
                        items={productOptions}
                        value={row.productId}
                        onValueChange={(value) => handleProductChange(row.key, value)}
                      >
                        <SelectTrigger aria-label="Produto" size="sm" className="w-full min-w-40">
                          <SelectValue placeholder="Selecione um produto" />
                        </SelectTrigger>
                        <SelectContent>
                          {productOptions.map((item) => (
                            <SelectItem key={item.value ?? 'none'} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="p-1.5">
                      <div className="relative w-24">
                        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs">
                          R$
                        </span>
                        <Input
                          className="h-7 pl-7"
                          inputMode="decimal"
                          aria-label="Preço unitário"
                          value={row.unitPrice}
                          onChange={(event) => updateItemRow(row.key, { unitPrice: event.target.value })}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="p-1.5">
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          aria-label="Diminuir quantidade"
                          onClick={() => decrementQuantity(row.key)}
                        >
                          <MinusIcon />
                        </Button>
                        <Input
                          className="h-7 w-10 shrink-0 px-1 text-center"
                          inputMode="numeric"
                          aria-label="Quantidade"
                          value={row.quantity}
                          onChange={(event) => updateItemRow(row.key, { quantity: event.target.value })}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          aria-label="Aumentar quantidade"
                          onClick={() => incrementQuantity(row.key)}
                        >
                          <PlusIcon />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="p-1.5">
                      <Input
                        className="h-7 w-24"
                        inputMode="decimal"
                        aria-label="Taxa de personalização"
                        placeholder="0,00"
                        value={row.personalizationFee}
                        onChange={(event) => updateItemRow(row.key, { personalizationFee: event.target.value })}
                      />
                    </TableCell>
                    <TableCell className="p-1.5 text-sm font-medium">{formatCurrency(computeRowTotal(row))}</TableCell>
                    <TableCell className="p-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeItemRow(row.key)}
                        disabled={items.length === 1}
                        aria-label="Remover item"
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {itemErrors[row.key] && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-destructive p-1.5 pt-0 text-xs whitespace-normal">
                        {itemErrors[row.key]}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <SectionRow number={deliverySectionNumber} label="Forma de entrega">
        <div role="radiogroup" aria-label="Forma de entrega" className="flex flex-wrap gap-1.5">
          {DELIVERY_METHODS.map((method) => {
            const Icon = DELIVERY_METHOD_ICONS[method]
            return (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={deliveryMethod === method}
                onClick={() => handleDeliveryMethodChange(method)}
                className={cn(
                  'focus-visible:ring-brand-accent inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                  deliveryMethod === method
                    ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                    : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                {method}
              </button>
            )
          })}
        </div>
      </SectionRow>

      {showShipping && (
        <SectionRow number={shippingSectionNumber as number} label="Frete" error={headerErrors.shipping_cost}>
          <div className="relative w-32">
            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs">
              R$
            </span>
            <Input
              className="h-7 pl-7"
              inputMode="decimal"
              aria-label="Frete"
              value={shippingCost}
              onChange={(event) => setShippingCost(event.target.value)}
            />
          </div>
        </SectionRow>
      )}

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <DialogFooter className="flex-row flex-wrap items-center justify-between gap-3 p-3 sm:justify-between">
        <p className="text-sm">
          <span className="font-medium">Total do pedido:</span> {formatCurrency(orderTotal)}
          <span className="text-muted-foreground">
            {' '}
            · {items.length} {items.length === 1 ? 'item' : 'itens'}
          </span>
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
          >
            {isSubmitting ? 'Salvando...' : 'Salvar pedido'}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
