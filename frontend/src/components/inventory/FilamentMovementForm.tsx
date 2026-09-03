import { useMemo, useRef, useState, type ComponentType, type FormEvent } from 'react'
import { SlidersHorizontalIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { parseNumberField } from '@/lib/forms/numberField'
import { cn } from '@/lib/utils'
import type { FilamentMovementType } from '@/types/domain'

// A janela "Gerenciar" de um rolo oferece só duas operações manuais de
// movimentação (decisão do usuário, 2026-09-02): "Registrar perda" (baixa
// por perda/avaria — sempre movement_type = LOSS) e "Ajuste" (correção do
// peso líquido para um valor medido — o sinal do delta escolhe
// POSITIVE_ADJUSTMENT ou NEGATIVE_ADJUSTMENT). Entrada/Compra/Devolução/
// Saldo inicial e a antiga seção "Tipo" saíram da interface. As regras do
// backend (register_filament_movement, migration 20260827110000) não
// mudaram: continua fracionário (gramas), sempre uma quantidade positiva
// com o sinal resolvido pelo movement_type, motivo obrigatório para LOSS e
// para os dois ajustes, data em "Ocorrido em", idempotência por tentativa
// lógica. WEIGHING_ADJUSTMENT continua exclusivo do FilamentWeighingForm
// ("Registrar pesagem").

type IconComponent = ComponentType<{ className?: string }>

export type FilamentMovementOperation = 'LOSS' | 'ADJUST'

type ResolvedMovementType = Extract<
  FilamentMovementType,
  'LOSS' | 'POSITIVE_ADJUSTMENT' | 'NEGATIVE_ADJUSTMENT'
>

const OPERATION_ITEMS: Array<{
  label: string
  value: FilamentMovementOperation
  Icon: IconComponent
}> = [
  { label: 'Registrar perda', value: 'LOSS', Icon: TriangleAlertIcon },
  { label: 'Ajuste', value: 'ADJUST', Icon: SlidersHorizontalIcon },
]

// Mesma regra de filament_movements_reason_required_by_type (migration
// 20260827110000) e da Edge Function filament-movements — as três que
// restam nesta interface exigem motivo.
const REASON_REQUIRED_TYPES = new Set<ResolvedMovementType>([
  'LOSS',
  'POSITIVE_ADJUSTMENT',
  'NEGATIVE_ADJUSTMENT',
])

const ACTION_BUTTON_CLASSNAME =
  'focus-visible:ring-brand-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_BUTTON_SELECTED_CLASSNAME =
  'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
const ACTION_BUTTON_UNSELECTED_CLASSNAME =
  'border-input text-muted-foreground hover:bg-muted hover:text-foreground'

function todayIsoDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Duas casas decimais — mesma precisão gravada no banco (numeric(10,2)) —
// nunca mais dígitos exibidos do que o backend de fato preserva.
function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}g`
}

export interface FilamentMovementFormValues {
  movement_type: ResolvedMovementType
  quantity: number
  reason: string | null
  occurred_at: string
  idempotency_key: string
}

interface FilamentMovementFormProps {
  currentWeightGrams: number
  // Pré-seleciona uma operação ao abrir — o atalho "Ajustar peso" da janela
  // "Ver rolos" passa 'ADJUST'. Sem valor, nenhuma operação vem marcada e o
  // usuário escolhe normalmente.
  initialOperation?: FilamentMovementOperation | null
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: FilamentMovementFormValues) => void
  onCancel: () => void
}

export function FilamentMovementForm({
  currentWeightGrams,
  initialOperation = null,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: FilamentMovementFormProps) {
  const [operation, setOperation] = useState<FilamentMovementOperation | null>(initialOperation)
  // "Quantidade (g)" quando a operação é Registrar perda; "Novo peso
  // líquido (g)" quando é Ajuste.
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [occurredAt, setOccurredAt] = useState(todayIsoDate())
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Idempotência (mesmo idioma de StockMovementForm): uma "tentativa
  // lógica" é identificada pela combinação movement_type+quantity+reason+
  // occurred_at — a MESMA chave é reenviada enquanto esses valores não
  // mudam entre envios (retry seguro de duplo clique/falha de rede).
  const idempotencyRef = useRef<{ key: string; fingerprint: string } | null>(null)

  function getIdempotencyKey(fingerprint: string): string {
    if (idempotencyRef.current && idempotencyRef.current.fingerprint === fingerprint) {
      return idempotencyRef.current.key
    }
    const key = crypto.randomUUID()
    idempotencyRef.current = { key, fingerprint }
    return key
  }

  const amountFieldLabel = operation === 'ADJUST' ? 'Novo peso líquido (g)' : 'Quantidade (g)'
  const amountParseLabel = operation === 'ADJUST' ? 'o novo peso líquido' : 'a quantidade'
  const confirmLabel = operation === 'ADJUST' ? 'Confirmar ajuste' : 'Registrar perda'

  const parsedAmount = parseNumberField(amount, amountParseLabel).value

  // Prévia do resultado — só para exibição; a validação real acontece no
  // submit e a mensagem do backend continua sendo a proteção definitiva.
  const preview = useMemo(() => {
    if (parsedAmount === undefined) return null
    if (operation === 'LOSS') {
      if (parsedAmount <= 0) return null
      return { delta: -parsedAmount, projectedBalance: currentWeightGrams - parsedAmount }
    }
    if (operation === 'ADJUST') {
      if (parsedAmount < 0) return null
      const delta = parsedAmount - currentWeightGrams
      if (delta === 0) return null
      return { delta, projectedBalance: parsedAmount }
    }
    return null
  }, [operation, parsedAmount, currentWeightGrams])

  function handleOperationChange(next: FilamentMovementOperation) {
    setOperation(next)
    setAmount('')
    setFieldErrors({})
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    if (!operation) errors.operation = 'Selecione a operação.'

    // Fracionário (grama não é uma grandeza inteira). Registrar perda exige
    // > 0; Ajuste aceita 0 (zerar o rolo) mas nunca negativo.
    const amountResult = parseNumberField(amount, amountParseLabel, {
      required: true,
      min: operation === 'ADJUST' ? 0 : 0.01,
    })
    if (amountResult.error) errors.amount = amountResult.error

    let movementType: ResolvedMovementType | null = null
    let quantityValue: number | null = null

    if (operation === 'LOSS' && amountResult.value !== undefined && !errors.amount) {
      movementType = 'LOSS'
      quantityValue = amountResult.value
      if (amountResult.value > currentWeightGrams) {
        errors.amount = `A perda não pode ultrapassar o peso líquido atual (${formatGrams(currentWeightGrams)}).`
      }
    }

    if (operation === 'ADJUST' && amountResult.value !== undefined && !errors.amount) {
      const delta = amountResult.value - currentWeightGrams
      if (delta === 0) {
        errors.amount = 'Informe um peso líquido diferente do atual.'
      } else {
        movementType = delta > 0 ? 'POSITIVE_ADJUSTMENT' : 'NEGATIVE_ADJUSTMENT'
        quantityValue = Math.abs(delta)
      }
    }

    const trimmedReason = reason.trim()
    if (movementType && REASON_REQUIRED_TYPES.has(movementType) && !trimmedReason) {
      errors.reason = 'Motivo é obrigatório para esta operação.'
    }

    if (!occurredAt) errors.occurred_at = 'Informe a data da movimentação.'

    if (Object.keys(errors).length > 0 || movementType === null || quantityValue === null) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    const normalizedReason = trimmedReason ? trimmedReason : null
    const fingerprint = JSON.stringify([movementType, quantityValue, normalizedReason, occurredAt])

    onSubmit({
      movement_type: movementType,
      quantity: quantityValue,
      reason: normalizedReason,
      occurred_at: occurredAt,
      idempotency_key: getIdempotencyKey(fingerprint),
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label>Operação</Label>
        <div role="radiogroup" aria-label="Operação" className="flex flex-wrap gap-2">
          {OPERATION_ITEMS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={operation === item.value}
              disabled={isSubmitting}
              onClick={() => handleOperationChange(item.value)}
              className={cn(
                ACTION_BUTTON_CLASSNAME,
                operation === item.value
                  ? ACTION_BUTTON_SELECTED_CLASSNAME
                  : ACTION_BUTTON_UNSELECTED_CLASSNAME,
              )}
            >
              <item.Icon className="text-brand-primary size-8 shrink-0" />
              {item.label}
            </button>
          ))}
        </div>
        {fieldErrors.operation && (
          <p className="text-destructive text-sm">{fieldErrors.operation}</p>
        )}
      </div>

      {operation && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="filament-movement-quantity">{amountFieldLabel}</Label>
            <Input
              id="filament-movement-quantity"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setFieldErrors((current) => ({ ...current, amount: '' }))
              }}
              disabled={isSubmitting}
              aria-invalid={fieldErrors.amount ? true : undefined}
              className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-32"
            />
            {fieldErrors.amount && <p className="text-destructive text-sm">{fieldErrors.amount}</p>}
            {operation === 'ADJUST' && (
              <p className="text-muted-foreground text-sm">
                Peso líquido atual:{' '}
                <span className="text-brand-primary-dark font-medium">
                  {formatGrams(currentWeightGrams)}
                </span>
              </p>
            )}
            {preview && (
              <p className="text-muted-foreground text-sm">
                {operation === 'ADJUST' ? (
                  <>
                    Ajuste de{' '}
                    <span className="text-brand-primary-dark font-medium">
                      {preview.delta > 0 ? '+' : '−'}
                      {formatGrams(Math.abs(preview.delta))}
                    </span>{' '}
                    · peso líquido após:{' '}
                    <span className="text-brand-primary-dark font-medium">
                      {formatGrams(preview.projectedBalance)}
                    </span>
                  </>
                ) : (
                  <>
                    Peso líquido após a perda:{' '}
                    <span className="text-brand-primary-dark font-medium">
                      {formatGrams(preview.projectedBalance)}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="filament-movement-occurred-at">Ocorrido em</Label>
            <Input
              id="filament-movement-occurred-at"
              type="date"
              className="w-40"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
              disabled={isSubmitting}
            />
            {fieldErrors.occurred_at && (
              <p className="text-destructive text-sm">{fieldErrors.occurred_at}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="filament-movement-reason">Motivo/observação</Label>
            <Textarea
              id="filament-movement-reason"
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
        </>
      )}

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
          {isSubmitting ? 'Registrando...' : confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
