// Montagem e validação dos caminhos de objeto do bucket privado
// `entity-images`. Sem efeito colateral de módulo — importável pelos testes
// locais (paths.test.ts) sem abrir listener HTTP.
//
// Formato canônico dos objetos (versionado por uuid para nunca servir uma
// imagem antiga de cache):
//   {entity}/{id}/{uuid}-original.webp
//   {entity}/{id}/{uuid}-thumb.webp
//
// O cliente NUNCA fornece nome de bucket, caminho arbitrário, "../",
// entidade desconhecida ou id inválido — só (entidade, id) e os bytes. O
// backend monta o caminho; para a assinatura de leitura em lote, o backend
// confere cada caminho recebido contra este mesmo padrão fechado.

import { ValidationError } from "../_shared/errors.ts";

// As quatro entidades internas permitidas — string exatamente como aparece
// no prefixo do objeto e como a RPC set_entity_image espera em p_entity.
export const ENTITY_IMAGE_ENTITIES = [
  "accessories",
  "packaging",
  "filament-types",
  "products",
] as const;

export type EntityImageEntity = (typeof ENTITY_IMAGE_ENTITIES)[number];

export const ENTITY_IMAGES_BUCKET = "entity-images";

// Validade das URLs assinadas de leitura — 3600s (1h), fixo.
export const SIGNED_URL_TTL_SECONDS = 3600;

// Teto de caminhos por chamada de assinatura em lote — impede abuso (uma
// listagem inteira não deveria pedir centenas de assinaturas de uma vez).
export const SIGN_BATCH_LIMIT = 50;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Caminho completo e canônico: {entity}/{uuid}/{uuid}-(original|thumb).webp.
// Ancorado nas duas pontas (^…$) — nada antes, nada depois, sem "/" inicial,
// sem "..", sem nome de bucket embutido.
const OBJECT_PATH_PATTERN = new RegExp(
  `^(${ENTITY_IMAGE_ENTITIES.join("|")})/` +
    `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/` +
    `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(original|thumb)\\.webp$`,
  "i",
);

export function isEntityImageEntity(value: unknown): value is EntityImageEntity {
  return typeof value === "string" &&
    (ENTITY_IMAGE_ENTITIES as readonly string[]).includes(value);
}

export function assertEntity(value: unknown): EntityImageEntity {
  if (!isEntityImageEntity(value)) {
    throw new ValidationError(
      `Campo inválido: entity deve ser um de ${ENTITY_IMAGE_ENTITIES.join(", ")}.`,
    );
  }
  return value;
}

export function assertRecordId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ValidationError("Campo inválido: id deve ser um UUID.");
  }
  return value;
}

export interface EntityImagePathPair {
  original: string;
  thumb: string;
}

// Monta um par NOVO de caminhos (uuid inédito a cada chamada) — usado no
// upload/substituição. O objeto antigo nunca é sobrescrito: recebe um nome
// novo e o antigo é removido depois que o vínculo novo está gravado.
export function buildEntityImagePaths(
  entity: EntityImageEntity,
  id: string,
): EntityImagePathPair {
  const version = crypto.randomUUID();
  const base = `${entity}/${id}`;
  return {
    original: `${base}/${version}-original.webp`,
    thumb: `${base}/${version}-thumb.webp`,
  };
}

// Prefixo de todos os objetos de UM registro — usado para listar/remover na
// limpeza pós-exclusão (nunca alcança outro registro).
export function entityImageFolder(entity: EntityImageEntity, id: string): string {
  return `${entity}/${id}`;
}

export function isCanonicalObjectPath(value: unknown): value is string {
  return typeof value === "string" && OBJECT_PATH_PATTERN.test(value);
}

// Valida uma lista de caminhos recebida para assinatura de leitura: array
// não vazio, dentro do teto do lote, cada item no padrão canônico fechado.
// Deduplica preservando a ordem (uma listagem pode repetir o mesmo caminho).
export function assertSignablePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("Campo obrigatório ausente ou inválido: paths (lista não vazia).");
  }
  if (value.length > SIGN_BATCH_LIMIT) {
    throw new ValidationError(
      `Campo inválido: paths não pode ter mais de ${SIGN_BATCH_LIMIT} itens por requisição.`,
    );
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (!isCanonicalObjectPath(entry)) {
      throw new ValidationError(
        "Campo inválido: cada item de paths deve ser um caminho de objeto do bucket entity-images.",
      );
    }
    if (!seen.has(entry)) {
      seen.add(entry);
      result.push(entry);
    }
  }
  return result;
}
