// Edge Function: stock-movements — entrypoint.
//
// Toda a lógica (rotas, validação, handler) vive em handler.ts, que não tem
// nenhum efeito colateral de módulo (nenhum Deno.serve) — pode ser importado
// por testes locais (ver handler.test.ts) sem abrir um listener HTTP real.
// Este arquivo é só o fio que liga o handler ao runtime das Edge Functions —
// mesmo padrão de accessories/index.ts e packaging/index.ts.
import { handleRequest } from "./handler.ts";

Deno.serve(handleRequest);
