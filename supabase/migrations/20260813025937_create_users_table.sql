-- Bloco 0 — Fundação
-- Módulo de usuários e autenticação (docs/03_MODELO_BANCO_DADOS.md, seção 4.1)
--
-- Cria a tabela `users`, que representa os usuários autorizados do sistema e
-- é preenchida automaticamente a partir de `auth.users` (Supabase Auth).
-- Inicialmente haverá um único operador principal, mas a estrutura já aceita
-- múltiplos usuários no futuro.

-- Função utilitária reaproveitável por futuras migrations para manter
-- `updated_at` sempre atualizado em UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Função interna de trigger: nunca deve ser chamada diretamente (ver
-- revoke explícito ao final do arquivo).
revoke execute on function public.set_updated_at() from public, anon, authenticated;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  -- Nullable de propósito: quando o usuário é excluído do Supabase Auth, o
  -- perfil operacional é preservado (ver trigger on_auth_user_deleted) e
  -- este campo passa a null em vez de a linha inteira ser apagada.
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name text,
  email text not null,
  -- 'operator' é o papel padrão, sem privilégio administrativo. Promoção a
  -- um papel com mais privilégio (ex.: 'admin') deve ser feita
  -- explicitamente por quem já tem essa permissão, nunca automaticamente
  -- no cadastro.
  role text not null default 'operator',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is 'Usuários autorizados do sistema (perfil vinculado a auth.users).';

create trigger set_users_updated_at
  before update on public.users
  for each row
  execute function public.set_updated_at();

-- Fonte oficial da verdade permanece no banco: toda alteração de auth.users
-- deve refletir automaticamente em public.users, sem depender do frontend.
alter table public.users enable row level security;

-- RLS restringe LINHAS, não colunas. Sem os grants explícitos abaixo, um
-- usuário autenticado conseguiria, dentro da própria linha, dar UPDATE em
-- qualquer coluna — inclusive role, is_active, auth_user_id e email.
-- Fechamos isso no nível de privilégio de coluna do Postgres, que é
-- avaliado antes da policy de RLS.

-- anon não tem nenhum acesso a esta tabela: é dado de perfil de usuário
-- autenticado, não dado público.
revoke all on public.users from anon;

-- authenticated começa sem nenhum privilégio de tabela; concedemos apenas
-- o estritamente necessário, de forma explícita.
revoke all on public.users from authenticated;
grant select on public.users to authenticated;
-- UPDATE liberado apenas para a coluna `name`. Tentar incluir role,
-- is_active, auth_user_id ou email no SET falha com "permission denied for
-- column ..." antes mesmo de a policy de RLS ser avaliada.
grant update (name) on public.users to authenticated;
-- Nenhum INSERT ou DELETE é concedido a authenticated: a única via de
-- criação é o trigger on_auth_user_created (SECURITY DEFINER, abaixo); a
-- única via de "remoção" é a inativação (is_active = false), reservada a
-- backend/serviço privilegiado ou processo administrativo futuro.

create policy "Users can view their own profile"
  on public.users
  for select
  to authenticated
  using (auth_user_id = auth.uid());

create policy "Users can update their own profile"
  on public.users
  for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- Cria automaticamente o registro em public.users quando um novo usuário se
-- cadastra via Supabase Auth (e-mail/senha).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (auth_user_id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- Quando um usuário é excluído do Supabase Auth, o perfil NÃO é apagado:
-- apenas inativado. Isso roda antes do DELETE em auth.users, então
-- auth_user_id ainda aponta para a linha sendo removida no momento do
-- UPDATE. Em seguida, a própria exclusão aciona `on delete set null` na
-- foreign key, desvinculando o perfil de um auth_user_id que deixará de
-- existir.
create or replace function public.handle_auth_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set is_active = false
  where auth_user_id = old.id;
  return old;
end;
$$;

create trigger on_auth_user_deleted
  before delete on auth.users
  for each row
  execute function public.handle_auth_user_deleted();

-- Ambas as funções de trigger são SECURITY DEFINER e só devem ser
-- executadas pelo mecanismo interno de trigger do Postgres — nunca
-- chamadas diretamente (ex.: via RPC do supabase-js). O Postgres concede
-- EXECUTE a PUBLIC por padrão na criação da função; revogamos
-- explicitamente para anon e authenticated (e para PUBLIC, fechando
-- qualquer outro papel futuro) por segurança em profundidade.
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.handle_auth_user_deleted() from public, anon, authenticated;
