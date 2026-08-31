import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePersistentColumnWidths } from './usePersistentColumnWidths'
import { buildStorageKey, type ColumnWidthSpec } from '@/lib/tables/columnWidths'

const specs: ColumnWidthSpec[] = [
  { id: 'name', defaultWidth: 200, minWidth: 100, maxWidth: 500 },
  { id: 'status', defaultWidth: 120, minWidth: 80, maxWidth: 300 },
]

beforeEach(() => {
  window.localStorage.clear()
})

describe('usePersistentColumnWidths', () => {
  it('largura padrão: nasce com os defaults das specs quando não há nada salvo', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    expect(result.current.widths).toEqual({ name: 200, status: 120 })
    expect(result.current.getWidth('name')).toBe(200)
    expect(result.current.totalWidthPx).toBe(320)
  })

  it('arraste aumenta: setColumnWidth aumenta a largura em memória', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.setColumnWidth('name', 260))
    expect(result.current.getWidth('name')).toBe(260)
  })

  it('arraste diminui: setColumnWidth diminui a largura em memória', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.setColumnWidth('name', 150))
    expect(result.current.getWidth('name')).toBe(150)
  })

  it('redimensionar uma coluna não altera a largura de outra', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.setColumnWidth('name', 350))
    expect(result.current.getWidth('status')).toBe(120)
  })

  it('limite mínimo respeitado durante o arraste', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.setColumnWidth('name', 10))
    expect(result.current.getWidth('name')).toBe(100)
  })

  it('limite máximo respeitado durante o arraste', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.setColumnWidth('name', 9999))
    expect(result.current.getWidth('name')).toBe(500)
  })

  it('persistência ao finalizar: setColumnWidth sozinho NÃO grava no localStorage', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.setColumnWidth('name', 260))
    expect(window.localStorage.getItem(buildStorageKey('orders', 'user-1'))).toBeNull()
  })

  it('persistência ao finalizar: commitWidths grava o estado atual', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.setColumnWidth('name', 260))
    act(() => result.current.commitWidths())

    const stored = JSON.parse(window.localStorage.getItem(buildStorageKey('orders', 'user-1')) as string)
    expect(stored).toEqual({ name: 260, status: 120 })
  })

  it('recuperação após nova renderização (remount) — largura persistida é lida de volta', () => {
    const { result, unmount } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.setColumnWidth('name', 280))
    act(() => result.current.commitWidths())
    unmount()

    const { result: secondMount } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    expect(secondMount.current.getWidth('name')).toBe(280)
  })

  it('isolamento entre tabelas: commit em "orders" não vaza para "customers"', () => {
    const { result: ordersHook } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => ordersHook.current.setColumnWidth('name', 280))
    act(() => ordersHook.current.commitWidths())

    const { result: customersHook } = renderHook(() => usePersistentColumnWidths('customers', 'user-1', specs))
    expect(customersHook.current.getWidth('name')).toBe(200)
  })

  it('isolamento entre usuários: commit para user-1 não vaza para user-2', () => {
    const { result: userOneHook } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => userOneHook.current.setColumnWidth('name', 280))
    act(() => userOneHook.current.commitWidths())

    const { result: userTwoHook } = renderHook(() => usePersistentColumnWidths('orders', 'user-2', specs))
    expect(userTwoHook.current.getWidth('name')).toBe(200)
  })

  it('armazenamento corrompido: JSON inválido não impede a renderização, usa os defaults', () => {
    window.localStorage.setItem(buildStorageKey('orders', 'user-1'), '{corrompido')
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    expect(result.current.widths).toEqual({ name: 200, status: 120 })
  })

  it('coluna nova (spec adicionada depois) usa o default — não quebra ao ler preferência antiga', () => {
    window.localStorage.setItem(buildStorageKey('orders', 'user-1'), JSON.stringify({ name: 260 }))
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    expect(result.current.widths).toEqual({ name: 260, status: 120 })
  })

  it('coluna removida (existe na preferência antiga, não existe mais nas specs) não aparece — leitura não quebra', () => {
    window.localStorage.setItem(
      buildStorageKey('orders', 'user-1'),
      JSON.stringify({ name: 260, status: 140, legacy_column: 999 }),
    )
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    expect(result.current.widths).toEqual({ name: 260, status: 140 })
    expect('legacy_column' in result.current.widths).toBe(false)
  })

  it('restauração: resetWidths volta aos defaults e apaga a preferência salva', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.setColumnWidth('name', 350))
    act(() => result.current.commitWidths())

    act(() => result.current.resetWidths())

    expect(result.current.widths).toEqual({ name: 200, status: 120 })
    expect(window.localStorage.getItem(buildStorageKey('orders', 'user-1'))).toBeNull()
  })

  it('teclado: adjustByKeyboard ajusta e já persiste imediatamente', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.adjustByKeyboard('name', 10))

    expect(result.current.getWidth('name')).toBe(210)
    const stored = JSON.parse(window.localStorage.getItem(buildStorageKey('orders', 'user-1')) as string)
    expect(stored.name).toBe(210)
  })

  it('teclado respeita os limites mínimo/máximo', () => {
    const { result } = renderHook(() => usePersistentColumnWidths('orders', 'user-1', specs))
    act(() => result.current.adjustByKeyboard('name', -9999))
    expect(result.current.getWidth('name')).toBe(100)

    act(() => result.current.adjustByKeyboard('name', 9999))
    expect(result.current.getWidth('name')).toBe(500)
  })

  it('troca de tableId recarrega as larguras daquela tabela', () => {
    window.localStorage.setItem(buildStorageKey('customers', 'user-1'), JSON.stringify({ name: 333, status: 90 }))
    const { result, rerender } = renderHook(
      ({ tableId }: { tableId: string }) => usePersistentColumnWidths(tableId, 'user-1', specs),
      { initialProps: { tableId: 'orders' } },
    )
    expect(result.current.getWidth('name')).toBe(200)

    rerender({ tableId: 'customers' })
    expect(result.current.getWidth('name')).toBe(333)
  })
})
