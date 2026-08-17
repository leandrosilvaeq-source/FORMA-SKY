-- Bloco 1 — Clientes e Pedidos
-- Migration 18: public.accessories, public.packaging, public.product_accessories,
-- public.product_packaging
-- docs/03_MODELO_BANCO_DADOS.md §13.1 (accessories), §13.2 (packaging), §9.3 (composição)
--
-- Antecipação mínima e aprovada do Módulo 3 (Estoque e Inventário): as duas
-- tabelas mestre (accessories/packaging) são criadas agora com o schema
-- COMPLETO definido no doc 03, incluindo unit_cost/minimum_stock/current_stock
-- — decisão explícita de não criar uma versão reduzida para completar depois.
--
-- IMPORTANTE: esta migration NÃO implementa nenhum controle de estoque.
-- unit_cost/minimum_stock/current_stock existem só como colunas de schema;
-- nenhuma function/trigger desta migration lê, soma ou ajusta current_stock.
-- stock_movements, stock_reservations, inventories e inventory_items
-- continuam fora do escopo do Bloco 1 — pertencem ao Módulo 3.
--
-- product_accessories/product_packaging são tabelas novas, sem equivalente
-- em nenhum documento — implementam a "composição padrão" de um produto de
-- Catálogo (quais acessórios/embalagens acompanham o produto, e em que
-- quantidade). Substituem o campo products.default_packaging_id do doc 03
-- §9.1 (1 embalagem, sem quantidade) — esse campo nunca chegou a ser criado
-- em nenhuma migration (ver comentário original em
-- 20260813205942_create_products_table.sql) e não será criado.

-- ---------------------------------------------------------------------------
-- accessories
-- ---------------------------------------------------------------------------
create table public.accessories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  material text,
  size text,
  variant text,

  -- Custo unitário: não é central ao cadastro mestre (ao contrário de
  -- products.default_price) — pode ser preenchido depois. Nullable, sem
  -- default.
  unit_cost numeric(10, 2) check (unit_cost is null or unit_cost >= 0),

  -- Limiar de alerta de estoque baixo (uso futuro do Módulo 6/3) — nullable,
  -- sem default, sem nenhuma automação associada nesta migration.
  minimum_stock integer check (minimum_stock is null or minimum_stock >= 0),

  -- Contagem física. not null default 0 (uma contagem sempre tem um valor,
  -- "0" é honesto para "nada registrado ainda"; diferente de unit_cost, que
  -- é genuinamente desconhecido quando nulo). Nenhuma function desta
  -- migration incrementa/decrementa esta coluna — permanece em 0 até o
  -- Módulo 3 implementar stock_movements.
  current_stock integer not null default 0 check (current_stock >= 0),

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.accessories is
  'Cadastro mestre de acessórios (docs/03_MODELO_BANCO_DADOS.md §13.1), antecipado do Módulo 3 para permitir a composição padrão de produtos (Módulo 1). Controle de estoque (movimentação/reserva/consumo/baixa) não implementado nesta etapa.';

comment on column public.accessories.current_stock is
  'Contagem física do acessório. Sem automação nesta etapa: nenhuma function/trigger atualiza este valor. UPDATE direto desta coluna não é concedido a authenticated (reservado para a função controlada que o Módulo 3 criará).';

create trigger set_accessories_updated_at
  before update on public.accessories
  for each row
  execute function public.set_updated_at();

alter table public.accessories enable row level security;

revoke all on public.accessories from anon;
revoke all on public.accessories from authenticated;
-- Sem DELETE: inativação lógica via is_active, nunca exclusão física.
grant select, insert on public.accessories to authenticated;

-- UPDATE restrito por coluna: current_stock fica de fora, mesmo padrão já
-- usado em public.products para default_price (Migration 5) — reserva a
-- coluna para uma função controlada futura (Módulo 3), evitando que
-- authenticated se acostume a escrever nela direto agora.
grant update (
  name, material, size, variant, unit_cost, minimum_stock, is_active
) on public.accessories to authenticated;

create policy "Active users can view accessories"
  on public.accessories
  for select
  to authenticated
  using (public.is_active_user());

create policy "Active users can create accessories"
  on public.accessories
  for insert
  to authenticated
  with check (public.is_active_user());

create policy "Active users can update accessories"
  on public.accessories
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());

-- ---------------------------------------------------------------------------
-- packaging
-- ---------------------------------------------------------------------------
create table public.packaging (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  material text,
  size text,
  variant text,
  unit_cost numeric(10, 2) check (unit_cost is null or unit_cost >= 0),
  minimum_stock integer check (minimum_stock is null or minimum_stock >= 0),
  current_stock integer not null default 0 check (current_stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.packaging is
  'Cadastro mestre de embalagens (docs/03_MODELO_BANCO_DADOS.md §13.2), antecipado do Módulo 3 para permitir a composição padrão de produtos (Módulo 1). Controle de estoque não implementado nesta etapa — mesmas ressalvas de public.accessories.';

comment on column public.packaging.current_stock is
  'Contagem física da embalagem. Sem automação nesta etapa — ver comentário equivalente em public.accessories.current_stock.';

create trigger set_packaging_updated_at
  before update on public.packaging
  for each row
  execute function public.set_updated_at();

alter table public.packaging enable row level security;

revoke all on public.packaging from anon;
revoke all on public.packaging from authenticated;
grant select, insert on public.packaging to authenticated;

grant update (
  name, material, size, variant, unit_cost, minimum_stock, is_active
) on public.packaging to authenticated;

create policy "Active users can view packaging"
  on public.packaging
  for select
  to authenticated
  using (public.is_active_user());

create policy "Active users can create packaging"
  on public.packaging
  for insert
  to authenticated
  with check (public.is_active_user());

create policy "Active users can update packaging"
  on public.packaging
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());

-- ---------------------------------------------------------------------------
-- product_accessories — composição padrão (acessórios) de um produto
-- ---------------------------------------------------------------------------
-- Sem updated_at: uma linha nunca é editada in-place — "alterar a
-- composição" sempre substitui o conjunto inteiro (delete + insert) via
-- set_product_composition (próxima migration), nunca um UPDATE de
-- quantity numa linha existente. Mesmo raciocínio já usado em
-- product_price_history para justificar a ausência de updated_at.
create table public.product_accessories (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT: mesmo padrão de 100% das FKs do Bloco 1 — nenhuma
  -- tabela permite exclusão física mesmo (products/accessories só têm
  -- is_active=false), RESTRICT é puramente defensivo.
  product_id uuid not null references public.products (id) on delete restrict,
  accessory_id uuid not null references public.accessories (id) on delete restrict,

  -- Unidades discretas (ímã, parafuso, chaveiro) — nunca fração, ao
  -- contrário de filamento (gramas).
  quantity integer not null check (quantity > 0),

  created_at timestamptz not null default now(),

  -- Impede duas linhas para o mesmo acessório no mesmo produto — quantidade
  -- maior é só um número maior na mesma linha, nunca duas linhas.
  unique (product_id, accessory_id)
);

comment on table public.product_accessories is
  'Composição padrão (acessórios) de um produto de Catálogo — "o que acompanha esse produto por padrão", nunca um ledger de estoque. Escrita só via set_product_composition (próxima migration): substitui o conjunto inteiro atomicamente. Nenhuma automação de reserva/consumo lê esta tabela nesta etapa.';

create index idx_product_accessories_product_id
  on public.product_accessories (product_id);

alter table public.product_accessories enable row level security;

revoke all on public.product_accessories from anon;
revoke all on public.product_accessories from authenticated;
-- Só leitura direta: escrita exclusivamente via set_product_composition
-- (security definer, service_role) — mesmo padrão de product_price_history.
grant select on public.product_accessories to authenticated;

create policy "Active users can view product accessories"
  on public.product_accessories
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- product_packaging — composição padrão (embalagens) de um produto
-- ---------------------------------------------------------------------------
create table public.product_packaging (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  packaging_id uuid not null references public.packaging (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (product_id, packaging_id)
);

comment on table public.product_packaging is
  'Composição padrão (embalagens) de um produto de Catálogo — mesmas ressalvas de public.product_accessories.';

create index idx_product_packaging_product_id
  on public.product_packaging (product_id);

alter table public.product_packaging enable row level security;

revoke all on public.product_packaging from anon;
revoke all on public.product_packaging from authenticated;
grant select on public.product_packaging to authenticated;

create policy "Active users can view product packaging"
  on public.product_packaging
  for select
  to authenticated
  using (public.is_active_user());
