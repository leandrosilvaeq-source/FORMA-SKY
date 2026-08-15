import { createClient } from "npm:@supabase/supabase-js@2";
import { AuthenticationError, AuthorizationError } from "./errors.ts";
import { getAdminClient } from "./supabaseAdmin.ts";

export interface OperatorContext {
  /** public.users.id — usado como p_changed_by/p_created_by em toda RPC. */
  userId: string;
  /** auth.users.id (auth_user_id), só para referência/log. */
  authUserId: string;
}

// Fluxo de identidade do operador (obrigatório em toda rota que escreve no
// banco):
//   1. Lê o JWT do usuário final do header Authorization.
//   2. Valida esse JWT contra o Supabase Auth via auth.getUser() (client
//      criado com a ANON key, repassando o header recebido) — confirma
//      assinatura/expiração e devolve auth_user_id (claim `sub`).
//   3. Resolve o public.users.id correspondente (via client service_role,
//      para não depender de RLS neste lookup interno) e confirma is_active.
//   4. Só o users.id resolvido aqui pode ser usado como p_changed_by/
//      p_created_by — nunca um valor vindo do corpo da requisição.
export async function resolveOperator(req: Request): Promise<OperatorContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new AuthenticationError("Header Authorization ausente.");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "SUPABASE_URL ou SUPABASE_ANON_KEY não configuradas no ambiente da Edge Function.",
    );
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw new AuthenticationError("Token inválido ou expirado.");
  }

  const authUserId = data.user.id;

  const admin = getAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (profileError) {
    throw new AuthorizationError("Falha ao resolver o operador a partir do token.");
  }
  if (!profile || !profile.is_active) {
    throw new AuthorizationError("Operador não encontrado ou inativo.");
  }

  return { userId: profile.id as string, authUserId };
}
