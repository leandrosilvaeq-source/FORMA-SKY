import { buildCorsHeaders } from "./cors.ts";
import { AppError, DatabaseError } from "./errors.ts";

// Envelope de sucesso padrão: { "data": {...} }.
export function jsonResponse(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

// Envelope de erro padrão: { "error": { "type": "...", "message": "..." } }.
// Qualquer erro que não seja um AppError conhecido (ex.: falha inesperada de
// runtime) é tratado como DatabaseError genérico (500) em vez de vazar
// detalhes internos sem classificação.
export function errorResponse(req: Request, err: unknown): Response {
  const appError = err instanceof AppError
    ? err
    : new DatabaseError(err instanceof Error ? err.message : "Erro interno inesperado.");

  return new Response(
    JSON.stringify({ error: { type: appError.type, message: appError.message } }),
    {
      status: appError.status,
      headers: {
        ...buildCorsHeaders(req),
        "Content-Type": "application/json",
      },
    },
  );
}
