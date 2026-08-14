-- Bloco 1 — Clientes e Pedidos
-- Migration 12/16: public.payments
-- docs/03_MODELO_BANCO_DADOS.md §19.1, decisão do plano final do Bloco 1
--
-- Registro imutável de pagamentos. Nenhuma outra tabela do Bloco 1 é criada
-- nesta migration. Recálculo automático de orders.payment_status,
-- payment_status_history e a função register_payment ainda não existem —
-- ficam para migrations futuras já planejadas (requisito 16).

create table public.payments (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT: orders não concede DELETE a authenticated; uma
  -- exclusão física só viria de operação administrativa direta no banco.
  -- RESTRICT preserva o histórico financeiro do pedido.
  order_id uuid not null references public.orders (id) on delete restrict,

  payment_method text not null
    check (payment_method in ('PIX', 'DINHEIRO', 'CARTAO')),

  amount numeric(10, 2) not null check (amount <> 0),

  payment_type text not null
    check (payment_type in ('SINAL', 'FINAL', 'INTEGRAL', 'AJUSTE')),

  paid_at timestamptz not null,

  notes text,

  -- ON DELETE RESTRICT: preserva a rastreabilidade de quem registrou o
  -- pagamento. Usuários só são inativados, nunca apagados (trigger do
  -- Bloco 0).
  created_by uuid not null references public.users (id) on delete restrict,

  created_at timestamptz not null default now(),

  -- Fora de AJUSTE, todo pagamento deve ser positivo (amount <> 0 já exige
  -- diferente de zero; aqui reforça que só AJUSTE pode ser negativo).
  -- Também implementa o requisito 8 "se amount < 0, payment_type deve ser
  -- AJUSTE": se amount < 0 e payment_type <> 'AJUSTE', esta constraint já
  -- falha (nenhuma das duas condições é satisfeita).
  constraint payments_amount_type_consistency
    check (payment_type = 'AJUSTE' or amount > 0),

  -- Ajuste negativo exige justificativa: notes obrigatório e não vazio
  -- (depois de remover espaços em branco) sempre que amount < 0.
  constraint payments_negative_adjustment_requires_notes
    check (amount >= 0 or (notes is not null and length(btrim(notes)) > 0))
);

comment on table public.payments is
  'Registro imutável de pagamentos (docs/01_ESPECIFICACAO_FUNCIONAL.md §8, docs/03_MODELO_BANCO_DADOS.md §19.1). Fonte oficial dos pagamentos. Sem updated_at: nenhuma correção é feita por edição — um lançamento AJUSTE (possivelmente negativo) é registrado à parte, preservando o histórico completo. Escrita só via register_payment (migration futura).';

-- Sem trigger set_updated_at: não há coluna updated_at (requisito 12).

create index idx_payments_order_id on public.payments (order_id);
create index idx_payments_order_id_paid_at on public.payments (order_id, paid_at);

alter table public.payments enable row level security;

revoke all on public.payments from anon;
revoke all on public.payments from authenticated;
-- Somente leitura para authenticated: a única forma de escrita é a função
-- controlada register_payment (service_role, migration futura). Nenhum
-- INSERT/UPDATE/DELETE é concedido aqui — correções futuras só por novo
-- lançamento AJUSTE, nunca por edição ou exclusão de um pagamento existente
-- (requisito 13).
grant select on public.payments to authenticated;

create policy "Active users can view payments"
  on public.payments
  for select
  to authenticated
  using (public.is_active_user());
