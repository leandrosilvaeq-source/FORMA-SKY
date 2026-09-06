-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- TESTE DE INTEGRAÇÃO transacional da compra de ACESSÓRIOS com um ou mais
-- itens + Custo unitário por média ponderada móvel + frete rateado
-- (migration 20260906140000_register_multi_item_accessory_purchases.sql:
-- inventory_purchases.supplier_name, inventory_purchase_accessory_items,
-- register_accessory_purchase, _build_accessory_purchase_summary,
-- _accessory_purchase_items_canonical).
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nada persiste. Só usa registros
-- "TESTE COMPRAS ACESSÓRIO%", nunca dados oficiais.
--
-- Execução (após a migration 20260906140000 ser aplicada):
--   npx supabase db query --linked --file supabase/tests/accessory_purchase_test.sql
--
-- LIMITAÇÃO DE AMBIENTE: a migration 20260906140000 ainda NÃO foi aplicada
-- ao Supabase remoto e não há Supabase local rodando nesta sessão — ESTE
-- SCRIPT NÃO FOI EXECUTADO. Escrito seguindo o padrão de
-- supabase/tests/inventory_purchases_test.sql e filament_purchase_test.sql.
--
-- LIMITAÇÃO CONHECIDA (mesma dos arquivos irmãos): uma única transação/
-- conexão não exercita concorrência real de duas sessões — a Seção 9
-- (determinismo/serialização por lock) cobre determinismo do rateio e o
-- caminho antecipado da idempotência; a serialização real por FOR UPDATE em
-- ordem de accessory_id é garantida por leitura de código (ver o cabeçalho
-- da migration). A Seção "rollback integral" É exercitável numa transação
-- só (não depende de concorrência — só de uma falha no meio de uma chamada,
-- revertida pelo savepoint implícito do bloco DO/EXCEPTION).
-- =============================================================================

begin;

create temporary table zz_test_results (
  seq serial primary key,
  section text not null,
  test_name text not null,
  status text not null,
  details text
);

create temporary table zz_fixtures (
  key text primary key,
  value text
);

-- =============================================================================
-- SEÇÃO 0 — Setup
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_acc_a uuid;
  v_acc_b uuid;
  v_acc_c uuid;
  v_acc_inactive uuid;
  v_pkg uuid;
begin
  begin
    select id into v_user_id from public.users where is_active order by created_at limit 1;
    if v_user_id is null then raise exception 'nenhum usuário ativo em public.users'; end if;

    v_acc_a := (public.create_accessory('TESTE COMPRAS ACESSÓRIO A', null, null, null, true, v_user_id)).id;
    v_acc_b := (public.create_accessory('TESTE COMPRAS ACESSÓRIO B', null, null, null, true, v_user_id)).id;
    v_acc_c := (public.create_accessory('TESTE COMPRAS ACESSÓRIO C', null, null, null, true, v_user_id)).id;
    v_acc_inactive := (public.create_accessory('TESTE COMPRAS ACESSÓRIO INATIVO', null, null, null, false, v_user_id)).id;
    v_pkg := (public.create_packaging('TESTE COMPRAS EMBALAGEM', null, null, null, true, v_user_id)).id;

    insert into zz_fixtures(key, value) values
      ('user_id', v_user_id::text),
      ('acc_a', v_acc_a::text),
      ('acc_b', v_acc_b::text),
      ('acc_c', v_acc_c::text),
      ('acc_inactive', v_acc_inactive::text),
      ('pkg', v_pkg::text)
    on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 setup: usuário + 3 acessórios ativos + 1 inativo + 1 embalagem', 'PASS', 'user_id=' || v_user_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 setup', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 1 — Primeira compra: saldo 0 + unit_cost NULL -> custo = entrada / qtd
-- =============================================================================
do $$
declare
  v_user uuid; v_acc uuid; v_res jsonb; v_item jsonb;
  v_stock integer; v_cost numeric; v_mov_count integer;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  select value::uuid into v_acc  from zz_fixtures where key = 'acc_a';

  v_res := public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 5, 'total_value', 10.00)),
    p_freight_value => 0,
    p_supplier_name => null, p_notes => null, p_occurred_at => now(),
    p_changed_by => v_user, p_idempotency_key => null
  );
  v_item := v_res -> 'items' -> 0;

  select current_stock, unit_cost into v_stock, v_cost from public.accessories where id = v_acc;
  select count(*) into v_mov_count from public.stock_movements
    where item_type = 'ACCESSORY' and item_id = v_acc and movement_type = 'PURCHASE'
      and reference_type = 'PURCHASE' and reference_id = (v_res ->> 'purchase_id')::uuid and quantity_delta = 5;

  insert into zz_test_results(section, test_name, status, details)
  values ('1',
    '1.1 saldo 0 + custo NULL: unit_cost = 10,00/5 = 2,00; current_stock 5; header item_value/total_value 10,00; 1 item; 1 movimento',
    case when v_cost = 2.00 and v_stock = 5
          and (v_res ->> 'item_value')::numeric = 10.00
          and (v_res ->> 'total_value')::numeric = 10.00
          and (v_res ->> 'category') = 'ACCESSORY'
          and jsonb_array_length(v_res -> 'items') = 1
          and (v_item ->> 'unit_cost_before') is null
          and (v_item ->> 'unit_cost_after')::numeric = 2.00
          and (v_item ->> 'balance_before')::int = 0
          and (v_item ->> 'balance_after')::int = 5
          and (v_item ->> 'freight_allocated')::numeric = 0.00
          and (v_item ->> 'landed_total_value')::numeric = 10.00
          and v_mov_count = 1
         then 'PASS' else 'FAIL' end,
    format('cost=%s stock=%s res=%s', v_cost, v_stock, v_res));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('1', '1.1 primeira compra', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 2 — Primeira compra COM saldo anterior mas unit_cost NULL: define o
--           custo pela nova entrada, SEM diluição pelo saldo anterior.
-- =============================================================================
do $$
declare
  v_user uuid; v_acc uuid; v_res jsonb; v_item jsonb; v_cost numeric; v_stock integer;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  select value::uuid into v_acc  from zz_fixtures where key = 'acc_b';

  -- Semente: saldo 10 via INITIAL_BALANCE; unit_cost permanece NULL.
  perform public.register_stock_movement('ACCESSORY', v_acc, 'INITIAL_BALANCE', 10::numeric, v_user);

  v_res := public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 5, 'total_value', 10.00)),
    p_freight_value => 0,
    p_supplier_name => null, p_notes => null, p_occurred_at => now(),
    p_changed_by => v_user, p_idempotency_key => null
  );
  v_item := v_res -> 'items' -> 0;
  select current_stock, unit_cost into v_stock, v_cost from public.accessories where id = v_acc;

  insert into zz_test_results(section, test_name, status, details)
  values ('2',
    '2.1 saldo anterior 10 + custo NULL: unit_cost = 10,00/5 = 2,00 (NÃO diluído pelas 10 un anteriores); saldo 15',
    case when v_cost = 2.00 and v_stock = 15
          and (v_item ->> 'unit_cost_before') is null
          and (v_item ->> 'unit_cost_after')::numeric = 2.00
          and (v_item ->> 'balance_before')::int = 10
          and (v_item ->> 'balance_after')::int = 15
         then 'PASS' else 'FAIL' end,
    format('cost=%s stock=%s', v_cost, v_stock));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('2', '2.1 custo NULL com saldo', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 3 — Compra posterior: média ponderada móvel (exemplo do pedido).
--   saldo 10 × R$ 1,00 ; entrada 5 un, itens R$ 10,00 + frete alocado R$ 2,00
--   -> (10*1,00 + 10,00 + 2,00) / (10 + 5) = 22,00 / 15 = 1,4666… -> R$ 1,47
-- =============================================================================
do $$
declare
  v_user uuid; v_acc uuid; v_res jsonb; v_item jsonb; v_cost numeric; v_stock integer;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  select value::uuid into v_acc  from zz_fixtures where key = 'acc_c';

  perform public.register_stock_movement('ACCESSORY', v_acc, 'INITIAL_BALANCE', 10::numeric, v_user);
  update public.accessories set unit_cost = 1.00 where id = v_acc;

  v_res := public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 5, 'total_value', 10.00)),
    p_freight_value => 2.00,
    p_supplier_name => null, p_notes => null, p_occurred_at => now(),
    p_changed_by => v_user, p_idempotency_key => null
  );
  v_item := v_res -> 'items' -> 0;
  select current_stock, unit_cost into v_stock, v_cost from public.accessories where id = v_acc;

  insert into zz_test_results(section, test_name, status, details)
  values ('3',
    '3.1 média ponderada: 22,00/15 -> unit_cost 1,47; saldo 15; freight_allocated 2,00 (linha única leva todo o frete); landed 12,00',
    case when v_cost = 1.47 and v_stock = 15
          and (v_item ->> 'unit_cost_before')::numeric = 1.00
          and (v_item ->> 'unit_cost_after')::numeric = 1.47
          and (v_item ->> 'freight_allocated')::numeric = 2.00
          and (v_item ->> 'landed_total_value')::numeric = 12.00
          and (v_res ->> 'item_value')::numeric = 10.00
          and (v_res ->> 'freight_value')::numeric = 2.00
          and (v_res ->> 'total_value')::numeric = 12.00
         then 'PASS' else 'FAIL' end,
    format('cost=%s stock=%s item=%s', v_cost, v_stock, v_item));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('3', '3.1 média ponderada', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 4 — Vários acessórios + frete proporcional ao total (exemplo do pedido).
--   A R$ 80,00, B R$ 20,00, frete R$ 15,00 -> A R$ 12,00, B R$ 3,00.
--   Σ freight_allocated = freight_value.
-- =============================================================================
do $$
declare
  v_user uuid; v_a uuid; v_b uuid; v_res jsonb;
  v_alloc_a numeric; v_alloc_b numeric; v_sum numeric; v_freight numeric;
  v_landed_a numeric; v_landed_b numeric;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  select value::uuid into v_a from zz_fixtures where key = 'acc_a';
  select value::uuid into v_b from zz_fixtures where key = 'acc_b';

  v_res := public.register_accessory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('accessory_id', v_a::text, 'quantity', 8, 'total_value', 80.00),
      jsonb_build_object('accessory_id', v_b::text, 'quantity', 8, 'total_value', 20.00)
    ),
    p_freight_value => 15.00,
    p_supplier_name => null, p_notes => null, p_occurred_at => now(),
    p_changed_by => v_user, p_idempotency_key => null
  );

  select (it ->> 'freight_allocated')::numeric, (it ->> 'landed_total_value')::numeric
    into v_alloc_a, v_landed_a
  from jsonb_array_elements(v_res -> 'items') it where (it ->> 'accessory_id')::uuid = v_a;
  select (it ->> 'freight_allocated')::numeric, (it ->> 'landed_total_value')::numeric
    into v_alloc_b, v_landed_b
  from jsonb_array_elements(v_res -> 'items') it where (it ->> 'accessory_id')::uuid = v_b;

  select sum((it ->> 'freight_allocated')::numeric) into v_sum from jsonb_array_elements(v_res -> 'items') it;
  v_freight := (v_res ->> 'freight_value')::numeric;

  insert into zz_test_results(section, test_name, status, details)
  values ('4',
    '4.1 frete proporcional: A 12,00 (landed 92,00), B 3,00 (landed 23,00); Σ freight_allocated = 15,00 = freight_value; item_value 100,00',
    case when v_alloc_a = 12.00 and v_alloc_b = 3.00
          and v_landed_a = 92.00 and v_landed_b = 23.00
          and v_sum = 15.00 and v_freight = 15.00
          and (v_res ->> 'item_value')::numeric = 100.00
          and (v_res ->> 'total_value')::numeric = 115.00
          and (v_res ->> 'quantity')::int = 16
         then 'PASS' else 'FAIL' end,
    format('A=%s B=%s sum=%s', v_alloc_a, v_alloc_b, v_sum));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('4', '4.1 multi-item + frete proporcional', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 5 — Maior resto / centavo residual + frete zero.
-- =============================================================================
do $$
declare
  v_user uuid; v_a uuid; v_b uuid; v_c uuid; v_res jsonb;
  v_allocs numeric[]; v_sum numeric;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  select value::uuid into v_a from zz_fixtures where key = 'acc_a';
  select value::uuid into v_b from zz_fixtures where key = 'acc_b';
  select value::uuid into v_c from zz_fixtures where key = 'acc_c';

  -- 3 linhas iguais (10,00), frete 1,00 (100 centavos): 100*1000/3000 -> 33 r1000
  -- em cada; assigned 99; leftover 1 -> vai para a linha de MENOR line_number
  -- (empate total de resto). Parcelas: [0,34 ; 0,33 ; 0,33]. Σ = 1,00.
  v_res := public.register_accessory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('accessory_id', v_a::text, 'quantity', 1, 'total_value', 10.00),
      jsonb_build_object('accessory_id', v_b::text, 'quantity', 1, 'total_value', 10.00),
      jsonb_build_object('accessory_id', v_c::text, 'quantity', 1, 'total_value', 10.00)
    ),
    p_freight_value => 1.00,
    p_supplier_name => null, p_notes => null, p_occurred_at => now(),
    p_changed_by => v_user, p_idempotency_key => null
  );

  select array_agg((it ->> 'freight_allocated')::numeric order by (it ->> 'line_number')::int)
    into v_allocs from jsonb_array_elements(v_res -> 'items') it;
  select sum(x) into v_sum from unnest(v_allocs) x;

  insert into zz_test_results(section, test_name, status, details)
  values ('5',
    '5.1 maior resto: parcelas [0,34; 0,33; 0,33] (centavo residual na 1a linha por empate); Σ = 1,00; nenhuma negativa',
    case when v_allocs = array[0.34, 0.33, 0.33]::numeric[] and v_sum = 1.00 then 'PASS' else 'FAIL' end,
    format('allocs=%s sum=%s', v_allocs, v_sum));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('5', '5.1 maior resto', 'FAIL', sqlerrm);
end $$;

do $$
declare
  v_user uuid; v_a uuid; v_b uuid; v_res jsonb; v_sum numeric; v_max numeric;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  select value::uuid into v_a from zz_fixtures where key = 'acc_a';
  select value::uuid into v_b from zz_fixtures where key = 'acc_b';

  v_res := public.register_accessory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('accessory_id', v_a::text, 'quantity', 2, 'total_value', 33.33),
      jsonb_build_object('accessory_id', v_b::text, 'quantity', 3, 'total_value', 66.67)
    ),
    p_freight_value => 0,
    p_supplier_name => null, p_notes => null, p_occurred_at => now(),
    p_changed_by => v_user, p_idempotency_key => null
  );
  select sum((it ->> 'freight_allocated')::numeric), max((it ->> 'freight_allocated')::numeric)
    into v_sum, v_max from jsonb_array_elements(v_res -> 'items') it;

  insert into zz_test_results(section, test_name, status, details)
  values ('5',
    '5.2 frete zero -> freight_allocated 0,00 em TODAS as linhas; landed = total_value',
    case when v_sum = 0.00 and v_max = 0.00
          and (select bool_and((it ->> 'landed_total_value')::numeric = (it ->> 'total_value')::numeric)
               from jsonb_array_elements(v_res -> 'items') it)
         then 'PASS' else 'FAIL' end,
    format('sum=%s max=%s', v_sum, v_max));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('5', '5.2 frete zero', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 6 — Total EXATO por item mesmo quando o custo derivado dá dízima.
--
-- 6.1 usa um acessório FRESCO com estado semeado explicitamente (saldo 15,
-- unit_cost 1,47) — NUNCA um fixture reaproveitado por outras seções, para a
-- expectativa ser determinística e legível. (Versão anterior reusava acc_c,
-- que já passava pelas Seções 3 e 5.1: por 6.1 acc_c estava em saldo 16 /
-- custo 2,02, não 15 / 1,47 — a asserção 6.1 falhou por essa premissa errada
-- de estado acumulado, nunca por bug da implementação.)
-- =============================================================================
do $$
declare
  v_user uuid; v_acc uuid; v_res jsonb; v_item jsonb; v_cost numeric;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  v_acc := (public.create_accessory('TESTE COMPRAS ACESSÓRIO E', null, null, null, true, v_user)).id;
  perform public.register_stock_movement('ACCESSORY', v_acc, 'INITIAL_BALANCE', 15::numeric, v_user);
  update public.accessories set unit_cost = 1.47 where id = v_acc;

  -- 3 un por R$ 10,00, frete 0, sobre saldo 15 × 1,47 ->
  -- (15*1,47 + 10,00) / (15+3) = 32,05 / 18 = 1,780555… -> round(,2) = 1,78.
  -- O ledger mantém total_value/item_value EXATOS em 10,00 (nunca 9,99/10,02);
  -- só o unit_cost derivado é arredondado.
  v_res := public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 3, 'total_value', 10.00)),
    p_freight_value => 0,
    p_supplier_name => null, p_notes => null, p_occurred_at => now(),
    p_changed_by => v_user, p_idempotency_key => null
  );
  v_item := v_res -> 'items' -> 0;
  select unit_cost into v_cost from public.accessories where id = v_acc;

  insert into zz_test_results(section, test_name, status, details)
  values ('6',
    '6.1 total_value do item preservado EXATO em 10,00 (nunca 9,99/10,02); média ponderada sobre saldo 15×1,47 -> unit_cost 1,78',
    case when (v_item ->> 'total_value')::numeric = 10.00
          and (v_res ->> 'item_value')::numeric = 10.00
          and (v_res ->> 'total_value')::numeric = 10.00
          and v_cost = 1.78
          and (v_item ->> 'unit_cost_before')::numeric = 1.47
          and (v_item ->> 'unit_cost_after')::numeric = 1.78
         then 'PASS' else 'FAIL' end,
    format('item.total_value=%s header.item_value=%s cost_before=%s cost_after=%s',
      v_item ->> 'total_value', v_res ->> 'item_value', v_item ->> 'unit_cost_before', v_cost));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('6', '6.1 total exato', 'FAIL', sqlerrm);
end $$;

do $$
declare
  v_user uuid; v_acc uuid; v_res jsonb; v_item jsonb;
begin
  -- Caso puro do pedido, num acessório fresco: 3 un por 10,00, saldo 0, custo NULL -> 3,33.
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  v_acc := (public.create_accessory('TESTE COMPRAS ACESSÓRIO D', null, null, null, true, v_user)).id;

  v_res := public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 3, 'total_value', 10.00)),
    p_freight_value => 0,
    p_supplier_name => null, p_notes => null, p_occurred_at => now(),
    p_changed_by => v_user, p_idempotency_key => null
  );
  v_item := v_res -> 'items' -> 0;

  insert into zz_test_results(section, test_name, status, details)
  values ('6',
    '6.2 3 un por R$ 10,00 (saldo 0, custo NULL) -> unit_cost_after = R$ 3,33; ledger mantém 10,00',
    case when (v_item ->> 'unit_cost_after')::numeric = 3.33
          and (select unit_cost from public.accessories where id = v_acc) = 3.33
          and (v_item ->> 'total_value')::numeric = 10.00
         then 'PASS' else 'FAIL' end,
    format('unit_cost_after=%s', v_item ->> 'unit_cost_after'));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('6', '6.2 3 un R$ 10,00 -> 3,33', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 7 — Histórico PURCHASE + data efetiva + fornecedor/observação + referência.
-- =============================================================================
do $$
declare
  v_user uuid; v_acc uuid; v_res jsonb; v_mov public.stock_movements;
  v_occurred timestamptz := (now() - interval '3 days');
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  v_acc := (public.create_accessory('TESTE COMPRAS ACESSÓRIO HIST', null, null, null, true, v_user)).id;

  v_res := public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 4, 'total_value', 20.00)),
    p_freight_value => 0,
    p_supplier_name => 'Loja X', p_notes => 'reposicao mensal', p_occurred_at => v_occurred,
    p_changed_by => v_user, p_idempotency_key => null
  );

  select * into v_mov from public.stock_movements
    where item_type = 'ACCESSORY' and item_id = v_acc and movement_type = 'PURCHASE'
      and reference_id = (v_res ->> 'purchase_id')::uuid;

  insert into zz_test_results(section, test_name, status, details)
  values ('7',
    '7.1 movimento PURCHASE: quantity_delta +4, balance 0->4, occurred_at = data informada, reference_type/id = cabeçalho, reason "Fornecedor: Loja X — reposicao mensal"',
    case when v_mov.quantity_delta = 4
          and v_mov.balance_before = 0 and v_mov.balance_after = 4
          and v_mov.occurred_at = v_occurred
          and v_mov.reference_type = 'PURCHASE'
          and v_mov.reference_id = (v_res ->> 'purchase_id')::uuid
          and v_mov.reason = 'Fornecedor: Loja X — reposicao mensal'
          and (v_res ->> 'supplier_name') = 'Loja X'
          and (v_res ->> 'notes') = 'reposicao mensal'
          and (v_res ->> 'occurred_at')::timestamptz = v_occurred
         then 'PASS' else 'FAIL' end,
    format('reason=%s occurred=%s', v_mov.reason, v_mov.occurred_at));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('7', '7.1 histórico/data/fornecedor/referência', 'FAIL', sqlerrm);
end $$;

do $$
declare
  v_user uuid; v_acc uuid; v_r1 text; v_r2 text; v_r3 text; v_r4 text;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';

  v_acc := (public.create_accessory('TESTE COMPRAS ACESSÓRIO R1', null, null, null, true, v_user)).id;
  perform public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 1, 'total_value', 5.00)),
    p_freight_value => 0, p_supplier_name => 'Só Fornecedor', p_notes => null,
    p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
  select reason into v_r1 from public.stock_movements where item_type='ACCESSORY' and item_id=v_acc;

  v_acc := (public.create_accessory('TESTE COMPRAS ACESSÓRIO R2', null, null, null, true, v_user)).id;
  perform public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 1, 'total_value', 5.00)),
    p_freight_value => 0, p_supplier_name => null, p_notes => 'Só observacao',
    p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
  select reason into v_r2 from public.stock_movements where item_type='ACCESSORY' and item_id=v_acc;

  v_acc := (public.create_accessory('TESTE COMPRAS ACESSÓRIO R3', null, null, null, true, v_user)).id;
  perform public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 1, 'total_value', 5.00)),
    p_freight_value => 0, p_supplier_name => null, p_notes => null,
    p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
  select reason into v_r3 from public.stock_movements where item_type='ACCESSORY' and item_id=v_acc;

  v_acc := (public.create_accessory('TESTE COMPRAS ACESSÓRIO R4', null, null, null, true, v_user)).id;
  perform public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 1, 'total_value', 5.00)),
    p_freight_value => 0, p_supplier_name => '  Ambos  ', p_notes => '  obs  ',
    p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
  select reason into v_r4 from public.stock_movements where item_type='ACCESSORY' and item_id=v_acc;

  insert into zz_test_results(section, test_name, status, details)
  values ('7',
    '7.2 reason: só fornecedor / só observação / nenhum / ambos (com trim)',
    case when v_r1 = 'Fornecedor: Só Fornecedor'
          and v_r2 = 'Só observacao'
          and v_r3 = 'Compra de acessórios'
          and v_r4 = 'Fornecedor: Ambos — obs'
         then 'PASS' else 'FAIL' end,
    format('[%s] [%s] [%s] [%s]', v_r1, v_r2, v_r3, v_r4));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('7', '7.2 variações do reason', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 8 — Rejeições: acessório repetido / inativo / inexistente / quantidade
--           inválida / total inválido / lista vazia / >50 itens.
-- =============================================================================
do $$
declare
  v_user uuid; v_a uuid; v_inactive uuid; v_err text; v_many jsonb;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  select value::uuid into v_a from zz_fixtures where key = 'acc_a';
  select value::uuid into v_inactive from zz_fixtures where key = 'acc_inactive';

  begin
    perform public.register_accessory_purchase(
      p_items => jsonb_build_array(
        jsonb_build_object('accessory_id', v_a::text, 'quantity', 1, 'total_value', 5.00),
        jsonb_build_object('accessory_id', v_a::text, 'quantity', 2, 'total_value', 6.00)),
      p_freight_value => 0, p_supplier_name => null, p_notes => null,
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('8', '8.1 acessório repetido em duas linhas é recusado',
    case when v_err ilike '%repetido%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_accessory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_inactive::text, 'quantity', 1, 'total_value', 5.00)),
      p_freight_value => 0, p_supplier_name => null, p_notes => null,
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('8', '8.2 acessório inativo é recusado (INVENTORY_PURCHASE_ITEM_INACTIVE:)',
    case when v_err like 'INVENTORY_PURCHASE_ITEM_INACTIVE:%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_accessory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('accessory_id', gen_random_uuid()::text, 'quantity', 1, 'total_value', 5.00)),
      p_freight_value => 0, p_supplier_name => null, p_notes => null,
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('8', '8.3 acessório inexistente é recusado ("não encontrado")',
    case when v_err ilike '%não encontrado%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_accessory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_a::text, 'quantity', 0, 'total_value', 5.00)),
      p_freight_value => 0, p_supplier_name => null, p_notes => null,
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('8', '8.4 quantidade 0 é recusada',
    case when v_err ilike '%quantity%' or v_err ilike '%inteiro positivo%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_accessory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_a::text, 'quantity', 1.5, 'total_value', 5.00)),
      p_freight_value => 0, p_supplier_name => null, p_notes => null,
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('8', '8.5 quantidade fracionada é recusada',
    case when v_err ilike '%sem casas decimais%' or v_err ilike '%inteiro%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_accessory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_a::text, 'quantity', 1, 'total_value', 0)),
      p_freight_value => 0, p_supplier_name => null, p_notes => null,
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('8', '8.6 total_value 0 é recusado',
    case when v_err ilike '%total_value%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_accessory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_a::text, 'quantity', 1, 'total_value', -1)),
      p_freight_value => 0, p_supplier_name => null, p_notes => null,
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('8', '8.7 total_value negativo é recusado',
    case when v_err ilike '%total_value%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_accessory_purchase(
      p_items => '[]'::jsonb, p_freight_value => 0, p_supplier_name => null, p_notes => null,
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('8', '8.8 lista de itens vazia é recusada',
    case when v_err ilike '%1 a 50 itens%' then 'PASS' else 'FAIL' end, v_err);

  select jsonb_agg(jsonb_build_object('accessory_id', gen_random_uuid()::text, 'quantity', 1, 'total_value', 1))
    into v_many from generate_series(1, 51);
  begin
    perform public.register_accessory_purchase(
      p_items => v_many, p_freight_value => 0, p_supplier_name => null, p_notes => null,
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('8', '8.9 mais de 50 itens é recusado (antes de qualquer escrita)',
    case when v_err ilike '%no máximo 50 itens%' then 'PASS' else 'FAIL' end, v_err);
end $$;

-- =============================================================================
-- SEÇÃO 9 — Determinismo do rateio + idempotência (caminho antecipado).
-- =============================================================================
do $$
declare
  v_user uuid; v_a uuid; v_b uuid;
  v_res1 jsonb; v_res2 jsonb;
  v_c1 jsonb; v_c2 jsonb;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  v_a := (public.create_accessory('TESTE COMPRAS ACESSÓRIO DET1', null, null, null, true, v_user)).id;
  v_b := (public.create_accessory('TESTE COMPRAS ACESSÓRIO DET2', null, null, null, true, v_user)).id;

  -- Mesmo payload, duas chamadas (chaves diferentes) -> rateio idêntico por
  -- acessório (determinismo).
  v_res1 := public.register_accessory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('accessory_id', v_a::text, 'quantity', 3, 'total_value', 12.34),
      jsonb_build_object('accessory_id', v_b::text, 'quantity', 7, 'total_value', 56.78)),
    p_freight_value => 9.99, p_supplier_name => null, p_notes => null,
    p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
  v_res2 := public.register_accessory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('accessory_id', v_a::text, 'quantity', 3, 'total_value', 12.34),
      jsonb_build_object('accessory_id', v_b::text, 'quantity', 7, 'total_value', 56.78)),
    p_freight_value => 9.99, p_supplier_name => null, p_notes => null,
    p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);

  select jsonb_agg((it ->> 'freight_allocated') order by (it ->> 'accessory_id'))
    into v_c1 from jsonb_array_elements(v_res1 -> 'items') it;
  select jsonb_agg((it ->> 'freight_allocated') order by (it ->> 'accessory_id'))
    into v_c2 from jsonb_array_elements(v_res2 -> 'items') it;

  insert into zz_test_results(section, test_name, status, details)
  values ('9', '9.1 rateio determinístico: mesma entrada -> mesmas parcelas por acessório',
    case when v_c1 = v_c2 then 'PASS' else 'FAIL' end, format('%s vs %s', v_c1, v_c2));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('9', '9.1 determinismo', 'FAIL', sqlerrm);
end $$;

do $$
declare
  v_user uuid; v_a uuid; v_b uuid; v_key text := 'acc-purchase-idem-' || gen_random_uuid()::text;
  v_res1 jsonb; v_res2 jsonb; v_err text;
  v_stock_after_first integer; v_stock_after_second integer;
  v_cost_after_first numeric; v_cost_after_second numeric;
  v_mov_count integer;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  v_a := (public.create_accessory('TESTE COMPRAS ACESSÓRIO IDEM A', null, null, null, true, v_user)).id;
  v_b := (public.create_accessory('TESTE COMPRAS ACESSÓRIO IDEM B', null, null, null, true, v_user)).id;

  v_res1 := public.register_accessory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('accessory_id', v_a::text, 'quantity', 2, 'total_value', 10.00),
      jsonb_build_object('accessory_id', v_b::text, 'quantity', 3, 'total_value', 20.00)),
    p_freight_value => 3.00, p_supplier_name => 'Loja', p_notes => 'obs',
    p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => v_key);
  select current_stock into v_stock_after_first from public.accessories where id = v_a;
  select unit_cost into v_cost_after_first from public.accessories where id = v_a;

  -- Repetição EXATA da mesma chave + mesmo payload -> devolve a mesma compra,
  -- sem novo movimento, sem novo aumento de saldo/custo.
  v_res2 := public.register_accessory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('accessory_id', v_a::text, 'quantity', 2, 'total_value', 10.00),
      jsonb_build_object('accessory_id', v_b::text, 'quantity', 3, 'total_value', 20.00)),
    p_freight_value => 3.00, p_supplier_name => 'Loja', p_notes => 'obs',
    p_occurred_at => now() + interval '1 hour', p_changed_by => v_user, p_idempotency_key => v_key);
  select current_stock into v_stock_after_second from public.accessories where id = v_a;
  select unit_cost into v_cost_after_second from public.accessories where id = v_a;
  select count(*) into v_mov_count from public.stock_movements
    where item_type = 'ACCESSORY' and item_id = v_a and reference_id = (v_res1 ->> 'purchase_id')::uuid;

  insert into zz_test_results(section, test_name, status, details)
  values ('9',
    '9.2 idempotência: mesma chave + mesmo payload devolve a mesma compra; saldo/custo/movimentos NÃO se repetem (occurred_at fica de fora da comparação)',
    case when (v_res1 ->> 'purchase_id') = (v_res2 ->> 'purchase_id')
          and v_stock_after_first = v_stock_after_second
          and v_cost_after_first = v_cost_after_second
          and v_mov_count = 1
         then 'PASS' else 'FAIL' end,
    format('stock=%s/%s cost=%s/%s mov=%s', v_stock_after_first, v_stock_after_second, v_cost_after_first, v_cost_after_second, v_mov_count));

  begin
    perform public.register_accessory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_a::text, 'quantity', 9, 'total_value', 99.00)),
      p_freight_value => 3.00, p_supplier_name => 'Loja', p_notes => 'obs',
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => v_key);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('9', '9.3 idempotência: mesma chave + payload DIFERENTE é rejeitada (IDEMPOTENCY_KEY_CONFLICT:)',
    case when v_err like 'IDEMPOTENCY_KEY_CONFLICT:%' then 'PASS' else 'FAIL' end, v_err);
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('9', '9.2/9.3 idempotência', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 10 — Rollback integral: falha no MEIO da chamada não deixa cabeçalho,
--            itens, movimentos, saldo nem custo. (2o item inativo.)
-- =============================================================================
do $$
declare
  v_user uuid; v_ok uuid; v_inactive uuid;
  v_stock_before integer; v_cost_before numeric;
  v_stock_after integer; v_cost_after numeric;
  v_header_count integer; v_item_count integer; v_mov_count integer; v_err text;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  select value::uuid into v_inactive from zz_fixtures where key = 'acc_inactive';
  v_ok := (public.create_accessory('TESTE COMPRAS ACESSÓRIO ROLLBACK', null, null, null, true, v_user)).id;
  perform public.register_stock_movement('ACCESSORY', v_ok, 'INITIAL_BALANCE', 4::numeric, v_user);
  update public.accessories set unit_cost = 2.50 where id = v_ok;
  select current_stock, unit_cost into v_stock_before, v_cost_before from public.accessories where id = v_ok;

  begin
    perform public.register_accessory_purchase(
      p_items => jsonb_build_array(
        jsonb_build_object('accessory_id', v_ok::text, 'quantity', 5, 'total_value', 30.00),
        jsonb_build_object('accessory_id', v_inactive::text, 'quantity', 1, 'total_value', 10.00)),
      p_freight_value => 5.00, p_supplier_name => 'X', p_notes => 'Y',
      p_occurred_at => now(), p_changed_by => v_user, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;

  select current_stock, unit_cost into v_stock_after, v_cost_after from public.accessories where id = v_ok;
  select count(*) into v_header_count from public.inventory_purchases
    where category = 'ACCESSORY' and notes = 'Y' and supplier_name = 'X';
  select count(*) into v_item_count from public.inventory_purchase_accessory_items where accessory_id = v_ok;
  select count(*) into v_mov_count from public.stock_movements
    where item_type = 'ACCESSORY' and item_id = v_ok and movement_type = 'PURCHASE';

  insert into zz_test_results(section, test_name, status, details)
  values ('10',
    '10.1 falha no 2o item (inativo) desfaz TUDO: erro levantado; sem cabeçalho/itens/movimento; saldo e custo do 1o item intactos',
    case when v_err like 'INVENTORY_PURCHASE_ITEM_INACTIVE:%'
          and v_header_count = 0 and v_item_count = 0 and v_mov_count = 0
          and v_stock_after = v_stock_before and v_cost_after = v_cost_before
         then 'PASS' else 'FAIL' end,
    format('err=%s header=%s item=%s mov=%s stock=%s/%s cost=%s/%s',
      v_err, v_header_count, v_item_count, v_mov_count, v_stock_before, v_stock_after, v_cost_before, v_cost_after));
end $$;

-- =============================================================================
-- SEÇÃO 11 — Grants / imutabilidade / schema.
-- =============================================================================
do $$
declare
  v_anon boolean; v_auth boolean; v_service boolean;
  v_build_anon boolean; v_canon_anon boolean;
  v_auth_sel boolean; v_auth_ins boolean; v_auth_upd boolean; v_auth_del boolean;
  v_rls boolean; v_supplier_col boolean;
begin
  v_anon := has_function_privilege('anon',
    'public.register_accessory_purchase(jsonb, numeric, text, text, timestamptz, uuid, text)', 'EXECUTE');
  v_auth := has_function_privilege('authenticated',
    'public.register_accessory_purchase(jsonb, numeric, text, text, timestamptz, uuid, text)', 'EXECUTE');
  v_service := has_function_privilege('service_role',
    'public.register_accessory_purchase(jsonb, numeric, text, text, timestamptz, uuid, text)', 'EXECUTE');

  v_build_anon := has_function_privilege('authenticated', 'public._build_accessory_purchase_summary(uuid)', 'EXECUTE');
  v_canon_anon := has_function_privilege('authenticated', 'public._accessory_purchase_items_canonical(uuid)', 'EXECUTE');

  v_auth_sel := has_table_privilege('authenticated', 'public.inventory_purchase_accessory_items', 'SELECT');
  v_auth_ins := has_table_privilege('authenticated', 'public.inventory_purchase_accessory_items', 'INSERT');
  v_auth_upd := has_table_privilege('authenticated', 'public.inventory_purchase_accessory_items', 'UPDATE');
  v_auth_del := has_table_privilege('authenticated', 'public.inventory_purchase_accessory_items', 'DELETE');

  select relrowsecurity into v_rls from pg_class where oid = 'public.inventory_purchase_accessory_items'::regclass;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_purchases' and column_name = 'supplier_name'
  ) into v_supplier_col;

  insert into zz_test_results(section, test_name, status, details)
  values ('11',
    '11.1 register_accessory_purchase EXECUTE só service_role; _build/_canonical sem grant a authenticated',
    case when v_anon is false and v_auth is false and v_service is true
          and v_build_anon is false and v_canon_anon is false
         then 'PASS' else 'FAIL' end,
    format('anon=%s auth=%s service=%s build_auth=%s canon_auth=%s', v_anon, v_auth, v_service, v_build_anon, v_canon_anon));

  insert into zz_test_results(section, test_name, status, details)
  values ('11',
    '11.2 inventory_purchase_accessory_items: SELECT a authenticated; NUNCA INSERT/UPDATE/DELETE; RLS habilitada; supplier_name existe em inventory_purchases',
    case when v_auth_sel is true and v_auth_ins is false and v_auth_upd is false and v_auth_del is false
          and v_rls is true and v_supplier_col is true
         then 'PASS' else 'FAIL' end,
    format('sel=%s ins=%s upd=%s del=%s rls=%s supplier=%s', v_auth_sel, v_auth_ins, v_auth_upd, v_auth_del, v_rls, v_supplier_col));
end $$;

do $$
declare v_err text;
begin
  begin
    insert into public.inventory_purchases (category, item_id, quantity, item_value, freight_value, occurred_at, created_by, supplier_name)
    select 'ACCESSORY', null, 1, 1.00, 0, now(), (select value::uuid from zz_fixtures where key='user_id'), '   ';
    v_err := 'sem erro';
  exception when check_violation then v_err := 'check_violation';
           when others then v_err := sqlerrm;
  end;
  insert into zz_test_results(section, test_name, status, details)
  values ('11', '11.4 supplier_name só-espaços viola a CHECK inventory_purchases_supplier_name_not_blank',
    case when v_err = 'check_violation' then 'PASS' else 'FAIL' end, v_err);
end $$;

-- =============================================================================
-- SEÇÃO 12 — NÃO REGRESSÃO: PACKAGING (register_inventory_purchase) e
--            register_filament_purchase permanecem intactos.
-- =============================================================================
do $$
declare
  v_user uuid; v_pkg uuid; v_purchase public.inventory_purchases;
  v_stock integer; v_cost_before numeric; v_cost_after numeric; v_mov integer;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  select value::uuid into v_pkg  from zz_fixtures where key = 'pkg';
  select unit_cost into v_cost_before from public.packaging where id = v_pkg;

  v_purchase := public.register_inventory_purchase(
    p_category => 'PACKAGING', p_quantity => 7, p_item_value => 35.00, p_freight_value => 5.00,
    p_changed_by => v_user, p_item_id => v_pkg
  );
  select current_stock, unit_cost into v_stock, v_cost_after from public.packaging where id = v_pkg;
  select count(*) into v_mov from public.stock_movements
    where item_type = 'PACKAGING' and item_id = v_pkg and movement_type = 'PURCHASE'
      and reference_id = v_purchase.id and quantity_delta = 7;

  insert into zz_test_results(section, test_name, status, details)
  values ('12',
    '12.1 PACKAGING inalterado: register_inventory_purchase soma current_stock (+7), grava movimento PURCHASE, total_value 40,00; unit_cost de packaging NÃO é tocado',
    case when v_purchase.category = 'PACKAGING' and v_purchase.total_value = 40.00
          and v_stock = 7 and v_mov = 1
          and v_cost_after is not distinct from v_cost_before
         then 'PASS' else 'FAIL' end,
    format('stock=%s mov=%s cost=%s/%s', v_stock, v_mov, v_cost_before, v_cost_after));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('12', '12.1 regressão PACKAGING', 'FAIL', sqlerrm);
end $$;

do $$
declare
  v_user uuid; v_ft uuid; v_res jsonb; v_item jsonb; v_spool_count integer;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user_id';
  v_ft := (public.create_filament_type('PLA', 'TESTE COMPRAS FIL', 'Sólida', 'TESTE cor compras', null, null, true, null, v_user)).id;

  v_res := public.register_filament_purchase(
    p_freight_value => 0,
    p_changed_by => v_user,
    p_items => jsonb_build_array(jsonb_build_object(
      'filament_type_id', v_ft::text, 'manufacturer', 'MarcaX',
      'nominal_weight_grams', 1000, 'quantity', 3, 'total_value', 100.00)),
    p_occurred_at => now(), p_notes => null, p_idempotency_key => null,
    p_purchase_channel => 'PRESENCIAL'
  );
  v_item := v_res -> 'items' -> 0;
  select jsonb_array_length(v_item -> 'spool_ids') into v_spool_count;

  insert into zz_test_results(section, test_name, status, details)
  values ('12',
    '12.2 register_filament_purchase inalterado: 3 rolos criados, total_value exato 100,00 no item e no subtotal do cabeçalho',
    case when v_spool_count = 3
          and (v_item ->> 'total_value')::numeric = 100.00
          and (v_res ->> 'subtotal_value')::numeric = 100.00
          and (v_res ->> 'total_value')::numeric = 100.00
         then 'PASS' else 'FAIL' end,
    format('spools=%s item=%s', v_spool_count, v_item));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('12', '12.2 regressão FILAMENT', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- RESULTADO
-- =============================================================================
select section, test_name, status, details from zz_test_results order by seq;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from zz_test_results where status <> 'PASS';
  if v_fail > 0 then
    raise exception 'accessory_purchase_test: % teste(s) falharam', v_fail;
  end if;
  raise notice 'accessory_purchase_test: todos os testes passaram';
end $$;

rollback;
