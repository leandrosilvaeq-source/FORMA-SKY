// Mapeamento de rótulo/estilo visual do Status de rolo (2026-09-05) —
// separado de FilamentSpoolStatusControl.tsx pelo mesmo motivo de
// filamentColorStyles.ts: não misturar export de componente com export de
// função/constante no mesmo arquivo (react-refresh/only-export-components).
//
// Cores pedidas pelo usuário: LACRADO neutro/azul, ABERTO verde, DESCARTADO
// vermelho/cinza destrutivo. ESGOTADO não é uma das 3 opções selecionáveis
// no dropdown (é sempre consequência automática do saldo chegar a 0), mas
// ainda precisa de um estilo próprio para o rótulo do botão quando um rolo
// já estiver nesse status — neutro/cinza, para não competir visualmente com
// os 3 status que o usuário de fato escolhe.
import type { FilamentSpoolStatus } from '@/types/domain'

export const FILAMENT_SPOOL_STATUS_LABELS: Record<FilamentSpoolStatus, string> = {
  LACRADO: 'Lacrado',
  ABERTO: 'Aberto',
  ESGOTADO: 'Esgotado',
  DESCARTADO: 'Descartado',
}

const STATUS_CLASSNAMES: Record<FilamentSpoolStatus, string> = {
  LACRADO: 'border-blue-300 bg-blue-50 text-blue-800',
  ABERTO: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  ESGOTADO: 'border-gray-300 bg-gray-100 text-gray-700',
  DESCARTADO: 'border-red-300 bg-red-50 text-red-800',
}

export function resolveFilamentSpoolStatusClassName(status: FilamentSpoolStatus): string {
  return STATUS_CLASSNAMES[status]
}
