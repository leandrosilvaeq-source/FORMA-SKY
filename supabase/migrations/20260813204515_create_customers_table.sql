-- Bloco 1 — Clientes e Pedidos
-- Migration 4/16: public.customers
-- docs/03_MODELO_BANCO_DADOS.md §5.1, decisão do plano final (acquisition_source_id)
--
-- Clientes pessoa física ou contato principal. Nenhuma outra tabela do
-- Bloco 1 é criada nesta migration.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  whatsapp text,
  instagram text,
  -- ON DELETE RESTRICT (não CASCADE, não SET NULL): companies e
  -- lead_sources já não concedem DELETE a authenticated (só is_active=false
  -- é possível pela aplicação), então um DELETE físico só poderia vir de uma
  -- operação administrativa direta no banco. RESTRICT impede que essa
  -- operação apague silenciosamente uma company/lead_source ainda
  -- referenciada, preservando o histórico do cliente — força a inativação
  -- lógica (is_active = false) em vez da exclusão física. SET NULL foi
  -- descartado por perder a referência histórica de origem/empresa do
  -- cliente.
  company_id uuid references public.companies (id) on delete restrict,
  acquisition_source_id uuid references public.lead_sources (id) on delete restrict,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customers is
  'Clientes (docs/01_ESPECIFICACAO_FUNCIONAL.md §5, docs/03_MODELO_BANCO_DADOS.md §5.1). acquisition_source_id registra a origem de aquisição do cliente; orders.lead_source_id (Migration 7) registra a origem de cada pedido, podendo herdar este valor por padrão.';

-- Reaproveita a função utilitária criada no Bloco 0
-- (supabase/migrations/20260813025937_create_users_table.sql).
create trigger set_customers_updated_at
  before update on public.customers
  for each row
  execute function public.set_updated_at();

alter table public.customers enable row level security;

revoke all on public.customers from anon;
revoke all on public.customers from authenticated;
-- Sem DELETE: inativação lógica via is_active, nunca exclusão física.
grant select, insert, update on public.customers to authenticated;

create policy "Active users can view customers"
  on public.customers
  for select
  to authenticated
  using (public.is_active_user());

create policy "Active users can create customers"
  on public.customers
  for insert
  to authenticated
  with check (public.is_active_user());

create policy "Active users can update customers"
  on public.customers
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());
