import { useEffect, useState } from 'react'
import { signEntityImageUrls } from '@/lib/api/entityImages'

// Carrega, EM LOTE, as URLs assinadas das miniaturas de uma listagem —
// nunca uma requisição por linha. Recebe a lista de caminhos internos
// (image_thumb_path) já presentes nos itens; junta os distintos, fatia em
// lotes de 50 (teto da Edge Function) e devolve um mapa caminho -> URL
// assinada (ou null quando o objeto sumiu / a assinatura falhou para aquele
// item). Uma falha geral da chamada NÃO derruba a listagem: o mapa
// simplesmente fica sem aquelas entradas e o componente usa o placeholder.
//
// Reexecuta só quando o CONJUNTO de caminhos muda (chave estável ordenada),
// não a cada render nem a cada mutação de outro campo do item. `isLoading` é
// DERIVADO (comparação chave pedida x chave resolvida) — nenhum setState
// síncrono no corpo do efeito, mesmo padrão de useAccessories.

const BATCH_SIZE = 50

export interface EntityImageThumbnails {
  urls: Record<string, string | null>
  isLoading: boolean
}

export function useEntityImageThumbnails(paths: Array<string | null | undefined>): EntityImageThumbnails {
  const distinctKey = Array.from(
    new Set(paths.filter((p): p is string => typeof p === 'string' && p.length > 0)),
  )
    .sort()
    .join('|')

  const [urls, setUrls] = useState<Record<string, string | null>>({})
  const [resolvedKey, setResolvedKey] = useState<string | null>(null)

  const isLoading = resolvedKey !== distinctKey

  useEffect(() => {
    let cancelled = false

    const wanted = distinctKey.length > 0 ? distinctKey.split('|') : []
    const batches: string[][] = []
    for (let i = 0; i < wanted.length; i += BATCH_SIZE) {
      batches.push(wanted.slice(i, i + BATCH_SIZE))
    }

    Promise.all(
      batches.map((batch) =>
        signEntityImageUrls(batch)
          .then((result) => result.urls)
          .catch(() => ({}) as Record<string, string | null>),
      ),
    )
      .then((maps) => {
        if (cancelled) return
        const merged: Record<string, string | null> = {}
        for (const map of maps) Object.assign(merged, map)
        setUrls(merged)
      })
      .finally(() => {
        if (!cancelled) setResolvedKey(distinctKey)
      })

    return () => {
      cancelled = true
    }
  }, [distinctKey])

  return { urls, isLoading }
}
