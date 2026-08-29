import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import { PAYMENT_METHOD_ITEMS, type IconComponent } from './OrderForm'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { inferPaymentType } from '@/lib/orders/paymentTypeInference'
import type { PaymentMethod, PaymentType } from '@/types/domain'

// Espelha exatamente as regras de supabase/functions/payments/index.ts +
// public.payments (Migration 12) + register_payment() (Migration
// 20260826120000_add_payment_overpayment_guard.sql) — nenhuma regra nova é
// inventada aqui além do que a RPC já impõe:
// - amount <> 0 (payments.amount check);
// - fora de AJUSTE, amount > 0 (payments_amount_type_consistency);
// - amount < 0 exige notes não vazio (payments_negative_adjustment_requires_notes);
// - a soma dos pagamentos do pedido nunca pode ficar negativa
//   (v_current_total + p_amount < 0);
// - a soma dos pagamentos nunca pode ultrapassar total_receivable
//   (v_current_total + p_amount > v_total_receivable) — regra confirmada
//   pelo usuário em 2026-08-26, revertendo a decisão anterior que permitia
//   pagamento excedente. Validado aqui só como conveniência de UI (erro
//   mais cedo, sem round-trip); o backend continua sendo a autoridade
//   final e pode rejeitar mesmo assim — a mensagem de erro real do backend
//   (submitError) é sempre exibida se, por qualquer motivo, o valor exibido
//   aqui como saldo devedor estiver desatualizado.

// Reaproveita exatamente a mesma constante/ícones de OrderForm.tsx (Pix/
// Dinheiro/Cartão) — só descarta a opção "Não informado" (value: null),
// que não se aplica a um pagamento já registrado (payment_method é sempre
// obrigatório em public.payments).
const PAYMENT_METHOD_OPTIONS = PAYMENT_METHOD_ITEMS.filter(
  (item): item is { label: string; value: PaymentMethod; Icon: IconComponent } => item.value !== null,
)

// Mesmas classes de botão-ação (pílula, ícone size-8, borda/fundo por
// estado) já usadas em Método de pagamento/Forma de entrega/Entrou em
// contato por em OrderForm.tsx — reaproveitadas ao pé da letra para os dois
// grupos novos deste formulário.
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

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const AMOUNT_INPUT_ID = 'payment-amount'
const AMOUNT_ERROR_ID = 'payment-amount-error'
const MAX_CENTS_MESSAGE = `O valor não pode ultrapassar ${formatCentsToBRL(MAX_CENTS)}.`

// Mesmas teclas de passagem livre de ProductPriceForm.tsx — o campo de
// valor é sempre "acrescenta/remove o último centavo" (nunca edição de
// texto livre no meio do valor), mas navegação/atalhos continuam
// funcionando.
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

export interface RegisterPaymentFormValues {
  payment_type: PaymentType
  payment_method: PaymentMethod
  amount: number
  paid_at: string
  notes: string | null
}

interface RegisterPaymentFormProps {
  // Total do pedido (total_receivable) e saldo devedor atual — só para o
  // resumo financeiro destacado no topo do formulário, nunca usados para
  // bloquear um valor acima do saldo (pagamento excedente é permitido).
  orderTotal: number
  balanceDue: number
  // Soma dos pagamentos já registrados para este pedido (payments.amount) —
  // usada só para replicar, no cliente, a checagem de "soma não pode ficar
  // negativa" de register_payment().
  currentTotalPaid: number
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: RegisterPaymentFormValues) => void
  onCancel: () => void
}

export function RegisterPaymentForm({
  orderTotal,
  balanceDue,
  currentTotalPaid,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: RegisterPaymentFormProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  // Valor sempre armazenado como centavos não-assinados (mesmo padrão
  // "bancário" de ProductPriceForm.tsx/lib/forms/currencyField.ts) + um
  // sinal separado, alternável pelo Switch "Ajuste negativo (estorno)"
  // abaixo — os dois eixos são ortogonais, currencyField.ts nunca precisou
  // saber de sinal. payment_type não é mais escolhido pelo usuário (campo
  // "Tipo de pagamento" removido, 2026-08-29) — é sempre inferido no
  // submit, a partir do valor/saldo (ver inferPaymentType, chamada em
  // handleSubmit abaixo); um valor negativo (isNegative=true) sempre infere
  // AJUSTE, preservando exatamente o mesmo mecanismo de ajuste
  // negativo/estorno já existente.
  const [cents, setCents] = useState(0)
  const [isNegative, setIsNegative] = useState(false)
  const [hasEditedAmount, setHasEditedAmount] = useState(false)
  const [paidAt, setPaidAt] = useState(todayIsoDate())
  const [notes, setNotes] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const amountInputRef = useRef<HTMLInputElement>(null)

  // Mesmo reposicionamento de cursor ao final após qualquer edição já usado
  // em ProductPriceForm.tsx — o campo é editado da direita para a esquerda.
  useEffect(() => {
    const el = amountInputRef.current
    if (el) {
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }, [cents, isNegative])

  function applyCents(next: number) {
    setCents(next)
    setHasEditedAmount(true)
    setFieldErrors((current) => ({ ...current, amount: '' }))
  }

  function handleAmountKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const { key, currentTarget } = event
    const isFullSelection =
      currentTarget.value.length > 0 &&
      currentTarget.selectionStart === 0 &&
      currentTarget.selectionEnd === currentTarget.value.length

    if (/^[0-9]$/.test(key)) {
      event.preventDefault()
      const base = isFullSelection ? 0 : cents
      const next = appendDigit(base, key)
      if (next === null) {
        setFieldErrors((current) => ({ ...current, amount: MAX_CENTS_MESSAGE }))
        return
      }
      applyCents(next)
      return
    }

    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault()
      applyCents(isFullSelection ? 0 : removeLastDigit(cents))
      return
    }

    if (PASSTHROUGH_KEYS.has(key) || event.ctrlKey || event.metaKey) return

    event.preventDefault()
  }

  // Fallback para teclado virtual (mobile) — mesmo raciocínio de
  // ProductPriceForm.tsx: reinterpreta a sequência de dígitos já aplicada
  // pelo navegador ao valor formatado, sem acumular sobre o cents anterior.
  function handleAmountChange(event: ChangeEvent<HTMLInputElement>) {
    const next = rawValueToCents(event.target.value)
    if (next > MAX_CENTS) {
      setFieldErrors((current) => ({ ...current, amount: MAX_CENTS_MESSAGE }))
      return
    }
    applyCents(next)
  }

  function handleAmountPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const text = event.clipboardData.getData('text')
    const parsed = parsePastedTextToCents(text)
    if (parsed === null) {
      setFieldErrors((current) => ({ ...current, amount: MAX_CENTS_MESSAGE }))
      return
    }
    applyCents(parsed)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    if (!paymentMethod) errors.payment_method = 'Selecione o método de pagamento.'
    if (!paidAt) errors.paid_at = 'Informe a data do pagamento.'

    const magnitude = centsToAmount(cents)
    const amountValue = isNegative ? -magnitude : magnitude

    if (!hasEditedAmount || cents === 0) {
      errors.amount = 'O valor não pode ser zero.'
    } else if (amountValue > 0 && amountValue > balanceDue) {
      errors.amount = `O valor não pode ultrapassar o saldo devedor. Valor máximo permitido: ${formatBRL(balanceDue)}.`
    } else if (amountValue < 0 && currentTotalPaid + amountValue < 0) {
      errors.amount = 'Este ajuste deixaria a soma dos pagamentos do pedido negativa.'
    }

    const trimmedNotes = notes.trim()
    if (amountValue < 0 && !trimmedNotes) {
      errors.notes = 'Observação é obrigatória para um ajuste negativo.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    onSubmit({
      payment_type: inferPaymentType(amountValue, balanceDue, currentTotalPaid),
      payment_method: paymentMethod as PaymentMethod,
      amount: amountValue,
      paid_at: paidAt,
      notes: trimmedNotes ? trimmedNotes : null,
    })
  }

  const amountDisplay = `${isNegative && cents > 0 ? '-' : ''}${formatCentsToBRL(cents)}`

  // Pedido totalmente pago (saldo devedor zerado ou já negativo por dado
  // legado anterior a esta regra): nenhum novo pagamento pode ser
  // registrado — qualquer valor positivo ultrapassaria o total do pedido
  // por definição, e a regra confirmada em 2026-08-26 é bloquear TODO novo
  // lançamento neste estado, sem exceção para Ajuste. Resumo financeiro
  // continua visível (mesmo bloco de sempre); só a parte interativa do
  // formulário é substituída por este aviso.
  if (balanceDue <= 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-3 gap-2 rounded-lg border px-3 py-2">
          <div>
            <p className="text-muted-foreground text-xs">Total do pedido</p>
            <p className="text-brand-primary-dark text-sm font-medium">{formatBRL(orderTotal)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Já pago</p>
            <p className="text-brand-primary-dark text-sm font-medium">{formatBRL(currentTotalPaid)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Saldo devedor</p>
            <p className="text-brand-primary-dark text-sm font-medium">{formatBRL(balanceDue)}</p>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          Este pedido já está totalmente pago — não é possível registrar um novo pagamento.
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
          >
            Fechar
          </Button>
        </DialogFooter>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-3 gap-2 rounded-lg border px-3 py-2">
        <div>
          <p className="text-muted-foreground text-xs">Total do pedido</p>
          <p className="text-brand-primary-dark text-sm font-medium">{formatBRL(orderTotal)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Já pago</p>
          <p className="text-brand-primary-dark text-sm font-medium">{formatBRL(currentTotalPaid)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Saldo devedor</p>
          <p className="text-brand-primary-dark text-sm font-medium">{formatBRL(balanceDue)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Método de pagamento</Label>
        <div role="radiogroup" aria-label="Método de pagamento" className="flex flex-wrap gap-2">
          {PAYMENT_METHOD_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={paymentMethod === item.value}
              disabled={isSubmitting}
              onClick={() => setPaymentMethod(item.value)}
              className={cn(
                ACTION_BUTTON_CLASSNAME,
                paymentMethod === item.value ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME,
              )}
            >
              <item.Icon className="text-brand-primary size-8 shrink-0" />
              {item.label}
            </button>
          ))}
        </div>
        {fieldErrors.payment_method && <p className="text-destructive text-sm">{fieldErrors.payment_method}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={AMOUNT_INPUT_ID}>Valor</Label>
        <Input
          id={AMOUNT_INPUT_ID}
          ref={amountInputRef}
          inputMode="numeric"
          value={amountDisplay}
          onChange={handleAmountChange}
          onKeyDown={handleAmountKeyDown}
          onPaste={handleAmountPaste}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.amount ? true : undefined}
          aria-describedby={fieldErrors.amount ? AMOUNT_ERROR_ID : undefined}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        {/* Sempre visível (2026-08-29): não depende mais de uma seleção
            prévia de "Tipo de pagamento" (removido) — o tipo é inferido no
            submit (inferPaymentType), e um valor negativo sempre infere
            AJUSTE. Mesmo Switch/mecanismo já existente, só sem o gate. */}
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={isNegative}
            onCheckedChange={setIsNegative}
            disabled={isSubmitting}
            aria-label="Ajuste negativo (estorno)"
            className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
          />
          Ajuste negativo (estorno)
        </label>
        {fieldErrors.amount && (
          <p id={AMOUNT_ERROR_ID} className="text-destructive text-sm">
            {fieldErrors.amount}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="payment-paid-at">Data do pagamento</Label>
        <Input
          id="payment-paid-at"
          type="date"
          className="w-40"
          value={paidAt}
          onChange={(event) => setPaidAt(event.target.value)}
          disabled={isSubmitting}
        />
        {fieldErrors.paid_at && <p className="text-destructive text-sm">{fieldErrors.paid_at}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="payment-notes">Observações</Label>
        <Textarea
          id="payment-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={isSubmitting}
        />
        {fieldErrors.notes && <p className="text-destructive text-sm">{fieldErrors.notes}</p>}
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
          {isSubmitting ? 'Registrando...' : 'Registrar pagamento'}
        </Button>
      </DialogFooter>
    </form>
  )
}
