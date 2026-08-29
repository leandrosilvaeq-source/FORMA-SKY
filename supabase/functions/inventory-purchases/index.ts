// Edge Function: inventory-purchases — entrypoint.
//
// Toda a lógica vive em handler.ts (sem Deno.serve) — mesmo padrão de
// accessories/index.ts, filament-types/index.ts, stock-movements/index.ts.
import { handleRequest } from "./handler.ts";

Deno.serve(handleRequest);
