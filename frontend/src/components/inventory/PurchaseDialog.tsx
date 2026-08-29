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
import { Disc3Icon, PackageIcon, PuzzleIcon, ShoppingCartIcon } from 'lucide-react'
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAccessories } from '@/hooks/useAccessories'
import { usePackaging } from '@/hooks/usePackaging'
import { registerInventoryPurchase, type RegisterInventoryPurchaseInput } from '@/lib/api/inventoryPurchases'
import { ApiError } from '@/lib/api/errors'
import { parseNumberField } from '@/lib/forms/numberField'
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
import type { FilamentMaterial, InventoryPurchaseCategory } from '@/types/domain'

// Módulo 3, Incremento 5 (Compras) — pedido do usuário em 2026-08-28, depois
// do MVP manual de filamentos ter sido aprovado: fluxo centralizado de
// Compras (Filamentos/Acessórios/Embalagens) dentro do módulo Estoque, um
// único botão/diálogo compartilhado pelas três áreas (nunca duplicado por
// página — InventoryPageShell.tsx renderiza este componente uma vez só).
// Toda compra concluída chama register_inventory_purchase (Edge Function
// `inventory-purchases`), transacional: para Filamento, localiza/cria o
// tipo e cria N rolos + movimentos de entrada; para Acessório/Embalagem,
// registra o movimento de entrada no item já cadastrado. Nenhum saldo é
// escrito pelo frontend — a RPC é sempre a única escrita.

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const ACTION_BUTTON_CLASSNAME =
  'focus-visible:ring-brand-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_BUTTON_SELECTED_CLASSNAME = 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
const ACTION_BUTTON_UNSELECTED_CLASSNAME = 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'

type IconComponent = ComponentType<{ className?: string }>

// Ordem exigida: Filamento, Acessório, Embalagem.
const CATEGORY_ITEMS: Array<{ value: InventoryPurchaseCategory; label: string; Icon: IconComponent }> = [
  { value: 'FILAMENT', label: 'Filamento', Icon: Disc3Icon },
  { value: 'ACCESSORY', label: 'Acessório', Icon: PuzzleIcon },
  { value: 'PACKAGING', label: 'Embalagem', Icon: PackageIcon },
]

// Nunca ABS — mesmo fechamento já usado em FilamentTypeForm.tsx.
const MATERIAL_OPTIONS: FilamentMaterial[] = ['PLA', 'PETG', 'TPU']

// Peso líquido: só os 3 valores pedidos, como action buttons — valores
// numéricos internos preservados exatamente (250/500/1000), nunca um campo
// de texto livre nesta etapa.
const NOMINAL_WEIGHT_OPTIONS = [250, 500, 1000] as const

// Acabamento — lista própria desta tela (pedido explícito desta rodada),
// deliberadamente diferente das 5 sugestões livres já usadas em
// FilamentTypeForm.tsx (Sólida/Silk/Velvet/Translúcido/DuoColor): aqui é
// mapeado 1:1 para filament_types.line (texto livre no banco, sem CHECK),
// nunca reaproveitando o rótulo "Tipo" para evitar dois campos com o mesmo
// nome na tela (material já é escolhido acima).
const FINISH_OPTIONS = ['Sólido', 'Velvet', 'Silk', 'DuoColor', 'TriColor', 'Transparente'] as const

interface CurrencyFieldState {
  cents: number
  hasEdited: boolean
}

function emptyCurrencyField(): CurrencyFieldState {
  return { cents: 0, hasEdited: false }
}

// Campo de valor monetário "bancário" (dígito sempre entra pela direita) —
// mesmo comportamento de ProductPriceForm.tsx/RegisterPaymentForm.tsx,
// reaproveitado aqui para os dois campos independentes desta tela (Valor
// dos itens, Frete) via um pequeno componente de apresentação, em vez de
// duplicar os 3 handlers duas vezes.
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
        className="w-40 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
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
        Nenhum acessório ativo cadastrado. Cadastre um na aba Acessórios antes de registrar esta compra.
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
        Nenhuma embalagem ativa cadastrada. Cadastre uma na aba Embalagens antes de registrar esta compra.
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

  // Filamento
  const [material, setMaterial] = useState<FilamentMaterial | null>(null)
  const [nominalWeightGrams, setNominalWeightGrams] = useState<number | null>(null)
  const [grossWeights, setGrossWeights] = useState<string[]>([])
  const [manufacturer, setManufacturer] = useState('')
  const [commercialColor, setCommercialColor] = useState('')
  const [finish, setFinish] = useState<string | null>(null)

  // Compartilhados
  const [quantity, setQuantity] = useState('')
  const [itemValueField, setItemValueField] = useState<CurrencyFieldState>(emptyCurrencyField())
  const [freightValueField, setFreightValueField] = useState<CurrencyFieldState>(emptyCurrencyField())

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
    setMaterial(null)
    setNominalWeightGrams(null)
    setGrossWeights([])
    setManufacturer('')
    setCommercialColor('')
    setFinish(null)
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
    setMaterial(null)
    setNominalWeightGrams(null)
    setGrossWeights([])
    setManufacturer('')
    setCommercialColor('')
    setFinish(null)
    setQuantity('')
    setFieldErrors({})
  }

  const parsedQuantity = parseNumberField(quantity, 'a quantidade', { integer: true }).value

  function handleQuantityChange(raw: string) {
    setQuantity(raw)
    setFieldErrors((current) => ({ ...current, quantity: '' }))
    const n = parseNumberField(raw, 'a quantidade', { integer: true }).value
    if (category === 'FILAMENT' && n !== undefined && n > 0) {
      setGrossWeights((current) => Array.from({ length: n }, (_, i) => current[i] ?? ''))
    }
  }

  function handleGrossWeightChange(index: number, raw: string) {
    setGrossWeights((current) => current.map((value, i) => (i === index ? raw : value)))
    setFieldErrors((current) => ({ ...current, [`gross_weight_${index}`]: '' }))
  }

  // Único bloco de JSX reaproveitado em 3 posições diferentes (a ordem
  // pedida difere por categoria: 3º campo em Filamento, logo após o item em
  // Acessório/Embalagem) — nunca duplicado como três blocos de marcação
  // independentes.
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
        className="w-24 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
      />
      {fieldErrors.quantity && <p className="text-destructive text-sm">{fieldErrors.quantity}</p>}
    </div>
  )

  const itemValueReais = centsToAmount(itemValueField.cents)
  const freightValueReais = centsToAmount(freightValueField.cents)
  const totalReais = itemValueReais + freightValueReais
  const averageUnitCost = parsedQuantity && parsedQuantity > 0 ? itemValueReais / parsedQuantity : null
  const costPerKg =
    category === 'FILAMENT' && nominalWeightGrams && parsedQuantity && parsedQuantity > 0
      ? itemValueReais / ((parsedQuantity * nominalWeightGrams) / 1000)
      : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!category) return

    const errors: Record<string, string> = {}

    const quantityResult = parseNumberField(quantity, 'a quantidade', { required: true, min: 1, integer: true })
    if (quantityResult.error) errors.quantity = quantityResult.error

    if (!itemValueField.hasEdited) {
      errors.item_value = 'Informe o valor dos itens.'
    }

    let input: RegisterInventoryPurchaseInput | null = null
    let fingerprint = ''

    if (category === 'ACCESSORY' || category === 'PACKAGING') {
      if (!itemId) {
        errors.item_id = category === 'ACCESSORY' ? 'Selecione um acessório.' : 'Selecione uma embalagem.'
      }

      if (Object.keys(errors).length === 0) {
        input = {
          category,
          quantity: quantityResult.value as number,
          item_value: itemValueReais,
          freight_value: freightValueReais,
          item_id: itemId as string,
        }
        fingerprint = JSON.stringify(input)
      }
    } else {
      if (!material) errors.material = 'Selecione o material.'
      if (!nominalWeightGrams) errors.nominal_weight_grams = 'Selecione o peso líquido.'

      const trimmedManufacturer = manufacturer.trim()
      if (!trimmedManufacturer) errors.manufacturer = 'Informe a marca.'

      const trimmedColor = commercialColor.trim()
      if (!trimmedColor) errors.commercial_color = 'Informe a cor.'

      if (!finish) errors.line = 'Selecione o acabamento.'

      const parsedGrossWeights: number[] = []
      if (quantityResult.value !== undefined && nominalWeightGrams) {
        for (let i = 0; i < quantityResult.value; i++) {
          const raw = grossWeights[i] ?? ''
          const result = parseNumberField(raw, `o peso bruto do rolo ${i + 1}`, { required: true })
          if (result.error) {
            errors[`gross_weight_${i}`] = result.error
          } else if ((result.value as number) <= nominalWeightGrams) {
            errors[`gross_weight_${i}`] =
              `O peso bruto do rolo ${i + 1} deve ser maior que o peso líquido nominal (${nominalWeightGrams}g).`
          } else {
            parsedGrossWeights.push(result.value as number)
          }
        }
      }

      if (Object.keys(errors).length === 0 && material && nominalWeightGrams && finish) {
        input = {
          category: 'FILAMENT',
          quantity: quantityResult.value as number,
          item_value: itemValueReais,
          freight_value: freightValueReais,
          material,
          manufacturer: trimmedManufacturer,
          line: finish,
          commercial_color: trimmedColor,
          nominal_weight_grams: nominalWeightGrams,
          gross_weights_grams: parsedGrossWeights,
        }
        fingerprint = JSON.stringify(input)
      }
    }

    if (Object.keys(errors).length > 0 || !input) {
      setFieldErrors(errors)
      return
    }
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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar compra</DialogTitle>
            <DialogDescription>
              Selecione o item e preencha os dados da compra — a entrada correspondente é lançada automaticamente no
              estoque.
            </DialogDescription>
          </DialogHeader>

          <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
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
                      category === item.value ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME,
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
                <div className="flex flex-col gap-2">
                  <Label>Material</Label>
                  <div role="radiogroup" aria-label="Material" className="flex flex-wrap gap-2">
                    {MATERIAL_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={material === option}
                        disabled={isSubmitting}
                        onClick={() => {
                          setMaterial(option)
                          setFieldErrors((current) => ({ ...current, material: '' }))
                        }}
                        className={cn(
                          'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                          material === option ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  {fieldErrors.material && <p className="text-destructive text-sm">{fieldErrors.material}</p>}
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Peso líquido</Label>
                  <div role="radiogroup" aria-label="Peso líquido" className="flex flex-wrap gap-2">
                    {NOMINAL_WEIGHT_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={nominalWeightGrams === option}
                        disabled={isSubmitting}
                        onClick={() => {
                          setNominalWeightGrams(option)
                          setFieldErrors((current) => ({ ...current, nominal_weight_grams: '' }))
                        }}
                        className={cn(
                          'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                          nominalWeightGrams === option ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                        )}
                      >
                        {option}g
                      </button>
                    ))}
                  </div>
                  {fieldErrors.nominal_weight_grams && (
                    <p className="text-destructive text-sm">{fieldErrors.nominal_weight_grams}</p>
                  )}
                </div>

                {quantityField}
              </>
            )}

            {category === 'FILAMENT' && parsedQuantity !== undefined && parsedQuantity > 0 && nominalWeightGrams && (
              <div className="flex flex-col gap-3">
                {Array.from({ length: parsedQuantity }, (_, i) => i).map((i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <Label htmlFor={`purchase-gross-weight-${i}`}>Peso bruto do rolo {i + 1}</Label>
                    <Input
                      id={`purchase-gross-weight-${i}`}
                      inputMode="decimal"
                      value={grossWeights[i] ?? ''}
                      onChange={(event) => handleGrossWeightChange(i, event.target.value)}
                      disabled={isSubmitting}
                      aria-invalid={fieldErrors[`gross_weight_${i}`] ? true : undefined}
                      className="w-32 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                    />
                    {fieldErrors[`gross_weight_${i}`] && (
                      <p className="text-destructive text-sm">{fieldErrors[`gross_weight_${i}`]}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {category === 'FILAMENT' && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="purchase-manufacturer">Marca</Label>
                  <Input
                    id="purchase-manufacturer"
                    value={manufacturer}
                    onChange={(event) => {
                      setManufacturer(event.target.value)
                      setFieldErrors((current) => ({ ...current, manufacturer: '' }))
                    }}
                    disabled={isSubmitting}
                    aria-invalid={fieldErrors.manufacturer ? true : undefined}
                    className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                  />
                  {fieldErrors.manufacturer && <p className="text-destructive text-sm">{fieldErrors.manufacturer}</p>}
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="purchase-commercial-color">Cor</Label>
                  <Input
                    id="purchase-commercial-color"
                    value={commercialColor}
                    onChange={(event) => {
                      setCommercialColor(event.target.value)
                      setFieldErrors((current) => ({ ...current, commercial_color: '' }))
                    }}
                    disabled={isSubmitting}
                    aria-invalid={fieldErrors.commercial_color ? true : undefined}
                    className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                  />
                  {fieldErrors.commercial_color && (
                    <p className="text-destructive text-sm">{fieldErrors.commercial_color}</p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Acabamento</Label>
                  <div role="radiogroup" aria-label="Acabamento" className="flex flex-wrap gap-2">
                    {FINISH_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={finish === option}
                        disabled={isSubmitting}
                        onClick={() => {
                          setFinish(option)
                          setFieldErrors((current) => ({ ...current, line: '' }))
                        }}
                        className={cn(
                          'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                          finish === option ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  {fieldErrors.line && <p className="text-destructive text-sm">{fieldErrors.line}</p>}
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

            {category !== null && (
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
                    <p className="text-brand-primary-dark text-sm font-medium">{formatBRL(itemValueReais)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Frete</p>
                    <p className="text-brand-primary-dark text-sm font-medium">{formatBRL(freightValueReais)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Total da compra</p>
                    <p className="text-brand-primary-dark text-sm font-medium">{formatBRL(totalReais)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      {category === 'FILAMENT' ? 'Custo médio por rolo' : 'Custo médio por unidade'}
                    </p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {averageUnitCost !== null ? formatBRL(averageUnitCost) : '—'}
                    </p>
                  </div>
                  {category === 'FILAMENT' && (
                    <div>
                      <p className="text-muted-foreground text-xs">Custo estimado por kg</p>
                      <p className="text-brand-primary-dark text-sm font-medium">
                        {costPerKg !== null ? formatBRL(costPerKg) : '—'}
                      </p>
                    </div>
                  )}
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
