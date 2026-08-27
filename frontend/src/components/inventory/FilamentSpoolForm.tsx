import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { parseNumberField } from '@/lib/forms/numberField'
import { cn } from '@/lib/utils'
import type { FilamentSpoolStatus } from '@/types/domain'

// Sugestão de interface — nunca um valor fixo/obrigatório (filament_spools.
// nominal_weight_grams aceita qualquer peso positivo). Clicar só preenche o
// campo; o usuário pode digitar qualquer outro peso livremente.
const NOMINAL_WEIGHT_SUGGESTIONS = [250, 500, 750, 1000]

// LACRADO/ABERTO/ESGOTADO/DESCARTADO — mesmos 4 status mínimos exigidos
// (supabase/migrations/20260827103000_create_filament_spools_table.sql).
// DESCARTADO nunca aparece como opção AQUI: descartar é uma ação separada,
// explícita e com confirmação própria (ver FilamentSpoolPanel/
// FilamentTypeDrawer "Descartar"), nunca um valor comum de radiogroup de
// edição de cadastro — evita descartar um rolo por engano ao editar outro
// campo do mesmo formulário.
const EDITABLE_STATUS_OPTIONS: FilamentSpoolStatus[] = ['LACRADO', 'ABERTO']

export interface FilamentSpoolFormValues {
  nominal_weight_grams: number
  empty_spool_weight_grams: number | null
  received_at: string | null
  status: FilamentSpoolStatus | null
  notes: string | null
}

export interface FilamentSpoolFormInitialValues {
  nominal_weight_grams: number
  empty_spool_weight_grams: number | null
  received_at: string | null
  status: FilamentSpoolStatus
  notes: string | null
}

interface FilamentSpoolFormProps {
  idPrefix: string
  mode?: 'create' | 'edit'
  initialValues?: FilamentSpoolFormInitialValues
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: FilamentSpoolFormValues) => void
  onCancel: () => void
}

export function FilamentSpoolForm({
  idPrefix,
  mode = 'create',
  initialValues,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: FilamentSpoolFormProps) {
  const [nominalWeightGrams, setNominalWeightGrams] = useState(
    initialValues?.nominal_weight_grams != null ? String(initialValues.nominal_weight_grams) : '',
  )
  const [emptySpoolWeightGrams, setEmptySpoolWeightGrams] = useState(
    initialValues?.empty_spool_weight_grams != null ? String(initialValues.empty_spool_weight_grams) : '',
  )
  const [receivedAt, setReceivedAt] = useState(initialValues?.received_at ?? '')
  const [status, setStatus] = useState<FilamentSpoolStatus | null>(initialValues?.status ?? 'LACRADO')
  const [notes, setNotes] = useState(initialValues?.notes ?? '')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // status editável só aceita LACRADO/ABERTO — se o rolo já estiver
  // ESGOTADO/DESCARTADO na abertura da edição, preserva esse valor como uma
  // opção extra (nunca força uma mudança de status sem o usuário decidir),
  // mesmo idioma já usado em InventoryItemForm para um `size` legado.
  const [statusOptions] = useState(() => {
    const current = initialValues?.status
    if (!current || (EDITABLE_STATUS_OPTIONS as string[]).includes(current)) return EDITABLE_STATUS_OPTIONS
    return [...EDITABLE_STATUS_OPTIONS, current]
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    const nominalResult = parseNumberField(nominalWeightGrams, 'o peso nominal', { required: true, min: 0.01 })
    if (nominalResult.error) errors.nominal_weight_grams = nominalResult.error

    const emptyResult = parseNumberField(emptySpoolWeightGrams, 'o peso do carretel vazio', { min: 0 })
    if (emptyResult.error) errors.empty_spool_weight_grams = emptyResult.error

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    onSubmit({
      nominal_weight_grams: nominalResult.value as number,
      empty_spool_weight_grams: emptyResult.value ?? null,
      received_at: receivedAt ? receivedAt : null,
      status,
      notes: notes.trim() ? notes.trim() : null,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-nominal-weight`}>Peso nominal (g)</Label>
        <Input
          id={`${idPrefix}-nominal-weight`}
          inputMode="decimal"
          value={nominalWeightGrams}
          onChange={(event) => {
            setNominalWeightGrams(event.target.value)
            setFieldErrors((current) => ({ ...current, nominal_weight_grams: '' }))
          }}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.nominal_weight_grams ? true : undefined}
          className="w-32 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        <div className="flex flex-wrap gap-1.5">
          {NOMINAL_WEIGHT_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setNominalWeightGrams(String(suggestion))
                setFieldErrors((current) => ({ ...current, nominal_weight_grams: '' }))
              }}
              className="border-input text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-brand-accent rounded-md border px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {suggestion}g
            </button>
          ))}
        </div>
        {fieldErrors.nominal_weight_grams && <p className="text-destructive text-sm">{fieldErrors.nominal_weight_grams}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-empty-weight`}>Peso do carretel vazio (g, opcional)</Label>
        <Input
          id={`${idPrefix}-empty-weight`}
          inputMode="decimal"
          value={emptySpoolWeightGrams}
          onChange={(event) => {
            setEmptySpoolWeightGrams(event.target.value)
            setFieldErrors((current) => ({ ...current, empty_spool_weight_grams: '' }))
          }}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.empty_spool_weight_grams ? true : undefined}
          className="w-32 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        <p className="text-muted-foreground text-sm">
          Quando conhecido, permite calcular o peso disponível a partir do peso bruto na pesagem física.
        </p>
        {fieldErrors.empty_spool_weight_grams && (
          <p className="text-destructive text-sm">{fieldErrors.empty_spool_weight_grams}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-received-at`}>Data de entrada/abertura (opcional)</Label>
        <Input
          id={`${idPrefix}-received-at`}
          type="date"
          className="w-40"
          value={receivedAt}
          onChange={(event) => setReceivedAt(event.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Status</Label>
        <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-2">
          {statusOptions.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={status === option}
              disabled={isSubmitting}
              onClick={() => setStatus(option)}
              className={cn(
                'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                status === option
                  ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-notes`}>Observações (opcional)</Label>
        <Textarea id={`${idPrefix}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isSubmitting} />
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
