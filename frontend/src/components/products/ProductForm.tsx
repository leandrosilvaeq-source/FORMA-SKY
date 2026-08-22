import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  MAX_CENTS,
  appendDigit,
  centsToAmount,
  formatCentsToBRL,
  parsePastedTextToCents,
  rawValueToCents,
  removeLastDigit,
} from '@/lib/forms/currencyField'
import { DURATION_HELP_TEXT, formatSecondsToHHMMSS, parseDurationToSeconds } from '@/lib/forms/durationField'
import { parseNumberField } from '@/lib/forms/numberField'
import type { CreateProductInput } from '@/lib/api/products'
import type { ProductType } from '@/types/domain'

const PRICE_INPUT_ID = 'product-price'
const PRICE_ERROR_ID = 'product-price-error'
const MAX_CENTS_MESSAGE = `O preço não pode ultrapassar ${formatCentsToBRL(MAX_CENTS)}.`

const DURATION_INPUT_ID = 'product-print-time'
const DURATION_HELP_ID = 'product-print-time-help'
const DURATION_ERROR_ID = 'product-print-time-error'

const CATEGORY_HELP_ID = 'product-category-help'
const CUSTOM_CATEGORY_INPUT_ID = 'product-category-custom'

// Valores técnicos já adotados no projeto para item_type (order_items,
// supabase/migrations/20260814005328_create_order_items_table.sql) —
// reutilizados aqui integralmente para products.product_type, nunca
// reinventados. Só CATALOG está habilitado nos fluxos de Pedidos por
// enquanto; CUSTOM/SPOT existem aqui só para classificar o produto no
// Catálogo, sem nenhum novo fluxo de pedido habilitado por esta mudança.
const PRODUCT_TYPE_ITEMS: Array<{ label: string; value: ProductType }> = [
  { label: 'Catálogo', value: 'CATALOG' },
  { label: 'Personalizado', value: 'CUSTOM' },
  { label: 'SPOT', value: 'SPOT' },
]

// Opções pré-definidas de categoria — capitalização preservada exatamente
// como aprovado (é o próprio valor gravado em products.category quando
// selecionada, nunca um rótulo separado do valor real). "Outro" não é um
// valor de categoria de verdade — é só o modo de entrada livre; o valor
// gravado é o texto digitado no campo condicional.
const CATEGORY_OPTIONS = [
  'Chaveiro',
  'Suporte',
  'Brinquedo Sensorial',
  'Decoração',
  'Pet',
  'Gamer',
  'Geek',
  'Beauty',
  'Office',
]
const OTHER_CATEGORY = 'Outro'

// Teclas de navegação/atalho que devem passar direto, sem virar dígito nem
// ser bloqueadas — mesmo conjunto já aprovado em ProductPriceForm.tsx.
const PASSTHROUGH_KEYS = new Set([
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

// Valores para pré-preencher o formulário em modo edição — mesmo padrão já
// aprovado em OrderForm.tsx (OrderFormInitialValues). Nenhum "Editar
// produto" foi conectado a ProductsPage nesta rodada — este suporte existe
// no componente, pronto para uso futuro, e já é exercitado diretamente
// pelos testes deste arquivo.
export interface ProductFormInitialValues {
  name: string
  category: string | null
  description: string | null
  defaultPrice: number
  defaultPrintTimeSeconds: number | null
  defaultWeightGrams: number | null
  allowsPersonalization: boolean
  productType: ProductType
}

interface ProductFormProps {
  mode?: 'create' | 'edit'
  initialValues?: ProductFormInitialValues
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: CreateProductInput) => void
  onCancel: () => void
}

export function ProductForm({
  mode = 'create',
  initialValues,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: ProductFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [productType, setProductType] = useState<ProductType>(initialValues?.productType ?? 'CATALOG')

  // Categoria: '' = nenhuma selecionada (categoria null, mesmo
  // comportamento opcional de antes); um dos CATEGORY_OPTIONS; ou "Outro"
  // (entrada livre, campo condicional). Em edição, uma categoria existente
  // que não bata com nenhuma opção pré-definida sempre abre como "Outro",
  // com o texto atual preenchido — nunca convertida/descartada.
  const initialCategoryIsPredefined =
    initialValues?.category != null && CATEGORY_OPTIONS.includes(initialValues.category)
  const [categorySelection, setCategorySelection] = useState<string>(() => {
    if (!initialValues?.category) return ''
    return initialCategoryIsPredefined ? initialValues.category : OTHER_CATEGORY
  })
  const [customCategory, setCustomCategory] = useState<string>(() =>
    initialValues?.category && !initialCategoryIsPredefined ? initialValues.category : '',
  )

  const [description, setDescription] = useState(initialValues?.description ?? '')

  // Preço: mesmo campo "bancário" já aprovado em ProductPriceForm.tsx —
  // reutiliza as MESMAS funções puras de lib/forms/currencyField.ts
  // (appendDigit/removeLastDigit/centsToAmount/formatCentsToBRL/
  // parsePastedTextToCents/rawValueToCents), nunca uma reimplementação
  // própria. Só o wiring de eventos React (keydown/paste/change/cursor)
  // é replicado aqui — não extraído para um hook compartilhado nesta
  // rodada (fora do escopo aprovado) — mas nenhuma lógica de
  // interpretação de dígitos/backspace/colagem é duplicada.
  const [priceCents, setPriceCents] = useState(() =>
    initialValues ? Math.round(initialValues.defaultPrice * 100) : 0,
  )
  // Distingue "campo nunca tocado" (Salvar deve exigir preço) de "usuário
  // digitou 0 de propósito" (0 é um preço válido, igual ao contrato atual
  // de products.default_price >= 0) — mesmo padrão de ProductPriceForm. Em
  // edição, o preço já vem preenchido a partir do produto existente, então
  // nasce como "já editado" (não bloqueia o Salvar pedindo para informar de
  // novo um preço que já está lá).
  const [hasEditedPrice, setHasEditedPrice] = useState(mode === 'edit')
  const [priceError, setPriceError] = useState<string | null>(null)
  const priceInputRef = useRef<HTMLInputElement>(null)

  const [printTimeInput, setPrintTimeInput] = useState(() =>
    initialValues?.defaultPrintTimeSeconds != null ? formatSecondsToHHMMSS(initialValues.defaultPrintTimeSeconds) : '',
  )

  const [weightGrams, setWeightGrams] = useState(() =>
    initialValues?.defaultWeightGrams != null ? String(initialValues.defaultWeightGrams) : '',
  )
  // Criação (sem initialValues): inicia ativado por padrão (true). Edição
  // (initialValues sempre traz allowsPersonalization como boolean real,
  // nunca null/undefined): o ?? nunca entra em jogo — o valor existente do
  // produto é sempre preservado, mesmo quando é false.
  const [allowsPersonalization, setAllowsPersonalization] = useState(initialValues?.allowsPersonalization ?? true)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Mesmo reposicionamento de cursor ao final já aprovado em
  // ProductPriceForm.tsx — o campo é editado da direita para a esquerda
  // (estilo maquininha), então a posição do cursor antes da edição nunca
  // deve influenciar o resultado.
  useEffect(() => {
    const el = priceInputRef.current
    if (el) {
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }, [priceCents])

  function applyPriceCents(next: number) {
    setPriceCents(next)
    setHasEditedPrice(true)
    setPriceError(null)
  }

  function handlePriceKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const { key, currentTarget } = event
    const isFullSelection =
      currentTarget.value.length > 0 &&
      currentTarget.selectionStart === 0 &&
      currentTarget.selectionEnd === currentTarget.value.length

    if (/^[0-9]$/.test(key)) {
      event.preventDefault()
      const base = isFullSelection ? 0 : priceCents
      const next = appendDigit(base, key)
      if (next === null) {
        setPriceError(MAX_CENTS_MESSAGE)
        return
      }
      applyPriceCents(next)
      return
    }

    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault()
      applyPriceCents(isFullSelection ? 0 : removeLastDigit(priceCents))
      return
    }

    if (PASSTHROUGH_KEYS.has(key) || event.ctrlKey || event.metaKey) return

    event.preventDefault()
  }

  // Fallback para teclado virtual (mobile) — mesmo motivo/comportamento já
  // documentado em ProductPriceForm.tsx.
  function handlePriceChange(event: ChangeEvent<HTMLInputElement>) {
    const next = rawValueToCents(event.target.value)
    if (next > MAX_CENTS) {
      setPriceError(MAX_CENTS_MESSAGE)
      return
    }
    applyPriceCents(next)
  }

  function handlePricePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const text = event.clipboardData.getData('text')
    const parsed = parsePastedTextToCents(text)
    if (parsed === null) {
      setPriceError(MAX_CENTS_MESSAGE)
      return
    }
    applyPriceCents(parsed)
  }

  // Ao perder o foco, normaliza qualquer formato aceito (1h30min, 1,5h,
  // 90m, 30m45s, HH:MM:SS etc. — ver lib/forms/durationField.ts) para
  // HH:MM:SS. Entrada inválida NUNCA sobrescreve o que o usuário digitou —
  // fica visível junto do erro inline, para ele conseguir corrigir.
  function handleDurationBlur() {
    const result = parseDurationToSeconds(printTimeInput)
    if (!result.ok) {
      setFieldErrors((current) => ({ ...current, default_print_time_seconds: result.error }))
      return
    }
    setFieldErrors((current) => {
      const next = { ...current }
      delete next.default_print_time_seconds
      return next
    })
    setPrintTimeInput(result.seconds !== null ? formatSecondsToHHMMSS(result.seconds) : '')
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    const trimmedName = name.trim()
    if (!trimmedName) errors.name = 'Informe o nome do produto.'

    let finalCategory: string | null = null
    if (categorySelection === OTHER_CATEGORY) {
      const trimmedCustom = customCategory.trim()
      if (!trimmedCustom) {
        errors.category = 'Informe a categoria.'
      } else {
        finalCategory = trimmedCustom
      }
    } else if (categorySelection) {
      finalCategory = categorySelection
    }

    if (!hasEditedPrice) {
      errors.default_price = 'Informe o preço.'
    } else if (priceCents > MAX_CENTS) {
      errors.default_price = MAX_CENTS_MESSAGE
    }

    const durationResult = parseDurationToSeconds(printTimeInput)
    if (!durationResult.ok) errors.default_print_time_seconds = durationResult.error

    const weight = parseNumberField(weightGrams, 'O peso', { min: 0 })
    if (weight.error) errors.default_weight_grams = weight.error

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    onSubmit({
      name: trimmedName,
      product_type: productType,
      default_price: centsToAmount(priceCents),
      category: finalCategory,
      description: description.trim() ? description.trim() : null,
      default_print_time_seconds: durationResult.ok ? durationResult.seconds : null,
      default_weight_grams: weight.value ?? null,
      allows_personalization: allowsPersonalization,
    })
  }

  const durationError = fieldErrors.default_print_time_seconds
  const durationDescribedBy = [DURATION_HELP_ID, durationError ? DURATION_ERROR_ID : null].filter(Boolean).join(' ')

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="product-name">Nome</Label>
        <Input id="product-name" value={name} onChange={(event) => setName(event.target.value)} />
        {fieldErrors.name && <p className="text-destructive text-sm">{fieldErrors.name}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Tipo do produto</Label>
        <div role="radiogroup" aria-label="Tipo do produto" className="flex flex-wrap gap-2">
          {PRODUCT_TYPE_ITEMS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={productType === item.value}
              onClick={() => setProductType(item.value)}
              className={cn(
                'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                productType === item.value
                  ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Categoria</Label>
        <p id={CATEGORY_HELP_ID} className="text-muted-foreground text-xs">
          A categoria organiza os produtos por finalidade ou público, facilitando a localização e a consulta na
          listagem.
        </p>
        <div role="radiogroup" aria-label="Categoria" className="flex flex-wrap gap-2">
          {[...CATEGORY_OPTIONS, OTHER_CATEGORY].map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={categorySelection === option}
              onClick={() => setCategorySelection((current) => (current === option ? '' : option))}
              className={cn(
                'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                categorySelection === option
                  ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        {categorySelection === OTHER_CATEGORY && (
          <div className="flex flex-col gap-1">
            <Label htmlFor={CUSTOM_CATEGORY_INPUT_ID}>Informe a categoria</Label>
            <Input
              id={CUSTOM_CATEGORY_INPUT_ID}
              value={customCategory}
              onChange={(event) => setCustomCategory(event.target.value)}
            />
          </div>
        )}
        {fieldErrors.category && <p className="text-destructive text-sm">{fieldErrors.category}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-description">Descrição</Label>
        <Textarea
          id="product-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={PRICE_INPUT_ID}>Preço</Label>
        <Input
          id={PRICE_INPUT_ID}
          ref={priceInputRef}
          inputMode="numeric"
          value={formatCentsToBRL(priceCents)}
          onChange={handlePriceChange}
          onKeyDown={handlePriceKeyDown}
          onPaste={handlePricePaste}
          aria-invalid={priceError || fieldErrors.default_price ? true : undefined}
          aria-describedby={priceError || fieldErrors.default_price ? PRICE_ERROR_ID : undefined}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        {(priceError || fieldErrors.default_price) && (
          <p id={PRICE_ERROR_ID} className="text-destructive text-sm">
            {priceError || fieldErrors.default_price}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-weight">Peso total (g)</Label>
        <Input
          id="product-weight"
          inputMode="decimal"
          value={weightGrams}
          onChange={(event) => setWeightGrams(event.target.value)}
        />
        {fieldErrors.default_weight_grams && (
          <p className="text-destructive text-sm">{fieldErrors.default_weight_grams}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={DURATION_INPUT_ID}>Tempo de Produção</Label>
        <Input
          id={DURATION_INPUT_ID}
          value={printTimeInput}
          onChange={(event) => setPrintTimeInput(event.target.value)}
          onBlur={handleDurationBlur}
          aria-invalid={durationError ? true : undefined}
          aria-describedby={durationDescribedBy}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        <p id={DURATION_HELP_ID} className="text-muted-foreground text-xs">
          {DURATION_HELP_TEXT}
        </p>
        {durationError && (
          <p id={DURATION_ERROR_ID} className="text-destructive text-sm">
            {durationError}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="product-allows-personalization">Permite personalização</Label>
        <Switch
          id="product-allows-personalization"
          checked={allowsPersonalization}
          onCheckedChange={(checked) => setAllowsPersonalization(checked)}
          className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
        />
      </div>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
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
          {isSubmitting ? 'Salvando...' : mode === 'edit' ? 'Salvar alterações' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}
