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
// runtime, um erro do driver Postgres que mapPgError não converteu antes de
// chegar aqui) é tratado como DatabaseError genérico (500).
//
// CORREÇÃO (auditoria do erro genérico em FS-26-001): a versão anterior
// devolvia err.message diretamente ao cliente para QUALQUER erro não
// classificado — isso poderia vazar texto interno (mensagem de exceção do
// runtime, detalhe de uma query, nome de coluna/constraint) para fora do
// servidor. Agora, para um erro NÃO classificado como AppError, a mensagem
// real vai só para o log do servidor (console.error, visível nos logs da
// Edge Function, nunca na resposta HTTP) e o cliente recebe uma mensagem
// genérica e segura. Erros já classificados (AppError, incluindo os que
// mapPgError já converteu a partir de um erro real do Postgres) continuam
// devolvendo sua mensagem normal — essas mensagens já são as intencionais,
// pensadas para o usuário final, não texto interno vazando.
export function errorResponse(req: Request, err: unknown): Response {
  if (!(err instanceof AppError)) {
    console.error("Erro não classificado:", err);
  }

  const appError = err instanceof AppError
    ? err
    : new DatabaseError("Erro interno inesperado. Tente novamente em instantes.");

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
