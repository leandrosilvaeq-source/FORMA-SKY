// Taxonomia de erro compartilhada por toda a API layer do frontend (leitura
// direta via supabase-js e escrita via Edge Function) — mesmos 5 tipos já
// usados no backend (supabase/functions/_shared/errors.ts), para que
// hooks/telas tratem os dois canais da mesma forma.

export type ApiErrorType = 'validation' | 'authorization' | 'not_found' | 'business_rule' | 'database'

export class ApiError extends Error {
  readonly type: ApiErrorType
  readonly status: number

  constructor(type: ApiErrorType, status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.type = type
    this.status = status
  }
}

interface PostgrestErrorLike {
  code?: string
  message: string
}

function isPostgrestErrorLike(value: unknown): value is PostgrestErrorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  )
}

// SQLSTATEs reais do Postgres — mesmo mapeamento usado em
// supabase/functions/_shared/errors.ts (SQLSTATE_MAP), reaproveitado aqui
// porque as escritas diretas (customers/companies) passam pelas mesmas
// constraints de banco. PGRST116 é específico do PostgREST: "JSON object
// requested, multiple (or no) rows returned" — devolvido por .single()
// quando a linha não existe (ou a RLS a esconde), mapeado para not_found.
// Nenhum outro código do PostgREST (ex.: relacionados a JWT expirado) é
// mapeado aqui por não ter sido verificado em runtime — cai no fallback
// "database" em vez de ser adivinhado.
const KNOWN_ERROR_CODES: Record<string, { type: ApiErrorType; status: number }> = {
  '23502': { type: 'validation', status: 400 }, // not_null_violation
  '23514': { type: 'validation', status: 400 }, // check_violation
  '22P02': { type: 'validation', status: 400 }, // invalid_text_representation
  '23503': { type: 'validation', status: 400 }, // foreign_key_violation
  '23505': { type: 'business_rule', status: 409 }, // unique_violation
  '42501': { type: 'authorization', status: 403 }, // insufficient_privilege / RLS
  PGRST116: { type: 'not_found', status: 404 }, // .single() sem linha
}

// Normaliza um erro vindo de leitura/escrita direta via supabase-js
// (PostgrestError-like) para o mesmo formato ApiError usado pelas Edge
// Functions (ver edgeFunctionClient.ts) — ponto único de tradução de erro
// para toda a API layer.
export function mapSupabaseError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (isPostgrestErrorLike(error)) {
    const known = error.code ? KNOWN_ERROR_CODES[error.code] : undefined
    if (known) {
      return new ApiError(known.type, known.status, error.message)
    }
    return new ApiError('database', 500, error.message)
  }

  if (error instanceof Error) {
    return new ApiError('database', 500, error.message)
  }

  return new ApiError('database', 500, 'Erro desconhecido ao acessar o banco de dados.')
}
