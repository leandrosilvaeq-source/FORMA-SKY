import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const { signMock } = vi.hoisted(() => ({ signMock: vi.fn() }))
vi.mock('@/lib/api/entityImages', () => ({ signEntityImageUrls: signMock }))

import { useEntityImageThumbnails } from './useEntityImageThumbnails'

describe('useEntityImageThumbnails', () => {
  beforeEach(() => {
    signMock.mockReset()
  })

  it('assina os caminhos distintos numa ÚNICA chamada em lote (<= 50)', async () => {
    signMock.mockResolvedValue({ urls: { 'a/x-thumb.webp': 'https://s/a', 'b/y-thumb.webp': 'https://s/b' }, expires_in: 3600 })

    const { result } = renderHook(() =>
      useEntityImageThumbnails(['a/x-thumb.webp', null, 'b/y-thumb.webp', 'a/x-thumb.webp', undefined]),
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(signMock).toHaveBeenCalledTimes(1)
    // deduplicado + ordenado
    expect(signMock).toHaveBeenCalledWith(['a/x-thumb.webp', 'b/y-thumb.webp'])
    expect(result.current.urls['a/x-thumb.webp']).toBe('https://s/a')
  })

  it('não faz nenhuma chamada quando não há caminhos', async () => {
    const { result } = renderHook(() => useEntityImageThumbnails([null, undefined]))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(signMock).not.toHaveBeenCalled()
    expect(result.current.urls).toEqual({})
  })

  it('fatia em lotes de 50 quando há mais de 50 caminhos', async () => {
    signMock.mockResolvedValue({ urls: {}, expires_in: 3600 })
    const paths = Array.from({ length: 51 }, (_, i) => `e/${String(i).padStart(3, '0')}-thumb.webp`)

    const { result } = renderHook(() => useEntityImageThumbnails(paths))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(signMock).toHaveBeenCalledTimes(2)
    expect(signMock.mock.calls[0][0]).toHaveLength(50)
    expect(signMock.mock.calls[1][0]).toHaveLength(1)
  })

  it('uma falha da assinatura não quebra o hook — devolve mapa vazio, sem erro', async () => {
    signMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useEntityImageThumbnails(['a/x-thumb.webp']))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.urls).toEqual({})
  })

  it('reexecuta só quando o conjunto de caminhos muda', async () => {
    signMock.mockResolvedValue({ urls: {}, expires_in: 3600 })
    const { rerender, result } = renderHook(({ paths }) => useEntityImageThumbnails(paths), {
      initialProps: { paths: ['a/x-thumb.webp'] as Array<string | null> },
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(signMock).toHaveBeenCalledTimes(1)

    // mesma lista (ordem diferente, com null) -> nenhuma nova chamada
    rerender({ paths: [null, 'a/x-thumb.webp'] })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(signMock).toHaveBeenCalledTimes(1)

    // conjunto realmente diferente -> nova chamada
    rerender({ paths: ['a/x-thumb.webp', 'c/z-thumb.webp'] })
    await waitFor(() => expect(signMock).toHaveBeenCalledTimes(2))
  })
})
