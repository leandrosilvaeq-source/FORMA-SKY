import '@testing-library/jest-dom/vitest'

// jsdom ainda não implementa a Pointer Capture API
// (setPointerCapture/hasPointerCapture/releasePointerCapture) — necessária
// para testar ColumnResizeHandle.tsx (redimensionamento de colunas) via
// Pointer Events reais. Polyfill mínimo, só para o ambiente de teste:
// rastreia o pointerId "capturado" por elemento, sem nenhum efeito visual
// (jsdom não renderiza nada mesmo). Nunca carregado em produção — só aqui,
// no setup de testes.
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  const capturedPointers = new WeakMap<Element, Set<number>>()

  Element.prototype.setPointerCapture = function setPointerCapture(pointerId: number) {
    let set = capturedPointers.get(this)
    if (!set) {
      set = new Set()
      capturedPointers.set(this, set)
    }
    set.add(pointerId)
  }

  Element.prototype.releasePointerCapture = function releasePointerCapture(pointerId: number) {
    capturedPointers.get(this)?.delete(pointerId)
  }

  Element.prototype.hasPointerCapture = function hasPointerCapture(pointerId: number) {
    return capturedPointers.get(this)?.has(pointerId) ?? false
  }
}
