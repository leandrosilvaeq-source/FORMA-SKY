-- =============================================================================
-- Forma Sky — ajustes de Produtos/Clientes/Pedidos (2026-08-29)
-- TESTE DE INTEGRAÇÃO das 4 RPCs novas desta rodada:
--   - update_product (20260829143000_add_product_edit_function.sql)
--   - delete_customer (20260829140000_add_customer_deletion_function.sql)
--   - delete_order (20260829141000_add_order_deletion_function.sql)
--   - create_order_with_payment (20260829142000_add_order_payment_condition_and_atomic_creation.sql)
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nenhum dado criado por este
-- script persiste no banco. Usa somente cliente/produto/pedido "TESTE%",
-- nunca dados oficiais ou Petlink.
--
-- IMPORTANTE — as 4 migrations acima ainda NÃO foram aplicadas no projeto
-- Supabase remoto nesta rodada (restrição explícita desta tarefa: "não
-- aplique as migrations novas"). Por isso este script NÃO PÔDE ser
-- executado nesta rodada — as 4 funções que ele testa ainda não existem no
-- banco remoto. Escrito seguindo a mesma disciplina/estrutura já usada em
-- supabase/tests/product_filaments_composition_test.sql (que FOI executado
-- com sucesso quando sua migration correspondente já estava aplicada) —
-- pronto para ser executado assim que as 4 migrations forem aplicadas, numa
-- rodada futura autorizada.
--
-- Execução (quando as migrations estiverem aplicadas):
--   npx supabase db query --linked --file supabase/tests/product_customer_order_ops_test.sql

begin;

create temporary table zz_ops_test_results (
  seq serial primary key,
  section text not null,
  test_name text not null,
  status text not null,
  details text
);

create temporary table zz_ops_fixtures (
  key text primary key,
  value text not null
);

-- =============================================================================
-- SETUP — usuário ativo existente, produto/cliente/pedidos TESTE
-- =============================================================================
do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from public.users where is_active limit 1;
  if v_user_id is null then
    raise exception 'setup: nenhum usuário ativo encontrado para o teste';
  end if;
  insert into zz_ops_fixtures(key, value) values ('user_id', v_user_id::text);

  insert into zz_ops_test_results(section, test_name, status, details)
    values ('0', '0.0 setup: usuário ativo resolvido', 'PASS', 'user_id=' || v_user_id);
end $$;

-- =============================================================================
-- SEÇÃO 1 — update_product
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';

  v_product_id := public.create_product(
    'TESTE OPS — Produto Base', 'CATALOG', 'teste', 'produto criado pelo script de teste',
    50.00, 60, 10.00, null, null, false, v_user_id
  );
  insert into zz_ops_fixtures(key, value) values ('product_id', v_product_id::text);

  insert into zz_ops_test_results(section, test_name, status, details)
    values ('1', '1.0 setup: produto TESTE criado', 'PASS', 'product_id=' || v_product_id);
end $$;

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row public.products;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  begin
    v_row := public.update_product(
      v_product_id,
      jsonb_build_object('name', 'TESTE OPS — Produto Editado', 'category', 'nova categoria'),
      v_user_id
    );
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('1', '1.1 update_product edita name/category e devolve a linha atualizada',
        case when v_row.name = 'TESTE OPS — Produto Editado' and v_row.category = 'nova categoria' then 'PASS' else 'FAIL' end,
        'name=' || v_row.name || ' category=' || v_row.category);
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('1', '1.1 update_product edita name/category', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_price_before numeric;
  v_price_after numeric;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  select default_price into v_price_before from public.products where id = v_product_id;

  begin
    perform public.update_product(v_product_id, jsonb_build_object('default_price', 999), v_user_id);
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('1', '1.2 update_product REJEITA default_price (whitelist) — nunca altera o preço', 'FAIL', 'não levantou exceção');
  exception when others then
    select default_price into v_price_after from public.products where id = v_product_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('1', '1.2 update_product REJEITA default_price (whitelist) — nunca altera o preço',
        case when v_price_before = v_price_after and sqlerrm like '%chave(s) não suportada(s)%' then 'PASS' else 'FAIL' end,
        sqlerrm || ' price_before=' || v_price_before || ' price_after=' || v_price_after);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  begin
    perform public.update_product(v_product_id, jsonb_build_object('is_active', false), v_user_id);
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('1', '1.3 update_product REJEITA is_active (fora da whitelist — grant direto já existente cuida disso)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('1', '1.3 update_product REJEITA is_active (fora da whitelist)',
        case when sqlerrm like '%chave(s) não suportada(s)%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  begin
    perform public.update_product(v_product_id, '{}'::jsonb, v_user_id);
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('1', '1.4 update_product REJEITA p_patch vazio', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('1', '1.4 update_product REJEITA p_patch vazio',
        case when sqlerrm like '%p_patch vazio%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 2 — delete_customer
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';

  insert into public.customers (name, is_active)
    values ('TESTE OPS — Cliente sem vínculos', true)
    returning id into v_customer_id;

  begin
    perform public.delete_customer(v_customer_id, v_user_id);
    select count(*) into v_count from public.customers where id = v_customer_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('2', '2.1 delete_customer exclui fisicamente cliente sem vínculos',
        case when v_count = 0 then 'PASS' else 'FAIL' end, 'count=' || v_count);
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('2', '2.1 delete_customer exclui fisicamente cliente sem vínculos', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_company_id uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';

  insert into public.companies (name, is_active) values ('TESTE OPS — Empresa', true) returning id into v_company_id;
  insert into public.customers (name, company_id, is_active)
    values ('TESTE OPS — Cliente com empresa', v_company_id, true)
    returning id into v_customer_id;
  insert into zz_ops_fixtures(key, value) values ('customer_with_company_id', v_customer_id::text);
  insert into zz_ops_fixtures(key, value) values ('company_id', v_company_id::text);

  begin
    perform public.delete_customer(v_customer_id, v_user_id);
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('2', '2.2 delete_customer BLOQUEIA cliente com empresa vinculada (CUSTOMER_HAS_COMPANY:)', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_count from public.customers where id = v_customer_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('2', '2.2 delete_customer BLOQUEIA cliente com empresa vinculada (CUSTOMER_HAS_COMPANY:)',
        case when sqlerrm like 'CUSTOMER_HAS_COMPANY:%' and v_count = 1 then 'PASS' else 'FAIL' end,
        sqlerrm || ' count=' || v_count);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';

  insert into public.customers (name, is_active) values ('TESTE OPS — Cliente com pedido', true) returning id into v_customer_id;
  insert into zz_ops_fixtures(key, value) values ('customer_with_order_id', v_customer_id::text);

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'pedido de teste',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', (select value::uuid from zz_ops_fixtures where key = 'product_id'),
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 10
    )),
    v_user_id, null
  );
  insert into zz_ops_fixtures(key, value) values ('order_with_customer_id', v_order_id::text);

  begin
    perform public.delete_customer(v_customer_id, v_user_id);
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('2', '2.3 delete_customer BLOQUEIA cliente com pedido vinculado (CUSTOMER_HAS_ORDERS:)', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_count from public.customers where id = v_customer_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('2', '2.3 delete_customer BLOQUEIA cliente com pedido vinculado (CUSTOMER_HAS_ORDERS:)',
        case when sqlerrm like 'CUSTOMER_HAS_ORDERS:%' and v_count = 1 then 'PASS' else 'FAIL' end,
        sqlerrm || ' count=' || v_count);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 3 — delete_order
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ops_fixtures where key = 'customer_with_order_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'pedido QUOTE sem pagamento/aprovação',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 10
    )),
    v_user_id, null
  );

  begin
    perform public.delete_order(v_order_id, v_user_id);
    select count(*) into v_count from public.orders where id = v_order_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('3', '3.1 delete_order exclui pedido QUOTE sem pagamento/aprovação (+ order_items)',
        case when v_count = 0 then 'PASS' else 'FAIL' end, 'count=' || v_count);
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('3', '3.1 delete_order exclui pedido QUOTE sem pagamento/aprovação', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_order_id from zz_ops_fixtures where key = 'order_with_customer_id';

  perform public.register_payment(v_order_id, 'PIX', 10, 'INTEGRAL', now(), v_user_id, null);

  begin
    perform public.delete_order(v_order_id, v_user_id);
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('3', '3.2 delete_order BLOQUEIA pedido com pagamento vinculado (ORDER_DELETE_HAS_PAYMENTS:)', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_count from public.orders where id = v_order_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('3', '3.2 delete_order BLOQUEIA pedido com pagamento vinculado (ORDER_DELETE_HAS_PAYMENTS:)',
        case when sqlerrm like 'ORDER_DELETE_HAS_PAYMENTS:%' and v_count = 1 then 'PASS' else 'FAIL' end,
        sqlerrm || ' count=' || v_count);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ops_fixtures where key = 'customer_with_order_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'pedido para virar APPROVED (status inválido para exclusão)',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 10
    )),
    v_user_id, null
  );
  -- CATALOG puro auto-aprova ao entrar em WAITING_APPROVAL (try_auto_approve_order).
  perform public.change_order_status(v_order_id, 'WAITING_APPROVAL', v_user_id, null);

  begin
    perform public.delete_order(v_order_id, v_user_id);
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('3', '3.3 delete_order BLOQUEIA pedido fora de QUOTE/CANCELLED (ORDER_DELETE_INVALID_STATUS:)', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_count from public.orders where id = v_order_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('3', '3.3 delete_order BLOQUEIA pedido fora de QUOTE/CANCELLED (ORDER_DELETE_INVALID_STATUS:)',
        case when sqlerrm like 'ORDER_DELETE_INVALID_STATUS:%' and v_count = 1 then 'PASS' else 'FAIL' end,
        sqlerrm || ' count=' || v_count);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ops_fixtures where key = 'customer_with_order_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'pedido CANCELLED (deve poder ser excluído)',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 10
    )),
    v_user_id, null
  );
  perform public.change_order_status(v_order_id, 'CANCELLED', v_user_id, null);

  begin
    perform public.delete_order(v_order_id, v_user_id);
    select count(*) into v_count from public.orders where id = v_order_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('3', '3.4 delete_order PERMITE excluir pedido CANCELLED sem pagamento/aprovação',
        case when v_count = 0 then 'PASS' else 'FAIL' end, 'count=' || v_count);
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('3', '3.4 delete_order PERMITE excluir pedido CANCELLED sem pagamento/aprovação', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 4 — create_order_with_payment
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_result jsonb;
  v_order_id uuid;
  v_payment_status text;
  v_payment_count integer;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ops_fixtures where key = 'customer_with_order_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  begin
    v_result := public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'ADVANCE teste',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 100
      )),
      v_user_id, 'PIX', 'ADVANCE', null
    );
    v_order_id := (v_result ->> 'order_id')::uuid;
    select payment_status into v_payment_status from public.orders where id = v_order_id;
    select count(*) into v_payment_count from public.payments where order_id = v_order_id and payment_type = 'INTEGRAL';
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.1 ADVANCE: cria pedido + pagamento INTEGRAL na mesma transação, payment_status=PAID',
        case when v_payment_status = 'PAID' and v_payment_count = 1 then 'PASS' else 'FAIL' end,
        'payment_status=' || v_payment_status || ' payment_count=' || v_payment_count);
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.1 ADVANCE: cria pedido + pagamento INTEGRAL', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_result jsonb;
  v_order_id uuid;
  v_payment_status text;
  v_balance_due numeric;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ops_fixtures where key = 'customer_with_order_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  begin
    v_result := public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'DEPOSIT teste',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 100
      )),
      v_user_id, 'PIX', 'DEPOSIT', 30
    );
    v_order_id := (v_result ->> 'order_id')::uuid;
    select payment_status, (total_value + shipping_cost - coalesce((select sum(amount) from public.payments where order_id = v_order_id), 0))
      into v_payment_status, v_balance_due
      from public.orders where id = v_order_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.2 DEPOSIT: cria pedido + sinal (SINAL), saldo devedor = total - sinal, payment_status=DEPOSIT_RECEIVED',
        case when v_payment_status = 'DEPOSIT_RECEIVED' and v_balance_due = 70 then 'PASS' else 'FAIL' end,
        'payment_status=' || v_payment_status || ' balance_due=' || v_balance_due);
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.2 DEPOSIT: cria pedido + sinal', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_orders_before integer;
  v_orders_after integer;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ops_fixtures where key = 'customer_with_order_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  select count(*) into v_orders_before from public.orders where customer_id = v_customer_id;

  begin
    perform public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'DEPOSIT >= total (deve falhar E desfazer o pedido)',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 100
      )),
      v_user_id, 'PIX', 'DEPOSIT', 100
    );
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.3 DEPOSIT >= total: REJEITADO e o pedido inteiro é desfeito (rollback, zero órfão)', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_orders_after from public.orders where customer_id = v_customer_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.3 DEPOSIT >= total: REJEITADO e o pedido inteiro é desfeito (rollback, zero órfão)',
        case when sqlerrm like '%deve ser menor que o total do pedido%' and v_orders_after = v_orders_before then 'PASS' else 'FAIL' end,
        sqlerrm || ' orders_before=' || v_orders_before || ' orders_after=' || v_orders_after);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_result jsonb;
  v_order_id uuid;
  v_payment_status text;
  v_payment_count integer;
  v_payment_condition text;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ops_fixtures where key = 'customer_with_order_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  begin
    v_result := public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'ON_DELIVERY teste',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 100
      )),
      v_user_id, null, 'ON_DELIVERY', null
    );
    v_order_id := (v_result ->> 'order_id')::uuid;
    select payment_status, payment_condition into v_payment_status, v_payment_condition from public.orders where id = v_order_id;
    select count(*) into v_payment_count from public.payments where order_id = v_order_id;
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.4 ON_DELIVERY: cria pedido sem nenhum pagamento, payment_status=WAITING_PAYMENT, payment_condition gravado',
        case when v_payment_status = 'WAITING_PAYMENT' and v_payment_count = 0 and v_payment_condition = 'ON_DELIVERY' then 'PASS' else 'FAIL' end,
        'payment_status=' || v_payment_status || ' payment_count=' || v_payment_count || ' payment_condition=' || v_payment_condition);
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.4 ON_DELIVERY: cria pedido sem pagamento', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ops_fixtures where key = 'customer_with_order_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  begin
    perform public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'payment_condition inválido',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 100
      )),
      v_user_id, null, 'INVALID_VALUE', null
    );
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.5 payment_condition inválido é REJEITADO', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.5 payment_condition inválido é REJEITADO',
        case when sqlerrm like '%p_payment_condition inválido%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
begin
  select value::uuid into v_user_id from zz_ops_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_ops_fixtures where key = 'customer_with_order_id';
  select value::uuid into v_product_id from zz_ops_fixtures where key = 'product_id';

  begin
    perform public.create_order_with_payment(
      v_customer_id, null, null, null, null, 0, 0, 'ADVANCE sem payment_method',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 100
      )),
      v_user_id, null, 'ADVANCE', null
    );
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.6 ADVANCE sem payment_method é REJEITADO', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_ops_test_results(section, test_name, status, details)
      values ('4', '4.6 ADVANCE sem payment_method é REJEITADO',
        case when sqlerrm like '%p_payment_method é obrigatório%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- Resumo
-- =============================================================================
select
  (select count(*) from zz_ops_test_results where status = 'PASS') as pass_count,
  (select count(*) from zz_ops_test_results where status = 'FAIL') as fail_count,
  (select count(*) from zz_ops_test_results) as total_count,
  (select json_agg(json_build_object('section', section, 'test_name', test_name, 'status', status, 'details', details) order by seq) from zz_ops_test_results) as results;

rollback;
