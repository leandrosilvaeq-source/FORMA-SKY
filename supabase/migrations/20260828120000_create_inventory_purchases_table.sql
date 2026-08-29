-- Bloco 2 — Módulo 3 (Estoque e Inventário), Incremento 5: fluxo
-- centralizado de Compras (Filamentos/Acessórios/Embalagens), pedido do
-- usuário em 2026-08-28, após o MVP manual de filamentos ter sido aprovado
-- (ver docs/05_ROADMAP_MODULOS.md).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada, na branch
-- feature/inventory-operations). Aplicar exige autorização explícita
-- separada, fora do escopo desta entrada.
--
-- ESCOPO DESTA MIGRATION: só o schema de public.inventory_purchases (ledger
-- financeiro auditável de uma compra) + RLS. A RPC que efetivamente grava
-- compras (register_inventory_purchase) vive na PRÓXIMA migration
-- (20260828121000), porque ela precisa, para a categoria FILAMENT, gravar
-- purchase_id/initial_gross_weight_grams em filament_spools — colunas que
-- essa próxima migration adiciona. Dividir em duas migrations evita
-- qualquer forward-reference dentro desta.
--
-- DECISÕES DE MODELAGEM:
--   - Uma linha por operação de compra (uma categoria, um item, N unidades)
--     — nunca uma tabela purchase_items separada: o próprio pedido desta
--     rodada descreve "o formulário atual registra uma categoria/item por
--     operação", e não há benefício real em normalizar algo que hoje é
--     sempre 1:1. Para FILAMENT, os N rolos criados por uma compra já
--     carregam purchase_id (próxima migration) — isso já é o "detalhe da
--     compra" sem precisar de uma tabela extra.
--   - category funciona como o discriminador polimórfico de item_id (FILAMENT
--     -> filament_types.id; ACCESSORY -> accessories.id; PACKAGING ->
--     packaging.id) — mesmo padrão sem FK já usado por
--     stock_movements.item_type/item_id (20260827090000), pelo mesmo motivo
--     (uma FK condicional não é representável). register_inventory_purchase
--     (próxima migration) sempre confirma a existência real do item antes de
--     gravar.
--   - total_value é GENERATED ALWAYS AS (item_value + freight_value) — a
--     regra "valor total = valor dos itens + frete" fica garantida pelo
--     próprio Postgres, nunca só por validação de aplicação (nem a RPC nem
--     a Edge Function podem inserir um total_value divergente por engano,
--     porque a coluna rejeita valor explícito).
--   - occurred_at (quando a compra de fato aconteceu, retroativo permitido)
--     é distinto de created_at (instante real do INSERT) — mesma distinção
--     já usada em stock_movements/filament_movements/payments.paid_at.
--   - Ledger imutável: sem updated_at, sem UPDATE/DELETE concedido a
--     nenhuma role de sessão (nem authenticated nem anon) — "registro de
--     compra não deve ser editado ou apagado silenciosamente" (requisito
--     explícito do pedido). Escrita exclusiva via register_inventory_purchase
--     (security definer, service_role, próxima migration).
--   - Sem fornecedor, nota fiscal ou forma de pagamento — explicitamente
--     fora de escopo neste incremento (requisito do pedido). notes existe só
--     para observações técnicas livres.
create table public.inventory_purchases (
  id uuid primary key default gen_random_uuid(),

  category text not null check (category in ('FILAMENT', 'ACCESSORY', 'PACKAGING')),

  -- Sem foreign key (polimórfico: aponta para filament_types.id,
  -- accessories.id ou packaging.id conforme category) — ver nota de
  -- modelagem acima. register_inventory_purchase confirma a existência real
  -- do item (ou cria o filament_type, para FILAMENT) antes de gravar esta
  -- linha.
  item_id uuid not null,

  -- Número de rolos (FILAMENT) ou unidades (ACCESSORY/PACKAGING) compradas
  -- nesta operação — sempre inteiro positivo, nunca fração (rolos/unidades
  -- são sempre discretos, ao contrário de peso de filamento).
  quantity integer not null check (quantity > 0),

  -- "Valor dos itens": total pago pelos itens em si, sem frete — nunca um
  -- preço unitário (o pedido pede explicitamente o total, custo médio por
  -- unidade é derivado só na exibição, nunca armazenado).
  item_value numeric(10, 2) not null check (item_value >= 0),
  freight_value numeric(10, 2) not null default 0 check (freight_value >= 0),
  total_value numeric(10, 2) generated always as (item_value + freight_value) stored,

  -- "Data e hora do registro" (quando a compra de fato aconteceu, negócio) —
  -- distinta de created_at (instante real do INSERT). Pode ser retroativa
  -- (ex.: lançar uma compra recebida ontem).
  occurred_at timestamptz not null default now(),

  notes text,

  -- Proteção contra duplo envio/retry — mesmo padrão de
  -- stock_movements.idempotency_key/filament_movements.idempotency_key.
  idempotency_key text,

  -- ON DELETE RESTRICT: preserva a autoria mesmo que o usuário seja
  -- inativado depois — mesmo padrão de created_by em toda tabela do Bloco 1.
  created_by uuid not null references public.users (id) on delete restrict,

  created_at timestamptz not null default now()

  -- Sem updated_at: ledger imutável, nunca editado após criado — mesmo
  -- padrão de stock_movements/filament_movements/payments.
);

comment on table public.inventory_purchases is
  'Ledger financeiro auditável de compras de estoque (Módulo 3, Incremento 5) — Filamentos/Acessórios/Embalagens, uma linha por operação de compra (uma categoria, um item, N unidades). category+item_id é polimórfico (FILAMENT->filament_types.id, ACCESSORY->accessories.id, PACKAGING->packaging.id), sem FK pelo mesmo motivo de stock_movements.item_type/item_id. total_value é sempre item_value+freight_value (coluna gerada, nunca inserível diretamente). Imutável: nenhum UPDATE/DELETE concedido a nenhuma role de sessão — escrita exclusiva via register_inventory_purchase (security definer, service_role, migration 20260828121000). Sem fornecedor/nota fiscal/forma de pagamento nesta etapa (fora de escopo); sem integração com o módulo financeiro.';

comment on column public.inventory_purchases.item_id is
  'Sem foreign key (campo polimórfico, resolvido conforme category) — register_inventory_purchase confirma a existência real do item (ou cria o filament_type, para FILAMENT, a partir de material+fabricante+acabamento+cor) antes de gravar esta linha.';

comment on column public.inventory_purchases.total_value is
  'Gerado pelo próprio Postgres como item_value + freight_value — nunca aceita um valor explícito no INSERT, garantindo a invariante "total = itens + frete" por construção.';

comment on column public.inventory_purchases.occurred_at is
  'Data/hora "de negócio" da compra (pode ser retroativa) — distinta de created_at (instante real do INSERT), mesma distinção de stock_movements.occurred_at/payments.paid_at.';

-- Consulta por item (histórico futuro de compras de um filament_type/
-- accessory/packaging específico, mais recente primeiro) — barato e óbvio,
-- criado desde já mesmo sem uma tela de histórico dedicada nesta rodada
-- (requisito: "preparar referências para futura consulta de histórico").
create index idx_inventory_purchases_item
  on public.inventory_purchases (category, item_id, occurred_at desc);

create unique index ux_inventory_purchases_idempotency_key
  on public.inventory_purchases (idempotency_key)
  where idempotency_key is not null;

alter table public.inventory_purchases enable row level security;

revoke all on public.inventory_purchases from anon;
revoke all on public.inventory_purchases from authenticated;
-- Somente leitura para authenticated — nenhum INSERT/UPDATE/DELETE
-- concedido a nenhuma role de sessão. A única escrita possível é via
-- register_inventory_purchase (security definer, service_role, próxima
-- migration), mesmo padrão de stock_movements/filament_movements.
grant select on public.inventory_purchases to authenticated;

create policy "Active users can view inventory purchases"
  on public.inventory_purchases
  for select
  to authenticated
  using (public.is_active_user());
