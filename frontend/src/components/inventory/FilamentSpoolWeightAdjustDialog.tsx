import { useState, type FormEvent } from 'react'
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
import { useFilamentMovements } from '@/hooks/useFilamentMovements'
import { ApiError } from '@/lib/api/errors'
import { parseNumberField } from '@/lib/forms/numberField'
import type { FilamentSpool, FilamentSpoolStatus } from '@/types/domain'

// Motivo fixo — esta janela simplificada (2026-09-05) não pede motivo ao
// usuário (só peso líquido atual + novo peso líquido), mas
// register_filament_movement exige reason não vazio para
// POSITIVE_ADJUSTMENT/NEGATIVE_ADJUSTMENT
// (filament_movements_reason_required_by_type, migration 20260827110000) —
// preenchido aqui para satisfazer a regra já existente do backend sem
// reintroduzir o campo na interface.
const ADJUST_REASON = 'Ajuste de peso líquido (janela Ver rolos)'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}g`
}

function todayIsoDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type FilamentSpoolWeightAdjustedPatch = {
  current_net_weight_grams: number
  status?: FilamentSpoolStatus
}

export interface FilamentSpoolWeightAdjustDialogProps {
  spool: FilamentSpool | null
  onClose: () => void
  // Recebe o id do rolo explicitamente (nunca lido de volta de um estado do
  // chamador que pode já ter sido limpo) — fechar esta janela antes da
  // resposta voltar nunca perde a atualização nem aplica no rolo errado.
  onAdjusted: (spoolId: string, patch: FilamentSpoolWeightAdjustedPatch) => void
}

// Formulário só montado enquanto `spool` existe (ver componente abaixo) —
// useFilamentMovements nunca é chamado com um id vazio/trocado sob o mesmo
// componente.
function FilamentSpoolWeightAdjustForm({
  spool,
  onClose,
  onAdjusted,
}: {
  spool: FilamentSpool
  onClose: () => void
  onAdjusted: FilamentSpoolWeightAdjustDialogProps['onAdjusted']
}) {
  const { register, isRegistering: isHookRegistering } = useFilamentMovements(spool.id)
  const [newWeight, setNewWeight] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Estado PRÓPRIO do formulário (não só o `isRegistering` do hook) — evita
  // um segundo envio disparado antes do hook sinalizar o estado pendente
  // (ex.: dois cliques muito rápidos no mesmo tick de render).
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isBusy = isSubmitting || isHookRegistering

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isBusy) return

    const result = parseNumberField(newWeight, 'o novo peso líquido', { required: true, min: 0 })
    if (result.error) {
      setFieldError(result.error)
      return
    }

    // O valor digitado é o NOVO PESO LÍQUIDO ABSOLUTO — a diferença
    // necessária para o histórico é calculada aqui e gravada pela MESMA
    // rota de ajuste já existente (register_filament_movement,
    // POSITIVE_ADJUSTMENT/NEGATIVE_ADJUSTMENT), nunca um UPDATE direto do
    // peso.
    const delta = (result.value as number) - spool.current_net_weight_grams
    if (delta === 0) {
      setFieldError('Informe um peso líquido diferente do atual.')
      return
    }

    setFieldError(null)
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      const created = await register({
        movement_type: delta > 0 ? 'POSITIVE_ADJUSTMENT' : 'NEGATIVE_ADJUSTMENT',
        quantity: Math.abs(delta),
        reason: ADJUST_REASON,
        occurred_at: todayIsoDate(),
        idempotency_key: crypto.randomUUID(),
      })
      toast.success('Peso ajustado.')
      onAdjusted(spool.id, {
        current_net_weight_grams: created.balance_after,
        status: created.balance_after === 0 ? 'ESGOTADO' : undefined,
      })
      onClose()
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') setSubmitError(message)
      else toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
      <div className="flex flex-col gap-0.5">
        <p className="text-muted-foreground text-xs">Peso líquido atual</p>
        <p className="text-sm font-medium">{formatGrams(spool.current_net_weight_grams)}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="filament-spool-adjust-new-weight">Novo peso líquido (g)</Label>
        <Input
          id="filament-spool-adjust-new-weight"
          inputMode="decimal"
          value={newWeight}
          onChange={(event) => {
            setNewWeight(event.target.value)
            setFieldError(null)
          }}
          disabled={isBusy}
          aria-invalid={fieldError ? true : undefined}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-32"
        />
        {fieldError && <p className="text-destructive text-sm">{fieldError}</p>}
      </div>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={isBusy}
          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isBusy}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
        >
          {isBusy ? 'Salvando...' : 'Salvar ajuste'}
        </Button>
      </DialogFooter>
    </form>
  )
}

// Janela simplificada de ajuste de peso (2026-09-05) — substitui o antigo
// atalho "Ajustar peso" que abria a janela "Gerenciar" inteira só para
// pré-selecionar a operação "Ajuste". Só três elementos: peso líquido atual
// (somente leitura), novo peso líquido (campo numérico) e as ações
// Cancelar/Salvar ajuste.
export function FilamentSpoolWeightAdjustDialog({
  spool,
  onClose,
  onAdjusted,
}: FilamentSpoolWeightAdjustDialogProps) {
  return (
    <Dialog
      open={spool !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ajustar peso</DialogTitle>
          <DialogDescription>{spool?.code}</DialogDescription>
        </DialogHeader>
        {spool && (
          <FilamentSpoolWeightAdjustForm
            key={spool.id}
            spool={spool}
            onClose={onClose}
            onAdjusted={onAdjusted}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
