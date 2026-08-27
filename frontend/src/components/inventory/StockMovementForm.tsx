import { useRef, useState, type ComponentType, type FormEvent } from 'react'
import {
  FlagIcon,
  GiftIcon,
  MinusCircleIcon,
  PackageMinusIcon,
  PackagePlusIcon,
  PlusCircleIcon,
  ShoppingCartIcon,
  SlidersHorizontalIcon,
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
import type { StockMovementType } from '@/types/domain'

// Espelha exatamente as regras de register_stock_movement()
// (supabase/migrations/20260827090000_create_stock_movements_table.sql) —
// nenhuma regra nova inventada aqui além do que a RPC já impõe. Regras
// operacionais do MVP — versão inicial para validação, sujeitas a revisão
// após o teste prático do usuário (docs/01_ESPECIFICACAO_FUNCIONAL.md §20).

type IconComponent = ComponentType<{ className?: string }>
type MovementCategory = 'ENTRADA' | 'SAIDA' | 'AJUSTE'

interface MovementTypeItem {
  label: string
  value: StockMovementType
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
  { label: 'Perda/Avaria', value: 'LOSS', Icon: TriangleAlertIcon },
  { label: 'Amostra/Doação', value: 'SAMPLE_DONATION', Icon: GiftIcon },
  { label: 'Uso interno', value: 'INTERNAL_USE', Icon: WrenchIcon },
]

// Mesma regra de stock_movements_reason_required_by_type (migration
// 20260827090000) e da Edge Function stock-movements — nenhuma duplicação
// de fonte de verdade, só o mesmo conjunto espelhado no cliente.
const REASON_REQUIRED_TYPES = new Set<StockMovementType>([
  'POSITIVE_ADJUSTMENT',
  'NEGATIVE_ADJUSTMENT',
  'LOSS',
  'SAMPLE_DONATION',
  'INTERNAL_USE',
])

const POSITIVE_DELTA_TYPES = new Set<StockMovementType>(['INITIAL_BALANCE', 'PURCHASE', 'RETURN', 'POSITIVE_ADJUSTMENT'])

function isPositiveDelta(type: StockMovementType): boolean {
  return POSITIVE_DELTA_TYPES.has(type)
}

// Mesmas classes de botão-ação já usadas em RegisterPaymentForm.tsx/
// OrderForm.tsx — reaproveitadas ao pé da letra.
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

export interface StockMovementFormValues {
  movement_type: StockMovementType
  quantity: number
  reason: string | null
  occurred_at: string
  idempotency_key: string
}

interface StockMovementFormProps {
  currentStock: number
  // "Saldo inicial" só é oferecido quando o saldo atual é zero E não existe
  // nenhuma movimentação anterior para o item (requisito do pedido) — o
  // chamador (StockMovementPanel) já sabe as duas coisas a partir do
  // histórico carregado; nunca recalculado aqui a partir de outra fonte.
  isEligibleForInitialBalance: boolean
  // Item inativo: Saldo inicial/Compra ficam indisponíveis (não fazem
  // sentido para repor estoque de algo que não está mais em uso ativo);
  // Devolução permanece disponível — register_stock_movement() não verifica
  // is_active em nenhum movement_type, então bloqueá-la aqui seria uma
  // restrição só de UI sem correspondência no contrato real do backend
  // (decisão desta rodada, sinalizada no relatório por não haver uma regra
  // documentada explicitamente para este caso).
  isItemActive: boolean
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: StockMovementFormValues) => void
  onCancel: () => void
}

export function StockMovementForm({
  currentStock,
  isEligibleForInitialBalance,
  isItemActive,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: StockMovementFormProps) {
  const [category, setCategory] = useState<MovementCategory | null>(null)
  const [movementType, setMovementType] = useState<StockMovementType | null>(null)
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [occurredAt, setOccurredAt] = useState(todayIsoDate())
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Idempotência (requisito 9 do pedido): uma "tentativa lógica" é
  // identificada pela combinação movement_type+quantity+reason+occurred_at
  // (item_id é fixo por instância deste formulário — nunca muda dentro de
  // um mesmo painel aberto). Enquanto esses valores não mudam entre envios,
  // a MESMA chave é reenviada (retry seguro de duplo clique/falha de rede,
  // sem duplicar a movimentação — o backend devolve a mesma movimentação já
  // gravada). Qualquer mudança gera uma chave nova. Nunca gerada a cada
  // render — só dentro de handleSubmit, e só quando o fingerprint muda.
  // Descartada implicitamente no sucesso: o painel fecha o diálogo (mesmo
  // padrão de RegisterPaymentForm/OrderManagementPanel), desmontando este
  // componente — a próxima abertura sempre parte de um useRef novo.
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
      ? ENTRY_ITEMS.filter((item) => {
          if (!isItemActive && (item.value === 'INITIAL_BALANCE' || item.value === 'PURCHASE')) return false
          if (item.value === 'INITIAL_BALANCE' && !isEligibleForInitialBalance) return false
          return true
        })
      : category === 'SAIDA'
        ? EXIT_ITEMS
        : category === 'AJUSTE'
          ? ADJUSTMENT_ITEMS
          : []

  const parsedQuantity = parseNumberField(quantity, 'a quantidade', { integer: true }).value
  const projectedBalance =
    movementType && parsedQuantity !== undefined && parsedQuantity > 0
      ? currentStock + (isPositiveDelta(movementType) ? parsedQuantity : -parsedQuantity)
      : null

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    if (!category) errors.category = 'Selecione o tipo de movimentação.'
    if (category && !movementType) errors.movement_type = 'Selecione o tipo específico da movimentação.'

    const quantityResult = parseNumberField(quantity, 'a quantidade', { required: true, min: 1, integer: true })
    if (quantityResult.error) errors.quantity = quantityResult.error

    const trimmedReason = reason.trim()
    if (movementType && REASON_REQUIRED_TYPES.has(movementType) && !trimmedReason) {
      errors.reason = 'Motivo é obrigatório para este tipo de movimentação.'
    }

    if (!occurredAt) errors.occurred_at = 'Informe a data da movimentação.'

    // Bloqueio também no frontend de saída maior que o saldo — conveniência
    // de UI para erro mais cedo, sem round-trip. O backend
    // (register_stock_movement) continua sendo a proteção definitiva e
    // pode rejeitar mesmo assim (ex.: saldo desatualizado nesta tela) — a
    // mensagem real do backend (submitError) é sempre exibida se isso
    // acontecer.
    if (!errors.quantity && movementType && quantityResult.value !== undefined && !isPositiveDelta(movementType)) {
      if (quantityResult.value > currentStock) {
        errors.quantity = `A saída não pode ultrapassar o saldo atual (${currentStock}).`
      }
    }

    if (Object.keys(errors).length > 0) {
      // Nunca limpa os campos já preenchidos — só marca os que falharam.
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    const quantityValue = quantityResult.value as number
    const normalizedReason = trimmedReason ? trimmedReason : null
    const fingerprint = JSON.stringify([movementType, quantityValue, normalizedReason, occurredAt])

    onSubmit({
      movement_type: movementType as StockMovementType,
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
        <Label htmlFor="stock-movement-quantity">Quantidade</Label>
        <Input
          id="stock-movement-quantity"
          inputMode="numeric"
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
            Saldo após movimentação: <span className="text-brand-primary-dark font-medium">{projectedBalance}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="stock-movement-occurred-at">Ocorrido em</Label>
        <Input
          id="stock-movement-occurred-at"
          type="date"
          className="w-40"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
          disabled={isSubmitting}
        />
        {fieldErrors.occurred_at && <p className="text-destructive text-sm">{fieldErrors.occurred_at}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="stock-movement-reason">
          Motivo/observação{movementType && !REASON_REQUIRED_TYPES.has(movementType) ? ' (opcional)' : ''}
        </Label>
        <Textarea
          id="stock-movement-reason"
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
