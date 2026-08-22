import { Fragment, useState, type ComponentType, type FormEvent, type ReactNode } from 'react'
import {
  BanknoteIcon,
  CircleDashedIcon,
  CreditCardIcon,
  HandIcon,
  MinusIcon,
  PackageIcon,
  PlusIcon,
  QrCodeIcon,
  Trash2Icon,
  TruckIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LeadSourcePicker } from '@/components/leadSources/LeadSourcePicker'
import { cn } from '@/lib/utils'
import { parseNumberField } from '@/lib/forms/numberField'
import type { CreateOrderInput, OrderItemInput } from '@/lib/api/orders'
import type { Company, Customer, LeadSource, PaymentMethod, Product } from '@/types/domain'

type SaleType = 'B2C' | 'B2B'
type DeliveryMethod = 'Em mãos' | 'Correios' | 'Transportadora'

const SALE_TYPE_ITEMS: Array<{ label: string; value: SaleType }> = [
  { label: 'B2C', value: 'B2C' },
  { label: 'B2B', value: 'B2B' },
]

const DELIVERY_METHODS: DeliveryMethod[] = ['Em mãos', 'Correios', 'Transportadora']

function isKnownDeliveryMethod(value: string | null): value is DeliveryMethod {
  return value === 'Em mãos' || value === 'Correios' || value === 'Transportadora'
}

// Rótulos aprovados — nomes reais de orders.payment_method (CHECK em
// supabase/migrations/20260813221340_create_orders_table.sql, reafirmada
// sem alteração pela migration que adiciona o parâmetro a create_order() e
// pela validação equivalente em update_quote_order(), migration
// 20260821031143). Sem valor separado para crédito/débito: "CARTAO"/"Cartão"
// é o único valor de cartão previsto no projeto
// (docs/01_ESPECIFICACAO_FUNCIONAL.md, docs/03_MODELO_BANCO_DADOS.md). Não
// existe "Transferência"/"Outro" no contrato — não inventados aqui.
// "Não informado" (value: null) é a opção padrão — a coluna é nullable e
// create_order()/update_quote_order() nunca exigem o campo.
//
// Ícone por método: mesmo tratamento de "Entrou em contato por" (ícone com
// cor fixa própria, independente do estado selecionado — a seleção é
// comunicada só pela borda/fundo do botão, nunca recolorindo o ícone).
// Nenhum destes 4 métodos tem uma cor de marca oficial documentada no
// projeto (ao contrário de Instagram/WhatsApp/Facebook/TikTok em "Entrou em
// contato por"), então todos usam a mesma cor genérica --brand-primary,
// igual ao tratamento já dado a "Indicação"/"Outros" naquele grupo.
const PAYMENT_METHOD_ITEMS: Array<{ label: string; value: PaymentMethod | null; Icon: IconComponent }> = [
  { label: 'Não informado', value: null, Icon: CircleDashedIcon },
  { label: 'Pix', value: 'PIX', Icon: QrCodeIcon },
  { label: 'Dinheiro', value: 'DINHEIRO', Icon: BanknoteIcon },
  { label: 'Cartão', value: 'CARTAO', Icon: CreditCardIcon },
]

type IconComponent = ComponentType<{ className?: string }>

const DELIVERY_METHOD_ICONS: Record<DeliveryMethod, IconComponent> = {
  'Em mãos': HandIcon,
  Correios: PackageIcon,
  Transportadora: TruckIcon,
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

// Valores para pré-preencher o formulário em modo edição — usados só por
// OrderEditForm.tsx, que resolve os dados via getOrder()/listOrderItems()
// antes de montar este componente (nunca montado antes dos dados estarem
// prontos, então este componente nunca precisa reagir a initialValues
// mudando depois do primeiro render).
export interface OrderFormInitialItem {
  productId: string
  quantity: number
  unitPrice: number
  personalizationFee: number
}

export interface OrderFormInitialValues {
  companyId: string | null
  customerId: string | null
  leadSourceId: string | null
  paymentMethod: PaymentMethod | null
  // Texto livre no banco (sem CHECK) — só os 3 valores conhecidos viram
  // seleção real; qualquer outro valor gravado por fora desta UI aparece
  // como "nenhuma forma selecionada" aqui (mesma limitação já aceita na
  // criação, não resolvida nesta rodada).
  deliveryMethod: string | null
  shippingCost: number | null
  expectedDeliveryDate: string | null
  notes: string | null
  items: OrderFormInitialItem[]
}

interface OrderFormProps {
  mode?: 'create' | 'edit'
  // Só usados/mostrados quando mode === 'edit' — informação somente
  // leitura, nunca um campo editável.
  orderNumber?: string
  orderStatusLabel?: string
  paymentStatusLabel?: string
  initialValues?: OrderFormInitialValues
  // Quando true, todo o formulário fica somente leitura: nenhum controle
  // é editável e o botão de salvar não aparece — usado quando o pedido em
  // edição está fora do escopo suportado (não-QUOTE ou com item
  // Personalizado/Spot).
  readOnly?: boolean
  readOnlyMessage?: string
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
  mode = 'create',
  orderNumber,
  orderStatusLabel,
  paymentStatusLabel,
  initialValues,
  readOnly = false,
  readOnlyMessage,
  customers,
  companies,
  leadSources,
  products,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: OrderFormProps) {
  const [saleType, setSaleType] = useState<SaleType>(initialValues?.companyId ? 'B2B' : 'B2C')
  const [customerId, setCustomerId] = useState<string | null>(initialValues?.customerId ?? null)
  const [companyId, setCompanyId] = useState<string | null>(initialValues?.companyId ?? null)
  const [leadSourceId, setLeadSourceId] = useState<string | null>(initialValues?.leadSourceId ?? null)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | ''>(
    isKnownDeliveryMethod(initialValues?.deliveryMethod ?? null) ? (initialValues!.deliveryMethod as DeliveryMethod) : '',
  )
  const [shippingCost, setShippingCost] = useState(
    initialValues?.shippingCost != null && initialValues.shippingCost !== 0 ? String(initialValues.shippingCost) : '',
  )
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(initialValues?.expectedDeliveryDate ?? '')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(initialValues?.paymentMethod ?? null)
  const [notes, setNotes] = useState(initialValues?.notes ?? '')
  const [items, setItems] = useState<ItemRow[]>(() =>
    initialValues && initialValues.items.length > 0
      ? initialValues.items.map((item) => ({
          key: nextRowKey(),
          productId: item.productId,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
          personalizationFee: item.personalizationFee ? String(item.personalizationFee) : '',
        }))
      : [emptyRow()],
  )

  const [headerErrors, setHeaderErrors] = useState<Record<string, string>>({})
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({})

  // Só ativos podem ser escolhidos para um pedido novo — nenhum destes
  // filtros muta customers/companies/leadSources/products (props originais
  // preservados intactos, só as listas locais de opção são reduzidas).
  //
  // product_type === 'CATALOG' (comparação estrita, sem fallback): o
  // seletor de item Catálogo só pode oferecer produtos de Catálogo de
  // verdade — nunca um produto CUSTOM/SPOT cadastrado como reutilizável
  // (ver ProductForm.tsx/ProductsPage.tsx). Os fluxos de pedido
  // Personalizado e SPOT continuam não habilitados; este filtro é só uma
  // proteção para não oferecer, na tabela de itens Catálogo, um produto
  // que tecnicamente não é Catálogo. Nenhum fallback silencioso: um
  // produto sem product_type (nunca deveria ocorrer após a migration ser
  // aplicada, já que a coluna é NOT NULL) fica de fora, nunca é tratado
  // como CATALOG por omissão.
  const activeProducts = products.filter((product) => product.is_active && product.product_type === 'CATALOG')
  const activeCustomers = customers.filter((customer) => customer.is_active)
  const activeCompanies = companies.filter((company) => company.is_active)

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
  const shippingSectionNumber = showShipping ? sectionNumber++ : null
  const deliveryDateSectionNumber = sectionNumber++
  const paymentMethodSectionNumber = sectionNumber++
  // Última seção numerada — nenhum incremento necessário depois desta.
  const notesSectionNumber = sectionNumber

  // Ao sair de B2B, limpa companyId — garante que uma empresa escolhida
  // antes não fique "fantasma" no estado se o usuário voltar para B2B
  // depois. customerId nunca é tocado aqui: continua obrigatório e válido
  // nos dois modos, sem relação alguma com o tipo de venda.
  function handleSaleTypeChange(value: SaleType) {
    if (readOnly) return
    setSaleType(value)
    if (value === 'B2C') setCompanyId(null)
  }

  function handleDeliveryMethodChange(value: DeliveryMethod) {
    if (readOnly) return
    setDeliveryMethod(value)
    // Ao voltar para "Em mãos", limpa o valor de frete do estado — o
    // submit já força shipping_cost: null quando o campo está escondido,
    // esta linha só evita que um valor digitado antes reapareça
    // "fantasma" se o usuário voltar para Correios/Transportadora depois.
    if (value === 'Em mãos') setShippingCost('')
  }

  function handleLeadSourceToggle(id: string) {
    if (readOnly) return
    setLeadSourceId((current) => (current === id ? null : id))
  }

  function addItemRow() {
    if (readOnly) return
    setItems((rows) => [...rows, emptyRow()])
  }
  function removeItemRow(key: string) {
    if (readOnly) return
    setItems((rows) => (rows.length > 1 ? rows.filter((row) => row.key !== key) : rows))
  }
  function updateItemRow(key: string, patch: Partial<ItemRow>) {
    if (readOnly) return
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function incrementQuantity(key: string) {
    if (readOnly) return
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
    if (readOnly) return
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
    if (readOnly) return

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
      // customers.acquisition_source_id, sem replicar essa regra aqui. Em
      // modo edição, o mesmo omitido = null é interpretado por
      // update_quote_order() como "sem origem", sem herança nenhuma (só
      // create_order tem essa lógica) — comportamento aceito para esta
      // primeira versão.
      ...(leadSourceId ? { lead_source_id: leadSourceId } : {}),
      // payment_method: "Não informado" é value: null no Select — enviado
      // como null explícito (nunca omitido), igual ao padrão já usado para
      // company_id/shipping_cost acima.
      payment_method: paymentMethod,
      // Prazo de entrega: campo vazio ('') vira null, igual ao padrão já
      // usado para os demais campos opcionais deste formulário.
      expected_delivery_date: expectedDeliveryDate ? expectedDeliveryDate : null,
      delivery_method: deliveryMethod ? deliveryMethod : null,
      // Força null quando Frete está escondido (Em mãos ou nenhuma forma
      // de entrega escolhida ainda), mesma garantia de company_id acima —
      // nunca confia só no estado local shippingCost já ter sido limpo.
      shipping_cost: showShipping ? (shippingCostField.value ?? null) : null,
      // Desconto não faz parte do desenho aprovado desta rodada (não
      // existe no formulário de criação) — omitido com segurança.
      discount_value: null,
      notes: notes.trim() ? notes.trim() : null,
      items: validatedItems,
    })
  }

  // Preview do valor total a pagar pelo cliente — mesma fórmula de
  // vw_order_summary.total_receivable (subtotal - desconto + frete,
  // migration 20260814040037): orders.total_value sozinho NÃO inclui
  // shipping_cost (recalculate_order_financials() só calcula
  // subtotal - discount_value), então somar aqui é necessário para o
  // destaque do rodapé não subestimar o valor real cobrado quando há
  // frete. Desconto não existe como campo neste formulário (sempre 0).
  const itemsTotal = items.reduce((sum, row) => sum + computeRowTotal(row), 0)
  const shippingPreview = showShipping ? Number.parseFloat(shippingCost) || 0 : 0
  const orderTotal = itemsTotal + shippingPreview

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      {mode === 'edit' && (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Nº do pedido</span>
            <span className="font-medium">{orderNumber}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Status</span>
            <span className="font-medium">{orderStatusLabel}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Status financeiro</span>
            <span className="font-medium">{paymentStatusLabel}</span>
          </div>
        </div>
      )}

      {readOnly && readOnlyMessage && <p className="text-muted-foreground text-sm">{readOnlyMessage}</p>}

      <SectionRow number={saleTypeSectionNumber} label="Tipo de venda">
        <div role="radiogroup" aria-label="Tipo de venda" className="border-input inline-flex rounded-md border p-0.5">
          {SALE_TYPE_ITEMS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={saleType === item.value}
              disabled={readOnly}
              onClick={() => handleSaleTypeChange(item.value)}
              className={cn(
                'focus-visible:ring-brand-accent rounded-sm px-4 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
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
              disabled={readOnly}
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
          <Select items={companyItems} value={companyId} onValueChange={(value) => !readOnly && setCompanyId(value)}>
            <SelectTrigger aria-label="Empresa" size="sm" className="w-full" disabled={readOnly}>
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
        <Select items={customerItems} value={customerId} onValueChange={(value) => !readOnly && setCustomerId(value)}>
          <SelectTrigger aria-label="Cliente/Contato" size="sm" className="w-full" disabled={readOnly}>
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
        {/* Cards verticais (ícone grande em cima, nome embaixo) — extraídos
            para components/leadSources/LeadSourcePicker.tsx, também
            reutilizado por CustomerForm.tsx ("Como nos conheceu:"). Mesma
            referência de tamanho de ícone (size-8) adotada por "Forma de
            entrega" e "Método de pagamento" abaixo. */}
        <LeadSourcePicker
          leadSources={leadSources}
          selectedId={leadSourceId}
          onToggle={handleLeadSourceToggle}
          ariaLabel="Entrou em contato por"
          disabled={readOnly}
        />
      </SectionRow>

      <div className="border-input rounded-lg border p-2">
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-sm font-medium">{itemsSectionNumber}. Itens</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={addItemRow}
            disabled={readOnly}
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
                        <SelectTrigger aria-label="Produto" size="sm" className="w-full min-w-40" disabled={readOnly}>
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
                          disabled={readOnly}
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
                          disabled={readOnly}
                        >
                          <MinusIcon />
                        </Button>
                        <Input
                          className="h-7 w-10 shrink-0 px-1 text-center"
                          inputMode="numeric"
                          aria-label="Quantidade"
                          value={row.quantity}
                          onChange={(event) => updateItemRow(row.key, { quantity: event.target.value })}
                          disabled={readOnly}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          aria-label="Aumentar quantidade"
                          onClick={() => incrementQuantity(row.key)}
                          disabled={readOnly}
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
                        disabled={readOnly}
                      />
                    </TableCell>
                    <TableCell className="p-1.5 text-sm font-medium">{formatCurrency(computeRowTotal(row))}</TableCell>
                    <TableCell className="p-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeItemRow(row.key)}
                        disabled={items.length === 1 || readOnly}
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
        {/* Ícone size-8, mesma referência visual dos novos cards de "Entrou
            em contato por" (item 4) — só o tamanho do ícone muda; o botão
            continua no formato pílula horizontal (sem texto abaixo do
            ícone), conforme aprovado. */}
        <div role="radiogroup" aria-label="Forma de entrega" className="flex flex-wrap gap-2">
          {DELIVERY_METHODS.map((method) => {
            const Icon = DELIVERY_METHOD_ICONS[method]
            return (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={deliveryMethod === method}
                disabled={readOnly}
                onClick={() => handleDeliveryMethodChange(method)}
                className={cn(
                  'focus-visible:ring-brand-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
                  deliveryMethod === method
                    ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                    : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="text-brand-primary size-8 shrink-0" />
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
              disabled={readOnly}
            />
          </div>
        </SectionRow>
      )}

      <SectionRow number={deliveryDateSectionNumber} label="Prazo de entrega">
        <Input
          type="date"
          className="h-7 w-40"
          aria-label="Prazo de entrega"
          value={expectedDeliveryDate}
          onChange={(event) => setExpectedDeliveryDate(event.target.value)}
          disabled={readOnly}
        />
      </SectionRow>

      <SectionRow number={paymentMethodSectionNumber} label="Método de pagamento">
        {/* Mesmo tratamento de tamanho de ícone (size-8) de "Forma de
            entrega" e dos novos cards de "Entrou em contato por". */}
        <div role="radiogroup" aria-label="Método de pagamento" className="flex flex-wrap gap-2">
          {PAYMENT_METHOD_ITEMS.map((item) => (
            <button
              key={item.value ?? 'none'}
              type="button"
              role="radio"
              aria-checked={paymentMethod === item.value}
              disabled={readOnly}
              onClick={() => !readOnly && setPaymentMethod(item.value)}
              className={cn(
                'focus-visible:ring-brand-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
                paymentMethod === item.value
                  ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <item.Icon className="text-brand-primary size-8 shrink-0" />
              {item.label}
            </button>
          ))}
        </div>
      </SectionRow>

      <SectionRow number={notesSectionNumber} label="Observações">
        <textarea
          aria-label="Observações"
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-16 w-full rounded-md border bg-transparent p-2 text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={readOnly}
        />
      </SectionRow>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <DialogFooter className="flex-row flex-wrap items-center justify-between gap-3 p-3 sm:justify-between">
        {/* Mesmo tratamento visual do valor destacado da Ficha Técnica do
            Produto (ComponentsSubtotalCard, ProductDetailPage.tsx): valor em
            fonte grande/peso forte na cor --brand-primary-dark, rótulo e
            contagem de itens em texto secundário menor — o valor é
            deliberadamente o elemento de maior destaque do rodapé, sem
            competir com os botões (bloco próprio, à esquerda; botões à
            direita via justify-between). */}
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs font-medium">Total do pedido</span>
          <span className="text-brand-primary-dark text-2xl leading-none font-bold">
            {formatCurrency(orderTotal)}
          </span>
          <span className="text-muted-foreground text-xs">
            {items.length} {items.length === 1 ? 'item' : 'itens'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancelar
          </Button>
          {!readOnly && (
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
            >
              {isSubmitting ? 'Salvando...' : mode === 'edit' ? 'Salvar alterações' : 'Salvar pedido'}
            </Button>
          )}
        </div>
      </DialogFooter>
    </form>
  )
}
