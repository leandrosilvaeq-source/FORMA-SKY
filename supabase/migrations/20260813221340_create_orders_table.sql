-- Bloco 1 — Clientes e Pedidos
-- Migration 7/16: public.orders
-- docs/03_MODELO_BANCO_DADOS.md §6.1
--
-- Cabeçalho do pedido. order_items (Migration 8) ainda não é criada — os
-- campos financeiros (subtotal/total_value) nascem em 0 e só passam a ser
-- mantidos automaticamente quando order_items existir. Nenhuma função de
-- negócio (create_order, change_order_status etc.) nem tabela de histórico
-- é criada nesta migration.

create table public.orders (
  id uuid primary key default gen_random_uuid(),

  -- Formato FS-YYYY-NNNN (gerado por next_order_number(), Migration 6).
  -- Aqui só a coluna e a constraint de unicidade são preparadas; a geração
  -- em si só existirá quando create_order() for criada (Migration 15).
  order_number text not null unique
    check (order_number ~ '^FS-[0-9]{4}-[0-9]{4}$'),

  -- ON DELETE RESTRICT nas três FKs abaixo (nunca CASCADE): um pedido é
  -- registro de negócio que não pode perder silenciosamente sua referência
  -- a cliente/empresa/origem. customers, companies e lead_sources já não
  -- concedem DELETE a authenticated (só is_active=false é possível pela
  -- aplicação); RESTRICT garante que mesmo uma exclusão física
  -- administrativa direta no banco seja bloqueada enquanto existir pedido
  -- referenciando a linha — forçando a inativação lógica em vez da
  -- exclusão. SET NULL foi descartado nas três por apagar informação de
  -- negócio relevante para histórico/relatórios (doc 01 §43 relaciona
  -- pedidos à origem da venda).
  customer_id uuid not null references public.customers (id) on delete restrict,
  company_id uuid references public.companies (id) on delete restrict,
  lead_source_id uuid references public.lead_sources (id) on delete restrict,

  order_status text not null default 'QUOTE'
    check (order_status in (
      'QUOTE', 'WAITING_APPROVAL', 'APPROVED', 'IN_PRODUCTION_QUEUE',
      'IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED'
    )),

  payment_status text not null default 'WAITING_PAYMENT'
    check (payment_status in ('WAITING_PAYMENT', 'DEPOSIT_RECEIVED', 'PAID')),

  -- Nullable: meio de pagamento pode ainda não estar definido no momento do
  -- orçamento/aprovação.
  payment_method text
    check (payment_method is null or payment_method in ('PIX', 'DINHEIRO', 'CARTAO')),

  -- Timezone fixado explicitamente em America/Sao_Paulo, mesmo padrão já
  -- usado em next_order_number() (Migration 6): a data do pedido deve virar
  -- à meia-noite local, não à meia-noite UTC (padrão de sessão do
  -- Postgres/Supabase).
  order_date date not null default (now() at time zone 'America/Sao_Paulo')::date,
  -- Nullable: preenchida automaticamente quando order_status mudar para
  -- APPROVED (função a ser criada em migration futura). Fonte histórica
  -- oficial continua sendo order_status_history (Migration 13).
  approval_date date,
  expected_delivery_date date,
  actual_delivery_date date,
  delivery_method text,

  shipping_cost numeric(10, 2) not null default 0 check (shipping_cost >= 0),
  discount_value numeric(10, 2) not null default 0 check (discount_value >= 0),
  subtotal numeric(10, 2) not null default 0 check (subtotal >= 0),
  total_value numeric(10, 2) not null default 0 check (total_value >= 0),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.orders is
  'Cabeçalho do pedido (docs/01_ESPECIFICACAO_FUNCIONAL.md §7-8, docs/03_MODELO_BANCO_DADOS.md §6.1). Tabela crítica: authenticated só tem SELECT — toda escrita ocorre por funções controladas (service_role), ainda não criadas neste bloco.';

-- Índices recomendados explicitamente para esta tabela (doc 03 §29).
create index idx_orders_customer_id on public.orders (customer_id);
create index idx_orders_order_status on public.orders (order_status);
create index idx_orders_expected_delivery_date on public.orders (expected_delivery_date);

-- Reaproveita a função utilitária criada no Bloco 0
-- (supabase/migrations/20260813025937_create_users_table.sql).
create trigger set_orders_updated_at
  before update on public.orders
  for each row
  execute function public.set_updated_at();

alter table public.orders enable row level security;

revoke all on public.orders from anon;
revoke all on public.orders from authenticated;
-- Somente leitura para authenticated: criação/edição/transição de status
-- deste pedido só existirá via Edge Functions com service_role, em
-- migrations futuras (create_order, update_order, change_order_status
-- etc.). Nenhum INSERT/UPDATE/DELETE é concedido aqui.
grant select on public.orders to authenticated;

create policy "Active users can view orders"
  on public.orders
  for select
  to authenticated
  using (public.is_active_user());
