import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import {
  blobToBase64,
  purgeEntityImages,
  removeEntityImage,
  signEntityImageUrls,
  uploadEntityImage,
} from './entityImages'

describe('entityImages api', () => {
  beforeEach(() => {
    callEdgeFunctionMock.mockReset()
  })

  it('blobToBase64 devolve base64 puro (sem o prefixo data:)', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/webp' })
    const base64 = await blobToBase64(blob)
    expect(base64).not.toContain(',')
    expect(base64).not.toMatch(/^data:/)
    // round-trip
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5])
  })

  it('uploadEntityImage envia entity/id + as duas imagens em base64 para /upload', async () => {
    callEdgeFunctionMock.mockResolvedValue({
      entity: 'accessories',
      id: 'a1',
      image_path: 'accessories/a1/v-original.webp',
      image_thumb_path: 'accessories/a1/v-thumb.webp',
      image_url: 'https://signed/original',
      image_thumb_url: 'https://signed/thumb',
    })

    const original = new Blob([new Uint8Array([10, 20])], { type: 'image/webp' })
    const thumb = new Blob([new Uint8Array([30])], { type: 'image/webp' })
    const result = await uploadEntityImage('accessories', 'a1', { original, thumb })

    expect(callEdgeFunctionMock).toHaveBeenCalledTimes(1)
    const [name, path, method, rawBody] = callEdgeFunctionMock.mock.calls[0] as [
      string,
      string,
      string,
      Record<string, string>,
    ]
    expect(name).toBe('entity-images')
    expect(path).toBe('/upload')
    expect(method).toBe('POST')
    expect(rawBody).toMatchObject({ entity: 'accessories', id: 'a1' })
    expect(rawBody.original_base64).toBe(btoa('\n\x14')) // bytes 10,20
    expect(rawBody.thumb_base64).toBe(btoa('\x1e')) // byte 30
    expect(result.image_thumb_url).toBe('https://signed/thumb')
  })

  it('removeEntityImage chama /remove com entity/id', async () => {
    callEdgeFunctionMock.mockResolvedValue({ entity: 'accessories', id: 'a1', success: true })
    await removeEntityImage('accessories', 'a1')
    expect(callEdgeFunctionMock).toHaveBeenCalledWith('entity-images', '/remove', 'POST', {
      entity: 'accessories',
      id: 'a1',
    })
  })

  it('signEntityImageUrls encaminha a lista de caminhos para /sign', async () => {
    callEdgeFunctionMock.mockResolvedValue({ urls: { p: 'https://s/p' }, expires_in: 3600 })
    const res = await signEntityImageUrls(['p1', 'p2'])
    expect(callEdgeFunctionMock).toHaveBeenCalledWith('entity-images', '/sign', 'POST', {
      paths: ['p1', 'p2'],
    })
    expect(res.expires_in).toBe(3600)
  })

  it('purgeEntityImages chama /purge com entity/id', async () => {
    callEdgeFunctionMock.mockResolvedValue({ entity: 'accessories', id: 'a1', success: true, purged: 2 })
    const res = await purgeEntityImages('accessories', 'a1')
    expect(callEdgeFunctionMock).toHaveBeenCalledWith('entity-images', '/purge', 'POST', {
      entity: 'accessories',
      id: 'a1',
    })
    expect(res.purged).toBe(2)
  })
})
