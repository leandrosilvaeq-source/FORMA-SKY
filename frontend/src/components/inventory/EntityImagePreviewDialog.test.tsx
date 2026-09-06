import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntityImagePreviewDialog } from './EntityImagePreviewDialog'

// Promessa controlável — deixa o teste segurar o estado "carregando" o tempo
// que precisar antes de resolver a assinatura.
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

function renderDialog(
  props: Partial<React.ComponentProps<typeof EntityImagePreviewDialog>> = {},
) {
  const onOpenChange = vi.fn<(open: boolean) => void>()
  const signImage =
    props.signImage ??
    vi.fn().mockResolvedValue({ urls: { [ORIGINAL_PATH]: 'https://signed/original' } })
  const utils = render(
    <EntityImagePreviewDialog
      open
      onOpenChange={onOpenChange}
      title="Ímã 6x2"
      alt="Foto de Ímã 6x2"
      imagePath={ORIGINAL_PATH}
      signImage={signImage}
      {...props}
    />,
  )
  return { ...utils, onOpenChange, signImage }
}

describe('EntityImagePreviewDialog', () => {
  it('assina o caminho do ORIGINAL (image_path), nunca a thumbnail', async () => {
    const { signImage } = renderDialog()
    await waitFor(() => expect(signImage).toHaveBeenCalledWith([ORIGINAL_PATH]))
    expect(signImage).not.toHaveBeenCalledWith([THUMB_PATH])
  })

  it('usa a URL assinada na imagem ampliada, com alt e título corretos', async () => {
    renderDialog()
    const dialog = await screen.findByRole('dialog')
    const img = await within(dialog).findByRole('img')
    expect(img).toHaveAttribute('src', 'https://signed/original')
    expect(img).toHaveAttribute('alt', 'Foto de Ímã 6x2')
    expect(within(dialog).getByText('Ímã 6x2')).toBeInTheDocument()
    // object-contain + tetos de viewport, sem rolagem horizontal
    expect(img.className).toContain('object-contain')
    expect(img.className).toContain('max-w-[90vw]')
    expect(img.className).toContain('max-h-[85vh]')
  })

  it('mostra o estado de carregamento enquanto a assinatura não resolve', async () => {
    const d = deferred<{ urls: Record<string, string | null> }>()
    renderDialog({ signImage: vi.fn().mockReturnValue(d.promise) })

    expect(await screen.findByTestId('entity-image-preview-loading')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    d.resolve({ urls: { [ORIGINAL_PATH]: 'https://signed/original' } })
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument())
  })

  it('erro na assinatura (rejeição) mostra mensagem clara e permite fechar', async () => {
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange, signImage: vi.fn().mockRejectedValue(new Error('sign failed')) })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível carregar a imagem.')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    await userEvent.click(within(alert).getByRole('button', { name: 'Fechar' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('assinatura sem URL para o caminho (null) também cai no estado de erro', async () => {
    renderDialog({ signImage: vi.fn().mockResolvedValue({ urls: { [ORIGINAL_PATH]: null } }) })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível carregar a imagem.')
  })

  it('falha ao carregar a imagem (onError) mostra erro sem quebrar a página', async () => {
    renderDialog()
    const img = await screen.findByRole('img')
    fireEvent.error(img)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível carregar a imagem.')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('fecha pelo botão X', async () => {
    const { onOpenChange } = renderDialog()
    await screen.findByRole('img')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalled())
    expect(onOpenChange.mock.lastCall?.[0]).toBe(false)
  })

  it('fecha com a tecla Escape', async () => {
    const { onOpenChange } = renderDialog()
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalled())
    expect(onOpenChange.mock.lastCall?.[0]).toBe(false)
  })

  it('não faz chamadas duplicadas de assinatura durante a mesma abertura', async () => {
    const signImage = vi
      .fn()
      .mockResolvedValue({ urls: { [ORIGINAL_PATH]: 'https://signed/original' } })
    const { rerender } = renderDialog({ signImage })
    await screen.findByRole('img')

    // re-render do pai sem mudar open/imagePath não deve reassinar
    rerender(
      <EntityImagePreviewDialog
        open
        onOpenChange={vi.fn()}
        title="Ímã 6x2 (mesmo item)"
        alt="Foto de Ímã 6x2"
        imagePath={ORIGINAL_PATH}
        signImage={signImage}
      />,
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(signImage).toHaveBeenCalledTimes(1)
  })

  it('trocar de acessório assina o novo caminho e não reutiliza a URL do anterior', async () => {
    const signImage = vi.fn().mockImplementation((paths: string[]) => {
      const path = paths[0]
      const map: Record<string, string> = {
        'accessories/a1/v-original.webp': 'https://signed/a1',
        'accessories/a2/v-original.webp': 'https://signed/a2',
      }
      return Promise.resolve({ urls: { [path]: map[path] ?? null } })
    })

    const { rerender } = renderDialog({ signImage })
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'https://signed/a1'))

    rerender(
      <EntityImagePreviewDialog
        open
        onOpenChange={vi.fn()}
        title="Outro acessório"
        alt="Foto de Outro acessório"
        imagePath="accessories/a2/v-original.webp"
        signImage={signImage}
      />,
    )

    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'https://signed/a2'))
    expect(signImage).toHaveBeenCalledWith(['accessories/a2/v-original.webp'])
  })

  it('não assina nada enquanto está fechado', async () => {
    const signImage = vi.fn().mockResolvedValue({ urls: {} })
    render(
      <EntityImagePreviewDialog
        open={false}
        onOpenChange={vi.fn()}
        title="Ímã 6x2"
        alt="Foto de Ímã 6x2"
        imagePath={ORIGINAL_PATH}
        signImage={signImage}
      />,
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(signImage).not.toHaveBeenCalled()
  })
})
