import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FilamentMovementHistory } from './FilamentMovementHistory'
import { useFilamentMovements } from '@/hooks/useFilamentMovements'
import type { FilamentSpool } from '@/types/domain'

// Montado só enquanto `spool` existe (key={spool.id} no chamador) — o hook
// nunca é chamado com um id vazio/trocado sob o mesmo componente.
function FilamentSpoolHistoryContent({ spool }: { spool: FilamentSpool }) {
  const { movements, isLoading, loadError, refetch } = useFilamentMovements(spool.id)
  return (
    <FilamentMovementHistory
      movements={movements}
      isLoading={isLoading}
      error={loadError}
      onRetry={refetch}
    />
  )
}

export interface FilamentSpoolHistoryDialogProps {
  spool: FilamentSpool | null
  onClose: () => void
}

// Janela dedicada de histórico (2026-09-05), aberta pelo item "Histórico" do
// menu de três pontos de cada rolo — nunca mais reabre a antiga janela
// "Gerenciar" (removida junto com o botão homônimo). Reaproveita a MESMA
// consulta (useFilamentMovements/listFilamentMovements, filtrada por
// spool_id) e o MESMO componente de exibição (FilamentMovementHistory, que
// já cobre carregando/vazio/erro) usados antes dentro da janela "Gerenciar"
// — nenhuma lógica de busca duplicada.
export function FilamentSpoolHistoryDialog({ spool, onClose }: FilamentSpoolHistoryDialogProps) {
  return (
    <Dialog open={spool !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico do rolo</DialogTitle>
          <DialogDescription>{spool?.code}</DialogDescription>
        </DialogHeader>
        {spool && <FilamentSpoolHistoryContent key={spool.id} spool={spool} />}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
