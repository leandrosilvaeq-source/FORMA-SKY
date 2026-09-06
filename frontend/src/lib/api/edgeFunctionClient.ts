// Client HTTP genérico para as 6 Edge Functions do Módulo 1
// (supabase/functions/{products,orders,order-items,order-status,payments,
// order-approvals}/index.ts). Usado por toda escrita da API layer — leituras
// não passam por aqui (ver comentário no topo de cada arquivo lib/api/*.ts).
//
// Segurança: só usa import.meta.env.VITE_SUPABASE_URL/
// VITE_SUPABASE_PUBLISHABLE_KEY (chave pública) e o access_token da sessão
// do próprio usuário logado (supabase.auth.getSession()) — nunca uma
// service_role/secret key, que só existe no ambiente das Edge Functions
// (supabase/functions/_shared/supabaseAdmin.ts, não tocado por este arquivo).

import { supabase } from '@/lib/supabase'
import { ApiError, type ApiErrorType } from './errors'

const FUNCTIONS_BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// As 6 Edge Functions do Módulo 1 + `accessories`/`packaging` (Módulo 3,
// Incrementos 2 e 3 — backend protegido dos cadastros mestre de Acessórios
// e Embalagens, docs/05_ROADMAP_MODULOS.md §9) + `stock-movements` (Módulo
// 3, Incremento 1 — register_stock_movement, docs/05_ROADMAP_MODULOS.md
// §9b) + `filament-types`/`filament-spools`/`filament-movements` (Módulo 3,
// Incremento 4 — MVP de filamentos) + `inventory-purchases` (Módulo 3,
// Incremento 5 — fluxo centralizado de Compras, ainda NÃO publicada — roda
// só localmente nesta rodada) + `customers` (ajustes de Produtos/Clientes/
// Pedidos, 2026-08-29 — exclusão física protegida, ainda NÃO publicada —
// roda só localmente nesta rodada) (supabase/config.toml [functions.*]).
export type EdgeFunctionName =
  | 'products'
  | 'orders'
  | 'order-items'
  | 'order-status'
  | 'payments'
  | 'order-approvals'
  | 'accessories'
  | 'packaging'
  | 'stock-movements'
  | 'filament-types'
  | 'filament-spools'
  | 'filament-movements'
  | 'inventory-purchases'
  | 'customers'
  // Módulo 3 — infraestrutura compartilhada de "uma foto principal por
  // cadastro" (2026-09-06). Upload/remoção/assinatura em lote/limpeza
  // pós-exclusão da foto de accessories/packaging/filament-types/products.
  // Ainda NÃO publicada — roda só localmente nesta rodada.
  | 'entity-images'

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

// Mesmo envelope de supabase/functions/_shared/http.ts: sucesso é
// { data }, erro é { error: { type, message } }.
interface EdgeFunctionEnvelope<T> {
  data?: T
  error?: { type?: string; message?: string }
}

function isApiErrorType(value: unknown): value is ApiErrorType {
  return (
    value === 'validation' ||
    value === 'authorization' ||
    value === 'not_found' ||
    value === 'business_rule' ||
    value === 'database'
  )
}

export async function callEdgeFunction<T>(
  name: EdgeFunctionName,
  path: string,
  method: HttpMethod,
  body?: unknown,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    throw new ApiError('authorization', 401, 'Sessão expirada. Faça login novamente.')
  }

  // ACHADO (auditoria do erro genérico em FS-26-001): sem este try/catch,
  // uma falha de fetch() em si (rede offline, CORS bloqueado pelo
  // navegador, DNS, etc.) escapa como uma exceção crua (TypeError), nunca
  // instância de ApiError — cai no fallback genérico de toErrorMessage()
  // em cada tela ("Ocorreu um erro inesperado. Tente novamente."), sem
  // nenhuma pista real do que houve. Convertido aqui para um ApiError com
  // uma mensagem segura (nunca a mensagem crua do navegador, que pode
  // variar e não deve ser tratada como confiável para exibir ao usuário).
  let response: Response
  try {
    response = await fetch(`${FUNCTIONS_BASE_URL}/${name}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(
      'database',
      0,
      'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
    )
  }

  let envelope: EdgeFunctionEnvelope<T>
  try {
    envelope = (await response.json()) as EdgeFunctionEnvelope<T>
  } catch {
    throw new ApiError('database', response.status, 'Resposta inválida do servidor.')
  }

  if (!response.ok || envelope.error) {
    const errorType = envelope.error?.type
    const type = isApiErrorType(errorType) ? errorType : 'database'
    throw new ApiError(type, response.status, envelope.error?.message ?? 'Erro desconhecido.')
  }

  return envelope.data as T
}
