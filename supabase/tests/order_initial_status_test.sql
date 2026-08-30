-- =============================================================================
-- Forma Sky — status inicial automático de Pedidos NOVOS (regra aprovada
-- 2026-08-29, migration 20260829150000_add_order_initial_status_classification.sql,
-- JÁ APLICADA ao remoto) + estrutura produtiva por plates SEM filamento
-- (migration 20260829180000_add_categories_plate_weight_and_order_colors.sql,
-- ainda NÃO aplicada) — TESTE DE INTEGRAÇÃO transacional de
-- determine_order_initial_status() (inalterada por 20260829180000) e da
-- validação de estrutura produtiva efetivamente chamada por create_order() a
-- partir dessa migration pendente: validate_catalog_production_structure_for_creation
-- (substitui validate_catalog_composition_for_creation, preservada no banco
-- mas sem nenhum chamador a partir de então).
--
-- AUDITADO E ADAPTADO NESTA RODADA CORRETIVA (2026-08-30) — a versão
-- anterior deste arquivo montava os Produtos "com composição" inserindo
-- linhas diretas em product_plate_filaments (peso por filamento, somado
-- pela função antiga) e verificava o marcador ORDER_CATALOG_MISSING_COMPOSITION:.
-- A partir da migration 20260829180000, a validação de estrutura produtiva
-- NUNCA olha para filamento em nenhuma forma (nem product_filaments, nem
-- product_plate_filaments) — só a existência de linhas em product_plates
-- (peso direto) importa. Os fixtures/comentários/asserções deste arquivo
-- foram todos atualizados para esse contrato; nenhum teste deste arquivo
-- depende mais de filamento vinculado ao Produto. A Seção 7 (nova) cobre
-- explicitamente o comportamento de production_colors (sempre opcional na
-- criação, nunca altera o status inicial, snapshot de plates correto).
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nenhum dado criado por este
-- script persiste no banco. Usa somente cliente/produto "TESTE%", nunca
-- dados oficiais ou Petlink.
--
-- IMPORTANTE — a migration 20260829180000 ainda NÃO foi aplicada ao projeto
-- Supabase remoto nesta rodada (restrição explícita desta tarefa: "não
-- aplique a migration"). Por isso este script NÃO PÔDE ser executado nesta
-- rodada — create_order() ainda não chama validate_catalog_production_structure_for_creation
-- no banco remoto (continua chamando a função anterior, da migration já
-- aplicada). Escrito seguindo a mesma disciplina/estrutura já usada em
-- supabase/tests/product_customer_order_ops_test.sql — pronto para ser
-- executado assim que a migration 20260829180000 for aplicada, numa rodada
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
-- SETUP — usuário ativo existente, cliente TESTE, 2 produtos CATALOG TESTE
-- COM estrutura produtiva (product_plates com weight_grams direto) e 2
-- produtos CATALOG TESTE SEM nenhum plate. Nenhum tipo de filamento é
-- criado neste arquivo — a validação de estrutura produtiva a partir da
-- migration 20260829180000 nunca depende de filamento em nenhuma forma.
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
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

  -- Estrutura produtiva por PLATES, peso DIRETO (fonte autoritativa a
  -- partir de 20260829180000_add_categories_plate_weight_and_order_colors.sql)
  -- — create_product (11 parâmetros, legado) continua sendo usado para
  -- estes 4 fixtures em vez de create_product_with_plates só para
  -- preservar exatamente o default_weight_grams/default_print_time_seconds
  -- já fixados no restante deste arquivo (20.00/60), sem depender do
  -- cálculo automático da soma dos plates; o plate em si é inserido
  -- diretamente com weight_grams igual a esse mesmo peso — nenhum
  -- filamento é criado ou referenciado em lugar nenhum.
  v_product_composed_1 := public.create_product(
    'TESTE OPS — Produto COM estrutura 1', 'CATALOG', 'teste',
    'produto com estrutura produtiva cadastrada', 50.00, 60, 20.00, 4, null, false, v_user_id
  );
  insert into public.product_plates (product_id, plate_number, production_time_seconds, weight_grams)
    values (v_product_composed_1, 1, 60, 20.00);
  insert into zz_ois_fixtures(key, value) values ('product_composed_1', v_product_composed_1::text);

  v_product_composed_2 := public.create_product(
    'TESTE OPS — Produto COM estrutura 2', 'CATALOG', 'teste',
    'produto com estrutura produtiva cadastrada', 60.00, 60, 20.00, 4, null, false, v_user_id
  );
  insert into public.product_plates (product_id, plate_number, production_time_seconds, weight_grams)
    values (v_product_composed_2, 1, 60, 20.00);
  insert into zz_ois_fixtures(key, value) values ('product_composed_2', v_product_composed_2::text);

  -- Produtos CATALOG SEM nenhuma linha em product_plates (nunca chamado
  -- create_product_with_plates/update_product_full/set_product_production
  -- para eles).
  v_product_incomplete_1 := public.create_product(
    'TESTE OPS — Produto SEM estrutura 1', 'CATALOG', 'teste',
    'produto sem estrutura produtiva cadastrada', 40.00, 60, 20.00, 4, null, false, v_user_id
  );
  insert into zz_ois_fixtures(key, value) values ('product_incomplete_1', v_product_incomplete_1::text);

  v_product_incomplete_2 := public.create_product(
    'TESTE OPS — Produto SEM estrutura 2', 'CATALOG', 'teste',
    'produto sem estrutura produtiva cadastrada', 45.00, 60, 20.00, 4, null, false, v_user_id
  );
  insert into zz_ois_fixtures(key, value) values ('product_incomplete_2', v_product_incomplete_2::text);

  insert into zz_ois_test_results(section, test_name, status, details)
    values ('0', '0.0 setup: usuário/cliente/4 produtos TESTE criados (2 com plate, 2 sem nenhum)', 'PASS',
      'user_id=' || v_user_id || ' customer_id=' || v_customer_id);
end $$;

-- =============================================================================
-- SEÇÃO 1 — classificação (create_order, 11 parâmetros — sobrecarga
-- efetivamente chamada pela Edge Function/create_order_with_payment)
-- =============================================================================

-- 1.1 — CATALOG (com estrutura produtiva) → IN_PRODUCTION_QUEUE; um único registro
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
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG com estrutura produtiva',
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
      values ('1', '1.1 CATALOG com estrutura produtiva -> IN_PRODUCTION_QUEUE, histórico único direto, zero approval',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' and v_history_count = 1
                and v_history_from_status is null and v_history_to_status = 'IN_PRODUCTION_QUEUE'
                and v_approval_count = 0
             then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status || ' history_count=' || v_history_count ||
        ' history=' || coalesce(v_history_from_status, 'null') || '->' || v_history_to_status ||
        ' approval_count=' || v_approval_count);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.1 CATALOG com estrutura produtiva -> IN_PRODUCTION_QUEUE', 'FAIL', sqlerrm);
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

-- 1.3 — CATALOG (com estrutura produtiva) + SPOT → IN_PRODUCTION_QUEUE.
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
      values ('1', '1.3 CATALOG (com estrutura produtiva) + SPOT -> IN_PRODUCTION_QUEUE',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.3 CATALOG+SPOT -> IN_PRODUCTION_QUEUE', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.4 — Dois itens CATALOG, ambos com estrutura produtiva → IN_PRODUCTION_QUEUE.
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
      v_customer_id, null, null, null, null, 0, 0, 'dois CATALOG com estrutura produtiva',
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
      values ('1', '1.4 dois itens CATALOG (ambos com estrutura produtiva) -> IN_PRODUCTION_QUEUE',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.4 dois CATALOG com estrutura produtiva -> IN_PRODUCTION_QUEUE', 'FAIL', sqlerrm);
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

-- 1.6 — CATALOG (SEM estrutura produtiva) + CUSTOM → QUOTE, e NÃO bloqueado
-- por estrutura (decisão de escopo documentada na migration: estrutura
-- produtiva só é exigida quando o pedido nasceria em IN_PRODUCTION_QUEUE).
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
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG sem estrutura produtiva + CUSTOM',
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
      values ('1', '1.6 CATALOG (SEM estrutura produtiva) + CUSTOM -> QUOTE, nunca bloqueado por estrutura',
        case when v_order_status = 'QUOTE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('1', '1.6 CATALOG sem estrutura produtiva + CUSTOM -> QUOTE', 'FAIL', sqlerrm);
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
-- SEÇÃO 2 — validação de estrutura produtiva CATALOG (bloqueio, zero órfão)
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

-- 2.2 — CATALOG sem estrutura produtiva (produto existe, mas sem nenhuma
-- linha em product_plates) é REJEITADO com o marcador
-- ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE: (nome atual do marcador a
-- partir da migration 20260829180000 — substitui
-- ORDER_CATALOG_MISSING_COMPOSITION:), nenhum pedido/item órfão.
-- v_items_before/v_items_after comparam a CONTAGEM (nunca um valor
-- absoluto): o produto_incomplete_1 já pode ter um order_item legítimo de
-- um teste anterior desta mesma seção (1.6, CATALOG+CUSTOM, que não exige
-- estrutura produtiva por decisão de escopo) — um valor absoluto de 0 seria
-- um falso FAIL contra esse item legítimo e preexistente, não um órfão real.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_orders_before integer;
  v_orders_after integer;
  v_items_before integer;
  v_items_after integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_incomplete_1';
  select count(*) into v_orders_before from public.orders where customer_id = v_customer_id;
  select count(*) into v_items_before from public.order_items where product_id = v_product_id;

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG sem estrutura produtiva sozinho',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 40
      )),
      v_user_id, null
    );
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('2', '2.2 CATALOG sem estrutura produtiva é REJEITADO (ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:), zero órfão', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_orders_after from public.orders where customer_id = v_customer_id;
    select count(*) into v_items_after from public.order_items where product_id = v_product_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('2', '2.2 CATALOG sem estrutura produtiva é REJEITADO (ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:), zero órfão',
        case when sqlerrm like 'ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:%'
                and sqlerrm like '%TESTE OPS — Produto SEM estrutura 1%'
                and v_orders_after = v_orders_before and v_items_after = v_items_before
             then 'PASS' else 'FAIL' end,
        sqlerrm || ' orders_before=' || v_orders_before || ' orders_after=' || v_orders_after ||
        ' items_before=' || v_items_before || ' items_after=' || v_items_after);
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
      values ('2', '2.3 dois produtos sem estrutura produtiva -> AMBOS os nomes aparecem na mesma mensagem', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('2', '2.3 dois produtos sem estrutura produtiva -> AMBOS os nomes aparecem na mesma mensagem',
        case when sqlerrm like '%TESTE OPS — Produto SEM estrutura 1%'
                and sqlerrm like '%TESTE OPS — Produto SEM estrutura 2%'
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
    -- validate_catalog_composition_for_creation (migration 20260829150000):
    -- preservada no banco, mas sem nenhum grant desde sempre — continua sem
    -- nenhum EXECUTE, mesmo não sendo mais chamada por create_order() a
    -- partir de 20260829180000 (pendente).
    and not has_function_privilege('authenticated', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE')
    -- validate_catalog_production_structure_for_creation (migration
    -- 20260829180000, pendente) — a função efetivamente chamada por
    -- create_order() a partir dessa migration; também zero grants (interna).
    and not has_function_privilege('authenticated', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.change_order_status(uuid,text,uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.change_order_status(uuid,text,uuid,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.change_order_status(uuid,text,uuid,text)', 'EXECUTE')
  into v_ok;
  insert into zz_ois_test_results(section, test_name, status, details)
    values ('5', '5.1 helpers internos (antigo e atual) sem NENHUM grant; as 2 sobrecargas de create_order e change_order_status continuam exclusivas de service_role',
      case when v_ok then 'PASS' else 'FAIL' end, 'v_ok=' || v_ok);
exception when others then
  insert into zz_ois_test_results(section, test_name, status, details)
    values ('5', '5.1 permissões/grants', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 6 — remoção do gate de tempo de pesquisa/modelagem do SPOT em
-- change_order_status() (decisão do usuário, 2026-08-29, rodada seguinte à
-- criação original deste arquivo).
-- =============================================================================

-- 6.1 — SPOT novo SEM search_time_status no payload (chave omitida) ->
-- IN_PRODUCTION_QUEUE; valor armazenado é o default NOT_INFORMED
-- (create_order já fazia isso — só confirma que nada bloqueia).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_order_status text;
  v_search_time_status text;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'SPOT sem search_time_status no payload',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'SPOT', 'item_name', 'Item SPOT teste', 'quantity', 1, 'unit_price', 30,
        'spot_details', jsonb_build_object('source_reference', 'teste')
      )),
      v_user_id, null
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    select oi.id into v_item_id from public.order_items oi where oi.order_id = v_order_id;
    select search_time_status into v_search_time_status from public.spot_item_details where order_item_id = v_item_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('6', '6.1 SPOT novo sem search_time_status no payload -> IN_PRODUCTION_QUEUE (default NOT_INFORMED, sem bloqueio)',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' and v_search_time_status = 'NOT_INFORMED' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status || ' search_time_status=' || v_search_time_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('6', '6.1 SPOT novo sem search_time_status no payload', 'FAIL', sqlerrm);
  end;
end $$;

-- 6.2 — SPOT novo com search_time_status explicitamente 'NOT_INFORMED' ->
-- IN_PRODUCTION_QUEUE (mesmo valor, agora informado explicitamente em vez
-- de omitido — nenhuma diferença de comportamento).
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
      v_customer_id, null, null, null, null, 0, 0, 'SPOT com search_time_status NOT_INFORMED explícito',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'SPOT', 'item_name', 'Item SPOT teste', 'quantity', 1, 'unit_price', 30,
        'spot_details', jsonb_build_object('source_reference', 'teste', 'search_time_status', 'NOT_INFORMED')
      )),
      v_user_id, null
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('6', '6.2 SPOT novo com search_time_status=NOT_INFORMED explícito -> IN_PRODUCTION_QUEUE',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('6', '6.2 SPOT novo com search_time_status=NOT_INFORMED explícito', 'FAIL', sqlerrm);
  end;
end $$;

-- 6.3 — CATALOG (com estrutura produtiva) + SPOT sem tempo do SPOT ->
-- IN_PRODUCTION_QUEUE (mistura, mesma checagem da Seção 1.3, agora com
-- asserção explícita do search_time_status).
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
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG+SPOT sem tempo do SPOT',
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
      values ('6', '6.3 CATALOG (com estrutura produtiva) + SPOT sem tempo -> IN_PRODUCTION_QUEUE',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('6', '6.3 CATALOG+SPOT sem tempo', 'FAIL', sqlerrm);
  end;
end $$;

-- 6.4 — Pedido EXISTENTE (SPOT+CUSTOM, nascido em QUOTE por ter CUSTOM) faz
-- uma transição REAL via change_order_status() até IN_PRODUCTION_QUEUE,
-- passando pela aprovação dos dois itens, com o item SPOT NUNCA tendo
-- search_time_status=RECORDED em nenhum momento — a transição final não
-- pode ser bloqueada por isso (o gate real que foi removido).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_spot_item_id uuid;
  v_custom_item_id uuid;
  v_custom_version_id uuid;
  v_status_after_wa text;
  v_status_after_approvals text;
  v_status_final text;
  v_search_time_status text;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'SPOT+CUSTOM existente, transição real até a Fila',
      jsonb_build_array(
        jsonb_build_object('item_type', 'SPOT', 'item_name', 'Item SPOT teste', 'quantity', 1, 'unit_price', 30,
          'spot_details', jsonb_build_object('source_reference', 'teste')),
        jsonb_build_object('item_type', 'CUSTOM', 'item_name', 'Item CUSTOM teste', 'quantity', 1, 'unit_price', 200,
          'custom_details', jsonb_build_object('current_version', 'v1.0'))
      ),
      v_user_id, null
    );

    select id into v_spot_item_id from public.order_items where order_id = v_order_id and item_type = 'SPOT';
    select id into v_custom_item_id from public.order_items where order_id = v_order_id and item_type = 'CUSTOM';
    select id into v_custom_version_id from public.custom_versions where order_item_id = v_custom_item_id and version_number = 'v1.0';

    perform public.change_order_status(v_order_id, 'WAITING_APPROVAL', v_user_id);
    select order_status into v_status_after_wa from public.orders where id = v_order_id;

    perform public.register_approval(v_spot_item_id, 'WHATSAPP', now(), v_user_id);
    perform public.register_approval(v_custom_item_id, 'FORMAL_DOCUMENT', now(), v_user_id, v_custom_version_id);
    select order_status into v_status_after_approvals from public.orders where id = v_order_id;

    -- Ponto central deste teste: a transição real para a Fila, com o item
    -- SPOT ainda em search_time_status=NOT_INFORMED (nunca RECORDED).
    perform public.change_order_status(v_order_id, 'IN_PRODUCTION_QUEUE', v_user_id);
    select order_status into v_status_final from public.orders where id = v_order_id;
    select search_time_status into v_search_time_status from public.spot_item_details where order_item_id = v_spot_item_id;

    insert into zz_ois_test_results(section, test_name, status, details)
      values ('6', '6.4 pedido SPOT+CUSTOM existente: QUOTE->WAITING_APPROVAL->APPROVED->IN_PRODUCTION_QUEUE sem search_time_status=RECORDED, nenhum erro de tempo',
        case when v_status_after_wa = 'WAITING_APPROVAL' and v_status_after_approvals = 'APPROVED'
                and v_status_final = 'IN_PRODUCTION_QUEUE' and v_search_time_status = 'NOT_INFORMED'
             then 'PASS' else 'FAIL' end,
        'after_wa=' || v_status_after_wa || ' after_approvals=' || v_status_after_approvals ||
        ' final=' || v_status_final || ' search_time_status=' || v_search_time_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('6', '6.4 pedido SPOT+CUSTOM existente: transição real até a Fila sem tempo registrado', 'FAIL', sqlerrm);
  end;
end $$;

-- 6.5 — Tempo já registrado (RECORDED) num item SPOT permanece armazenado
-- depois de uma transição de status real (não é lido, não é apagado, não
-- é resetado por change_order_status()).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_search_time_status text;
  v_search_minutes integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'SPOT com tempo já registrado, sobrevive à transição',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'SPOT', 'item_name', 'Item SPOT teste', 'quantity', 1, 'unit_price', 30,
        'spot_details', jsonb_build_object('source_reference', 'teste', 'search_time_status', 'RECORDED', 'search_minutes', 45)
      )),
      v_user_id, null
    );
    select id into v_item_id from public.order_items where order_id = v_order_id;

    -- Pedido já nasce em IN_PRODUCTION_QUEUE (só SPOT) — avança mais um
    -- passo real (IN_PRODUCTION) para provar que a transição não mexe no
    -- tempo já registrado.
    perform public.change_order_status(v_order_id, 'IN_PRODUCTION', v_user_id);
    select search_time_status, search_minutes into v_search_time_status, v_search_minutes
      from public.spot_item_details where order_item_id = v_item_id;

    insert into zz_ois_test_results(section, test_name, status, details)
      values ('6', '6.5 tempo já registrado (RECORDED/45) permanece intacto após transição real IN_PRODUCTION_QUEUE -> IN_PRODUCTION',
        case when v_search_time_status = 'RECORDED' and v_search_minutes = 45 then 'PASS' else 'FAIL' end,
        'search_time_status=' || v_search_time_status || ' search_minutes=' || v_search_minutes);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('6', '6.5 tempo já registrado permanece intacto após transição real', 'FAIL', sqlerrm);
  end;
end $$;

-- 6.6 — Remover o gate de SPOT não altera NENHUMA outra transição:
-- cancelamento continua bloqueado a partir de IN_PRODUCTION (regressão do
-- gate de CANCELLED, código totalmente independente do que foi removido).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'SPOT: cancelamento continua bloqueado após IN_PRODUCTION',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'SPOT', 'item_name', 'Item SPOT teste', 'quantity', 1, 'unit_price', 30,
        'spot_details', jsonb_build_object('source_reference', 'teste')
      )),
      v_user_id, null
    );
    perform public.change_order_status(v_order_id, 'IN_PRODUCTION', v_user_id);

    begin
      perform public.change_order_status(v_order_id, 'CANCELLED', v_user_id);
      insert into zz_ois_test_results(section, test_name, status, details)
        values ('6', '6.6 cancelamento continua bloqueado após IN_PRODUCTION (gate independente, não afetado pela remoção do gate de SPOT)', 'FAIL', 'não levantou exceção');
    exception when others then
      insert into zz_ois_test_results(section, test_name, status, details)
        values ('6', '6.6 cancelamento continua bloqueado após IN_PRODUCTION (gate independente, não afetado pela remoção do gate de SPOT)',
          case when sqlerrm like '%Cancelamento só é permitido antes do início da produção%' then 'PASS' else 'FAIL' end, sqlerrm);
    end;
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('6', '6.6 cancelamento continua bloqueado após IN_PRODUCTION', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 7 — production_colors (migration 20260829180000, ainda não
-- aplicada): SEMPRE opcional na criação, nunca altera o status inicial, e o
-- snapshot de plates (order_item_plates) é criado corretamente a partir do
-- Produto no momento da criação. Nenhum destes testes depende de nenhum
-- fixture das Seções anteriores — setup próprio (7.0).
-- =============================================================================

-- 7.0 — setup: 1 tipo de filamento TESTE ativo e 1 Produto CATALOG TESTE
-- com 2 plates (create_product_with_plates, contrato atual — peso direto,
-- sem filamento no cadastro).
do $$
declare
  v_user_id uuid;
  v_filament_type_id uuid;
  v_product_id uuid;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';

  v_filament_type_id := (public.create_filament_type(
    'PLA', 'TESTE Marca Cores Status Inicial', 'Sólida', 'Preto', null, null, true, null, v_user_id
  )).id;
  insert into zz_ois_fixtures(key, value) values ('filament_type_id', v_filament_type_id::text);

  v_product_id := public.create_product_with_plates(
    'TESTE OPS — Produto p/ cores (2 plates)', 'CATALOG', jsonb_build_array('teste'), null,
    70.00, null, true,
    jsonb_build_array(
      jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 40),
      jsonb_build_object('production_time_seconds', 1800, 'weight_grams', 10)
    ),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  insert into zz_ois_fixtures(key, value) values ('product_2plates', v_product_id::text);

  insert into zz_ois_test_results(section, test_name, status, details)
    values ('7', '7.0 setup: tipo de filamento + Produto com 2 plates criados', 'PASS',
      'filament_type_id=' || v_filament_type_id || ' product_2plates=' || v_product_id);
end $$;

-- 7.1 — CATALOG sem NENHUMA cor no payload -> entra em IN_PRODUCTION_QUEUE
-- normalmente; zero linhas em order_item_unit_plate_filaments (nenhum
-- vínculo de cor é inventado quando nada foi enviado).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_order_status text;
  v_color_count integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_2plates';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG sem cores',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item sem cores', 'quantity', 2, 'unit_price', 70
      )),
      v_user_id
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    select id into v_order_item_id from public.order_items where order_id = v_order_id;
    select count(*) into v_color_count from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;

    insert into zz_ois_test_results(section, test_name, status, details)
      values ('7', '7.1 CATALOG sem cores -> IN_PRODUCTION_QUEUE normalmente, zero vínculo de cor inventado',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' and v_color_count = 0 then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status || ' color_count=' || v_color_count);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('7', '7.1 CATALOG sem cores', 'FAIL', sqlerrm);
  end;
end $$;

-- 7.2 — CATALOG com cores PARCIAIS (quantity=2, 2 plates = 4 combinações
-- possíveis, só 1 enviada) -> ainda entra em IN_PRODUCTION_QUEUE (cores
-- parciais nunca bloqueiam a criação nem a entrada na Fila).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_filament_type_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_order_status text;
  v_color_count integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_2plates';
  select value::uuid into v_filament_type_id from zz_ois_fixtures where key = 'filament_type_id';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG com cores parciais',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item cores parciais', 'quantity', 2, 'unit_price', 70,
        'production_colors', jsonb_build_array(jsonb_build_object(
          'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_filament_type_id)
        ))
      )),
      v_user_id
    );
    select order_status into v_order_status from public.orders where id = v_order_id;
    select id into v_order_item_id from public.order_items where order_id = v_order_id;
    select count(*) into v_color_count from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;

    insert into zz_ois_test_results(section, test_name, status, details)
      values ('7', '7.2 CATALOG com cores PARCIAIS (1 de 4 combinações unidade/plate) -> IN_PRODUCTION_QUEUE normalmente',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' and v_color_count = 1 then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status || ' color_count=' || v_color_count);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('7', '7.2 CATALOG com cores parciais', 'FAIL', sqlerrm);
  end;
end $$;

-- 7.3 — cores NUNCA alteram o status inicial: um pedido idêntico, mas com
-- TODAS as cores preenchidas (2 unidades x 2 plates = 4 combinações),
-- nasce no MESMO status (IN_PRODUCTION_QUEUE) que o pedido sem nenhuma cor
-- (7.1) e o de cores parciais (7.2) — determine_order_initial_status()
-- nunca lê production_colors.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_filament_type_id uuid;
  v_order_id uuid;
  v_order_status text;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_2plates';
  select value::uuid into v_filament_type_id from zz_ois_fixtures where key = 'filament_type_id';

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG com cores completas',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item cores completas', 'quantity', 2, 'unit_price', 70,
        'production_colors', jsonb_build_array(
          jsonb_build_object('plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_filament_type_id)),
          jsonb_build_object('plate_number', 2, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_filament_type_id)),
          jsonb_build_object('plate_number', 1, 'unit_number', 2, 'filament_type_ids', jsonb_build_array(v_filament_type_id)),
          jsonb_build_object('plate_number', 2, 'unit_number', 2, 'filament_type_ids', jsonb_build_array(v_filament_type_id))
        )
      )),
      v_user_id
    );
    select order_status into v_order_status from public.orders where id = v_order_id;

    insert into zz_ois_test_results(section, test_name, status, details)
      values ('7', '7.3 cores COMPLETAS na criação: MESMO status inicial (IN_PRODUCTION_QUEUE) que sem cores (7.1) e cores parciais (7.2) — status nunca depende de cor',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_ois_test_results(section, test_name, status, details)
      values ('7', '7.3 cores completas -> status inicial', 'FAIL', sqlerrm);
  end;
end $$;

-- 7.4 — snapshot de plates (order_item_plates) criado corretamente: 2
-- linhas, plate_number/weight_grams/production_time_seconds idênticos ao
-- Produto no momento da criação (40g/3600s no plate 1, 10g/1800s no plate 2).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_snapshot_count integer;
  v_weight_1 numeric;
  v_time_1 integer;
  v_weight_2 numeric;
  v_time_2 integer;
begin
  select value::uuid into v_user_id from zz_ois_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ois_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_ois_fixtures where key = 'product_2plates';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'CATALOG snapshot de plates',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item snapshot', 'quantity', 1, 'unit_price', 70
    )),
    v_user_id
  );
  select id into v_order_item_id from public.order_items where order_id = v_order_id;

  select count(*) into v_snapshot_count from public.order_item_plates where order_item_id = v_order_item_id;
  select weight_grams, production_time_seconds into v_weight_1, v_time_1
    from public.order_item_plates where order_item_id = v_order_item_id and plate_number = 1;
  select weight_grams, production_time_seconds into v_weight_2, v_time_2
    from public.order_item_plates where order_item_id = v_order_item_id and plate_number = 2;

  insert into zz_ois_test_results(section, test_name, status, details)
    values ('7', '7.4 snapshot de plates criado corretamente: 2 linhas, peso/tempo idênticos ao Produto (40g/3600s, 10g/1800s)',
      case when v_snapshot_count = 2 and v_weight_1 = 40 and v_time_1 = 3600 and v_weight_2 = 10 and v_time_2 = 1800
           then 'PASS' else 'FAIL' end,
      'snapshot_count=' || v_snapshot_count || ' plate1=' || v_weight_1 || 'g/' || v_time_1 || 's' ||
      ' plate2=' || v_weight_2 || 'g/' || v_time_2 || 's');
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
