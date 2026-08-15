import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// Client privilegiado (service_role) — a única forma de chamar as RPCs
// security definer do Bloco 1, cujo EXECUTE é concedido exclusivamente a
// service_role (nunca a anon/authenticated). A service_role key só existe
// como env var da Edge Function, nunca é enviada ao frontend.
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetadas automaticamente
// pelo runtime do Supabase Edge Functions (local e produção) — não é
// necessário configurá-las manualmente via `supabase secrets set`.
let cachedClient: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas no ambiente da Edge Function.",
    );
  }

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cachedClient;
}
