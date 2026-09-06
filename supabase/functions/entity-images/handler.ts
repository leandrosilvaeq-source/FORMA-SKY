// Handler da Edge Function compartilhada `entity-images` — sem efeito
// colateral de módulo (nenhum Deno.serve aqui), mesmo padrão de
// accessories/handler.ts. `index.ts` é só o entrypoint.
//
// Uma foto principal por registro de accessories / packaging /
// filament-types / products, num bucket PRIVADO. Toda operação de Storage é
// feita aqui com a service_role; o frontend nunca escreve direto no bucket
// nem recebe caminho para gravar. As URLs de leitura são sempre assinadas e
// expiram em 3600s.
//
// Rotas (todas POST — payload JSON; as imagens chegam como WebP em base64,
// já convertidas/otimizadas pelo frontend):
//   POST /entity-images/upload  -> envia original + thumb, vincula via RPC
//                                  set_entity_image, remove os objetos
//                                  antigos SÓ depois do vínculo novo gravado;
//                                  em falha do vínculo, remove os novos.
//   POST /entity-images/remove  -> limpa os caminhos no banco (NULL/NULL) e
//                                  depois remove os objetos antigos.
//   POST /entity-images/sign    -> assina em lote uma lista limitada de
//                                  caminhos canônicos válidos (3600s).
//   POST /entity-images/purge   -> limpeza pós-exclusão: remove TODOS os
//                                  objetos de {entity}/{id}/ — só quando o
//                                  registro NÃO existe mais (delete aceito).
//
// set_entity_image é security definer, EXECUTE só para service_role
// (supabase/migrations/20260906120000_add_shared_entity_image_infrastructure.sql).
// A leitura das colunas image_path/image_thumb_path segue via supabase-js
// direto do frontend (GRANT SELECT a authenticated preservado).

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import {
  AppError,
  BusinessRuleError,
  NotFoundError,
  ValidationError,
  mapPgError,
} from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import { parseJsonBody, rejectIdentityFields } from "../_shared/validate.ts";
import {
  assertEntity,
  assertRecordId,
  assertSignablePaths,
  buildEntityImagePaths,
  ENTITY_IMAGES_BUCKET,
  entityImageFolder,
  SIGNED_URL_TTL_SECONDS,
  type EntityImageEntity,
} from "./paths.ts";

// Cada entidade -> tabela real (o único ponto onde o rótulo hifenizado vira
// nome de tabela). Usado só para confirmar a existência do registro por
// leitura direta da service_role (a ESCRITA é sempre pela RPC).
const ENTITY_TABLE: Record<EntityImageEntity, string> = {
  "accessories": "accessories",
  "packaging": "packaging",
  "filament-types": "filament_types",
  "products": "products",
};

// Teto do WebP recebido (já convertido pelo frontend; 5 MiB = teto do
// bucket, segunda barreira independente da validação do cliente). Thumb tem
// teto próprio, bem menor.
const MAX_ORIGINAL_BYTES = 5 * 1024 * 1024;
const MAX_THUMB_BYTES = 1024 * 1024;

export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("entity-images");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    const ACTIONS: Record<string, (req: Request) => Promise<Response>> = {
      upload: handleUpload,
      remove: handleRemove,
      sign: handleSign,
      purge: handlePurge,
    };

    if (route.length === 1 && route[0] in ACTIONS) {
      if (req.method === "POST") return await ACTIONS[route[0]](req);
      throw new AppError(
        "validation",
        405,
        `Método ${req.method} não permitido em /entity-images/${route[0]}.`,
      );
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
}

// ---------------------------------------------------------------------------
// Validadores locais.
// ---------------------------------------------------------------------------

export function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const unknown = Object.keys(obj).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(
      `Campo(s) não suportado(s) em ${context}: ${unknown.join(", ")}. ` +
        `Campos aceitos: ${allowed.join(", ")}.`,
    );
  }
}

// Decodifica base64 (com ou sem prefixo data:) para bytes. Rejeita entrada
// não-string, vazia ou malformada com 400.
export function decodeBase64Image(value: unknown, field: string): Uint8Array {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Campo obrigatório ausente ou inválido: ${field}.`);
  }
  const cleaned = value.includes(",") && value.trimStart().startsWith("data:")
    ? value.slice(value.indexOf(",") + 1)
    : value;
  let binary: string;
  try {
    binary = atob(cleaned.replace(/\s/g, ""));
  } catch {
    throw new ValidationError(`Campo inválido: ${field} não é base64 válido.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Sniff do container WebP: "RIFF" (0..3) + "WEBP" (8..11). O frontend só
// envia WebP; isto barra qualquer outra coisa antes de tocar o bucket.
export function assertWebp(bytes: Uint8Array, field: string): void {
  const riff = bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!riff) {
    throw new ValidationError(`Campo inválido: ${field} deve ser uma imagem WebP.`);
  }
}

export function assertMaxBytes(bytes: Uint8Array, max: number, field: string): void {
  if (bytes.byteLength > max) {
    throw new ValidationError(
      `Campo inválido: ${field} excede o limite de ${Math.round(max / 1024)} KB.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Existência do registro (leitura direta da service_role — a ESCRITA nunca
// passa por aqui). expectExists=false é usado no purge (o registro já deve
// ter sido excluído).
// ---------------------------------------------------------------------------
async function assertRecordExistence(
  entity: EntityImageEntity,
  id: string,
  expectExists: boolean,
): Promise<void> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from(ENTITY_TABLE[entity])
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) throw mapPgError(error);

  const exists = data !== null;
  if (expectExists && !exists) {
    throw new NotFoundError(`Registro ${entity} ${id} não encontrado.`);
  }
  if (!expectExists && exists) {
    // Marcador estável — a interface só deve chamar /purge DEPOIS de o
    // delete do registro ter sido aceito. Se o registro ainda existe, a
    // exclusão foi bloqueada (histórico/vínculo) e a foto deve ser
    // preservada.
    throw new BusinessRuleError(
      `O registro ${entity} ${id} ainda existe — a foto foi preservada porque a exclusão não foi concluída.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Storage helpers.
// ---------------------------------------------------------------------------
async function uploadObject(path: string, bytes: Uint8Array): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.storage
    .from(ENTITY_IMAGES_BUCKET)
    .upload(path, bytes, { contentType: "image/webp", upsert: false });
  if (error) {
    throw new AppError("database", 502, `Falha ao enviar a imagem ao armazenamento: ${error.message}`);
  }
}

// Remoção best-effort: nunca lança. Devolve os caminhos que falharam para o
// chamador logar/relatar sem desfazer nada (o banco já está consistente).
async function removeObjectsBestEffort(paths: string[]): Promise<string[]> {
  const targets = paths.filter((p) => typeof p === "string" && p.length > 0);
  if (targets.length === 0) return [];
  try {
    const admin = getAdminClient();
    const { error } = await admin.storage.from(ENTITY_IMAGES_BUCKET).remove(targets);
    if (error) {
      console.error("entity-images: falha ao remover objetos", targets, error.message);
      return targets;
    }
    return [];
  } catch (err) {
    console.error("entity-images: exceção ao remover objetos", targets, err);
    return targets;
  }
}

async function signPaths(paths: string[]): Promise<Record<string, string | null>> {
  if (paths.length === 0) return {};
  const admin = getAdminClient();
  const { data, error } = await admin.storage
    .from(ENTITY_IMAGES_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) {
    throw new AppError("database", 502, `Falha ao assinar as URLs de imagem: ${error.message}`);
  }
  const map: Record<string, string | null> = {};
  for (const entry of data ?? []) {
    if (entry.path) map[entry.path] = entry.error ? null : entry.signedUrl;
  }
  // Garante uma chave para todo caminho pedido, mesmo os que o Storage
  // omitiu (objeto ausente) — o frontend distingue null de "sem foto".
  for (const p of paths) if (!(p in map)) map[p] = null;
  return map;
}

// ---------------------------------------------------------------------------
// POST /entity-images/upload
//   body: { entity, id, original_base64, thumb_base64 }
// ---------------------------------------------------------------------------
const UPLOAD_KEYS = ["entity", "id", "original_base64", "thumb_base64"] as const;

async function handleUpload(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  rejectUnknownKeys(body, UPLOAD_KEYS, "corpo do upload");

  const entity = assertEntity(body.entity);
  const id = assertRecordId(body.id);

  const originalBytes = decodeBase64Image(body.original_base64, "original_base64");
  const thumbBytes = decodeBase64Image(body.thumb_base64, "thumb_base64");
  assertWebp(originalBytes, "original_base64");
  assertWebp(thumbBytes, "thumb_base64");
  assertMaxBytes(originalBytes, MAX_ORIGINAL_BYTES, "original_base64");
  assertMaxBytes(thumbBytes, MAX_THUMB_BYTES, "thumb_base64");

  await assertRecordExistence(entity, id, true);

  const next = buildEntityImagePaths(entity, id);

  // 1. Envia os DOIS objetos novos. Se o segundo falhar, remove o primeiro
  //    antes de propagar — nunca deixa um objeto novo órfão no bucket.
  await uploadObject(next.original, originalBytes);
  try {
    await uploadObject(next.thumb, thumbBytes);
  } catch (err) {
    await removeObjectsBestEffort([next.original]);
    throw err;
  }

  // 2. Vincula pela RPC. Em falha, remove os DOIS objetos novos — o banco
  //    nunca fica apontando para arquivo removido, nem sobra objeto novo
  //    sem vínculo.
  const admin = getAdminClient();
  const { data: linkResult, error: linkError } = await admin.rpc("set_entity_image", {
    p_entity: entity,
    p_id: id,
    p_path: next.original,
    p_thumb_path: next.thumb,
    p_changed_by: operator.userId,
  });
  if (linkError) {
    await removeObjectsBestEffort([next.original, next.thumb]);
    throw mapPgError(linkError);
  }

  // 3. Só agora (vínculo novo já gravado) remove os objetos ANTIGOS.
  const link = (linkResult ?? {}) as Record<string, string | null>;
  const stale = [link.previous_image_path, link.previous_image_thumb_path]
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .filter((p) => p !== next.original && p !== next.thumb);
  const staleFailures = await removeObjectsBestEffort(stale);

  // 4. Assina os novos para exibição imediata.
  const signed = await signPaths([next.original, next.thumb]);

  return jsonResponse(req, {
    entity,
    id,
    image_path: next.original,
    image_thumb_path: next.thumb,
    image_url: signed[next.original] ?? null,
    image_thumb_url: signed[next.thumb] ?? null,
    stale_cleanup_failed: staleFailures,
  }, 200);
}

// ---------------------------------------------------------------------------
// POST /entity-images/remove
//   body: { entity, id }
// ---------------------------------------------------------------------------
const REMOVE_KEYS = ["entity", "id"] as const;

async function handleRemove(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  rejectUnknownKeys(body, REMOVE_KEYS, "corpo da remoção");

  const entity = assertEntity(body.entity);
  const id = assertRecordId(body.id);

  await assertRecordExistence(entity, id, true);

  // 1. Limpa o vínculo no banco primeiro (NULL/NULL). A RPC devolve os
  //    caminhos anteriores.
  const admin = getAdminClient();
  const { data: linkResult, error: linkError } = await admin.rpc("set_entity_image", {
    p_entity: entity,
    p_id: id,
    p_path: null,
    p_thumb_path: null,
    p_changed_by: operator.userId,
  });
  if (linkError) throw mapPgError(linkError);

  // 2. Só depois remove os objetos físicos. Falha aqui NÃO desfaz a limpeza
  //    do banco (que já é a fonte da verdade) — é logada e devolvida como
  //    aviso tratável.
  const link = (linkResult ?? {}) as Record<string, string | null>;
  const stale = [link.previous_image_path, link.previous_image_thumb_path]
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  const staleFailures = await removeObjectsBestEffort(stale);

  return jsonResponse(req, {
    entity,
    id,
    success: true,
    physical_cleanup_failed: staleFailures,
  }, 200);
}

// ---------------------------------------------------------------------------
// POST /entity-images/sign
//   body: { paths: string[] }  (1..SIGN_BATCH_LIMIT caminhos canônicos)
// ---------------------------------------------------------------------------
const SIGN_KEYS = ["paths"] as const;

async function handleSign(req: Request): Promise<Response> {
  await resolveOperator(req);

  const rawBody = await req.text();
  const body = parseJsonBody(rawBody);
  rejectUnknownKeys(body, SIGN_KEYS, "corpo da assinatura");

  const paths = assertSignablePaths(body.paths);
  const urls = await signPaths(paths);

  return jsonResponse(req, { urls, expires_in: SIGNED_URL_TTL_SECONDS }, 200);
}

// ---------------------------------------------------------------------------
// POST /entity-images/purge  — limpeza pós-exclusão da entidade.
//   body: { entity, id }
// Só remove os objetos de {entity}/{id}/ quando o registro NÃO existe mais.
// ---------------------------------------------------------------------------
const PURGE_KEYS = ["entity", "id"] as const;

async function handlePurge(req: Request): Promise<Response> {
  await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  rejectUnknownKeys(body, PURGE_KEYS, "corpo do purge");

  const entity = assertEntity(body.entity);
  const id = assertRecordId(body.id);

  // Rejeita (409, foto preservada) se o registro ainda existe — a interface
  // só deve chamar /purge após o delete ter sido aceito.
  await assertRecordExistence(entity, id, false);

  const admin = getAdminClient();
  const folder = entityImageFolder(entity, id);
  const { data: listed, error: listError } = await admin.storage
    .from(ENTITY_IMAGES_BUCKET)
    .list(folder, { limit: 100 });
  if (listError) {
    throw new AppError("database", 502, `Falha ao listar objetos para limpeza: ${listError.message}`);
  }

  const targets = (listed ?? [])
    .filter((obj) => obj.name && obj.name !== ".emptyFolderPlaceholder")
    .map((obj) => `${folder}/${obj.name}`);

  const failures = await removeObjectsBestEffort(targets);

  return jsonResponse(req, {
    entity,
    id,
    success: true,
    purged: targets.length - failures.length,
    physical_cleanup_failed: failures,
  }, 200);
}
