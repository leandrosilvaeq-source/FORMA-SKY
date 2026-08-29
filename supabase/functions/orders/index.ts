// Edge Function: orders — entrypoint.
//
// Toda a lógica vive em handler.ts (sem Deno.serve) — mesmo padrão de
// accessories/index.ts, stock-movements/index.ts, inventory-purchases/index.ts
// e products/index.ts (Incremento 6A). Extraído nesta rodada (ajustes de
// Produtos/Clientes/Pedidos, 2026-08-29) especificamente para permitir
// testes locais sem abrir um listener HTTP real — comportamento idêntico ao
// index.ts anterior (nenhuma rota/lógica preexistente mudou de lugar sem
// preservar exatamente o mesmo corpo).
import { handleRequest } from "./handler.ts";

Deno.serve(handleRequest);
