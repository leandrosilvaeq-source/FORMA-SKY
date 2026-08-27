import { useRef, useState, type ComponentType, type FormEvent } from 'react'
import {
  FlagIcon,
  MinusCircleIcon,
  PackageMinusIcon,
  PackagePlusIcon,
  PlusCircleIcon,
  ShoppingCartIcon,
  SlidersHorizontalIcon,
  TestTubeIcon,
  TriangleAlertIcon,
  Undo2Icon,
  WrenchIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { parseNumberField } from '@/lib/forms/numberField'
import { cn } from '@/lib/utils'
import type { FilamentMovementType } from '@/types/domain'

// Espelha exatamente as regras de register_filament_movement()
// (supabase/migrations/20260827110000_create_filament_movements_table.sql)
// — mesmo idioma de StockMovementForm.tsx, adaptado para gramas
// (fracionário, nunca inteiro) e para o conjunto de 8 tipos manuais de
// filamento (WEIGHING_ADJUSTMENT nunca aparece aqui — ver
// FilamentWeighingForm.tsx). Regras operacionais do MVP — versão inicial
// para validação, sujeitas a revisão após o teste prático do usuário.

type IconComponent = ComponentType<{ className?: string }>
type MovementCategory = 'ENTRADA' | 'SAIDA' | 'AJUSTE'

type ManualFilamentMovementType = Exclude<FilamentMovementType, 'WEIGHING_ADJUSTMENT'>

interface MovementTypeItem {
  label: string
  value: ManualFilamentMovementType
  Icon: IconComponent
}

const CATEGORY_ITEMS: Array<{ label: string; value: MovementCategory; Icon: IconComponent }> = [
  { label: 'Entrada', value: 'ENTRADA', Icon: PackagePlusIcon },
  { label: 'Saída', value: 'SAIDA', Icon: PackageMinusIcon },
  { label: 'Ajuste', value: 'AJUSTE', Icon: SlidersHorizontalIcon },
]

const ENTRY_ITEMS: MovementTypeItem[] = [
  { label: 'Saldo inicial', value: 'INITIAL_BALANCE', Icon: FlagIcon },
  { label: 'Compra', value: 'PURCHASE', Icon: ShoppingCartIcon },
  { label: 'Devolução', value: 'RETURN', Icon: Undo2Icon },
]

const ADJUSTMENT_ITEMS: MovementTypeItem[] = [
  { label: 'Ajuste positivo', value: 'POSITIVE_ADJUSTMENT', Icon: PlusCircleIcon },
  { label: 'Ajuste negativo', value: 'NEGATIVE_ADJUSTMENT', Icon: MinusCircleIcon },
]

const EXIT_ITEMS: MovementTypeItem[] = [
  { label: 'Consumo manual', value: 'MANUAL_CONSUMPTION', Icon: WrenchIcon },
  { label: 'Perda/Avaria', value: 'LOSS', Icon: TriangleAlertIcon },
  { label: 'Amostra/Teste', value: 'SAMPLE_TEST', Icon: TestTubeIcon },
]

// Mesma regra de filament_movements_reason_required_by_type (migration
// 20260827110000) e da Edge Function filament-movements.
const REASON_REQUIRED_TYPES = new Set<ManualFilamentMovementType>([
  'POSITIVE_ADJUSTMENT',
  'NEGATIVE_ADJUSTMENT',
  'LOSS',
  'SAMPLE_TEST',
  'MANUAL_CONSUMPTION',
])

const POSITIVE_DELTA_TYPES = new Set<ManualFilamentMovementType>(['INITIAL_BALANCE', 'PURCHASE', 'RETURN', 'POSITIVE_ADJUSTMENT'])

function isPositiveDelta(type: ManualFilamentMovementType): boolean {
  return POSITIVE_DELTA_TYPES.has(type)
}

const ACTION_BUTTON_CLASSNAME =
  'focus-visible:ring-brand-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_BUTTON_SELECTED_CLASSNAME = 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
const ACTION_BUTTON_UNSELECTED_CLASSNAME = 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'

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
  movement_type: ManualFilamentMovementType
  quantity: number
  reason: string | null
  occurred_at: string
  idempotency_key: string
}

interface FilamentMovementFormProps {
  currentWeightGrams: number
  nominalWeightGrams: number
  // "Saldo inicial" só é oferecido quando o peso atual é zero E não existe
  // nenhuma movimentação anterior para o rolo — mesmo critério de
  // StockMovementForm.
  isEligibleForInitialBalance: boolean
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: FilamentMovementFormValues) => void
  onCancel: () => void
}

export function FilamentMovementForm({
  currentWeightGrams,
  nominalWeightGrams,
  isEligibleForInitialBalance,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: FilamentMovementFormProps) {
  const [category, setCategory] = useState<MovementCategory | null>(null)
  const [movementType, setMovementType] = useState<ManualFilamentMovementType | null>(null)
  const [quantity, setQuantity] = useState('')
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

  function handleCategoryChange(next: MovementCategory) {
    setCategory(next)
    setMovementType(null)
    setFieldErrors((current) => ({ ...current, category: '', movement_type: '' }))
  }

  const items =
    category === 'ENTRADA'
      ? ENTRY_ITEMS.filter((item) => item.value !== 'INITIAL_BALANCE' || isEligibleForInitialBalance)
      : category === 'SAIDA'
        ? EXIT_ITEMS
        : category === 'AJUSTE'
          ? ADJUSTMENT_ITEMS
          : []

  const parsedQuantity = parseNumberField(quantity, 'a quantidade').value
  const isRoutineEntry = movementType === 'INITIAL_BALANCE' || movementType === 'PURCHASE' || movementType === 'RETURN'
  const projectedBalance =
    movementType && parsedQuantity !== undefined && parsedQuantity > 0
      ? currentWeightGrams + (isPositiveDelta(movementType) ? parsedQuantity : -parsedQuantity)
      : null

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    if (!category) errors.category = 'Selecione o tipo de movimentação.'
    if (category && !movementType) errors.movement_type = 'Selecione o tipo específico da movimentação.'

    // Fracionário (grama não é uma grandeza inteira) — diferente do
    // { integer: true } de StockMovementForm.
    const quantityResult = parseNumberField(quantity, 'a quantidade', { required: true, min: 0.01 })
    if (quantityResult.error) errors.quantity = quantityResult.error

    const trimmedReason = reason.trim()
    if (movementType && REASON_REQUIRED_TYPES.has(movementType) && !trimmedReason) {
      errors.reason = 'Motivo é obrigatório para este tipo de movimentação.'
    }

    if (!occurredAt) errors.occurred_at = 'Informe a data da movimentação.'

    // Conveniência de UI para os dois blocos que o backend também aplica —
    // a mensagem real do backend (submitError) continua sendo a proteção
    // definitiva e é sempre exibida se, mesmo assim, for rejeitada (ex.:
    // saldo desatualizado nesta tela).
    if (!errors.quantity && movementType && quantityResult.value !== undefined) {
      if (!isPositiveDelta(movementType) && quantityResult.value > currentWeightGrams) {
        errors.quantity = `A saída não pode ultrapassar o peso disponível atual (${formatGrams(currentWeightGrams)}).`
      }
      if (isRoutineEntry && currentWeightGrams + quantityResult.value > nominalWeightGrams) {
        errors.quantity = `O resultado ultrapassaria o peso nominal do rolo (${formatGrams(nominalWeightGrams)}). Para registrar um peso real acima do nominal, use um ajuste positivo com motivo.`
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    const quantityValue = quantityResult.value as number
    const normalizedReason = trimmedReason ? trimmedReason : null
    const fingerprint = JSON.stringify([movementType, quantityValue, normalizedReason, occurredAt])

    onSubmit({
      movement_type: movementType as ManualFilamentMovementType,
      quantity: quantityValue,
      reason: normalizedReason,
      occurred_at: occurredAt,
      idempotency_key: getIdempotencyKey(fingerprint),
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label>Movimentação</Label>
        <div role="radiogroup" aria-label="Movimentação" className="flex flex-wrap gap-2">
          {CATEGORY_ITEMS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={category === item.value}
              disabled={isSubmitting}
              onClick={() => handleCategoryChange(item.value)}
              className={cn(
                ACTION_BUTTON_CLASSNAME,
                category === item.value ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME,
              )}
            >
              <item.Icon className="text-brand-primary size-8 shrink-0" />
              {item.label}
            </button>
          ))}
        </div>
        {fieldErrors.category && <p className="text-destructive text-sm">{fieldErrors.category}</p>}
      </div>

      {category && (
        <div className="flex flex-col gap-2">
          <Label>Tipo</Label>
          <div role="radiogroup" aria-label="Tipo de movimentação" className="flex flex-wrap gap-2">
            {items.map((item) => (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={movementType === item.value}
                disabled={isSubmitting}
                onClick={() => {
                  setMovementType(item.value)
                  setFieldErrors((current) => ({ ...current, movement_type: '' }))
                }}
                className={cn(
                  ACTION_BUTTON_CLASSNAME,
                  movementType === item.value ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                )}
              >
                <item.Icon className="text-brand-primary size-8 shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
          {fieldErrors.movement_type && <p className="text-destructive text-sm">{fieldErrors.movement_type}</p>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="filament-movement-quantity">Quantidade (g)</Label>
        <Input
          id="filament-movement-quantity"
          inputMode="decimal"
          value={quantity}
          onChange={(event) => {
            setQuantity(event.target.value)
            setFieldErrors((current) => ({ ...current, quantity: '' }))
          }}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.quantity ? true : undefined}
          className="w-32 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        {fieldErrors.quantity && <p className="text-destructive text-sm">{fieldErrors.quantity}</p>}
        {projectedBalance !== null && (
          <p className="text-muted-foreground text-sm">
            Peso após movimentação: <span className="text-brand-primary-dark font-medium">{formatGrams(projectedBalance)}</span>
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
        {fieldErrors.occurred_at && <p className="text-destructive text-sm">{fieldErrors.occurred_at}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="filament-movement-reason">
          Motivo/observação{movementType && !REASON_REQUIRED_TYPES.has(movementType) ? ' (opcional)' : ''}
        </Label>
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
          {isSubmitting ? 'Registrando...' : 'Registrar movimentação'}
        </Button>
      </DialogFooter>
    </form>
  )
}
