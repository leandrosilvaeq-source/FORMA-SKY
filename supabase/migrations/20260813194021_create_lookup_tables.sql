-- Bloco 1 — Clientes e Pedidos
-- Migration 1/16: tabelas de domínio (lookup tables)
-- docs/03_MODELO_BANCO_DADOS.md §5.3 (lead_sources) e §8.2 (model_sources)
--
-- Cria as tabelas de origem de cliente/pedido (lead_sources) e origem do
-- modelo usado em itens Spot (model_sources), com seus seeds iniciais.
-- Nenhuma outra tabela do Bloco 1 é criada nesta migration.

-- ---------------------------------------------------------------------------
-- Função auxiliar de RLS: is_active_user()
-- ---------------------------------------------------------------------------
-- Usada pelas policies das tabelas operacionais do Bloco 1 (e futuras) para
-- garantir que um usuário autenticado, mas com o perfil em public.users
-- inativado, perca a capacidade de ler/escrever dados de negócio mesmo que
-- sua sessão de auth ainda seja válida.
--
-- security invoker (padrão): a policy "Users can view their own profile" já
-- criada no Bloco 0 permite que o usuário autenticado leia sua própria linha
-- em public.users, que é exatamente a linha necessária aqui — não há motivo
-- para elevar privilégio com security definer.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.is_active
  );
$$;

comment on function public.is_active_user() is
  'True se o usuário autenticado atual possui perfil ativo em public.users. Usada nas policies de RLS das tabelas operacionais.';

-- Função criada com search_path travado (public, pg_temp) e sem depender de
-- resolução implícita de schema: auth.uid() e public.users já são
-- referenciados de forma totalmente qualificada.
revoke execute on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated;

-- ---------------------------------------------------------------------------
-- lead_sources
-- ---------------------------------------------------------------------------
create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true
);

comment on table public.lead_sources is
  'Origens de clientes/pedidos (docs/01_ESPECIFICACAO_FUNCIONAL.md §5, docs/03_MODELO_BANCO_DADOS.md §5.3).';

-- Sem created_at/updated_at: o modelo aprovado (doc 03 §5.3) define apenas
-- id, name e is_active para esta tabela de domínio.

alter table public.lead_sources enable row level security;

revoke all on public.lead_sources from anon;
revoke all on public.lead_sources from authenticated;
-- Sem DELETE: inativação lógica via is_active, nunca exclusão física.
grant select, insert, update on public.lead_sources to authenticated;

create policy "Active users can view lead sources"
  on public.lead_sources
  for select
  to authenticated
  using (public.is_active_user());

create policy "Active users can create lead sources"
  on public.lead_sources
  for insert
  to authenticated
  with check (public.is_active_user());

create policy "Active users can update lead sources"
  on public.lead_sources
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());

-- ---------------------------------------------------------------------------
-- model_sources
-- ---------------------------------------------------------------------------
create table public.model_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true
);

comment on table public.model_sources is
  'Origem do modelo usado em itens Spot (docs/01_ESPECIFICACAO_FUNCIONAL.md §10.1, docs/03_MODELO_BANCO_DADOS.md §8.2).';

alter table public.model_sources enable row level security;

revoke all on public.model_sources from anon;
revoke all on public.model_sources from authenticated;
grant select, insert, update on public.model_sources to authenticated;

create policy "Active users can view model sources"
  on public.model_sources
  for select
  to authenticated
  using (public.is_active_user());

create policy "Active users can create model sources"
  on public.model_sources
  for insert
  to authenticated
  with check (public.is_active_user());

create policy "Active users can update model sources"
  on public.model_sources
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------
-- Valores sustentados literalmente pelos documentos (nenhum valor inventado):
-- lead_sources  -> docs/01_ESPECIFICACAO_FUNCIONAL.md §5 / docs/03_MODELO_BANCO_DADOS.md §5.3
-- model_sources -> docs/01_ESPECIFICACAO_FUNCIONAL.md §10.1 / docs/03_MODELO_BANCO_DADOS.md §8.2
-- on conflict do nothing: torna o seed idempotente caso a migration seja
-- reaplicada.

insert into public.lead_sources (name) values
  ('Indicação / boca a boca'),
  ('WhatsApp'),
  ('Instagram'),
  ('Facebook'),
  ('TikTok'),
  ('Outros')
on conflict (name) do nothing;

insert into public.model_sources (name) values
  ('MakerWorld / Bambu Studio'),
  ('Arquivo do cliente'),
  ('Outra plataforma'),
  ('Outra fonte')
on conflict (name) do nothing;
