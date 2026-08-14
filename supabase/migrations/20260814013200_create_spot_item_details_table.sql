-- Bloco 1 — Clientes e Pedidos
-- Migration 10/16: public.spot_item_details
-- docs/03_MODELO_BANCO_DADOS.md §8.1
--
-- Detalhes exclusivos de item Spot. Nenhuma outra tabela do Bloco 1 é criada
-- nesta migration. Nenhuma automação de cronômetro/registro de tempo nem
-- regra de conversão para Catálogo é implementada aqui — só os campos e
-- constraints são preparados (requisitos 20 e 21).

create table public.spot_item_details (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT: order_items não concede DELETE a authenticated; uma
  -- exclusão física só viria de operação administrativa direta no banco.
  -- RESTRICT preserva os detalhes do item Spot associado.
  --
  -- NÃO é garantido por FK/CHECK que order_item_id referencie um item com
  -- item_type = 'SPOT': assim como em custom_item_details (Migration 9),
  -- constraints de tabela só enxergam colunas da própria linha e uma FK só
  -- valida igualdade contra a tabela referenciada — nenhum dos dois
  -- mecanismos consegue checar order_items.item_type no INSERT. Fica
  -- documentado como regra de negócio futura: a função que inserir aqui
  -- (ainda não criada) deve confirmar item_type = 'SPOT' antes de gravar.
  order_item_id uuid not null unique references public.order_items (id) on delete restrict,

  -- ON DELETE RESTRICT: model_sources não concede DELETE a authenticated;
  -- preserva o histórico de origem do modelo.
  model_source_id uuid references public.model_sources (id) on delete restrict,

  source_reference text,

  is_exclusive boolean not null default false,
  test_print_required boolean not null default false,
  test_print_completed boolean not null default false,

  search_time_status text not null default 'NOT_INFORMED'
    check (search_time_status in ('NOT_INFORMED', 'IN_PROGRESS', 'RECORDED')),

  search_minutes integer check (search_minutes is null or search_minutes >= 0),
  preparation_minutes integer check (preparation_minutes is null or preparation_minutes >= 0),

  market_reference_price numeric(10, 2)
    check (market_reference_price is null or market_reference_price >= 0),
  market_reference_source text,
  market_reference_date date,

  catalog_conversion_suggested boolean not null default false,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Não é possível test_print_completed = true quando test_print_required =
  -- false (não faz sentido ter concluído uma impressão teste que não era
  -- exigida) — mesmo padrão já usado em custom_item_details (Migration 9).
  constraint spot_item_details_test_print_consistency
    check (test_print_completed = false or test_print_required = true),

  -- search_time_status = RECORDED exige search_minutes preenchido: não faz
  -- sentido marcar o tempo como "registrado" sem o valor. IN_PROGRESS e
  -- NOT_INFORMED não exigem search_minutes (requisito 12) — nenhuma outra
  -- regra foi adicionada para preparation_minutes, conforme pedido.
  constraint spot_item_details_search_time_consistency
    check (search_time_status <> 'RECORDED' or search_minutes is not null)
);

comment on table public.spot_item_details is
  'Detalhes de item Spot (docs/01_ESPECIFICACAO_FUNCIONAL.md §10, docs/03_MODELO_BANCO_DADOS.md §8.1). order_item_id deve referenciar um order_item com item_type=SPOT — validado pela função de negócio, não pelo banco. catalog_conversion_suggested é só um sinalizador armazenado nesta migration, sem regra automática de conversão.';

create index idx_spot_item_details_model_source_id on public.spot_item_details (model_source_id);

-- Reaproveita a função utilitária criada no Bloco 0.
create trigger set_spot_item_details_updated_at
  before update on public.spot_item_details
  for each row
  execute function public.set_updated_at();

alter table public.spot_item_details enable row level security;

revoke all on public.spot_item_details from anon;
revoke all on public.spot_item_details from authenticated;
-- Somente leitura para authenticated: criação/edição só existirá via Edge
-- Functions com service_role, em migrations futuras. Nenhum
-- INSERT/UPDATE/DELETE é concedido aqui.
grant select on public.spot_item_details to authenticated;

create policy "Active users can view spot item details"
  on public.spot_item_details
  for select
  to authenticated
  using (public.is_active_user());
