// Edge Function: filament-types — entrypoint.
//
// Toda a lógica vive em handler.ts (sem Deno.serve) — ver mesmo padrão em
// accessories/index.ts e packaging/index.ts.
import { handleRequest } from "./handler.ts";

Deno.serve(handleRequest);
