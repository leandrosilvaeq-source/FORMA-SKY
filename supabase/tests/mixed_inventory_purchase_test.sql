-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- TESTE DE INTEGRAÇÃO transacional da COMPRA MISTA
-- (migration 20260906150000_register_mixed_inventory_purchases.sql:
--  inventory_purchase_packaging_items, freight_allocated/landed_total_value/
--  line_number em inventory_purchase_filament_items, _mixed_allocate_freight_cents,
--  _mixed_purchase_items_canonical, _build_mixed_purchase_summary,
--  register_mixed_inventory_purchase; category='MIXED', purchase_channel
--  'OUTRO_SITE', CHECKs de MIXED).
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nada persiste. Só usa registros
-- "TESTE MISTA %", nunca dados oficiais.
--
-- Execução (após a migration 20260906150000 ser aplicada):
--   npx supabase db query --linked --file supabase/tests/mixed_inventory_purchase_test.sql
--
-- LIMITAÇÃO DE AMBIENTE: a migration 20260906150000 ainda NÃO foi aplicada
-- ao Supabase remoto e não há Supabase local rodando nesta sessão — ESTE
-- SCRIPT NÃO FOI EXECUTADO. Escrito seguindo o padrão de
-- supabase/tests/accessory_purchase_test.sql e filament_purchase_test.sql.
--
-- LIMITAÇÃO CONHECIDA (mesma dos arquivos irmãos): uma única transação/
-- conexão não exercita concorrência real de duas sessões — a Seção 21
-- cobre o determinismo do rateio e o caminho antecipado da idempotência; a
-- serialização real por FOR UPDATE em ordem ascendente de id é garantida
-- por leitura de código. A Seção 22 (rollback integral) É exercitável numa
-- transação só — depende só de uma falha no meio de uma chamada, revertida
-- pelo savepoint implícito do bloco DO/EXCEPTION.
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
-- SEÇÃO 0 — Setup: usuário + 3 filament_types + 3 acessórios + 3 embalagens
--           (+ 1 de cada inativo) + 1 acessório e 1 embalagem com saldo/custo.
-- =============================================================================
do $$
declare
  v_user uuid;
  v_ft_a uuid; v_ft_b uuid; v_ft_inactive uuid;
  v_acc_a uuid; v_acc_b uuid; v_acc_seed uuid; v_acc_inactive uuid;
  v_pkg_a uuid; v_pkg_b uuid; v_pkg_seed uuid; v_pkg_inactive uuid;
begin
  select id into v_user from public.users where is_active order by created_at limit 1;
  if v_user is null then raise exception 'nenhum usuário ativo em public.users'; end if;

  v_ft_a := (public.create_filament_type('PLA', 'TESTE MISTA FIL', 'Sólida', 'TESTE MISTA cor A', null, null, true, null, v_user)).id;
  v_ft_b := (public.create_filament_type('PETG', 'TESTE MISTA FIL', 'Sólida', 'TESTE MISTA cor B', null, null, true, null, v_user)).id;
  v_ft_inactive := (public.create_filament_type('TPU', 'TESTE MISTA FIL', 'Sólida', 'TESTE MISTA cor INATIVA', null, null, false, null, v_user)).id;

  v_acc_a := (public.create_accessory('TESTE MISTA ACESSORIO A', null, null, null, true, v_user)).id;
  v_acc_b := (public.create_accessory('TESTE MISTA ACESSORIO B', null, null, null, true, v_user)).id;
  v_acc_seed := (public.create_accessory('TESTE MISTA ACESSORIO SEED', null, null, null, true, v_user)).id;
  v_acc_inactive := (public.create_accessory('TESTE MISTA ACESSORIO INATIVO', null, null, null, false, v_user)).id;
  -- seed: saldo 10, custo 3,00
  perform public.register_stock_movement('ACCESSORY', v_acc_seed, 'INITIAL_BALANCE', 10::numeric, v_user);
  update public.accessories set unit_cost = 3.00 where id = v_acc_seed;

  v_pkg_a := (public.create_packaging('TESTE MISTA EMBALAGEM A', null, null, null, true, v_user)).id;
  v_pkg_b := (public.create_packaging('TESTE MISTA EMBALAGEM B', null, null, null, true, v_user)).id;
  v_pkg_seed := (public.create_packaging('TESTE MISTA EMBALAGEM SEED', null, null, null, true, v_user)).id;
  v_pkg_inactive := (public.create_packaging('TESTE MISTA EMBALAGEM INATIVA', null, null, null, false, v_user)).id;
  -- seed: saldo 4, custo 1,50
  perform public.register_stock_movement('PACKAGING', v_pkg_seed, 'INITIAL_BALANCE', 4::numeric, v_user);
  update public.packaging set unit_cost = 1.50 where id = v_pkg_seed;

  insert into zz_fixtures(key, value) values
    ('user', v_user::text),
    ('ft_a', v_ft_a::text), ('ft_b', v_ft_b::text), ('ft_inactive', v_ft_inactive::text),
    ('acc_a', v_acc_a::text), ('acc_b', v_acc_b::text), ('acc_seed', v_acc_seed::text), ('acc_inactive', v_acc_inactive::text),
    ('pkg_a', v_pkg_a::text), ('pkg_b', v_pkg_b::text), ('pkg_seed', v_pkg_seed::text), ('pkg_inactive', v_pkg_inactive::text)
  on conflict (key) do update set value = excluded.value;

  insert into zz_test_results(section, test_name, status, details)
    values ('0', '0.1 setup', 'PASS', 'user=' || v_user);
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('0', '0.1 setup', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 1–15 — Compra com as três categorias: um cabeçalho MIXED, um frete
--   rateado sobre TODAS as linhas, total exato, rolos/movimentos/saldos/
--   custos, ordem global, custo do filamento COM frete, data sem fuso.
-- =============================================================================
do $$
declare
  v_user uuid; v_ft_a uuid; v_ft_b uuid; v_acc_a uuid; v_acc_seed uuid; v_pkg_a uuid; v_pkg_seed uuid;
  v_res jsonb; v_items jsonb; v_headers int;
  v_it1 jsonb; v_it2 jsonb; v_it3 jsonb; v_it4 jsonb; v_it5 jsonb;
  v_freight_sum numeric; v_subtotal numeric;
  v_acc_stock int; v_acc_cost numeric; v_pkg_stock int; v_pkg_cost numeric;
  v_acc_seed_stock int; v_acc_seed_cost numeric; v_pkg_seed_stock int; v_pkg_seed_cost numeric;
  v_spool_count int; v_mov_fil int; v_mov_acc int; v_mov_pkg int;
  v_occ date; v_stored_date date; v_mov_date date;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';
  select value::uuid into v_ft_a from zz_fixtures where key = 'ft_a';
  select value::uuid into v_ft_b from zz_fixtures where key = 'ft_b';
  select value::uuid into v_acc_a from zz_fixtures where key = 'acc_a';
  select value::uuid into v_acc_seed from zz_fixtures where key = 'acc_seed';
  select value::uuid into v_pkg_a from zz_fixtures where key = 'pkg_a';
  select value::uuid into v_pkg_seed from zz_fixtures where key = 'pkg_seed';
  v_occ := date '2026-09-06';

  -- ORDEM GLOBAL: 1 FILAMENT(ft_a), 2 ACCESSORY(acc_a, saldo0/custoNULL),
  -- 3 PACKAGING(pkg_seed, saldo4/custo1,50), 4 FILAMENT(ft_b),
  -- 5 ACCESSORY(acc_seed, saldo10/custo3,00). Frete 10,00.
  v_res := public.register_mixed_inventory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('category','FILAMENT','filament_type_id',v_ft_a::text,'manufacturer','Voolt','nominal_weight_grams',1000,'quantity',2,'total_value',100.00),
      jsonb_build_object('category','ACCESSORY','accessory_id',v_acc_a::text,'quantity',5,'total_value',20.00),
      jsonb_build_object('category','PACKAGING','packaging_id',v_pkg_seed::text,'quantity',6,'total_value',30.00),
      jsonb_build_object('category','FILAMENT','filament_type_id',v_ft_b::text,'manufacturer','Bambu Lab','nominal_weight_grams',1000,'quantity',1,'total_value',50.00),
      jsonb_build_object('category','ACCESSORY','accessory_id',v_acc_seed::text,'quantity',10,'total_value',60.00)),
    p_freight_value => 10.00,
    p_purchase_channel => 'MERCADO_LIVRE',
    p_occurred_on => v_occ,
    p_changed_by => v_user,
    p_supplier_name => null,
    p_idempotency_key => null
  );
  v_items := v_res -> 'items';
  v_it1 := v_items -> 0; v_it2 := v_items -> 1; v_it3 := v_items -> 2; v_it4 := v_items -> 3; v_it5 := v_items -> 4;

  -- 2. um único cabeçalho MIXED
  select count(*) into v_headers from public.inventory_purchases where id = (v_res ->> 'purchase_id')::uuid and category = 'MIXED';
  insert into zz_test_results(section, test_name, status, details)
  values ('2', '2.1 um único cabeçalho category=MIXED, item_id NULL, quantity=24, subtotal=260,00, total=270,00',
    case when v_headers = 1
          and (v_res ->> 'category') = 'MIXED'
          and (v_res ->> 'quantity')::int = 24
          and (v_res ->> 'subtotal_value')::numeric = 260.00
          and (v_res ->> 'freight_value')::numeric = 10.00
          and (v_res ->> 'total_value')::numeric = 270.00
          and (select item_id from public.inventory_purchases where id = (v_res ->> 'purchase_id')::uuid) is null
         then 'PASS' else 'FAIL' end, v_res::text);

  -- 3+4+5. um frete único, rateado entre TODAS as 5 linhas, fecha exato
  select sum((it ->> 'freight_allocated')::numeric) into v_freight_sum from jsonb_array_elements(v_items) it;
  insert into zz_test_results(section, test_name, status, details)
  values ('5', '5.1 Σ freight_allocated (5 linhas, 3 categorias) = 10,00 exato; nenhuma parcela negativa',
    case when v_freight_sum = 10.00
          and not exists (select 1 from jsonb_array_elements(v_items) it where (it ->> 'freight_allocated')::numeric < 0)
         then 'PASS' else 'FAIL' end, format('Σ=%s allocs=%s', v_freight_sum,
      (select jsonb_agg((it->>'freight_allocated')) from jsonb_array_elements(v_items) it)));

  -- 15. ordem global preservada (line_number 1..5, categorias na ordem enviada)
  insert into zz_test_results(section, test_name, status, details)
  values ('15', '15.1 items[] em ordem global: line_number 1..5 e categorias FILAMENT/ACCESSORY/PACKAGING/FILAMENT/ACCESSORY',
    case when (v_it1 ->> 'line_number')::int = 1 and (v_it1 ->> 'category') = 'FILAMENT'
          and (v_it2 ->> 'line_number')::int = 2 and (v_it2 ->> 'category') = 'ACCESSORY'
          and (v_it3 ->> 'line_number')::int = 3 and (v_it3 ->> 'category') = 'PACKAGING'
          and (v_it4 ->> 'line_number')::int = 4 and (v_it4 ->> 'category') = 'FILAMENT'
          and (v_it5 ->> 'line_number')::int = 5 and (v_it5 ->> 'category') = 'ACCESSORY'
         then 'PASS' else 'FAIL' end, v_items::text);

  -- 8+9. rolos criados (3 no total: 2 + 1) e movimentos PURCHASE de filamento
  select count(*) into v_spool_count from public.filament_spools
    where purchase_id = (v_res ->> 'purchase_id')::uuid;
  select count(*) into v_mov_fil from public.filament_movements
    where reference_type = 'PURCHASE' and reference_id = (v_res ->> 'purchase_id')::uuid and movement_type = 'PURCHASE';
  insert into zz_test_results(section, test_name, status, details)
  values ('8', '8.1 3 rolos criados (2 do ft_a + 1 do ft_b), cada um com purchase_item_id e movimento PURCHASE (saldo = peso nominal)',
    case when v_spool_count = 3 and v_mov_fil = 3
          and jsonb_array_length(v_it1 -> 'spool_ids') = 2
          and jsonb_array_length(v_it4 -> 'spool_ids') = 1
         then 'PASS' else 'FAIL' end, format('spools=%s mov=%s', v_spool_count, v_mov_fil));

  -- 14. custo do filamento COM frete: (total_value + freight_allocated)/qtd
  insert into zz_test_results(section, test_name, status, details)
  values ('14', '14.1 Filamento: landed_total_value = total_value + freight_allocated; custo desta compra/un. inclui frete',
    case when (v_it1 ->> 'landed_total_value')::numeric = (v_it1 ->> 'total_value')::numeric + (v_it1 ->> 'freight_allocated')::numeric
          and (v_it1 ->> 'total_value')::numeric = 100.00
          and (v_it1 ->> 'freight_allocated')::numeric > 0
         then 'PASS' else 'FAIL' end, v_it1::text);

  -- 10. saldo de acessórios
  select current_stock, unit_cost into v_acc_stock, v_acc_cost from public.accessories where id = v_acc_a;
  select count(*) into v_mov_acc from public.stock_movements
    where item_type='ACCESSORY' and item_id=v_acc_a and movement_type='PURCHASE'
      and reference_id=(v_res ->> 'purchase_id')::uuid and quantity_delta=5;
  insert into zz_test_results(section, test_name, status, details)
  values ('10', '10.1 acessório acc_a: current_stock 0 -> 5; 1 movimento PURCHASE ref cabeçalho',
    case when v_acc_stock = 5 and v_mov_acc = 1 and (v_it2 ->> 'balance_before')::int = 0 and (v_it2 ->> 'balance_after')::int = 5
         then 'PASS' else 'FAIL' end, format('stock=%s mov=%s', v_acc_stock, v_mov_acc));

  -- 11. saldo de embalagens
  select current_stock into v_pkg_stock from public.packaging where id = v_pkg_seed;
  select count(*) into v_mov_pkg from public.stock_movements
    where item_type='PACKAGING' and item_id=v_pkg_seed and movement_type='PURCHASE'
      and reference_id=(v_res ->> 'purchase_id')::uuid and quantity_delta=6;
  insert into zz_test_results(section, test_name, status, details)
  values ('11', '11.1 embalagem pkg_seed: current_stock 4 -> 10; 1 movimento PURCHASE ref cabeçalho',
    case when v_pkg_stock = 10 and v_mov_pkg = 1 and (v_it3 ->> 'balance_before')::int = 4 and (v_it3 ->> 'balance_after')::int = 10
         then 'PASS' else 'FAIL' end, format('stock=%s mov=%s', v_pkg_stock, v_mov_pkg));

  -- 13. saldo 0 / custo NULL: unit_cost = landed_total/qtd (sem diluição)
  insert into zz_test_results(section, test_name, status, details)
  values ('13', '13.1 acc_a (saldo 0, custo NULL): unit_cost_after = landed_total/5, sem diluir; unit_cost_before NULL',
    case when (v_it2 ->> 'unit_cost_before') is null
          and (v_it2 ->> 'unit_cost_after')::numeric
              = round(((v_it2 ->> 'total_value')::numeric + (v_it2 ->> 'freight_allocated')::numeric) / 5, 2)
          and v_acc_cost = (v_it2 ->> 'unit_cost_after')::numeric
         then 'PASS' else 'FAIL' end, v_it2::text);

  -- 12. média ponderada: acc_seed (saldo 10, custo 3,00), compra 10 un
  select unit_cost into v_acc_seed_cost from public.accessories where id = v_acc_seed;
  insert into zz_test_results(section, test_name, status, details)
  values ('12', '12.1 acc_seed (saldo 10 × 3,00): unit_cost_after = round((10×3,00 + landed_total)/(10+10), 2)',
    case when (v_it5 ->> 'unit_cost_before')::numeric = 3.00
          and (v_it5 ->> 'unit_cost_after')::numeric
              = round((10 * 3.00 + (v_it5 ->> 'landed_total_value')::numeric) / 20, 2)
          and v_acc_seed_cost = (v_it5 ->> 'unit_cost_after')::numeric
         then 'PASS' else 'FAIL' end, v_it5::text);

  -- 12b. média ponderada em EMBALAGEM (pkg_seed, saldo 4 × 1,50)
  select unit_cost into v_pkg_seed_cost from public.packaging where id = v_pkg_seed;
  insert into zz_test_results(section, test_name, status, details)
  values ('12', '12.2 pkg_seed (saldo 4 × 1,50): packaging.unit_cost passa a ser CALCULADO por média ponderada móvel',
    case when (v_it3 ->> 'unit_cost_before')::numeric = 1.50
          and (v_it3 ->> 'unit_cost_after')::numeric
              = round((4 * 1.50 + (v_it3 ->> 'landed_total_value')::numeric) / 10, 2)
          and v_pkg_seed_cost = (v_it3 ->> 'unit_cost_after')::numeric
         then 'PASS' else 'FAIL' end, v_it3::text);

  -- 7. total exato: item_value = soma exata das linhas
  select sum((it ->> 'total_value')::numeric) into v_subtotal from jsonb_array_elements(v_items) it;
  insert into zz_test_results(section, test_name, status, details)
  values ('7', '7.1 item_value do cabeçalho = Σ exata dos total_value das linhas (260,00); total_value gerado = 270,00',
    case when v_subtotal = 260.00 and (v_res ->> 'subtotal_value')::numeric = v_subtotal then 'PASS' else 'FAIL' end,
    format('Σlinhas=%s header=%s', v_subtotal, v_res ->> 'subtotal_value'));

  -- 26. data sem mudança por fuso: cabeçalho e movimentos ficam em 2026-09-06
  select (occurred_at at time zone 'America/Sao_Paulo')::date into v_stored_date
    from public.inventory_purchases where id = (v_res ->> 'purchase_id')::uuid;
  select min((occurred_at at time zone 'America/Sao_Paulo')::date) into v_mov_date
    from public.stock_movements where reference_id = (v_res ->> 'purchase_id')::uuid;
  insert into zz_test_results(section, test_name, status, details)
  values ('26', '26.1 p_occurred_on 2026-09-06 permanece 06/09/2026 no cabeçalho, movimentos e received_at dos rolos (America/Sao_Paulo)',
    case when v_stored_date = date '2026-09-06'
          and v_mov_date = date '2026-09-06'
          and not exists (select 1 from public.filament_spools where purchase_id = (v_res ->> 'purchase_id')::uuid and received_at <> date '2026-09-06')
         then 'PASS' else 'FAIL' end, format('header=%s mov=%s', v_stored_date, v_mov_date));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('1', '1.x compra mista base', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 6 — Frete ZERO -> todas as parcelas 0.
-- =============================================================================
do $$
declare
  v_user uuid; v_acc uuid; v_pkg uuid; v_res jsonb;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';
  v_acc := (public.create_accessory('TESTE MISTA ACESSORIO F0', null, null, null, true, v_user)).id;
  v_pkg := (public.create_packaging('TESTE MISTA EMBALAGEM F0', null, null, null, true, v_user)).id;

  v_res := public.register_mixed_inventory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',3,'total_value',12.34),
      jsonb_build_object('category','PACKAGING','packaging_id',v_pkg::text,'quantity',7,'total_value',56.78)),
    p_freight_value => 0, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
    p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);

  insert into zz_test_results(section, test_name, status, details)
  values ('6', '6.1 frete 0 -> freight_allocated 0 em todas as linhas; landed_total = total_value; unit_cost = total/qtd',
    case when (select bool_and((it ->> 'freight_allocated')::numeric = 0) from jsonb_array_elements(v_res -> 'items') it)
          and (v_res -> 'items' -> 0 ->> 'landed_total_value')::numeric = 12.34
          and (v_res -> 'items' -> 0 ->> 'unit_cost_after')::numeric = round(12.34/3, 2)
         then 'PASS' else 'FAIL' end, (v_res -> 'items')::text);
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('6', '6.1 frete zero', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 5b — Rateio maior resto (exemplo clássico: frete 1,00 em 3 linhas iguais).
-- =============================================================================
do $$
declare v_allocs numeric[];
begin
  v_allocs := public._mixed_allocate_freight_cents(array[10.00, 10.00, 10.00]::numeric[], 1.00::numeric);
  insert into zz_test_results(section, test_name, status, details)
  values ('5', '5.2 _mixed_allocate_freight_cents: 1,00 em 3 iguais -> [0.34, 0.33, 0.33], Σ = 1,00',
    case when v_allocs = array[0.34, 0.33, 0.33]::numeric[]
          and (select sum(x) from unnest(v_allocs) x) = 1.00 then 'PASS' else 'FAIL' end, v_allocs::text);

  v_allocs := public._mixed_allocate_freight_cents(array[10.00, 20.00, 30.00, 40.00]::numeric[], 0::numeric);
  insert into zz_test_results(section, test_name, status, details)
  values ('5', '5.3 frete 0 -> [0,0,0,0]',
    case when v_allocs = array[0,0,0,0]::numeric[] then 'PASS' else 'FAIL' end, v_allocs::text);
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('5', '5.2/5.3 rateio', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 16 — Itens inativos / inexistentes -> erro, nada persiste.
-- =============================================================================
do $$
declare
  v_user uuid; v_acc uuid; v_ft_inactive uuid; v_pkg_inactive uuid; v_err text; v_headers int;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';
  select value::uuid into v_ft_inactive from zz_fixtures where key = 'ft_inactive';
  select value::uuid into v_pkg_inactive from zz_fixtures where key = 'pkg_inactive';
  v_acc := (public.create_accessory('TESTE MISTA ACESSORIO S16', null, null, null, true, v_user)).id;

  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(
        jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',1,'total_value',10.00),
        jsonb_build_object('category','PACKAGING','packaging_id',v_pkg_inactive::text,'quantity',1,'total_value',10.00)),
      p_freight_value => 1.00, p_purchase_channel => 'ALIEXPRESS', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  select count(*) into v_headers from public.inventory_purchases where category = 'MIXED' and purchase_channel = 'ALIEXPRESS';
  insert into zz_test_results(section, test_name, status, details)
  values ('16', '16.1 embalagem inativa -> INVENTORY_PURCHASE_ITEM_INACTIVE; nenhum cabeçalho MIXED criado',
    case when v_err like 'INVENTORY_PURCHASE_ITEM_INACTIVE:%' and v_headers = 0 then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(
        jsonb_build_object('category','FILAMENT','filament_type_id',v_ft_inactive::text,'manufacturer','X','nominal_weight_grams',1000,'quantity',1,'total_value',10.00)),
      p_freight_value => 0, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('16', '16.2 tipo de filamento inativo -> INVENTORY_PURCHASE_ITEM_INACTIVE',
    case when v_err like 'INVENTORY_PURCHASE_ITEM_INACTIVE:%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(
        jsonb_build_object('category','ACCESSORY','accessory_id',gen_random_uuid()::text,'quantity',1,'total_value',10.00)),
      p_freight_value => 0, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('16', '16.3 acessório inexistente -> erro "não encontrado"',
    case when v_err ilike '%não encontrado%' then 'PASS' else 'FAIL' end, v_err);
end $$;

-- =============================================================================
-- SEÇÃO 17 — Duplicidade: acessório repetido / embalagem repetida.
-- =============================================================================
do $$
declare v_user uuid; v_acc uuid; v_pkg uuid; v_err text;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';
  v_acc := (public.create_accessory('TESTE MISTA ACESSORIO S17', null, null, null, true, v_user)).id;
  v_pkg := (public.create_packaging('TESTE MISTA EMBALAGEM S17', null, null, null, true, v_user)).id;

  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(
        jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',1,'total_value',10.00),
        jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',2,'total_value',20.00)),
      p_freight_value => 0, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('17', '17.1 acessório repetido em duas linhas -> erro "repetido"',
    case when v_err ilike '%acessório repetido%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(
        jsonb_build_object('category','PACKAGING','packaging_id',v_pkg::text,'quantity',1,'total_value',10.00),
        jsonb_build_object('category','PACKAGING','packaging_id',v_pkg::text,'quantity',2,'total_value',20.00)),
      p_freight_value => 0, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('17', '17.2 embalagem repetida em duas linhas -> erro "repetida"',
    case when v_err ilike '%embalagem repetida%' then 'PASS' else 'FAIL' end, v_err);

  -- tipo de filamento PODE repetir quando marca/peso diferem
  declare v_ft uuid; v_res jsonb;
  begin
    select value::uuid into v_ft from zz_fixtures where key = 'ft_a';
    v_res := public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(
        jsonb_build_object('category','FILAMENT','filament_type_id',v_ft::text,'manufacturer','Voolt','nominal_weight_grams',1000,'quantity',1,'total_value',50.00),
        jsonb_build_object('category','FILAMENT','filament_type_id',v_ft::text,'manufacturer','Bambu Lab','nominal_weight_grams',500,'quantity',2,'total_value',60.00)),
      p_freight_value => 0, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    insert into zz_test_results(section, test_name, status, details)
    values ('17', '17.3 mesmo filament_type_id em duas linhas com marca/peso diferentes é ACEITO',
      case when jsonb_array_length(v_res -> 'items') = 2 then 'PASS' else 'FAIL' end, (v_res -> 'items')::text);
  exception when others then
    insert into zz_test_results(section, test_name, status, details) values ('17', '17.3 filamento repetível', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 18 — Limite 1–50.
-- =============================================================================
do $$
declare v_user uuid; v_err text; v_items jsonb; v_acc uuid;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';
  begin
    perform public.register_mixed_inventory_purchase(
      p_items => '[]'::jsonb, p_freight_value => 0, p_purchase_channel => 'SHOPEE',
      p_occurred_on => date '2026-09-06', p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('18', '18.1 lista vazia -> erro (mínimo 1)', case when v_err ilike '%1 a 50%' or v_err ilike '%não vazia%' then 'PASS' else 'FAIL' end, v_err);

  -- 51 acessórios distintos -> erro
  select jsonb_agg(jsonb_build_object(
           'category','ACCESSORY',
           'accessory_id',(public.create_accessory('TESTE MISTA S18 ' || g, null, null, null, true, v_user)).id::text,
           'quantity',1,'total_value',1.00))
    into v_items
  from generate_series(1, 51) g;
  begin
    perform public.register_mixed_inventory_purchase(
      p_items => v_items, p_freight_value => 0, p_purchase_channel => 'SHOPEE',
      p_occurred_on => date '2026-09-06', p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('18', '18.2 51 itens -> erro (máximo 50)', case when v_err ilike '%máximo 50%' then 'PASS' else 'FAIL' end, v_err);
end $$;

-- =============================================================================
-- SEÇÃO 19+20 — Idempotência: mesma chave + mesmo payload (mesma ordem) e
--   mesma data OU data diferente -> mesma compra; qualquer alteração -> conflito.
-- =============================================================================
do $$
declare
  v_user uuid; v_acc uuid; v_pkg uuid; v_ft uuid;
  v_key text := 'mixed-idem-' || gen_random_uuid()::text;
  v_res1 jsonb; v_res2 jsonb; v_res3 jsonb; v_err text;
  v_acc_stock_1 int; v_acc_stock_2 int; v_mov int;
  v_payload jsonb;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';
  select value::uuid into v_ft from zz_fixtures where key = 'ft_b';
  v_acc := (public.create_accessory('TESTE MISTA ACESSORIO IDEM', null, null, null, true, v_user)).id;
  v_pkg := (public.create_packaging('TESTE MISTA EMBALAGEM IDEM', null, null, null, true, v_user)).id;

  v_payload := jsonb_build_array(
    jsonb_build_object('category','FILAMENT','filament_type_id',v_ft::text,'manufacturer','Voolt','nominal_weight_grams',1000,'quantity',2,'total_value',80.00),
    jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',3,'total_value',15.00),
    jsonb_build_object('category','PACKAGING','packaging_id',v_pkg::text,'quantity',4,'total_value',20.00));

  v_res1 := public.register_mixed_inventory_purchase(
    p_items => v_payload, p_freight_value => 5.00, p_purchase_channel => 'PRESENCIAL',
    p_occurred_on => date '2026-09-06', p_changed_by => v_user, p_supplier_name => 'Loja Central', p_idempotency_key => v_key);
  select current_stock into v_acc_stock_1 from public.accessories where id = v_acc;

  -- 19. mesma chave + mesmo payload/ordem + DATA DIFERENTE -> mesma compra
  v_res2 := public.register_mixed_inventory_purchase(
    p_items => v_payload, p_freight_value => 5.00, p_purchase_channel => 'PRESENCIAL',
    p_occurred_on => date '2026-09-20', p_changed_by => v_user, p_supplier_name => 'Loja Central', p_idempotency_key => v_key);
  select current_stock into v_acc_stock_2 from public.accessories where id = v_acc;
  select count(*) into v_mov from public.stock_movements
    where item_type='ACCESSORY' and item_id=v_acc and reference_id=(v_res1 ->> 'purchase_id')::uuid;

  insert into zz_test_results(section, test_name, status, details)
  values ('19', '19.1 mesma chave + mesmo payload/ordem + DATA DIFERENTE -> devolve a MESMA compra; saldo/movimentos NÃO se repetem (occurred_on fica de fora)',
    case when (v_res1 ->> 'purchase_id') = (v_res2 ->> 'purchase_id')
          and v_acc_stock_1 = v_acc_stock_2 and v_mov = 1
         then 'PASS' else 'FAIL' end, format('pid=%s/%s stock=%s/%s mov=%s',
      v_res1->>'purchase_id', v_res2->>'purchase_id', v_acc_stock_1, v_acc_stock_2, v_mov));

  -- 20a. ORDEM GLOBAL diferente (mesmos itens, ordem trocada) -> conflito
  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(v_payload -> 1, v_payload -> 0, v_payload -> 2),
      p_freight_value => 5.00, p_purchase_channel => 'PRESENCIAL',
      p_occurred_on => date '2026-09-06', p_changed_by => v_user, p_supplier_name => 'Loja Central', p_idempotency_key => v_key);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('20', '20.1 mesma chave + itens iguais mas ORDEM GLOBAL diferente -> IDEMPOTENCY_KEY_CONFLICT',
    case when v_err like 'IDEMPOTENCY_KEY_CONFLICT:%' then 'PASS' else 'FAIL' end, v_err);

  -- 20b. frete diferente -> conflito
  begin
    perform public.register_mixed_inventory_purchase(
      p_items => v_payload, p_freight_value => 6.00, p_purchase_channel => 'PRESENCIAL',
      p_occurred_on => date '2026-09-06', p_changed_by => v_user, p_supplier_name => 'Loja Central', p_idempotency_key => v_key);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('20', '20.2 mesma chave + frete diferente -> IDEMPOTENCY_KEY_CONFLICT',
    case when v_err like 'IDEMPOTENCY_KEY_CONFLICT:%' then 'PASS' else 'FAIL' end, v_err);

  -- 20c. canal/complemento diferente -> conflito
  begin
    perform public.register_mixed_inventory_purchase(
      p_items => v_payload, p_freight_value => 5.00, p_purchase_channel => 'PRESENCIAL',
      p_occurred_on => date '2026-09-06', p_changed_by => v_user, p_supplier_name => 'Outra Loja', p_idempotency_key => v_key);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('20', '20.3 mesma chave + complemento (nome da loja) diferente -> IDEMPOTENCY_KEY_CONFLICT',
    case when v_err like 'IDEMPOTENCY_KEY_CONFLICT:%' then 'PASS' else 'FAIL' end, v_err);
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('19', '19/20 idempotência', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 21 — Determinismo do rateio (mesmo payload -> mesmas parcelas).
-- =============================================================================
do $$
declare
  v_user uuid; v_acc uuid; v_pkg uuid; v_res1 jsonb; v_res2 jsonb; v_c1 jsonb; v_c2 jsonb;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';
  v_acc := (public.create_accessory('TESTE MISTA ACESSORIO S21', null, null, null, true, v_user)).id;
  v_pkg := (public.create_packaging('TESTE MISTA EMBALAGEM S21', null, null, null, true, v_user)).id;

  v_res1 := public.register_mixed_inventory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',3,'total_value',12.34),
      jsonb_build_object('category','PACKAGING','packaging_id',v_pkg::text,'quantity',7,'total_value',56.78)),
    p_freight_value => 9.99, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
    p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
  v_res2 := public.register_mixed_inventory_purchase(
    p_items => jsonb_build_array(
      jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',3,'total_value',12.34),
      jsonb_build_object('category','PACKAGING','packaging_id',v_pkg::text,'quantity',7,'total_value',56.78)),
    p_freight_value => 9.99, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
    p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);

  select jsonb_agg((it ->> 'freight_allocated') order by (it ->> 'line_number')) into v_c1 from jsonb_array_elements(v_res1 -> 'items') it;
  select jsonb_agg((it ->> 'freight_allocated') order by (it ->> 'line_number')) into v_c2 from jsonb_array_elements(v_res2 -> 'items') it;
  insert into zz_test_results(section, test_name, status, details)
  values ('21', '21.1 rateio determinístico: mesma entrada -> mesmas parcelas por linha',
    case when v_c1 = v_c2 and (select sum(x::numeric) from jsonb_array_elements_text(v_c1) x) = 9.99 then 'PASS' else 'FAIL' end,
    format('%s vs %s', v_c1, v_c2));
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('21', '21.1 determinismo', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 22 — Rollback integral: falha no MEIO da chamada (3a linha inativa)
--   não deixa cabeçalho, itens, rolos, movimentos, saldo nem custo.
-- =============================================================================
do $$
declare
  v_user uuid; v_ft uuid; v_acc uuid; v_pkg_inactive uuid;
  v_acc_stock_before int; v_acc_cost_before numeric;
  v_acc_stock_after int; v_acc_cost_after numeric;
  v_headers int; v_fil_items int; v_spools int; v_movs int; v_err text;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';
  select value::uuid into v_ft from zz_fixtures where key = 'ft_a';
  select value::uuid into v_pkg_inactive from zz_fixtures where key = 'pkg_inactive';
  v_acc := (public.create_accessory('TESTE MISTA ACESSORIO ROLLBACK', null, null, null, true, v_user)).id;
  perform public.register_stock_movement('ACCESSORY', v_acc, 'INITIAL_BALANCE', 4::numeric, v_user);
  update public.accessories set unit_cost = 2.50 where id = v_acc;
  select current_stock, unit_cost into v_acc_stock_before, v_acc_cost_before from public.accessories where id = v_acc;

  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(
        jsonb_build_object('category','FILAMENT','filament_type_id',v_ft::text,'manufacturer','X','nominal_weight_grams',1000,'quantity',2,'total_value',40.00),
        jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',5,'total_value',30.00),
        jsonb_build_object('category','PACKAGING','packaging_id',v_pkg_inactive::text,'quantity',1,'total_value',10.00)),
      p_freight_value => 5.00, p_purchase_channel => 'OUTRO_SITE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => 'sitequalquer.com', p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;

  select current_stock, unit_cost into v_acc_stock_after, v_acc_cost_after from public.accessories where id = v_acc;
  select count(*) into v_headers from public.inventory_purchases where category = 'MIXED' and purchase_channel = 'OUTRO_SITE' and supplier_name = 'sitequalquer.com';
  select count(*) into v_fil_items from public.inventory_purchase_filament_items where filament_type_id = v_ft and line_number is not null;
  select count(*) into v_spools from public.filament_spools where filament_type_id = v_ft and received_at = date '2026-09-06';
  select count(*) into v_movs from public.stock_movements where item_type='ACCESSORY' and item_id=v_acc and movement_type='PURCHASE';

  insert into zz_test_results(section, test_name, status, details)
  values ('22', '22.1 3a linha (embalagem inativa) falha -> erro; ZERO cabeçalho/itens de filamento/rolos/movimentos; saldo e custo do acessório intactos',
    case when v_err like 'INVENTORY_PURCHASE_ITEM_INACTIVE:%'
          and v_headers = 0 and v_fil_items = 0 and v_spools = 0 and v_movs = 0
          and v_acc_stock_after = v_acc_stock_before and v_acc_cost_after = v_acc_cost_before
         then 'PASS' else 'FAIL' end,
    format('err=%s header=%s fil=%s spools=%s mov=%s stock=%s/%s cost=%s/%s',
      v_err, v_headers, v_fil_items, v_spools, v_movs, v_acc_stock_before, v_acc_stock_after, v_acc_cost_before, v_acc_cost_after));
end $$;

-- =============================================================================
-- SEÇÃO 23 — Grants / RLS / imutabilidade / schema.
-- =============================================================================
do $$
declare
  v_rpc_anon boolean; v_rpc_auth boolean; v_rpc_service boolean;
  v_helper_anon boolean; v_summary_anon boolean; v_canon_anon boolean;
  v_pkg_sel boolean; v_pkg_ins boolean; v_pkg_upd boolean; v_pkg_del boolean; v_pkg_rls boolean;
  v_fil_freight boolean; v_fil_landed boolean; v_fil_line boolean;
begin
  v_rpc_anon := has_function_privilege('anon', 'public.register_mixed_inventory_purchase(jsonb, numeric, text, date, uuid, text, text)', 'EXECUTE');
  v_rpc_auth := has_function_privilege('authenticated', 'public.register_mixed_inventory_purchase(jsonb, numeric, text, date, uuid, text, text)', 'EXECUTE');
  v_rpc_service := has_function_privilege('service_role', 'public.register_mixed_inventory_purchase(jsonb, numeric, text, date, uuid, text, text)', 'EXECUTE');
  v_helper_anon := has_function_privilege('anon', 'public._mixed_allocate_freight_cents(numeric[], numeric)', 'EXECUTE');
  v_summary_anon := has_function_privilege('anon', 'public._build_mixed_purchase_summary(uuid)', 'EXECUTE');
  v_canon_anon := has_function_privilege('anon', 'public._mixed_purchase_items_canonical(uuid)', 'EXECUTE');

  v_pkg_sel := has_table_privilege('authenticated', 'public.inventory_purchase_packaging_items', 'SELECT');
  v_pkg_ins := has_table_privilege('authenticated', 'public.inventory_purchase_packaging_items', 'INSERT');
  v_pkg_upd := has_table_privilege('authenticated', 'public.inventory_purchase_packaging_items', 'UPDATE');
  v_pkg_del := has_table_privilege('authenticated', 'public.inventory_purchase_packaging_items', 'DELETE');
  select relrowsecurity into v_pkg_rls from pg_class where oid = 'public.inventory_purchase_packaging_items'::regclass;

  select exists (select 1 from information_schema.columns where table_name='inventory_purchase_filament_items' and column_name='freight_allocated'),
         exists (select 1 from information_schema.columns where table_name='inventory_purchase_filament_items' and column_name='landed_total_value'),
         exists (select 1 from information_schema.columns where table_name='inventory_purchase_filament_items' and column_name='line_number')
    into v_fil_freight, v_fil_landed, v_fil_line;

  insert into zz_test_results(section, test_name, status, details)
  values ('23', '23.1 register_mixed_inventory_purchase: EXECUTE só service_role (anon/authenticated negados)',
    case when v_rpc_service and not v_rpc_anon and not v_rpc_auth then 'PASS' else 'FAIL' end,
    format('service=%s anon=%s auth=%s', v_rpc_service, v_rpc_anon, v_rpc_auth));
  insert into zz_test_results(section, test_name, status, details)
  values ('23', '23.2 helpers internos (_mixed_allocate_freight_cents / _build_mixed_purchase_summary / _mixed_purchase_items_canonical): zero grants a anon',
    case when not v_helper_anon and not v_summary_anon and not v_canon_anon then 'PASS' else 'FAIL' end,
    format('helper=%s summary=%s canon=%s', v_helper_anon, v_summary_anon, v_canon_anon));
  insert into zz_test_results(section, test_name, status, details)
  values ('23', '23.3 inventory_purchase_packaging_items: RLS on, SELECT a authenticated, sem INSERT/UPDATE/DELETE de sessão',
    case when v_pkg_rls and v_pkg_sel and not v_pkg_ins and not v_pkg_upd and not v_pkg_del then 'PASS' else 'FAIL' end,
    format('rls=%s sel=%s ins=%s upd=%s del=%s', v_pkg_rls, v_pkg_sel, v_pkg_ins, v_pkg_upd, v_pkg_del));
  insert into zz_test_results(section, test_name, status, details)
  values ('23', '23.4 inventory_purchase_filament_items ganhou freight_allocated / landed_total_value / line_number',
    case when v_fil_freight and v_fil_landed and v_fil_line then 'PASS' else 'FAIL' end,
    format('freight=%s landed=%s line=%s', v_fil_freight, v_fil_landed, v_fil_line));
end $$;

-- =============================================================================
-- SEÇÃO 24 — NÃO REGRESSÃO das três RPCs antigas.
-- =============================================================================
do $$
declare
  v_user uuid; v_pkg uuid; v_acc uuid; v_ft uuid;
  v_p public.inventory_purchases; v_res_acc jsonb; v_res_fil jsonb;
  v_pkg_stock int; v_pkg_cost_before numeric; v_pkg_cost_after numeric;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';

  -- register_inventory_purchase (PACKAGING item único) — inalterado
  v_pkg := (public.create_packaging('TESTE MISTA S24 PKG', null, null, null, true, v_user)).id;
  select unit_cost into v_pkg_cost_before from public.packaging where id = v_pkg;
  v_p := public.register_inventory_purchase(
    p_category => 'PACKAGING', p_quantity => 7, p_item_value => 35.00, p_freight_value => 5.00,
    p_changed_by => v_user, p_item_id => v_pkg);
  select current_stock, unit_cost into v_pkg_stock, v_pkg_cost_after from public.packaging where id = v_pkg;
  insert into zz_test_results(section, test_name, status, details)
  values ('24', '24.1 register_inventory_purchase (PACKAGING item único) INALTERADO: +7 saldo, total 40,00, unit_cost de packaging NÃO tocado por esse fluxo',
    case when v_p.category='PACKAGING' and v_p.total_value=40.00 and v_pkg_stock=7 and v_pkg_cost_after is not distinct from v_pkg_cost_before
         then 'PASS' else 'FAIL' end, format('stock=%s cost=%s/%s', v_pkg_stock, v_pkg_cost_before, v_pkg_cost_after));

  -- register_accessory_purchase — inalterado
  v_acc := (public.create_accessory('TESTE MISTA S24 ACC', null, null, null, true, v_user)).id;
  v_res_acc := public.register_accessory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('accessory_id', v_acc::text, 'quantity', 4, 'total_value', 20.00)),
    p_freight_value => 0, p_supplier_name => null, p_notes => null, p_occurred_at => now(),
    p_changed_by => v_user, p_idempotency_key => null);
  insert into zz_test_results(section, test_name, status, details)
  values ('24', '24.2 register_accessory_purchase INALTERADO: category ACCESSORY, unit_cost_after 5,00',
    case when (v_res_acc ->> 'category')='ACCESSORY' and (v_res_acc -> 'items' -> 0 ->> 'unit_cost_after')::numeric = 5.00
         then 'PASS' else 'FAIL' end, (v_res_acc)::text);

  -- register_filament_purchase — inalterado (canal legado PRESENCIAL, itens sem line_number, freight_allocated default 0)
  v_ft := (public.create_filament_type('PLA', 'TESTE MISTA S24 FIL', 'Sólida', 'S24 cor', null, null, true, null, v_user)).id;
  v_res_fil := public.register_filament_purchase(
    p_freight_value => 3.00, p_changed_by => v_user,
    p_items => jsonb_build_array(jsonb_build_object('filament_type_id', v_ft::text, 'manufacturer', 'MarcaX', 'nominal_weight_grams', 1000, 'quantity', 2, 'total_value', 80.00)),
    p_occurred_at => now(), p_notes => null, p_idempotency_key => null, p_purchase_channel => 'PRESENCIAL');
  insert into zz_test_results(section, test_name, status, details)
  values ('24', '24.3 register_filament_purchase INALTERADO: subtotal 80,00; itens sem line_number (NULL) e freight_allocated default 0',
    case when (v_res_fil ->> 'subtotal_value')::numeric = 80.00
          and (select bool_and(line_number is null and freight_allocated = 0)
               from public.inventory_purchase_filament_items where purchase_id = (v_res_fil ->> 'purchase_id')::uuid)
         then 'PASS' else 'FAIL' end, (v_res_fil)::text);
exception when others then
  insert into zz_test_results(section, test_name, status, details) values ('24', '24.x regressão RPCs antigas', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 25 — Compatibilidade: nenhum cabeçalho legado é reclassificado; a
--   CHECK de category ampliada aceita os quatro valores; a CHECK de
--   purchase_channel ainda aceita SITE/OUTRO.
-- =============================================================================
do $$
declare
  v_legacy_count int; v_mixed_check text; v_channel_check text;
begin
  select count(*) into v_legacy_count from public.inventory_purchases where category in ('FILAMENT','ACCESSORY','PACKAGING');
  select pg_get_constraintdef(oid) into v_mixed_check from pg_constraint where conname = 'inventory_purchases_category_check';
  select pg_get_constraintdef(oid) into v_channel_check from pg_constraint where conname = 'inventory_purchases_purchase_channel_check';
  insert into zz_test_results(section, test_name, status, details)
  values ('25', '25.1 category_check aceita MIXED e mantém FILAMENT/ACCESSORY/PACKAGING; purchase_channel ainda aceita SITE/OUTRO; cabeçalhos legados intactos',
    case when v_mixed_check ilike '%MIXED%' and v_mixed_check ilike '%FILAMENT%' and v_mixed_check ilike '%ACCESSORY%' and v_mixed_check ilike '%PACKAGING%'
          and v_channel_check ilike '%SITE%' and v_channel_check ilike '%OUTRO%' and v_channel_check ilike '%OUTRO_SITE%'
         then 'PASS' else 'FAIL' end, format('legacy_rows=%s cat=%s chan=%s', v_legacy_count, v_mixed_check, v_channel_check));
end $$;

-- =============================================================================
-- SEÇÃO 27 — Regras de purchase_channel / supplier_name para MIXED.
-- =============================================================================
do $$
declare
  v_user uuid; v_acc uuid; v_err text; v_res jsonb;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';
  v_acc := (public.create_accessory('TESTE MISTA ACESSORIO S27', null, null, null, true, v_user)).id;

  -- canal inválido
  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',1,'total_value',10.00)),
      p_freight_value => 0, p_purchase_channel => 'FACEBOOK', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('27', '27.1 purchase_channel fora do enum MIXED -> erro', case when v_err ilike '%purchase_channel inválido%' then 'PASS' else 'FAIL' end, v_err);

  -- OUTRO_SITE sem complemento -> erro
  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',1,'total_value',10.00)),
      p_freight_value => 0, p_purchase_channel => 'OUTRO_SITE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('27', '27.2 OUTRO_SITE sem complemento -> erro (nome do site obrigatório)', case when v_err ilike '%exige o complemento%' then 'PASS' else 'FAIL' end, v_err);

  -- PRESENCIAL com complemento -> supplier_name gravado; canal gravado
  v_res := public.register_mixed_inventory_purchase(
    p_items => jsonb_build_array(jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',1,'total_value',10.00)),
    p_freight_value => 0, p_purchase_channel => 'PRESENCIAL', p_occurred_on => date '2026-09-06',
    p_changed_by => v_user, p_supplier_name => '  Loja do Zé  ', p_idempotency_key => null);
  insert into zz_test_results(section, test_name, status, details)
  values ('27', '27.3 PRESENCIAL: purchase_channel=PRESENCIAL e supplier_name trimado = "Loja do Zé"',
    case when (v_res ->> 'purchase_channel') = 'PRESENCIAL' and (v_res ->> 'supplier_name') = 'Loja do Zé' then 'PASS' else 'FAIL' end, v_res::text);

  -- canal padronizado com complemento -> complemento IGNORADO (supplier_name NULL)
  declare v_acc2 uuid;
  begin
    v_acc2 := (public.create_accessory('TESTE MISTA ACESSORIO S27b', null, null, null, true, v_user)).id;
    v_res := public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('category','ACCESSORY','accessory_id',v_acc2::text,'quantity',1,'total_value',10.00)),
      p_freight_value => 0, p_purchase_channel => 'MERCADO_LIVRE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => 'não deveria ser usado', p_idempotency_key => null);
    insert into zz_test_results(section, test_name, status, details)
    values ('27', '27.4 canal padronizado (Mercado Livre) ignora complemento -> supplier_name NULL',
      case when (v_res ->> 'purchase_channel') = 'MERCADO_LIVRE' and (v_res ->> 'supplier_name') is null then 'PASS' else 'FAIL' end, v_res::text);
  end;
end $$;

-- =============================================================================
-- SEÇÃO EXTRA — quantidade / dinheiro inválidos.
-- =============================================================================
do $$
declare v_user uuid; v_acc uuid; v_err text;
begin
  select value::uuid into v_user from zz_fixtures where key = 'user';
  v_acc := (public.create_accessory('TESTE MISTA ACESSORIO SX', null, null, null, true, v_user)).id;

  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',0,'total_value',10.00)),
      p_freight_value => 0, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('X', 'X.1 quantity 0 -> erro', case when v_err ilike '%quantity deve ser um inteiro positivo%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',1,'total_value',0)),
      p_freight_value => 0, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('X', 'X.2 total_value 0 -> erro (recusado)', case when v_err ilike '%total_value deve ser um número maior que zero%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',1,'total_value',10.999)),
      p_freight_value => 0, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('X', 'X.3 total_value com 3 casas -> erro', case when v_err ilike '%no máximo 2 casas%' then 'PASS' else 'FAIL' end, v_err);

  begin
    perform public.register_mixed_inventory_purchase(
      p_items => jsonb_build_array(jsonb_build_object('category','ACCESSORY','accessory_id',v_acc::text,'quantity',1,'total_value',10.00)),
      p_freight_value => -1, p_purchase_channel => 'SHOPEE', p_occurred_on => date '2026-09-06',
      p_changed_by => v_user, p_supplier_name => null, p_idempotency_key => null);
    v_err := 'sem erro';
  exception when others then v_err := sqlerrm; end;
  insert into zz_test_results(section, test_name, status, details)
  values ('X', 'X.4 frete negativo -> erro', case when v_err ilike '%não pode ser negativo%' then 'PASS' else 'FAIL' end, v_err);
end $$;

-- =============================================================================
-- RESULTADO
-- =============================================================================
select section, test_name, status, details from zz_test_results order by seq;

do $$
declare
  v_fail int;
  r record;
begin
  select count(*) into v_fail from zz_test_results where status <> 'PASS';
  if v_fail > 0 then
    raise notice '=== TESTES QUE FALHARAM ===';
    for r in select section, test_name, details from zz_test_results where status <> 'PASS' order by seq loop
      raise notice 'FALHOU [%] % — %', r.section, r.test_name, left(coalesce(r.details, ''), 300);
    end loop;
    raise exception 'mixed_inventory_purchase_test: % teste(s) falharam', v_fail;
  end if;
  raise notice 'mixed_inventory_purchase_test: todos os testes passaram';
end $$;

rollback;
