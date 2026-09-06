// Testes locais de entity-images/paths.ts — validadores puros de caminho de
// objeto do bucket privado `entity-images`. Sem framework de asserção (mesmo
// critério de _shared/errors.test.ts e accessories/handler.test.ts) — só o
// runner nativo `Deno.test`.
//
// LIMITAÇÃO DE AMBIENTE: o runtime `deno` não está instalado nesta
// máquina/sessão — este arquivo foi ESCRITO seguindo a mesma disciplina dos
// testes Deno já existentes, mas NÃO foi executado. Precisa de uma primeira
// execução real (`deno test supabase/functions/entity-images/`) antes de ser
// considerado verde.

import { ValidationError } from "../_shared/errors.ts";
import {
  assertEntity,
  assertRecordId,
  assertSignablePaths,
  buildEntityImagePaths,
  entityImageFolder,
  isCanonicalObjectPath,
  isEntityImageEntity,
  SIGN_BATCH_LIMIT,
} from "./paths.ts";

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

const UUID_A = "123e4567-e89b-42d3-a456-426614174000";
const UUID_B = "22222222-2222-4222-8222-222222222222";

Deno.test("isEntityImageEntity aceita só as quatro entidades internas", () => {
  for (const ok of ["accessories", "packaging", "filament-types", "products"]) {
    assertEquals(isEntityImageEntity(ok), true);
  }
  for (const bad of ["accessory", "filament_types", "users", "", "../etc", null, 3]) {
    assertEquals(isEntityImageEntity(bad as unknown), false);
  }
});

Deno.test("assertEntity devolve a entidade válida e lança ValidationError para inválida", () => {
  assertEquals(assertEntity("products"), "products");
  assertThrows(() => assertEntity("orders"));
  assertThrows(() => assertEntity(undefined));
});

Deno.test("assertRecordId exige UUID", () => {
  assertEquals(assertRecordId(UUID_A), UUID_A);
  assertThrows(() => assertRecordId("not-a-uuid"));
  assertThrows(() => assertRecordId("../../secret"));
  assertThrows(() => assertRecordId(123 as unknown));
});

Deno.test("buildEntityImagePaths gera par versionado sob {entity}/{id}/ com sufixos corretos", () => {
  const pair = buildEntityImagePaths("accessories", UUID_A);
  assertEquals(pair.original.startsWith(`accessories/${UUID_A}/`), true);
  assertEquals(pair.thumb.startsWith(`accessories/${UUID_A}/`), true);
  assertEquals(pair.original.endsWith("-original.webp"), true);
  assertEquals(pair.thumb.endsWith("-thumb.webp"), true);
  // mesma "versão" (uuid) para os dois objetos do mesmo upload
  const vOriginal = pair.original.slice(`accessories/${UUID_A}/`.length, -"-original.webp".length);
  const vThumb = pair.thumb.slice(`accessories/${UUID_A}/`.length, -"-thumb.webp".length);
  assertEquals(vOriginal, vThumb);
  // caminhos gerados são canônicos
  assertEquals(isCanonicalObjectPath(pair.original), true);
  assertEquals(isCanonicalObjectPath(pair.thumb), true);
  // uma segunda chamada gera versão diferente (nunca sobrescreve o objeto antigo)
  const again = buildEntityImagePaths("accessories", UUID_A);
  assertEquals(again.original === pair.original, false);
});

Deno.test("entityImageFolder é o prefixo de um único registro", () => {
  assertEquals(entityImageFolder("products", UUID_B), `products/${UUID_B}`);
});

Deno.test("isCanonicalObjectPath rejeita caminho malicioso / fora do padrão", () => {
  const good = `filament-types/${UUID_A}/${UUID_B}-thumb.webp`;
  assertEquals(isCanonicalObjectPath(good), true);
  for (
    const bad of [
      `/accessories/${UUID_A}/${UUID_B}-thumb.webp`, // barra inicial
      `accessories/${UUID_A}/../${UUID_B}-thumb.webp`, // ..
      `entity-images/accessories/${UUID_A}/${UUID_B}-thumb.webp`, // nome de bucket embutido
      `accessories/${UUID_A}/${UUID_B}-thumb.png`, // extensão errada
      `accessories/${UUID_A}/${UUID_B}-preview.webp`, // sufixo não previsto
      `orders/${UUID_A}/${UUID_B}-thumb.webp`, // entidade desconhecida
      `accessories/not-a-uuid/${UUID_B}-thumb.webp`, // id inválido
      `accessories/${UUID_A}/${UUID_B}-thumb.webp\n${good}`, // newline injection
      "",
      null,
    ]
  ) {
    assertEquals(isCanonicalObjectPath(bad as unknown), false);
  }
});

Deno.test("assertSignablePaths: array não vazio, dentro do teto, canônico, deduplicado preservando ordem", () => {
  const p1 = `accessories/${UUID_A}/${UUID_B}-original.webp`;
  const p2 = `accessories/${UUID_A}/${UUID_B}-thumb.webp`;
  assertEquals(assertSignablePaths([p1, p2, p1]), [p1, p2]);
  assertThrows(() => assertSignablePaths([]));
  assertThrows(() => assertSignablePaths("nope" as unknown));
  assertThrows(() => assertSignablePaths([p1, "../secret"]));
  const tooMany = Array.from(
    { length: SIGN_BATCH_LIMIT + 1 },
    () => `accessories/${UUID_A}/${crypto.randomUUID()}-thumb.webp`,
  );
  assertThrows(() => assertSignablePaths(tooMany));
});

Deno.test("ValidationError das asserções é sempre um ValidationError (400)", () => {
  try {
    assertEntity("orders");
  } catch (err) {
    assertEquals(err instanceof ValidationError, true);
    assertEquals((err as ValidationError).status, 400);
  }
});
