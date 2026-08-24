import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseNumberField } from '@/lib/forms/numberField'
import { cn } from '@/lib/utils'

// Formulário de CRIAÇÃO e EDIÇÃO compartilhado entre Acessórios e
// Embalagens — as duas têm exatamente os mesmos campos editáveis nesta
// etapa (confirmado por leitura: create/update_accessory e
// create/update_packaging têm assinatura idêntica). Ativação/desativação e
// exclusão continuam fora de escopo — nenhum campo Ativo aqui: um registro
// novo nasce ativo pelo default do banco (accessories/packaging.is_active
// not null default true), e a edição desta etapa nunca envia is_active,
// mesmo padrão já usado em CustomerForm.tsx.
export interface InventoryItemFormValues {
  name: string
  size: string | null
  variant: string | null
  minimum_stock: number
}

// Valores para pré-preencher o formulário em modo edição — mesmo padrão já
// aprovado em ProductForm.tsx (ProductFormInitialValues).
export interface InventoryItemFormInitialValues {
  name: string
  size: string | null
  variant: string | null
  minimum_stock: number | null
}

// "Não se aplica" (size = null) é uma opção explícita do grupo, não um
// estado vazio implícito — evita a ambiguidade de "nenhuma opção
// selecionada ainda" vs. "usuário escolheu deliberadamente não informar
// tamanho".
const SIZE_OPTIONS: Array<{ label: string; value: string | null }> = [
  { label: 'Não se aplica', value: null },
  { label: 'PP', value: 'PP' },
  { label: 'P', value: 'P' },
  { label: 'M', value: 'M' },
  { label: 'G', value: 'G' },
  { label: 'GG', value: 'GG' },
]

interface InventoryItemFormProps {
  // Prefixo para os ids dos campos (ex.: "accessory"/"packaging") — evita
  // colisão de id quando, em tese, dois diálogos deste formulário existem
  // na mesma árvore (acontece hoje: o diálogo de criação e o de edição de
  // uma mesma área usam idPrefix distintos, mesmo que nunca abertos ao
  // mesmo tempo, mantendo o componente seguro para reuso).
  idPrefix: string
  mode?: 'create' | 'edit'
  initialValues?: InventoryItemFormInitialValues
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: InventoryItemFormValues) => void
  onCancel: () => void
}

export function InventoryItemForm({
  idPrefix,
  mode = 'create',
  initialValues,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: InventoryItemFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [size, setSize] = useState<string | null>(initialValues?.size ?? null)
  const [variant, setVariant] = useState(initialValues?.variant ?? '')
  const [minimumStock, setMinimumStock] = useState(
    initialValues?.minimum_stock != null ? String(initialValues.minimum_stock) : '',
  )
  // Um tamanho legado (fora de PP/P/M/G/GG) vira uma opção extra do próprio
  // radiogroup, capturada uma única vez na montagem — nunca recalculada a
  // partir do `size` corrente, mesmo idioma já aprovado em
  // ProductCompositionForm.tsx (stableOutOfRangeByKey) para quantidades
  // fora do range. Isso permite ao usuário manter o valor legado
  // inalterado, escolher "Não se aplica" ou trocar por um valor oficial —
  // nunca digitar um valor livre novo, que não existe como campo de texto
  // aqui.
  const [sizeOptions] = useState(() => {
    const legacyValue = initialValues?.size
    if (!legacyValue || SIZE_OPTIONS.some((option) => option.value === legacyValue)) return SIZE_OPTIONS
    return [...SIZE_OPTIONS, { label: legacyValue, value: legacyValue }]
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    const trimmedName = name.trim()
    if (!trimmedName) errors.name = 'Informe o nome.'

    const minimumStockResult = parseNumberField(minimumStock, 'o estoque mínimo', {
      required: true,
      min: 0,
      integer: true,
    })
    if (minimumStockResult.error) errors.minimum_stock = minimumStockResult.error

    if (Object.keys(errors).length > 0) {
      // Nunca limpa os campos já preenchidos — só marca os que falharam.
      // Os valores digitados continuam nos próprios `useState` (name/size/
      // variant/minimumStock), intocados por este branch.
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    onSubmit({
      name: trimmedName,
      size,
      variant: variant.trim() ? variant.trim() : null,
      // minimumStockResult.value só é undefined quando há erro — já
      // tratado acima (early return), então aqui é sempre um número real.
      minimum_stock: minimumStockResult.value as number,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-name`}>Nome</Label>
        <Input
          id={`${idPrefix}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={isSubmitting}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        {fieldErrors.name && <p className="text-destructive text-sm">{fieldErrors.name}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Tamanho</Label>
        <div role="radiogroup" aria-label="Tamanho" className="flex flex-wrap gap-2">
          {sizeOptions.map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={size === option.value}
              disabled={isSubmitting}
              onClick={() => setSize(option.value)}
              className={cn(
                'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                size === option.value
                  ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-variant`}>Variante</Label>
        <Input
          id={`${idPrefix}-variant`}
          value={variant}
          onChange={(event) => setVariant(event.target.value)}
          disabled={isSubmitting}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-minimum-stock`}>Estoque mínimo</Label>
        <Input
          id={`${idPrefix}-minimum-stock`}
          inputMode="numeric"
          value={minimumStock}
          onChange={(event) => setMinimumStock(event.target.value)}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.minimum_stock ? true : undefined}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        {fieldErrors.minimum_stock && <p className="text-destructive text-sm">{fieldErrors.minimum_stock}</p>}
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
