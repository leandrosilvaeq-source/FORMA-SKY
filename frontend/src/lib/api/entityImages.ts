// Infraestrutura compartilhada de "uma foto principal por cadastro"
// (2026-09-06). TODA operação de foto passa pela Edge Function
// `entity-images` (supabase/functions/entity-images/index.ts) — o bucket
// `entity-images` é privado, o frontend nunca escreve nele direto nem
// recebe caminho para gravar, e as URLs de exibição são sempre assinadas e
// temporárias (3600s).
//
// O caminho interno (image_path/image_thumb_path) é lido direto das tabelas
// via supabase-js (SELECT já concedido a authenticated) — nunca gravado
// aqui: o vínculo é feito pela RPC set_entity_image, chamada só pela Edge
// Function. `createAccessory`/`updateAccessory` continuam SEM campo de
// imagem no contrato — a foto é enviada num segundo passo, com o id já
// conhecido.

import { callEdgeFunction } from './edgeFunctionClient'

// As quatro entidades internas permitidas — string exatamente como o
// backend espera (prefixo do objeto e p_entity da RPC).
export type EntityImageEntity = 'accessories' | 'packaging' | 'filament-types' | 'products'

export interface EntityImageUploadResult {
  entity: EntityImageEntity
  id: string
  image_path: string
  image_thumb_path: string
  image_url: string | null
  image_thumb_url: string | null
}

export interface EntityImageRemoveResult {
  entity: EntityImageEntity
  id: string
  success: true
}

export interface EntityImageSignResult {
  // Mapa caminho -> URL assinada (null quando o objeto não existe mais ou a
  // assinatura falhou para aquele item específico).
  urls: Record<string, string | null>
  expires_in: number
}

export interface EntityImagePurgeResult {
  entity: EntityImageEntity
  id: string
  success: true
  purged: number
}

// Blob -> base64 puro (sem o prefixo data:) via FileReader. Chunk-free e
// sem risco de stack overflow de String.fromCharCode com arquivos grandes.
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Falha ao ler a imagem processada.'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

// POST /entity-images/upload — envia o par (original WebP + thumb WebP) já
// processado pelo frontend, vincula os novos caminhos e devolve URLs
// assinadas para exibição imediata. Substitui a foto anterior (o backend
// remove os objetos antigos só depois do vínculo novo gravado).
export async function uploadEntityImage(
  entity: EntityImageEntity,
  id: string,
  images: { original: Blob; thumb: Blob },
): Promise<EntityImageUploadResult> {
  const [originalBase64, thumbBase64] = await Promise.all([
    blobToBase64(images.original),
    blobToBase64(images.thumb),
  ])
  return callEdgeFunction<EntityImageUploadResult>('entity-images', '/upload', 'POST', {
    entity,
    id,
    original_base64: originalBase64,
    thumb_base64: thumbBase64,
  })
}

// POST /entity-images/remove — limpa o vínculo no banco (NULL/NULL) e
// remove os objetos físicos.
export async function removeEntityImage(
  entity: EntityImageEntity,
  id: string,
): Promise<EntityImageRemoveResult> {
  return callEdgeFunction<EntityImageRemoveResult>('entity-images', '/remove', 'POST', { entity, id })
}

// POST /entity-images/sign — assina em lote uma lista limitada (<= 50) de
// caminhos de objeto para exibição. Usado pela listagem para carregar todas
// as miniaturas de uma vez, nunca uma requisição por linha.
export async function signEntityImageUrls(paths: string[]): Promise<EntityImageSignResult> {
  return callEdgeFunction<EntityImageSignResult>('entity-images', '/sign', 'POST', { paths })
}

// POST /entity-images/purge — limpeza pós-exclusão: remove todos os objetos
// de {entity}/{id}/. Só deve ser chamada DEPOIS de a exclusão do registro
// ter sido aceita (o backend recusa, preservando a foto, se o registro
// ainda existir).
export async function purgeEntityImages(
  entity: EntityImageEntity,
  id: string,
): Promise<EntityImagePurgeResult> {
  return callEdgeFunction<EntityImagePurgeResult>('entity-images', '/purge', 'POST', { entity, id })
}
