// Edge Function: products — entrypoint.
//
// Toda a lógica vive em handler.ts (sem Deno.serve) — mesmo padrão de
// accessories/index.ts, stock-movements/index.ts e inventory-purchases/index.ts.
// Extraído nesta rodada (Módulo 3, Incremento 6A) especificamente para
// permitir testes locais sem abrir um listener HTTP real — comportamento
// idêntico ao index.ts anterior (nenhuma rota/lógica mudou de lugar sem
// preservar exatamente o mesmo corpo).
import { handleRequest } from "./handler.ts";

Deno.serve(handleRequest);
