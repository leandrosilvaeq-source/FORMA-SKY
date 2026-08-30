import { useState, type ChangeEvent, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import { MinusIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { formatSecondsToHHMM, parseDurationToSeconds } from '@/lib/forms/durationField'
import { parseNumberField } from '@/lib/forms/numberField'
import { itemLabel } from '@/lib/forms/productComposition'
import {
  autoTotalTimeSeconds,
  autoTotalWeightGrams,
  emptyPlateRow,
  validatePlateRows,
  type PlateRow,
} from '@/lib/forms/productPlates'
import { ProductCompositionForm } from '@/components/products/ProductCompositionForm'
import type { CreateProductWithPlatesInput, PlateInput } from '@/lib/api/products'
import type { UpdateProductCompositionInput } from '@/lib/api/productComposition'
import type { Accessory, Packaging, ProductType } from '@/types/domain'

const PRICE_INPUT_ID = 'product-price'
const PRICE_ERROR_ID = 'product-price-error'
const MAX_CENTS_MESSAGE = `O preço não pode ultrapassar ${formatCentsToBRL(MAX_CENTS)}.`

const CATEGORY_HELP_ID = 'product-category-help'
const CUSTOM_CATEGORY_INPUT_ID = 'product-category-custom'

const PRODUCT_TYPE_ITEMS: Array<{ label: string; value: ProductType }> = [
  { label: 'Catálogo', value: 'CATALOG' },
  { label: 'Personalizado', value: 'CUSTOM' },
  { label: 'SPOT', value: 'SPOT' },
]

// Múltiplas categorias (migration 20260829180000, ainda não aplicada) —
// mesma lista predefinida de sugestões que a seleção única já usava, agora
// como toggle (várias podem ficar marcadas ao mesmo tempo) em vez de
// radiogroup. "Outro" continua permitindo texto livre, mas agora pode ser
// adicionado MAIS DE UMA VEZ (cada valor digitado vira uma categoria extra
// na lista, nunca substituindo as já escolhidas).
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

const REMOVE_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0'
const ADD_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark'
// Separação visual das 3 seções (Dados Gerais/Composição/Acessórios e
// Embalagens), aprovada nesta rodada — cartão com borda e fundo suave na
// paleta da marca, cabeçalho com sublinhado, mesma identidade visual já
// usada em outras telas (AppLayout/ProductsPage). Nunca uma nova biblioteca
// de UI: só classes Tailwind já em uso no projeto.
const SECTION_CARD_CLASSNAME =
  'border-brand-primary/20 bg-brand-primary-soft/15 flex flex-col gap-4 rounded-xl border p-4 md:p-6'
const SECTION_TITLE_CLASSNAME = 'border-brand-primary/20 text-brand-primary-dark border-b pb-2 font-heading text-base font-semibold'

function formatGrams(grams: number): string {
  return `${grams.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} g`
}

// Estrutura produtiva por plates — valores para pré-preencher o formulário
// em modo edição. `plates`/`accessories`/`packaging` já vêm prontos na
// forma que este formulário consome (PlateRow[]/{id,quantity}) — a
// conversão a partir de ProductPlate[]/ProductAccessory[]/ProductPackaging[]
// é responsabilidade do chamador (ProductsPage.tsx). `categories` (N por
// Produto, migration 20260829180000, ainda não aplicada) substitui a antiga
// `category` (string única).
export interface ProductFormInitialValues {
  name: string
  categories: string[]
  description: string | null
  defaultPrice: number
  allowsPersonalization: boolean
  productType: ProductType
  plates: PlateRow[]
  manualWeightOverrideGrams: number | null
  manualTimeOverrideSeconds: number | null
  accessories: Array<{ id: string; quantity: number }>
  packaging: Array<{ id: string; quantity: number }>
}

// Valores emitidos por onSubmit — cobre create_product_with_plates E
// update_product_full (os dois RPCs esperam o mesmo formato de
// categories/plates/accessories/packaging; só o chamador decide qual dos
// dois chamar, conforme mode).
export interface ProductFormSubmitValues {
  name: string
  product_type: ProductType
  categories: string[]
  description: string | null
  default_price: number
  allows_personalization: boolean
  plates: PlateInput[]
  manual_weight_override_grams: number | null
  manual_time_override_seconds: number | null
  accessories: CreateProductWithPlatesInput['accessories']
  packaging: CreateProductWithPlatesInput['packaging']
}

interface ProductFormProps {
  mode?: 'create' | 'edit'
  initialValues?: ProductFormInitialValues
  accessoriesList: Accessory[]
  packagingList: Packaging[]
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: ProductFormSubmitValues) => void
  onCancel: () => void
}

export function ProductForm({
  mode = 'create',
  initialValues,
  accessoriesList,
  packagingList,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: ProductFormProps) {
  // ---------------------------------------------------------------------
  // Seção 1 — Dados Gerais
  // ---------------------------------------------------------------------
  const [name, setName] = useState(initialValues?.name ?? '')
  const [productType, setProductType] = useState<ProductType>(initialValues?.productType ?? 'CATALOG')

  const [categories, setCategories] = useState<string[]>(initialValues?.categories ?? [])
  const [customCategoryInput, setCustomCategoryInput] = useState('')

  const [description, setDescription] = useState(initialValues?.description ?? '')

  const [priceCents, setPriceCents] = useState(() =>
    initialValues ? Math.round(initialValues.defaultPrice * 100) : 0,
  )
  const [hasEditedPrice, setHasEditedPrice] = useState(mode === 'edit')
  const [priceError, setPriceError] = useState<string | null>(null)

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function toggleCategory(option: string) {
    setCategories((current) => (current.includes(option) ? current.filter((c) => c !== option) : [...current, option]))
  }

  function addCustomCategory() {
    const trimmed = customCategoryInput.trim()
    if (!trimmed) return
    setCategories((current) => (current.includes(trimmed) ? current : [...current, trimmed]))
    setCustomCategoryInput('')
  }

  function removeCategory(value: string) {
    setCategories((current) => current.filter((c) => c !== value))
  }

  function handleCustomCategoryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      addCustomCategory()
    }
  }

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

  // ---------------------------------------------------------------------
  // Seção 2 — Composição: número de plates + peso/tempo direto de cada um
  // (sem filamento/cor — retirados do Produto, ver docs/05_ROADMAP_MODULOS.md)
  // + totais automáticos/ajuste manual + Permite personalização.
  // ---------------------------------------------------------------------
  const [plates, setPlates] = useState<PlateRow[]>(() =>
    initialValues && initialValues.plates.length > 0 ? initialValues.plates : [emptyPlateRow()],
  )
  const [plateTimeErrors, setPlateTimeErrors] = useState<Record<string, string>>({})
  const [plateWeightErrors, setPlateWeightErrors] = useState<Record<string, string>>({})
  // Confirmação antes de remover um plate PREENCHIDO (com tempo ou peso
  // informado) — nunca perde composição preenchida silenciosamente. Guarda
  // a key do plate pendente de confirmação; null = nenhuma confirmação
  // aberta.
  const [plateRemovalPending, setPlateRemovalPending] = useState<string | null>(null)

  const [allowsPersonalization, setAllowsPersonalization] = useState(initialValues?.allowsPersonalization ?? true)

  const [isManualAdjustment, setIsManualAdjustment] = useState(
    initialValues != null &&
      (initialValues.manualWeightOverrideGrams !== null || initialValues.manualTimeOverrideSeconds !== null),
  )
  const [manualWeightInput, setManualWeightInput] = useState(
    initialValues?.manualWeightOverrideGrams != null ? String(initialValues.manualWeightOverrideGrams) : '',
  )
  const [manualTimeInput, setManualTimeInput] = useState(
    initialValues?.manualTimeOverrideSeconds != null ? formatSecondsToHHMM(initialValues.manualTimeOverrideSeconds) : '',
  )
  const [manualWeightError, setManualWeightError] = useState<string | null>(null)
  const [manualTimeError, setManualTimeError] = useState<string | null>(null)

  const autoWeight = autoTotalWeightGrams(plates)
  const autoTimeSeconds = autoTotalTimeSeconds(plates)

  function plateHasData(plate: PlateRow): boolean {
    return plate.timeInput.trim() !== '' || plate.weightInput.trim() !== ''
  }

  function addPlate() {
    setPlates((current) => [...current, emptyPlateRow()])
  }

  function requestRemovePlate(key: string) {
    const plate = plates.find((p) => p.key === key)
    if (plate && plateHasData(plate)) {
      setPlateRemovalPending(key)
      return
    }
    removePlate(key)
  }

  function removePlate(key: string) {
    setPlateRemovalPending(null)
    setPlates((current) => (current.length <= 1 ? current : current.filter((plate) => plate.key !== key)))
  }

  function updatePlateTime(key: string, timeInput: string) {
    setPlates((current) => current.map((plate) => (plate.key === key ? { ...plate, timeInput } : plate)))
  }

  function updatePlateWeight(key: string, weightInput: string) {
    setPlates((current) => current.map((plate) => (plate.key === key ? { ...plate, weightInput } : plate)))
  }

  function enableManualAdjustment() {
    setManualWeightInput((current) => (current.trim() ? current : String(autoWeight)))
    setManualTimeInput((current) => (current.trim() ? current : formatSecondsToHHM_or_empty(autoTimeSeconds)))
    setIsManualAdjustment(true)
  }

  function formatSecondsToHHM_or_empty(seconds: number): string {
    return seconds > 0 ? formatSecondsToHHMM(seconds) : ''
  }

  function useAutomaticCalculation() {
    setIsManualAdjustment(false)
    setManualWeightError(null)
    setManualTimeError(null)
  }

  // ---------------------------------------------------------------------
  // Seção 3 — Acessórios e Embalagem: reaproveita ProductCompositionForm
  // (mesmo componente já usado na edição de um produto existente) dentro
  // de um Dialog aninhado — "Selecionar acessórios e embalagens" abre o
  // MESMO editor, só que o onSubmit dele atualiza estado local em vez de
  // chamar a API diretamente (o salvamento real só acontece quando este
  // formulário inteiro é submetido).
  // ---------------------------------------------------------------------
  const [selectedAccessories, setSelectedAccessories] = useState<Array<{ id: string; quantity: number }>>(
    initialValues?.accessories ?? [],
  )
  const [selectedPackaging, setSelectedPackaging] = useState<Array<{ id: string; quantity: number }>>(
    initialValues?.packaging ?? [],
  )
  const [isCompositionPickerOpen, setIsCompositionPickerOpen] = useState(false)

  function handleCompositionPicked(values: UpdateProductCompositionInput) {
    setSelectedAccessories(values.accessories)
    setSelectedPackaging(values.packaging)
    setIsCompositionPickerOpen(false)
  }

  function removeSelectedAccessory(id: string) {
    setSelectedAccessories((current) => current.filter((item) => item.id !== id))
  }
  function removeSelectedPackaging(id: string) {
    setSelectedPackaging((current) => current.filter((item) => item.id !== id))
  }

  // ---------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    const trimmedName = name.trim()
    if (!trimmedName) errors.name = 'Informe o nome do produto.'

    if (categories.length === 0) {
      errors.categories = 'Selecione ao menos uma categoria.'
    }

    // Preço e Tipo do produto nunca são editáveis aqui em mode="edit" —
    // permanecem exclusivos da ação "Preço" já aprovada (ProductPriceForm/
    // update_product_price, com histórico) e nunca fizeram parte da edição
    // (mesma restrição que ProductEditDetailsForm já tinha). Só validados/
    // exigidos na criação.
    if (mode === 'create') {
      if (!hasEditedPrice) {
        errors.default_price = 'Informe o preço.'
      } else if (priceCents > MAX_CENTS) {
        errors.default_price = MAX_CENTS_MESSAGE
      }
    }

    const platesResult = validatePlateRows(plates)
    setPlateTimeErrors(platesResult.timeErrors)
    setPlateWeightErrors(platesResult.weightErrors)

    let manualWeightValue: number | null = null
    let manualTimeValue: number | null = null
    if (isManualAdjustment) {
      const weightResult = parseNumberField(manualWeightInput, 'o peso efetivo', { required: true, min: 0 })
      if (weightResult.error) {
        setManualWeightError(weightResult.error)
      } else {
        manualWeightValue = weightResult.value as number
        setManualWeightError(null)
      }

      const timeResult = parseDurationToSeconds(manualTimeInput)
      if (!timeResult.ok) {
        setManualTimeError(timeResult.error)
      } else if (timeResult.seconds === null) {
        setManualTimeError('Informe o tempo efetivo.')
      } else {
        manualTimeValue = timeResult.seconds
        setManualTimeError(null)
      }

      if (weightResult.error || !timeResult.ok || timeResult.seconds === null) {
        errors.plates = errors.plates ?? 'Corrija o ajuste manual de totais.'
      }
    } else {
      setManualWeightError(null)
      setManualTimeError(null)
    }

    if (
      Object.keys(errors).length > 0 ||
      Object.keys(platesResult.timeErrors).length > 0 ||
      Object.keys(platesResult.weightErrors).length > 0
    ) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    onSubmit({
      name: trimmedName,
      product_type: productType,
      categories,
      description: description.trim() ? description.trim() : null,
      default_price: centsToAmount(priceCents),
      allows_personalization: allowsPersonalization,
      plates: platesResult.items,
      manual_weight_override_grams: manualWeightValue,
      manual_time_override_seconds: manualTimeValue,
      accessories: selectedAccessories,
      packaging: selectedPackaging,
    })
  }

  const effectiveWeight = isManualAdjustment
    ? (parseNumberField(manualWeightInput, 'peso', { min: 0 }).value ?? autoWeight)
    : autoWeight
  const effectiveTimeSeconds = isManualAdjustment
    ? (() => {
        const result = parseDurationToSeconds(manualTimeInput)
        return result.ok ? (result.seconds ?? autoTimeSeconds) : autoTimeSeconds
      })()
    : autoTimeSeconds

  return (
    <form className="flex w-full max-w-full flex-col gap-6" onSubmit={handleSubmit}>
      {/* ------------------------------------------------------------- */}
      {/* Seção 1 — Dados Gerais                                        */}
      {/* ------------------------------------------------------------- */}
      <div className={SECTION_CARD_CLASSNAME}>
        <h3 className={SECTION_TITLE_CLASSNAME}>Dados Gerais</h3>

        <div className="flex flex-col gap-2">
          <Label htmlFor="product-name">Nome</Label>
          <Input id="product-name" value={name} onChange={(event) => setName(event.target.value)} />
          {fieldErrors.name && <p className="text-destructive text-sm">{fieldErrors.name}</p>}
        </div>

        {mode === 'create' ? (
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
        ) : (
          // Tipo do produto nunca é editável na edição (mesma restrição que
          // ProductEditDetailsForm já tinha) — exibido como texto fixo.
          <div className="flex flex-col gap-1">
            <Label>Tipo do produto</Label>
            <p className="text-muted-foreground text-sm">
              {PRODUCT_TYPE_ITEMS.find((item) => item.value === productType)?.label ?? productType}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label>Categorias</Label>
          <p id={CATEGORY_HELP_ID} className="text-muted-foreground text-xs">
            Um produto pode ter mais de uma categoria — selecione todas as que se aplicam ou adicione uma nova
            abaixo.
          </p>
          <div role="group" aria-label="Categorias" className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                role="checkbox"
                aria-checked={categories.includes(option)}
                onClick={() => toggleCategory(option)}
                className={cn(
                  'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                  categories.includes(option)
                    ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                    : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={CUSTOM_CATEGORY_INPUT_ID}>Outra categoria</Label>
              <Input
                id={CUSTOM_CATEGORY_INPUT_ID}
                value={customCategoryInput}
                onChange={(event) => setCustomCategoryInput(event.target.value)}
                onKeyDown={handleCustomCategoryKeyDown}
                placeholder="Digite e adicione"
              />
            </div>
            <Button type="button" variant="outline" onClick={addCustomCategory} className={ADD_BUTTON_CLASSNAME}>
              Adicionar
            </Button>
          </div>

          {categories.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Categorias selecionadas">
              {categories.map((category) => (
                <li
                  key={category}
                  className="border-brand-primary bg-brand-primary-soft text-brand-primary-dark flex items-center gap-1 rounded-full border px-3 py-1 text-sm"
                >
                  {category}
                  <button
                    type="button"
                    onClick={() => removeCategory(category)}
                    aria-label={`Remover categoria ${category}`}
                    className="focus-visible:ring-brand-accent rounded-full outline-none focus-visible:ring-2"
                  >
                    <XIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fieldErrors.categories && <p className="text-destructive text-sm">{fieldErrors.categories}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="product-description">Descrição</Label>
          <Textarea
            id="product-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        {mode === 'create' ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={PRICE_INPUT_ID}>Preço</Label>
            <Input
              id={PRICE_INPUT_ID}
              inputMode="numeric"
              value={formatCentsToBRL(priceCents)}
              onChange={handlePriceChange}
              onKeyDown={handlePriceKeyDown}
              onPaste={handlePricePaste}
              aria-invalid={priceError || fieldErrors.default_price ? true : undefined}
              aria-describedby={priceError || fieldErrors.default_price ? PRICE_ERROR_ID : undefined}
              className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-full max-w-xs"
            />
            {(priceError || fieldErrors.default_price) && (
              <p id={PRICE_ERROR_ID} className="text-destructive text-sm">
                {priceError || fieldErrors.default_price}
              </p>
            )}
          </div>
        ) : (
          // Preço nunca é editado aqui — permanece exclusivo da seção
          // "Preço" já aprovada (com Motivo/histórico preservados), fora
          // deste formulário. Nenhum valor de preço é enviado por
          // update_product_full (fora do contrato de UpdateProductFullInput).
          <p className="text-muted-foreground text-xs">
            O preço é alterado só pela ação "Preço", abaixo, para preservar o histórico.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Seção 2 — Composição                                          */}
      {/* ------------------------------------------------------------- */}
      <div className={SECTION_CARD_CLASSNAME}>
        <h3 className={SECTION_TITLE_CLASSNAME}>Composição</h3>
        <p className="text-muted-foreground text-xs">
          Filamentos e cores não fazem mais parte do cadastro do Produto — são escolhidos no Pedido, por unidade e
          por plate.
        </p>

        <div className="flex flex-col gap-2">
          <Label>Número de plates</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label="Diminuir número de plates"
              onClick={() => plates.length > 0 && requestRemovePlate(plates[plates.length - 1].key)}
              disabled={isSubmitting || plates.length <= 1}
            >
              <MinusIcon />
            </Button>
            <span className="w-10 shrink-0 text-center text-sm font-medium">{plates.length}</span>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label="Aumentar número de plates"
              onClick={addPlate}
              disabled={isSubmitting}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>

        {/* 2 colunas no desktop (Plate 1/Plate 2 lado a lado) — 1 coluna em
            telas menores. Com 1-2 plates, a tela de 1920×1080/100% não
            precisa de rolagem vertical; com 3+ a rolagem do próprio Dialog
            (max-h-[90vh] overflow-y-auto em ProductsPage.tsx) assume. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {plates.map((plate, plateIndex) => (
            <div key={plate.key} className="border-input bg-background flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Plate {plateIndex + 1}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Remover Plate ${plateIndex + 1}`}
                  onClick={() => requestRemovePlate(plate.key)}
                  disabled={isSubmitting || plates.length <= 1}
                  className={REMOVE_BUTTON_CLASSNAME}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>

              {plateRemovalPending === plate.key && (
                <div className="border-destructive/50 bg-destructive/10 flex flex-col gap-2 rounded-md border p-2 text-sm">
                  <p>Este plate tem dados preenchidos. Remover mesmo assim?</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="destructive" onClick={() => removePlate(plate.key)}>
                      Remover
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setPlateRemovalPending(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`plate-time-${plate.key}`}>Tempo de produção</Label>
                  <Input
                    id={`plate-time-${plate.key}`}
                    placeholder="hh:mm"
                    value={plate.timeInput}
                    disabled={isSubmitting}
                    onChange={(event) => updatePlateTime(plate.key, event.target.value)}
                    className="w-32 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                  />
                  {plateTimeErrors[plate.key] && (
                    <p className="text-destructive text-sm">{plateTimeErrors[plate.key]}</p>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor={`plate-weight-${plate.key}`}>Peso (g)</Label>
                  <Input
                    id={`plate-weight-${plate.key}`}
                    inputMode="decimal"
                    placeholder="Peso (g)"
                    value={plate.weightInput}
                    disabled={isSubmitting}
                    onChange={(event) => updatePlateWeight(plate.key, event.target.value)}
                    className="w-32 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                  />
                  {plateWeightErrors[plate.key] && (
                    <p className="text-destructive text-sm">{plateWeightErrors[plate.key]}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {fieldErrors.plates && <p className="text-destructive text-sm">{fieldErrors.plates}</p>}

        <div className="bg-muted flex flex-col gap-2 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Peso total de produção</span>
            <span className="text-sm font-semibold">{formatGrams(effectiveWeight)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Tempo total de produção</span>
            <span className="text-sm font-semibold">{formatSecondsToHHMM(effectiveTimeSeconds)}</span>
          </div>
          {isManualAdjustment && (
            <p className="text-muted-foreground text-xs">
              Ajustado manualmente — calculado pelos plates: {formatGrams(autoWeight)} / {formatSecondsToHHMM(autoTimeSeconds)}
            </p>
          )}

          {!isManualAdjustment ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={enableManualAdjustment}
              disabled={isSubmitting}
              className={cn(ADD_BUTTON_CLASSNAME, 'self-start')}
            >
              Ajustar totais
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="manual-weight-override">Peso efetivo (g)</Label>
                  <Input
                    id="manual-weight-override"
                    inputMode="decimal"
                    value={manualWeightInput}
                    disabled={isSubmitting}
                    onChange={(event) => setManualWeightInput(event.target.value)}
                    className="w-32 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                  />
                  {manualWeightError && <p className="text-destructive text-sm">{manualWeightError}</p>}
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="manual-time-override">Tempo efetivo</Label>
                  <Input
                    id="manual-time-override"
                    placeholder="hh:mm"
                    value={manualTimeInput}
                    disabled={isSubmitting}
                    onChange={(event) => setManualTimeInput(event.target.value)}
                    className="w-32 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                  />
                  {manualTimeError && <p className="text-destructive text-sm">{manualTimeError}</p>}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={useAutomaticCalculation}
                disabled={isSubmitting}
                className={cn(ADD_BUTTON_CLASSNAME, 'self-start')}
              >
                Usar cálculo automático
              </Button>
            </div>
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
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Seção 3 — Acessórios e Embalagem                               */}
      {/* ------------------------------------------------------------- */}
      <div className={SECTION_CARD_CLASSNAME}>
        <h3 className={SECTION_TITLE_CLASSNAME}>Acessórios e Embalagem</h3>

        <Button
          type="button"
          variant="outline"
          onClick={() => setIsCompositionPickerOpen(true)}
          disabled={isSubmitting}
          className={cn(ADD_BUTTON_CLASSNAME, 'self-start')}
        >
          Selecionar acessórios e embalagens
        </Button>

        {selectedAccessories.length === 0 && selectedPackaging.length === 0 && (
          <p className="text-muted-foreground text-sm">Nenhum acessório ou embalagem selecionado.</p>
        )}

        {selectedAccessories.length > 0 && (
          <ul className="flex flex-col gap-1">
            {selectedAccessories.map((selection) => {
              const accessory = accessoriesList.find((item) => item.id === selection.id)
              return (
                <li key={selection.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {accessory ? itemLabel(accessory) : selection.id} · Acessório · Qtd. {selection.quantity}
                  </span>
                  <div className="flex gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsCompositionPickerOpen(true)}>
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeSelectedAccessory(selection.id)}
                      className={REMOVE_BUTTON_CLASSNAME}
                    >
                      Remover
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {selectedPackaging.length > 0 && (
          <ul className="flex flex-col gap-1">
            {selectedPackaging.map((selection) => {
              const packagingItem = packagingList.find((item) => item.id === selection.id)
              return (
                <li key={selection.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {packagingItem ? itemLabel(packagingItem) : selection.id} · Embalagem · Qtd. {selection.quantity}
                  </span>
                  <div className="flex gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsCompositionPickerOpen(true)}>
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeSelectedPackaging(selection.id)}
                      className={REMOVE_BUTTON_CLASSNAME}
                    >
                      Remover
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <Dialog open={isCompositionPickerOpen} onOpenChange={setIsCompositionPickerOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Selecionar acessórios e embalagens</DialogTitle>
            </DialogHeader>
            <ProductCompositionForm
              accessories={accessoriesList}
              packaging={packagingList}
              initialAccessories={selectedAccessories.map((selection) => ({
                id: selection.id,
                product_id: '',
                accessory_id: selection.id,
                quantity: selection.quantity,
                created_at: '',
              }))}
              initialPackaging={selectedPackaging.map((selection) => ({
                id: selection.id,
                product_id: '',
                packaging_id: selection.id,
                quantity: selection.quantity,
                created_at: '',
              }))}
              isSubmitting={false}
              submitError={null}
              onSubmit={handleCompositionPicked}
              onCancel={() => setIsCompositionPickerOpen(false)}
            />
          </DialogContent>
        </Dialog>
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
