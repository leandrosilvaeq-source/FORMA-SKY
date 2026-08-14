-- Bloco 1 — Clientes e Pedidos
-- Migration 13/16: public.order_status_history, public.payment_status_history
-- decisão do plano final do Bloco 1 (auditoria de status exigida por
-- docs/02_ESPECIFICACAO_TECNICA.md §13, não modelada em docs/03)
--
-- Histórico imutável de transições de order_status e payment_status.
-- Nenhuma outra tabela do Bloco 1 é criada nesta migration. Nenhuma função
-- de mudança de status (change_order_status, register_payment etc.) é
-- criada aqui — fica para migrations futuras.

-- ---------------------------------------------------------------------------
-- order_status_history
-- ---------------------------------------------------------------------------
create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT: orders não concede DELETE a authenticated; uma
  -- exclusão física só viria de operação administrativa direta no banco.
  -- RESTRICT preserva o histórico de status do pedido.
  order_id uuid not null references public.orders (id) on delete restrict,

  -- Nullable: o primeiro registro de um pedido não tem "de onde veio".
  from_status text
    check (from_status is null or from_status in (
      'QUOTE', 'WAITING_APPROVAL', 'APPROVED', 'IN_PRODUCTION_QUEUE',
      'IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED'
    )),

  to_status text not null
    check (to_status in (
      'QUOTE', 'WAITING_APPROVAL', 'APPROVED', 'IN_PRODUCTION_QUEUE',
      'IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED'
    )),

  changed_at timestamptz not null default now(),

  -- ON DELETE RESTRICT: preserva a rastreabilidade de quem mudou o status.
  -- Usuários só são inativados, nunca apagados (trigger do Bloco 0).
  changed_by uuid not null references public.users (id) on delete restrict,

  reason text,

  -- Uma transição real muda de estado; from_status = to_status não é uma
  -- transição válida (só se aplica quando from_status está preenchido — o
  -- primeiro registro, com from_status NULL, não é afetado por esta
  -- constraint).
  constraint order_status_history_from_differs_to
    check (from_status is null or from_status <> to_status)
);

comment on table public.order_status_history is
  'Histórico imutável de transições de orders.order_status (docs/02_ESPECIFICACAO_TECNICA.md §13). Fonte oficial de auditoria de status operacional. Sem updated_at: um registro histórico não é editado após criado. Escrita só via funções controladas (change_order_status etc.), ainda não criadas.';

-- Sem trigger set_updated_at: não há coluna updated_at.

create index idx_order_status_history_order_id_changed_at
  on public.order_status_history (order_id, changed_at);

alter table public.order_status_history enable row level security;

revoke all on public.order_status_history from anon;
revoke all on public.order_status_history from authenticated;
-- Somente leitura para authenticated: a única forma de escrita é uma
-- função controlada futura (service_role). Nenhum INSERT/UPDATE/DELETE é
-- concedido aqui.
grant select on public.order_status_history to authenticated;

create policy "Active users can view order status history"
  on public.order_status_history
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- payment_status_history
-- ---------------------------------------------------------------------------
create table public.payment_status_history (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT: mesmo raciocínio de order_status_history.order_id
  -- acima — preserva o histórico financeiro do pedido.
  order_id uuid not null references public.orders (id) on delete restrict,

  -- Nullable: o primeiro registro de um pedido não tem "de onde veio".
  from_status text
    check (from_status is null or from_status in (
      'WAITING_PAYMENT', 'DEPOSIT_RECEIVED', 'PAID'
    )),

  to_status text not null
    check (to_status in ('WAITING_PAYMENT', 'DEPOSIT_RECEIVED', 'PAID')),

  changed_at timestamptz not null default now(),

  -- ON DELETE RESTRICT: preserva a rastreabilidade de quem mudou o status
  -- (na prática, o cálculo automático de payment_status — ver Migration 14
  -- — mas o registro de "quem" continua exigido). Usuários só são
  -- inativados, nunca apagados.
  changed_by uuid not null references public.users (id) on delete restrict,

  reason text,

  -- Mesma regra de order_status_history: from_status = to_status não é uma
  -- transição válida quando from_status está preenchido.
  constraint payment_status_history_from_differs_to
    check (from_status is null or from_status <> to_status)
);

comment on table public.payment_status_history is
  'Histórico imutável de transições de orders.payment_status (docs/02_ESPECIFICACAO_TECNICA.md §13). Fonte oficial de auditoria de status financeiro. Sem updated_at: um registro histórico não é editado após criado. Escrita só via funções controladas (register_payment, recalculate_order_financials etc.), ainda não criadas.';

-- Sem trigger set_updated_at: não há coluna updated_at.

create index idx_payment_status_history_order_id_changed_at
  on public.payment_status_history (order_id, changed_at);

alter table public.payment_status_history enable row level security;

revoke all on public.payment_status_history from anon;
revoke all on public.payment_status_history from authenticated;
grant select on public.payment_status_history to authenticated;

create policy "Active users can view payment status history"
  on public.payment_status_history
  for select
  to authenticated
  using (public.is_active_user());
