import { ValidationError } from "./errors.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field}.`);
  }
  return value;
}

export function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ValidationError(`Campo inválido: ${field} deve ser texto.`);
  }
  return value;
}

// Limites opcionais para os validadores numéricos abaixo. Ambos inclusivos
// (min <= value <= max). Quando nenhum dos dois é informado, o
// comportamento é idêntico ao anterior (só checa tipo/finitude/inteireza).
export interface NumberBounds {
  min?: number;
  max?: number;
}

// Único ponto de checagem de faixa, reaproveitado por require/optional
// Number/Integer — evita duplicar a lógica de min/max em cada validador.
function checkBounds(value: number, field: string, bounds: NumberBounds): number {
  if (bounds.min !== undefined && value < bounds.min) {
    throw new ValidationError(`Campo inválido: ${field} deve ser >= ${bounds.min}.`);
  }
  if (bounds.max !== undefined && value > bounds.max) {
    throw new ValidationError(`Campo inválido: ${field} deve ser <= ${bounds.max}.`);
  }
  return value;
}

export function requireNumber(value: unknown, field: string, bounds: NumberBounds = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field}.`);
  }
  return checkBounds(value, field, bounds);
}

export function optionalNumber(
  value: unknown,
  field: string,
  bounds: NumberBounds = {},
): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`Campo inválido: ${field} deve ser numérico.`);
  }
  return checkBounds(value, field, bounds);
}

export function optionalInteger(
  value: unknown,
  field: string,
  bounds: NumberBounds = {},
): number | null {
  const num = optionalNumber(value, field, bounds);
  if (num !== null && !Number.isInteger(num)) {
    throw new ValidationError(`Campo inválido: ${field} deve ser um número inteiro.`);
  }
  return num;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isUuid(value)) {
    throw new ValidationError(`Campo inválido: ${field} deve ser um UUID.`);
  }
  return value;
}

export function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw new ValidationError(`Campo inválido: ${field} deve ser booleano.`);
  }
  return value;
}

// Usado só para effective_from (update_product_price): valida formato,
// mas quem decide se o parâmetro é enviado ou omitido para a RPC é o
// chamador (products/index.ts) — aqui só validamos o formato quando o
// valor está presente.
export function requireTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(
      `Campo inválido: ${field} deve ser uma data/hora ISO 8601 válida.`,
    );
  }
  return value;
}

export function parseJsonBody(rawBody: string): Record<string, unknown> {
  if (rawBody.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError("Corpo da requisição não é um JSON de objeto válido.");
  }
}

// Bloqueia qualquer tentativa de o cliente informar identidade operacional
// no corpo da requisição (changed_by/created_by e equivalentes). Rejeita a
// requisição inteira com 400 em vez de simplesmente ignorar o campo —
// exigido explicitamente, para não dar a falsa impressão de que o valor
// enviado teve algum efeito.
//
// Verificado sobre o texto bruto do body (antes do JSON.parse), para pegar
// também ocorrências dentro de sub-objetos aninhados (ex.: futuros
// custom_details/spot_details em order-items) sem precisar percorrer a
// árvore manualmente.
const FORBIDDEN_IDENTITY_KEY_PATTERN =
  /"(changed_by|created_by|p_changed_by|p_created_by|user_id|operator_id|author_id)"\s*:/;

export function rejectIdentityFields(rawBody: string): void {
  const match = rawBody.match(FORBIDDEN_IDENTITY_KEY_PATTERN);
  if (match) {
    throw new ValidationError(
      `Campo não permitido no corpo da requisição: "${match[1]}". ` +
        "A identidade do operador é sempre resolvida a partir do token de autenticação, nunca do corpo da requisição.",
    );
  }
}
