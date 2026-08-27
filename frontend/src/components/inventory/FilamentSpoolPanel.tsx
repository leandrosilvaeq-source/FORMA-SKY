import { useState } from 'react'
import { toast } from 'sonner'
import { FilamentMovementForm, type FilamentMovementFormValues } from './FilamentMovementForm'
import { FilamentWeighingForm, type FilamentWeighingFormValues } from './FilamentWeighingForm'
import { FilamentMovementHistory } from './FilamentMovementHistory'
import { Button } from '@/components/ui/button'
import { useFilamentMovements } from '@/hooks/useFilamentMovements'
import { ApiError } from '@/lib/api/errors'
import { cn } from '@/lib/utils'
import type { FilamentSpool } from '@/types/domain'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}g`
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

type PanelAction = 'MOVE' | 'WEIGH'

const ACTION_BUTTON_CLASSNAME =
  'focus-visible:ring-brand-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_BUTTON_SELECTED_CLASSNAME = 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
const ACTION_BUTTON_UNSELECTED_CLASSNAME = 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'

export interface FilamentSpoolPanelProps {
  spool: FilamentSpool
  filamentTypeLabel: string
  // O chamador (FilamentTypeDrawer) aplica isso ao estado local via
  // useFilamentSpools.setLocalSpoolState, sem refetch.
  onSpoolChanged: (patch: { current_net_weight_grams: number; status?: FilamentSpool['status'] }) => void
  onClose: () => void
}

// Painel único (não diálogo aninhado): resumo do rolo + ação selecionada
// (Movimentar OU Registrar pesagem) + histórico, tudo visível de uma vez —
// mesmo espírito de StockMovementPanel.tsx. Ao contrário dele, este painel
// NÃO fecha sozinho após uma ação bem-sucedida (o usuário pode encadear
// mais de uma ação — ex.: movimentar e depois consultar o histórico
// atualizado — antes de fechar manualmente).
export function FilamentSpoolPanel({ spool, filamentTypeLabel, onSpoolChanged, onClose }: FilamentSpoolPanelProps) {
  const { movements, isLoading, loadError, refetch, isRegistering, register, isWeighing, weigh } = useFilamentMovements(spool.id)
  const [action, setAction] = useState<PanelAction>('MOVE')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const isDiscarded = spool.status === 'DESCARTADO'
  const isEligibleForInitialBalance = spool.current_net_weight_grams === 0 && !isLoading && !loadError && movements.length === 0

  async function handleRegisterMovement(values: FilamentMovementFormValues) {
    setSubmitError(null)
    try {
      const created = await register(values)
      toast.success('Movimentação registrada.')
      onSpoolChanged({
        current_net_weight_grams: created.balance_after,
        status: created.balance_after === 0 ? 'ESGOTADO' : undefined,
      })
    } catch (err) {
      setSubmitError(toErrorMessage(err))
    }
  }

  async function handleRegisterWeighing(values: FilamentWeighingFormValues) {
    setSubmitError(null)
    try {
      const created = await weigh(values)
      if (created === null) {
        toast.success('Nenhuma diferença encontrada em relação ao peso já registrado.')
        return
      }
      toast.success('Pesagem registrada.')
      onSpoolChanged({
        current_net_weight_grams: created.balance_after,
        status: created.balance_after === 0 ? 'ESGOTADO' : undefined,
      })
    } catch (err) {
      setSubmitError(toErrorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-xs">{filamentTypeLabel}</p>
          <p className="text-base font-medium">{spool.code}</p>
        </div>
        {!spool.is_active && (
          <span className="border-input text-muted-foreground inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
            Inativo
          </span>
        )}
      </div>

      <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-2 gap-2 rounded-lg border px-3 py-2 sm:grid-cols-4">
        <Field label="Peso nominal" value={formatGrams(spool.nominal_weight_grams)} />
        <Field label="Peso disponível" value={formatGrams(spool.current_net_weight_grams)} />
        <Field
          label="% restante"
          value={`${Math.round((spool.current_net_weight_grams / spool.nominal_weight_grams) * 100)}%`}
        />
        <Field label="Status" value={spool.status} />
      </div>

      {isDiscarded ? (
        <p role="status" className="text-muted-foreground text-sm">
          Este rolo foi descartado e não aceita novas movimentações. O histórico abaixo permanece disponível para consulta.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div role="radiogroup" aria-label="Ação" className="flex flex-wrap gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={action === 'MOVE'}
                onClick={() => {
                  setAction('MOVE')
                  setSubmitError(null)
                }}
                className={cn(ACTION_BUTTON_CLASSNAME, action === 'MOVE' ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME)}
              >
                Movimentar
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={action === 'WEIGH'}
                onClick={() => {
                  setAction('WEIGH')
                  setSubmitError(null)
                }}
                className={cn(ACTION_BUTTON_CLASSNAME, action === 'WEIGH' ? ACTION_BUTTON_SELECTED_CLASSNAME : ACTION_BUTTON_UNSELECTED_CLASSNAME)}
              >
                Registrar pesagem
              </button>
            </div>
          </div>

          {action === 'MOVE' ? (
            <FilamentMovementForm
              currentWeightGrams={spool.current_net_weight_grams}
              nominalWeightGrams={spool.nominal_weight_grams}
              isEligibleForInitialBalance={isEligibleForInitialBalance}
              isSubmitting={isRegistering}
              submitError={submitError}
              onSubmit={(values) => void handleRegisterMovement(values)}
              onCancel={onClose}
            />
          ) : (
            <FilamentWeighingForm
              currentWeightGrams={spool.current_net_weight_grams}
              emptySpoolWeightGrams={spool.empty_spool_weight_grams}
              isSubmitting={isWeighing}
              submitError={submitError}
              onSubmit={(values) => void handleRegisterWeighing(values)}
              onCancel={onClose}
            />
          )}
        </>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Histórico</p>
        <FilamentMovementHistory movements={movements} isLoading={isLoading} error={loadError} onRetry={refetch} />
      </div>

      {isDiscarded && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose} className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark">
            Fechar
          </Button>
        </div>
      )}
    </div>
  )
}
