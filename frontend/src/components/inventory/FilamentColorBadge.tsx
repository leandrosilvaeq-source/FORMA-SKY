// Badge de Cor da listagem de Filamentos (2026-09-04) — componente único e
// reutilizável para não duplicar o mapeamento de cor entre desktop e
// mobile: hoje só a tabela de "Estoque → Filamentos" (FilamentsInventoryPage)
// consome este componente (essa listagem consolidada nunca teve um card
// mobile dedicado — só a <table> com overflow-x-auto, responsiva por
// rolagem horizontal, documentado desde a coluna "Estoque mínimo" — então a
// MESMA marcação já é o que aparece em qualquer largura de tela, sem um
// segundo caminho de renderização a manter em sincronia); se um card mobile
// próprio for criado no futuro para esta ou outra listagem de filamentos,
// basta importar o mesmo FilamentColorBadge, sem reescrever o mapeamento
// (que fica em filamentColorStyles.ts, uma função pura sem React).
//
// O NOME COMPLETO da cor cadastrada é sempre preservado como texto (nunca
// substituído por um círculo/swatch sem texto) — só o estilo visual (cor de
// fundo/borda/texto) é derivado do nome para dar uma pista visual rápida.
// Cor não reconhecida nunca fica com texto invisível: cai no mesmo padrão
// neutro já usado pelos badges "Inativo"/"Arquivado" desta área (ver
// UNKNOWN_COLOR_CLASSNAME em filamentColorStyles.ts).
import { resolveFilamentColorClassName } from '@/lib/inventory/filamentColorStyles'

const BASE_BADGE_CLASSNAME =
  'inline-flex max-w-full items-center gap-1 truncate rounded-md border px-2 py-0.5 text-xs font-medium'

// Badge compacto para a coluna Cor — mesma dimensão/arredondamento/
// espaçamento do badge de Situação desta mesma listagem
// (FilamentStockLevelBadge, FilamentsInventoryPage.tsx: "rounded-md border
// px-2 py-0.5 text-xs font-medium"), só com `max-w-full truncate` a mais
// (nomes de cor compostos podem ser mais longos que os rótulos fixos de
// Situação). O texto completo cadastrado é sempre o conteúdo — nunca um
// círculo/swatch sem texto — e fica disponível por completo via `title`
// mesmo se a coluna truncar visualmente.
export function FilamentColorBadge({ label }: { label: string }) {
  return (
    <span
      className={`${BASE_BADGE_CLASSNAME} ${resolveFilamentColorClassName(label)}`}
      title={label}
    >
      {label}
    </span>
  )
}
