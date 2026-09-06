import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { signEntityImageUrls } from '@/lib/api/entityImages'

// Pré-visualização ampliada NÃO-MODAL da foto principal, acionada por HOVER
// (2026-09-06). Compartilhada por Estoque → Acessórios e Estoque →
// Embalagens: vive dentro de InventoryRowThumbnail, que é o MESMO componente
// de miniatura usado pelas duas áreas — nenhuma duplicação. O clique /
// Enter / Espaço na miniatura continuam abrindo o pop-up MODAL
// (EntityImagePreviewDialog); este componente só ADICIONA o comportamento de
// hover no desktop, nunca substitui o clique.
//
// Regras de tempo (todas cobertas por EntityImageHoverPreview.test.tsx):
//  - abre exatamente OPEN_DELAY_MS (500 ms) depois de o ponteiro entrar na
//    miniatura;
//  - sair antes dos 500 ms CANCELA a abertura — e nada é assinado;
//  - ao abrir, assina UMA URL do ORIGINAL (image_path) — nunca antes do
//    delay, nunca em lote com a listagem;
//  - a URL assinada é reaproveitada em hovers seguintes do MESMO caminho
//    (cache por image_path no próprio componente), sem nova chamada;
//  - trocar ou remover a foto invalida a URL anterior e fecha a prévia;
//  - sair da miniatura E do cartão fecha, com um pequeno atraso técnico
//    (CLOSE_DELAY_MS) só para permitir mover o ponteiro da miniatura até o
//    cartão sem piscar nem fechar na "zona morta" entre os dois;
//  - Escape fecha imediatamente.
//
// Anti-flicker: durante a transição miniatura → cartão o estado `open` NUNCA
// alterna (só um timer de fechamento é agendado e logo cancelado pelo
// mouseenter do cartão), então não há re-render que esconda e reexiba o
// cartão. Não há dependência de foco: tabular até a miniatura não abre nada
// (o teclado usa Enter/Espaço, que disparam o clique → modal).

const OPEN_DELAY_MS = 500
// Curto o suficiente para não parecer "grudento", longo o suficiente para o
// ponteiro cruzar os poucos pixels de folga entre a miniatura e o cartão.
const CLOSE_DELAY_MS = 140
// Folga entre a miniatura e a borda do cartão / borda da viewport.
const GAP_PX = 8

type SignState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error' }

export interface EntityImageHoverPreviewProps {
  // Caminho interno do objeto ORIGINAL (image_path). O chamador só monta
  // este componente para itens COM foto — nunca vazio aqui.
  imagePath: string
  // Nome do registro — alt da imagem ampliada = "Foto de {name}".
  name: string
  // A miniatura interativa (um <button>) que dispara o hover e, no clique,
  // o pop-up modal. Renderizada como está, sem alteração.
  children: ReactNode
  // Injeção para testes; por padrão a API real (mesma Edge Function
  // entity-images/sign já usada pela listagem e pelo pop-up modal).
  signImage?: (paths: string[]) => Promise<{ urls: Record<string, string | null> }>
  // Overrides só para os testes de tempo.
  openDelayMs?: number
  closeDelayMs?: number
}

export function EntityImageHoverPreview({
  imagePath,
  name,
  children,
  signImage = signEntityImageUrls,
  openDelayMs = OPEN_DELAY_MS,
  closeDelayMs = CLOSE_DELAY_MS,
}: EntityImageHoverPreviewProps) {
  const [open, setOpen] = useState(false)
  const [signState, setSignState] = useState<SignState>({ status: 'idle' })

  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  // URL assinada ainda válida para ESTE image_path — reaproveitada entre
  // hovers repetidos sem nova ida à rede.
  const cacheRef = useRef<{ path: string; url: string } | null>(null)
  // Impede duas assinaturas simultâneas do mesmo caminho (hover repetido
  // enquanto a primeira ainda não resolveu).
  const inFlightRef = useRef(false)

  const clearOpenTimer = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }
  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const closeNow = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    setOpen(false)
  }, [])

  const scheduleClose = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      if (mountedRef.current) setOpen(false)
    }, closeDelayMs)
  }, [closeDelayMs])

  // Troca / remoção da foto: o chamador (InventoryRowThumbnail) usa
  // key={fullImagePath}, então uma mudança de image_path REMONTA este
  // componente — cache, timers e estado nascem limpos, e a visualização
  // anterior nunca "sobrevive" a uma mudança de foto. Remover a foto
  // desmonta o wrapper por completo.

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearOpenTimer()
      clearCloseTimer()
    }
  }, [])

  // Assina o ORIGINAL só quando a prévia efetivamente ABRE — nunca no hover
  // ainda pendente, nunca com a listagem.
  useEffect(() => {
    if (!open) return

    // URL válida já em cache para este caminho: reaproveita, sem rede.
    if (cacheRef.current?.path === imagePath) {
      setSignState({ status: 'ready', url: cacheRef.current.url })
      return
    }
    if (inFlightRef.current) return

    inFlightRef.current = true
    setSignState({ status: 'loading' })
    signImage([imagePath])
      .then((result) => {
        if (!mountedRef.current) return
        const url = result.urls[imagePath] ?? null
        if (url) {
          cacheRef.current = { path: imagePath, url }
          setSignState({ status: 'ready', url })
        } else {
          setSignState({ status: 'error' })
        }
      })
      .catch(() => {
        if (mountedRef.current) setSignState({ status: 'error' })
      })
      .finally(() => {
        inFlightRef.current = false
      })
  }, [open, imagePath, signImage])

  // Escape fecha imediatamente.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNow()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closeNow])

  const handleAnchorEnter = () => {
    clearCloseTimer()
    if (open) return
    clearOpenTimer()
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null
      if (mountedRef.current) setOpen(true)
    }, openDelayMs)
  }

  const handleAnchorLeave = () => {
    // Cancela uma abertura ainda pendente (o ponteiro saiu antes dos 500 ms).
    clearOpenTimer()
    if (open) scheduleClose()
  }

  return (
    <span
      ref={anchorRef}
      className="inline-flex shrink-0"
      onMouseEnter={handleAnchorEnter}
      onMouseLeave={handleAnchorLeave}
      // Um clique abre o pop-up modal — encerra qualquer prévia de hover em
      // curso para os dois não coexistirem.
      onClick={closeNow}
    >
      {children}
      {open
        ? createPortal(
            <HoverPreviewCard
              anchorRef={anchorRef}
              name={name}
              signState={signState}
              onEnter={clearCloseTimer}
              onLeave={scheduleClose}
            />,
            document.body,
          )
        : null}
    </span>
  )
}

function HoverPreviewCard({
  anchorRef,
  name,
  signState,
  onEnter,
  onLeave,
}: {
  anchorRef: React.RefObject<HTMLSpanElement | null>
  name: string
  signState: SignState
  onEnter: () => void
  onLeave: () => void
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [imageFailed, setImageFailed] = useState(false)

  // Posiciona o cartão junto da miniatura e o mantém DENTRO da viewport
  // (prefere à direita; cai para a esquerda se não couber; nunca corta no
  // topo/base). position: fixed + portal no <body> => nunca altera a largura
  // da tabela nem cria rolagem horizontal.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const card = cardRef.current
    if (!anchor || !card) return

    const a = anchor.getBoundingClientRect()
    const c = card.getBoundingClientRect()
    const vw = window.innerWidth || 1024
    const vh = window.innerHeight || 768

    let left = a.right + GAP_PX
    if (left + c.width + GAP_PX > vw) left = a.left - c.width - GAP_PX
    if (left < GAP_PX) left = Math.max(GAP_PX, vw - c.width - GAP_PX)

    let top = a.top
    if (top + c.height + GAP_PX > vh) top = vh - c.height - GAP_PX
    if (top < GAP_PX) top = GAP_PX

    setPos({ top, left })
  }, [anchorRef, signState.status])

  const showError = signState.status === 'error' || imageFailed

  return (
    <div
      ref={cardRef}
      data-testid="entity-image-hover-preview"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0 }}
      className="border-border bg-popover z-[60] rounded-lg border p-1.5 shadow-xl ring-1 ring-black/5"
    >
      {!showError && (signState.status === 'idle' || signState.status === 'loading') ? (
        <Skeleton
          className="h-[45vh] w-[45vh] max-h-[80vh] max-w-[80vw]"
          data-testid="entity-image-hover-loading"
        />
      ) : null}

      {showError ? (
        <p role="alert" className="text-destructive max-w-[60vw] p-4 text-center text-sm">
          Não foi possível carregar a imagem.
        </p>
      ) : null}

      {!showError && signState.status === 'ready' ? (
        <img
          src={signState.url}
          alt={`Foto de ${name}`}
          onError={() => setImageFailed(true)}
          className="block h-auto max-h-[80vh] w-auto max-w-[80vw] object-contain"
        />
      ) : null}
    </div>
  )
}
