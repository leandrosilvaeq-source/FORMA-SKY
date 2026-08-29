import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { DURATION_HELP_TEXT, formatSecondsToHHMMSS, parseDurationToSeconds } from '@/lib/forms/durationField'
import { parseNumberField } from '@/lib/forms/numberField'
import type { UpdateProductDetailsInput } from '@/lib/api/products'
import type { Product } from '@/types/domain'

// "Editar produto" — seção "Dados do produto" — mesmo padrão visual de
// campos/categoria/duração/peso/personalização já aprovado em
// ProductForm.tsx ("Novo produto"), mas SEM preço nem Tipo do produto:
// - preço tem sua própria seção "Preço" no mesmo diálogo (ProductPriceForm,
//   inalterado — só ali para preservar o Motivo/histórico já existente,
//   nunca duplicado aqui);
// - Tipo do produto (product_type) fica fora do escopo desta edição
//   (classificação de criação, mudar depois é maior risco — ver
//   supabase/migrations/20260829143000_add_product_edit_function.sql).
// Salvamento independente da seção Preço (mesmo idioma "separado e
// atômico" já usado por Filamentos vs. Acessórios/Embalagens dentro do
// diálogo de composição): botão próprio "Salvar dados do produto", nunca o
// mesmo submit/estado da seção Preço.

const CATEGORY_HELP_ID = 'product-edit-category-help'
const CUSTOM_CATEGORY_INPUT_ID = 'product-edit-category-custom'
const DURATION_INPUT_ID = 'product-edit-print-time'
const DURATION_HELP_ID = 'product-edit-print-time-help'
const DURATION_ERROR_ID = 'product-edit-print-time-error'

// Mesmas opções pré-definidas de ProductForm.tsx — nunca reinventadas.
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

interface ProductEditDetailsFormProps {
  product: Product
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: UpdateProductDetailsInput) => void
}

export function ProductEditDetailsForm({
  product,
  isSubmitting,
  submitError,
  onSubmit,
}: ProductEditDetailsFormProps) {
  const [name, setName] = useState(product.name)

  const initialCategoryIsPredefined = product.category != null && CATEGORY_OPTIONS.includes(product.category)
  const [categorySelection, setCategorySelection] = useState<string>(() => {
    if (!product.category) return ''
    return initialCategoryIsPredefined ? product.category : OTHER_CATEGORY
  })
  const [customCategory, setCustomCategory] = useState<string>(() =>
    product.category && !initialCategoryIsPredefined ? product.category : '',
  )

  const [description, setDescription] = useState(product.description ?? '')
  const [printTimeInput, setPrintTimeInput] = useState(() =>
    product.default_print_time_seconds != null ? formatSecondsToHHMMSS(product.default_print_time_seconds) : '',
  )
  const [weightGrams, setWeightGrams] = useState(() =>
    product.default_weight_grams != null ? String(product.default_weight_grams) : '',
  )
  const [allowsPersonalization, setAllowsPersonalization] = useState(product.allows_personalization)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function resetToProduct() {
    setName(product.name)
    setCategorySelection(!product.category ? '' : initialCategoryIsPredefined ? product.category : OTHER_CATEGORY)
    setCustomCategory(product.category && !initialCategoryIsPredefined ? product.category : '')
    setDescription(product.description ?? '')
    setPrintTimeInput(
      product.default_print_time_seconds != null ? formatSecondsToHHMMSS(product.default_print_time_seconds) : '',
    )
    setWeightGrams(product.default_weight_grams != null ? String(product.default_weight_grams) : '')
    setAllowsPersonalization(product.allows_personalization)
    setFieldErrors({})
  }

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
      <h3 className="text-sm font-semibold">Dados do produto</h3>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-edit-name">Nome</Label>
        <Input id="product-edit-name" value={name} onChange={(event) => setName(event.target.value)} />
        {fieldErrors.name && <p className="text-destructive text-sm">{fieldErrors.name}</p>}
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
        <Label htmlFor="product-edit-description">Descrição</Label>
        <Textarea
          id="product-edit-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-edit-weight">Peso total (g)</Label>
        <Input
          id="product-edit-weight"
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
        <Label htmlFor="product-edit-allows-personalization">Permite personalização</Label>
        <Switch
          id="product-edit-allows-personalization"
          checked={allowsPersonalization}
          onCheckedChange={(checked) => setAllowsPersonalization(checked)}
          className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
        />
      </div>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={resetToProduct}
          disabled={isSubmitting}
          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
        >
          Desfazer alterações
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
        >
          {isSubmitting ? 'Salvando...' : 'Salvar dados do produto'}
        </Button>
      </div>
    </form>
  )
}
