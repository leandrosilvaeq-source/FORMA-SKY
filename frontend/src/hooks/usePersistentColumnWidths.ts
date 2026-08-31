import { useCallback, useState } from 'react'
import {
  clampWidth,
  normalizeColumnWidths,
  readStoredWidths,
  writeStoredWidths,
  clearStoredWidths,
  totalWidth,
  type ColumnWidthMap,
  type ColumnWidthSpec,
} from '@/lib/tables/columnWidths'

export interface UsePersistentColumnWidthsResult {
  widths: ColumnWidthMap
  totalWidthPx: number
  getWidth: (columnId: string) => number
  // Atualiza a largura em memória durante o arraste — nunca grava no
  // localStorage sozinho (ver commitWidths).
  setColumnWidth: (columnId: string, nextWidth: number) => void
  // Persiste o estado atual — chamado só ao soltar o arraste (pointerup),
  // nunca a cada pixel.
  commitWidths: () => void
  // Ajuste discreto por teclado — já persiste (cada tecla é, em si, um
  // "fim de ajuste").
  adjustByKeyboard: (columnId: string, deltaPx: number) => void
  // "Restaurar larguras": volta aos defaults desta tabela e apaga só a
  // preferência dela no localStorage.
  resetWidths: () => void
}

// Hook compartilhado — nunca conhece regras de Clientes/Empresas/Produtos/
// Pedidos/Estoque, só specs de coluna (id/defaultWidth/minWidth/maxWidth) +
// um identificador estável de tabela + o id do usuário autenticado (para
// isolar a preferência por usuário no mesmo navegador). SSR não é usado
// neste projeto, mas o acesso a window fica inteiramente dentro de
// columnWidths.ts (isBrowserStorageAvailable), nunca direto aqui.
//
// `specs` é sempre uma constante de módulo em quem chama este hook (ex.:
// ORDERS_COLUMN_SPECS), então sua referência já é estável entre renders —
// usada direto nos deps dos callbacks/efeito abaixo, sem precisar de um ref
// "mais recente" (que exigiria mutar/ler o ref durante o render, sinalizado
// pela regra react-hooks/refs).
export function usePersistentColumnWidths(
  tableId: string,
  userId: string | null,
  specs: ColumnWidthSpec[],
): UsePersistentColumnWidthsResult {
  const [widths, setWidths] = useState<ColumnWidthMap>(() => readStoredWidths(specs, tableId, userId))
  const [loadedKey, setLoadedKey] = useState(() => `${tableId}:${userId ?? ''}`)

  // "Ajustar estado durante a renderização" (padrão oficial do React para
  // resetar estado quando uma prop muda — https://react.dev/learn/you-might-not-need-an-effect
  // — evita o render em cascata extra que um useEffect+setState causaria,
  // sinalizado pela regra react-hooks/set-state-in-effect). Recarrega
  // quando a tabela ou o usuário mudam (ex.: alternar entre Acessórios/
  // Embalagens — sub-rotas diferentes, mesmo componente — ou trocar de
  // usuário autenticado no mesmo navegador).
  const currentKey = `${tableId}:${userId ?? ''}`
  if (currentKey !== loadedKey) {
    setLoadedKey(currentKey)
    setWidths(readStoredWidths(specs, tableId, userId))
  }

  const getWidth = useCallback((columnId: string) => widths[columnId] ?? 0, [widths])

  const setColumnWidth = useCallback(
    (columnId: string, rawWidth: number) => {
      const spec = specs.find((item) => item.id === columnId)
      if (!spec) return
      const next = clampWidth(rawWidth, spec)
      setWidths((current) => (current[columnId] === next ? current : { ...current, [columnId]: next }))
    },
    [specs],
  )

  const commitWidths = useCallback(() => {
    setWidths((current) => {
      writeStoredWidths(tableId, userId, current)
      return current
    })
  }, [tableId, userId])

  const adjustByKeyboard = useCallback(
    (columnId: string, deltaPx: number) => {
      const spec = specs.find((item) => item.id === columnId)
      if (!spec) return
      setWidths((current) => {
        const next = clampWidth((current[columnId] ?? spec.defaultWidth) + deltaPx, spec)
        const updated = { ...current, [columnId]: next }
        writeStoredWidths(tableId, userId, updated)
        return updated
      })
    },
    [specs, tableId, userId],
  )

  const resetWidths = useCallback(() => {
    const defaults = normalizeColumnWidths(specs, null)
    setWidths(defaults)
    clearStoredWidths(tableId, userId)
  }, [specs, tableId, userId])

  return {
    widths,
    totalWidthPx: totalWidth(specs, widths),
    getWidth,
    setColumnWidth,
    commitWidths,
    adjustByKeyboard,
    resetWidths,
  }
}
