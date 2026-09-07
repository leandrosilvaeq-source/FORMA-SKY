import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import { Disc3Icon, PackageIcon, PlusIcon, PuzzleIcon, ShoppingCartIcon, Trash2Icon } from 'lucide-react'
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAccessories } from '@/hooks/useAccessories'
import { usePackaging } from '@/hooks/usePackaging'
import { useFilamentTypes } from '@/hooks/useFilamentTypes'
import {
  registerMixedInventoryPurchase,
  type MixedPurchaseChannel,
  type MixedPurchaseItemInput,
  type RegisterMixedPurchaseInput,
} from '@/lib/api/inventoryPurchases'
import { allocateFreightCents, predictUnitCostAfter } from '@/lib/inventory/accessoryPurchaseCost'
import { ApiError } from '@/lib/api/errors'
import { formatDateToBrDate, maskBrDate, parseBrDate } from '@/lib/forms/brDate'
import { parseNumberField } from '@/lib/forms/numberField'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import {
  MAX_CENTS,
  appendDigit,
  centsToAmount,
  formatCentsToBRL,
  parsePastedTextToCents,
  rawValueToCents,
  removeLastDigit,
} from '@/lib/forms/currencyField'
import { cn } from '@/lib/utils'
import type { Accessory, FilamentTypeSummary, InventoryPurchaseCategory, Packaging } from '@/types/domain'
import type { InventoryArea } from '@/components/inventory/InventoryPageShell'

// COMPRA MISTA unificada (2026-09-06) — o botão "Compras" abre UMA janela que
// registra, no mesmo pedido, linhas de Filamento + Acessório + Embalagem, com
// um único cabeçalho, um único frete e uma única idempotency_key. Sempre via
// POST /inventory-purchases/mixed -> register_mixed_inventory_purchase
// (migration 20260906150000), atômica por construção. Os três caminhos
// antigos (/, /filament, /accessory) continuam existindo no backend e nos
// clientes de API para compatibilidade, mas esta janela nunca mais os chama.
//
// Quatro seções: 1. Dados Gerais (Data da compra dd/mm/aaaa + Local da
// compra), 2. Itens (lista mista, cada linha começa pela Categoria),
// 3. Frete (campo único), 4. Resumo (Subtotal / Frete / Total + por linha:
// frete atribuído, "Custo desta compra/un." e — para Acessório/Embalagem —
// "Novo custo médio/un."). O frontend só PREVÊ os custos; o valor
// autoritativo é sempre o que o backend devolve.

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR')} g`
}

const ACTION_BUTTON_CLASSNAME =
  'focus-visible:ring-brand-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_BUTTON_SELECTED_CLASSNAME = 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
const ACTION_BUTTON_UNSELECTED_CLASSNAME =
  'border-input text-muted-foreground hover:bg-muted hover:text-foreground'

type LineCategory = InventoryPurchaseCategory // 'FILAMENT' | 'ACCESSORY' | 'PACKAGING'

const CATEGORY_LABEL: Record<LineCategory, string> = {
  FILAMENT: 'Filamento',
  ACCESSORY: 'Acessório',
  PACKAGING: 'Embalagem',
}
const CATEGORY_ICON = { FILAMENT: Disc3Icon, ACCESSORY: PuzzleIcon, PACKAGING: PackageIcon }
const CATEGORY_ORDER: LineCategory[] = ['FILAMENT', 'ACCESSORY', 'PACKAGING']

// Peso nominal: só os 3 valores oficiais (250 / 500 / 1000 g), agora numa
// lista suspensa. Os valores são exatamente os mesmos que os action buttons
// antigos ofereciam — aceitos pelo register_mixed_inventory_purchase
// (nominal_weight_grams numeric > 0) e pela Edge Function — e o número
// enviado no payload continua em GRAMAS, inalterado.
const NOMINAL_WEIGHT_OPTIONS = [250, 500, 1000] as const
const NOMINAL_WEIGHT_ITEMS = NOMINAL_WEIGHT_OPTIONS.map((grams) => ({
  label: formatGrams(grams),
  value: String(grams),
}))

// Local da compra — ordem e rótulos aprovados. OUTRO_SITE / PRESENCIAL
// exigem um complemento; os três primeiros não.
const CHANNEL_OPTIONS: Array<{ value: MixedPurchaseChannel; label: string }> = [
  { value: 'MERCADO_LIVRE', label: 'Mercado Livre' },
  { value: 'SHOPEE', label: 'Shopee' },
  { value: 'ALIEXPRESS', label: 'AliExpress' },
  { value: 'OUTRO_SITE', label: 'Outro Site' },
  { value: 'PRESENCIAL', label: 'Presencial' },
]
function channelNeedsComplement(channel: MixedPurchaseChannel | null): boolean {
  return channel === 'OUTRO_SITE' || channel === 'PRESENCIAL'
}
function complementLabel(channel: MixedPurchaseChannel | null): string {
  return channel === 'PRESENCIAL' ? 'Nome da loja' : 'Nome do site'
}

const MIXED_PURCHASE_MAX_ITEMS = 50

interface CurrencyFieldState {
  cents: number
  hasEdited: boolean
}
function emptyCurrencyField(): CurrencyFieldState {
  return { cents: 0, hasEdited: false }
}

// Campo de valor monetário "bancário" (dígito sempre entra pela direita) —
// mesmo comportamento de ProductPriceForm.tsx/RegisterPaymentForm.tsx.
function CurrencyInput({
  id,
  label,
  state,
  onChange,
  disabled,
  error,
  inputClassName = 'w-40',
}: {
  id: string
  label: string
  state: CurrencyFieldState
  onChange: (next: CurrencyFieldState) => void
  disabled: boolean
  error?: string
  inputClassName?: string
}) {
  function applyCents(cents: number) {
    onChange({ cents, hasEdited: true })
  }
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const { key, currentTarget } = event
    const isFullSelection =
      currentTarget.value.length > 0 &&
      currentTarget.selectionStart === 0 &&
      currentTarget.selectionEnd === currentTarget.value.length
    if (/^[0-9]$/.test(key)) {
      event.preventDefault()
      const base = isFullSelection ? 0 : state.cents
      const next = appendDigit(base, key)
      if (next === null) return
      applyCents(next)
      return
    }
    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault()
      applyCents(isFullSelection ? 0 : removeLastDigit(state.cents))
      return
    }
    const passthrough = new Set([
      'Tab', 'Shift', 'Control', 'Meta', 'Alt', 'Escape', 'Enter',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End',
    ])
    if (passthrough.has(key) || event.ctrlKey || event.metaKey) return
    event.preventDefault()
  }
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = rawValueToCents(event.target.value)
    if (next > MAX_CENTS) return
    applyCents(next)
  }
  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const parsed = parsePastedTextToCents(event.clipboardData.getData('text'))
    if (parsed === null) return
    applyCents(parsed)
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="numeric"
        value={formatCentsToBRL(state.cents)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className={cn('focus-visible:border-brand-primary focus-visible:ring-brand-accent/50', inputClassName)}
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  )
}

// Select pesquisável genérico de UM item ATIVO já cadastrado (acessório /
// embalagem). `items`/`isLoading` vêm de um ÚNICO hook no pai (nunca um por
// linha). `excludeIds` remove das sugestões os itens já escolhidos em OUTRAS
// linhas da mesma categoria.
function ActiveItemPicker({
  index,
  fieldLabel,
  placeholder,
  items,
  selectedId,
  excludeIds,
  onSelect,
  disabled,
  error,
  autoFocus,
}: {
  index: number
  fieldLabel: string
  placeholder: string
  items: Array<{ id: string; label: string }>
  selectedId: string | null
  excludeIds: Set<string>
  onSelect: (id: string | null, label: string) => void
  disabled: boolean
  error?: string
  autoFocus?: boolean
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const suggestions = items.filter((item) => item.id === selectedId || !excludeIds.has(item.id))
  const normalizedTerm = normalizeForSearch(searchTerm)
  const filtered = normalizedTerm
    ? suggestions.filter((s) => normalizeForSearch(s.label).includes(normalizedTerm))
    : suggestions
  function handleSelect(label: string) {
    const match = filtered.find((s) => s.label === label)
    setSearchTerm(label)
    onSelect(match?.id ?? null, label)
  }
  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`purchase-item-${index}`} className={LINE_LABEL_CLASSNAME}>
          {fieldLabel}
        </Label>
        <SearchAutocomplete
          value={searchTerm}
          onValueChange={(value) => {
            setSearchTerm(value)
            onSelect(null, value)
          }}
          suggestions={filtered}
          onSelect={handleSelect}
          ariaLabel={fieldLabel}
          placeholder={placeholder}
          clearLabel={`Limpar seleção — item ${index}`}
          listboxId={`purchase-item-listbox-${index}`}
          listboxAriaLabel={`Sugestões — item ${index}`}
          noResultsText="Nenhum item ativo encontrado."
          autoFocus={autoFocus}
        />
        {selectedId === null && searchTerm && (
          <p className="text-muted-foreground text-xs">Selecione um item da lista.</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </fieldset>
  )
}

// Select pesquisável de UM tipo de filamento ATIVO já cadastrado. Cada opção
// é UM filament_type_id, rotulada "Material - Linha - Cor" (fabricante não
// entra no rótulo — pedido explícito).
function FilamentTypeItemPicker({
  index,
  types,
  selectedId,
  onSelect,
  disabled,
  error,
  autoFocus,
}: {
  index: number
  types: FilamentTypeSummary[]
  selectedId: string | null
  onSelect: (id: string | null, label: string) => void
  disabled: boolean
  error?: string
  autoFocus?: boolean
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const allSuggestions = types.map((type) => ({
    id: type.filament_type_id,
    label: `${type.material} - ${type.line} - ${type.commercial_color}`,
  }))
  const normalizedTerm = normalizeForSearch(searchTerm)
  const suggestions = normalizedTerm
    ? allSuggestions.filter((s) => normalizeForSearch(s.label).includes(normalizedTerm))
    : allSuggestions
  const fieldLabel = 'Tipo de filamento'
  function handleSelect(label: string) {
    const match = suggestions.find((s) => s.label === label)
    setSearchTerm(label)
    onSelect(match?.id ?? null, label)
  }
  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`purchase-filament-type-${index}`} className={LINE_LABEL_CLASSNAME}>
          {fieldLabel}
        </Label>
        <SearchAutocomplete
          value={searchTerm}
          onValueChange={(value) => {
            setSearchTerm(value)
            onSelect(null, value)
          }}
          suggestions={suggestions}
          onSelect={handleSelect}
          ariaLabel={fieldLabel}
          placeholder="Buscar por material, linha ou cor"
          clearLabel={`Limpar seleção de tipo de filamento — item ${index}`}
          listboxId={`purchase-filament-type-listbox-${index}`}
          listboxAriaLabel={`Sugestões de tipo de filamento — item ${index}`}
          noResultsText="Nenhum tipo de filamento encontrado."
          autoFocus={autoFocus}
        />
        {selectedId === null && searchTerm && (
          <p className="text-muted-foreground text-xs">Selecione um tipo de filamento da lista.</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </fieldset>
  )
}

interface MixedItemState {
  key: string
  category: LineCategory
  // FILAMENT
  filamentTypeId: string | null
  manufacturer: string
  nominalWeightGrams: number | null
  // ACCESSORY / PACKAGING
  itemId: string | null
  // comum
  quantity: string
  totalValueField: CurrencyFieldState
}

function emptyItem(category: LineCategory): MixedItemState {
  return {
    key: crypto.randomUUID(),
    category,
    filamentTypeId: null,
    manufacturer: '',
    nominalWeightGrams: null,
    itemId: null,
    quantity: '',
    totalValueField: emptyCurrencyField(),
  }
}

// Campos "incompatíveis" preenchidos que uma troca de categoria descartaria
// (quantidade e valor total são SEMPRE preservados).
function hasIncompatibleData(item: MixedItemState, nextCategory: LineCategory): boolean {
  if (item.category === nextCategory) return false
  if (item.category === 'FILAMENT') {
    return Boolean(item.filamentTypeId) || item.manufacturer.trim() !== '' || item.nominalWeightGrams !== null
  }
  // ACCESSORY <-> PACKAGING, ou -> FILAMENT
  return Boolean(item.itemId)
}

// Aplica a troca de categoria: mantém quantidade + valor total, limpa só o
// que não se aplica à nova categoria.
function switchedCategory(item: MixedItemState, nextCategory: LineCategory): MixedItemState {
  return {
    ...item,
    category: nextCategory,
    filamentTypeId: null,
    manufacturer: '',
    nominalWeightGrams: null,
    itemId: null,
  }
}

// Rótulo curto de cada campo de linha: sempre no DOM (leitores de tela e
// getByLabelText o enxergam), visível a partir de sm. Sem "— item N": a
// numeração não aparece na tela, mas a ordem interna e o line_number
// continuam valendo pela posição do item na lista.
const LINE_LABEL_CLASSNAME = 'text-muted-foreground text-xs sr-only sm:not-sr-only'

// Bloco visual de cada seção da janela (Dados Gerais / Itens / Frete /
// Resumo). Mesma linguagem do FormSection de OrderForm.tsx
// (border-input rounded-lg border) — nunca um components/ui/card novo — com
// um fundo levemente diferenciado (bg-muted/30) para destacar os limites
// entre as seções, e um slot opcional à direita do título (usado pelo "+"
// de Itens).
function FormSection({
  title,
  headerRight,
  children,
}: {
  title: string
  headerRight?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-input bg-muted/30 flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{title}</h3>
        {headerRight}
      </div>
      {children}
    </section>
  )
}

// Quantidade + Valor total da linha — comum às três categorias.
function QuantityAndTotalFields({
  lineNo,
  quantity,
  totalValueField,
  quantityError,
  totalValueError,
  disabled,
  onQuantityChange,
  onTotalValueChange,
}: {
  lineNo: number
  quantity: string
  totalValueField: CurrencyFieldState
  quantityError?: string
  totalValueError?: string
  disabled: boolean
  onQuantityChange: (value: string) => void
  onTotalValueChange: (next: CurrencyFieldState) => void
}) {
  return (
    <>
      <div className="flex flex-col gap-1 sm:w-20">
        <Label htmlFor={`purchase-quantity-${lineNo}`} className={LINE_LABEL_CLASSNAME}>
          Quantidade
        </Label>
        <Input
          id={`purchase-quantity-${lineNo}`}
          inputMode="numeric"
          placeholder="Qtd."
          value={quantity}
          onChange={(event) => onQuantityChange(event.target.value)}
          disabled={disabled}
          aria-invalid={quantityError ? true : undefined}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        {quantityError && <p className="text-destructive text-sm">{quantityError}</p>}
      </div>
      <div className="sm:w-32">
        <CurrencyInput
          id={`purchase-total-value-${lineNo}`}
          label="Valor total"
          state={totalValueField}
          onChange={onTotalValueChange}
          disabled={disabled}
          error={totalValueError}
          inputClassName="w-full"
        />
      </div>
    </>
  )
}

export interface PurchaseDialogProps {
  // Área de onde a janela foi aberta — define a categoria da PRIMEIRA linha
  // (Filamentos->FILAMENT, Acessórios->ACCESSORY, Embalagens->PACKAGING),
  // sempre trocável.
  area: InventoryArea
  // Chamado após uma compra concluída com sucesso, UMA vez por categoria
  // DISTINTA presente na compra — cada página de área decide se aquilo afeta
  // os dados que exibe e chama seu próprio refetch.
  onPurchaseCompleted: (category: InventoryPurchaseCategory) => void
}

function areaToCategory(area: InventoryArea): LineCategory {
  if (area === 'filamentos') return 'FILAMENT'
  if (area === 'acessorios') return 'ACCESSORY'
  return 'PACKAGING'
}

export function PurchaseDialog({ area, onPurchaseCompleted }: PurchaseDialogProps) {
  const initialCategory = areaToCategory(area)

  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [purchaseDateText, setPurchaseDateText] = useState('')
  const [channel, setChannel] = useState<MixedPurchaseChannel | null>(null)
  const [complement, setComplement] = useState('')

  const [items, setItems] = useState<MixedItemState[]>([])
  const [autoFocusItemKey, setAutoFocusItemKey] = useState<string | null>(null)
  const [pendingSwitch, setPendingSwitch] = useState<{ key: string; to: LineCategory } | null>(null)

  const [freightField, setFreightField] = useState<CurrencyFieldState>(emptyCurrencyField())

  // Um único hook de cada catálogo, no pai — nunca um por linha. Refetch a
  // cada ABERTURA da janela (nunca em polling).
  const { accessories, refetch: refetchAccessories } = useAccessories()
  const { packaging, refetch: refetchPackaging } = usePackaging()
  const { types: filamentTypes, refetch: refetchFilamentTypes } = useFilamentTypes()
  const activeAccessories = useMemo(() => accessories.filter((a) => a.is_active), [accessories])
  const activePackaging = useMemo(() => packaging.filter((p) => p.is_active), [packaging])
  const activeFilamentTypes = useMemo(() => filamentTypes.filter((t) => t.is_active), [filamentTypes])

  const accessoryOptions = useMemo(
    () => activeAccessories.map((a) => ({ id: a.id, label: a.variant ? `${a.name} — ${a.variant}` : a.name })),
    [activeAccessories],
  )
  const packagingOptions = useMemo(
    () => activePackaging.map((p) => ({ id: p.id, label: p.variant ? `${p.name} — ${p.variant}` : p.name })),
    [activePackaging],
  )

  // Idempotência: a MESMA chave é reenviada enquanto o payload não muda
  // (retry seguro de duplo clique/rede); qualquer mudança gera uma nova.
  const idempotencyRef = useRef<{ key: string; fingerprint: string } | null>(null)
  function getIdempotencyKey(fingerprint: string): string {
    if (idempotencyRef.current && idempotencyRef.current.fingerprint === fingerprint) {
      return idempotencyRef.current.key
    }
    const key = crypto.randomUUID()
    idempotencyRef.current = { key, fingerprint }
    return key
  }

  function resetForm() {
    setPurchaseDateText(formatDateToBrDate(new Date()))
    setChannel(null)
    setComplement('')
    setItems([emptyItem(initialCategory)])
    setAutoFocusItemKey(null)
    setPendingSwitch(null)
    setFreightField(emptyCurrencyField())
    setFieldErrors({})
    setSubmitError(null)
    idempotencyRef.current = null
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      resetForm()
      refetchAccessories()
      refetchPackaging()
      refetchFilamentTypes()
    }
    setIsOpen(next)
  }

  function updateItem(key: string, patch: Partial<MixedItemState>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }
  function clearItemError(key: string, field: string) {
    setFieldErrors((current) => ({ ...current, [`item_${key}_${field}`]: '' }))
  }

  function handleAddItem() {
    setItems((current) => {
      if (current.length >= MIXED_PURCHASE_MAX_ITEMS) return current
      const next = emptyItem(current[current.length - 1]?.category ?? initialCategory)
      setAutoFocusItemKey(next.key)
      return [...current, next]
    })
    setFieldErrors((current) => ({ ...current, items: '' }))
  }
  function handleRemoveItem(key: string) {
    setItems((current) => (current.length <= 1 ? current : current.filter((item) => item.key !== key)))
    setFieldErrors((current) => {
      const next = { ...current }
      for (const f of ['category', 'filament_type_id', 'manufacturer', 'nominal_weight_grams', 'item_id', 'quantity', 'total_value']) {
        delete next[`item_${key}_${f}`]
      }
      return next
    })
  }

  function requestCategoryChange(key: string, to: LineCategory) {
    const item = items.find((i) => i.key === key)
    if (!item || item.category === to) return
    if (hasIncompatibleData(item, to)) {
      setPendingSwitch({ key, to })
      return
    }
    updateItem(key, switchedCategory(item, to))
  }
  function confirmCategoryChange() {
    if (!pendingSwitch) return
    const item = items.find((i) => i.key === pendingSwitch.key)
    if (item) updateItem(pendingSwitch.key, switchedCategory(item, pendingSwitch.to))
    setPendingSwitch(null)
  }

  // --- Resumo (só previsão; backend é autoritativo) ---
  const lineTotalsCents = items.map((item) => item.totalValueField.cents)
  const subtotalCents = lineTotalsCents.reduce((sum, c) => sum + c, 0)
  const totalQuantity = items.reduce((sum, item) => {
    const q = parseNumberField(item.quantity, 'a quantidade', { integer: true }).value
    return sum + (q && q > 0 ? q : 0)
  }, 0)
  const totalCents = subtotalCents + freightField.cents
  const freightAllocationCents = allocateFreightCents(lineTotalsCents, freightField.cents)

  function itemDisplayLabel(item: MixedItemState): string {
    if (item.category === 'FILAMENT') {
      const t = activeFilamentTypes.find((x) => x.filament_type_id === item.filamentTypeId)
      const base = t ? `${t.material} - ${t.line} - ${t.commercial_color}` : '—'
      return item.manufacturer.trim() ? `${base} · ${item.manufacturer.trim()}` : base
    }
    const list = item.category === 'ACCESSORY' ? accessoryOptions : packagingOptions
    return list.find((x) => x.id === item.itemId)?.label ?? '—'
  }

  function lineSummary(item: MixedItemState, index: number) {
    const q = parseNumberField(item.quantity, 'a quantidade', { integer: true }).value
    const lineCents = item.totalValueField.cents
    const freightCents = freightAllocationCents[index] ?? 0
    const ready = Boolean(q && q > 0 && lineCents > 0)
    const lotCostUn = ready ? (lineCents + freightCents) / (q as number) / 100 : null

    let avgCostUn: number | null = null
    if (ready && item.category !== 'FILAMENT' && item.itemId) {
      const rec: Accessory | Packaging | undefined =
        item.category === 'ACCESSORY'
          ? activeAccessories.find((x) => x.id === item.itemId)
          : activePackaging.find((x) => x.id === item.itemId)
      if (rec) {
        avgCostUn = predictUnitCostAfter({
          balanceBefore: rec.current_stock,
          unitCostBefore: rec.unit_cost,
          quantity: q as number,
          lineTotalCents: lineCents,
          freightAllocatedCents: freightCents,
        })
      }
    }
    return { q: ready ? (q as number) : null, lineCents, freightCents, lotCostUn, avgCostUn }
  }

  // --- Submit ---
  async function handleSubmit(): Promise<void> {
    if (isSubmitting) return

    const errors: Record<string, string> = {}

    const dateResult = parseBrDate(purchaseDateText)
    if (dateResult.error) errors.purchase_date = dateResult.error

    if (!channel) {
      errors.channel = 'Selecione o local da compra.'
    } else if (channelNeedsComplement(channel) && complement.trim() === '') {
      errors.complement = `Informe o ${complementLabel(channel).toLowerCase()}.`
    } else if (channelNeedsComplement(channel) && complement.trim().length > 200) {
      errors.complement = 'O complemento deve ter no máximo 200 caracteres.'
    }

    if (items.length === 0) errors.items = 'Adicione ao menos um item de compra.'
    if (items.length > MIXED_PURCHASE_MAX_ITEMS) errors.items = `No máximo ${MIXED_PURCHASE_MAX_ITEMS} itens por compra.`

    const validated: MixedPurchaseItemInput[] = []
    const seenAccessory = new Set<string>()
    const seenPackaging = new Set<string>()

    for (const item of items) {
      let lineHasError = false

      const quantityResult = parseNumberField(item.quantity, 'a quantidade', { required: true, min: 1, integer: true })
      if (quantityResult.error) {
        errors[`item_${item.key}_quantity`] = quantityResult.error
        lineHasError = true
      }
      if (item.totalValueField.cents <= 0) {
        errors[`item_${item.key}_total_value`] = 'Informe o valor total do item, maior que zero.'
        lineHasError = true
      }

      if (item.category === 'FILAMENT') {
        if (!item.filamentTypeId) {
          errors[`item_${item.key}_filament_type_id`] = 'Selecione um tipo de filamento.'
          lineHasError = true
        }
        if (!item.manufacturer.trim()) {
          errors[`item_${item.key}_manufacturer`] = 'Informe o fabricante.'
          lineHasError = true
        }
        if (!item.nominalWeightGrams) {
          errors[`item_${item.key}_nominal_weight_grams`] = 'Selecione o peso nominal.'
          lineHasError = true
        }
        if (!lineHasError) {
          validated.push({
            category: 'FILAMENT',
            filament_type_id: item.filamentTypeId as string,
            manufacturer: item.manufacturer.trim(),
            nominal_weight_grams: item.nominalWeightGrams as number,
            quantity: quantityResult.value as number,
            total_value: centsToAmount(item.totalValueField.cents),
          })
        }
      } else {
        if (!item.itemId) {
          errors[`item_${item.key}_item_id`] =
            item.category === 'ACCESSORY' ? 'Selecione um acessório.' : 'Selecione uma embalagem.'
          lineHasError = true
        } else if (item.category === 'ACCESSORY' && seenAccessory.has(item.itemId)) {
          errors[`item_${item.key}_item_id`] = 'Este acessório já foi adicionado em outra linha.'
          lineHasError = true
        } else if (item.category === 'PACKAGING' && seenPackaging.has(item.itemId)) {
          errors[`item_${item.key}_item_id`] = 'Esta embalagem já foi adicionada em outra linha.'
          lineHasError = true
        }
        if (!lineHasError && item.itemId) {
          if (item.category === 'ACCESSORY') {
            seenAccessory.add(item.itemId)
            validated.push({
              category: 'ACCESSORY',
              accessory_id: item.itemId,
              quantity: quantityResult.value as number,
              total_value: centsToAmount(item.totalValueField.cents),
            })
          } else {
            seenPackaging.add(item.itemId)
            validated.push({
              category: 'PACKAGING',
              packaging_id: item.itemId,
              quantity: quantityResult.value as number,
              total_value: centsToAmount(item.totalValueField.cents),
            })
          }
        }
      }
    }

    if (Object.keys(errors).some((k) => errors[k]) || validated.length !== items.length || !dateResult.value || !channel) {
      setFieldErrors(errors)
      return
    }

    const input: RegisterMixedPurchaseInput = {
      items: validated,
      freight_value: centsToAmount(freightField.cents),
      purchase_channel: channel,
      supplier_name: channelNeedsComplement(channel) ? complement.trim() : null,
      occurred_on: dateResult.value,
    }
    const fingerprint = JSON.stringify(input)

    setFieldErrors({})
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await registerMixedInventoryPurchase({ ...input, idempotency_key: getIdempotencyKey(fingerprint) })
      toast.success('Compra registrada.')
      // uma vez por categoria DISTINTA presente
      const distinct = [...new Set(validated.map((i) => i.category))] as InventoryPurchaseCategory[]
      for (const category of distinct) onPurchaseCompleted(category)
      handleOpenChange(false)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setSubmitError(message)
      } else {
        toast.error(message)
      }
      // erro NUNCA limpa o formulário — o usuário revisa e reenvia.
    } finally {
      setIsSubmitting(false)
    }
  }

  const excludeAccessoryIds = new Set(
    items.filter((i) => i.category === 'ACCESSORY' && i.itemId).map((i) => i.itemId as string),
  )
  const excludePackagingIds = new Set(
    items.filter((i) => i.category === 'PACKAGING' && i.itemId).map((i) => i.itemId as string),
  )

  return (
    <>
      <Button
        onClick={() => handleOpenChange(true)}
        className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark shrink-0"
      >
        <ShoppingCartIcon className="size-4" aria-hidden="true" />
        Compras
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Registrar compra</DialogTitle>
            <DialogDescription>
              Registre, no mesmo pedido, filamentos, acessórios e embalagens — com um único frete.
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 py-2">
              {/* 1. Dados Gerais — Data e Local lado a lado em telas largas
                  (grade de 2 colunas); empilham sem rolagem horizontal no
                  estreito. Máscara dd/mm/aaaa e validações preservadas. */}
              <FormSection title="Dados Gerais">
                <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="purchase-date">Data da compra</Label>
                    <Input
                      id="purchase-date"
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="dd/mm/aaaa"
                      value={purchaseDateText}
                      onChange={(event) => {
                        setPurchaseDateText(maskBrDate(event.target.value))
                        setFieldErrors((current) => ({ ...current, purchase_date: '' }))
                      }}
                      disabled={isSubmitting}
                      aria-invalid={fieldErrors.purchase_date ? true : undefined}
                      className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-full sm:w-44"
                    />
                    {fieldErrors.purchase_date && (
                      <p className="text-destructive text-sm">{fieldErrors.purchase_date}</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label>Local da compra</Label>
                    <div role="radiogroup" aria-label="Local da compra" className="flex flex-wrap gap-2">
                      {CHANNEL_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={channel === option.value}
                          disabled={isSubmitting}
                          onClick={() => {
                            setChannel(option.value)
                            // trocar para uma opção padrão limpa o complemento anterior
                            if (!channelNeedsComplement(option.value)) setComplement('')
                            setFieldErrors((current) => ({ ...current, channel: '', complement: '' }))
                          }}
                          className={cn(
                            ACTION_BUTTON_CLASSNAME,
                            channel === option.value
                              ? ACTION_BUTTON_SELECTED_CLASSNAME
                              : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {fieldErrors.channel && <p className="text-destructive text-sm">{fieldErrors.channel}</p>}
                    {channelNeedsComplement(channel) && (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="purchase-complement">{complementLabel(channel)}</Label>
                        <Input
                          id="purchase-complement"
                          value={complement}
                          maxLength={200}
                          onChange={(event) => {
                            setComplement(event.target.value)
                            setFieldErrors((current) => ({ ...current, complement: '' }))
                          }}
                          disabled={isSubmitting}
                          aria-invalid={fieldErrors.complement ? true : undefined}
                          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-full"
                        />
                        {fieldErrors.complement && (
                          <p className="text-destructive text-sm">{fieldErrors.complement}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </FormSection>

              {/* 2. Itens — "+" só ícone no canto direito do cabeçalho da
                  seção. Cada linha é uma faixa compacta: quebra organizada
                  no médio/estreito, uma única linha a partir de lg, sem
                  rolagem horizontal. */}
              <FormSection
                title="Itens"
                headerRight={
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {items.length}/{MIXED_PURCHASE_MAX_ITEMS}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleAddItem}
                      disabled={isSubmitting || items.length >= MIXED_PURCHASE_MAX_ITEMS}
                      aria-label="Adicionar item"
                      title="Adicionar item"
                      className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                    >
                      <PlusIcon className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                }
              >
                {fieldErrors.items && <p className="text-destructive text-sm">{fieldErrors.items}</p>}

                <ul className="flex flex-col gap-3">
                  {items.map((item, index) => {
                    const lineNo = index + 1
                    return (
                      <li
                        key={item.key}
                        role="group"
                        aria-label={`Item ${lineNo}`}
                        className="border-border bg-background rounded-lg border p-3"
                      >
                        <div
                          data-line-fields="true"
                          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:gap-2 lg:flex-nowrap"
                        >
                          {/* Categoria — na MESMA linha dos demais campos,
                              agora só ícones (Filamento / Acessório /
                              Embalagem), mantendo o modelo de radiogroup. */}
                          <div className="flex shrink-0 flex-col gap-1">
                            <Label className={LINE_LABEL_CLASSNAME}>Categoria</Label>
                            <div
                              role="radiogroup"
                              aria-label={`Categoria — item ${lineNo}`}
                              className="flex gap-1"
                            >
                              {CATEGORY_ORDER.map((category) => {
                                const Icon = CATEGORY_ICON[category]
                                const selected = item.category === category
                                return (
                                  <button
                                    key={category}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    aria-label={CATEGORY_LABEL[category]}
                                    title={CATEGORY_LABEL[category]}
                                    disabled={isSubmitting}
                                    onClick={() => requestCategoryChange(item.key, category)}
                                    className={cn(
                                      'focus-visible:ring-brand-accent inline-flex size-9 items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
                                      selected
                                        ? ACTION_BUTTON_SELECTED_CLASSNAME
                                        : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                                    )}
                                  >
                                    <Icon className="size-4" aria-hidden="true" />
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {item.category === 'FILAMENT' ? (
                            <>
                              <div className="min-w-0 flex-1 sm:min-w-48 lg:min-w-0">
                                <FilamentTypeItemPicker
                                  index={lineNo}
                                  types={activeFilamentTypes}
                                  selectedId={item.filamentTypeId}
                                  onSelect={(id) => {
                                    updateItem(item.key, { filamentTypeId: id })
                                    clearItemError(item.key, 'filament_type_id')
                                  }}
                                  disabled={isSubmitting}
                                  error={fieldErrors[`item_${item.key}_filament_type_id`]}
                                  autoFocus={autoFocusItemKey === item.key}
                                />
                              </div>
                              <div className="flex flex-col gap-1 sm:w-36">
                                <Label
                                  htmlFor={`purchase-manufacturer-${lineNo}`}
                                  className={LINE_LABEL_CLASSNAME}
                                >
                                  Fabricante
                                </Label>
                                <Input
                                  id={`purchase-manufacturer-${lineNo}`}
                                  value={item.manufacturer}
                                  placeholder="Fabricante"
                                  onChange={(event) => {
                                    updateItem(item.key, { manufacturer: event.target.value })
                                    clearItemError(item.key, 'manufacturer')
                                  }}
                                  disabled={isSubmitting}
                                  aria-invalid={fieldErrors[`item_${item.key}_manufacturer`] ? true : undefined}
                                  className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                                />
                                {fieldErrors[`item_${item.key}_manufacturer`] && (
                                  <p className="text-destructive text-sm">
                                    {fieldErrors[`item_${item.key}_manufacturer`]}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col gap-1 sm:w-36">
                                <Label className={LINE_LABEL_CLASSNAME}>Peso nominal</Label>
                                <Select
                                  items={NOMINAL_WEIGHT_ITEMS}
                                  value={
                                    item.nominalWeightGrams === null ? '' : String(item.nominalWeightGrams)
                                  }
                                  onValueChange={(value) => {
                                    updateItem(item.key, {
                                      nominalWeightGrams: value ? Number(value) : null,
                                    })
                                    clearItemError(item.key, 'nominal_weight_grams')
                                  }}
                                >
                                  <SelectTrigger
                                    id={`purchase-nominal-weight-${lineNo}`}
                                    aria-label="Peso nominal"
                                    disabled={isSubmitting}
                                    aria-invalid={
                                      fieldErrors[`item_${item.key}_nominal_weight_grams`] ? true : undefined
                                    }
                                    className="w-full"
                                  >
                                    <SelectValue placeholder="Selecione o peso" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {NOMINAL_WEIGHT_OPTIONS.map((weight) => (
                                      <SelectItem key={weight} value={String(weight)}>
                                        {formatGrams(weight)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {fieldErrors[`item_${item.key}_nominal_weight_grams`] && (
                                  <p className="text-destructive text-sm">
                                    {fieldErrors[`item_${item.key}_nominal_weight_grams`]}
                                  </p>
                                )}
                              </div>
                              <QuantityAndTotalFields
                                lineNo={lineNo}
                                quantity={item.quantity}
                                totalValueField={item.totalValueField}
                                quantityError={fieldErrors[`item_${item.key}_quantity`]}
                                totalValueError={fieldErrors[`item_${item.key}_total_value`]}
                                disabled={isSubmitting}
                                onQuantityChange={(value) => {
                                  updateItem(item.key, { quantity: value })
                                  clearItemError(item.key, 'quantity')
                                }}
                                onTotalValueChange={(next) => {
                                  updateItem(item.key, { totalValueField: next })
                                  clearItemError(item.key, 'total_value')
                                }}
                              />
                            </>
                          ) : (
                            <>
                              <div className="min-w-0 flex-1 sm:min-w-48 lg:min-w-0">
                                <ActiveItemPicker
                                  index={lineNo}
                                  fieldLabel={item.category === 'ACCESSORY' ? 'Acessório' : 'Embalagem'}
                                  placeholder={
                                    item.category === 'ACCESSORY'
                                      ? 'Buscar acessório ativo'
                                      : 'Buscar embalagem ativa'
                                  }
                                  items={item.category === 'ACCESSORY' ? accessoryOptions : packagingOptions}
                                  selectedId={item.itemId}
                                  excludeIds={
                                    item.category === 'ACCESSORY' ? excludeAccessoryIds : excludePackagingIds
                                  }
                                  onSelect={(id) => {
                                    updateItem(item.key, { itemId: id })
                                    clearItemError(item.key, 'item_id')
                                  }}
                                  disabled={isSubmitting}
                                  error={fieldErrors[`item_${item.key}_item_id`]}
                                  autoFocus={autoFocusItemKey === item.key}
                                />
                              </div>
                              <QuantityAndTotalFields
                                lineNo={lineNo}
                                quantity={item.quantity}
                                totalValueField={item.totalValueField}
                                quantityError={fieldErrors[`item_${item.key}_quantity`]}
                                totalValueError={fieldErrors[`item_${item.key}_total_value`]}
                                disabled={isSubmitting}
                                onQuantityChange={(value) => {
                                  updateItem(item.key, { quantity: value })
                                  clearItemError(item.key, 'quantity')
                                }}
                                onTotalValueChange={(next) => {
                                  updateItem(item.key, { totalValueField: next })
                                  clearItemError(item.key, 'total_value')
                                }}
                              />
                            </>
                          )}

                          {/* Ações da linha — nunca confundidas com a seleção
                              de categoria: ícone de lixeira, à direita, com
                              aria-label próprio. */}
                          <div className="flex shrink-0 flex-col gap-1">
                            <span aria-hidden="true" className={cn(LINE_LABEL_CLASSNAME, 'select-none')}>
                              &nbsp;
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveItem(item.key)}
                              disabled={isSubmitting || items.length <= 1}
                              aria-label={`Remover item ${lineNo}`}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2Icon className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </FormSection>

              {/* 3. Frete */}
              <FormSection title="Frete">
                <CurrencyInput
                  id="purchase-freight"
                  label="Valor do frete"
                  state={freightField}
                  onChange={setFreightField}
                  disabled={isSubmitting}
                />
                <p className="text-muted-foreground text-xs">
                  O frete pertence ao pedido e é rateado proporcionalmente entre todas as linhas.
                </p>
              </FormSection>

              {/* 4. Resumo */}
              <FormSection title="Resumo">
                <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-3 gap-2 rounded-lg border px-3 py-2">
                  <div>
                    <p className="text-muted-foreground text-xs">Subtotal</p>
                    <p className="text-sm font-medium tabular-nums">{formatBRL(centsToAmount(subtotalCents))}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Frete</p>
                    <p className="text-sm font-medium tabular-nums">{formatBRL(centsToAmount(freightField.cents))}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Total da compra</p>
                    <p className="text-sm font-semibold tabular-nums">{formatBRL(centsToAmount(totalCents))}</p>
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  {items.length} {items.length === 1 ? 'linha' : 'linhas'} · {totalQuantity}{' '}
                  {totalQuantity === 1 ? 'unidade' : 'unidades'}
                </p>

                <ul className="flex flex-col gap-2">
                  {items.map((item, index) => {
                    const s = lineSummary(item, index)
                    return (
                      <li
                        key={item.key}
                        className="border-border flex flex-col gap-0.5 rounded-md border px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span className="font-medium">
                            {CATEGORY_LABEL[item.category]} · {itemDisplayLabel(item)}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {s.q ?? '—'} un · {formatBRL(centsToAmount(s.lineCents))}
                          </span>
                        </div>
                        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums">
                          <span>Frete atribuído: {formatBRL(centsToAmount(s.freightCents))}</span>
                          <span>
                            Custo desta compra/un.: {s.lotCostUn !== null ? formatBRL(s.lotCostUn) : '—'}
                          </span>
                          {item.category !== 'FILAMENT' && (
                            <span>
                              Novo custo médio/un.: {s.avgCostUn !== null ? formatBRL(s.avgCostUn) : '—'}
                            </span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <p className="text-muted-foreground text-xs">
                  Os custos abaixo são uma <strong>previsão</strong> — o valor final por unidade é
                  calculado pelo servidor ao registrar a compra.
                </p>
              </FormSection>

              {submitError && <p className="text-destructive text-sm">{submitError}</p>}
            </div>

            <DialogFooter className="mt-3 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
                className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
              >
                {isSubmitting ? 'Registrando...' : 'Registrar compra'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmação de troca de categoria (só quando há dados incompatíveis) */}
      <Dialog open={pendingSwitch !== null} onOpenChange={(open) => (!open ? setPendingSwitch(null) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Trocar a categoria da linha?</DialogTitle>
            <DialogDescription>
              Trocar a categoria vai apagar os campos já preenchidos que não se aplicam à nova categoria. A
              quantidade e o valor total são mantidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingSwitch(null)}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmCategoryChange}
              className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
            >
              Trocar categoria
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
