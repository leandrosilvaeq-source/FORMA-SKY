-- Bloco 1 — Clientes e Pedidos
-- Migration 5/16: public.products
-- docs/03_MODELO_BANCO_DADOS.md §9.1
--
-- Produtos permanentes do Catálogo. Nenhuma outra tabela do Bloco 1 é criada
-- nesta migration. Por decisão do plano final do Bloco 1, os campos
-- dependentes de tabelas ainda inexistentes (default_material_id ->
-- filament_types, default_packaging_id -> packaging, ambos do Bloco 3) NÃO
-- são criados aqui; serão adicionados via ALTER TABLE quando esses módulos
-- forem implementados.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  description text,
  -- not null, sem default: preço é central ao cadastro de um produto de
  -- Catálogo (doc 01 §11) e deve ser sempre informado explicitamente no
  -- INSERT, nunca assumido implicitamente como 0.
  default_price numeric(10, 2) not null check (default_price >= 0),
  default_print_time_minutes integer check (default_print_time_minutes is null or default_print_time_minutes >= 0),
  default_weight_grams numeric(10, 2) check (default_weight_grams is null or default_weight_grams >= 0),
  units_per_plate integer check (units_per_plate is null or units_per_plate > 0),
  -- ON DELETE SET NULL (não RESTRICT, não CASCADE): default_file_id é uma
  -- referência substituível ("arquivo padrão atual" do produto), não um dado
  -- histórico que precise ser preservado a qualquer custo. Se um arquivo for
  -- fisicamente excluído no banco (files já não concede DELETE a
  -- authenticated — só uma operação administrativa direta chegaria a isso),
  -- o produto deve continuar existindo normalmente, apenas sem arquivo
  -- padrão associado. RESTRICT impediria a exclusão do arquivo enquanto
  -- referenciado; CASCADE apagaria o produto — nenhum dos dois é o
  -- comportamento desejado aqui.
  default_file_id uuid references public.files (id) on delete set null,
  allows_personalization boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.products is
  'Produtos de Catálogo (docs/01_ESPECIFICACAO_FUNCIONAL.md §11, docs/03_MODELO_BANCO_DADOS.md §9.1). default_price só pode ser alterado pela função controlada update_product_price (a ser criada), nunca diretamente por authenticated.';

comment on column public.products.default_price is
  'Preço padrão do produto. Alteração posterior só via função update_product_price (grava histórico em product_price_history). authenticated não tem privilégio de UPDATE nesta coluna.';

-- Reaproveita a função utilitária criada no Bloco 0
-- (supabase/migrations/20260813025937_create_users_table.sql).
create trigger set_products_updated_at
  before update on public.products
  for each row
  execute function public.set_updated_at();

alter table public.products enable row level security;

revoke all on public.products from anon;
revoke all on public.products from authenticated;
-- Sem DELETE: inativação lógica via is_active, nunca exclusão física.

-- INSERT irrestrito por coluna: default_price pode (e deve) ser informado na
-- criação do produto (requisito 7).
grant select, insert on public.products to authenticated;

-- UPDATE restrito por coluna: default_price fica de fora da lista. Tentar
-- incluí-lo no SET de um UPDATE falha com "permission denied for column
-- default_price" antes mesmo de a policy de RLS ser avaliada — mesmo padrão
-- já usado em public.users (Bloco 0) para a coluna name.
grant update (
  name,
  category,
  description,
  default_print_time_minutes,
  default_weight_grams,
  units_per_plate,
  default_file_id,
  allows_personalization,
  is_active
) on public.products to authenticated;

create policy "Active users can view products"
  on public.products
  for select
  to authenticated
  using (public.is_active_user());

create policy "Active users can create products"
  on public.products
  for insert
  to authenticated
  with check (public.is_active_user());

create policy "Active users can update products"
  on public.products
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());
