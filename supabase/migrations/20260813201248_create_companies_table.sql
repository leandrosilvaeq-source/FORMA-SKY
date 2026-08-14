-- Bloco 1 — Clientes e Pedidos
-- Migration 2/16: public.companies
-- docs/03_MODELO_BANCO_DADOS.md §5.2
--
-- Empresas clientes da Forma. customers.company_id (Migration 4) referenciará
-- esta tabela. Nenhuma outra tabela do Bloco 1 é criada nesta migration.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade_name text,
  document_number text,
  whatsapp text,
  instagram text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is
  'Empresas clientes (docs/01_ESPECIFICACAO_FUNCIONAL.md §5, docs/03_MODELO_BANCO_DADOS.md §5.2).';

-- Reaproveita a função utilitária criada no Bloco 0
-- (supabase/migrations/20260813025937_create_users_table.sql).
create trigger set_companies_updated_at
  before update on public.companies
  for each row
  execute function public.set_updated_at();

alter table public.companies enable row level security;

revoke all on public.companies from anon;
revoke all on public.companies from authenticated;
-- Sem DELETE: inativação lógica via is_active, nunca exclusão física.
grant select, insert, update on public.companies to authenticated;

create policy "Active users can view companies"
  on public.companies
  for select
  to authenticated
  using (public.is_active_user());

create policy "Active users can create companies"
  on public.companies
  for insert
  to authenticated
  with check (public.is_active_user());

create policy "Active users can update companies"
  on public.companies
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());
