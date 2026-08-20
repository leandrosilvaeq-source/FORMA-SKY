import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  MAX_CENTS,
  appendDigit,
  centsToAmount,
  formatCentsToBRL,
  parsePastedTextToCents,
  rawValueToCents,
  removeLastDigit,
} from '@/lib/forms/currencyField'
import type { UpdateProductPriceInput } from '@/lib/api/products'

const PRICE_INPUT_ID = 'product-new-price'
const PRICE_ERROR_ID = 'product-new-price-error'
const MAX_CENTS_MESSAGE = `O novo preço não pode ultrapassar ${formatCentsToBRL(MAX_CENTS)}.`

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Teclas de navegação/atalho que devem passar direto, sem virar dígito nem
// ser bloqueadas — o campo nunca aceita edição de texto livre no meio do
// valor (é sempre "acrescenta/remove o último centavo"), mas Tab/setas/
// copiar continuam funcionando normalmente.
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

interface ProductPriceFormProps {
  currentPrice: number
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: UpdateProductPriceInput) => void
  onCancel: () => void
}

export function ProductPriceForm({
  currentPrice,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: ProductPriceFormProps) {
  const [cents, setCents] = useState(0)
  // Distingue "campo nunca tocado" (Salvar deve exigir preço) de "usuário
  // digitou 0 de propósito" (0 é um preço válido) — ambos têm cents === 0.
  const [hasEdited, setHasEdited] = useState(false)
  const [reason, setReason] = useState('')
  const [priceError, setPriceError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sempre reposiciona o cursor no final após qualquer edição (dígito,
  // Backspace, colagem ou fallback de onChange) — o campo é editado da
  // direita para a esquerda (estilo maquininha), então a posição do cursor
  // antes da edição nunca deve influenciar o resultado nem deixar a
  // formatação inconsistente. useRef (em vez de document.getElementById)
  // controla o próprio input local, sem depender de busca global no DOM.
  useEffect(() => {
    const el = inputRef.current
    if (el) {
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }, [cents])

  function applyCents(next: number) {
    setCents(next)
    setHasEdited(true)
    setPriceError(null)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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
        setPriceError(MAX_CENTS_MESSAGE)
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

    // Qualquer outra tecla imprimível (letra, símbolo, vírgula/ponto digitados
    // diretamente) nunca modifica o valor — o campo só aceita dígito.
    event.preventDefault()
  }

  // Fallback para teclado virtual (mobile): onKeyDown não é confiável em
  // todos os teclados iOS/Android (ex.: Gboard costuma disparar keydown com
  // keyCode 229 "Process", sem a tecla real). Aqui o navegador já aplicou a
  // edição — só reinterpretamos os dígitos resultantes como os novos
  // centavos (nunca acumulando sobre o cents anterior, ao contrário de
  // appendDigit) e revalidamos o limite.
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = rawValueToCents(event.target.value)
    if (next > MAX_CENTS) {
      setPriceError(MAX_CENTS_MESSAGE)
      return
    }
    applyCents(next)
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const text = event.clipboardData.getData('text')
    const parsed = parsePastedTextToCents(text)
    if (parsed === null) {
      setPriceError(MAX_CENTS_MESSAGE)
      return
    }
    applyCents(parsed)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!hasEdited) {
      setPriceError('Informe o novo preço.')
      return
    }
    if (cents > MAX_CENTS) {
      setPriceError(MAX_CENTS_MESSAGE)
      return
    }
    setPriceError(null)

    onSubmit({
      new_price: centsToAmount(cents),
      reason: reason.trim() ? reason.trim() : null,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="border-brand-primary/20 bg-brand-primary-soft/40 rounded-lg border px-3 py-2">
        <p className="text-muted-foreground text-xs">Preço atual</p>
        <p className="text-brand-primary-dark text-base font-medium">{formatBRL(currentPrice)}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={PRICE_INPUT_ID} className="text-sm font-medium">
          Novo preço
        </Label>
        <Input
          id={PRICE_INPUT_ID}
          ref={inputRef}
          inputMode="numeric"
          value={formatCentsToBRL(cents)}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          aria-invalid={priceError ? true : undefined}
          aria-describedby={priceError ? PRICE_ERROR_ID : undefined}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
        />
        {priceError && (
          <p id={PRICE_ERROR_ID} className="text-destructive text-sm">
            {priceError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-price-reason">Motivo (opcional)</Label>
        <Textarea id="product-price-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
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
