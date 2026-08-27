// Edge Function: filament-movements — entrypoint.
//
// Toda a lógica vive em handler.ts (sem Deno.serve) — mesmo padrão de
// stock-movements/index.ts.
import { handleRequest } from "./handler.ts";

Deno.serve(handleRequest);
