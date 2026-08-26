import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { parseNumberField } from '@/lib/forms/numberField'
import type { PaymentMethod, PaymentType } from '@/types/domain'

// Espelha exatamente as regras de supabase/functions/payments/index.ts +
// public.payments (Migration 12) — nenhuma regra nova é inventada aqui:
// - amount <> 0 (payments.amount check);
// - fora de AJUSTE, amount > 0 (payments_amount_type_consistency);
// - amount < 0 exige notes não vazio (payments_negative_adjustment_requires_notes);
// - a soma dos pagamentos do pedido nunca pode ficar negativa
//   (register_payment: v_current_total + p_amount < 0) — validado aqui só
//   como conveniência de UI (erro mais cedo, sem round-trip); o backend
//   continua sendo a autoridade final e pode rejeitar mesmo assim.
// Deliberadamente NÃO valida um teto máximo de valor: pagamento excedente é
// permitido sem estorno automático (vw_order_summary.has_overpayment/
// overpayment_amount), então nenhum limite superior é imposto aqui.

const PAYMENT_TYPE_ITEMS: Array<{ label: string; value: PaymentType }> = [
  { label: 'Sinal', value: 'SINAL' },
  { label: 'Final', value: 'FINAL' },
  { label: 'Integral', value: 'INTEGRAL' },
  { label: 'Ajuste', value: 'AJUSTE' },
]

const PAYMENT_METHOD_ITEMS: Array<{ label: string; value: PaymentMethod }> = [
  { label: 'Pix', value: 'PIX' },
  { label: 'Dinheiro', value: 'DINHEIRO' },
  { label: 'Cartão', value: 'CARTAO' },
]

function todayIsoDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface RegisterPaymentFormValues {
  payment_type: PaymentType
  payment_method: PaymentMethod
  amount: number
  paid_at: string
  notes: string | null
}

interface RegisterPaymentFormProps {
  // Soma dos pagamentos já registrados para este pedido (payments.amount) —
  // usada só para replicar, no cliente, a checagem de "soma não pode ficar
  // negativa" de register_payment(). Nunca usada para bloquear um valor
  // acima do saldo devedor (isso é permitido).
  currentTotalPaid: number
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: RegisterPaymentFormValues) => void
  onCancel: () => void
}

export function RegisterPaymentForm({
  currentTotalPaid,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: RegisterPaymentFormProps) {
  const [paymentType, setPaymentType] = useState<PaymentType | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(todayIsoDate())
  const [notes, setNotes] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const paymentTypeItems = PAYMENT_TYPE_ITEMS.map((item) => ({ label: item.label, value: item.value as string | null }))
  const paymentMethodItems = PAYMENT_METHOD_ITEMS.map((item) => ({
    label: item.label,
    value: item.value as string | null,
  }))

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    if (!paymentType) errors.payment_type = 'Selecione o tipo de pagamento.'
    if (!paymentMethod) errors.payment_method = 'Selecione o método de pagamento.'

    if (!paidAt) errors.paid_at = 'Informe a data do pagamento.'

    const amountResult = parseNumberField(amount, 'o valor', { required: true })
    const amountValue = amountResult.value
    if (amountResult.error || amountValue === undefined) {
      // required: true garante amountResult.error preenchido sempre que
      // value vier undefined — o `?? ''` nunca é de fato alcançado, só
      // satisfaz o TypeScript (amountResult.error e value não são
      // estaticamente correlacionados pelo tipo ParseNumberFieldResult).
      errors.amount = amountResult.error ?? ''
    } else if (amountValue === 0) {
      errors.amount = 'O valor não pode ser zero.'
    } else if (paymentType && paymentType !== 'AJUSTE' && amountValue < 0) {
      errors.amount = 'O valor deve ser maior que zero (só Ajuste aceita valor negativo).'
    } else if (amountValue < 0 && currentTotalPaid + amountValue < 0) {
      errors.amount = 'Este ajuste deixaria a soma dos pagamentos do pedido negativa.'
    }

    const trimmedNotes = notes.trim()
    if (amountValue !== undefined && amountValue < 0 && !trimmedNotes) {
      errors.notes = 'Observação é obrigatória para um ajuste negativo.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    onSubmit({
      payment_type: paymentType as PaymentType,
      payment_method: paymentMethod as PaymentMethod,
      amount: amountValue as number,
      paid_at: paidAt,
      notes: trimmedNotes ? trimmedNotes : null,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="payment-type">Tipo de pagamento</Label>
        <Select items={paymentTypeItems} value={paymentType} onValueChange={(value) => setPaymentType(value as PaymentType | null)}>
          <SelectTrigger id="payment-type" className="w-full" disabled={isSubmitting}>
            <SelectValue placeholder="Selecione o tipo" />
          </SelectTrigger>
          <SelectContent>
            {paymentTypeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldErrors.payment_type && <p className="text-destructive text-sm">{fieldErrors.payment_type}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="payment-method">Método de pagamento</Label>
        <Select
          items={paymentMethodItems}
          value={paymentMethod}
          onValueChange={(value) => setPaymentMethod(value as PaymentMethod | null)}
        >
          <SelectTrigger id="payment-method" className="w-full" disabled={isSubmitting}>
            <SelectValue placeholder="Selecione o método" />
          </SelectTrigger>
          <SelectContent>
            {paymentMethodItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldErrors.payment_method && <p className="text-destructive text-sm">{fieldErrors.payment_method}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="payment-amount">Valor (R$)</Label>
        <Input
          id="payment-amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.amount ? true : undefined}
        />
        {fieldErrors.amount && <p className="text-destructive text-sm">{fieldErrors.amount}</p>}
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
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Registrando...' : 'Registrar pagamento'}
        </Button>
      </DialogFooter>
    </form>
  )
}
