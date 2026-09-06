// Testes locais da Edge Function `entity-images` — validadores puros +
// roteamento offline (preflight CORS, 401 sem Authorization, 404 rota
// desconhecida, 405 método não permitido) + contrato de identidade do
// cliente administrativo (getAdminClient exige a service-role key; upload sem
// Authorization para na identidade antes de qualquer leitura de tabela).
// Mesma disciplina de accessories/handler.test.ts: importa só de handler.ts
// (sem Deno.serve), nenhuma rede/banco.
//
// O caminho feliz completo (upload/remove/sign/purge com usuário autenticado
// real + Storage + RPC) NÃO é coberto aqui — exigiria Supabase local e um
// JWT válido. Fica para uma suíte de integração com o ambiente rodando. O
// que É garantido offline: nenhuma dessas rotas toca Storage/banco antes de
// resolveOperator (identidade) e da validação estrutural do payload.
//
// LIMITAÇÃO DE AMBIENTE: o runtime `deno` não está instalado nesta
// máquina/sessão — este arquivo foi ESCRITO seguindo os testes Deno
// existentes, mas NÃO foi executado. Precisa de `deno test
// supabase/functions/entity-images/` numa máquina com Deno antes de contar
// como verde.

import { ValidationError } from "../_shared/errors.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import {
  assertMaxBytes,
  assertWebp,
  decodeBase64Image,
  handleRequest,
  rejectUnknownKeys,
} from "./handler.ts";

function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `esperado ${e}, obtido ${a}`);
}

function assertThrows(fn: () => unknown): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error("esperado que a função lançasse, mas não lançou");
}

// Bytes mínimos de um container WebP válido: "RIFF" + tamanho + "WEBP".
function fakeWebpBytes(padding = 0): Uint8Array {
  const header = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
  return new Uint8Array([...header, ...new Array(padding).fill(0)]);
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// decodeBase64Image
// ---------------------------------------------------------------------------
Deno.test("decodeBase64Image decodifica base64 puro e com prefixo data:", () => {
  const bytes = fakeWebpBytes(4);
  const plain = decodeBase64Image(toBase64(bytes), "original_base64");
  assertEquals(Array.from(plain), Array.from(bytes));
  const withPrefix = decodeBase64Image(
    `data:image/webp;base64,${toBase64(bytes)}`,
    "original_base64",
  );
  assertEquals(Array.from(withPrefix), Array.from(bytes));
});

Deno.test("decodeBase64Image rejeita vazio / não-string / base64 malformado", () => {
  assertThrows(() => decodeBase64Image("", "f"));
  assertThrows(() => decodeBase64Image(undefined, "f"));
  assertThrows(() => decodeBase64Image(123 as unknown, "f"));
  assertThrows(() => decodeBase64Image("!!!not base64!!!", "f"));
});

// ---------------------------------------------------------------------------
// assertWebp
// ---------------------------------------------------------------------------
Deno.test("assertWebp aceita container RIFF/WEBP e rejeita PNG/JPEG/curto", () => {
  assertWebp(fakeWebpBytes(2), "original_base64"); // não lança
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assertThrows(() => assertWebp(png, "original_base64"));
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assertThrows(() => assertWebp(jpeg, "original_base64"));
  assertThrows(() => assertWebp(new Uint8Array([0x52, 0x49, 0x46, 0x46]), "original_base64"));
});

// ---------------------------------------------------------------------------
// assertMaxBytes
// ---------------------------------------------------------------------------
Deno.test("assertMaxBytes lança quando excede o teto", () => {
  assertMaxBytes(new Uint8Array(10), 16, "thumb_base64"); // ok
  assertThrows(() => assertMaxBytes(new Uint8Array(32), 16, "thumb_base64"));
});

// ---------------------------------------------------------------------------
// rejectUnknownKeys
// ---------------------------------------------------------------------------
Deno.test("rejectUnknownKeys recusa chave fora do contrato", () => {
  rejectUnknownKeys({ entity: "accessories", id: "x" }, ["entity", "id"], "corpo"); // ok
  assertThrows(() =>
    rejectUnknownKeys(
      { entity: "accessories", id: "x", p_changed_by: "hack" },
      ["entity", "id"],
      "corpo",
    )
  );
});

// ---------------------------------------------------------------------------
// handleRequest — roteamento offline
// ---------------------------------------------------------------------------
Deno.test("handleRequest responde 204 ao preflight OPTIONS", async () => {
  const res = await handleRequest(
    new Request("https://x.test/entity-images/upload", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 204);
});

Deno.test("handleRequest devolve 401 sem Authorization em /upload", async () => {
  const res = await handleRequest(
    new Request("https://x.test/entity-images/upload", {
      method: "POST",
      body: JSON.stringify({ entity: "accessories", id: "x" }),
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 401 sem Authorization em /sign (também exige autenticação)", async () => {
  const res = await handleRequest(
    new Request("https://x.test/entity-images/sign", {
      method: "POST",
      body: JSON.stringify({ paths: [] }),
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test("handleRequest devolve 405 para GET numa rota reconhecida", async () => {
  const res = await handleRequest(
    new Request("https://x.test/entity-images/upload", { method: "GET" }),
  );
  assertEquals(res.status, 405);
});

Deno.test("handleRequest devolve 404 para rota desconhecida", async () => {
  const res = await handleRequest(
    new Request("https://x.test/entity-images/upload/extra/segments", { method: "POST" }),
  );
  assertEquals(res.status, 404);
});

Deno.test("ValidationError das asserções é 400", () => {
  try {
    decodeBase64Image("", "f");
  } catch (err) {
    assertEquals(err instanceof ValidationError, true);
    assertEquals((err as ValidationError).status, 400);
  }
});

// ---------------------------------------------------------------------------
// Identidade do cliente administrativo — regressão do erro real
// "permission denied for table accessories" (SQLSTATE 42501) no primeiro
// upload de foto em Acessórios.
//
// Causa raiz: NÃO era o client errado — getAdminClient() já cria o client
// exclusivamente com SUPABASE_SERVICE_ROLE_KEY, sem repassar o header
// Authorization do usuário. O que faltava era o GRANT SELECT do Postgres para
// o papel service_role nas tabelas accessories/packaging/filament_types/
// products (a Edge Function `entity-images` é a primeira a fazer uma leitura
// DIRETA dessas tabelas pelo admin client, via assertRecordExistence — todas
// as outras funções só as tocam por RPCs security definer). A correção de
// banco é a migration
// 20260906130000_grant_service_role_select_entity_image_tables.sql; a
// regressão do privilégio em si é exercida por
// supabase/tests/entity_images_infrastructure_test.sql (seção 7).
//
// O que este arquivo garante, offline, é o contrato de identidade do lado da
// função: o caminho administrativo depende da service-role key e NUNCA cai
// para a identidade anônima/do usuário quando ela falta.
// ---------------------------------------------------------------------------
Deno.test("getAdminClient exige SUPABASE_SERVICE_ROLE_KEY — nunca cai para anon/JWT do usuário", () => {
  const savedUrl = Deno.env.get("SUPABASE_URL");
  const savedService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");

    let threw = false;
    try {
      getAdminClient();
    } catch (err) {
      threw = true;
      // A mensagem cita a env var que falta, sem expor nenhum segredo.
      assertEquals((err as Error).message.includes("SUPABASE_SERVICE_ROLE_KEY"), true);
    }
    assertEquals(threw, true);
  } finally {
    if (savedUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", savedUrl);
    if (savedService === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", savedService);
  }
});

Deno.test("upload sem Authorization falha na identidade ANTES de qualquer leitura de tabela/Storage", async () => {
  // Sem header Authorization, resolveOperator lança 401 antes de
  // assertRecordExistence — nenhuma leitura de accessories, nenhum upload,
  // nenhuma chamada de RPC acontece. Garante que a checagem de permissão de
  // tabela nunca é alcançada por um chamador não autenticado.
  const res = await handleRequest(
    new Request("https://x.test/entity-images/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity: "accessories",
        id: "00000000-0000-0000-0000-000000000000",
        original_base64: "x",
        thumb_base64: "x",
      }),
    }),
  );
  assertEquals(res.status, 401);
  const payload = await res.json();
  assertEquals(payload.error.type, "authorization");
});
