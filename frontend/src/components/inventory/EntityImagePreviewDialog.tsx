import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { signEntityImageUrls } from '@/lib/api/entityImages'

// Pop-up de "foto ampliada" reutilizável (2026-09-06). Recebe o caminho
// interno do objeto ORIGINAL otimizado (`image_path` — o WebP de até 1600 px,
// NUNCA a thumbnail de 320 px `image_thumb_path`) e, só enquanto aberto,
// pede UMA URL assinada temporária (3600s) pela mesma Edge Function
// `entity-images/sign` já usada pela listagem. O bucket continua privado:
// nada de URL pública nem permanente.
//
// A assinatura acontece sob demanda (quando o pai abre o diálogo), nunca com
// a listagem — assim as imagens grandes não são baixadas em lote. O corpo do
// pop-up só monta enquanto há um `imagePath` e o diálogo está aberto, com
// `key={imagePath}`: fechar ou trocar de item desmonta e limpa o estado, e
// uma nova abertura assina de novo (sem reaproveitar a URL de outro item,
// sem chamadas duplicadas na mesma abertura).
//
// Feito para ser reaproveitado nas listagens de Embalagens, Filamentos e
// Produtos — nenhuma regra específica de Acessórios vive aqui.

export interface EntityImagePreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Nome do registro — vira o título do pop-up.
  title: string
  // Texto alternativo da imagem — "Foto de {nome}".
  alt: string
  // Caminho interno do objeto ORIGINAL (image_path). null quando o registro
  // não tem foto: o pai não deve abrir o diálogo nesse caso, e o guard aqui
  // evita qualquer assinatura à toa.
  imagePath: string | null
  // Injeção para testes; por padrão a API real.
  signImage?: (paths: string[]) => Promise<{ urls: Record<string, string | null> }>
}

export function EntityImagePreviewDialog({
  open,
  onOpenChange,
  title,
  alt,
  imagePath,
  signImage = signEntityImageUrls,
}: EntityImagePreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] gap-3 sm:max-w-[90vw]">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{title}</DialogTitle>
          <DialogDescription>Foto em tamanho ampliado.</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[85vh] min-h-[8rem] items-center justify-center overflow-hidden">
          {open && imagePath ? (
            <EntityImagePreviewBody
              key={imagePath}
              imagePath={imagePath}
              alt={alt}
              signImage={signImage}
              onClose={() => onOpenChange(false)}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

type SignState =
  | { status: 'loading'; url: null }
  | { status: 'ready'; url: string }
  | { status: 'error'; url: null }

function EntityImagePreviewBody({
  imagePath,
  alt,
  signImage,
  onClose,
}: {
  imagePath: string
  alt: string
  signImage: (paths: string[]) => Promise<{ urls: Record<string, string | null> }>
  onClose: () => void
}) {
  const [state, setState] = useState<SignState>({ status: 'loading', url: null })
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    signImage([imagePath])
      .then((result) => {
        if (cancelled) return
        const signed = result.urls[imagePath] ?? null
        setState(signed ? { status: 'ready', url: signed } : { status: 'error', url: null })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', url: null })
      })

    return () => {
      cancelled = true
    }
  }, [imagePath, signImage])

  if (state.status === 'loading') {
    return <Skeleton className="h-[60vh] w-full max-w-[80vw]" data-testid="entity-image-preview-loading" />
  }

  if (state.status === 'error' || imageFailed) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-destructive text-sm">Não foi possível carregar a imagem.</p>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
        >
          Fechar
        </Button>
      </div>
    )
  }

  return (
    <img
      src={state.url}
      alt={alt}
      onError={() => setImageFailed(true)}
      className="block h-auto max-h-[85vh] w-auto max-w-[90vw] object-contain"
    />
  )
}
