// Handler + validadores da Edge Function `accessories` — sem nenhum efeito
// colateral de módulo (nenhum Deno.serve aqui). Extraído de index.ts nesta
// rodada corretiva especificamente para permitir que index.test.ts importe
// este arquivo sem abrir um listener HTTP real. `index.ts` é só o
// entrypoint (import + Deno.serve(handleRequest)) — nenhuma lógica vive lá.
//
// Rotas:
//   POST   /accessories       -> RPC create_accessory
//   PATCH  /accessories/:id   -> RPC update_accessory (edição e/ou ativar/desativar)
//   DELETE /accessories/:id   -> RPC delete_accessory (exclusão protegida)
//
// As 3 RPCs são security definer com EXECUTE concedido só a service_role
// (supabase/migrations/20260822120000_create_accessory_write_functions.sql)
// — só alcançáveis a partir desta Edge Function, nunca diretamente do
// frontend. INSERT/UPDATE diretos de `authenticated` em public.accessories
// foram revogados pela mesma migration; DELETE nunca foi concedido.
//
// Leitura/listagem continua via supabase-js direto do frontend
// (frontend/src/lib/api/accessories.ts, listAccessories) — GRANT SELECT a
// authenticated preservado, RLS "Active users can view accessories"
// inalterada; não afetado por esta Edge Function.
//
// packaging NÃO é implementado nesta rodada (escopo desta etapa é só
// Acessórios — Incremento 2 do plano aprovado em 2026-08-22,
// docs/05_ROADMAP_MODULOS.md §9).
//
// 405 (método não permitido numa rota reconhecida) é distinguido de 404
// (rota não reconhecida) construindo um AppError('validation', 405, ...)
// localmente — nenhuma outra Edge Function do projeto precisou dessa
// distinção até hoje (todas usam 404 para qualquer método não mapeado),
// então não há um MethodNotAllowedError compartilhado em _shared/errors.ts;
// AppError já aceita status arbitrário no construtor, então isso não exige
// alterar nenhum arquivo compartilhado.

import { handlePreflight } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { AppError, NotFoundError, ValidationError, mapPgError } from "../_shared/errors.ts";
import { resolveOperator } from "../_shared/authContext.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import {
  isUuid,
  requireString,
  optionalString,
  optionalInteger,
  optionalBoolean,
  parseJsonBody,
  rejectIdentityFields,
} from "../_shared/validate.ts";

// Opções oficiais aprovadas em docs/03_MODELO_BANCO_DADOS.md §13.3 — vazio/
// null significa "Não se aplica". Nenhum valor livre novo é aceito a partir
// desta interface; um valor legado fora deste enum só é preservado quando a
// chave `size` não é enviada no PATCH (ver update_accessory).
const ACCESSORY_SIZES = ["PP", "P", "M", "G", "GG"] as const;

// Campos aceitos tanto na criação quanto na edição — is_active inclusive
// (ativar/desativar é só mais uma chave deste mesmo contrato, sem rota
// redundante). material/unit_cost/current_stock nunca aparecem aqui: são
// rejeitados explicitamente por rejectUnknownKeys, nunca silenciosamente
// ignorados.
const ACCESSORY_KEYS = ["name", "size", "variant", "minimum_stock", "is_active"] as const;

// Extraído como função nomeada para poder ser exercitado por testes locais
// sem precisar de um listener HTTP real — ver index.test.ts. Comportamento
// idêntico ao padrão inline das outras Edge Functions do projeto
// (products/order-items/index.ts usam Deno.serve(async (req) => {...})
// diretamente; aqui só nomeamos o callback e o exportamos).
export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const anchor = segments.indexOf("accessories");
    const route = anchor >= 0 ? segments.slice(anchor + 1) : segments;

    if (route.length === 0) {
      if (req.method === "POST") return await handleCreateAccessory(req);
      throw new AppError("validation", 405, `Método ${req.method} não permitido em /accessories.`);
    }

    if (route.length === 1) {
      if (req.method === "PATCH") return await handleUpdateAccessory(req, route[0]);
      if (req.method === "DELETE") return await handleDeleteAccessory(req, route[0]);
      throw new AppError("validation", 405, `Método ${req.method} não permitido em /accessories/:id.`);
    }

    throw new NotFoundError("Rota não encontrada.");
  } catch (err) {
    return errorResponse(req, err);
  }
}

// ---------------------------------------------------------------------------
// Validadores locais (mesmo critério de "validador específico de uma única
// rota, não promovido a _shared/validate.ts ainda" já usado em
// products/index.ts e order-items/index.ts).
// ---------------------------------------------------------------------------

// name: obrigatório, string não vazia após trim — reaproveita requireString
// (já garante não-vazio-após-trim) e retorna o valor de fato TRIMADO (ao
// contrário de requireString, que devolve o valor bruto).
export function requireTrimmedName(value: unknown, field: string): string {
  const raw = requireString(value, field);
  return raw.trim();
}

// variant (e qualquer outro texto opcional livre): string vazia após trim
// normaliza para null — nunca grava "" no banco.
export function optionalTrimmedString(value: unknown, field: string): string | null {
  const raw = optionalString(value, field);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// size: mesma normalização de optionalTrimmedString, mais a restrição ao
// enum oficial. String vazia (inclusive só espaços) normaliza para null
// ("Não se aplica") antes de checar o enum — nunca rejeitada como valor
// inválido.
export function optionalSize(value: unknown, field: string): string | null {
  const trimmed = optionalTrimmedString(value, field);
  if (trimmed === null) return null;
  if (!(ACCESSORY_SIZES as readonly string[]).includes(trimmed)) {
    throw new ValidationError(
      `Campo inválido: ${field} deve ser um de: ${ACCESSORY_SIZES.join(", ")} (ou vazio/null para "Não se aplica").`,
    );
  }
  return trimmed;
}

// Rejeita, com 400, qualquer chave de `obj` fora de `allowed` — nunca
// ignora silenciosamente um campo desconhecido (material/unit_cost/
// current_stock incluídos, já que nenhum dos três está em ACCESSORY_KEYS).
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

// ---------------------------------------------------------------------------
// POST /accessories -> create_accessory(p_name, p_size, p_variant,
//   p_minimum_stock, p_is_active, p_changed_by)
// ---------------------------------------------------------------------------
export function validateCreateAccessoryPayload(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, ACCESSORY_KEYS, "corpo da requisição");

  return {
    p_name: requireTrimmedName(body.name, "name"),
    p_size: optionalSize(body.size, "size"),
    p_variant: optionalTrimmedString(body.variant, "variant"),
    p_minimum_stock: optionalInteger(body.minimum_stock, "minimum_stock", { min: 0 }),
    p_is_active: optionalBoolean(body.is_active, "is_active"),
  };
}

async function handleCreateAccessory(req: Request): Promise<Response> {
  const operator = await resolveOperator(req);

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const params = validateCreateAccessoryPayload(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("create_accessory", {
    ...params,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 201);
}

// ---------------------------------------------------------------------------
// PATCH /accessories/:id -> update_accessory(p_accessory_id, p_patch, p_changed_by)
//
// Constrói p_patch só com as chaves que o cliente de fato enviou — chave
// ausente nunca entra no objeto (preserva o valor atual/legado na RPC).
// name/is_active (colunas NOT NULL) rejeitam null explícito aqui com 400
// claro, em vez de deixar a RPC absorver silenciosamente ou violar a
// constraint — mesmo cuidado já usado em order-items/index.ts para
// quantity/unit_price.
// ---------------------------------------------------------------------------
export function buildAccessoryPatch(body: Record<string, unknown>): Record<string, unknown> {
  rejectUnknownKeys(body, ACCESSORY_KEYS, "corpo do PATCH");

  const patch: Record<string, unknown> = {};

  if ("name" in body) {
    if (body.name === null) {
      throw new ValidationError("Campo inválido: name não pode ser null (coluna obrigatória).");
    }
    patch.name = requireTrimmedName(body.name, "name");
  }
  if ("size" in body) {
    patch.size = optionalSize(body.size, "size");
  }
  if ("variant" in body) {
    patch.variant = optionalTrimmedString(body.variant, "variant");
  }
  if ("minimum_stock" in body) {
    patch.minimum_stock = optionalInteger(body.minimum_stock, "minimum_stock", { min: 0 });
  }
  if ("is_active" in body) {
    if (body.is_active === null) {
      throw new ValidationError("Campo inválido: is_active não pode ser null (coluna obrigatória).");
    }
    patch.is_active = optionalBoolean(body.is_active, "is_active");
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("PATCH vazio: informe ao menos um campo reconhecido para alterar.");
  }

  return patch;
}

async function handleUpdateAccessory(req: Request, accessoryId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(accessoryId)) {
    throw new ValidationError("Identificador de acessório inválido na rota.");
  }

  const rawBody = await req.text();
  rejectIdentityFields(rawBody);
  const body = parseJsonBody(rawBody);
  const patch = buildAccessoryPatch(body);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("update_accessory", {
    p_accessory_id: accessoryId,
    p_patch: patch,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, data, 200);
}

// ---------------------------------------------------------------------------
// DELETE /accessories/:id -> delete_accessory(p_accessory_id, p_changed_by)
//
// Sem corpo. Toda a regra de bloqueio (vínculo em product_accessories) vive
// na RPC — esta rota só resolve o operador, valida o UUID da rota e mapeia
// qualquer exceção via mapPgError (o bloqueio de negócio já é reconhecido
// por _shared/errors.ts via o marcador estável ACCESSORY_IN_USE:, ver
// RAISE_EXCEPTION_PATTERNS).
// ---------------------------------------------------------------------------
async function handleDeleteAccessory(req: Request, accessoryId: string): Promise<Response> {
  const operator = await resolveOperator(req);

  if (!isUuid(accessoryId)) {
    throw new ValidationError("Identificador de acessório inválido na rota.");
  }

  const admin = getAdminClient();
  const { error } = await admin.rpc("delete_accessory", {
    p_accessory_id: accessoryId,
    p_changed_by: operator.userId,
  });

  if (error) throw mapPgError(error);

  return jsonResponse(req, { success: true }, 200);
}
