import { useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useStockMovements } from '@/hooks/useStockMovements'
import { getAccessoryCurrentStock } from '@/lib/api/accessories'
import { ApiError } from '@/lib/api/errors'
import { parseNumberField } from '@/lib/forms/numberField'

// Motivo padrão quando o usuário não digita nada — register_stock_movement
// exige `reason` não vazio para POSITIVE_ADJUSTMENT/NEGATIVE_ADJUSTMENT
// (stock_movements_reason_required_by_type, migration 20260827090000).
// Mesmo recurso já usado em FilamentSpoolWeightAdjustDialog (ADJUST_REASON):
// a "observação opcional" da interface vira sempre um motivo real no ledger.
const DEFAULT_REASON = 'Ajuste de saldo por contagem'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function todayIsoDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface AccessoryStockAdjustItem {
  id: string
  name: string
  current_stock: number
}

export interface AccessoryStockAdjustDialogProps {
  item: AccessoryStockAdjustItem | null
  onClose: () => void
  // Recebe o id explicitamente (nunca lido de volta de um estado do chamador
  // que pode já ter sido limpo) — fechar antes da resposta voltar nunca
  // perde a atualização nem aplica no acessório errado. `newStock` é sempre
  // o `balance_after` real devolvido pelo backend.
  onAdjusted: (accessoryId: string, newStock: number) => void
}

// Só montado enquanto `item` existe (key={item.id} no wrapper) — o hook
// nunca é chamado com um id vazio/trocado sob o mesmo componente.
function AccessoryStockAdjustForm({
  item,
  onClose,
  onAdjusted,
}: {
  item: AccessoryStockAdjustItem
  onClose: () => void
  onAdjusted: AccessoryStockAdjustDialogProps['onAdjusted']
}) {
  const { register } = useStockMovements('ACCESSORY', item.id)
  const [newQuantity, setNewQuantity] = useState('')
  const [observation, setObservation] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // "Nenhuma alteração" ou "estoque alterado simultaneamente" — nunca um
  // sucesso; exibido no lugar do toast de sucesso.
  const [notice, setNotice] = useState<string | null>(null)
  // Espelha o saldo atual mostrado — atualizado quando a releitura pré-envio
  // (ou o balance_after divergente) revela que o valor mudou.
  const [currentStock, setCurrentStock] = useState(item.current_stock)
  // Estado PRÓPRIO (não só o do hook) — bloqueia um segundo envio disparado
  // antes de o hook sinalizar o estado pendente (dois cliques no mesmo tick).
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Idempotência (retry seguro de duplo clique/falha de rede): a mesma chave
  // é reenviada enquanto o fingerprint da tentativa não muda; qualquer
  // mudança (inclusive um saldo-base diferente após releitura) gera uma
  // chave nova. Nunca gerada a cada render.
  const idempotencyRef = useRef<{ key: string; fingerprint: string } | null>(null)
  function getIdempotencyKey(fingerprint: string): string {
    if (idempotencyRef.current && idempotencyRef.current.fingerprint === fingerprint) {
      return idempotencyRef.current.key
    }
    const key = crypto.randomUUID()
    idempotencyRef.current = { key, fingerprint }
    return key
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setNotice(null)
    setSubmitError(null)

    const parsed = parseNumberField(newQuantity, 'a nova quantidade', {
      required: true,
      min: 0,
      integer: true,
    })
    if (parsed.error) {
      setFieldError(parsed.error)
      return
    }
    setFieldError(null)
    const target = parsed.value as number

    setIsSubmitting(true)
    try {
      // 1. Reconsulta o saldo mais recente do acessório (estreita a janela
      //    de corrida com uma alteração concorrente de outro usuário). Se a
      //    releitura falhar, cai no valor exibido — o backend ainda protege
      //    (FOR UPDATE + balance_after >= 0).
      let latest: number
      try {
        latest = await getAccessoryCurrentStock(item.id)
      } catch {
        latest = currentStock
      }
      setCurrentStock(latest)

      // 2. Recalcula a diferença sobre o saldo mais recente.
      const delta = target - latest
      if (delta === 0) {
        setNotice('A nova quantidade é igual à atual — nenhum ajuste foi registrado.')
        return
      }

      // 3. Registra a DIFERENÇA pela operação de movimentação existente —
      //    nunca um UPDATE direto do saldo. Sinal resolve o movement_type;
      //    a quantidade enviada é o valor absoluto da diferença.
      const movementType = delta > 0 ? 'POSITIVE_ADJUSTMENT' : 'NEGATIVE_ADJUSTMENT'
      const reason = observation.trim() || DEFAULT_REASON
      const occurredAt = todayIsoDate()
      const fingerprint = JSON.stringify([movementType, Math.abs(delta), reason, occurredAt, latest])

      const created = await register({
        movement_type: movementType,
        quantity: Math.abs(delta),
        reason,
        occurred_at: occurredAt,
        idempotency_key: getIdempotencyKey(fingerprint),
      })

      // 4. Compara o balance_after real com o pretendido.
      onAdjusted(item.id, created.balance_after)
      if (created.balance_after !== target) {
        setCurrentStock(created.balance_after)
        setNotice(
          `O estoque foi alterado por outra pessoa durante o ajuste. Saldo agora: ${created.balance_after} ` +
            `(você pretendia ${target}). Revise o ajuste se necessário.`,
        )
        return
      }

      toast.success('Ajuste registrado.')
      onClose()
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError) setSubmitError(message)
      else toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
      {/* Nome do acessório em destaque, logo abaixo do título — aparece uma
          ÚNICA vez (nunca também no título/descrição do diálogo). */}
      <p className="text-base font-semibold">{item.name}</p>

      <p className="text-muted-foreground text-sm tabular-nums">Quantidade atual: {currentStock}</p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="accessory-stock-adjust-new-quantity">Nova quantidade</Label>
        <Input
          id="accessory-stock-adjust-new-quantity"
          inputMode="numeric"
          value={newQuantity}
          onChange={(event) => {
            setNewQuantity(event.target.value)
            setFieldError(null)
            setNotice(null)
          }}
          disabled={isSubmitting}
          aria-invalid={fieldError ? true : undefined}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-32"
        />
        {fieldError && <p className="text-destructive text-sm">{fieldError}</p>}
      </div>

      <div className="flex flex-col gap-2">
        {/* Rótulo "Observação"; segue sendo opcional (sem validação) — sem
            observação, o backend recebe o motivo padrão
            "Ajuste de saldo por contagem". */}
        <Label htmlFor="accessory-stock-adjust-observation">Observação</Label>
        <Textarea
          id="accessory-stock-adjust-observation"
          value={observation}
          onChange={(event) => setObservation(event.target.value)}
          disabled={isSubmitting}
        />
      </div>

      {notice && (
        <p role="alert" className="text-amber-700 text-sm">
          {notice}
        </p>
      )}
      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
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
          {isSubmitting ? 'Salvando...' : 'Salvar ajuste'}
        </Button>
      </DialogFooter>
    </form>
  )
}

// Janela simples de ajuste por quantidade ABSOLUTA (2026-09-06) — substitui,
// só em Acessórios, o antigo "Movimentar estoque" com o formulário genérico
// de movimentação. O usuário informa a nova quantidade total; a diferença é
// registrada pela mesma RPC register_stock_movement
// (POSITIVE_ADJUSTMENT/NEGATIVE_ADJUSTMENT), nunca um UPDATE direto do saldo.
// Não altera unit_cost.
export function AccessoryStockAdjustDialog({ item, onClose, onAdjusted }: AccessoryStockAdjustDialogProps) {
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ajustar Quantidade</DialogTitle>
          {/* Descrição só para leitores de tela — o nome do acessório NÃO
              entra aqui (aparece uma única vez, em destaque, no corpo). */}
          <DialogDescription className="sr-only">
            Informe a nova quantidade total do acessório.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <AccessoryStockAdjustForm key={item.id} item={item} onClose={onClose} onAdjusted={onAdjusted} />
        )}
      </DialogContent>
    </Dialog>
  )
}
