import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseNumberField } from '@/lib/forms/numberField'
import { cn } from '@/lib/utils'

// Formulário de CRIAÇÃO compartilhado entre Acessórios e Embalagens — as
// duas têm exatamente os mesmos campos editáveis nesta etapa (confirmado
// por leitura: create_accessory/create_packaging têm assinatura idêntica).
// Edição, ativação/desativação e exclusão continuam fora de escopo desta
// rodada — nenhum campo Ativo aqui: um registro novo nasce ativo pelo
// default do banco (accessories/packaging.is_active not null default
// true), nunca escolhido no formulário, mesmo padrão já usado em
// CustomerForm.tsx.
export interface InventoryItemFormValues {
  name: string
  size: string | null
  variant: string | null
  minimum_stock: number
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
  // na mesma árvore (não acontece hoje, já que as duas áreas nunca montam
  // ao mesmo tempo, mas mantém o componente seguro para reuso).
  idPrefix: string
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: InventoryItemFormValues) => void
  onCancel: () => void
}

export function InventoryItemForm({ idPrefix, isSubmitting, submitError, onSubmit, onCancel }: InventoryItemFormProps) {
  const [name, setName] = useState('')
  const [size, setSize] = useState<string | null>(null)
  const [variant, setVariant] = useState('')
  const [minimumStock, setMinimumStock] = useState('')
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
          {SIZE_OPTIONS.map((option) => (
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
          {isSubmitting ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}
