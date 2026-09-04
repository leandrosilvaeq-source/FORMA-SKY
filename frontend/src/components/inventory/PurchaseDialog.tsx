import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { toast } from 'sonner'
import {
  Disc3Icon,
  PackageIcon,
  PlusIcon,
  PuzzleIcon,
  ShoppingCartIcon,
  Trash2Icon,
} from 'lucide-react'
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
import { useAccessories } from '@/hooks/useAccessories'
import { usePackaging } from '@/hooks/usePackaging'
import { useFilamentTypes } from '@/hooks/useFilamentTypes'
import {
  registerFilamentPurchase,
  registerInventoryPurchase,
  type RegisterFilamentPurchaseInput,
  type RegisterFilamentPurchaseItemInput,
  type RegisterInventoryPurchaseInput,
} from '@/lib/api/inventoryPurchases'
import { ApiError } from '@/lib/api/errors'
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
import type { FilamentTypeSummary, InventoryPurchaseCategory } from '@/types/domain'

// Módulo 3, Incremento 5 (Compras) — pedido do usuário em 2026-08-28, depois
// do MVP manual de filamentos ter sido aprovado: fluxo centralizado de
// Compras (Filamentos/Acessórios/Embalagens) dentro do módulo Estoque, um
// único botão/diálogo compartilhado pelas três áreas (nunca duplicado por
// página — InventoryPageShell.tsx renderiza este componente uma vez só).
// Toda compra concluída chama a Edge Function `inventory-purchases`,
// transacional: para Acessório/Embalagem, registra o movimento de entrada no
// item já cadastrado. Nenhum saldo é escrito pelo frontend — a RPC é sempre
// a única escrita.
//
// Filamento (revisão de 2026-09-04 — "Compra de filamentos" reestruturada
// para aceitar VÁRIOS itens/tipos/marcas na mesma compra): a janela deixa de
// registrar um único item e passa a ter uma lista dinâmica de itens (cada um
// com Tipo de filamento, Peso líquido, Quantidade, Marca e Valor unitário) +
// um frete total único (Dados gerais da compra). Ao salvar, chama
// POST /inventory-purchases/filament -> register_filament_purchase, que cria
// um único cabeçalho + todos os itens + todos os rolos correspondentes numa
// única transação atômica (falha em qualquer item/rolo reverte a compra
// inteira). Cada item exige um filament_type_id JÁ CADASTRADO em Estoque ->
// Filamentos — nunca cria nem localiza tipo por Material/Cor/Acabamento. O
// fornecedor da compra (marca de cada item) nunca altera o cadastro do tipo.

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Padrão brasileiro de milhar — "1000" nunca aparece sem formatação ao
// usuário; sempre "1.000 g".
function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR')} g`
}

const ACTION_BUTTON_CLASSNAME =
  'focus-visible:ring-brand-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_BUTTON_SELECTED_CLASSNAME =
  'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
const ACTION_BUTTON_UNSELECTED_CLASSNAME =
  'border-input text-muted-foreground hover:bg-muted hover:text-foreground'

type IconComponent = ComponentType<{ className?: string }>

// Ordem exigida: Filamento, Acessório, Embalagem.
const CATEGORY_ITEMS: Array<{
  value: InventoryPurchaseCategory
  label: string
  Icon: IconComponent
}> = [
  { value: 'FILAMENT', label: 'Filamento', Icon: Disc3Icon },
  { value: 'ACCESSORY', label: 'Acessório', Icon: PuzzleIcon },
  { value: 'PACKAGING', label: 'Embalagem', Icon: PackageIcon },
]

// Peso líquido: só os 3 valores pedidos, como action buttons — valores
// numéricos internos preservados exatamente (250/500/1000), nunca um campo
// de texto livre nesta etapa. Exibidos no padrão brasileiro (formatGrams).
const NOMINAL_WEIGHT_OPTIONS = [250, 500, 1000] as const

interface CurrencyFieldState {
  cents: number
  hasEdited: boolean
}

function emptyCurrencyField(): CurrencyFieldState {
  return { cents: 0, hasEdited: false }
}

// Campo de valor monetário "bancário" (dígito sempre entra pela direita) —
// mesmo comportamento de ProductPriceForm.tsx/RegisterPaymentForm.tsx,
// reaproveitado aqui para os campos de valor desta tela (Valor dos itens/
// Frete de Acessório-Embalagem; Valor unitário por item + Frete de
// Filamento) via um pequeno componente de apresentação, em vez de duplicar
// os 3 handlers em cada instância.
function CurrencyInput({
  id,
  label,
  state,
  onChange,
  disabled,
  error,
}: {
  id: string
  label: string
  state: CurrencyFieldState
  onChange: (next: CurrencyFieldState) => void
  disabled: boolean
  error?: string
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
      'Tab',
      'Shift',
      'Control',
      'Meta',
      'Alt',
      'Escape',
      'Enter',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
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
        className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-40"
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  )
}

// Select pesquisável de itens ATIVOS (Acessório/Embalagem) — nunca mostra
// inativos, nunca cria cadastro automaticamente (requisito 9/10: "se o item
// não existir, orientar cadastrá-lo primeiro na aba correspondente").
// Montado só quando a categoria correspondente está selecionada (ver
// PurchaseDialog abaixo) — o hook (useAccessories/usePackaging) só busca a
// listagem enquanto esta sub-tela está de fato visível, nunca a cada
// abertura do diálogo de compras inteiro.
function AccessoryItemPicker({
  selectedId,
  onSelect,
  disabled,
  error,
}: {
  selectedId: string | null
  onSelect: (id: string | null, label: string) => void
  disabled: boolean
  error?: string
}) {
  const { accessories, isLoading } = useAccessories()
  const [searchTerm, setSearchTerm] = useState('')
  const activeItems = accessories.filter((item) => item.is_active)
  const suggestions = activeItems.map((item) => ({
    id: item.id,
    label: item.variant ? `${item.name} — ${item.variant}` : item.name,
  }))

  function handleSelect(label: string) {
    const match = suggestions.find((suggestion) => suggestion.label === label)
    setSearchTerm(label)
    onSelect(match?.id ?? null, label)
  }

  if (!isLoading && activeItems.length === 0) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Nenhum acessório ativo cadastrado. Cadastre um na aba Acessórios antes de registrar esta
        compra.
      </p>
    )
  }

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex flex-col gap-2">
        <Label htmlFor="purchase-accessory">Acessório</Label>
        <SearchAutocomplete
          value={searchTerm}
          onValueChange={(value) => {
            setSearchTerm(value)
            onSelect(null, value)
          }}
          suggestions={suggestions}
          onSelect={handleSelect}
          ariaLabel="Acessório"
          placeholder="Buscar acessório ativo"
          clearLabel="Limpar seleção de acessório"
          listboxId="purchase-accessory-listbox"
          listboxAriaLabel="Sugestões de acessório"
          noResultsText="Nenhum acessório ativo encontrado."
        />
        {selectedId === null && searchTerm && (
          <p className="text-muted-foreground text-xs">Selecione um acessório da lista.</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </fieldset>
  )
}

// Select pesquisável de UM tipo de filamento ATIVO já cadastrado em
// Estoque -> Filamentos, usado por CADA linha de item da compra (2026-09-04
// — vários itens/tipos/marcas na mesma compra). Cada opção é UM
// filament_type_id (nunca o grupo consolidado da listagem), rotulada
// "Material - Linha - Cor" (fabricante não entra no rótulo — pedido
// explícito). Busca própria por Material/Linha/Cor (mesmo texto do rótulo),
// já que SearchAutocomplete não filtra sozinho — só destaca o trecho
// buscado nas sugestões já filtradas que o chamador passa. `types`/
// `isLoading` vêm de um ÚNICO useFilamentTypes() no componente pai (nunca um
// por linha) — evita N buscas redundantes quando a compra tem vários itens.
// Rótulos/ids incluem o número do item (index, 1-based) para nunca colidir
// entre linhas (múltiplas instâncias no mesmo formulário).
function FilamentTypeItemPicker({
  index,
  types,
  selectedId,
  onSelect,
  disabled,
  error,
}: {
  index: number
  types: FilamentTypeSummary[]
  selectedId: string | null
  onSelect: (id: string | null, label: string) => void
  disabled: boolean
  error?: string
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const allSuggestions = types.map((type) => ({
    id: type.filament_type_id,
    label: `${type.material} - ${type.line} - ${type.commercial_color}`,
  }))
  const normalizedTerm = normalizeForSearch(searchTerm)
  const suggestions = normalizedTerm
    ? allSuggestions.filter((suggestion) =>
        normalizeForSearch(suggestion.label).includes(normalizedTerm),
      )
    : allSuggestions
  const fieldLabel = `Tipo de filamento — item ${index}`

  function handleSelect(label: string) {
    const match = suggestions.find((suggestion) => suggestion.label === label)
    setSearchTerm(label)
    onSelect(match?.id ?? null, label)
  }

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`purchase-filament-type-${index}`}>{fieldLabel}</Label>
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
        />
        {selectedId === null && searchTerm && (
          <p className="text-muted-foreground text-xs">Selecione um tipo de filamento da lista.</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </fieldset>
  )
}

function PackagingItemPicker({
  selectedId,
  onSelect,
  disabled,
  error,
}: {
  selectedId: string | null
  onSelect: (id: string | null, label: string) => void
  disabled: boolean
  error?: string
}) {
  const { packaging, isLoading } = usePackaging()
  const [searchTerm, setSearchTerm] = useState('')
  const activeItems = packaging.filter((item) => item.is_active)
  const suggestions = activeItems.map((item) => ({
    id: item.id,
    label: item.variant ? `${item.name} — ${item.variant}` : item.name,
  }))

  function handleSelect(label: string) {
    const match = suggestions.find((suggestion) => suggestion.label === label)
    setSearchTerm(label)
    onSelect(match?.id ?? null, label)
  }

  if (!isLoading && activeItems.length === 0) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Nenhuma embalagem ativa cadastrada. Cadastre uma na aba Embalagens antes de registrar esta
        compra.
      </p>
    )
  }

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex flex-col gap-2">
        <Label htmlFor="purchase-packaging">Embalagem</Label>
        <SearchAutocomplete
          value={searchTerm}
          onValueChange={(value) => {
            setSearchTerm(value)
            onSelect(null, value)
          }}
          suggestions={suggestions}
          onSelect={handleSelect}
          ariaLabel="Embalagem"
          placeholder="Buscar embalagem ativa"
          clearLabel="Limpar seleção de embalagem"
          listboxId="purchase-packaging-listbox"
          listboxAriaLabel="Sugestões de embalagem"
          noResultsText="Nenhuma embalagem ativa encontrada."
        />
        {selectedId === null && searchTerm && (
          <p className="text-muted-foreground text-xs">Selecione uma embalagem da lista.</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </fieldset>
  )
}

// Um item da "Compra de filamentos" (2026-09-04) — estado local de
// formulário, nunca enviado assim (handleFilamentSubmit converte para
// RegisterFilamentPurchaseItemInput). `key` é gerado uma vez por item
// (crypto.randomUUID()), usado como React key e para escopar erros de campo
// (fieldErrors), nunca reaproveitado entre itens diferentes mesmo depois de
// remover/adicionar outros.
interface FilamentPurchaseItemState {
  key: string
  filamentTypeId: string | null
  nominalWeightGrams: number | null
  quantity: string
  manufacturer: string
  unitValueField: CurrencyFieldState
}

function emptyFilamentItem(): FilamentPurchaseItemState {
  return {
    key: crypto.randomUUID(),
    filamentTypeId: null,
    nominalWeightGrams: null,
    quantity: '',
    manufacturer: '',
    unitValueField: emptyCurrencyField(),
  }
}

export interface PurchaseDialogProps {
  // Chamado após uma compra concluída com sucesso, com a categoria
  // comprada — cada página de área decide se aquilo afeta os dados que ela
  // própria exibe (ex.: FilamentsInventoryPage só refaz a busca quando
  // category === 'FILAMENT') e chama seu próprio refetch, sem esta
  // exigir/assumir qual hook cada página usa.
  onPurchaseCompleted: (category: InventoryPurchaseCategory) => void
}

export function PurchaseDialog({ onPurchaseCompleted }: PurchaseDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [category, setCategory] = useState<InventoryPurchaseCategory | null>(null)

  // Acessório/Embalagem
  const [itemId, setItemId] = useState<string | null>(null)

  // Filamento (2026-09-04) — a compra tem uma lista dinâmica de itens, cada
  // um com seu próprio tipo/peso líquido/quantidade/marca/valor unitário;
  // useFilamentTypes() é chamado UMA ÚNICA VEZ aqui (nunca um por linha),
  // repassado como prop para cada FilamentTypeItemPicker.
  const [filamentItems, setFilamentItems] = useState<FilamentPurchaseItemState[]>([])
  const { types: filamentTypes, isLoading: isLoadingFilamentTypes } = useFilamentTypes()
  const activeFilamentTypes = filamentTypes.filter((type) => type.is_active)

  // Compartilhados: quantidade/Valor dos itens são usados só por Acessório/
  // Embalagem a partir desta rodada (Filamento passou a ter quantidade e
  // valor unitário por item, ver filamentItems acima). Frete continua
  // compartilhado pelas 3 categorias — informado uma única vez por compra,
  // nunca dividido entre itens/rolos.
  const [quantity, setQuantity] = useState('')
  const [itemValueField, setItemValueField] = useState<CurrencyFieldState>(emptyCurrencyField())
  const [freightValueField, setFreightValueField] =
    useState<CurrencyFieldState>(emptyCurrencyField())

  // Idempotência (mesmo padrão de StockMovementForm.tsx): a MESMA chave é
  // reenviada enquanto o payload não muda entre tentativas (retry seguro de
  // duplo clique/falha de rede); qualquer mudança gera uma chave nova.
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
    setCategory(null)
    setItemId(null)
    setFilamentItems([])
    setQuantity('')
    setItemValueField(emptyCurrencyField())
    setFreightValueField(emptyCurrencyField())
    setFieldErrors({})
    setSubmitError(null)
    idempotencyRef.current = null
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm()
    setIsOpen(next)
  }

  function handleCategoryChange(next: InventoryPurchaseCategory) {
    setCategory(next)
    setItemId(null)
    // Ao entrar em Filamento, a janela já apresenta um item vazio; ao sair,
    // a lista é descartada (reconstruída do zero se o usuário voltar).
    setFilamentItems(next === 'FILAMENT' ? [emptyFilamentItem()] : [])
    setQuantity('')
    setFieldErrors({})
  }

  function handleAddFilamentItem() {
    setFilamentItems((current) => [...current, emptyFilamentItem()])
  }

  function handleRemoveFilamentItem(key: string) {
    setFilamentItems((current) => current.filter((item) => item.key !== key))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[`item_${key}_filament_type_id`]
      delete next[`item_${key}_nominal_weight_grams`]
      delete next[`item_${key}_quantity`]
      delete next[`item_${key}_manufacturer`]
      delete next[`item_${key}_unit_value`]
      return next
    })
  }

  function updateFilamentItem(key: string, patch: Partial<FilamentPurchaseItemState>) {
    setFilamentItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    )
  }

  function clearFilamentItemError(key: string, field: string) {
    setFieldErrors((current) => ({ ...current, [`item_${key}_${field}`]: '' }))
  }

  const parsedQuantity = parseNumberField(quantity, 'a quantidade', { integer: true }).value

  function handleQuantityChange(raw: string) {
    setQuantity(raw)
    setFieldErrors((current) => ({ ...current, quantity: '' }))
  }

  // Único bloco de JSX reaproveitado em 2 posições diferentes (Acessório e
  // Embalagem) — Filamento não usa mais este campo (quantidade passou a ser
  // por item, ver filamentItems).
  const quantityField = (
    <div className="flex flex-col gap-2">
      <Label htmlFor="purchase-quantity">Quantidade</Label>
      <Input
        id="purchase-quantity"
        inputMode="numeric"
        value={quantity}
        onChange={(event) => handleQuantityChange(event.target.value)}
        disabled={isSubmitting}
        aria-invalid={fieldErrors.quantity ? true : undefined}
        className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-24"
      />
      {fieldErrors.quantity && <p className="text-destructive text-sm">{fieldErrors.quantity}</p>}
    </div>
  )

  const itemValueReais = centsToAmount(itemValueField.cents)
  const freightValueReais = centsToAmount(freightValueField.cents)
  const totalReais = itemValueReais + freightValueReais
  const averageUnitCost =
    parsedQuantity && parsedQuantity > 0 ? itemValueReais / parsedQuantity : null

  // Totais de Filamento (Subtotal/Frete/Total) — calculados só a partir dos
  // valores já informados nos itens, nunca distribuindo o frete entre eles.
  const filamentSubtotalReais = filamentItems.reduce((sum, item) => {
    const itemQuantity = parseNumberField(item.quantity, 'a quantidade', { integer: true }).value
    if (!itemQuantity || itemQuantity <= 0) return sum
    return sum + itemQuantity * centsToAmount(item.unitValueField.cents)
  }, 0)
  const filamentTotalReais = filamentSubtotalReais + freightValueReais

  async function handleAccessoryOrPackagingSubmit() {
    if (category !== 'ACCESSORY' && category !== 'PACKAGING') return

    const errors: Record<string, string> = {}

    const quantityResult = parseNumberField(quantity, 'a quantidade', {
      required: true,
      min: 1,
      integer: true,
    })
    if (quantityResult.error) errors.quantity = quantityResult.error

    if (!itemValueField.hasEdited) {
      errors.item_value = 'Informe o valor dos itens.'
    }

    if (!itemId) {
      errors.item_id =
        category === 'ACCESSORY' ? 'Selecione um acessório.' : 'Selecione uma embalagem.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    const input: RegisterInventoryPurchaseInput = {
      category,
      quantity: quantityResult.value as number,
      item_value: itemValueReais,
      freight_value: freightValueReais,
      item_id: itemId as string,
    }
    const fingerprint = JSON.stringify(input)

    setFieldErrors({})
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await registerInventoryPurchase({ ...input, idempotency_key: getIdempotencyKey(fingerprint) })
      toast.success('Compra registrada.')
      onPurchaseCompleted(category)
      handleOpenChange(false)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setSubmitError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleFilamentSubmit() {
    const errors: Record<string, string> = {}

    if (filamentItems.length === 0) {
      errors.items = 'Adicione ao menos um item de compra.'
    }

    const validatedItems: RegisterFilamentPurchaseItemInput[] = []

    for (const item of filamentItems) {
      let itemHasError = false

      if (!item.filamentTypeId) {
        errors[`item_${item.key}_filament_type_id`] = 'Selecione um tipo de filamento.'
        itemHasError = true
      }
      if (!item.nominalWeightGrams) {
        errors[`item_${item.key}_nominal_weight_grams`] = 'Selecione o peso líquido.'
        itemHasError = true
      }

      const quantityResult = parseNumberField(item.quantity, 'a quantidade', {
        required: true,
        min: 1,
        integer: true,
      })
      if (quantityResult.error) {
        errors[`item_${item.key}_quantity`] = quantityResult.error
        itemHasError = true
      }

      const manufacturer = item.manufacturer.trim()
      if (!manufacturer) {
        errors[`item_${item.key}_manufacturer`] = 'Informe a marca.'
        itemHasError = true
      }

      if (!item.unitValueField.hasEdited) {
        errors[`item_${item.key}_unit_value`] = 'Informe o valor unitário.'
        itemHasError = true
      }

      if (!itemHasError) {
        validatedItems.push({
          filament_type_id: item.filamentTypeId as string,
          manufacturer,
          nominal_weight_grams: item.nominalWeightGrams as number,
          quantity: quantityResult.value as number,
          unit_value: centsToAmount(item.unitValueField.cents),
        })
      }
    }

    if (Object.keys(errors).length > 0 || validatedItems.length === 0) {
      setFieldErrors(errors)
      return
    }

    const filamentInput: RegisterFilamentPurchaseInput = {
      freight_value: freightValueReais,
      items: validatedItems,
    }
    const fingerprint = JSON.stringify(filamentInput)

    setFieldErrors({})
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await registerFilamentPurchase({
        ...filamentInput,
        idempotency_key: getIdempotencyKey(fingerprint),
      })
      toast.success('Compra registrada.')
      onPurchaseCompleted('FILAMENT')
      handleOpenChange(false)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setSubmitError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!category) return

    if (category === 'FILAMENT') {
      void handleFilamentSubmit()
      return
    }
    void handleAccessoryOrPackagingSubmit()
  }

  return (
    <>
      <Button
        onClick={() => handleOpenChange(true)}
        variant="outline"
        className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0"
      >
        <ShoppingCartIcon className="size-4" aria-hidden="true" />
        Compras
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {category === 'FILAMENT' ? 'Compra de filamentos' : 'Registrar compra'}
            </DialogTitle>
            <DialogDescription>
              {category === 'FILAMENT'
                ? 'Registre um ou mais filamentos na mesma compra — os rolos correspondentes são criados automaticamente no estoque.'
                : 'Selecione o item e preencha os dados da compra — a entrada correspondente é lançada automaticamente no estoque.'}
            </DialogDescription>
          </DialogHeader>

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label>Item</Label>
              <div role="radiogroup" aria-label="Item" className="flex flex-wrap gap-2">
                {CATEGORY_ITEMS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={category === item.value}
                    disabled={isSubmitting}
                    onClick={() => handleCategoryChange(item.value)}
                    className={cn(
                      ACTION_BUTTON_CLASSNAME,
                      category === item.value
                        ? ACTION_BUTTON_SELECTED_CLASSNAME
                        : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                    )}
                  >
                    <item.Icon className="text-brand-primary size-8 shrink-0" aria-hidden="true" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {category === 'FILAMENT' && (
              <>
                {/* 1. Dados gerais da compra */}
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <p className="text-sm font-medium">Dados gerais da compra</p>
                  <CurrencyInput
                    id="purchase-filament-freight"
                    label="Frete total da compra"
                    state={freightValueField}
                    onChange={setFreightValueField}
                    disabled={isSubmitting}
                  />
                </div>

                {/* 2. Itens da compra */}
                {!isLoadingFilamentTypes && activeFilamentTypes.length === 0 ? (
                  <p role="status" className="text-muted-foreground text-sm">
                    Cadastre um tipo de filamento antes de registrar a compra.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium">Itens da compra</p>
                    {fieldErrors.items && (
                      <p className="text-destructive text-sm">{fieldErrors.items}</p>
                    )}

                    {filamentItems.map((item, index) => (
                      <div
                        key={item.key}
                        className="border-input flex flex-col gap-3 rounded-lg border p-3"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-muted-foreground text-xs font-medium">
                            Item {index + 1}
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={isSubmitting}
                            onClick={() => handleRemoveFilamentItem(item.key)}
                            className="text-destructive hover:text-destructive h-auto gap-1 p-1 text-xs"
                          >
                            <Trash2Icon className="size-3.5" aria-hidden="true" />
                            Remover item
                          </Button>
                        </div>

                        <FilamentTypeItemPicker
                          index={index + 1}
                          types={activeFilamentTypes}
                          selectedId={item.filamentTypeId}
                          onSelect={(id) => {
                            updateFilamentItem(item.key, { filamentTypeId: id })
                            clearFilamentItemError(item.key, 'filament_type_id')
                          }}
                          disabled={isSubmitting}
                          error={fieldErrors[`item_${item.key}_filament_type_id`]}
                        />

                        <div className="flex flex-col gap-2">
                          <Label>{`Peso líquido — item ${index + 1}`}</Label>
                          <div
                            role="radiogroup"
                            aria-label={`Peso líquido — item ${index + 1}`}
                            className="flex flex-wrap gap-2"
                          >
                            {NOMINAL_WEIGHT_OPTIONS.map((option) => (
                              <button
                                key={option}
                                type="button"
                                role="radio"
                                aria-checked={item.nominalWeightGrams === option}
                                disabled={isSubmitting}
                                onClick={() => {
                                  updateFilamentItem(item.key, { nominalWeightGrams: option })
                                  clearFilamentItemError(item.key, 'nominal_weight_grams')
                                }}
                                className={cn(
                                  'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                                  item.nominalWeightGrams === option
                                    ? ACTION_BUTTON_SELECTED_CLASSNAME
                                    : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                                )}
                              >
                                {formatGrams(option)}
                              </button>
                            ))}
                          </div>
                          {fieldErrors[`item_${item.key}_nominal_weight_grams`] && (
                            <p className="text-destructive text-sm">
                              {fieldErrors[`item_${item.key}_nominal_weight_grams`]}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-4">
                          <div className="flex flex-col gap-2">
                            <Label htmlFor={`purchase-item-${item.key}-quantity`}>Quantidade</Label>
                            <Input
                              id={`purchase-item-${item.key}-quantity`}
                              inputMode="numeric"
                              value={item.quantity}
                              onChange={(event) => {
                                updateFilamentItem(item.key, { quantity: event.target.value })
                                clearFilamentItemError(item.key, 'quantity')
                              }}
                              disabled={isSubmitting}
                              aria-invalid={
                                fieldErrors[`item_${item.key}_quantity`] ? true : undefined
                              }
                              className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-24"
                            />
                            {fieldErrors[`item_${item.key}_quantity`] && (
                              <p className="text-destructive text-sm">
                                {fieldErrors[`item_${item.key}_quantity`]}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-col gap-2">
                            <Label htmlFor={`purchase-item-${item.key}-manufacturer`}>Marca</Label>
                            <Input
                              id={`purchase-item-${item.key}-manufacturer`}
                              value={item.manufacturer}
                              placeholder="Ex.: Bambu Lab"
                              onChange={(event) => {
                                updateFilamentItem(item.key, { manufacturer: event.target.value })
                                clearFilamentItemError(item.key, 'manufacturer')
                              }}
                              disabled={isSubmitting}
                              aria-invalid={
                                fieldErrors[`item_${item.key}_manufacturer`] ? true : undefined
                              }
                              className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-40"
                            />
                            {fieldErrors[`item_${item.key}_manufacturer`] && (
                              <p className="text-destructive text-sm">
                                {fieldErrors[`item_${item.key}_manufacturer`]}
                              </p>
                            )}
                          </div>

                          <CurrencyInput
                            id={`purchase-item-${item.key}-unit-value`}
                            label="Valor unitário"
                            state={item.unitValueField}
                            onChange={(next) => {
                              updateFilamentItem(item.key, { unitValueField: next })
                              clearFilamentItemError(item.key, 'unit_value')
                            }}
                            disabled={isSubmitting}
                            error={fieldErrors[`item_${item.key}_unit_value`]}
                          />
                        </div>
                      </div>
                    ))}

                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSubmitting}
                      onClick={handleAddFilamentItem}
                      className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark self-start"
                    >
                      <PlusIcon className="size-4" aria-hidden="true" />
                      Adicionar filamento
                    </Button>
                  </div>
                )}

                <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-3 gap-2 rounded-lg border px-3 py-2">
                  <div>
                    <p className="text-muted-foreground text-xs">Subtotal dos filamentos</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {formatBRL(filamentSubtotalReais)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Frete</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {formatBRL(freightValueReais)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Total da compra</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {formatBRL(filamentTotalReais)}
                    </p>
                  </div>
                </div>
              </>
            )}

            {category === 'ACCESSORY' && (
              <>
                <AccessoryItemPicker
                  selectedId={itemId}
                  onSelect={(id) => {
                    setItemId(id)
                    setFieldErrors((current) => ({ ...current, item_id: '' }))
                  }}
                  disabled={isSubmitting}
                  error={fieldErrors.item_id}
                />
                {quantityField}
              </>
            )}

            {category === 'PACKAGING' && (
              <>
                <PackagingItemPicker
                  selectedId={itemId}
                  onSelect={(id) => {
                    setItemId(id)
                    setFieldErrors((current) => ({ ...current, item_id: '' }))
                  }}
                  disabled={isSubmitting}
                  error={fieldErrors.item_id}
                />
                {quantityField}
              </>
            )}

            {(category === 'ACCESSORY' || category === 'PACKAGING') && (
              <>
                <div className="flex flex-wrap gap-4">
                  <CurrencyInput
                    id="purchase-item-value"
                    label="Valor dos itens"
                    state={itemValueField}
                    onChange={(next) => {
                      setItemValueField(next)
                      setFieldErrors((current) => ({ ...current, item_value: '' }))
                    }}
                    disabled={isSubmitting}
                    error={fieldErrors.item_value}
                  />
                  <CurrencyInput
                    id="purchase-freight-value"
                    label="Frete"
                    state={freightValueField}
                    onChange={setFreightValueField}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-2 gap-2 rounded-lg border px-3 py-2 sm:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground text-xs">Valor dos itens</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {formatBRL(itemValueReais)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Frete</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {formatBRL(freightValueReais)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Total da compra</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {formatBRL(totalReais)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Custo médio por unidade</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {averageUnitCost !== null ? formatBRL(averageUnitCost) : '—'}
                    </p>
                  </div>
                </div>
              </>
            )}

            {submitError && <p className="text-destructive text-sm">{submitError}</p>}

            <DialogFooter>
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
                disabled={isSubmitting || !category}
                className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
              >
                {isSubmitting ? 'Registrando...' : 'Registrar compra'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
