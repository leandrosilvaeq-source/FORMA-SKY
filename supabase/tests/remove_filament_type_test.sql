-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- TESTE DE INTEGRAÇÃO transacional de public.remove_filament_type(uuid, uuid)
-- (migration 20260903120000_add_remove_filament_type_function.sql)
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nenhum dado criado por este
-- script persiste no banco. Usa só entidades "TESTE%" (nunca dados
-- oficiais / Petlink).
--
-- Execução (contra o remoto, só depois de aplicar a migration):
--   npx supabase db query --linked --file supabase/tests/remove_filament_type_test.sql
--
-- LIMITAÇÃO DE AMBIENTE (mesma de todas as rodadas anteriores): sem Docker/
-- Postgres local nesta máquina — este arquivo foi escrito e revisado
-- estaticamente; precisa de uma primeira execução real (dentro de
-- BEGIN...ROLLBACK) antes de ser considerado verde.
--
-- REGRA TESTADA (decisão revisada do usuário, 2026-09-03):
--   1. tipo SEM nenhuma referência (rolos, movimentações, compras FILAMENT,
--      product_filaments, product_plate_filaments, seleção em pedido) ->
--      exclusão física definitiva; retorno { result: 'PHYSICALLY_DELETED' }.
--   2. tipo COM qualquer referência e SEM pedido ativo -> arquiva o tipo
--      (is_active=false) e TODOS os seus rolos ativos (is_active=false) na
--      MESMA transação; nada é apagado; retorno { result: 'ARCHIVED',
--      archived_spool_count: N }.
--   3. tipo em pedido ATIVO (status != DELIVERED/CANCELLED) -> bloqueio
--      FILAMENT_TYPE_IN_ACTIVE_ORDER:, nada alterado.
--   - pedidos DELIVERED/CANCELLED NÃO bloqueiam (arquivamento permitido),
--     e seus snapshots/seleções são preservados.
--   - nenhuma cascata, nenhum ON DELETE CASCADE, nenhuma linha dependente
--     apagada.
-- =============================================================================

begin;

create temporary table zz_rft_results (
  seq serial primary key,
  section text not null,
  test_name text not null,
  status text not null,
  details text
);

create temporary table zz_rft_fixtures (
  key text primary key,
  value text
);

-- =============================================================================
-- SEÇÃO 0 — Setup: usuário ativo + cliente + produto (1 plate) para os
-- pedidos das seções 7/8/9/10.
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
begin
  select id into v_user_id from public.users where is_active limit 1;
  if v_user_id is null then
    raise exception 'nenhum usuário ativo em public.users — ambiente sem dados mínimos';
  end if;
  insert into zz_rft_fixtures(key, value) values ('user_id', v_user_id::text);

  insert into public.customers (name, is_active)
    values ('TESTE RFT Cliente', true)
    returning id into v_customer_id;
  insert into zz_rft_fixtures(key, value) values ('customer_id', v_customer_id::text);

  v_product_id := public.create_product_with_plates(
    'TESTE RFT Produto 1 plate', 'CATALOG',
    jsonb_build_array('Chaveiro'),
    'produto de teste RFT', 50.00, null, true,
    jsonb_build_array(
      jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 40)
    ),
    null, null,
    '[]'::jsonb, '[]'::jsonb,
    v_user_id
  );
  insert into zz_rft_fixtures(key, value) values ('product_id', v_product_id::text);

  insert into zz_rft_results(section, test_name, status, details)
    values ('0', '0.0 setup usuário/cliente/produto', 'PASS',
      'user_id=' || v_user_id || ' product_id=' || v_product_id);
exception when others then
  insert into zz_rft_results(section, test_name, status, details)
    values ('0', '0.0 setup', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 1 — tipo SEM nenhuma dependência -> exclusão física
-- + SEÇÃO 15 — retorno estruturado correto (PHYSICALLY_DELETED)
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_result jsonb;
  v_still_there boolean;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  v_type_id := (public.create_filament_type(
    'PLA', 'TESTE RFT Marca Solta', 'Sólida', 'Preto', null, null, true, null, v_user_id
  )).id;

  v_result := public.remove_filament_type(v_type_id, v_user_id);
  select exists(select 1 from public.filament_types where id = v_type_id) into v_still_there;

  insert into zz_rft_results(section, test_name, status, details)
    values ('1', '1.1 tipo sem dependência é excluído fisicamente',
      case when not v_still_there and v_result ->> 'result' = 'PHYSICALLY_DELETED'
                and (v_result ->> 'archived_spool_count')::int = 0
           then 'PASS' else 'FAIL' end,
      'still_there=' || v_still_there || ' result=' || coalesce(v_result::text, '<null>'));
exception when others then
  insert into zz_rft_results(section, test_name, status, details)
    values ('1', '1.1 tipo sem dependência excluído fisicamente', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 2 — tipo com rolo VAZIO (sem movimentações) -> tipo E rolo arquivados
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_spool_id uuid;
  v_result jsonb;
  v_type_active boolean;
  v_spool_active boolean;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  v_type_id := (public.create_filament_type(
    'PLA', 'TESTE RFT Marca RoloVazio', 'Sólida', 'Azul', null, null, true, null, v_user_id
  )).id;
  v_spool_id := (public.create_filament_spool(v_type_id, 1000, null, null, null, null, true, v_user_id)).id;

  v_result := public.remove_filament_type(v_type_id, v_user_id);
  select is_active into v_type_active from public.filament_types where id = v_type_id;
  select is_active into v_spool_active from public.filament_spools where id = v_spool_id;

  insert into zz_rft_results(section, test_name, status, details)
    values ('2', '2.1 tipo com rolo vazio: tipo e rolo arquivados (nada apagado)',
      case when v_type_active is false and v_spool_active is false
                and v_result ->> 'result' = 'ARCHIVED'
                and (v_result ->> 'archived_spool_count')::int = 1
           then 'PASS' else 'FAIL' end,
      'type_active=' || v_type_active || ' spool_active=' || v_spool_active ||
      ' result=' || coalesce(v_result::text, '<null>'));

  -- SEÇÃO 12 (nenhuma cascata): o rolo continua existindo, só inativo.
  insert into zz_rft_results(section, test_name, status, details)
    values ('12', '12.1 rolo do tipo arquivado NÃO foi deletado (sem cascata)',
      case when exists(select 1 from public.filament_spools where id = v_spool_id)
           then 'PASS' else 'FAIL' end, 'spool_id=' || v_spool_id);
exception when others then
  insert into zz_rft_results(section, test_name, status, details)
    values ('2', '2.1 tipo com rolo vazio arquivado', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 3/4 — tipo com rolo E movimentações -> arquivamento; movimentações
-- preservadas integralmente.
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_spool_id uuid;
  v_result jsonb;
  v_type_active boolean;
  v_spool_active boolean;
  v_mov_before int;
  v_mov_after int;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  v_type_id := (public.create_filament_type(
    'PETG', 'TESTE RFT Marca ComHist', 'Sólida', 'Verde', null, null, true, null, v_user_id
  )).id;
  v_spool_id := (public.create_filament_spool(v_type_id, 1000, null, null, null, null, true, v_user_id)).id;
  -- Saldo inicial + uma perda -> 2 linhas em filament_movements.
  -- Assinatura: register_filament_movement(p_spool_id, p_movement_type,
  --   p_quantity, p_changed_by, p_reason default null, ...).
  perform public.register_filament_movement(v_spool_id, 'INITIAL_BALANCE', 1000, v_user_id);
  perform public.register_filament_movement(v_spool_id, 'LOSS', 100, v_user_id, 'teste de perda');
  select count(*) into v_mov_before from public.filament_movements where spool_id = v_spool_id;

  v_result := public.remove_filament_type(v_type_id, v_user_id);
  select is_active into v_type_active from public.filament_types where id = v_type_id;
  select is_active into v_spool_active from public.filament_spools where id = v_spool_id;
  select count(*) into v_mov_after from public.filament_movements where spool_id = v_spool_id;

  insert into zz_rft_results(section, test_name, status, details)
    values ('3', '3.1 tipo com rolo+movimentações é arquivado (não excluído)',
      case when v_type_active is false and v_spool_active is false
                and v_result ->> 'result' = 'ARCHIVED'
           then 'PASS' else 'FAIL' end,
      'type_active=' || v_type_active || ' spool_active=' || v_spool_active);

  insert into zz_rft_results(section, test_name, status, details)
    values ('4', '4.1 movimentações preservadas integralmente após arquivamento',
      case when v_mov_before = 2 and v_mov_after = 2 then 'PASS' else 'FAIL' end,
      'mov_before=' || v_mov_before || ' mov_after=' || v_mov_after);
exception when others then
  insert into zz_rft_results(section, test_name, status, details)
    values ('3', '3.1 tipo com rolo+movimentações arquivado', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 5 — vários rolos -> TODOS arquivados atomicamente (uma transação)
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_s1 uuid;
  v_s2 uuid;
  v_s3 uuid;
  v_result jsonb;
  v_active_count int;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  v_type_id := (public.create_filament_type(
    'PLA', 'TESTE RFT Marca MultiRolo', 'Sólida', 'Amarelo', null, null, true, null, v_user_id
  )).id;
  v_s1 := (public.create_filament_spool(v_type_id, 1000, null, null, null, null, true, v_user_id)).id;
  v_s2 := (public.create_filament_spool(v_type_id, 1000, null, null, null, null, true, v_user_id)).id;
  v_s3 := (public.create_filament_spool(v_type_id, 1000, null, null, null, null, true, v_user_id)).id;

  v_result := public.remove_filament_type(v_type_id, v_user_id);
  select count(*) into v_active_count
    from public.filament_spools where filament_type_id = v_type_id and is_active;

  insert into zz_rft_results(section, test_name, status, details)
    values ('5', '5.1 vários rolos: todos arquivados, archived_spool_count correto',
      case when v_active_count = 0
                and (v_result ->> 'archived_spool_count')::int = 3
                and v_result ->> 'result' = 'ARCHIVED'
           then 'PASS' else 'FAIL' end,
      'active_count=' || v_active_count || ' result=' || coalesce(v_result::text, '<null>'));
exception when others then
  insert into zz_rft_results(section, test_name, status, details)
    values ('5', '5.1 vários rolos arquivados atomicamente', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 6 — falha da operação -> NENHUMA alteração parcial. Disparada por
-- um bloqueio real (pedido ativo): o tipo e os rolos ficam exatamente como
-- estavam antes da chamada.
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_type_id uuid;
  v_spool_id uuid;
  v_order_id uuid;
  v_type_active_before boolean;
  v_spool_active_before boolean;
  v_type_active_after boolean;
  v_spool_active_after boolean;
  v_raised boolean := false;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_rft_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_rft_fixtures where key = 'product_id';

  v_type_id := (public.create_filament_type(
    'PLA', 'TESTE RFT Marca Atomic', 'Sólida', 'Roxo', null, null, true, null, v_user_id
  )).id;
  v_spool_id := (public.create_filament_spool(v_type_id, 1000, null, null, null, null, true, v_user_id)).id;

  -- Pedido CATALOG (entra em IN_PRODUCTION_QUEUE = ativo) com uma seleção
  -- de cor apontando para o tipo.
  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE RFT — pedido atômico',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item RFT', 'quantity', 1, 'unit_price', 50,
      'production_colors', jsonb_build_array(jsonb_build_object(
        'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_type_id)
      ))
    )),
    v_user_id
  );

  select is_active into v_type_active_before from public.filament_types where id = v_type_id;
  select is_active into v_spool_active_before from public.filament_spools where id = v_spool_id;

  begin
    perform public.remove_filament_type(v_type_id, v_user_id);
  exception when others then
    v_raised := (sqlerrm like 'FILAMENT_TYPE_IN_ACTIVE_ORDER:%');
  end;

  select is_active into v_type_active_after from public.filament_types where id = v_type_id;
  select is_active into v_spool_active_after from public.filament_spools where id = v_spool_id;

  insert into zz_rft_results(section, test_name, status, details)
    values ('6', '6.1 operação abortada não deixa alteração parcial (tipo e rolo intactos)',
      case when v_raised
                and v_type_active_before is true and v_type_active_after is true
                and v_spool_active_before is true and v_spool_active_after is true
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' type_after=' || v_type_active_after || ' spool_after=' || v_spool_active_after);

  insert into zz_rft_fixtures(key, value) values ('active_order_type_id', v_type_id::text);
  insert into zz_rft_fixtures(key, value) values ('active_order_id', v_order_id::text);
exception when others then
  insert into zz_rft_results(section, test_name, status, details)
    values ('6', '6.1 atomicidade em falha', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 7 — pedido ATIVO usando o tipo -> BLOQUEIO
-- (reutiliza o tipo/pedido criados na Seção 6, ainda em IN_PRODUCTION_QUEUE)
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_msg text;
  v_order_number text;
  v_raised_prefix boolean := false;
  v_names_order text;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  select value::uuid into v_type_id from zz_rft_fixtures where key = 'active_order_type_id';
  select order_number into v_order_number
    from public.orders where id = (select value::uuid from zz_rft_fixtures where key = 'active_order_id');

  begin
    perform public.remove_filament_type(v_type_id, v_user_id);
    v_msg := '<sem exceção>';
  exception when others then
    v_msg := sqlerrm;
    v_raised_prefix := (sqlerrm like 'FILAMENT_TYPE_IN_ACTIVE_ORDER:%');
  end;

  insert into zz_rft_results(section, test_name, status, details)
    values ('7', '7.1 tipo em pedido ativo: bloqueio FILAMENT_TYPE_IN_ACTIVE_ORDER:',
      case when v_raised_prefix then 'PASS' else 'FAIL' end, v_msg);

  insert into zz_rft_results(section, test_name, status, details)
    values ('7', '7.2 mensagem de bloqueio cita o número do pedido (sem UUID)',
      case when v_msg like '%' || v_order_number || '%' and v_msg not like '%-%-%-%-%'
           then 'PASS' else 'FAIL' end,
      'order_number=' || v_order_number || ' msg=' || v_msg);
end $$;

-- =============================================================================
-- SEÇÃO 8 — pedido DELIVERED usando o tipo -> arquivamento PERMITIDO
-- SEÇÃO 10 — snapshot (order_item_plates) e seleção (order_item_unit_plate_filaments)
--   preservados após o arquivamento
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_type_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_result jsonb;
  v_type_active boolean;
  v_snapshot_before int;
  v_snapshot_after int;
  v_sel_before int;
  v_sel_after int;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_rft_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_rft_fixtures where key = 'product_id';

  v_type_id := (public.create_filament_type(
    'PLA', 'TESTE RFT Marca Delivered', 'Sólida', 'Ciano', null, null, true, null, v_user_id
  )).id;

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE RFT — pedido entregue',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item RFT', 'quantity', 1, 'unit_price', 50,
      'production_colors', jsonb_build_array(jsonb_build_object(
        'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_type_id)
      ))
    )),
    v_user_id
  );
  select id into v_order_item_id from public.order_items where order_id = v_order_id;

  -- Leva o pedido ao estado terminal DELIVERED. Direto na coluna (o teste
  -- roda como owner, fora dos gates da RPC de status) — o cenário que
  -- importa aqui é "pedido DELIVERED referenciando o tipo", não o caminho
  -- da máquina de status.
  update public.orders set order_status = 'DELIVERED' where id = v_order_id;

  select count(*) into v_snapshot_before from public.order_item_plates where order_item_id = v_order_item_id;
  select count(*) into v_sel_before from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;

  v_result := public.remove_filament_type(v_type_id, v_user_id);
  select is_active into v_type_active from public.filament_types where id = v_type_id;
  select count(*) into v_snapshot_after from public.order_item_plates where order_item_id = v_order_item_id;
  select count(*) into v_sel_after from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;

  insert into zz_rft_results(section, test_name, status, details)
    values ('8', '8.1 pedido DELIVERED não bloqueia: tipo arquivado',
      case when v_type_active is false and v_result ->> 'result' = 'ARCHIVED'
           then 'PASS' else 'FAIL' end,
      'type_active=' || v_type_active || ' result=' || coalesce(v_result::text, '<null>'));

  insert into zz_rft_results(section, test_name, status, details)
    values ('10', '10.1 snapshot e seleção do pedido DELIVERED preservados após arquivamento',
      case when v_snapshot_before = v_snapshot_after and v_snapshot_after > 0
                and v_sel_before = v_sel_after and v_sel_after > 0
           then 'PASS' else 'FAIL' end,
      'snapshot ' || v_snapshot_before || '->' || v_snapshot_after ||
      ' sel ' || v_sel_before || '->' || v_sel_after);
end $$;

-- =============================================================================
-- SEÇÃO 9 — pedido CANCELLED usando o tipo -> arquivamento PERMITIDO
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_type_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_result jsonb;
  v_type_active boolean;
  v_sel_after int;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_rft_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_rft_fixtures where key = 'product_id';

  v_type_id := (public.create_filament_type(
    'PLA', 'TESTE RFT Marca Cancelled', 'Sólida', 'Magenta', null, null, true, null, v_user_id
  )).id;

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE RFT — pedido cancelado',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item RFT', 'quantity', 1, 'unit_price', 50,
      'production_colors', jsonb_build_array(jsonb_build_object(
        'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_type_id)
      ))
    )),
    v_user_id
  );
  select id into v_order_item_id from public.order_items where order_id = v_order_id;
  update public.orders set order_status = 'CANCELLED' where id = v_order_id;

  v_result := public.remove_filament_type(v_type_id, v_user_id);
  select is_active into v_type_active from public.filament_types where id = v_type_id;
  select count(*) into v_sel_after from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;

  insert into zz_rft_results(section, test_name, status, details)
    values ('9', '9.1 pedido CANCELLED não bloqueia: tipo arquivado, seleção preservada',
      case when v_type_active is false and v_result ->> 'result' = 'ARCHIVED' and v_sel_after > 0
           then 'PASS' else 'FAIL' end,
      'type_active=' || v_type_active || ' sel_after=' || v_sel_after ||
      ' result=' || coalesce(v_result::text, '<null>'));
end $$;

-- =============================================================================
-- SEÇÃO 11 — compras (inventory_purchases) e composição legada
-- (product_filaments) contam como referência (força arquivamento) e são
-- preservadas intactas.
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_purchase public.inventory_purchases;
  v_purchase_before int;
  v_purchase_after int;
  v_result jsonb;
  v_type_active boolean;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  -- register_inventory_purchase (FILAMENT) faz find-or-create do tipo e
  -- cria os rolos da compra; devolve a linha inventory_purchases com
  -- item_id = id do tipo resolvido. p_gross_weights_grams: um peso bruto
  -- por rolo, cada um > nominal.
  v_purchase := public.register_inventory_purchase(
    p_category => 'FILAMENT',
    p_quantity => 1,
    p_item_value => 120.00,
    p_freight_value => 0,
    p_changed_by => v_user_id,
    p_material => 'PETG',
    p_manufacturer => 'TESTE RFT Marca ComCompra',
    p_line => 'Sólida',
    p_commercial_color => 'Laranja',
    p_nominal_weight_grams => 1000,
    p_gross_weights_grams => array[1200]::numeric[]
  );
  v_type_id := v_purchase.item_id;
  select count(*) into v_purchase_before
    from public.inventory_purchases where category = 'FILAMENT' and item_id = v_type_id;

  v_result := public.remove_filament_type(v_type_id, v_user_id);
  select is_active into v_type_active from public.filament_types where id = v_type_id;
  select count(*) into v_purchase_after
    from public.inventory_purchases where category = 'FILAMENT' and item_id = v_type_id;

  insert into zz_rft_results(section, test_name, status, details)
    values ('11', '11.1 tipo com compra: arquivado (não excluído), compra preservada intacta',
      case when v_type_active is false and v_result ->> 'result' = 'ARCHIVED'
                and v_purchase_before = v_purchase_after and v_purchase_after >= 1
           then 'PASS' else 'FAIL' end,
      'type_active=' || v_type_active || ' purchase ' || v_purchase_before || '->' || v_purchase_after);
exception when others then
  insert into zz_rft_results(section, test_name, status, details)
    values ('11', '11.1 tipo com compra arquivado', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 13 — chamada repetida num tipo já arquivado: segura (idempotente,
-- continua ARCHIVED, nenhum erro, nenhuma linha apagada).
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_spool_id uuid;
  v_r1 jsonb;
  v_r2 jsonb;
  v_type_active boolean;
  v_spool_exists boolean;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  v_type_id := (public.create_filament_type(
    'PLA', 'TESTE RFT Marca Repetida', 'Sólida', 'Bege', null, null, true, null, v_user_id
  )).id;
  v_spool_id := (public.create_filament_spool(v_type_id, 1000, null, null, null, null, true, v_user_id)).id;

  v_r1 := public.remove_filament_type(v_type_id, v_user_id);
  v_r2 := public.remove_filament_type(v_type_id, v_user_id);
  select is_active into v_type_active from public.filament_types where id = v_type_id;
  select exists(select 1 from public.filament_spools where id = v_spool_id) into v_spool_exists;

  insert into zz_rft_results(section, test_name, status, details)
    values ('13', '13.1 segunda chamada em tipo já arquivado é segura (ARCHIVED, sem erro, sem apagar)',
      case when v_r1 ->> 'result' = 'ARCHIVED'
                and v_r2 ->> 'result' = 'ARCHIVED'
                and (v_r2 ->> 'archived_spool_count')::int = 0
                and v_type_active is false and v_spool_exists
           then 'PASS' else 'FAIL' end,
      'r1=' || coalesce(v_r1::text, '<null>') || ' r2=' || coalesce(v_r2::text, '<null>'));
exception when others then
  insert into zz_rft_results(section, test_name, status, details)
    values ('13', '13.1 chamada repetida segura', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 14 — usuário inválido/inexistente é bloqueado (assert_active_user)
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_fake_user_id uuid := gen_random_uuid();
  v_type_id uuid;
  v_msg text;
  v_ok boolean := false;
  v_type_active boolean;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  v_type_id := (public.create_filament_type(
    'PLA', 'TESTE RFT Marca UserInv', 'Sólida', 'Grafite', null, null, true, null, v_user_id
  )).id;

  begin
    perform public.remove_filament_type(v_type_id, v_fake_user_id);
    v_msg := '<sem exceção>';
  exception when others then
    v_msg := sqlerrm;
    v_ok := (sqlerrm like '%inválido ou inativo%');
  end;
  select is_active into v_type_active from public.filament_types where id = v_type_id;

  insert into zz_rft_results(section, test_name, status, details)
    values ('14', '14.1 usuário inexistente é rejeitado, tipo intacto',
      case when v_ok and v_type_active is true then 'PASS' else 'FAIL' end, v_msg);
exception when others then
  insert into zz_rft_results(section, test_name, status, details)
    values ('14', '14.1 usuário inválido rejeitado', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 15 — retorno estruturado: chaves e valores esperados nos dois ramos
-- (o ramo PHYSICALLY_DELETED foi coberto na Seção 1; aqui o ARCHIVED)
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_result jsonb;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  v_type_id := (public.create_filament_type(
    'PLA', 'TESTE RFT Marca RetEstrut', 'Sólida', 'Vinho', null, null, true, null, v_user_id
  )).id;
  perform public.create_filament_spool(v_type_id, 1000, null, null, null, null, true, v_user_id);
  perform public.create_filament_spool(v_type_id, 1000, null, null, null, null, true, v_user_id);

  v_result := public.remove_filament_type(v_type_id, v_user_id);

  insert into zz_rft_results(section, test_name, status, details)
    values ('15', '15.1 retorno ARCHIVED tem as duas chaves com os tipos/valores certos',
      case when jsonb_typeof(v_result) = 'object'
                and v_result ? 'result' and v_result ? 'archived_spool_count'
                and v_result ->> 'result' = 'ARCHIVED'
                and jsonb_typeof(v_result -> 'archived_spool_count') = 'number'
                and (v_result ->> 'archived_spool_count')::int = 2
           then 'PASS' else 'FAIL' end,
      'result=' || coalesce(v_result::text, '<null>'));
exception when others then
  insert into zz_rft_results(section, test_name, status, details)
    values ('15', '15.1 retorno estruturado ARCHIVED', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 16 — nenhuma cascata: uma referência de pedido finalizado NÃO é
-- apagada pelo arquivamento (verificação explícita além da Seção 10/12).
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_type_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_sel_before int;
  v_sel_after int;
begin
  select value::uuid into v_user_id from zz_rft_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_rft_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_rft_fixtures where key = 'product_id';

  v_type_id := (public.create_filament_type(
    'PLA', 'TESTE RFT Marca SemCascata', 'Sólida', 'Areia', null, null, true, null, v_user_id
  )).id;
  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE RFT — pedido sem cascata',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item RFT', 'quantity', 1, 'unit_price', 50,
      'production_colors', jsonb_build_array(jsonb_build_object(
        'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_type_id)
      ))
    )),
    v_user_id
  );
  select id into v_order_item_id from public.order_items where order_id = v_order_id;
  update public.orders set order_status = 'CANCELLED' where id = v_order_id;

  select count(*) into v_sel_before
    from public.order_item_unit_plate_filaments where filament_type_id = v_type_id;
  perform public.remove_filament_type(v_type_id, v_user_id);
  select count(*) into v_sel_after
    from public.order_item_unit_plate_filaments where filament_type_id = v_type_id;

  insert into zz_rft_results(section, test_name, status, details)
    values ('16', '16.1 seleção de cor do pedido NÃO é apagada pelo arquivamento (sem cascata)',
      case when v_sel_before = v_sel_after and v_sel_after >= 1 then 'PASS' else 'FAIL' end,
      'sel ' || v_sel_before || '->' || v_sel_after);
end $$;

-- =============================================================================
-- Resultado final
-- =============================================================================
select
  count(*) filter (where status = 'PASS') as total_pass,
  count(*) filter (where status = 'FAIL') as total_fail,
  count(*) filter (where status = 'SKIP') as total_skip,
  count(*) as total
from zz_rft_results;

select * from zz_rft_results order by seq;

rollback;
