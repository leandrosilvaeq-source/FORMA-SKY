import { useRef } from 'react'
import { cn } from '@/lib/utils'

const KEYBOARD_STEP_PX = 10
const KEYBOARD_STEP_LARGE_PX = 30

export interface ColumnResizeHandleProps {
  columnId: string
  columnLabel: string
  width: number
  onResize: (columnId: string, nextWidth: number) => void
  onCommit: () => void
  onKeyboardResize: (columnId: string, deltaPx: number) => void
}

// Alça de redimensionamento na borda direita de um cabeçalho de coluna —
// Pointer Events com captura no PRÓPRIO elemento (setPointerCapture):
// pointermove/pointerup continuam chegando aqui mesmo se o ponteiro sair da
// alça durante o arraste (mouse rápido, dedo em touch), e a captura é
// liberada automaticamente pelo navegador em pointerup/pointercancel — ou
// se este componente desmontar no meio do arraste (troca de aba/rota) —
// então nunca precisa de listener global (window) e, por isso, nunca há
// listener residual para limpar depois de desmontar.
//
// stopPropagation no pointerdown/click garante que o clique na alça nunca
// chega ao botão de ordenação ao lado (que fica FORA da alça, nunca sob
// ela) nem abre o menu de ordenação. touch-none evita rolagem/seleção
// acidental da página durante o arraste em telas de toque; select-none
// evita seleção de texto no desktop.
export function ColumnResizeHandle({
  columnId,
  columnLabel,
  width,
  onResize,
  onCommit,
  onKeyboardResize,
}: ColumnResizeHandleProps) {
  const dragStartRef = useRef<{ clientX: number; width: number } | null>(null)

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = { clientX: event.clientX, width }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const delta = event.clientX - dragStartRef.current.clientX
    onResize(columnId, dragStartRef.current.width + delta)
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (dragStartRef.current) {
      dragStartRef.current = null
      onCommit()
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onKeyboardResize(columnId, event.shiftKey ? -KEYBOARD_STEP_LARGE_PX : -KEYBOARD_STEP_PX)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onKeyboardResize(columnId, event.shiftKey ? KEYBOARD_STEP_LARGE_PX : KEYBOARD_STEP_PX)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Redimensionar coluna ${columnLabel}`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'absolute top-0 right-0 z-10 h-full w-2 shrink-0 touch-none cursor-col-resize outline-none select-none',
        'hover:bg-brand-primary/25 focus-visible:bg-brand-accent/60',
      )}
    />
  )
}
