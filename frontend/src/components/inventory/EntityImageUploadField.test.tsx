import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntityImageUploadField } from './EntityImageUploadField'
import { ImageProcessingError } from '@/lib/images/processEntityImage'
import type { ProcessedEntityImage } from '@/lib/images/processEntityImage'

function processedFixture(overrides: Partial<ProcessedEntityImage> = {}): ProcessedEntityImage {
  return {
    original: new Blob(['o'], { type: 'image/webp' }),
    originalWidth: 1600,
    originalHeight: 900,
    thumb: new Blob(['t'], { type: 'image/webp' }),
    thumbWidth: 320,
    thumbHeight: 180,
    sourceWidth: 4000,
    sourceHeight: 2250,
    ...overrides,
  }
}

function imageFile(type = 'image/jpeg', name = 'foto.jpg') {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

let createdUrls: string[] = []
let revokedUrls: string[] = []

beforeEach(() => {
  createdUrls = []
  revokedUrls = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:mock/${createdUrls.length}`
    createdUrls.push(url)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revokedUrls.push(url)
  })
})

describe('EntityImageUploadField', () => {
  it('tem rótulo acessível, input de arquivo restrito e texto de ajuda associado', () => {
    render(
      <EntityImageUploadField onImageSelected={vi.fn()} onImageRemoved={vi.fn()} processImage={vi.fn()} />,
    )
    const input = screen.getByLabelText('Foto de referência') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'file')
    expect(input.accept).toContain('image/webp')
    const hintId = input.getAttribute('aria-describedby')
    expect(hintId).toBeTruthy()
    expect(document.getElementById(hintId as string)?.textContent).toMatch(/JPEG, PNG ou WebP, até 5 MB/i)
    // estado vazio: só "Selecionar imagem", sem "Remover"
    expect(screen.getByRole('button', { name: /Selecionar imagem/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remover/i })).not.toBeInTheDocument()
  })

  it('seleção por clique processa o arquivo e emite o par pronto + prévia', async () => {
    const user = userEvent.setup()
    const onImageSelected = vi.fn()
    const processed = processedFixture()
    const processImage = vi.fn().mockResolvedValue(processed)

    render(
      <EntityImageUploadField
        onImageSelected={onImageSelected}
        onImageRemoved={vi.fn()}
        processImage={processImage}
      />,
    )

    await user.upload(screen.getByLabelText('Foto de referência'), imageFile())

    await waitFor(() => expect(onImageSelected).toHaveBeenCalledWith(processed))
    expect(processImage).toHaveBeenCalledTimes(1)
    // prévia renderizada a partir de um object URL do original processado
    const img = await screen.findByRole('img', { name: /Prévia da foto/i })
    expect(img).toHaveAttribute('src', createdUrls[0])
    // agora aparece "Substituir" e "Remover"
    expect(screen.getByRole('button', { name: /Substituir/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remover/i })).toBeInTheDocument()
  })

  it('arrastar e soltar também processa o arquivo', async () => {
    const onImageSelected = vi.fn()
    const processImage = vi.fn().mockResolvedValue(processedFixture())
    render(
      <EntityImageUploadField
        onImageSelected={onImageSelected}
        onImageRemoved={vi.fn()}
        processImage={processImage}
      />,
    )
    const dropzone = screen.getByText(/Arraste uma imagem aqui/i).closest('div') as HTMLElement
    fireEvent.drop(dropzone, { dataTransfer: { files: [imageFile()] } })
    await waitFor(() => expect(onImageSelected).toHaveBeenCalledTimes(1))
  })

  it('mostra a mensagem de erro quando o processamento rejeita (formato inválido)', async () => {
    const user = userEvent.setup()
    const onImageSelected = vi.fn()
    // processEntityImage é quem valida o tipo real (o atributo accept é só
    // uma dica) — aqui simulamos essa rejeição e conferimos que o campo a
    // exibe como alerta e não emite a seleção.
    const processImage = vi.fn().mockRejectedValue(new ImageProcessingError('INVALID_TYPE'))
    render(
      <EntityImageUploadField
        onImageSelected={onImageSelected}
        onImageRemoved={vi.fn()}
        processImage={processImage}
      />,
    )
    await user.upload(screen.getByLabelText('Foto de referência'), imageFile('image/jpeg', 'x.jpg'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Formato não suportado/i)
    expect(onImageSelected).not.toHaveBeenCalled()
  })

  it('mostra a mensagem específica de arquivo acima de 5 MB', async () => {
    const user = userEvent.setup()
    const processImage = vi.fn().mockRejectedValue(new ImageProcessingError('TOO_LARGE'))
    render(
      <EntityImageUploadField onImageSelected={vi.fn()} onImageRemoved={vi.fn()} processImage={processImage} />,
    )
    await user.upload(screen.getByLabelText('Foto de referência'), imageFile())
    expect(await screen.findByRole('alert')).toHaveTextContent(/limite é de 5 MB/i)
  })

  it('mostra a mensagem específica de dimensão acima de 4096 × 4096', async () => {
    const user = userEvent.setup()
    const processImage = vi.fn().mockRejectedValue(new ImageProcessingError('DIMENSIONS_TOO_LARGE'))
    render(
      <EntityImageUploadField onImageSelected={vi.fn()} onImageRemoved={vi.fn()} processImage={processImage} />,
    )
    await user.upload(screen.getByLabelText('Foto de referência'), imageFile())
    expect(await screen.findByRole('alert')).toHaveTextContent(/4096 × 4096/i)
  })

  it('remover limpa a prévia local, revoga o object URL e emite onImageRemoved', async () => {
    const user = userEvent.setup()
    const onImageRemoved = vi.fn()
    const processImage = vi.fn().mockResolvedValue(processedFixture())
    render(
      <EntityImageUploadField
        onImageSelected={vi.fn()}
        onImageRemoved={onImageRemoved}
        processImage={processImage}
      />,
    )
    await user.upload(screen.getByLabelText('Foto de referência'), imageFile())
    await screen.findByRole('img', { name: /Prévia/i })

    await user.click(screen.getByRole('button', { name: /Remover/i }))

    expect(onImageRemoved).toHaveBeenCalledTimes(1)
    expect(revokedUrls).toContain(createdUrls[0])
    expect(screen.queryByRole('img', { name: /Prévia/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Selecionar imagem/i })).toBeInTheDocument()
  })

  it('substituir troca a prévia e revoga o object URL anterior', async () => {
    const user = userEvent.setup()
    const processImage = vi
      .fn()
      .mockResolvedValueOnce(processedFixture())
      .mockResolvedValueOnce(processedFixture())
    render(
      <EntityImageUploadField onImageSelected={vi.fn()} onImageRemoved={vi.fn()} processImage={processImage} />,
    )
    const input = screen.getByLabelText('Foto de referência')
    await user.upload(input, imageFile('image/jpeg', 'a.jpg'))
    await screen.findByRole('img', { name: /Prévia/i })
    await user.upload(input, imageFile('image/png', 'b.png'))

    await waitFor(() => expect(createdUrls).toHaveLength(2))
    expect(revokedUrls).toContain(createdUrls[0])
    expect(screen.getByRole('img', { name: /Prévia/i })).toHaveAttribute('src', createdUrls[1])
  })

  it('pré-visualiza a foto já salva (savedPreviewUrl) sem seleção local', () => {
    render(
      <EntityImageUploadField
        savedPreviewUrl="https://signed/existing-thumb"
        onImageSelected={vi.fn()}
        onImageRemoved={vi.fn()}
        processImage={vi.fn()}
      />,
    )
    expect(screen.getByRole('img', { name: /Prévia/i })).toHaveAttribute('src', 'https://signed/existing-thumb')
    expect(screen.getByRole('button', { name: /Substituir/i })).toBeInTheDocument()
  })

  it('desabilita os controles enquanto isUploading', () => {
    render(
      <EntityImageUploadField
        savedPreviewUrl="https://signed/x"
        isUploading
        onImageSelected={vi.fn()}
        onImageRemoved={vi.fn()}
        processImage={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /Enviando/i })).toBeDisabled()
  })
})
