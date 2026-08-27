// Edge Function: filament-spools — entrypoint.
//
// Toda a lógica vive em handler.ts (sem Deno.serve) — mesmo padrão de
// accessories/index.ts e filament-types/index.ts.
import { handleRequest } from "./handler.ts";

Deno.serve(handleRequest);
