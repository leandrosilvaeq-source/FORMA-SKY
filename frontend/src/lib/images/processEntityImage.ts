// Processamento LOCAL (no navegador) da "foto principal" de um cadastro
// antes do envio à Edge Function `entity-images`. O arquivo original NUNCA
// é enviado sem otimização: sempre convertido para WebP e redimensionado.
//
// Entrada aceita: JPEG / PNG / WebP, no máximo 5 MB, dimensões de entrada
// até 4096 × 4096 px.
// Saída: original otimizado (WebP, lado máx. 1600 px) + thumbnail (WebP,
// lado máx. 320 px), ambos preservando a proporção e SEM ampliar uma
// imagem menor que o alvo.
//
// A orientação EXIF é corrigida quando o navegador fornece os metadados
// (createImageBitmap({ imageOrientation: 'from-image' })). Todo recurso
// temporário (ImageBitmap, canvas) é liberado ao final, inclusive em erro.
//
// A lógica de DOM (decodificar, desenhar em canvas, codificar) fica atrás
// de `ProcessEntityImageDeps` para poder ser injetada nos testes (jsdom não
// implementa canvas/createImageBitmap de verdade). `fitWithin` é uma função
// pura, testada isoladamente.

export const MAX_INPUT_BYTES = 5 * 1024 * 1024
export const MAX_INPUT_DIMENSION = 4096
export const ORIGINAL_MAX_DIMENSION = 1600
export const THUMB_MAX_DIMENSION = 320

export const ACCEPTED_INPUT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
// Para o atributo `accept` de um <input type="file">.
export const ACCEPTED_INPUT_ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'

const ORIGINAL_WEBP_QUALITY = 0.82
const THUMB_WEBP_QUALITY = 0.75

export type ImageProcessingErrorCode =
  | 'INVALID_TYPE'
  | 'TOO_LARGE'
  | 'DIMENSIONS_TOO_LARGE'
  | 'DECODE_FAILED'
  | 'ENCODE_FAILED'

const MESSAGES: Record<ImageProcessingErrorCode, string> = {
  INVALID_TYPE: 'Formato não suportado. Envie uma imagem JPEG, PNG ou WebP.',
  TOO_LARGE: 'Imagem muito grande. O limite é de 5 MB.',
  DIMENSIONS_TOO_LARGE: `Imagem acima do limite de ${MAX_INPUT_DIMENSION} × ${MAX_INPUT_DIMENSION} px.`,
  DECODE_FAILED: 'Não foi possível ler a imagem. Ela pode estar corrompida ou em um formato inesperado.',
  ENCODE_FAILED: 'Não foi possível processar a imagem neste navegador. Tente outra imagem.',
}

export class ImageProcessingError extends Error {
  readonly code: ImageProcessingErrorCode
  constructor(code: ImageProcessingErrorCode) {
    super(MESSAGES[code])
    this.name = 'ImageProcessingError'
    this.code = code
  }
}

export interface ProcessedEntityImage {
  original: Blob
  originalWidth: number
  originalHeight: number
  thumb: Blob
  thumbWidth: number
  thumbHeight: number
  /** Dimensões da imagem de entrada, já com a orientação EXIF aplicada. */
  sourceWidth: number
  sourceHeight: number
}

// Proporção preservada, nunca amplia. Divisor pelo maior lado; arredonda
// para inteiro >= 1.
export function fitWithin(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const longest = Math.max(width, height)
  if (longest <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) }
  }
  const scale = maxDimension / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// ---------------------------------------------------------------------------
// Seam de DOM injetável.
// ---------------------------------------------------------------------------
export interface DecodedSource {
  width: number
  height: number
  /** Desenha a fonte reamostrada num contexto 2D já dimensionado. */
  drawTo: (ctx: CanvasRenderingContext2D, targetWidth: number, targetHeight: number) => void
  /** Libera o recurso (ImageBitmap.close / revokeObjectURL). */
  release: () => void
}

export interface ProcessEntityImageDeps {
  decode: (file: Blob) => Promise<DecodedSource>
  createContext: (width: number, height: number) => {
    canvas: HTMLCanvasElement | OffscreenCanvas
    ctx: CanvasRenderingContext2D
    release: () => void
  }
  encodeWebp: (canvas: HTMLCanvasElement | OffscreenCanvas, quality: number) => Promise<Blob>
}

async function defaultDecode(file: Blob): Promise<DecodedSource> {
  if (typeof createImageBitmap !== 'function') {
    throw new ImageProcessingError('DECODE_FAILED')
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageProcessingError('DECODE_FAILED')
  }
  return {
    width: bitmap.width,
    height: bitmap.height,
    drawTo: (ctx, targetWidth, targetHeight) => {
      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
    },
    release: () => bitmap.close(),
  }
}

function defaultCreateContext(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageProcessingError('ENCODE_FAILED')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return {
    canvas,
    ctx,
    release: () => {
      canvas.width = 0
      canvas.height = 0
    },
  }
}

function defaultEncodeWebp(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!('toBlob' in canvas) || typeof canvas.toBlob !== 'function') {
      reject(new ImageProcessingError('ENCODE_FAILED'))
      return
    }
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== 'image/webp') {
          reject(new ImageProcessingError('ENCODE_FAILED'))
          return
        }
        resolve(blob)
      },
      'image/webp',
      quality,
    )
  })
}

const defaultDeps: ProcessEntityImageDeps = {
  decode: defaultDecode,
  createContext: defaultCreateContext,
  encodeWebp: defaultEncodeWebp,
}

// ---------------------------------------------------------------------------
// Entrada única.
// ---------------------------------------------------------------------------
export async function processEntityImage(
  file: File,
  deps: ProcessEntityImageDeps = defaultDeps,
): Promise<ProcessedEntityImage> {
  if (!(file instanceof Blob) || !ACCEPTED_INPUT_MIME_TYPES.includes(file.type as never)) {
    throw new ImageProcessingError('INVALID_TYPE')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageProcessingError('TOO_LARGE')
  }

  const source = await deps.decode(file)
  try {
    if (source.width <= 0 || source.height <= 0) {
      throw new ImageProcessingError('DECODE_FAILED')
    }
    if (source.width > MAX_INPUT_DIMENSION || source.height > MAX_INPUT_DIMENSION) {
      throw new ImageProcessingError('DIMENSIONS_TOO_LARGE')
    }

    const originalSize = fitWithin(source.width, source.height, ORIGINAL_MAX_DIMENSION)
    const thumbSize = fitWithin(source.width, source.height, THUMB_MAX_DIMENSION)

    const original = await renderWebp(source, originalSize, ORIGINAL_WEBP_QUALITY, deps)
    const thumb = await renderWebp(source, thumbSize, THUMB_WEBP_QUALITY, deps)

    return {
      original,
      originalWidth: originalSize.width,
      originalHeight: originalSize.height,
      thumb,
      thumbWidth: thumbSize.width,
      thumbHeight: thumbSize.height,
      sourceWidth: source.width,
      sourceHeight: source.height,
    }
  } finally {
    source.release()
  }
}

async function renderWebp(
  source: DecodedSource,
  size: { width: number; height: number },
  quality: number,
  deps: ProcessEntityImageDeps,
): Promise<Blob> {
  const { canvas, ctx, release } = deps.createContext(size.width, size.height)
  try {
    source.drawTo(ctx, size.width, size.height)
    return await deps.encodeWebp(canvas, quality)
  } finally {
    release()
  }
}
