// CORS centralizado para todas as Edge Functions do Bloco 1.
//
// ALLOWED_ORIGIN (env var) contém uma lista de origens permitidas separadas
// por vírgula (ex.: "https://app.formasky.com,http://localhost:5173").
// Nunca usamos "*": a origem da requisição só é ecoada de volta no header
// Access-Control-Allow-Origin quando está nessa allowlist; fora dela nenhum
// header de CORS de origem é enviado, e o navegador bloqueia a resposta por
// conta própria.

function getAllowedOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGIN") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function buildCorsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    // PUT precisa estar aqui: é o método usado por
    // supabase/functions/orders/index.ts (update_order e o novo
    // PUT /orders/:id/full -> update_quote_order). Sem PUT nesta lista, o
    // preflight OPTIONS do navegador nega a requisição real antes mesmo
    // dela ser enviada — fetch() rejeita com um erro genérico de rede
    // (TypeError, sem detalhe algum acessível via JS), idêntico ao que
    // apareceria numa falha de conexão real. Causa raiz confirmada por
    // preflight manual (curl -X OPTIONS com
    // Access-Control-Request-Method: PUT): a origem já estava na
    // allowlist (Access-Control-Allow-Origin correto), só o método faltava
    // aqui.
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    // Necessário porque Access-Control-Allow-Origin varia por requisição
    // (depende do header Origin recebido) — evita que caches/CDNs
    // compartilhem incorretamente uma resposta CORS entre origens.
    Vary: "Origin",
  };

  const origin = req.headers.get("origin");
  if (origin && getAllowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

// Chamar como primeiro passo de cada handler, antes de qualquer autenticação
// ou acesso ao banco: preflight nunca deve depender de JWT nem tocar dados.
export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
}
