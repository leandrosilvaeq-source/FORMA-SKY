// Taxonomia de erros compartilhada por todas as Edge Functions do Bloco 1
// (docs/02_ESPECIFICACAO_TECNICA.md §14: validação, autorização, banco,
// regra de negócio, indisponibilidade externa, integração).
//
// Duas fontes de erro são tratadas de forma diferente em mapPgError():
//
// 1) Erros reais do Postgres (violação de CHECK/NOT NULL/FK/UNIQUE, cast
//    inválido) chegam com um SQLSTATE (`error.code`) confiável e são
//    mapeados diretamente por código.
//
// 2) `RAISE EXCEPTION 'texto'` dentro das funções PL/pgSQL do projeto, sem
//    SQLSTATE customizado, chegam TODOS com o mesmo código genérico P0001
//    — não é possível distinguir uma mensagem da outra pelo código. Por
//    isso, dentro do balde P0001, recorremos a um casamento de texto
//    (substring) centralizado na tabela RAISE_EXCEPTION_PATTERNS abaixo.
//
// Nenhum SQLSTATE customizado foi adicionado às RPCs nesta etapa (decisão
// explícita: não alterar migration/RPC para resolver ambiguidade de
// mapeamento sem aprovação prévia).

export type ErrorType =
  | "validation"
  | "authorization"
  | "not_found"
  | "business_rule"
  | "database";

export class AppError extends Error {
  readonly type: ErrorType;
  readonly status: number;

  constructor(type: ErrorType, status: number, message: string) {
    super(message);
    this.type = type;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("validation", 400, message);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Token inválido, ausente ou expirado.") {
    super("authorization", 401, message);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Operador não encontrado ou inativo.") {
    super("authorization", 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super("not_found", 404, message);
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string) {
    super("business_rule", 409, message);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string) {
    super("database", 500, message);
  }
}

interface PgErrorLike {
  code?: string;
  message: string;
}

// SQLSTATEs reais do Postgres, mapeados diretamente por código — nenhum
// pattern-matching de texto entra em jogo aqui.
const SQLSTATE_MAP: Record<string, (message: string) => AppError> = {
  "23502": (message) => new ValidationError(message), // not_null_violation
  "23514": (message) => new ValidationError(message), // check_violation
  "22P02": (message) => new ValidationError(message), // invalid_text_representation (uuid/numeric/date malformado)
  "23503": (message) => new ValidationError(message), // foreign_key_violation (referência inexistente)
  "23505": (message) => new BusinessRuleError(message), // unique_violation
};

// Mensagens conhecidas emitidas por RAISE EXCEPTION nas funções de
// public.products (create_product / update_product_price), incluindo a
// função interna assert_active_user() reutilizada por ambas. Todas chegam
// com code = 'P0001'. Verificadas linha a linha contra as migrations
// 20260814030351_create_order_business_functions.sql (assert_active_user,
// create_product) e a mesma migration (update_product_price) antes de
// escrever esta tabela — não há sobreposição de substring entre as duas
// entradas abaixo, então não há ambiguidade real neste escopo.
const RAISE_EXCEPTION_PATTERNS: Array<[string, (message: string) => AppError]> = [
  ["não encontrado", (message) => new NotFoundError(message)],
  ["inválido ou inativo", (message) => new AuthorizationError(message)],
];

export function mapPgError(err: PgErrorLike): AppError {
  const code = err.code;
  const message = err.message ?? "Erro desconhecido no banco de dados.";

  if (code && code !== "P0001" && code in SQLSTATE_MAP) {
    return SQLSTATE_MAP[code](message);
  }

  if (code === "P0001") {
    for (const [pattern, factory] of RAISE_EXCEPTION_PATTERNS) {
      if (message.includes(pattern)) return factory(message);
    }
    // Nenhum padrão conhecido casou com uma mensagem P0001 desta função.
    // Isso indica uma RAISE EXCEPTION nova/alterada que este arquivo ainda
    // não conhece — tratado como regra de negócio genérica (409) por
    // padrão, mas deve ser reportado para revisão em vez de assumido como
    // definitivo (ver instrução: parar e reportar em caso de ambiguidade
    // real).
    return new BusinessRuleError(message);
  }

  return new DatabaseError(message);
}
