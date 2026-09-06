import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { EntityImageHoverPreview } from './EntityImageHoverPreview'

// Promessa controlável — segura o estado "carregando" o tempo que o teste
// precisar antes de resolver/rejeitar a assinatura.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const ORIGINAL_PATH = 'accessories/a1/v-original.webp'
const THUMB_PATH = 'accessories/a1/v-thumb.webp'
const OPEN_DELAY = 500
const CLOSE_DELAY = 140

function renderPreview(
  props: Partial<React.ComponentProps<typeof EntityImageHoverPreview>> = {},
) {
  const onTriggerClick = vi.fn()
  const signImage =
    props.signImage ??
    vi.fn().mockResolvedValue({ urls: { [ORIGINAL_PATH]: 'https://signed/original' } })
  const utils = render(
    <EntityImageHoverPreview
      imagePath={props.imagePath ?? ORIGINAL_PATH}
      name={props.name ?? 'Ímã 6x2'}
      signImage={signImage}
      openDelayMs={props.openDelayMs ?? OPEN_DELAY}
      closeDelayMs={props.closeDelayMs ?? CLOSE_DELAY}
    >
      <button type="button" aria-label="Ampliar foto de Ímã 6x2" onClick={onTriggerClick}>
        thumb
      </button>
    </EntityImageHoverPreview>,
  )
  const trigger = screen.getByRole('button', { name: 'Ampliar foto de Ímã 6x2' })
  const anchor = trigger.parentElement as HTMLElement
  return { ...utils, trigger, anchor, signImage, onTriggerClick }
}

function card() {
  return screen.queryByTestId('entity-image-hover-preview')
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

describe('EntityImageHoverPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('499 ms de hover não abre a prévia e não assina nada', async () => {
    const { anchor, signImage } = renderPreview()
    fireEvent.mouseEnter(anchor)
    await advance(499)
    expect(card()).not.toBeInTheDocument()
    expect(signImage).not.toHaveBeenCalled()
  })

  it('500 ms de hover abre a prévia e só então assina o ORIGINAL (image_path), nunca a thumbnail', async () => {
    const { anchor, signImage } = renderPreview()
    fireEvent.mouseEnter(anchor)

    await advance(499)
    expect(signImage).not.toHaveBeenCalled()

    await advance(1)
    expect(card()).toBeInTheDocument()
    expect(signImage).toHaveBeenCalledWith([ORIGINAL_PATH])
    expect(signImage).not.toHaveBeenCalledWith([THUMB_PATH])
    expect(signImage).toHaveBeenCalledTimes(1)
  })

  it('sair antes dos 500 ms cancela a abertura pendente — nada abre, nada é assinado', async () => {
    const { anchor, signImage } = renderPreview()
    fireEvent.mouseEnter(anchor)
    await advance(300)
    fireEvent.mouseLeave(anchor)
    await advance(1000)
    expect(card()).not.toBeInTheDocument()
    expect(signImage).not.toHaveBeenCalled()
  })

  it('mostra loading enquanto a assinatura não resolve e depois a imagem ampliada', async () => {
    const d = deferred<{ urls: Record<string, string | null> }>()
    const { anchor } = renderPreview({ signImage: vi.fn().mockReturnValue(d.promise) })
    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)

    expect(screen.getByTestId('entity-image-hover-loading')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    await act(async () => {
      d.resolve({ urls: { [ORIGINAL_PATH]: 'https://signed/original' } })
    })

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://signed/original')
    expect(img).toHaveAttribute('alt', 'Foto de Ímã 6x2')
    expect(screen.queryByTestId('entity-image-hover-loading')).not.toBeInTheDocument()
  })

  it('a imagem ampliada usa proporção preservada e limites de viewport (object-contain, 80vw/80vh)', async () => {
    const { anchor } = renderPreview()
    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)

    const img = screen.getByRole('img')
    expect(img.className).toContain('object-contain')
    expect(img.className).toContain('max-w-[80vw]')
    expect(img.className).toContain('max-h-[80vh]')
    // o cartão é position: fixed (portal no body) — nunca empurra o layout
    expect(card()).toHaveStyle({ position: 'fixed' })
  })

  it('erro na assinatura (rejeição) mostra mensagem clara', async () => {
    const { anchor } = renderPreview({ signImage: vi.fn().mockRejectedValue(new Error('sign failed')) })
    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)
    await act(async () => {})

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a imagem.')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('assinatura sem URL para o caminho (null) também cai no estado de erro', async () => {
    const { anchor } = renderPreview({
      signImage: vi.fn().mockResolvedValue({ urls: { [ORIGINAL_PATH]: null } }),
    })
    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)
    await act(async () => {})

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a imagem.')
  })

  it('falha ao carregar a imagem (onError) mostra o erro no lugar da imagem', async () => {
    const { anchor } = renderPreview()
    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)
    await act(async () => {})

    const img = screen.getByRole('img')
    await act(async () => {
      fireEvent.error(img)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a imagem.')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('mover o ponteiro da miniatura para a imagem ampliada não fecha nem remonta o cartão', async () => {
    const { anchor } = renderPreview()
    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)
    await act(async () => {})
    const cardBefore = card()
    expect(cardBefore).toBeInTheDocument()

    // sai da miniatura (agenda fechamento) e, dentro da janela técnica,
    // entra no cartão (cancela o fechamento).
    fireEvent.mouseLeave(anchor)
    await advance(CLOSE_DELAY - 20)
    fireEvent.mouseEnter(cardBefore as HTMLElement)
    await advance(OPEN_DELAY)

    // continua aberto e é exatamente o mesmo nó (não piscou / não remontou)
    expect(card()).toBe(cardBefore)
  })

  it('sair da miniatura e do cartão fecha a prévia (após o atraso técnico)', async () => {
    const { anchor } = renderPreview()
    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)
    await act(async () => {})
    const openCard = card() as HTMLElement

    fireEvent.mouseEnter(openCard)
    fireEvent.mouseLeave(openCard)
    await advance(CLOSE_DELAY - 1)
    expect(card()).toBeInTheDocument()
    await advance(1)
    expect(card()).not.toBeInTheDocument()
  })

  it('Escape fecha a prévia imediatamente', async () => {
    const { anchor } = renderPreview()
    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)
    await act(async () => {})
    expect(card()).toBeInTheDocument()

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(card()).not.toBeInTheDocument()
  })

  it('clicar na miniatura encerra a prévia de hover (o clique fica livre para abrir o modal)', async () => {
    const { anchor, trigger, onTriggerClick } = renderPreview()
    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)
    await act(async () => {})
    expect(card()).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(trigger)
    })
    expect(onTriggerClick).toHaveBeenCalledTimes(1)
    expect(card()).not.toBeInTheDocument()
  })

  it('reaproveita a URL assinada em hovers repetidos do mesmo caminho (sem nova chamada)', async () => {
    const { anchor, signImage } = renderPreview()

    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)
    await act(async () => {})
    expect(signImage).toHaveBeenCalledTimes(1)

    fireEvent.mouseLeave(anchor)
    await advance(CLOSE_DELAY)
    expect(card()).not.toBeInTheDocument()

    fireEvent.mouseEnter(anchor)
    await advance(OPEN_DELAY)
    await act(async () => {})
    // reabriu com a imagem pronta, sem assinar de novo
    expect(signImage).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://signed/original')
  })

  it('não assina nem atualiza estado depois de desmontado (hover pendente cancelado no unmount)', async () => {
    const { anchor, signImage, unmount } = renderPreview()
    fireEvent.mouseEnter(anchor)
    await advance(200)
    unmount()
    await advance(1000)
    expect(signImage).not.toHaveBeenCalled()
  })
})
