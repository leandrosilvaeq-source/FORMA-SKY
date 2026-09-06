import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { ImageIcon, Loader2Icon, RefreshCwIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  ACCEPTED_INPUT_ACCEPT_ATTR,
  ImageProcessingError,
  MAX_INPUT_BYTES,
  processEntityImage,
  type ProcessedEntityImage,
} from '@/lib/images/processEntityImage'

// Campo reutilizável de "foto principal" — clicar para selecionar, arrastar
// e soltar, prévia, substituir, remover. Estados: vazio / processando /
// enviando / erro / com imagem. Navegação por teclado (o gatilho é um
// <button> real; o <input type="file"> fica visualmente oculto mas
// focável/acionável), rótulos acessíveis, aceita só JPEG/PNG/WebP e informa
// o limite de 5 MB. Nunca depende SÓ de arrastar e soltar.
//
// O componente processa o arquivo localmente (processEntityImage: converte
// para WebP, redimensiona, corrige orientação EXIF) e emite o par pronto
// via onImageSelected — quem envia à Edge Function é o pai, que controla o
// momento (na criação, depois de ter o id; na edição, no mesmo submit).
// Será reutilizado em Embalagens, Filamentos e Produtos.

export interface EntityImageUploadFieldProps {
  label?: string
  idPrefix?: string
  // URL (assinada) da foto já salva, ou null. Ignorada enquanto houver uma
  // seleção local mais recente (prévia do arquivo recém-escolhido).
  savedPreviewUrl?: string | null
  // true quando o pai está enviando a imagem à Edge Function.
  isUploading?: boolean
  disabled?: boolean
  onImageSelected: (processed: ProcessedEntityImage) => void
  onImageRemoved: () => void
  // Injeção para testes (jsdom não tem canvas/createImageBitmap reais).
  processImage?: (file: File) => Promise<ProcessedEntityImage>
  className?: string
}

type Status = 'idle' | 'processing' | 'error'

const MAX_MB_LABEL = `${Math.round(MAX_INPUT_BYTES / (1024 * 1024))} MB`

export function EntityImageUploadField({
  label = 'Foto de referência',
  idPrefix = 'entity-image',
  savedPreviewUrl = null,
  isUploading = false,
  disabled = false,
  onImageSelected,
  onImageRemoved,
  processImage = processEntityImage,
  className,
}: EntityImageUploadFieldProps) {
  const reactId = useId()
  const inputId = `${idPrefix}-${reactId}-file`
  const hintId = `${idPrefix}-${reactId}-hint`

  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  // Object URL da prévia local (arquivo recém-escolhido, ainda não
  // necessariamente enviado). Revogado ao trocar/remover e na desmontagem.
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl)
    }
  }, [localPreviewUrl])

  const busy = disabled || isUploading || status === 'processing'
  const previewUrl = localPreviewUrl ?? savedPreviewUrl
  const hasImage = previewUrl !== null && previewUrl !== undefined

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || busy) return
      setStatus('processing')
      setErrorMessage(null)
      try {
        const processed = await processImage(file)
        const nextPreview = URL.createObjectURL(processed.original)
        setLocalPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current)
          return nextPreview
        })
        setStatus('idle')
        onImageSelected(processed)
      } catch (err) {
        setStatus('error')
        setErrorMessage(
          err instanceof ImageProcessingError
            ? err.message
            : 'Não foi possível processar a imagem. Tente novamente.',
        )
      }
    },
    [busy, onImageSelected, processImage],
  )

  function openPicker() {
    if (busy) return
    inputRef.current?.click()
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Permite reescolher o MESMO arquivo depois (o input não dispara change
    // para o mesmo value duas vezes).
    event.target.value = ''
    void handleFile(file)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    if (busy) return
    void handleFile(event.dataTransfer.files?.[0])
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!busy) setIsDragging(true)
  }

  function handleRemove() {
    if (busy) return
    setLocalPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
    setStatus('idle')
    setErrorMessage(null)
    onImageRemoved()
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={inputId}>{label}</Label>

      {/* input real, visualmente oculto mas focável e acionável por teclado */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_INPUT_ACCEPT_ATTR}
        className="sr-only"
        disabled={busy}
        aria-describedby={hintId}
        onChange={handleInputChange}
      />

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border border-dashed p-4 text-center transition-colors',
          isDragging ? 'border-brand-primary bg-brand-primary-soft/60' : 'border-input',
          busy && 'opacity-60',
        )}
      >
        {hasImage ? (
          <img
            src={previewUrl ?? undefined}
            alt="Prévia da foto de referência"
            className="size-28 rounded-md object-cover ring-1 ring-black/5"
          />
        ) : (
          <div className="text-muted-foreground flex size-28 items-center justify-center rounded-md bg-muted">
            <ImageIcon className="size-8" aria-hidden="true" />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openPicker}
            disabled={busy}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
          >
            {status === 'processing' ? (
              <>
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                Processando imagem...
              </>
            ) : isUploading ? (
              <>
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                Enviando...
              </>
            ) : hasImage ? (
              <>
                <RefreshCwIcon className="size-4" aria-hidden="true" />
                Substituir
              </>
            ) : (
              <>
                <UploadIcon className="size-4" aria-hidden="true" />
                Selecionar imagem
              </>
            )}
          </Button>

          {hasImage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemove}
              disabled={busy}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Trash2Icon className="size-4" aria-hidden="true" />
              Remover
            </Button>
          )}
        </div>

        <p id={hintId} className="text-muted-foreground text-xs">
          Arraste uma imagem aqui ou clique em “Selecionar imagem”. JPEG, PNG ou WebP, até {MAX_MB_LABEL}.
        </p>
      </div>

      {errorMessage && (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
