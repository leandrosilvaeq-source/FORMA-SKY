-- =============================================================================
-- Forma Sky — status inicial automático de Pedidos NOVOS (regra aprovada
-- 2026-08-29, migration 20260829150000_add_order_initial_status_classification.sql)
-- TESTE DE INTEGRAÇÃO transacional das 2 novas funções
-- (determine_order_initial_status / validate_catalog_composition_for_creation)
-- e das duas sobrecargas de create_order() que passam a chamá-las.
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nenhum dado criado por este
-- script persiste no banco. Usa somente cliente/produto/tipo de filamento
-- "TESTE%", nunca dados oficiais ou Petlink.
--
-- IMPORTANTE — a migration acima ainda NÃO foi aplicada no projeto Supabase
-- remoto nesta rodada (restrição explícita desta tarefa: "não aplique a
-- migration"). Por isso este script NÃO PÔDE ser executado nesta rodada —
-- create_order() ainda não tem a nova lógica no banco remoto. Escrito
-- seguindo a mesma disciplina/estrutura já usada em
-- supabase/tests/product_customer_order_ops_test.sql (executado com
-- sucesso quando sua migration correspondente já estava aplicada) — pronto
-- para ser executado assim que a migration for aplicada, numa rodada
-- futura autorizada.
--
-- Execução (quando a migration estiver aplicada):
--   npx supabase db query --linked --file supabase/tests/order_initial_status_test.sql

begin;

create temporary table zz_ois_test_results (
  seq serial primary key,
  section text not null,
  test_name text not null,
  status text not null,
  details text
);

create temporary table zz_ois_fixtures (
  key text primary key,
  value text not null
);

-- =============================================================================
-- SETUP — usuário ativo existente, cliente TESTE, 1 tipo de filamento TESTE
-- ativo, 2 produtos CATALOG TESTE COM composição e 2 produtos CATALOG TESTE
-- SEM composição.
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_filament_type_id uuid;
  v_product_composed_1 uuid;
  v_product_composed_2 uuid;
  v_product_incomplete_1 uuid;
  v_product_incomplete_2 uuid;
begin
  select id into v_user_id from public.users where is_active limit 1;
  if v_user_id is null then
    raise exception 'setup: nenhum usuário ativo encontrado para o teste';
  end if;
  insert into zz_ois_fixtures(key, value) values ('user_id', v_user_id::text);

  insert into public.customers (name, is_active)
    values ('TESTE OPS — Cliente status inicial', true)
    returning id into v_customer_id;
  insert into zz_ois_fixtures(key, value) values ('customer_id', v_customer_id::text);

  v_filament_type_id := (public.create_filament_type(
    'PLA', 'TESTE Marca Status Inicial', 'Sólida', 'Preto', null, null, true, null, v_user_id
  )).id;

  v_product_composed_1 := public.create_product(
    'TESTE OPS — Produto COM composição 1', 'CATALOG', 'teste',
    'produto com filamento cadastrado', 50.00, 60, 20.00, 4, null, false, v_user_id
  );
  perform public.set_product_filaments(
    v_product_composed_1,
    jsonb_build_array(jsonb_build_object('id', v_filament_type_id, 'theoretical_weight_grams', 10)),
    v_user_id
  );
  insert into zz_ois_fixtures(key, value) values ('product_composed_1', v_product_composed_1::text);

  v_product_composed_2 := public.create_product(
    'TESTE OPS — Produto COM composição 2', 'CATALOG', 'teste',
    'produto com filamento cadastrado', 60.00, 60, 20.00, 4, null, false, v_user_id
  );
  perform public.set_product_filaments(
    v_product_composed_2,
    jsonb_build_array(jsonb_build_object('id', v_filament_type_id, 'theoretical_weight_grams', 15)),
    v_user_id
  );
  insert into zz_ois_fixtures(key, value) values ('product_composed_2', v_product_composed_2::text);

  -- Produtos CATALOG SEM nenhuma linha em product_filaments (nunca chamado
  -- set_product_filaments para eles).
  v_product_incomplete_1 := public.create_product(
    'TESTE OPS — Produto SEM composição 1', 'CATALOG', 'teste',
    'produto sem filamento cadastrado', 40.00, 60, 20.00, 4, null, false, v_user_id
  );
  insert into zz_ois_fixtures(key, value) values ('product_incomplete_1', v_product_incomplete_1::text);

  v_product_incomplete_2 := public.create_product(
    'TESTE OPS — Produto SEM composição 2', 'CATALOG', 'teste',
    'produto sem filamento cadastrado', 45.00, 60, 20.00, 4, null, false, v_user_id
  );
  insert into zz_ois_fixtures(key, value) values ('product_incomplete_2', v_product_incomplete_2::text);

  insert into zz_ois_test_results(section, test_name, status, details)
    values ('0', '0.0 setup: usuário/cliente/tipo de filamento/4 produtos TESTE criados', 'PASS',
      'user_id=' || v_user_id || ' customer_id=' || v_customer_id);
end $$;

-- =============================================================================
-- SEÇÃO 1 — classificação (create_order, 11 parâmetros — sobrecarga
-- efetivamente chamada pela Edge Function/create_order_with_payment)
-- =============================================================================

-- 1.1 — CATALOG (com composição) → IN_PRODUCTION_QUEUE; um único registro
-- de histórico (from_status null, to_status IN_PRODUCTION_QUEUE); nenhum
-- histórico fictício de QUOTE/WAITING_APPROVAL/APPROVED; nenhuma approval.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_status text;
  v_history_count integer;
  v_history_to_status text;
  v_history_from_status text;
  v_approval_count integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_composed_1';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG com composição',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
      )),
      v_user_id, null
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    select count(*) into v_history_count from public.order_status_history where order_id = v_order_id;
    select from_status, to_status into v_history_from_status, v_history_to_status
      from public.order_status_history where order_id = v_order_id;
    select count(*) into v_approval_count
      from public.approvals a join public.order_items oi on oi.id = a.order_item_id
      where oi.order_id = v_order_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.1 CATALOG com composição -> IN_PRODUCTION_QUEUE, histórico único direto, zero approval',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' and v_history_count = 1
                and v_history_from_status is null and v_history_to_status = 'IN_PRODUCTION_QUEUE'
                and v_approval_count = 0
             then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status || ' history_count=' || v_history_count ||
        ' history=' || coalesce(v_history_from_status, 'null') || '->' || v_history_to_status ||
        ' approval_count=' || v_approval_count);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.1 CATALOG com composição -> IN_PRODUCTION_QUEUE', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.2 — SPOT (sozinho) → IN_PRODUCTION_QUEUE; não exige product_id.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_status text;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'SPOT sozinho',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'SPOT', 'item_name', 'Item SPOT teste', 'quantity', 1, 'unit_price', 30,
        'spot_details', jsonb_build_object('source_reference', 'teste')
      )),
      v_user_id, null
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.2 SPOT sozinho (sem product_id) -> IN_PRODUCTION_QUEUE',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.2 SPOT sozinho -> IN_PRODUCTION_QUEUE', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.3 — CATALOG (com composição) + SPOT → IN_PRODUCTION_QUEUE.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_status text;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_composed_1';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG+SPOT',
      jsonb_build_array(
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50),
        jsonb_build_object('item_type', 'SPOT', 'item_name', 'Item SPOT teste', 'quantity', 1, 'unit_price', 30,
          'spot_details', jsonb_build_object('source_reference', 'teste'))
      ),
      v_user_id, null
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.3 CATALOG (com composição) + SPOT -> IN_PRODUCTION_QUEUE',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.3 CATALOG+SPOT -> IN_PRODUCTION_QUEUE', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.4 — Dois itens CATALOG, ambos com composição → IN_PRODUCTION_QUEUE.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_1 uuid;
  v_product_2 uuid;
  v_order_id uuid;
  v_order_status text;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_1 from zz_ois_fixtures where key = 'product_composed_1';
  select value::uuid into v_product_2 from zz_ois_fixtures where key = 'product_composed_2';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'dois CATALOG com composição',
      jsonb_build_array(
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_1,
          'item_name', 'Item 1', 'quantity', 1, 'unit_price', 50),
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_2,
          'item_name', 'Item 2', 'quantity', 1, 'unit_price', 60)
      ),
      v_user_id, null
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.4 dois itens CATALOG (ambos com composição) -> IN_PRODUCTION_QUEUE',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.4 dois CATALOG com composição -> IN_PRODUCTION_QUEUE', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.5 — CUSTOM (sozinho) → QUOTE (comportamento atual preservado).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_status text;
  v_history_to_status text;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CUSTOM sozinho',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CUSTOM', 'item_name', 'Item CUSTOM teste', 'quantity', 1, 'unit_price', 200,
        'custom_details', jsonb_build_object('current_version', 'v1.0')
      )),
      v_user_id, null
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    select to_status into v_history_to_status from public.order_status_history where order_id = v_order_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.5 CUSTOM sozinho -> QUOTE (fluxo normal preservado)',
        case when v_order_status = 'QUOTE' and v_history_to_status = 'QUOTE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status || ' history_to=' || v_history_to_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.5 CUSTOM sozinho -> QUOTE', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.6 — CATALOG (SEM composição) + CUSTOM → QUOTE, e NÃO bloqueado por
-- composição (decisão de escopo documentada na migration: composição só é
-- exigida quando o pedido nasceria em IN_PRODUCTION_QUEUE).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_status text;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_incomplete_1';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG sem composição + CUSTOM',
      jsonb_build_array(
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item CATALOG teste', 'quantity', 1, 'unit_price', 40),
        jsonb_build_object('item_type', 'CUSTOM', 'item_name', 'Item CUSTOM teste', 'quantity', 1, 'unit_price', 200,
          'custom_details', jsonb_build_object('current_version', 'v1.0'))
      ),
      v_user_id, null
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.6 CATALOG (SEM composição) + CUSTOM -> QUOTE, nunca bloqueado por composição',
        case when v_order_status = 'QUOTE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.6 CATALOG sem composição + CUSTOM -> QUOTE', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.7 — SPOT + CUSTOM → QUOTE.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_status text;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'SPOT + CUSTOM',
      jsonb_build_array(
        jsonb_build_object('item_type', 'SPOT', 'item_name', 'Item SPOT teste', 'quantity', 1, 'unit_price', 30,
          'spot_details', jsonb_build_object('source_reference', 'teste')),
        jsonb_build_object('item_type', 'CUSTOM', 'item_name', 'Item CUSTOM teste', 'quantity', 1, 'unit_price', 200,
          'custom_details', jsonb_build_object('current_version', 'v1.0'))
      ),
      v_user_id, null
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.7 SPOT + CUSTOM -> QUOTE',
        case when v_order_status = 'QUOTE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.7 SPOT + CUSTOM -> QUOTE', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 2 — validação de composição CATALOG (bloqueio, zero órfão)
-- =============================================================================

-- 2.1 — CATALOG sem product_id é REJEITADO antes de qualquer escrita.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_orders_before integer;
  v_orders_after integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select count(*) into v_orders_before from public.orders where customer_id = v_customer_id;

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG sem product_id',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'item_name', 'Item sem produto', 'quantity', 1, 'unit_price', 50
      )),
      v_user_id, null
    );
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('2', '2.1 CATALOG sem product_id é REJEITADO, zero pedido criado', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_orders_after from public.orders where customer_id = v_customer_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('2', '2.1 CATALOG sem product_id é REJEITADO, zero pedido criado',
        case when sqlerrm like '%Item CATALOG exige product_id%' and v_orders_after = v_orders_before then 'PASS' else 'FAIL' end,
        sqlerrm || ' orders_before=' || v_orders_before || ' orders_after=' || v_orders_after);
  end;
end $$;

-- 2.2 — CATALOG sem composição (produto existe, mas sem product_filaments)
-- é REJEITADO com o marcador ORDER_CATALOG_MISSING_COMPOSITION:, nenhum
-- pedido/item órfão.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_orders_before integer;
  v_orders_after integer;
  v_items_after integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_incomplete_1';
  select count(*) into v_orders_before from public.orders where customer_id = v_customer_id;

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG sem composição sozinho',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 40
      )),
      v_user_id, null
    );
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('2', '2.2 CATALOG sem composição é REJEITADO (ORDER_CATALOG_MISSING_COMPOSITION:), zero órfão', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_orders_after from public.orders where customer_id = v_customer_id;
    select count(*) into v_items_after from public.order_items where product_id = v_product_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('2', '2.2 CATALOG sem composição é REJEITADO (ORDER_CATALOG_MISSING_COMPOSITION:), zero órfão',
        case when sqlerrm like 'ORDER_CATALOG_MISSING_COMPOSITION:%'
                and sqlerrm like '%TESTE OPS — Produto SEM composição 1%'
                and v_orders_after = v_orders_before and v_items_after = 0
             then 'PASS' else 'FAIL' end,
        sqlerrm || ' orders_before=' || v_orders_before || ' orders_after=' || v_orders_after || ' items_after=' || v_items_after);
  end;
end $$;

-- 2.3 — Dois produtos incompletos no mesmo pedido: os DOIS nomes aparecem
-- na mesma mensagem de erro.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_1 uuid;
  v_product_2 uuid;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_1 from zz_ois_fixtures where key = 'product_incomplete_1';
  select value::uuid into v_product_2 from zz_ois_fixtures where key = 'product_incomplete_2';

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'dois produtos incompletos',
      jsonb_build_array(
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_1,
          'item_name', 'Item 1', 'quantity', 1, 'unit_price', 40),
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_2,
          'item_name', 'Item 2', 'quantity', 1, 'unit_price', 45)
      ),
      v_user_id, null
    );
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('2', '2.3 dois produtos sem composição -> AMBOS os nomes aparecem na mesma mensagem', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('2', '2.3 dois produtos sem composição -> AMBOS os nomes aparecem na mesma mensagem',
        case when sqlerrm like '%TESTE OPS — Produto SEM composição 1%'
                and sqlerrm like '%TESTE OPS — Produto SEM composição 2%'
             then 'PASS' else 'FAIL' end,
        sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 3 — create_order_with_payment: as 3 formas de pagamento continuam
-- funcionando sobre a nova classificação, sem nenhuma interferência mútua.
-- =============================================================================

-- 3.1 — ADVANCE: pedido nasce em IN_PRODUCTION_QUEUE, pagamento integral
-- criado, payment_status=PAID.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_result jsonb;
  v_order_id uuid;
  v_order_status text;
  v_payment_status text;
  v_payment_count integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_composed_1';

  begin
    v_result := public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'ADVANCE + status novo',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
      )),
      v_user_id, 'PIX', 'ADVANCE', null
    );
    v_order_id := (v_result ->> 'order_id')::uuid;
    select order_status, payment_status into v_order_status, v_payment_status from public.orders where id = v_order_id;
    select count(*) into v_payment_count from public.payments where order_id = v_order_id and payment_type = 'INTEGRAL';
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('3', '3.1 ADVANCE: pedido nasce em IN_PRODUCTION_QUEUE, pagamento integral, payment_status=PAID',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' and v_payment_status = 'PAID' and v_payment_count = 1 then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status || ' payment_status=' || v_payment_status || ' payment_count=' || v_payment_count);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('3', '3.1 ADVANCE + status novo', 'FAIL', sqlerrm);
  end;
end $$;

-- 3.2 — DEPOSIT: pedido nasce em IN_PRODUCTION_QUEUE, sinal criado, saldo
-- devedor correto.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_result jsonb;
  v_order_id uuid;
  v_order_status text;
  v_payment_status text;
  v_balance_due numeric;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_composed_1';

  begin
    v_result := public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'DEPOSIT + status novo',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
      )),
      v_user_id, 'PIX', 'DEPOSIT', 20
    );
    v_order_id := (v_result ->> 'order_id')::uuid;
    select order_status, payment_status,
           (total_value + shipping_cost - coalesce((select sum(amount) from public.payments where order_id = v_order_id), 0))
      into v_order_status, v_payment_status, v_balance_due
      from public.orders where id = v_order_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('3', '3.2 DEPOSIT: pedido nasce em IN_PRODUCTION_QUEUE, sinal criado, saldo devedor correto',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' and v_payment_status = 'DEPOSIT_RECEIVED' and v_balance_due = 30 then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status || ' payment_status=' || v_payment_status || ' balance_due=' || v_balance_due);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('3', '3.2 DEPOSIT + status novo', 'FAIL', sqlerrm);
  end;
end $$;

-- 3.3 — ON_DELIVERY: pedido nasce em IN_PRODUCTION_QUEUE, nenhum pagamento,
-- saldo = total.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_result jsonb;
  v_order_id uuid;
  v_order_status text;
  v_payment_count integer;
  v_balance_due numeric;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_composed_1';

  begin
    v_result := public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'ON_DELIVERY + status novo',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
      )),
      v_user_id, null, 'ON_DELIVERY', null
    );
    v_order_id := (v_result ->> 'order_id')::uuid;
    select order_status,
           (total_value + shipping_cost - coalesce((select sum(amount) from public.payments where order_id = v_order_id), 0))
      into v_order_status, v_balance_due
      from public.orders where id = v_order_id;
    select count(*) into v_payment_count from public.payments where order_id = v_order_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('3', '3.3 ON_DELIVERY: pedido nasce em IN_PRODUCTION_QUEUE, zero pagamento, saldo = total',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' and v_payment_count = 0 and v_balance_due = 50 then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status || ' payment_count=' || v_payment_count || ' balance_due=' || v_balance_due);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('3', '3.3 ON_DELIVERY + status novo', 'FAIL', sqlerrm);
  end;
end $$;

-- 3.4 — Falha financeira (DEPOSIT >= total) continua desfazendo TODO o
-- pedido, mesmo já nascendo em IN_PRODUCTION_QUEUE (rollback completo).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_orders_before integer;
  v_orders_after integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_composed_1';
  select count(*) into v_orders_before from public.orders where customer_id = v_customer_id;

  begin
    perform public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'DEPOSIT >= total + status novo (deve desfazer tudo)',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
      )),
      v_user_id, 'PIX', 'DEPOSIT', 50
    );
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('3', '3.4 falha financeira desfaz TODO o pedido, mesmo com status novo', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_orders_after from public.orders where customer_id = v_customer_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('3', '3.4 falha financeira desfaz TODO o pedido, mesmo com status novo',
        case when v_orders_after = v_orders_before then 'PASS' else 'FAIL' end,
        sqlerrm || ' orders_before=' || v_orders_before || ' orders_after=' || v_orders_after);
  end;
end $$;

-- 3.5 — Idempotência: retry com a MESMA chave + payload sobre um pedido que
-- nasce em IN_PRODUCTION_QUEUE devolve o MESMO order_id, sem duplicar.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_key text := 'zz-teste-status-inicial-' || gen_random_uuid()::text;
  v_result1 jsonb;
  v_result2 jsonb;
  v_order_count integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_composed_1';

  begin
    v_result1 := public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'idempotência + status novo',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
      )),
      v_user_id, null, 'ON_DELIVERY', null, v_key
    );
    v_result2 := public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'idempotência + status novo',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
      )),
      v_user_id, null, 'ON_DELIVERY', null, v_key
    );
    select count(*) into v_order_count from public.orders where idempotency_key = v_key;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('3', '3.5 retry com a MESMA chave (pedido em IN_PRODUCTION_QUEUE) devolve o MESMO order_id, sem duplicar',
        case when (v_result1 ->> 'order_id') = (v_result2 ->> 'order_id') and v_order_count = 1 then 'PASS' else 'FAIL' end,
        'order_id1=' || (v_result1 ->> 'order_id') || ' order_id2=' || (v_result2 ->> 'order_id') || ' order_count=' || v_order_count);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('3', '3.5 retry idempotente + status novo', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 4 — edição de pedido existente nunca dispara a nova regra
-- =============================================================================

-- 4.1 — update_order() (edição de cabeçalho) sobre um pedido recém-criado
-- em IN_PRODUCTION_QUEUE preserva o status inalterado.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_status_before text;
  v_status_after text;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_composed_1';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'para editar depois',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
      )),
      v_user_id, null
    );
    select order_status into v_status_before from public.orders where id = v_order_id;

    perform public.update_order(
      v_order_id, v_customer_id, null, null, null, null, null, null, 0, 0, 'observação editada', v_user_id
    );
    select order_status into v_status_after from public.orders where id = v_order_id;

    insert into zz_ois_test_results(section, test_name, status, details)
      values ('4', '4.1 editar cabeçalho (update_order) de um pedido IN_PRODUCTION_QUEUE não altera o status',
        case when v_status_before = 'IN_PRODUCTION_QUEUE' and v_status_after = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'status_before=' || v_status_before || ' status_after=' || v_status_after);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('4', '4.1 editar cabeçalho não altera status', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 5 — permissões e grants
-- =============================================================================
do $$
declare
  v_ok boolean;
begin
  select
    not has_function_privilege('authenticated', 'public.determine_order_initial_status(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.determine_order_initial_status(jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.determine_order_initial_status(jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE')
  into v_ok;
  insert into zz_ois_test_results(section, test_name, status, details)
    values ('5', '5.1 helpers internos sem NENHUM grant; as 2 sobrecargas de create_order continuam exclusivas de service_role',
      case when v_ok then 'PASS' else 'FAIL' end, 'v_ok=' || v_ok);
exception when others then
  insert into zz_ois_test_results(section, test_name, status, details)
    values ('5', '5.1 permissões/grants', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- Resumo
-- =============================================================================
select
  (select count(*) from zz_ois_test_results where status = 'PASS') as pass_count,
  (select count(*) from zz_ois_test_results where status = 'FAIL') as fail_count,
  (select count(*) from zz_ois_test_results) as total_count,
  (select json_agg(json_build_object('section', section, 'test_name', test_name, 'status', status, 'details', details) order by seq) from zz_ois_test_results) as results;

rollback;
