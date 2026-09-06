-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- Compra de ACESSÓRIOS com UM OU MAIS itens na mesma compra + cálculo
-- automático do Custo unitário por MÉDIA PONDERADA MÓVEL (2026-09-06).
--
-- Decisões aprovadas pelo usuário nesta rodada:
--   1. Custo unitário por média ponderada móvel.
--   2. Frete incorporado ao custo.
--   3. Frete rateado proporcionalmente ao total_value de cada linha.
--   4. Uma compra pode conter vários acessórios.
--   5. O usuário informa o VALOR TOTAL pago por cada linha (nunca o unitário).
--   6. Se accessories.unit_cost for NULL, a primeira compra DEFINE o custo
--      inicial (sem diluição pelo saldo anterior), mesmo que já exista saldo.
--   7. Data da compra dd/mm/aa; 8. Fornecedor texto livre opcional;
--      9. Observação opcional; 10. Histórico com data/compra/quantidade/saldo/
--      observação/referência.
--  11. EMBALAGENS permanecem INALTERADAS nesta rodada (register_inventory_purchase
--      / PACKAGING não é tocado por esta migration).
--  12. O total efetivamente pago permanece EXATO (item_value/total_value);
--      unit_cost é derivado e arredondado (2 casas).
--
-- Migration APPEND-ONLY — nenhuma migration anterior é editada. Nenhuma linha
-- existente é apagada nem alterada em valor. register_inventory_purchase
-- (20260828121000 / 20260904120000), register_filament_purchase
-- (20260904130000 / 20260904140000 / 20260905160000), register_stock_movement
-- (20260827090000) e todos os grants/CHECKs dessas funções permanecem
-- INTOCADOS. Toda compra/rolo/movimento histórico continua legível.
--
-- IMPORTANTE — esta migration NÃO foi aplicada ao Supabase remoto nesta
-- rodada. Aplicar exige autorização explícita separada. A Edge Function
-- `inventory-purchases` ganha a rota nova nesta mesma rodada, mas TAMBÉM
-- NÃO é publicada aqui.
--
-- CONTEÚDO:
--   1. public.inventory_purchases ganha supplier_name text (nullable, sem
--      texto vazio após trim, <= 200 chars). Nunca reutiliza notes/
--      purchase_channel para fornecedor.
--   2. public.inventory_purchase_accessory_items — um item (acessório +
--      quantidade + valor total da linha + frete rateado + saldo/custo
--      antes/depois) por linha, sempre vinculado a um cabeçalho de
--      inventory_purchases (category='ACCESSORY', item_id null quando
--      multi-item). Ledger imutável, mesmo padrão de
--      inventory_purchase_filament_items. total_value é a fonte AUTORITATIVA
--      do valor pago pela linha — NUNCA reconstruído como quantidade ×
--      custo unitário.
--   3. public._accessory_purchase_items_canonical(uuid) — INTERNA, zero
--      grants: forma canônica (ordenada por accessory_id) dos itens de uma
--      compra, para a comparação de idempotência.
--   4. public._build_accessory_purchase_summary(uuid) — INTERNA, zero
--      grants: jsonb de retorno (cabeçalho + itens por line_number).
--   5. public.register_accessory_purchase(p_items, p_freight_value,
--      p_supplier_name, p_notes, p_occurred_at, p_changed_by,
--      p_idempotency_key) — RPC dedicada, SECURITY DEFINER, search_path fixo,
--      EXECUTE só service_role. Uma única transação Postgres: valida,
--      rateia o frete (maior resto em centavos inteiros, determinístico),
--      trava os acessórios em ordem determinística por id (FOR UPDATE),
--      cria o cabeçalho, cria os itens, chama register_stock_movement
--      (PURCHASE) por acessório, atualiza accessories.unit_cost pela média
--      ponderada móvel. Qualquer exceção desfaz TUDO — atomicidade por
--      construção.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. inventory_purchases.supplier_name — fornecedor como TEXTO LIVRE opcional
--    (a tabela suppliers, doc 03 §14, continua fora de escopo). NULL é
--    permitido; quando informado, não pode ser vazio após trim e tem teto de
--    200 caracteres. A RPC já grava o valor normalizado (trim + nullif) —
--    esta CHECK é defesa em profundidade.
-- ---------------------------------------------------------------------------
alter table public.inventory_purchases
  add column supplier_name text;

alter table public.inventory_purchases
  add constraint inventory_purchases_supplier_name_not_blank
    check (
      supplier_name is null
      or (btrim(supplier_name) <> '' and length(supplier_name) <= 200)
    );

comment on column public.inventory_purchases.supplier_name is
  'Fornecedor da compra como TEXTO LIVRE opcional (2026-09-06). NULL = não informado; quando presente, sem texto vazio após trim e <= 200 caracteres. NUNCA gravado em notes nem em purchase_channel. A tabela suppliers (doc 03 §14) continua fora de escopo — este campo não é uma FK.';

-- ---------------------------------------------------------------------------
-- 2. inventory_purchase_accessory_items — itens de uma compra multi-item de
--    acessórios. Ledger imutável (sem updated_at, sem UPDATE/DELETE a
--    nenhuma role de sessão) — escrita exclusiva via register_accessory_purchase.
-- ---------------------------------------------------------------------------
create table public.inventory_purchase_accessory_items (
  id uuid primary key default gen_random_uuid(),

  purchase_id uuid not null references public.inventory_purchases (id) on delete restrict,

  -- Acessório comprado nesta linha. FK real (ao contrário do item_id
  -- polimórfico do cabeçalho) — aqui a categoria é sempre ACCESSORY.
  -- ON DELETE RESTRICT: acessório com histórico de compra nunca é excluído
  -- fisicamente (delete_accessory já bloqueia por ACCESSORY_HAS_STOCK_HISTORY:).
  accessory_id uuid not null references public.accessories (id) on delete restrict,

  -- Ordem da linha no formulário (1-based) — usada para exibição estável e
  -- como desempate determinístico do rateio de frete (maior resto).
  line_number integer not null check (line_number > 0),

  -- Unidades discretas compradas nesta linha — sempre inteiro positivo.
  quantity integer not null check (quantity > 0),

  -- VALOR TOTAL pago pelos itens desta linha, exatamente como informado —
  -- FONTE AUTORITATIVA. Nunca reconstruído como quantity × unit_cost.
  total_value numeric(12, 2) not null check (total_value > 0),

  -- Parcela do frete único da compra atribuída a esta linha (rateio
  -- proporcional a total_value, maior resto em centavos — ver a RPC). Soma
  -- das parcelas de todas as linhas = inventory_purchases.freight_value.
  freight_allocated numeric(12, 2) not null check (freight_allocated >= 0),

  -- Custo "posto no estoque" desta linha = itens + frete rateado. Coluna
  -- GERADA — o Postgres garante a invariante, nunca um valor divergente.
  landed_total_value numeric(12, 2)
    generated always as (total_value + freight_allocated) stored,

  -- Saldo materializado do acessório ANTES e DEPOIS desta linha. A RPC lê
  -- balance_before sob FOR UPDATE e grava balance_after = balance_before +
  -- quantity (mesma progressão que register_stock_movement aplica ao
  -- accessories.current_stock).
  balance_before integer not null check (balance_before >= 0),
  balance_after integer not null check (balance_after >= 0),
  constraint inventory_purchase_accessory_items_balance_progression
    check (balance_after = balance_before + quantity),

  -- Custo unitário do acessório ANTES desta linha (NULL = era "Não
  -- informado") e DEPOIS (média ponderada móvel, arredondado a 2 casas —
  -- nunca NULL depois de uma compra).
  unit_cost_before numeric(10, 2) check (unit_cost_before is null or unit_cost_before >= 0),
  unit_cost_after numeric(10, 2) not null check (unit_cost_after >= 0),

  created_at timestamptz not null default now(),

  -- Uma compra nunca repete o mesmo acessório em duas linhas (a RPC também
  -- rejeita antes de gravar); line_number único por compra.
  unique (purchase_id, accessory_id),
  unique (purchase_id, line_number)
);

comment on table public.inventory_purchase_accessory_items is
  'Itens de uma compra de acessórios com um ou mais itens (Módulo 3, 2026-09-06). Um acessório + quantidade + total_value (valor pago pela linha, AUTORITATIVO — nunca quantity × unit_cost) + freight_allocated (rateio proporcional do frete único, maior resto) + saldo e custo antes/depois. Sempre vinculado a um cabeçalho em inventory_purchases (category=ACCESSORY, item_id null quando multi-item). landed_total_value é gerado (total_value + freight_allocated). Ledger imutável — nenhum UPDATE/DELETE concedido a nenhuma role de sessão; escrita exclusiva via register_accessory_purchase (security definer, service_role). Embalagens não usam esta tabela — o fluxo PACKAGING de register_inventory_purchase permanece inalterado.';

comment on column public.inventory_purchase_accessory_items.total_value is
  'FONTE AUTORITATIVA do valor pago pela linha, exatamente como informado (2 casas). NUNCA reconstruído como quantity × unit_cost_after — o custo unitário é derivado e arredondado, o total é exato.';

comment on column public.inventory_purchase_accessory_items.freight_allocated is
  'Parcela do frete único da compra (inventory_purchases.freight_value) atribuída a esta linha: rateio proporcional a total_value, distribuído em centavos inteiros pelo método do maior resto (desempate por line_number). Σ freight_allocated de todas as linhas = freight_value exatamente. Frete zero -> 0 em todas as linhas.';

comment on column public.inventory_purchase_accessory_items.unit_cost_after is
  'Custo unitário do acessório após esta linha, por média ponderada móvel: se balance_before = 0 OU unit_cost_before IS NULL -> round((total_value + freight_allocated) / quantity, 2) (a primeira compra define o custo, sem diluição); senão -> round((balance_before × unit_cost_before + total_value + freight_allocated) / (balance_before + quantity), 2). Também gravado em accessories.unit_cost na mesma transação.';

create index idx_inventory_purchase_accessory_items_purchase_id
  on public.inventory_purchase_accessory_items (purchase_id);

create index idx_inventory_purchase_accessory_items_accessory_id
  on public.inventory_purchase_accessory_items (accessory_id, created_at desc);

alter table public.inventory_purchase_accessory_items enable row level security;

revoke all on public.inventory_purchase_accessory_items from anon;
revoke all on public.inventory_purchase_accessory_items from authenticated;
grant select on public.inventory_purchase_accessory_items to authenticated;

create policy "Active users can view accessory purchase items"
  on public.inventory_purchase_accessory_items
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- 3. _accessory_purchase_items_canonical — INTERNA (zero grants). Forma
--    canônica dos itens de uma compra (ordenada por accessory_id) para a
--    comparação de idempotência: só accessory_id / quantity / total_value.
-- ---------------------------------------------------------------------------
create or replace function public._accessory_purchase_items_canonical(p_purchase_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'accessory_id', it.accessory_id,
           'quantity', it.quantity,
           'total_value', round(it.total_value, 2)
         ) order by it.accessory_id), '[]'::jsonb)
  from public.inventory_purchase_accessory_items it
  where it.purchase_id = p_purchase_id;
$$;

comment on function public._accessory_purchase_items_canonical(uuid) is
  'INTERNA (zero grants). Itens de uma compra de acessórios em forma canônica (ordenados por accessory_id; só accessory_id/quantity/total_value) — usada por register_accessory_purchase para comparar o payload de uma repetição de idempotency_key. Somente leitura.';

revoke execute on function public._accessory_purchase_items_canonical(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. _build_accessory_purchase_summary — INTERNA (zero grants). jsonb de
--    retorno de register_accessory_purchase (cabeçalho + itens por
--    line_number), reaproveitado no caminho normal e no retorno idempotente.
-- ---------------------------------------------------------------------------
create or replace function public._build_accessory_purchase_summary(p_purchase_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'purchase_id', p.id,
    'category', p.category,
    'quantity', p.quantity,
    'item_value', p.item_value,
    'freight_value', p.freight_value,
    'total_value', p.total_value,
    'supplier_name', p.supplier_name,
    'notes', p.notes,
    'occurred_at', p.occurred_at,
    'created_at', p.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'accessory_id', it.accessory_id,
        'line_number', it.line_number,
        'quantity', it.quantity,
        'total_value', it.total_value,
        'freight_allocated', it.freight_allocated,
        'landed_total_value', it.landed_total_value,
        'balance_before', it.balance_before,
        'balance_after', it.balance_after,
        'unit_cost_before', it.unit_cost_before,
        'unit_cost_after', it.unit_cost_after
      ) order by it.line_number)
      from public.inventory_purchase_accessory_items it
      where it.purchase_id = p.id
    ), '[]'::jsonb)
  )
  from public.inventory_purchases p
  where p.id = p_purchase_id;
$$;

comment on function public._build_accessory_purchase_summary(uuid) is
  'INTERNA (zero grants). Monta o jsonb de retorno de register_accessory_purchase (cabeçalho + itens ordenados por line_number) a partir de um purchase_id já gravado. Somente leitura.';

revoke execute on function public._build_accessory_purchase_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. register_accessory_purchase — RPC dedicada à compra de acessórios com
--    um ou mais itens (ver nota de modelagem no cabeçalho da migration).
--
-- Assinatura (ordem pedida): p_items, p_freight_value, p_supplier_name,
-- p_notes, p_occurred_at, p_changed_by, p_idempotency_key. Os três últimos
-- têm default por exigência do PL/pgSQL (parâmetro sem default não pode
-- seguir um com default); p_changed_by é validado como obrigatório por
-- assert_active_user (que já rejeita NULL).
--
-- ATOMICIDADE / CONCORRÊNCIA: um único corpo de função = uma única
-- transação. Os acessórios são travados com SELECT ... FOR UPDATE em ordem
-- DETERMINÍSTICA (ascendente por id) — duas compras simultâneas que toquem
-- o mesmo acessório são serializadas por esse lock (a segunda só age depois
-- do commit da primeira e já lê current_stock/unit_cost atualizados),
-- e a ordem fixa de aquisição evita deadlock entre compras com conjuntos de
-- acessórios que se cruzam. register_stock_movement é reaproveitado
-- integralmente (não duplica lógica de saldo). Qualquer exceção desfaz
-- cabeçalho, itens, movimentos, saldo e custos.
--
-- IDEMPOTÊNCIA: checada ANTES de qualquer trabalho pesado (mesma chave +
-- mesmo payload canônico -> devolve a compra já registrada; payload
-- diferente -> IDEMPOTENCY_KEY_CONFLICT:). occurred_at fica DE FORA da
-- comparação (mesma convenção de register_stock_movement/
-- register_inventory_purchase — tem default now(), não é identidade
-- lógica). O caso residual de duas chamadas concorrentes com a MESMA chave
-- (nenhuma vê a outra ainda) é coberto: o INSERT do cabeçalho está num
-- bloco que captura unique_violation em ux_inventory_purchases_idempotency_key,
-- re-lê a compra vencedora e devolve o resumo se o payload bater, ou
-- levanta IDEMPOTENCY_KEY_CONFLICT: se não bater — nunca escapa um 23505 cru.
-- ---------------------------------------------------------------------------
create or replace function public.register_accessory_purchase(
  p_items jsonb,
  p_freight_value numeric,
  p_supplier_name text default null,
  p_notes text default null,
  p_occurred_at timestamptz default now(),
  p_changed_by uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occurred_at timestamptz;
  v_freight numeric;
  v_supplier text;
  v_notes text;
  v_reason text;

  v_elem jsonb;
  v_ord bigint;
  v_acc_id uuid;
  v_qty_num numeric;
  v_qty integer;
  v_total numeric;

  v_acc_ids uuid[] := '{}';
  v_qtys integer[] := '{}';
  v_totals numeric[] := '{}';
  v_total_cents bigint[] := '{}';
  v_floor_cents bigint[] := '{}';
  v_rem_cents numeric[] := '{}';
  v_alloc_cents bigint[] := '{}';
  v_bump bigint[] := '{}';

  v_n integer;
  v_total_quantity integer := 0;
  v_subtotal numeric := 0;
  v_subtotal_cents bigint := 0;
  v_freight_cents bigint := 0;
  v_assigned_cents bigint := 0;
  v_leftover bigint := 0;

  v_sorted_ids uuid[];
  v_one_id uuid;
  v_active boolean;

  v_incoming_canonical jsonb;
  v_existing public.inventory_purchases;
  v_purchase public.inventory_purchases;
  v_constraint text;

  v_bb integer;
  v_ucb numeric;
  v_uca numeric;
  v_alloc numeric;
  v_nested_key text;
  i integer;
begin
  perform public.assert_active_user(p_changed_by);

  v_occurred_at := coalesce(p_occurred_at, now());

  v_freight := coalesce(p_freight_value, 0);
  if v_freight < 0 then
    raise exception 'register_accessory_purchase: p_freight_value não pode ser negativo (recebido %)', p_freight_value;
  end if;
  if v_freight <> round(v_freight, 2) then
    raise exception 'register_accessory_purchase: p_freight_value deve ter no máximo 2 casas decimais (recebido %)', p_freight_value;
  end if;

  v_supplier := nullif(btrim(coalesce(p_supplier_name, '')), '');
  if v_supplier is not null and length(v_supplier) > 200 then
    raise exception 'register_accessory_purchase: supplier_name excede 200 caracteres';
  end if;

  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if v_notes is not null and length(v_notes) > 1000 then
    raise exception 'register_accessory_purchase: notes excede 1000 caracteres';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'register_accessory_purchase: informe de 1 a 50 itens em p_items (lista JSON não vazia)';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'register_accessory_purchase: no máximo 50 itens por compra (recebido %)', jsonb_array_length(p_items);
  end if;

  -- Primeira passagem: só validação estrutural + acumulação (nenhuma
  -- escrita). Qualquer item inválido nunca cria nada, nem o cabeçalho.
  for v_elem, v_ord in
    select value, ordinality from jsonb_array_elements(p_items) with ordinality
  loop
    v_acc_id := nullif(v_elem ->> 'accessory_id', '')::uuid;
    if v_acc_id is null then
      raise exception 'register_accessory_purchase: item % — accessory_id é obrigatório', v_ord;
    end if;
    if v_acc_id = any(v_acc_ids) then
      raise exception 'register_accessory_purchase: acessório repetido em duas linhas (%) — cada acessório só pode aparecer uma vez na mesma compra', v_acc_id;
    end if;

    v_qty_num := nullif(v_elem ->> 'quantity', '')::numeric;
    if v_qty_num is null or v_qty_num <= 0 then
      raise exception 'register_accessory_purchase: item % — quantity deve ser um inteiro positivo (recebido %)', v_ord, v_elem ->> 'quantity';
    end if;
    if v_qty_num <> trunc(v_qty_num) then
      raise exception 'register_accessory_purchase: item % — quantity deve ser um número inteiro, sem casas decimais (recebido %)', v_ord, v_elem ->> 'quantity';
    end if;
    v_qty := v_qty_num::integer;

    v_total := nullif(v_elem ->> 'total_value', '')::numeric;
    if v_total is null or v_total <= 0 then
      raise exception 'register_accessory_purchase: item % — total_value deve ser um número maior que zero (recebido %)', v_ord, v_elem ->> 'total_value';
    end if;
    if v_total <> round(v_total, 2) then
      raise exception 'register_accessory_purchase: item % — total_value deve ter no máximo 2 casas decimais (recebido %)', v_ord, v_elem ->> 'total_value';
    end if;

    v_acc_ids := v_acc_ids || v_acc_id;
    v_qtys := v_qtys || v_qty;
    v_totals := v_totals || v_total;
    v_total_cents := v_total_cents || round(v_total * 100)::bigint;
    v_total_quantity := v_total_quantity + v_qty;
    v_subtotal := v_subtotal + v_total;
  end loop;

  v_n := array_length(v_acc_ids, 1);

  -- ---------------------------------------------------------------------
  -- Rateio do frete: proporcional a total_value, em CENTAVOS INTEIROS
  -- (aritmética decimal exata via numeric — nunca ponto flutuante), método
  -- do maior resto. floor de cada parcela + 1 centavo às maiores frações
  -- (desempate por line_number ascendente). Σ parcelas = freight_value.
  -- ---------------------------------------------------------------------
  v_subtotal_cents := (select coalesce(sum(c), 0) from unnest(v_total_cents) c);
  v_freight_cents := round(v_freight * 100)::bigint;

  if v_freight_cents = 0 or v_subtotal_cents = 0 then
    for i in 1..v_n loop
      v_alloc_cents := v_alloc_cents || 0::bigint;
    end loop;
  else
    for i in 1..v_n loop
      v_floor_cents := v_floor_cents
        || div(v_freight_cents::numeric * v_total_cents[i]::numeric, v_subtotal_cents::numeric)::bigint;
      v_rem_cents := v_rem_cents
        || mod(v_freight_cents::numeric * v_total_cents[i]::numeric, v_subtotal_cents::numeric);
      v_assigned_cents := v_assigned_cents + v_floor_cents[i];
    end loop;

    v_leftover := v_freight_cents - v_assigned_cents;

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
      v_alloc_cents := v_alloc_cents
        || (v_floor_cents[i] + (case when i = any(coalesce(v_bump, array[]::bigint[])) then 1 else 0 end))::bigint;
    end loop;
  end if;

  -- Forma canônica do payload recebido (ordenada por accessory_id) — usada
  -- na checagem de idempotência (pré e no catch do unique_violation).
  v_incoming_canonical := (
    select coalesce(jsonb_agg(jsonb_build_object(
             'accessory_id', v_acc_ids[g],
             'quantity', v_qtys[g],
             'total_value', round(v_totals[g], 2)
           ) order by v_acc_ids[g]), '[]'::jsonb)
    from generate_series(1, v_n) g
  );

  -- Idempotência — checada antes de qualquer trabalho pesado.
  if p_idempotency_key is not null then
    select * into v_existing from public.inventory_purchases where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.category = 'ACCESSORY'
         and v_existing.freight_value = v_freight
         and v_existing.supplier_name is not distinct from v_supplier
         and v_existing.notes is not distinct from v_notes
         and public._accessory_purchase_items_canonical(v_existing.id) = v_incoming_canonical
      then
        return public._build_accessory_purchase_summary(v_existing.id);
      else
        raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
      end if;
    end if;
  end if;

  -- Trava os acessórios em ordem DETERMINÍSTICA (ascendente por id) — evita
  -- deadlock entre compras concorrentes com conjuntos que se cruzam — e
  -- confirma existência + item ativo.
  v_sorted_ids := (select array_agg(x order by x) from (select distinct unnest(v_acc_ids) as x) d);
  foreach v_one_id in array v_sorted_ids loop
    select is_active into v_active from public.accessories where id = v_one_id for update;
    if not found then
      raise exception 'register_accessory_purchase: acessório de id % não encontrado', v_one_id;
    end if;
    if not v_active then
      raise exception 'INVENTORY_PURCHASE_ITEM_INACTIVE: acessório de id % está inativo — reative-o na aba Acessórios antes de comprar.', v_one_id;
    end if;
  end loop;

  -- Motivo legível gravado em cada stock_movements.reason (histórico).
  if v_supplier is not null and v_notes is not null then
    v_reason := 'Fornecedor: ' || v_supplier || ' — ' || v_notes;
  elsif v_supplier is not null then
    v_reason := 'Fornecedor: ' || v_supplier;
  elsif v_notes is not null then
    v_reason := v_notes;
  else
    v_reason := 'Compra de acessórios';
  end if;

  -- Cabeçalho único: item_id null, quantity/item_value = totais agregados
  -- (item_value = soma EXATA de total_value das linhas), freight_value
  -- informado uma única vez, supplier_name/notes opcionais, occurred_at
  -- (data informada). total_value do cabeçalho continua sendo a coluna
  -- gerada item_value + freight_value.
  begin
    insert into public.inventory_purchases (
      category, item_id, quantity, item_value, freight_value,
      occurred_at, notes, supplier_name, idempotency_key, created_by
    ) values (
      'ACCESSORY', null, v_total_quantity, v_subtotal, v_freight,
      v_occurred_at, v_notes, v_supplier, p_idempotency_key, p_changed_by
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
    if v_existing.category = 'ACCESSORY'
       and v_existing.freight_value = v_freight
       and v_existing.supplier_name is not distinct from v_supplier
       and v_existing.notes is not distinct from v_notes
       and public._accessory_purchase_items_canonical(v_existing.id) = v_incoming_canonical
    then
      return public._build_accessory_purchase_summary(v_existing.id);
    else
      raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
    end if;
  end;

  -- Segunda passagem: materializa cada linha (na ordem de entrada =
  -- line_number). Cada acessório aparece uma única vez, então o
  -- current_stock/unit_cost lido aqui ainda é o "anterior" (nenhuma linha
  -- anterior tocou este acessório). A linha já está travada pelo foreach
  -- acima.
  for i in 1..v_n loop
    select current_stock, unit_cost into v_bb, v_ucb
      from public.accessories where id = v_acc_ids[i];

    v_alloc := (v_alloc_cents[i])::numeric / 100;

    -- Média ponderada móvel. numeric é aritmética decimal exata — arredonda
    -- SÓ o resultado final para 2 casas.
    if v_bb = 0 or v_ucb is null then
      -- Custo anterior desconhecido ou sem saldo: a primeira compra DEFINE o
      -- custo, sem diluição pelo saldo anterior (decisão do usuário).
      v_uca := round((v_totals[i] + v_alloc) / v_qtys[i], 2);
    else
      v_uca := round(
        (v_bb::numeric * v_ucb + v_totals[i] + v_alloc) / (v_bb + v_qtys[i]),
        2
      );
    end if;

    v_nested_key := case when p_idempotency_key is not null
      then p_idempotency_key || ':acc:' || i::text else null end;

    -- Entrada de estoque via a RPC já existente (valida existência, trava a
    -- linha de novo — reentrante na mesma transação — calcula balance_*,
    -- insere o movimento e atualiza accessories.current_stock). reason
    -- carrega fornecedor/observação; reference_type/id vinculam ao cabeçalho.
    perform public.register_stock_movement(
      'ACCESSORY', v_acc_ids[i], 'PURCHASE', v_qtys[i]::numeric, p_changed_by,
      v_reason, v_occurred_at, 'PURCHASE', v_purchase.id, v_nested_key
    );

    -- Custo autoritativo gravado no cadastro mestre, na MESMA transação.
    update public.accessories set unit_cost = v_uca where id = v_acc_ids[i];

    insert into public.inventory_purchase_accessory_items (
      purchase_id, accessory_id, line_number, quantity, total_value,
      freight_allocated, balance_before, balance_after, unit_cost_before, unit_cost_after
    ) values (
      v_purchase.id, v_acc_ids[i], i, v_qtys[i], v_totals[i],
      v_alloc, v_bb, v_bb + v_qtys[i], v_ucb, v_uca
    );
  end loop;

  return public._build_accessory_purchase_summary(v_purchase.id);
end;
$$;

comment on function public.register_accessory_purchase(jsonb, numeric, text, text, timestamptz, uuid, text) is
  'Registra uma compra de acessórios com UM OU MAIS itens numa única transação: valida 1..50 itens (accessory_id, quantity inteiro > 0, total_value > 0, 2 casas, sem acessório repetido), rateia o frete único proporcionalmente a total_value (centavos inteiros, maior resto, desempate por line_number — Σ = freight_value), trava os acessórios em ordem ascendente por id (FOR UPDATE; bloqueia inexistente/inativo), cria o cabeçalho (inventory_purchases, category=ACCESSORY, item_id null, quantity/item_value = totais agregados, supplier_name/notes opcionais), cria um inventory_purchase_accessory_items por linha, chama register_stock_movement (PURCHASE) por acessório e atualiza accessories.unit_cost pela média ponderada móvel (se balance_before=0 ou unit_cost IS NULL, a primeira compra define o custo sem diluir; senão (saldo×custo + total + frete rateado) / (saldo + qtd)), arredondando só o resultado final. total_value é sempre exato; unit_cost é derivado e arredondado. Atômica por construção; idempotente quando p_idempotency_key é fornecida (compara category/freight/supplier/notes/itens canônicos; occurred_at fica de fora). Devolve o jsonb de _build_accessory_purchase_summary. NÃO altera o fluxo PACKAGING nem register_inventory_purchase/register_filament_purchase.';

revoke execute on function public.register_accessory_purchase(jsonb, numeric, text, text, timestamptz, uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_accessory_purchase(jsonb, numeric, text, text, timestamptz, uuid, text)
  to service_role;
