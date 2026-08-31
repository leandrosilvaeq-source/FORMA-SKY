import { Button } from '@/components/ui/button'

// Botão discreto e reutilizável — restaura só a tabela atual (chama
// resetWidths do usePersistentColumnWidths correspondente, que apaga
// exclusivamente a chave de localStorage daquela tabela). Nunca mexe em
// filtros, busca ou ordenação — são estados React separados, não tocados
// por resetWidths.
export function RestoreColumnWidthsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground h-auto px-2 py-1 text-xs font-normal underline-offset-2 hover:underline"
    >
      Restaurar larguras
    </Button>
  )
}
