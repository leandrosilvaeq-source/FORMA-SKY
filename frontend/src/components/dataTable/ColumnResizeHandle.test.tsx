import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ColumnResizeHandle } from './ColumnResizeHandle'

function renderHandle(overrides: Partial<Parameters<typeof ColumnResizeHandle>[0]> = {}) {
  const onResize = vi.fn()
  const onCommit = vi.fn()
  const onKeyboardResize = vi.fn()
  render(
    <ColumnResizeHandle
      columnId="name"
      columnLabel="Nome"
      width={200}
      onResize={onResize}
      onCommit={onCommit}
      onKeyboardResize={onKeyboardResize}
      {...overrides}
    />,
  )
  return { onResize, onCommit, onKeyboardResize }
}

describe('ColumnResizeHandle', () => {
  it('tem role="separator", aria-orientation vertical e nome acessível com a coluna', () => {
    renderHandle()
    const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Nome' })
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('é focável por teclado (tabIndex 0)', () => {
    renderHandle()
    expect(screen.getByRole('separator')).toHaveAttribute('tabindex', '0')
  })

  it('arraste para a direita aumenta a largura proporcionalmente ao deslocamento', () => {
    const { onResize } = renderHandle({ width: 200 })
    const handle = screen.getByRole('separator')

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 })

    expect(onResize).toHaveBeenCalledWith('name', 240)
  })

  it('arraste para a esquerda diminui a largura proporcionalmente ao deslocamento', () => {
    const { onResize } = renderHandle({ width: 200 })
    const handle = screen.getByRole('separator')

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 60, pointerId: 1 })

    expect(onResize).toHaveBeenCalledWith('name', 160)
  })

  it('onCommit é chamado ao soltar (pointerup) — nunca durante o arraste', () => {
    const { onResize, onCommit } = renderHandle()
    const handle = screen.getByRole('separator')

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 })
    expect(onCommit).not.toHaveBeenCalled()
    expect(onResize).toHaveBeenCalled()

    fireEvent.pointerUp(handle, { clientX: 140, pointerId: 1 })
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('pointercancel também finaliza o arraste (chama onCommit)', () => {
    const { onCommit } = renderHandle()
    const handle = screen.getByRole('separator')

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 })
    fireEvent.pointerCancel(handle, { pointerId: 1 })

    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('movimento sem pointerdown antes (nunca capturado) é ignorado, não chama onResize', () => {
    const { onResize } = renderHandle()
    const handle = screen.getByRole('separator')

    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 })

    expect(onResize).not.toHaveBeenCalled()
  })

  it('ArrowRight chama onKeyboardResize com incremento positivo padrão (10px)', () => {
    const { onKeyboardResize } = renderHandle()
    const handle = screen.getByRole('separator')
    handle.focus()

    fireEvent.keyDown(handle, { key: 'ArrowRight' })

    expect(onKeyboardResize).toHaveBeenCalledWith('name', 10)
  })

  it('ArrowLeft chama onKeyboardResize com incremento negativo padrão (-10px)', () => {
    const { onKeyboardResize } = renderHandle()
    const handle = screen.getByRole('separator')
    handle.focus()

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })

    expect(onKeyboardResize).toHaveBeenCalledWith('name', -10)
  })

  it('Shift+ArrowRight usa o incremento maior (30px)', () => {
    const { onKeyboardResize } = renderHandle()
    const handle = screen.getByRole('separator')
    handle.focus()

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })

    expect(onKeyboardResize).toHaveBeenCalledWith('name', 30)
  })

  it('Shift+ArrowLeft usa o incremento maior negativo (-30px)', () => {
    const { onKeyboardResize } = renderHandle()
    const handle = screen.getByRole('separator')
    handle.focus()

    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })

    expect(onKeyboardResize).toHaveBeenCalledWith('name', -30)
  })

  it('outras teclas não chamam onKeyboardResize', () => {
    const { onKeyboardResize } = renderHandle()
    const handle = screen.getByRole('separator')
    handle.focus()

    fireEvent.keyDown(handle, { key: 'Enter' })
    fireEvent.keyDown(handle, { key: 'Tab' })

    expect(onKeyboardResize).not.toHaveBeenCalled()
  })

  it('clique na alça nunca borbulha (stopPropagation) — nunca aciona um onClick de um ancestral (ex.: linha clicável)', () => {
    const ancestorClick = vi.fn()
    const onCommit = vi.fn()
    render(
      <div onClick={ancestorClick}>
        <ColumnResizeHandle
          columnId="name"
          columnLabel="Nome"
          width={200}
          onResize={vi.fn()}
          onCommit={onCommit}
          onKeyboardResize={vi.fn()}
        />
      </div>,
    )
    const handle = screen.getByRole('separator')

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 })
    fireEvent.click(handle)

    expect(ancestorClick).not.toHaveBeenCalled()
    expect(onCommit).toHaveBeenCalled()
  })
})
