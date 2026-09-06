// Edge Function: entity-images — entrypoint.
//
// Toda a lógica (rotas, validação, operações de Storage) vive em handler.ts,
// que não tem efeito colateral de módulo (nenhum Deno.serve) — pode ser
// importado por testes locais (handler.test.ts / paths.test.ts) sem abrir um
// listener HTTP real. Este arquivo é só o fio que liga o handler ao runtime.
import { handleRequest } from "./handler.ts";

Deno.serve(handleRequest);
