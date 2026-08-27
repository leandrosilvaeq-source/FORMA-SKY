import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { parseNumberField } from '@/lib/forms/numberField'
import { cn } from '@/lib/utils'
import type { FilamentMaterial } from '@/types/domain'

// Materiais aceitos nesta etapa do MVP — ABS explicitamente fora do escopo
// aprovado (supabase/migrations/20260827100000_create_filament_types_table.sql).
const MATERIAL_OPTIONS: FilamentMaterial[] = ['PLA', 'PETG', 'TPU']

// Sugestões de interface — nunca um enum travado no banco (filament_types.line
// é texto livre). Clicar numa sugestão só preenche o campo de texto; o
// usuário pode digitar qualquer outra linha livremente.
const LINE_SUGGESTIONS = ['Sólida', 'Silk', 'Velvet', 'Translúcido', 'DuoColor']

export interface FilamentTypeFormValues {
  material: FilamentMaterial
  manufacturer: string
  line: string
  commercial_color: string
  color_code: string | null
  minimum_stock_grams: number | null
  notes: string | null
}

export interface FilamentTypeFormInitialValues {
  material: FilamentMaterial
  manufacturer: string
  line: string
  commercial_color: string
  color_code: string | null
  minimum_stock_grams: number | null
  notes: string | null
}

interface FilamentTypeFormProps {
  idPrefix: string
  mode?: 'create' | 'edit'
  initialValues?: FilamentTypeFormInitialValues
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: FilamentTypeFormValues) => void
  onCancel: () => void
}

export function FilamentTypeForm({
  idPrefix,
  mode = 'create',
  initialValues,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: FilamentTypeFormProps) {
  const [material, setMaterial] = useState<FilamentMaterial | null>(initialValues?.material ?? null)
  const [manufacturer, setManufacturer] = useState(initialValues?.manufacturer ?? '')
  const [line, setLine] = useState(initialValues?.line ?? '')
  const [commercialColor, setCommercialColor] = useState(initialValues?.commercial_color ?? '')
  const [colorCode, setColorCode] = useState(initialValues?.color_code ?? '')
  const [minimumStockGrams, setMinimumStockGrams] = useState(
    initialValues?.minimum_stock_grams != null ? String(initialValues.minimum_stock_grams) : '',
  )
  const [notes, setNotes] = useState(initialValues?.notes ?? '')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    if (!material) errors.material = 'Selecione o material.'

    const trimmedManufacturer = manufacturer.trim()
    if (!trimmedManufacturer) errors.manufacturer = 'Informe o fabricante.'

    const trimmedLine = line.trim()
    if (!trimmedLine) errors.line = 'Informe a linha.'

    const trimmedColor = commercialColor.trim()
    if (!trimmedColor) errors.commercial_color = 'Informe a cor.'

    const minimumStockResult = parseNumberField(minimumStockGrams, 'o peso mínimo de alerta', { min: 0 })
    if (minimumStockResult.error) errors.minimum_stock_grams = minimumStockResult.error

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    onSubmit({
      material: material as FilamentMaterial,
      manufacturer: trimmedManufacturer,
      line: trimmedLine,
      commercial_color: trimmedColor,
      color_code: colorCode.trim() ? colorCode.trim() : null,
      minimum_stock_grams: minimumStockResult.value ?? null,
      notes: notes.trim() ? notes.trim() : null,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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
                material === option
                  ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        {fieldErrors.material && <p className="text-destructive text-sm">{fieldErrors.material}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-manufacturer`}>Fabricante</Label>
        <Input
          id={`${idPrefix}-manufacturer`}
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
        <Label htmlFor={`${idPrefix}-line`}>Linha</Label>
        <Input
          id={`${idPrefix}-line`}
          value={line}
          onChange={(event) => {
            setLine(event.target.value)
            setFieldErrors((current) => ({ ...current, line: '' }))
          }}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.line ? true : undefined}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        <div className="flex flex-wrap gap-1.5">
          {LINE_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setLine(suggestion)
                setFieldErrors((current) => ({ ...current, line: '' }))
              }}
              className="border-input text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-brand-accent rounded-md border px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
        {fieldErrors.line && <p className="text-destructive text-sm">{fieldErrors.line}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-commercial-color`}>Cor</Label>
        <Input
          id={`${idPrefix}-commercial-color`}
          value={commercialColor}
          onChange={(event) => {
            setCommercialColor(event.target.value)
            setFieldErrors((current) => ({ ...current, commercial_color: '' }))
          }}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.commercial_color ? true : undefined}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        {fieldErrors.commercial_color && <p className="text-destructive text-sm">{fieldErrors.commercial_color}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-color-code`}>Código da cor (opcional)</Label>
        <Input
          id={`${idPrefix}-color-code`}
          value={colorCode}
          onChange={(event) => setColorCode(event.target.value)}
          disabled={isSubmitting}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-minimum-stock-grams`}>Peso mínimo de alerta (g)</Label>
        <Input
          id={`${idPrefix}-minimum-stock-grams`}
          inputMode="decimal"
          value={minimumStockGrams}
          onChange={(event) => setMinimumStockGrams(event.target.value)}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.minimum_stock_grams ? true : undefined}
          className="w-32 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        {fieldErrors.minimum_stock_grams && <p className="text-destructive text-sm">{fieldErrors.minimum_stock_grams}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-notes`}>Observações (opcional)</Label>
        <Textarea
          id={`${idPrefix}-notes`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={isSubmitting}
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
