-- Bloco 1 — Clientes e Pedidos
-- Migration 8/16: public.order_items
-- docs/03_MODELO_BANCO_DADOS.md §6.2, decisão do plano final (customization_data)
--
-- Itens do pedido. custom_item_details, spot_item_details e approvals
-- (Migrations 9-10) ainda não são criadas. material_id (dependente de
-- filament_types, Bloco 3) não é criado nesta migration. Nenhuma função de
-- recálculo financeiro é criada aqui — fica para a Migration 14.

create table public.order_items (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT (não CASCADE): um pedido é registro de negócio;
  -- orders já não concede DELETE a authenticated (só as funções controladas
  -- futuras poderão escrever nela), então uma exclusão física de order
  -- só viria de operação administrativa direta no banco. RESTRICT garante
  -- que essa operação não apague silenciosamente um pedido que ainda tem
  -- itens — preservando o histórico completo do pedido.
  order_id uuid not null references public.orders (id) on delete restrict,

  item_type text not null check (item_type in ('CUSTOM', 'SPOT', 'CATALOG')),

  -- ON DELETE RESTRICT: produtos usam inativação lógica (is_active=false) e
  -- já não concedem DELETE físico a authenticated (Migration 5). Uma
  -- exclusão física de product só viria de operação administrativa direta
  -- no banco. SET NULL foi descartado porque, para um item CATALOG, a
  -- constraint abaixo exige product_id not null — um SET NULL automático
  -- violaria essa constraint e a operação falharia de qualquer forma, só
  -- que de modo menos explícito. RESTRICT deixa claro, no momento da
  -- tentativa de exclusão, que o produto ainda está referenciado por
  -- pedidos históricos que precisam continuar preservados (requisito 16) —
  -- a alternativa correta é inativar o produto, não excluí-lo.
  product_id uuid references public.products (id) on delete restrict,

  item_name text not null,
  description text,

  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  personalization_fee numeric(10, 2) not null default 0 check (personalization_fee >= 0),
  discount_value numeric(10, 2) not null default 0 check (discount_value >= 0),

  -- Coluna gerada e armazenada: calculada pelo próprio Postgres a partir das
  -- colunas desta mesma linha, sempre consistente, sem depender de trigger
  -- ou de código de aplicação lembrar de recalcular.
  total_price numeric(10, 2)
    generated always as (
      quantity * unit_price + personalization_fee - discount_value
    ) stored,

  color_description text,
  number_of_colors integer check (number_of_colors is null or number_of_colors > 0),

  customization_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(customization_data) = 'object'),

  expected_delivery_date date,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- CATALOG exige product_id; CUSTOM e SPOT exigem product_id nulo (não têm
  -- produto de Catálogo associado — seus detalhes vivem em
  -- custom_item_details/spot_item_details, ainda não criadas).
  constraint order_items_product_id_matches_item_type check (
    (item_type = 'CATALOG' and product_id is not null)
    or (item_type in ('CUSTOM', 'SPOT') and product_id is null)
  ),

  -- total_price não pode ser negativo. Como
  -- total_price = quantity*unit_price + personalization_fee - discount_value,
  -- esta única constraint cobre exatamente o requisito 10: o desconto do
  -- item não pode superar quantity*unit_price + personalization_fee.
  constraint order_items_total_price_non_negative check (total_price >= 0)
);

comment on table public.order_items is
  'Itens do pedido (docs/01_ESPECIFICACAO_FUNCIONAL.md §6, docs/03_MODELO_BANCO_DADOS.md §6.2). Tabela crítica: authenticated só tem SELECT — toda escrita ocorre por funções controladas (service_role), ainda não criadas. material_id (Bloco 3) será adicionado por ALTER TABLE futuro.';

comment on column public.order_items.total_price is
  'Gerada automaticamente: quantity*unit_price + personalization_fee - discount_value. Nunca escrita diretamente.';

create index idx_order_items_order_id on public.order_items (order_id);

-- Reaproveita a função utilitária criada no Bloco 0
-- (supabase/migrations/20260813025937_create_users_table.sql).
create trigger set_order_items_updated_at
  before update on public.order_items
  for each row
  execute function public.set_updated_at();

alter table public.order_items enable row level security;

revoke all on public.order_items from anon;
revoke all on public.order_items from authenticated;
-- Somente leitura para authenticated: criação/edição de itens só existirá
-- via Edge Functions com service_role, em migrations futuras
-- (add_order_item, update_order_item, remove_order_item etc.). Nenhum
-- INSERT/UPDATE/DELETE é concedido aqui.
grant select on public.order_items to authenticated;

create policy "Active users can view order items"
  on public.order_items
  for select
  to authenticated
  using (public.is_active_user());
