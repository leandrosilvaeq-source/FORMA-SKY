-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- COMPRA MISTA unificada: uma única compra pode conter, no mesmo pedido,
-- linhas de Filamento, Acessório e Embalagem, com UM cabeçalho, UM frete
-- (rateado entre TODAS as linhas das três categorias) e UMA idempotency_key
-- (2026-09-06). Configuração aprovada pelo usuário nesta rodada.
--
-- Migration APPEND-ONLY — nenhuma migration já aplicada é editada. Nenhuma
-- linha existente é apagada nem alterada em valor. As três RPCs de compra já
-- validadas — register_inventory_purchase (20260828121000 / 20260904120000),
-- register_filament_purchase (20260904130000 / .140000 / .150000 /
-- 20260905160000) e register_accessory_purchase (20260906140000) — e todos
-- os seus grants/CHECKs permanecem INTOCADOS. As rotas /, /filament e
-- /accessory da Edge Function continuam funcionando. Toda compra/rolo/
-- movimento histórico continua legível exatamente como está.
--
-- IMPORTANTE — esta migration NÃO foi aplicada ao Supabase remoto nesta
-- rodada. Aplicar exige autorização explícita separada. A Edge Function
-- `inventory-purchases` ganha a rota nova nesta mesma rodada, mas TAMBÉM
-- NÃO é publicada aqui.
--
-- CONTEÚDO:
--   1. inventory_purchases.category ganha o valor 'MIXED' (CHECK estendido;
--      coluna continua NOT NULL). Cabeçalhos legados (FILAMENT/ACCESSORY/
--      PACKAGING) permanecem exatamente como estão.
--   2. inventory_purchases.purchase_channel ganha 'OUTRO_SITE' (menor ajuste
--      compatível — SITE/OUTRO legados preservados).
--   3. CHECKs seguras para MIXED: purchase_channel obrigatório;
--      supplier_name obrigatório e não vazio para OUTRO_SITE/PRESENCIAL,
--      NULL permitido para os canais padronizados. Triviais para toda linha
--      não-MIXED (implicação category <> 'MIXED' OR ...), então ADD
--      CONSTRAINT valida instantaneamente sem tocar dados legados.
--   4. inventory_purchase_packaging_items — espelho exato de
--      inventory_purchase_accessory_items (saldo/custo antes-depois, frete
--      rateado, total_value autoritativo, landed_total_value gerado,
--      unicidade, RLS SELECT-only). É o que finalmente torna
--      packaging.unit_cost CALCULADO (média ponderada móvel).
--   5. inventory_purchase_filament_items ganha freight_allocated
--      (numeric(12,2) NOT NULL DEFAULT 0 — legado fica 0, semântica
--      idêntica à de hoje, em que o frete de filamento nunca entrou no
--      custo do rolo), landed_total_value (gerado = total_value +
--      freight_allocated) e line_number (posição GLOBAL da linha na compra
--      mista; NULL para os itens criados por register_filament_purchase,
--      que não é tocado).
--   6. _mixed_allocate_freight_cents(numeric[], numeric) — INTERNA, zero
--      grants: rateio do frete único (maior resto, centavos inteiros,
--      determinístico, desempate por posição global). Helper próprio da
--      compra mista — register_accessory_purchase NÃO é refatorado.
--   7. _build_mixed_purchase_summary(uuid) — INTERNA, zero grants: jsonb de
--      retorno (cabeçalho + items[] em ORDEM GLOBAL por line_number; linhas
--      de Filamento trazem spool_ids).
--   8. register_mixed_inventory_purchase(...) — RPC única, SECURITY DEFINER,
--      search_path fixo, EXECUTE só service_role. Uma transação PL/pgSQL:
--      valida tudo antes de escrever; trava filament_types -> accessories ->
--      packaging em ordem ascendente por id; cria UM cabeçalho MIXED;
--      rateia o frete UMA vez sobre todas as linhas; cria os itens por
--      categoria (line_number = posição global); cria os rolos de filamento
--      e todos os movimentos PURCHASE; atualiza accessories.unit_cost e
--      packaging.unit_cost por média ponderada móvel. Qualquer exceção
--      desfaz TUDO — atomicidade por construção. Idempotente por
--      p_idempotency_key: o canônico inclui a ORDEM GLOBAL dos itens E a
--      data de negócio p_occurred_on (ver nota "ORDEM É SIGNIFICATIVA" abaixo).
--
-- DATA / FUSO: p_occurred_on é uma DATA de negócio (date, sem hora, sem
-- fuso). A RPC converte explicitamente para occurred_at ancorando o MEIO-DIA
-- em America/Sao_Paulo — assim a data-calendário exibida nunca "anda" um dia
-- por diferença de fuso do cliente/servidor (o meio-dia dá margem de ±12h
-- para qualquer TZ de exibição). filament_spools.received_at recebe a
-- própria p_occurred_on (coluna date, sem conversão).
--
-- IDEMPOTÊNCIA / ORDEM GLOBAL / DATA: ORDEM É SIGNIFICATIVA. O canônico do
-- payload preserva a ordem global das linhas (cada elemento carrega 'line' =
-- posição 1-based e o array é agregado NA ORDEM; a comparação jsonb de
-- arrays é ordenada). Portanto:
--   * mesma chave + mesmos itens NA MESMA ORDEM + mesma data/frete/canal/
--     complemento => retorno idempotente (a compra já gravada);
--   * mesma chave + itens REORDENADOS => IDEMPOTENCY_KEY_CONFLICT: (o
--     desempate do rateio de centavos depende da ordem global — reordenar
--     muda o resultado, logo é um payload diferente);
--   * mesma chave + data (p_occurred_on) diferente => IDEMPOTENCY_KEY_CONFLICT:.
--     DIFERENTE das três RPCs antigas (que deixam occurred_at de fora, pois
--     lá a data tem default now() e não é digitada): na compra MISTA a data
--     é um campo de negócio digitado e ESTÁVEL, parte da identidade da
--     compra — duas compras "iguais" em datas diferentes são compras
--     diferentes. As três RPCs antigas permanecem intocadas.
-- Testado em supabase/tests/mixed_inventory_purchase_test.sql (Seções 19 a 21).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. category ganha 'MIXED' (CHECK inline auto-nomeado
--    inventory_purchases_category_check). DROP + ADD reescreve só a
--    constraint, nunca os dados; toda linha existente já satisfaz a lista
--    ampliada.
-- ---------------------------------------------------------------------------
alter table public.inventory_purchases
  drop constraint inventory_purchases_category_check;

alter table public.inventory_purchases
  add constraint inventory_purchases_category_check
    check (category in ('FILAMENT', 'ACCESSORY', 'PACKAGING', 'MIXED'));

-- ---------------------------------------------------------------------------
-- 2. purchase_channel ganha 'OUTRO_SITE' — menor ajuste compatível. SITE e
--    OUTRO (legados, migration 20260904150000) permanecem aceitos: nenhum
--    registro nem valor antigo é invalidado.
-- ---------------------------------------------------------------------------
alter table public.inventory_purchases
  drop constraint inventory_purchases_purchase_channel_check;

alter table public.inventory_purchases
  add constraint inventory_purchases_purchase_channel_check
    check (
      purchase_channel is null
      or purchase_channel in (
        'MERCADO_LIVRE', 'SHOPEE', 'ALIEXPRESS', 'OUTRO_SITE', 'PRESENCIAL',
        -- legados preservados (register_filament_purchase / dados antigos):
        'SITE', 'OUTRO'
      )
    );

comment on column public.inventory_purchases.purchase_channel is
  'Canal/local onde a compra foi feita. MIXED (2026-09-06): obrigatório, um de MERCADO_LIVRE/SHOPEE/ALIEXPRESS/OUTRO_SITE/PRESENCIAL. FILAMENT multi-item (register_filament_purchase): obrigatório, um de MERCADO_LIVRE/ALIEXPRESS/SHOPEE/PRESENCIAL/SITE/OUTRO. NULL para toda compra ACCESSORY/PACKAGING de item único e para toda compra anterior a purchase_channel existir. OUTRO_SITE (2026-09-06) só é usado pelo fluxo MIXED; SITE/OUTRO são legados preservados. Nunca gravado em notes.';

-- ---------------------------------------------------------------------------
-- 3. CHECKs seguras para MIXED. A forma "category <> 'MIXED' OR <regra>"
--    torna a constraint verdadeira por vacuidade para toda linha legada
--    (nenhuma tem category='MIXED'), então ADD CONSTRAINT não reescreve nem
--    rejeita nada existente.
-- ---------------------------------------------------------------------------
alter table public.inventory_purchases
  add constraint inventory_purchases_mixed_channel_required
    check (category <> 'MIXED' or purchase_channel is not null);

alter table public.inventory_purchases
  add constraint inventory_purchases_mixed_supplier_rule
    check (
      category <> 'MIXED'
      or purchase_channel not in ('OUTRO_SITE', 'PRESENCIAL')
      or (supplier_name is not null and btrim(supplier_name) <> '')
    );

comment on constraint inventory_purchases_mixed_channel_required on public.inventory_purchases is
  'Compra MIXED (2026-09-06) exige purchase_channel. Vazia por vacuidade para todo cabeçalho legado (category <> MIXED).';
comment on constraint inventory_purchases_mixed_supplier_rule on public.inventory_purchases is
  'Compra MIXED com canal OUTRO_SITE (nome do site) ou PRESENCIAL (nome da loja) exige supplier_name não vazio; canais padronizados (Mercado Livre/Shopee/AliExpress) permitem supplier_name NULL. Vazia por vacuidade para todo cabeçalho legado.';

-- ---------------------------------------------------------------------------
-- 4. inventory_purchase_packaging_items — espelho de
--    inventory_purchase_accessory_items (20260906140000).
-- ---------------------------------------------------------------------------
create table public.inventory_purchase_packaging_items (
  id uuid primary key default gen_random_uuid(),

  purchase_id uuid not null references public.inventory_purchases (id) on delete restrict,

  -- Embalagem comprada nesta linha. FK real (a categoria é sempre PACKAGING
  -- aqui). ON DELETE RESTRICT: embalagem com histórico de compra nunca é
  -- excluída fisicamente (delete_packaging já bloqueia por
  -- PACKAGING_HAS_STOCK_HISTORY:).
  packaging_id uuid not null references public.packaging (id) on delete restrict,

  -- Posição GLOBAL da linha na compra mista (1-based, na ordem informada
  -- pelo usuário) — NÃO reinicia por categoria: se a 1a linha é um acessório
  -- e a 2a é uma embalagem, esta embalagem tem line_number = 2. Também é o
  -- desempate determinístico do rateio de frete (maior resto).
  line_number integer not null check (line_number > 0),

  quantity integer not null check (quantity > 0),

  -- VALOR TOTAL pago pelos itens desta linha, exatamente como informado —
  -- FONTE AUTORITATIVA. Nunca reconstruído como quantity × unit_cost.
  total_value numeric(12, 2) not null check (total_value > 0),

  -- Parcela do frete único da compra atribuída a esta linha (rateio
  -- proporcional a total_value sobre TODAS as linhas das três categorias,
  -- maior resto em centavos — ver a RPC). Σ freight_allocated de todas as
  -- linhas (as três tabelas) = inventory_purchases.freight_value.
  freight_allocated numeric(12, 2) not null check (freight_allocated >= 0),

  landed_total_value numeric(12, 2)
    generated always as (total_value + freight_allocated) stored,

  balance_before integer not null check (balance_before >= 0),
  balance_after integer not null check (balance_after >= 0),
  constraint inventory_purchase_packaging_items_balance_progression
    check (balance_after = balance_before + quantity),

  unit_cost_before numeric(10, 2) check (unit_cost_before is null or unit_cost_before >= 0),
  unit_cost_after numeric(10, 2) not null check (unit_cost_after >= 0),

  created_at timestamptz not null default now(),

  unique (purchase_id, packaging_id),
  unique (purchase_id, line_number)
);

comment on table public.inventory_purchase_packaging_items is
  'Itens de EMBALAGEM de uma compra mista (Módulo 3, 2026-09-06) — espelho de inventory_purchase_accessory_items. Uma embalagem + quantidade + total_value (valor pago pela linha, AUTORITATIVO) + freight_allocated (rateio proporcional do frete único sobre TODAS as linhas da compra, maior resto) + saldo e custo antes/depois. line_number é a posição GLOBAL da linha na compra (não reinicia por categoria). Sempre vinculado a um cabeçalho inventory_purchases com category=MIXED. landed_total_value é gerado (total_value + freight_allocated). Ledger imutável — nenhum UPDATE/DELETE concedido a nenhuma role de sessão; escrita exclusiva via register_mixed_inventory_purchase (security definer, service_role).';

comment on column public.inventory_purchase_packaging_items.total_value is
  'FONTE AUTORITATIVA do valor pago pela linha, exatamente como informado (2 casas). NUNCA reconstruído como quantity × unit_cost_after.';
comment on column public.inventory_purchase_packaging_items.line_number is
  'Posição GLOBAL da linha na compra mista (1-based, ordem informada pelo usuário) — inclusive quando as linhas anteriores são de outras categorias. Desempate do rateio de frete.';
comment on column public.inventory_purchase_packaging_items.unit_cost_after is
  'Custo unitário da embalagem após esta linha, por média ponderada móvel: se balance_before = 0 OU unit_cost_before IS NULL -> round(landed_total_value / quantity, 2) (a primeira compra define o custo, sem diluição); senão -> round((balance_before × unit_cost_before + landed_total_value) / (balance_before + quantity), 2). Também gravado em packaging.unit_cost na mesma transação.';

create index idx_inventory_purchase_packaging_items_purchase_id
  on public.inventory_purchase_packaging_items (purchase_id);

create index idx_inventory_purchase_packaging_items_packaging_id
  on public.inventory_purchase_packaging_items (packaging_id, created_at desc);

alter table public.inventory_purchase_packaging_items enable row level security;

revoke all on public.inventory_purchase_packaging_items from anon;
revoke all on public.inventory_purchase_packaging_items from authenticated;
grant select on public.inventory_purchase_packaging_items to authenticated;

create policy "Active users can view packaging purchase items"
  on public.inventory_purchase_packaging_items
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- 5. inventory_purchase_filament_items ganha freight_allocated /
--    landed_total_value / line_number. Colunas ADITIVAS; register_filament_
--    purchase NÃO é alterado (continua gravando itens sem line_number e com
--    freight_allocated = default 0). Uma coluna gerada STORED reescreve a
--    tabela uma vez — aceitável (poucas linhas). total_value continua
--    NOT NULL e AUTORITATIVO (20260905160000).
-- ---------------------------------------------------------------------------
alter table public.inventory_purchase_filament_items
  add column freight_allocated numeric(12, 2) not null default 0
    check (freight_allocated >= 0);

alter table public.inventory_purchase_filament_items
  add column landed_total_value numeric(12, 2)
    generated always as (total_value + freight_allocated) stored;

alter table public.inventory_purchase_filament_items
  add column line_number integer
    check (line_number is null or line_number > 0);

comment on column public.inventory_purchase_filament_items.freight_allocated is
  'Parcela do frete único da compra atribuída a esta linha de filamento (rateio proporcional a total_value sobre TODAS as linhas da compra mista, maior resto em centavos). 0 para todo item criado por register_filament_purchase (fluxo /filament preservado — o frete de filamento nunca entrou no custo do rolo nesse fluxo). Preenchido só por register_mixed_inventory_purchase.';
comment on column public.inventory_purchase_filament_items.landed_total_value is
  'Gerado pelo próprio Postgres como total_value + freight_allocated — custo "posto no estoque" da linha. Para filamento é o que define o custo por rolo COM frete: landed_total_value / quantity.';
comment on column public.inventory_purchase_filament_items.line_number is
  'Posição GLOBAL da linha na compra mista (1-based). NULL para todo item criado por register_filament_purchase (compra só de filamento — sem numeração global). Preenchido só por register_mixed_inventory_purchase.';

create unique index ux_inventory_purchase_filament_items_purchase_line
  on public.inventory_purchase_filament_items (purchase_id, line_number)
  where line_number is not null;

-- ---------------------------------------------------------------------------
-- 6. _mixed_allocate_freight_cents — INTERNA (zero grants). Rateio do frete
--    único proporcionalmente ao total de cada linha, em CENTAVOS INTEIROS
--    (numeric decimal exato, nunca float), método do MAIOR RESTO, desempate
--    por posição global ascendente. Garantias: Σ parcelas = frete
--    exatamente; nenhuma parcela negativa; frete 0 -> tudo 0; subtotal 0 ->
--    tudo 0 (defesa — a RPC já recusa total_value <= 0, então é
--    inalcançável na prática). Recebe/devolve reais (2 casas).
-- ---------------------------------------------------------------------------
create or replace function public._mixed_allocate_freight_cents(
  p_line_totals numeric[],
  p_freight numeric
)
returns numeric[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n integer := coalesce(array_length(p_line_totals, 1), 0);
  v_total_cents bigint[] := '{}';
  v_floor_cents bigint[] := '{}';
  v_rem_cents numeric[] := '{}';
  v_alloc numeric[] := '{}';
  v_bump bigint[] := '{}';
  v_subtotal_cents bigint := 0;
  v_freight_cents bigint;
  v_assigned bigint := 0;
  v_leftover bigint;
  i integer;
begin
  if v_n = 0 then
    return '{}';
  end if;

  for i in 1..v_n loop
    v_total_cents := v_total_cents || round(p_line_totals[i] * 100)::bigint;
  end loop;
  v_subtotal_cents := (select coalesce(sum(c), 0) from unnest(v_total_cents) c);
  v_freight_cents := round(coalesce(p_freight, 0) * 100)::bigint;

  if v_freight_cents = 0 or v_subtotal_cents = 0 then
    for i in 1..v_n loop
      v_alloc := v_alloc || 0::numeric;
    end loop;
    return v_alloc;
  end if;

  for i in 1..v_n loop
    v_floor_cents := v_floor_cents
      || div(v_freight_cents::numeric * v_total_cents[i]::numeric, v_subtotal_cents::numeric)::bigint;
    v_rem_cents := v_rem_cents
      || mod(v_freight_cents::numeric * v_total_cents[i]::numeric, v_subtotal_cents::numeric);
    v_assigned := v_assigned + v_floor_cents[i];
  end loop;

  v_leftover := v_freight_cents - v_assigned;  -- sempre em [0, v_n-1]

  if v_leftover > 0 then
    select array_agg(idx order by idx)
      into v_bump
    from (
      select idx
      from unnest(v_rem_cents) with ordinality as u(rem, idx)
      order by rem desc, idx asc
      limit v_leftover
    ) s;
  end if;

  for i in 1..v_n loop
    v_alloc := v_alloc
      || ((v_floor_cents[i] + (case when i = any(coalesce(v_bump, array[]::bigint[])) then 1 else 0 end))::numeric / 100);
  end loop;

  return v_alloc;
end;
$$;

comment on function public._mixed_allocate_freight_cents(numeric[], numeric) is
  'INTERNA (zero grants). Rateio do frete único de uma compra mista entre TODAS as linhas (as três categorias), proporcional a total_value, em centavos inteiros, método do maior resto, desempate por posição global ascendente. Σ parcelas = frete exatamente; nenhuma negativa; frete 0 -> tudo 0. Determinística.';

revoke execute on function public._mixed_allocate_freight_cents(numeric[], numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. _build_mixed_purchase_summary — INTERNA (zero grants). jsonb de retorno
--    (cabeçalho + items[] em ORDEM GLOBAL por line_number). Reaproveitado no
--    caminho normal e no retorno idempotente.
-- ---------------------------------------------------------------------------
create or replace function public._build_mixed_purchase_summary(p_purchase_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'purchase_id', p.id,
    'category', p.category,
    'occurred_at', p.occurred_at,
    'purchase_channel', p.purchase_channel,
    'supplier_name', p.supplier_name,
    'quantity', p.quantity,
    'subtotal_value', p.item_value,
    'freight_value', p.freight_value,
    'total_value', p.total_value,
    'created_at', p.created_at,
    'items', coalesce((
      select jsonb_agg(item order by (item ->> 'line_number')::integer)
      from (
        select jsonb_build_object(
          'category', 'FILAMENT',
          'line_number', fi.line_number,
          'filament_type_id', fi.filament_type_id,
          'manufacturer', fi.manufacturer,
          'nominal_weight_grams', fi.nominal_weight_grams,
          'quantity', fi.quantity,
          'unit_value', fi.unit_value,
          'total_value', fi.total_value,
          'freight_allocated', fi.freight_allocated,
          'landed_total_value', fi.landed_total_value,
          'spool_ids', (
            select coalesce(jsonb_agg(s.id order by s.code), '[]'::jsonb)
            from public.filament_spools s
            where s.purchase_item_id = fi.id
          )
        ) as item
        from public.inventory_purchase_filament_items fi
        where fi.purchase_id = p.id and fi.line_number is not null

        union all

        select jsonb_build_object(
          'category', 'ACCESSORY',
          'line_number', ai.line_number,
          'accessory_id', ai.accessory_id,
          'quantity', ai.quantity,
          'total_value', ai.total_value,
          'freight_allocated', ai.freight_allocated,
          'landed_total_value', ai.landed_total_value,
          'balance_before', ai.balance_before,
          'balance_after', ai.balance_after,
          'unit_cost_before', ai.unit_cost_before,
          'unit_cost_after', ai.unit_cost_after
        )
        from public.inventory_purchase_accessory_items ai
        where ai.purchase_id = p.id

        union all

        select jsonb_build_object(
          'category', 'PACKAGING',
          'line_number', pi.line_number,
          'packaging_id', pi.packaging_id,
          'quantity', pi.quantity,
          'total_value', pi.total_value,
          'freight_allocated', pi.freight_allocated,
          'landed_total_value', pi.landed_total_value,
          'balance_before', pi.balance_before,
          'balance_after', pi.balance_after,
          'unit_cost_before', pi.unit_cost_before,
          'unit_cost_after', pi.unit_cost_after
        )
        from public.inventory_purchase_packaging_items pi
        where pi.purchase_id = p.id
      ) all_items
    ), '[]'::jsonb)
  )
  from public.inventory_purchases p
  where p.id = p_purchase_id;
$$;

comment on function public._build_mixed_purchase_summary(uuid) is
  'INTERNA (zero grants). Monta o jsonb de retorno de register_mixed_inventory_purchase (cabeçalho + items[] em ORDEM GLOBAL por line_number, das três tabelas de item; linhas de Filamento trazem spool_ids). Somente leitura.';

revoke execute on function public._build_mixed_purchase_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. _mixed_purchase_items_canonical — INTERNA (zero grants). Reconstrói a
--    forma canônica dos itens de uma compra mista JÁ GRAVADA, na MESMA ordem
--    global (line_number) e no MESMO formato de v_incoming_canonical, para a
--    comparação de idempotência (pré-checagem e catch do unique_violation).
--    Definida ANTES de register_mixed_inventory_purchase, que a chama.
-- ---------------------------------------------------------------------------
create or replace function public._mixed_purchase_items_canonical(p_purchase_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by ln), '[]'::jsonb)
  from (
    select fi.line_number as ln, jsonb_build_object(
      'category', 'FILAMENT', 'line', fi.line_number,
      'filament_type_id', fi.filament_type_id,
      'manufacturer', fi.manufacturer,
      'nominal_weight_grams', round(fi.nominal_weight_grams, 2),
      'quantity', fi.quantity,
      'total_value', round(fi.total_value, 2)) as item
    from public.inventory_purchase_filament_items fi
    where fi.purchase_id = p_purchase_id and fi.line_number is not null

    union all

    select ai.line_number, jsonb_build_object(
      'category', 'ACCESSORY', 'line', ai.line_number,
      'accessory_id', ai.accessory_id,
      'quantity', ai.quantity,
      'total_value', round(ai.total_value, 2))
    from public.inventory_purchase_accessory_items ai
    where ai.purchase_id = p_purchase_id

    union all

    select pi.line_number, jsonb_build_object(
      'category', 'PACKAGING', 'line', pi.line_number,
      'packaging_id', pi.packaging_id,
      'quantity', pi.quantity,
      'total_value', round(pi.total_value, 2))
    from public.inventory_purchase_packaging_items pi
    where pi.purchase_id = p_purchase_id
  ) all_items;
$$;

comment on function public._mixed_purchase_items_canonical(uuid) is
  'INTERNA (zero grants). Itens de uma compra mista já gravada, em forma canônica na ORDEM GLOBAL (line_number) — mesmo formato que register_mixed_inventory_purchase monta do payload recebido, para comparar uma repetição de idempotency_key. Somente leitura.';

revoke execute on function public._mixed_purchase_items_canonical(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. register_mixed_inventory_purchase — RPC única da compra mista.
-- ---------------------------------------------------------------------------
create or replace function public.register_mixed_inventory_purchase(
  p_items jsonb,
  p_freight_value numeric,
  p_purchase_channel text,
  p_occurred_on date,
  p_changed_by uuid,
  p_supplier_name text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_freight numeric;
  v_channel text;
  v_supplier text;
  v_occurred_at timestamptz;
  v_reason text;
  v_channel_label text;

  v_elem jsonb;
  v_ord bigint;
  v_cat text;

  -- listas paralelas na ORDEM GLOBAL (índice = line_number)
  v_cats text[] := '{}';
  v_qtys integer[] := '{}';
  v_totals numeric[] := '{}';
  v_allocs numeric[] := '{}';
  -- filament
  v_ft_ids uuid[] := '{}';
  v_ft_manu text[] := '{}';
  v_ft_nominal numeric[] := '{}';
  -- accessory / packaging
  v_item_ids uuid[] := '{}';   -- accessory_id ou packaging_id conforme v_cats[i]

  v_seen_acc uuid[] := '{}';
  v_seen_pkg uuid[] := '{}';

  v_qty_num numeric;
  v_total numeric;

  v_n integer;
  v_total_quantity integer := 0;
  v_subtotal numeric := 0;

  v_sorted uuid[];
  v_one uuid;
  v_active boolean;

  v_incoming_canonical jsonb;
  v_existing public.inventory_purchases;
  v_purchase public.inventory_purchases;
  v_constraint text;

  v_bb integer;
  v_ucb numeric;
  v_uca numeric;
  v_landed numeric;
  v_unit_value numeric;
  v_purchase_item_id uuid;
  v_spool_id uuid;
  v_code text;
  v_nested_key text;
  i integer;
  j integer;
begin
  perform public.assert_active_user(p_changed_by);

  -- --- frete ---
  v_freight := coalesce(p_freight_value, 0);
  if v_freight < 0 then
    raise exception 'register_mixed_inventory_purchase: p_freight_value não pode ser negativo (recebido %)', p_freight_value;
  end if;
  if v_freight <> round(v_freight, 2) then
    raise exception 'register_mixed_inventory_purchase: p_freight_value deve ter no máximo 2 casas decimais (recebido %)', p_freight_value;
  end if;

  -- --- canal + complemento ---
  v_channel := btrim(coalesce(p_purchase_channel, ''));
  if v_channel not in ('MERCADO_LIVRE', 'SHOPEE', 'ALIEXPRESS', 'OUTRO_SITE', 'PRESENCIAL') then
    raise exception 'register_mixed_inventory_purchase: purchase_channel inválido: % (esperado MERCADO_LIVRE, SHOPEE, ALIEXPRESS, OUTRO_SITE ou PRESENCIAL)', p_purchase_channel;
  end if;

  v_supplier := nullif(btrim(coalesce(p_supplier_name, '')), '');
  if v_channel in ('OUTRO_SITE', 'PRESENCIAL') then
    if v_supplier is null then
      raise exception 'register_mixed_inventory_purchase: o canal % exige o complemento (nome do site / nome da loja) em p_supplier_name', v_channel;
    end if;
    if length(v_supplier) > 200 then
      raise exception 'register_mixed_inventory_purchase: p_supplier_name excede 200 caracteres';
    end if;
  else
    -- canal padronizado nunca carrega complemento
    v_supplier := null;
  end if;

  -- --- data de negócio -> occurred_at (meio-dia America/Sao_Paulo: a
  --     data-calendário nunca muda por fuso de exibição) ---
  if p_occurred_on is null then
    raise exception 'register_mixed_inventory_purchase: p_occurred_on é obrigatório (data da compra)';
  end if;
  v_occurred_at := (p_occurred_on + time '12:00') at time zone 'America/Sao_Paulo';

  -- --- itens: validação estrutural + acumulação (nenhuma escrita) ---
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'register_mixed_inventory_purchase: informe de 1 a 50 itens em p_items (lista JSON não vazia)';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'register_mixed_inventory_purchase: no máximo 50 itens por compra (recebido %)', jsonb_array_length(p_items);
  end if;

  for v_elem, v_ord in
    select value, ordinality from jsonb_array_elements(p_items) with ordinality
  loop
    v_cat := v_elem ->> 'category';
    if v_cat not in ('FILAMENT', 'ACCESSORY', 'PACKAGING') then
      raise exception 'register_mixed_inventory_purchase: linha % — category inválida: % (esperado FILAMENT, ACCESSORY ou PACKAGING)', v_ord, v_cat;
    end if;

    v_qty_num := nullif(v_elem ->> 'quantity', '')::numeric;
    if v_qty_num is null or v_qty_num <= 0 then
      raise exception 'register_mixed_inventory_purchase: linha % — quantity deve ser um inteiro positivo (recebido %)', v_ord, v_elem ->> 'quantity';
    end if;
    if v_qty_num <> trunc(v_qty_num) then
      raise exception 'register_mixed_inventory_purchase: linha % — quantity deve ser um número inteiro, sem casas decimais (recebido %)', v_ord, v_elem ->> 'quantity';
    end if;

    v_total := nullif(v_elem ->> 'total_value', '')::numeric;
    if v_total is null or v_total <= 0 then
      raise exception 'register_mixed_inventory_purchase: linha % — total_value deve ser um número maior que zero (recebido %)', v_ord, v_elem ->> 'total_value';
    end if;
    if v_total <> round(v_total, 2) then
      raise exception 'register_mixed_inventory_purchase: linha % — total_value deve ter no máximo 2 casas decimais (recebido %)', v_ord, v_elem ->> 'total_value';
    end if;

    v_cats := v_cats || v_cat;
    v_qtys := v_qtys || v_qty_num::integer;
    v_totals := v_totals || v_total;
    v_total_quantity := v_total_quantity + v_qty_num::integer;
    v_subtotal := v_subtotal + v_total;

    if v_cat = 'FILAMENT' then
      declare
        v_ftid uuid := nullif(v_elem ->> 'filament_type_id', '')::uuid;
        v_manu text := btrim(coalesce(v_elem ->> 'manufacturer', ''));
        v_nom numeric := nullif(v_elem ->> 'nominal_weight_grams', '')::numeric;
      begin
        if v_ftid is null then
          raise exception 'register_mixed_inventory_purchase: linha % (FILAMENT) — filament_type_id é obrigatório', v_ord;
        end if;
        if v_manu = '' then
          raise exception 'register_mixed_inventory_purchase: linha % (FILAMENT) — manufacturer (marca) não pode ser vazio', v_ord;
        end if;
        if v_nom is null or v_nom <= 0 then
          raise exception 'register_mixed_inventory_purchase: linha % (FILAMENT) — nominal_weight_grams deve ser um número positivo (recebido %)', v_ord, v_elem ->> 'nominal_weight_grams';
        end if;
        v_ft_ids := v_ft_ids || v_ftid;
        v_ft_manu := v_ft_manu || v_manu;
        v_ft_nominal := v_ft_nominal || v_nom;
        v_item_ids := v_item_ids || null::uuid;
      end;

    elsif v_cat = 'ACCESSORY' then
      declare
        v_aid uuid := nullif(v_elem ->> 'accessory_id', '')::uuid;
      begin
        if v_aid is null then
          raise exception 'register_mixed_inventory_purchase: linha % (ACCESSORY) — accessory_id é obrigatório', v_ord;
        end if;
        if v_aid = any(v_seen_acc) then
          raise exception 'register_mixed_inventory_purchase: acessório repetido em duas linhas (%) — cada acessório só pode aparecer uma vez na mesma compra', v_aid;
        end if;
        v_seen_acc := v_seen_acc || v_aid;
        v_item_ids := v_item_ids || v_aid;
        v_ft_ids := v_ft_ids || null::uuid;
        v_ft_manu := v_ft_manu || null::text;
        v_ft_nominal := v_ft_nominal || null::numeric;
      end;

    else -- PACKAGING
      declare
        v_pid uuid := nullif(v_elem ->> 'packaging_id', '')::uuid;
      begin
        if v_pid is null then
          raise exception 'register_mixed_inventory_purchase: linha % (PACKAGING) — packaging_id é obrigatório', v_ord;
        end if;
        if v_pid = any(v_seen_pkg) then
          raise exception 'register_mixed_inventory_purchase: embalagem repetida em duas linhas (%) — cada embalagem só pode aparecer uma vez na mesma compra', v_pid;
        end if;
        v_seen_pkg := v_seen_pkg || v_pid;
        v_item_ids := v_item_ids || v_pid;
        v_ft_ids := v_ft_ids || null::uuid;
        v_ft_manu := v_ft_manu || null::text;
        v_ft_nominal := v_ft_nominal || null::numeric;
      end;
    end if;
  end loop;

  v_n := array_length(v_cats, 1);

  -- --- rateio do frete: UMA vez, sobre TODAS as linhas, na ordem global ---
  v_allocs := public._mixed_allocate_freight_cents(v_totals, v_freight);

  -- --- forma canônica do payload (ORDEM GLOBAL preservada) ---
  v_incoming_canonical := (
    select coalesce(jsonb_agg(
      case
        when v_cats[g] = 'FILAMENT' then jsonb_build_object(
          'category', 'FILAMENT', 'line', g,
          'filament_type_id', v_ft_ids[g],
          'manufacturer', v_ft_manu[g],
          'nominal_weight_grams', round(v_ft_nominal[g], 2),
          'quantity', v_qtys[g],
          'total_value', round(v_totals[g], 2))
        when v_cats[g] = 'ACCESSORY' then jsonb_build_object(
          'category', 'ACCESSORY', 'line', g,
          'accessory_id', v_item_ids[g],
          'quantity', v_qtys[g],
          'total_value', round(v_totals[g], 2))
        else jsonb_build_object(
          'category', 'PACKAGING', 'line', g,
          'packaging_id', v_item_ids[g],
          'quantity', v_qtys[g],
          'total_value', round(v_totals[g], 2))
      end
      order by g), '[]'::jsonb)
    from generate_series(1, v_n) g
  );

  -- --- idempotência: checada antes de qualquer escrita. O canônico inclui a
  --     ORDEM GLOBAL dos itens E a data de negócio (p_occurred_on) — reordenar
  --     ou trocar a data => IDEMPOTENCY_KEY_CONFLICT: (ver nota no cabeçalho). ---
  if p_idempotency_key is not null then
    select * into v_existing from public.inventory_purchases where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.category = 'MIXED'
         and v_existing.freight_value = v_freight
         and v_existing.purchase_channel is not distinct from v_channel
         and v_existing.supplier_name is not distinct from v_supplier
         and (v_existing.occurred_at at time zone 'America/Sao_Paulo')::date = p_occurred_on
         and public._mixed_purchase_items_canonical(v_existing.id) = v_incoming_canonical
      then
        return public._build_mixed_purchase_summary(v_existing.id);
      else
        raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
      end if;
    end if;
  end if;

  -- --- locks em ordem DETERMINÍSTICA: filament_types, depois accessories,
  --     depois packaging — todos ascendente por id. Evita deadlock entre
  --     compras concorrentes com conjuntos que se cruzam e confirma
  --     existência + item ativo. ---
  v_sorted := (select array_agg(x order by x) from (select distinct unnest(v_ft_ids) as x) d where x is not null);
  if v_sorted is not null then
    foreach v_one in array v_sorted loop
      select is_active into v_active from public.filament_types where id = v_one for update;
      if not found then
        raise exception 'register_mixed_inventory_purchase: tipo de filamento de id % não encontrado', v_one;
      end if;
      if not v_active then
        raise exception 'INVENTORY_PURCHASE_ITEM_INACTIVE: tipo de filamento de id % está inativo — reative-o na aba Filamentos antes de comprar.', v_one;
      end if;
    end loop;
  end if;

  v_sorted := (select array_agg(x order by x) from (select distinct unnest(v_seen_acc) as x) d);
  if v_sorted is not null then
    foreach v_one in array v_sorted loop
      select is_active into v_active from public.accessories where id = v_one for update;
      if not found then
        raise exception 'register_mixed_inventory_purchase: acessório de id % não encontrado', v_one;
      end if;
      if not v_active then
        raise exception 'INVENTORY_PURCHASE_ITEM_INACTIVE: acessório de id % está inativo — reative-o na aba Acessórios antes de comprar.', v_one;
      end if;
    end loop;
  end if;

  v_sorted := (select array_agg(x order by x) from (select distinct unnest(v_seen_pkg) as x) d);
  if v_sorted is not null then
    foreach v_one in array v_sorted loop
      select is_active into v_active from public.packaging where id = v_one for update;
      if not found then
        raise exception 'register_mixed_inventory_purchase: embalagem de id % não encontrada', v_one;
      end if;
      if not v_active then
        raise exception 'INVENTORY_PURCHASE_ITEM_INACTIVE: embalagem de id % está inativa — reative-a na aba Embalagens antes de comprar.', v_one;
      end if;
    end loop;
  end if;

  -- --- motivo legível gravado em cada stock_movements.reason ---
  v_channel_label := case v_channel
    when 'MERCADO_LIVRE' then 'Mercado Livre'
    when 'SHOPEE' then 'Shopee'
    when 'ALIEXPRESS' then 'AliExpress'
    when 'OUTRO_SITE' then 'Outro Site'
    when 'PRESENCIAL' then 'Presencial'
  end;
  v_reason := 'Compra (' || v_channel_label || coalesce(' — ' || v_supplier, '') || ')';

  -- --- cabeçalho ÚNICO da compra mista. Captura a corrida de
  --     unique_violation na idempotency_key (duas chamadas simultâneas com a
  --     mesma chave, nenhuma vendo a outra ainda). ---
  begin
    insert into public.inventory_purchases (
      category, item_id, quantity, item_value, freight_value,
      occurred_at, notes, supplier_name, purchase_channel, idempotency_key, created_by
    ) values (
      'MIXED', null, v_total_quantity, v_subtotal, v_freight,
      v_occurred_at, null, v_supplier, v_channel, p_idempotency_key, p_changed_by
    )
    returning * into v_purchase;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'ux_inventory_purchases_idempotency_key' or p_idempotency_key is null then
      raise;
    end if;
    select * into v_existing from public.inventory_purchases where idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    if v_existing.category = 'MIXED'
       and v_existing.freight_value = v_freight
       and v_existing.purchase_channel is not distinct from v_channel
       and v_existing.supplier_name is not distinct from v_supplier
       and (v_existing.occurred_at at time zone 'America/Sao_Paulo')::date = p_occurred_on
       and public._mixed_purchase_items_canonical(v_existing.id) = v_incoming_canonical
    then
      return public._build_mixed_purchase_summary(v_existing.id);
    else
      raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
    end if;
  end;

  -- --- 2a passagem: materializa cada linha na ORDEM GLOBAL (i = line_number). ---
  for i in 1..v_n loop
    v_landed := v_totals[i] + v_allocs[i];
    v_nested_key := case when p_idempotency_key is not null
      then p_idempotency_key || ':L' || i::text else null end;

    if v_cats[i] = 'FILAMENT' then
      -- valor por rolo: derivado do total (round 2 casas) — mesmo critério
      -- de register_filament_purchase.
      v_unit_value := round(v_totals[i] / v_qtys[i], 2);

      insert into public.inventory_purchase_filament_items (
        purchase_id, filament_type_id, manufacturer, nominal_weight_grams,
        quantity, unit_value, total_value, freight_allocated, line_number
      ) values (
        v_purchase.id, v_ft_ids[i], v_ft_manu[i], v_ft_nominal[i],
        v_qtys[i], v_unit_value, v_totals[i], v_allocs[i], i
      )
      returning id into v_purchase_item_id;

      -- cria os N rolos (sem peso bruto individual, como um rolo manual) +
      -- uma entrada PURCHASE por rolo. received_at = a própria data de
      -- negócio (coluna date, sem fuso).
      for j in 1..v_qtys[i] loop
        v_code := public.next_filament_spool_code();
        insert into public.filament_spools (
          code, filament_type_id, nominal_weight_grams, purchase_id, purchase_item_id,
          received_at, status, is_active
        ) values (
          v_code, v_ft_ids[i], v_ft_nominal[i], v_purchase.id, v_purchase_item_id,
          p_occurred_on, 'LACRADO', true
        )
        returning id into v_spool_id;

        perform public.register_filament_movement(
          v_spool_id, 'PURCHASE', v_ft_nominal[i], p_changed_by,
          v_reason, v_occurred_at, 'PURCHASE', v_purchase.id,
          case when v_nested_key is not null then v_nested_key || ':spool:' || j::text else null end
        );
      end loop;

    else
      -- ACCESSORY / PACKAGING: saldo/custo lidos sob o lock já adquirido.
      if v_cats[i] = 'ACCESSORY' then
        select current_stock, unit_cost into v_bb, v_ucb from public.accessories where id = v_item_ids[i];
      else
        select current_stock, unit_cost into v_bb, v_ucb from public.packaging where id = v_item_ids[i];
      end if;

      -- média ponderada móvel (numeric = decimal exato; arredonda SÓ o
      -- resultado). Saldo zero ou custo NULL: a compra define o custo, sem
      -- diluir pelo saldo anterior.
      if v_bb = 0 or v_ucb is null then
        v_uca := round(v_landed / v_qtys[i], 2);
      else
        v_uca := round((v_bb::numeric * v_ucb + v_landed) / (v_bb + v_qtys[i]), 2);
      end if;

      perform public.register_stock_movement(
        v_cats[i], v_item_ids[i], 'PURCHASE', v_qtys[i]::numeric, p_changed_by,
        v_reason, v_occurred_at, 'PURCHASE', v_purchase.id, v_nested_key
      );

      if v_cats[i] = 'ACCESSORY' then
        update public.accessories set unit_cost = v_uca where id = v_item_ids[i];
        insert into public.inventory_purchase_accessory_items (
          purchase_id, accessory_id, line_number, quantity, total_value,
          freight_allocated, balance_before, balance_after, unit_cost_before, unit_cost_after
        ) values (
          v_purchase.id, v_item_ids[i], i, v_qtys[i], v_totals[i],
          v_allocs[i], v_bb, v_bb + v_qtys[i], v_ucb, v_uca
        );
      else
        update public.packaging set unit_cost = v_uca where id = v_item_ids[i];
        insert into public.inventory_purchase_packaging_items (
          purchase_id, packaging_id, line_number, quantity, total_value,
          freight_allocated, balance_before, balance_after, unit_cost_before, unit_cost_after
        ) values (
          v_purchase.id, v_item_ids[i], i, v_qtys[i], v_totals[i],
          v_allocs[i], v_bb, v_bb + v_qtys[i], v_ucb, v_uca
        );
      end if;
    end if;
  end loop;

  return public._build_mixed_purchase_summary(v_purchase.id);
end;
$$;

comment on function public.register_mixed_inventory_purchase(jsonb, numeric, text, date, uuid, text, text) is
  'Registra uma COMPRA MISTA (Filamento + Acessório + Embalagem no mesmo pedido) numa única transação: valida 1..50 itens discriminados por category (sem acessório/embalagem repetidos; tipo de filamento pode repetir com marca/peso diferentes; quantity inteiro > 0; total_value > 0, 2 casas); converte p_occurred_on (data de negócio) em occurred_at ancorando meio-dia America/Sao_Paulo; rateia o frete único UMA vez sobre TODAS as linhas (maior resto, centavos inteiros, desempate por posição global; Σ = freight_value); trava filament_types -> accessories -> packaging ascendente por id (FOR UPDATE; bloqueia inexistente/inativo); cria UM cabeçalho (inventory_purchases, category=MIXED, item_id null, quantity/item_value = totais agregados, purchase_channel obrigatório, supplier_name só p/ OUTRO_SITE/PRESENCIAL, notes null); cria um item por linha na tabela da sua categoria com line_number = posição GLOBAL; cria N filament_spools + register_filament_movement por rolo; chama register_stock_movement (PURCHASE) por acessório/embalagem; atualiza accessories.unit_cost e packaging.unit_cost por média ponderada móvel (saldo 0 ou custo NULL -> a compra define o custo sem diluir). total_value/freight_allocated/landed_total_value ficam exatos no ledger; unit_cost é derivado e arredondado a 2 casas. Atômica por construção. Idempotente por p_idempotency_key: o canônico = category/freight/canal/complemento + p_occurred_on (data de negócio) + itens na ORDEM GLOBAL. ORDEM É SIGNIFICATIVA (reordenar itens => IDEMPOTENCY_KEY_CONFLICT:, pois o desempate do rateio de centavos depende dela). Data diferente => IDEMPOTENCY_KEY_CONFLICT: (na compra mista a data é digitada e estável, parte da identidade — diferente das três RPCs antigas, onde occurred_at tem default now() e fica de fora). NÃO altera register_inventory_purchase / register_filament_purchase / register_accessory_purchase nem as rotas /, /filament, /accessory.';

revoke execute on function public.register_mixed_inventory_purchase(jsonb, numeric, text, date, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.register_mixed_inventory_purchase(jsonb, numeric, text, date, uuid, text, text)
  to service_role;
