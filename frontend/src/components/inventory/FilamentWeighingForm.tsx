import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { parseNumberField } from '@/lib/forms/numberField'
import { cn } from '@/lib/utils'

// Espelha exatamente as regras de register_filament_weighing()
// (supabase/migrations/20260827110000_create_filament_movements_table.sql):
// peso disponível = peso bruto medido - peso do carretel vazio (quando
// conhecido) OU o peso líquido informado diretamente (quando não é — nunca
// inventamos uma tara). Motivo é sempre obrigatório — nenhuma tolerância
// percentual é aplicada, qualquer que seja o tamanho da diferença (o pedido
// original é explícito: não inventar um percentual sem regra aprovada).

type WeighingMode = 'GROSS' | 'NET'

const ACTION_BUTTON_CLASSNAME =
  'focus-visible:ring-brand-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_BUTTON_SELECTED_CLASSNAME = 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
const ACTION_BUTTON_UNSELECTED_CLASSNAME = 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'

function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}g`
}

export interface FilamentWeighingFormValues {
  measured_gross_weight_grams: number | null
  measured_net_weight_grams: number | null
  reason: string
}

interface FilamentWeighingFormProps {
  currentWeightGrams: number
  // null quando a tara do rolo não é conhecida — nesse caso o modo "Peso
  // bruto medido" fica indisponível (nunca inventamos uma tara para
  // permitir o cálculo).
  emptySpoolWeightGrams: number | null
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: FilamentWeighingFormValues) => void
  onCancel: () => void
}

export function FilamentWeighingForm({
  currentWeightGrams,
  emptySpoolWeightGrams,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: FilamentWeighingFormProps) {
  const [mode, setMode] = useState<WeighingMode>(emptySpoolWeightGrams !== null ? 'GROSS' : 'NET')
  const [weight, setWeight] = useState('')
  const [reason, setReason] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const parsedWeight = parseNumberField(weight, 'o peso').value
  const computedNet =
    parsedWeight !== undefined
      ? mode === 'GROSS' && emptySpoolWeightGrams !== null
        ? parsedWeight - emptySpoolWeightGrams
        : mode === 'NET'
          ? parsedWeight
          : null
      : null
  const delta = computedNet !== null ? computedNet - currentWeightGrams : null

  function handleModeChange(next: WeighingMode) {
    setMode(next)
    setWeight('')
    setFieldErrors({})
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    const weightResult = parseNumberField(weight, mode === 'GROSS' ? 'o peso bruto medido' : 'o peso líquido disponível', {
      required: true,
      min: 0,
    })
    if (weightResult.error) errors.weight = weightResult.error

    if (!errors.weight && weightResult.value !== undefined) {
      const net = mode === 'GROSS' && emptySpoolWeightGrams !== null ? weightResult.value - emptySpoolWeightGrams : weightResult.value
      if (net < 0) {
        errors.weight =
          mode === 'GROSS'
            ? `O peso bruto medido não pode ser menor que a tara do carretel (${formatGrams(emptySpoolWeightGrams ?? 0)}).`
            : 'O peso líquido não pode ser negativo.'
      }
    }

    const trimmedReason = reason.trim()
    if (!trimmedReason) errors.reason = 'Motivo é obrigatório para registrar uma pesagem.'

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    const weightValue = weightResult.value as number
    onSubmit({
      measured_gross_weight_grams: mode === 'GROSS' ? weightValue : null,
      measured_net_weight_grams: mode === 'NET' ? weightValue : null,
      reason: trimmedReason,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <p className="text-muted-foreground text-sm">
        Peso disponível atual: <span className="text-foreground font-medium">{formatGrams(currentWeightGrams)}</span>
      </p>

      <div className="flex flex-col gap-2">
        <Label>Como pesar</Label>
        <div role="radiogroup" aria-label="Como pesar" className="flex flex-wrap gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'GROSS'}
            disabled={isSubmitting || emptySpoolWeightGrams === null}
            onClick={() => handleModeChange('GROSS')}
            className={cn(
              ACTION_BUTTON_CLASSNAME,
              mode === 'GROSS' ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME,
            )}
          >
            Peso bruto medido (rolo + carretel)
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'NET'}
            disabled={isSubmitting}
            onClick={() => handleModeChange('NET')}
            className={cn(
              ACTION_BUTTON_CLASSNAME,
              mode === 'NET' ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME,
            )}
          >
            Peso líquido disponível
          </button>
        </div>
        {emptySpoolWeightGrams === null ? (
          <p className="text-muted-foreground text-sm">
            Tara do carretel deste rolo não é conhecida — informe o peso líquido disponível diretamente.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">Tara do carretel deste rolo: {formatGrams(emptySpoolWeightGrams)}.</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="filament-weighing-value">{mode === 'GROSS' ? 'Peso bruto medido (g)' : 'Peso líquido disponível (g)'}</Label>
        <Input
          id="filament-weighing-value"
          inputMode="decimal"
          value={weight}
          onChange={(event) => {
            setWeight(event.target.value)
            setFieldErrors((current) => ({ ...current, weight: '' }))
          }}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.weight ? true : undefined}
          className="w-32 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        {fieldErrors.weight && <p className="text-destructive text-sm">{fieldErrors.weight}</p>}
        {computedNet !== null && delta !== null && (
          <p className="text-muted-foreground text-sm">
            Peso líquido calculado: <span className="text-foreground font-medium">{formatGrams(Math.max(computedNet, 0))}</span> —
            diferença em relação ao saldo atual:{' '}
            <span className={cn('font-medium', delta >= 0 ? 'text-brand-primary-dark' : 'text-destructive')}>
              {delta >= 0 ? '+' : ''}
              {formatGrams(delta)}
            </span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="filament-weighing-reason">Motivo/observação</Label>
        <Textarea
          id="filament-weighing-reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value)
            setFieldErrors((current) => ({ ...current, reason: '' }))
          }}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.reason ? true : undefined}
        />
        {fieldErrors.reason && <p className="text-destructive text-sm">{fieldErrors.reason}</p>}
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
          {isSubmitting ? 'Registrando...' : 'Registrar pesagem'}
        </Button>
      </DialogFooter>
    </form>
  )
}
