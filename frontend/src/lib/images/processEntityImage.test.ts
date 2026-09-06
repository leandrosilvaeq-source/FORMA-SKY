import { describe, expect, it, vi } from 'vitest'
import {
  ImageProcessingError,
  MAX_INPUT_BYTES,
  ORIGINAL_MAX_DIMENSION,
  THUMB_MAX_DIMENSION,
  fitWithin,
  processEntityImage,
  type ProcessEntityImageDeps,
} from './processEntityImage'

// ---------------------------------------------------------------------------
// fitWithin — função pura.
// ---------------------------------------------------------------------------
describe('fitWithin', () => {
  it('não amplia uma imagem menor que o alvo', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(120, 90, 320)).toEqual({ width: 120, height: 90 })
  })

  it('reduz preservando a proporção pelo maior lado', () => {
    expect(fitWithin(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 })
    expect(fitWithin(2000, 4000, 320)).toEqual({ width: 160, height: 320 })
  })

  it('arredonda para inteiro e nunca abaixo de 1px', () => {
    expect(fitWithin(3201, 1, 1600)).toEqual({ width: 1600, height: 1 })
  })

  it('trata dimensões inválidas como zero', () => {
    expect(fitWithin(0, 100, 320)).toEqual({ width: 0, height: 0 })
  })
})

// ---------------------------------------------------------------------------
// processEntityImage — com deps injetadas (jsdom não tem canvas real).
// ---------------------------------------------------------------------------
function webpBlob(label: string): Blob {
  return new Blob([label], { type: 'image/webp' })
}

function makeDeps(source: { width: number; height: number }) {
  const release = vi.fn()
  const ctxRelease = vi.fn()
  const drawTo = vi.fn()
  const encodeWebp = vi.fn(async (_canvas: unknown, quality: number) => webpBlob(`q${quality}`))
  const deps: ProcessEntityImageDeps = {
    decode: vi.fn(async () => ({
      width: source.width,
      height: source.height,
      drawTo,
      release,
    })),
    createContext: vi.fn((width: number, height: number) => ({
      canvas: { width, height } as unknown as HTMLCanvasElement,
      ctx: {} as CanvasRenderingContext2D,
      release: ctxRelease,
    })),
    encodeWebp,
  }
  return { deps, release, ctxRelease, drawTo, encodeWebp }
}

function imageFile(type: string, size = 1024): File {
  return new File([new Uint8Array(size)], 'foto.bin', { type })
}

it('rejeita formato não suportado (SVG) antes de decodificar', async () => {
  const { deps } = makeDeps({ width: 100, height: 100 })
  await expect(processEntityImage(imageFile('image/svg+xml'), deps)).rejects.toMatchObject({
    code: 'INVALID_TYPE',
  })
  expect(deps.decode).not.toHaveBeenCalled()
})

it('rejeita arquivo acima de 5 MB', async () => {
  const { deps } = makeDeps({ width: 100, height: 100 })
  const big = imageFile('image/jpeg', MAX_INPUT_BYTES + 1)
  await expect(processEntityImage(big, deps)).rejects.toMatchObject({ code: 'TOO_LARGE' })
})

it('rejeita dimensões de entrada acima de 4096 × 4096', async () => {
  const { deps } = makeDeps({ width: 5000, height: 3000 })
  await expect(processEntityImage(imageFile('image/png'), deps)).rejects.toMatchObject({
    code: 'DIMENSIONS_TOO_LARGE',
  })
})

it('gera original e thumbnail WebP preservando a proporção, sem ampliar', async () => {
  const { deps, drawTo, encodeWebp, release, ctxRelease } = makeDeps({ width: 4000, height: 2000 })
  const result = await processEntityImage(imageFile('image/jpeg'), deps)

  expect(result.original.type).toBe('image/webp')
  expect(result.thumb.type).toBe('image/webp')
  // 4000×2000 -> original limitado a 1600 no maior lado
  expect(result.originalWidth).toBe(ORIGINAL_MAX_DIMENSION)
  expect(result.originalHeight).toBe(800)
  // -> thumb limitado a 320 no maior lado
  expect(result.thumbWidth).toBe(THUMB_MAX_DIMENSION)
  expect(result.thumbHeight).toBe(160)
  expect(result.sourceWidth).toBe(4000)
  expect(result.sourceHeight).toBe(2000)

  // desenhou 2 vezes (original + thumb) e liberou todos os recursos
  expect(drawTo).toHaveBeenCalledTimes(2)
  expect(encodeWebp).toHaveBeenCalledTimes(2)
  expect(release).toHaveBeenCalledTimes(1)
  expect(ctxRelease).toHaveBeenCalledTimes(2)
})

it('não amplia uma imagem já menor que os alvos', async () => {
  const { deps } = makeDeps({ width: 200, height: 150 })
  const result = await processEntityImage(imageFile('image/webp'), deps)
  expect(result.originalWidth).toBe(200)
  expect(result.originalHeight).toBe(150)
  // thumb ainda cabe? 200 > 320? não -> mantém
  expect(result.thumbWidth).toBe(200)
  expect(result.thumbHeight).toBe(150)
})

it('libera o recurso da fonte mesmo quando a codificação falha', async () => {
  const { deps, release } = makeDeps({ width: 800, height: 600 })
  deps.encodeWebp = vi.fn(async () => {
    throw new ImageProcessingError('ENCODE_FAILED')
  })
  await expect(processEntityImage(imageFile('image/jpeg'), deps)).rejects.toMatchObject({
    code: 'ENCODE_FAILED',
  })
  expect(release).toHaveBeenCalledTimes(1)
})

it('propaga a falha da etapa de decodificação', async () => {
  const { deps } = makeDeps({ width: 0, height: 0 })
  deps.decode = vi.fn(async () => {
    throw new Error('bitmap boom')
  })
  await expect(processEntityImage(imageFile('image/png'), deps)).rejects.toBeInstanceOf(Error)
})

it('rejeita com DECODE_FAILED quando a fonte volta com dimensão zero', async () => {
  const { deps } = makeDeps({ width: 0, height: 0 })
  await expect(processEntityImage(imageFile('image/png'), deps)).rejects.toMatchObject({
    code: 'DECODE_FAILED',
  })
})
