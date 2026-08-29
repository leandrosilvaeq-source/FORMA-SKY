import { useState, type ChangeEvent, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import { MinusIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  autoPlateWeightGrams,
  chosenFilamentTypeIdsInPlate,
  emptyPlateRow,
  emptyPlateFilamentRow,
  filamentTypeLabel,
  filterSelectableFilamentTypes,
  findFilamentTypeById,
  hasInactiveFilamentSelectionInPlates,
  validatePlateRows,
  type PlateRow,
} from '@/lib/forms/productPlates'
import { ProductCompositionForm } from '@/components/products/ProductCompositionForm'
import type { CreateProductWithPlatesInput, PlateInput } from '@/lib/api/products'
import type { UpdateProductCompositionInput } from '@/lib/api/productComposition'
import type { Accessory, FilamentTypeSummary, Packaging, ProductType } from '@/types/domain'

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

const SELECT_TRIGGER_CLASSNAME = 'focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-full min-w-0'
const REMOVE_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0'
const ADD_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark'

function formatGrams(grams: number): string {
  return `${grams.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} g`
}

// Estrutura produtiva por plates (2026-08-29) — valores para pré-preencher
// o formulário em modo edição. `plates`/`accessories`/`packaging` já vêm
// prontos na forma que este formulário consome (PlateRow[]/{id,quantity}) —
// a conversão a partir de ProductPlate[]/ProductPlateFilament[]/
// ProductAccessory[]/ProductPackaging[] é responsabilidade do chamador
// (ProductsPage.tsx), que já carregou esses dados antes de abrir o diálogo
// de edição.
export interface ProductFormInitialValues {
  name: string
  category: string | null
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
// plates/accessories/packaging; só o chamador decide qual dos dois chamar,
// conforme mode).
export interface ProductFormSubmitValues {
  name: string
  product_type: ProductType
  category: string | null
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
  filamentTypes: FilamentTypeSummary[]
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
  filamentTypes,
  accessoriesList,
  packagingList,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: ProductFormProps) {
  // ---------------------------------------------------------------------
  // Seção 1 — Dados Gerais (mesmos campos/regras do formulário antigo,
  // exceto Peso/Tempo, que migraram para a seção Composição abaixo).
  // ---------------------------------------------------------------------
  const [name, setName] = useState(initialValues?.name ?? '')
  const [productType, setProductType] = useState<ProductType>(initialValues?.productType ?? 'CATALOG')

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

  const [priceCents, setPriceCents] = useState(() =>
    initialValues ? Math.round(initialValues.defaultPrice * 100) : 0,
  )
  const [hasEditedPrice, setHasEditedPrice] = useState(mode === 'edit')
  const [priceError, setPriceError] = useState<string | null>(null)

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

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
  // Seção 2 — Composição: número de plates + composição própria de cada
  // um + totais automáticos/ajuste manual + Permite personalização.
  // ---------------------------------------------------------------------
  const [plates, setPlates] = useState<PlateRow[]>(() =>
    initialValues && initialValues.plates.length > 0 ? initialValues.plates : [emptyPlateRow()],
  )
  const [plateTimeErrors, setPlateTimeErrors] = useState<Record<string, string>>({})
  const [plateFilamentErrors, setPlateFilamentErrors] = useState<Record<string, string>>({})
  // Confirmação antes de remover um plate PREENCHIDO (com tempo informado
  // ou ao menos uma linha de filamento com tipo selecionado) — nunca perde
  // composição preenchida silenciosamente. Guarda a key do plate pendente
  // de confirmação; null = nenhuma confirmação aberta.
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

  const hasInactiveFilamentType = hasInactiveFilamentSelectionInPlates(plates, filamentTypes)

  const autoWeight = autoTotalWeightGrams(plates)
  const autoTimeSeconds = autoTotalTimeSeconds(plates)

  function plateHasData(plate: PlateRow): boolean {
    if (plate.timeInput.trim()) return true
    return plate.filaments.some((row) => row.filamentTypeId !== null || row.weight.trim())
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

  function addFilamentRow(plateKey: string) {
    setPlates((current) =>
      current.map((plate) =>
        plate.key === plateKey ? { ...plate, filaments: [...plate.filaments, emptyPlateFilamentRow()] } : plate,
      ),
    )
  }

  function removeFilamentRow(plateKey: string, rowKey: string) {
    setPlates((current) =>
      current.map((plate) =>
        plate.key === plateKey
          ? { ...plate, filaments: plate.filaments.filter((row) => row.key !== rowKey) }
          : plate,
      ),
    )
  }

  function updateFilamentRow(plateKey: string, rowKey: string, patch: Partial<{ filamentTypeId: string | null; weight: string }>) {
    setPlates((current) =>
      current.map((plate) =>
        plate.key === plateKey
          ? {
              ...plate,
              filaments: plate.filaments.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)),
            }
          : plate,
      ),
    )
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

    if (hasInactiveFilamentType) {
      errors.plates = 'Remova os filamentos inativos da composição antes de salvar.'
    }

    const platesResult = validatePlateRows(plates)
    setPlateTimeErrors(platesResult.timeErrors)
    setPlateFilamentErrors(platesResult.filamentErrors)

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
      Object.keys(platesResult.filamentErrors).length > 0
    ) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    onSubmit({
      name: trimmedName,
      product_type: productType,
      category: finalCategory,
      description: description.trim() ? description.trim() : null,
      default_price: centsToAmount(priceCents),
      allows_personalization: allowsPersonalization,
      plates: platesResult.items.map((item) => ({
        production_time_seconds: item.production_time_seconds,
        filaments: item.filaments.map((f) => ({ filament_type_id: f.filament_type_id, weight_grams: f.weight_grams })),
      })),
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
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      {/* ------------------------------------------------------------- */}
      {/* Seção 1 — Dados Gerais                                        */}
      {/* ------------------------------------------------------------- */}
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Dados Gerais</h3>

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
              className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
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
      <div className="flex flex-col gap-4 border-t pt-4">
        <h3 className="text-sm font-semibold">Composição</h3>

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

        <div className="flex flex-col gap-3">
          {plates.map((plate, plateIndex) => {
            const plateWeight = autoPlateWeightGrams(plate)
            return (
              <div key={plate.key} className="border-input flex flex-col gap-3 rounded-lg border p-3">
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
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPlateRemovalPending(null)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}

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

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Filamentos/cores</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addFilamentRow(plate.key)}
                      disabled={isSubmitting}
                      className={ADD_BUTTON_CLASSNAME}
                    >
                      Adicionar filamento
                    </Button>
                  </div>
                  {plate.filaments.map((row, rowIndex) => {
                    const chosenElsewhere = chosenFilamentTypeIdsInPlate(plate, row.key)
                    const options = filterSelectableFilamentTypes(filamentTypes, chosenElsewhere, row.filamentTypeId).map(
                      (type) => ({ label: filamentTypeLabel(type), value: type.filament_type_id as string | null }),
                    )
                    const selectedType = findFilamentTypeById(filamentTypes, row.filamentTypeId)
                    const errorKey = `${plate.key}:${row.key}`
                    const removeLabel = selectedType
                      ? `Remover ${filamentTypeLabel(selectedType)}`
                      : `Remover filamento (linha ${rowIndex + 1})`
                    return (
                      <div key={row.key} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Select
                            items={options}
                            value={row.filamentTypeId}
                            disabled={isSubmitting}
                            onValueChange={(value) => updateFilamentRow(plate.key, row.key, { filamentTypeId: value })}
                          >
                            <SelectTrigger
                              aria-label="Tipo de filamento"
                              title={selectedType ? filamentTypeLabel(selectedType) : undefined}
                              className={SELECT_TRIGGER_CLASSNAME}
                            >
                              <SelectValue placeholder="Selecione um tipo de filamento" />
                            </SelectTrigger>
                            <SelectContent>
                              {options.map((item) => (
                                <SelectItem key={item.value ?? 'none'} value={item.value} title={item.label} className="truncate">
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            aria-label="Peso (g)"
                            inputMode="decimal"
                            placeholder="Peso (g)"
                            value={row.weight}
                            disabled={isSubmitting}
                            onChange={(event) => updateFilamentRow(plate.key, row.key, { weight: event.target.value })}
                            className="w-28 shrink-0 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            onClick={() => removeFilamentRow(plate.key, row.key)}
                            disabled={isSubmitting}
                            aria-label={removeLabel}
                            className={REMOVE_BUTTON_CLASSNAME}
                          >
                            <Trash2Icon aria-hidden="true" />
                          </Button>
                        </div>
                        {plateFilamentErrors[errorKey] && (
                          <p className="text-destructive text-sm">{plateFilamentErrors[errorKey]}</p>
                        )}
                      </div>
                    )
                  })}
                </div>

                <p className="text-muted-foreground text-xs">Peso do plate: {formatGrams(plateWeight)}</p>
              </div>
            )
          })}
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
      <div className="flex flex-col gap-3 border-t pt-4">
        <h3 className="text-sm font-semibold">Acessórios e Embalagem</h3>

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
