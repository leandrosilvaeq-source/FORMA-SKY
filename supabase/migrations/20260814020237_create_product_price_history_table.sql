-- Bloco 1 — Clientes e Pedidos
-- Migration 11/16: public.product_price_history
-- docs/03_MODELO_BANCO_DADOS.md §9.2
--
-- Histórico imutável de preços de Catálogo. Nenhuma outra tabela do Bloco 1
-- é criada nesta migration. A função update_product_price (única forma de
-- gravar aqui) ainda não é criada — fica para a Migration 15.

create table public.product_price_history (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT: products não concede DELETE a authenticated (só
  -- is_active=false é possível pela aplicação); uma exclusão física só
  -- viria de operação administrativa direta no banco. RESTRICT preserva o
  -- histórico de preços do produto.
  product_id uuid not null references public.products (id) on delete restrict,

  price numeric(10, 2) not null check (price >= 0),

  effective_from timestamptz not null,
  effective_to timestamptz,

  reason text,

  -- ON DELETE RESTRICT: preserva a rastreabilidade de quem alterou o preço.
  -- Usuários só são inativados, nunca apagados (trigger do Bloco 0).
  created_by uuid not null references public.users (id) on delete restrict,

  created_at timestamptz not null default now(),

  -- Se effective_to estiver preenchido, o período de vigência não pode ser
  -- invertido.
  constraint product_price_history_effective_period_valid
    check (effective_to is null or effective_to >= effective_from)
);

comment on table public.product_price_history is
  'Histórico imutável de preços de Catálogo (docs/01_ESPECIFICACAO_FUNCIONAL.md §29, docs/03_MODELO_BANCO_DADOS.md §9.2). Sem updated_at: um registro de histórico não é editado após criado, apenas um novo registro é inserido a cada alteração de preço. Escrita só via update_product_price (Migration 15).';

-- Sem trigger set_updated_at: não há coluna updated_at (requisito 9).

create index idx_product_price_history_product_id
  on public.product_price_history (product_id);

-- Índice composto para consulta histórica ordenada por vigência dentro de
-- um mesmo produto (ex.: "qual era o preço vigente em uma data X").
create index idx_product_price_history_product_id_effective_from
  on public.product_price_history (product_id, effective_from);

-- Índice único parcial: garante no máximo uma linha com effective_to NULL
-- (preço atualmente vigente) por produto. Duas linhas "atuais" simultâneas
-- para o mesmo product_id violam essa unicidade.
create unique index idx_product_price_history_one_current
  on public.product_price_history (product_id)
  where effective_to is null;

alter table public.product_price_history enable row level security;

revoke all on public.product_price_history from anon;
revoke all on public.product_price_history from authenticated;
-- Somente leitura para authenticated: a única forma de escrita é a função
-- controlada update_product_price (service_role, Migration 15). Nenhum
-- INSERT/UPDATE/DELETE é concedido aqui.
grant select on public.product_price_history to authenticated;

create policy "Active users can view product price history"
  on public.product_price_history
  for select
  to authenticated
  using (public.is_active_user());
