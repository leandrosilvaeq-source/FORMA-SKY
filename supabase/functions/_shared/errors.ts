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

// Mensagens conhecidas emitidas por RAISE EXCEPTION em várias funções de
// negócio (public.products: create_product/update_product_price;
// public.orders: update_order/add_order_item/update_order_item/
// remove_order_item/change_order_status/update_quote_order;
// public.accessories: create_accessory/update_accessory/delete_accessory;
// public.packaging: create_packaging/update_packaging/delete_packaging),
// incluindo a função interna assert_active_user() reutilizada por todas.
// Todas chegam com code = 'P0001'. Cada entrada nova foi conferida linha a
// linha contra a migration que a declara (20260814030351_create_order_business_functions.sql,
// 20260821014342_extend_order_summary_and_payment_method.sql,
// 20260821031143_add_update_quote_order.sql,
// 20260822120000_create_accessory_write_functions.sql,
// 20260823120000_create_packaging_write_functions.sql) antes de ser
// adicionada aqui — sem sobreposição de substring entre nenhuma das
// entradas abaixo, para nunca haver ambiguidade de qual padrão casa
// primeiro.
const RAISE_EXCEPTION_PATTERNS: Array<[string, (message: string) => AppError]> = [
  ["não encontrado", (message) => new NotFoundError(message)],
  ["inválido ou inativo", (message) => new AuthorizationError(message)],
  // update_order (Migration 15): bloqueio DELIVERED/CANCELLED e troca de
  // customer_id fora de QUOTE/WAITING_APPROVAL.
  ["não pode mais ser editado", (message) => new BusinessRuleError(message)],
  ["não pode ser alterado após aprovação", (message) => new BusinessRuleError(message)],
  // add_order_item/update_order_item/remove_order_item/
  // register_custom_version (Migration 15): bloqueio a partir de
  // IN_PRODUCTION — as 4 mensagens reais contêm todas "início da produção".
  ["início da produção", (message) => new BusinessRuleError(message)],
  // remove_order_item (Migration 15): não pode ficar sem nenhum item.
  ["sem nenhum item", (message) => new BusinessRuleError(message)],
  // remove_order_item (Migration 15) / update_quote_order (nova): item com
  // histórico vinculado não pode ser removido/substituído.
  ["histórico de versão/aprovação", (message) => new BusinessRuleError(message)],
  // update_quote_order (nova): só QUOTE, só CATALOG, payment_method inválido.
  ["só permite pedidos em QUOTE", (message) => new BusinessRuleError(message)],
  ["só aceita itens CATALOG", (message) => new ValidationError(message)],
  ["itens CUSTOM/SPOT", (message) => new BusinessRuleError(message)],
  ["p_payment_method inválido", (message) => new ValidationError(message)],
  // create_accessory/update_accessory (Migration 20260822120000):
  // invariantes de defesa em profundidade (a Edge Function já valida tudo
  // isso antes de chamar a RPC — estas mensagens só aparecem se a RPC for
  // chamada diretamente, fora da Edge Function). São erros de entrada
  // inválida (400), não de conflito de estado (409) — mapeadas para
  // ValidationError, nunca para o fallback genérico de BusinessRuleError.
  ["accessories.size inválido", (message) => new ValidationError(message)],
  ["accessories.name não pode ser vazio", (message) => new ValidationError(message)],
  ["update_accessory: chave(s) não suportada(s)", (message) => new ValidationError(message)],
  ["update_accessory: p_patch vazio", (message) => new ValidationError(message)],
  // delete_accessory (Migration 20260822120000): bloqueio de exclusão
  // física quando há vínculo em product_accessories — orienta desativação
  // em vez de excluir, nunca remove o vínculo nem executa cascata. Marcador
  // estável ACCESSORY_IN_USE: (rodada corretiva — não depende só da frase
  // completa em português permanecer igual); a mensagem devolvida ao
  // cliente é a mesma exceção sem o prefixo do marcador, preservando o
  // texto amigável já pensado para a interface.
  ["ACCESSORY_IN_USE:", (message) => new BusinessRuleError(message.replace(/^ACCESSORY_IN_USE:\s*/, ""))],
  // create_packaging/update_packaging (Migration 20260823120000): mesmas
  // invariantes de defesa em profundidade de accessories, espelhadas para
  // packaging — erros de entrada inválida (400), não de conflito de estado.
  ["packaging.size inválido", (message) => new ValidationError(message)],
  ["packaging.name não pode ser vazio", (message) => new ValidationError(message)],
  ["update_packaging: chave(s) não suportada(s)", (message) => new ValidationError(message)],
  ["update_packaging: p_patch vazio", (message) => new ValidationError(message)],
  // delete_packaging (Migration 20260823120000): bloqueio de exclusão
  // física quando há vínculo em product_packaging — mesmo padrão de
  // ACCESSORY_IN_USE:, marcador PACKAGING_IN_USE: (independente, nunca
  // confundido com o de accessories por serem strings distintas).
  ["PACKAGING_IN_USE:", (message) => new BusinessRuleError(message.replace(/^PACKAGING_IN_USE:\s*/, ""))],
  // register_stock_movement (Módulo 3, migration 20260827090000): erros de
  // entrada inválida (a Edge Function `stock-movements` já valida tudo isso
  // antes de chamar a RPC — só aparecem se a RPC for chamada diretamente).
  ["stock_movements.item_type inválido", (message) => new ValidationError(message)],
  ["stock_movements.movement_type inválido", (message) => new ValidationError(message)],
  // Cobre as duas mensagens de p_quantity ("deve ser um inteiro positivo" e
  // "deve ser um número inteiro, sem casas decimais") com um único padrão —
  // ambas começam com o mesmo prefixo de função.
  ["register_stock_movement: p_quantity deve ser", (message) => new ValidationError(message)],
  ["register_stock_movement: motivo obrigatório", (message) => new ValidationError(message)],
  // Regras de negócio (409) — cada uma com marcador estável próprio, mesmo
  // padrão de ACCESSORY_IN_USE:/PACKAGING_IN_USE: acima: a mensagem
  // devolvida ao cliente é a mesma exceção sem o prefixo do marcador.
  [
    "STOCK_INSUFFICIENT_BALANCE:",
    (message) => new BusinessRuleError(message.replace(/^STOCK_INSUFFICIENT_BALANCE:\s*/, "")),
  ],
  [
    "INITIAL_BALANCE_ALREADY_EXISTS:",
    (message) => new BusinessRuleError(message.replace(/^INITIAL_BALANCE_ALREADY_EXISTS:\s*/, "")),
  ],
  [
    "INITIAL_BALANCE_REQUIRES_ZERO:",
    (message) => new BusinessRuleError(message.replace(/^INITIAL_BALANCE_REQUIRES_ZERO:\s*/, "")),
  ],
  [
    "IDEMPOTENCY_KEY_CONFLICT:",
    (message) => new BusinessRuleError(message.replace(/^IDEMPOTENCY_KEY_CONFLICT:\s*/, "")),
  ],
  // delete_accessory/delete_packaging (migration 20260827093000): novo
  // bloqueio de exclusão por histórico de estoque, além do já existente por
  // vínculo em product_accessories/product_packaging (ACCESSORY_IN_USE:/
  // PACKAGING_IN_USE: acima).
  [
    "ACCESSORY_HAS_STOCK_HISTORY:",
    (message) => new BusinessRuleError(message.replace(/^ACCESSORY_HAS_STOCK_HISTORY:\s*/, "")),
  ],
  [
    "PACKAGING_HAS_STOCK_HISTORY:",
    (message) => new BusinessRuleError(message.replace(/^PACKAGING_HAS_STOCK_HISTORY:\s*/, "")),
  ],
  // Módulo 3, Incremento 4 (filamentos) — migrations 20260827100000/
  // 103000/110000/113000. Mesmo critério das entradas acima: mensagens de
  // defesa em profundidade (create_filament_type/update_filament_type/
  // create_filament_spool/update_filament_spool/register_filament_movement/
  // register_filament_weighing/set_product_filaments) mapeadas para 400,
  // marcadores estáveis de regra de negócio mapeados para 409 com o prefixo
  // removido da mensagem exibida.
  ["filament_types.material inválido", (message) => new ValidationError(message)],
  ["filament_types.manufacturer não pode ser vazio", (message) => new ValidationError(message)],
  ["filament_types.line não pode ser vazio", (message) => new ValidationError(message)],
  ["filament_types.commercial_color não pode ser vazio", (message) => new ValidationError(message)],
  ["update_filament_type: chave(s) não suportada(s)", (message) => new ValidationError(message)],
  ["update_filament_type: p_patch vazio", (message) => new ValidationError(message)],
  ["filament_spools.nominal_weight_grams deve ser", (message) => new ValidationError(message)],
  ["filament_spools.empty_spool_weight_grams não pode ser negativo", (message) => new ValidationError(message)],
  ["filament_spools.status inválido", (message) => new ValidationError(message)],
  ["update_filament_spool: chave(s) não suportada(s)", (message) => new ValidationError(message)],
  ["update_filament_spool: p_patch vazio", (message) => new ValidationError(message)],
  ["register_filament_movement: movement_type WEIGHING_ADJUSTMENT", (message) => new ValidationError(message)],
  ["filament_movements.movement_type inválido", (message) => new ValidationError(message)],
  ["register_filament_movement: p_quantity deve ser", (message) => new ValidationError(message)],
  ["register_filament_movement: motivo obrigatório", (message) => new ValidationError(message)],
  ["register_filament_weighing: informe exatamente um dos dois pesos", (message) => new ValidationError(message)],
  ["register_filament_weighing: motivo obrigatório", (message) => new ValidationError(message)],
  ["register_filament_weighing: peso bruto medido", (message) => new ValidationError(message)],
  ["register_filament_weighing: peso líquido resultante", (message) => new ValidationError(message)],
  ["set_product_filaments: p_filaments deve ser um array", (message) => new ValidationError(message)],
  ["set_product_filaments: theoretical_weight_grams deve ser", (message) => new ValidationError(message)],
  [
    "FILAMENT_TYPE_HAS_SPOOLS:",
    (message) => new BusinessRuleError(message.replace(/^FILAMENT_TYPE_HAS_SPOOLS:\s*/, "")),
  ],
  [
    "FILAMENT_TYPE_HAS_COMPOSITION:",
    (message) => new BusinessRuleError(message.replace(/^FILAMENT_TYPE_HAS_COMPOSITION:\s*/, "")),
  ],
  [
    "FILAMENT_SPOOL_HAS_MOVEMENTS:",
    (message) => new BusinessRuleError(message.replace(/^FILAMENT_SPOOL_HAS_MOVEMENTS:\s*/, "")),
  ],
  [
    "FILAMENT_SPOOL_DISCARD_IS_FINAL:",
    (message) => new BusinessRuleError(message.replace(/^FILAMENT_SPOOL_DISCARD_IS_FINAL:\s*/, "")),
  ],
  [
    "FILAMENT_SPOOL_NOMINAL_BELOW_BALANCE:",
    (message) => new BusinessRuleError(message.replace(/^FILAMENT_SPOOL_NOMINAL_BELOW_BALANCE:\s*/, "")),
  ],
  [
    "FILAMENT_SPOOL_DISCARDED:",
    (message) => new BusinessRuleError(message.replace(/^FILAMENT_SPOOL_DISCARDED:\s*/, "")),
  ],
  [
    "FILAMENT_INSUFFICIENT_BALANCE:",
    (message) => new BusinessRuleError(message.replace(/^FILAMENT_INSUFFICIENT_BALANCE:\s*/, "")),
  ],
  [
    "FILAMENT_EXCEEDS_NOMINAL:",
    (message) => new BusinessRuleError(message.replace(/^FILAMENT_EXCEEDS_NOMINAL:\s*/, "")),
  ],
  [
    "FILAMENT_TARE_UNKNOWN:",
    (message) => new BusinessRuleError(message.replace(/^FILAMENT_TARE_UNKNOWN:\s*/, "")),
  ],
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
