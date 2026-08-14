-- =============================================================================
-- Forma Sky — Bloco 1 (Clientes e Pedidos) — TESTE DE INTEGRAÇÃO
-- =============================================================================
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION.
-- NÃO deve ser colocado em supabase/migrations/, NUNCA deve ser executado
-- via `supabase db push`, e não deve ser referenciado pelo histórico de
-- migrations do projeto.
--
-- Roda inteiro dentro de UMA ÚNICA transação, terminada sempre com ROLLBACK
-- (nunca COMMIT) — nenhum dado criado por este script persiste no banco,
-- mesmo se algum teste individual falhar ou lançar exceção inesperada.
--
-- Execução prevista:
--   npx supabase db query --linked --file supabase/tests/bloco1_integration_test.sql
--
-- Estrutura:
--   1. BEGIN
--   2. tabelas temporárias de apoio (zz_test_results, zz_fixtures)
--   3. seções de teste (0 a 9), cada caso dentro de bloco DO $$ ... $$
--      protegido por BEGIN/EXCEPTION — nenhuma exceção de teste individual
--      escapa para abortar a transação externa
--   4. SELECT final dos resultados
--   5. ROLLBACK
--
-- Todo teste registra uma linha em zz_test_results com status PASS ou FAIL.
-- Casos de sucesso esperado: PASS se concluir sem erro; FAIL + SQLERRM se
-- lançar qualquer exceção.
-- Casos de falha esperada: PASS somente se a exceção esperada ocorrer; FAIL
-- se nenhuma exceção ocorrer ou se ocorrer uma exceção diferente da
-- esperada.
--
-- Testes que envolvem SET LOCAL ROLE ficam agrupados na Seção 9, no final
-- da bateria, cada um com RESET ROLE incondicional (roda tanto no caminho
-- de sucesso quanto no de exceção capturada) antes de qualquer teste
-- seguinte.

begin;

create temporary table zz_test_results (
  seq serial primary key,
  section text not null,
  test_name text not null,
  status text not null,
  details text
);

-- Estado compartilhado entre blocos DO $$ ... $$ (cada bloco tem escopo de
-- variáveis próprio) — também descartada no ROLLBACK final, junto com tudo
-- o mais criado nesta transação.
create temporary table zz_fixtures (
  key text primary key,
  value text
);

-- =============================================================================
-- SEÇÃO 0 — Setup (fixtures compartilhadas)
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_auth_user_id uuid;
begin
  begin
    select id, auth_user_id into v_user_id, v_auth_user_id
      from public.users
      where is_active
      limit 1;

    if v_user_id is null then
      raise exception 'nenhum usuário ativo encontrado em public.users';
    end if;

    insert into zz_fixtures(key, value) values ('user_id', v_user_id::text)
      on conflict (key) do update set value = excluded.value;
    insert into zz_fixtures(key, value) values ('auth_user_id', coalesce(v_auth_user_id::text, ''))
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 localizar usuário ativo real (public.users)', 'PASS', 'user_id=' || v_user_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 localizar usuário ativo real (public.users)', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_customer_id uuid;
begin
  begin
    insert into public.customers (name, whatsapp, notes)
      values ('TESTE INTEGRACAO BLOCO1', '+5511999990000',
              'Cliente de teste do script de integração — dados sob ROLLBACK, nunca persistem.')
      returning id into v_customer_id;

    insert into zz_fixtures(key, value) values ('customer_id', v_customer_id::text)
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.2 criar cliente de teste', 'PASS', 'customer_id=' || v_customer_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.2 criar cliente de teste', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 1 — create_product
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_history_count integer;
  v_history_price numeric;
  v_history_effective_to timestamptz;
  v_default_price numeric;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    if v_user_id is null then
      raise exception 'fixture ausente: user_id (setup 0.1 falhou)';
    end if;

    v_product_id := public.create_product(
      'Produto Teste Integração', 'teste', 'produto criado pelo script de integração',
      100.00, 120, 25.50, 4, null, false, v_user_id
    );

    insert into zz_fixtures(key, value) values ('product_id', v_product_id::text)
      on conflict (key) do update set value = excluded.value;

    select count(*), max(price), max(effective_to)
      into v_history_count, v_history_price, v_history_effective_to
      from public.product_price_history
      where product_id = v_product_id;

    select default_price into v_default_price from public.products where id = v_product_id;

    if v_history_count <> 1 then
      raise exception 'esperado exatamente 1 linha em product_price_history, encontrado %', v_history_count;
    end if;
    if v_history_price <> 100.00 then
      raise exception 'price do histórico inicial deveria ser 100.00, veio %', v_history_price;
    end if;
    if v_history_effective_to is not null then
      raise exception 'effective_to do histórico inicial deveria ser NULL';
    end if;
    if v_default_price <> 100.00 then
      raise exception 'products.default_price deveria ser 100.00, veio %', v_default_price;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1 create_product cria produto + 1 histórico inicial (effective_to NULL, price=default_price)',
              'PASS', 'product_id=' || v_product_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1 create_product cria produto + 1 histórico inicial (effective_to NULL, price=default_price)',
              'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 2 — update_product_price
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_current_count integer;
  v_current_price numeric;
  v_closed_count integer;
  v_default_price numeric;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
    if v_user_id is null or v_product_id is null then
      raise exception 'fixture ausente: user_id/product_id (seção 1 falhou)';
    end if;

    perform public.update_product_price(v_product_id, 150.00, v_user_id, 'ajuste de teste');

    select count(*), max(price) into v_current_count, v_current_price
      from public.product_price_history
      where product_id = v_product_id and effective_to is null;

    select count(*) into v_closed_count
      from public.product_price_history
      where product_id = v_product_id and effective_to is not null and price = 100.00;

    select default_price into v_default_price from public.products where id = v_product_id;

    if v_current_count <> 1 then
      raise exception 'esperado exatamente 1 linha vigente (effective_to NULL), encontrado %', v_current_count;
    end if;
    if v_current_price <> 150.00 then
      raise exception 'preço vigente deveria ser 150.00, veio %', v_current_price;
    end if;
    if v_closed_count <> 1 then
      raise exception 'esperado exatamente 1 linha antiga fechada (price=100.00, effective_to preenchido), encontrado %', v_closed_count;
    end if;
    if v_default_price <> 150.00 then
      raise exception 'products.default_price deveria ser 150.00, veio %', v_default_price;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.1 update_product_price fecha vigência anterior, cria nova, atualiza default_price, mantém unicidade',
              'PASS', 'novo preço=150.00');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.1 update_product_price fecha vigência anterior, cria nova, atualiza default_price, mantém unicidade',
              'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 3 — create_order (CATALOG / SPOT / CUSTOM / misto / vazio)
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_status text;
  v_payment_status text;
  v_subtotal numeric;
  v_total_value numeric;
  v_history_count integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
    if v_user_id is null or v_customer_id is null or v_product_id is null then
      raise exception 'fixture ausente (setup/seção 1 falhou)';
    end if;

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste CATALOG',
      jsonb_build_array(
        jsonb_build_object(
          'item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item Catálogo Teste', 'quantity', 2, 'unit_price', 150.00
        )
      ),
      v_user_id
    );

    insert into zz_fixtures(key, value) values ('order_catalog_id', v_order_id::text)
      on conflict (key) do update set value = excluded.value;

    select order_number, order_status, payment_status, subtotal, total_value
      into v_order_number, v_status, v_payment_status, v_subtotal, v_total_value
      from public.orders where id = v_order_id;

    select count(*) into v_history_count from public.order_status_history
      where order_id = v_order_id and from_status is null and to_status = 'QUOTE';

    if v_order_number !~ '^FS-[0-9]{4}-[0-9]{4}$' then
      raise exception 'order_number fora do formato: %', v_order_number;
    end if;
    if v_status <> 'QUOTE' then raise exception 'order_status deveria ser QUOTE, veio %', v_status; end if;
    if v_payment_status <> 'WAITING_PAYMENT' then raise exception 'payment_status deveria ser WAITING_PAYMENT, veio %', v_payment_status; end if;
    if v_subtotal <> 300.00 then raise exception 'subtotal deveria ser 300.00, veio %', v_subtotal; end if;
    if v_total_value <> 300.00 then raise exception 'total_value deveria ser 300.00, veio %', v_total_value; end if;
    if v_history_count <> 1 then raise exception 'esperado 1 order_status_history inicial, encontrado %', v_history_count; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.1 create_order CATALOG-only: order_number/status/payment_status/subtotal/total_value/histórico inicial',
              'PASS', 'order_id=' || v_order_id || ' order_number=' || v_order_number);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.1 create_order CATALOG-only: order_number/status/payment_status/subtotal/total_value/histórico inicial',
              'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_status text;
  v_payment_status text;
  v_subtotal numeric;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    if v_user_id is null or v_customer_id is null then
      raise exception 'fixture ausente (setup falhou)';
    end if;

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste SPOT',
      jsonb_build_array(
        jsonb_build_object(
          'item_type', 'SPOT', 'item_name', 'Item Spot Teste', 'quantity', 1, 'unit_price', 80.00,
          'spot_details', jsonb_build_object('source_reference', 'maquete teste')
        )
      ),
      v_user_id
    );

    insert into zz_fixtures(key, value) values ('order_spot_id', v_order_id::text)
      on conflict (key) do update set value = excluded.value;

    select order_number, order_status, payment_status, subtotal
      into v_order_number, v_status, v_payment_status, v_subtotal
      from public.orders where id = v_order_id;

    if v_order_number !~ '^FS-[0-9]{4}-[0-9]{4}$' then raise exception 'order_number fora do formato: %', v_order_number; end if;
    if v_status <> 'QUOTE' then raise exception 'order_status deveria ser QUOTE, veio %', v_status; end if;
    if v_payment_status <> 'WAITING_PAYMENT' then raise exception 'payment_status deveria ser WAITING_PAYMENT'; end if;
    if v_subtotal <> 80.00 then raise exception 'subtotal deveria ser 80.00, veio %', v_subtotal; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.2 create_order SPOT-only: order_number/status/payment_status/subtotal', 'PASS', 'order_id=' || v_order_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.2 create_order SPOT-only: order_number/status/payment_status/subtotal', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_status text;
  v_subtotal numeric;
  v_current_version text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    if v_user_id is null or v_customer_id is null then raise exception 'fixture ausente'; end if;

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste CUSTOM',
      jsonb_build_array(
        jsonb_build_object(
          'item_type', 'CUSTOM', 'item_name', 'Item Custom Teste', 'quantity', 1, 'unit_price', 120.00,
          'custom_details', jsonb_build_object('current_version', 'v1.0')
        )
      ),
      v_user_id
    );

    insert into zz_fixtures(key, value) values ('order_custom_id', v_order_id::text)
      on conflict (key) do update set value = excluded.value;

    select order_number, order_status, subtotal into v_order_number, v_status, v_subtotal
      from public.orders where id = v_order_id;

    select cid.current_version into v_current_version
      from public.order_items oi
      join public.custom_item_details cid on cid.order_item_id = oi.id
      where oi.order_id = v_order_id;

    if v_order_number !~ '^FS-[0-9]{4}-[0-9]{4}$' then raise exception 'order_number fora do formato: %', v_order_number; end if;
    if v_status <> 'QUOTE' then raise exception 'order_status deveria ser QUOTE'; end if;
    if v_subtotal <> 120.00 then raise exception 'subtotal deveria ser 120.00, veio %', v_subtotal; end if;
    if v_current_version <> 'v1.0' then raise exception 'current_version deveria ser v1.0, veio %', v_current_version; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.3 create_order CUSTOM-only: current_version=v1.0 criada em custom_item_details', 'PASS', 'order_id=' || v_order_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.3 create_order CUSTOM-only: current_version=v1.0 criada em custom_item_details', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_item_count integer;
  v_subtotal numeric;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
    if v_user_id is null or v_customer_id is null or v_product_id is null then raise exception 'fixture ausente'; end if;

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste misto',
      jsonb_build_array(
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item Catálogo (misto)', 'quantity', 1, 'unit_price', 150.00),
        jsonb_build_object('item_type', 'SPOT', 'item_name', 'Item Spot (misto)', 'quantity', 1, 'unit_price', 80.00, 'spot_details', jsonb_build_object('source_reference', 'teste misto')),
        jsonb_build_object('item_type', 'CUSTOM', 'item_name', 'Item Custom (misto)', 'quantity', 1, 'unit_price', 120.00, 'custom_details', jsonb_build_object('current_version', 'v1.0'))
      ),
      v_user_id
    );

    insert into zz_fixtures(key, value) values ('order_mixed_id', v_order_id::text)
      on conflict (key) do update set value = excluded.value;

    select count(*) into v_item_count from public.order_items where order_id = v_order_id;
    select subtotal into v_subtotal from public.orders where id = v_order_id;

    if v_item_count <> 3 then raise exception 'esperado 3 order_items, encontrado %', v_item_count; end if;
    if v_subtotal <> 350.00 then raise exception 'subtotal deveria ser 350.00 (150+80+120), veio %', v_subtotal; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.4 create_order misto (CATALOG+SPOT+CUSTOM): 3 itens, subtotal correto', 'PASS', 'order_id=' || v_order_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.4 create_order misto (CATALOG+SPOT+CUSTOM): 3 itens, subtotal correto', 'FAIL', sqlerrm);
  end;
end $$;

do $$
begin
  begin
    begin
      perform public.create_order(
        (select value::uuid from zz_fixtures where key = 'customer_id'),
        null, null, null, null, 0, 0, 'pedido vazio',
        '[]'::jsonb,
        (select value::uuid from zz_fixtures where key = 'user_id')
      );
      insert into zz_test_results(section, test_name, status, details)
        values ('3', '3.5 create_order rejeita pedido sem itens', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%ao menos um item%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('3', '3.5 create_order rejeita pedido sem itens', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('3', '3.5 create_order rejeita pedido sem itens', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.5 create_order rejeita pedido sem itens', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 3b — Correção da Migration 17 (versão inicial CUSTOM)
-- =============================================================================

do $$
declare
  v_order_custom_id uuid;
  v_item_id uuid;
  v_current_version text;
  v_version_count integer;
  v_version_id uuid;
  v_version_change_type text;
begin
  begin
    select value::uuid into v_order_custom_id from zz_fixtures where key = 'order_custom_id';
    if v_order_custom_id is null then raise exception 'fixture ausente: order_custom_id (3.3 falhou)'; end if;

    select oi.id, cid.current_version into v_item_id, v_current_version
      from public.order_items oi
      join public.custom_item_details cid on cid.order_item_id = oi.id
      where oi.order_id = v_order_custom_id;

    if v_item_id is null or v_current_version is null then
      raise exception 'item CUSTOM ou current_version não encontrado';
    end if;

    select count(*) into v_version_count
      from public.custom_versions
      where order_item_id = v_item_id and version_number = v_current_version;

    if v_version_count <> 1 then
      raise exception 'esperado exatamente 1 custom_versions para (order_item_id, version_number=%), encontrado %', v_current_version, v_version_count;
    end if;

    select id, change_type into v_version_id, v_version_change_type
      from public.custom_versions
      where order_item_id = v_item_id and version_number = v_current_version;

    if v_version_change_type <> 'INITIAL' then
      raise exception 'change_type deveria ser INITIAL, veio %', v_version_change_type;
    end if;

    insert into zz_fixtures(key, value) values ('custom_version_v1_0_id', v_version_id::text)
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('3b', '3b.1 correção Migration 17: custom_versions inicial criada automaticamente (version_number=current_version, change_type=INITIAL)',
              'PASS', 'custom_versions.id=' || v_version_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3b', '3b.1 correção Migration 17: custom_versions inicial criada automaticamente (version_number=current_version, change_type=INITIAL)',
              'FAIL', sqlerrm);
  end;
end $$;

-- (o teste "register_approval aprova a versão inicial pelo fluxo normal,
-- sem fixture manual em custom_versions" é o próprio caso 4.4 abaixo — é o
-- mesmo cenário, não duplicado aqui.)

-- =============================================================================
-- SEÇÃO 4 — Aprovações
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_status text;
  v_history_count integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    perform public.change_order_status(v_order_id, 'WAITING_APPROVAL', v_user_id);

    select order_status into v_status from public.orders where id = v_order_id;
    select count(*) into v_history_count from public.order_status_history where order_id = v_order_id;

    if v_status <> 'APPROVED' then
      raise exception 'pedido só-CATALOG deveria autoaprovar para APPROVED, ficou em %', v_status;
    end if;
    if v_history_count <> 3 then
      raise exception 'esperado 3 linhas de histórico (QUOTE inicial, ->WAITING_APPROVAL, ->APPROVED), encontrado %', v_history_count;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.1 CATALOG-only autoaprova QUOTE->WAITING_APPROVAL->APPROVED', 'PASS', 'status final=' || v_status);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.1 CATALOG-only autoaprova QUOTE->WAITING_APPROVAL->APPROVED', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_status text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    perform public.change_order_status(v_order_id, 'WAITING_APPROVAL', v_user_id);

    select order_status into v_status from public.orders where id = v_order_id;

    if v_status <> 'WAITING_APPROVAL' then
      raise exception 'pedido SPOT sem aprovação deveria permanecer WAITING_APPROVAL, ficou em %', v_status;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.2 SPOT sem approval permanece WAITING_APPROVAL', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.2 SPOT sem approval permanece WAITING_APPROVAL', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_status text;
  v_is_approved boolean;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    perform public.register_approval(v_item_id, 'WHATSAPP', now(), v_user_id);

    select order_status into v_status from public.orders where id = v_order_id;
    select is_approved into v_is_approved from public.vw_order_item_approval_status where order_item_id = v_item_id;

    if v_status <> 'APPROVED' then
      raise exception 'após register_approval, pedido SPOT deveria estar APPROVED, ficou em %', v_status;
    end if;
    if not v_is_approved then
      raise exception 'vw_order_item_approval_status.is_approved deveria ser true';
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.3 SPOT: register_approval (custom_version_id NULL) autoavança para APPROVED', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.3 SPOT: register_approval (custom_version_id NULL) autoavança para APPROVED', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_version_id uuid;
  v_status_pending text;
  v_status_final text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_custom_id';
    select value::uuid into v_version_id from zz_fixtures where key = 'custom_version_v1_0_id';
    if v_user_id is null or v_order_id is null or v_version_id is null then
      raise exception 'fixture ausente (3.3/3b.1 falharam)';
    end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    perform public.change_order_status(v_order_id, 'WAITING_APPROVAL', v_user_id);
    select order_status into v_status_pending from public.orders where id = v_order_id;
    if v_status_pending <> 'WAITING_APPROVAL' then
      raise exception 'antes da aprovação, deveria estar WAITING_APPROVAL, veio %', v_status_pending;
    end if;

    -- Ponto central pedido no item 7 da solicitação: aprova a versão
    -- inicial pelo fluxo normal, usando o custom_versions.id que
    -- create_order() já cria automaticamente (correção da Migration 17) —
    -- nenhuma fixture manual em custom_versions foi inserida neste script.
    perform public.register_approval(v_item_id, 'FORMAL_DOCUMENT', now(), v_user_id, v_version_id);

    select order_status into v_status_final from public.orders where id = v_order_id;
    if v_status_final <> 'APPROVED' then
      raise exception 'após aprovar a versão inicial, pedido deveria estar APPROVED, ficou em %', v_status_final;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.4 CUSTOM: aprova versão inicial (v1.0) pelo fluxo normal (sem fixture manual em custom_versions) -> APPROVED',
              'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.4 CUSTOM: aprova versão inicial (v1.0) pelo fluxo normal (sem fixture manual em custom_versions) -> APPROVED',
              'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_status text;
  v_approval_date date;
  v_history_count integer;
  v_is_approved boolean;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_custom_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    perform public.register_custom_version(v_item_id, 'v1.1', v_user_id, 'MINOR', 'ajuste de teste');

    select order_status, approval_date into v_status, v_approval_date from public.orders where id = v_order_id;
    select count(*) into v_history_count from public.order_status_history
      where order_id = v_order_id and from_status = 'APPROVED' and to_status = 'WAITING_APPROVAL';
    select is_approved into v_is_approved from public.vw_order_item_approval_status where order_item_id = v_item_id;

    if v_status <> 'WAITING_APPROVAL' then
      raise exception 'nova versão em pedido APPROVED deveria regredir para WAITING_APPROVAL, ficou em %', v_status;
    end if;
    if v_approval_date is not null then
      raise exception 'approval_date deveria ser NULL após regressão';
    end if;
    if v_history_count <> 1 then
      raise exception 'esperado 1 order_status_history APPROVED->WAITING_APPROVAL, encontrado %', v_history_count;
    end if;
    if v_is_approved then
      raise exception 'is_approved deveria ser false (aprovação antiga é da v1.0; current_version agora é v1.1)';
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.5 register_custom_version (v1.1) em pedido APPROVED: regride p/ WAITING_APPROVAL, approval_date NULL, histórico registrado, is_approved=false',
              'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.5 register_custom_version (v1.1) em pedido APPROVED: regride p/ WAITING_APPROVAL, approval_date NULL, histórico registrado, is_approved=false',
              'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_version_id uuid;
  v_status text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_custom_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;
    select id into v_version_id from public.custom_versions where order_item_id = v_item_id and version_number = 'v1.1';

    if v_version_id is null then raise exception 'custom_versions v1.1 não encontrada (4.5 falhou)'; end if;

    perform public.register_approval(v_item_id, 'FORMAL_DOCUMENT', now(), v_user_id, v_version_id);

    select order_status into v_status from public.orders where id = v_order_id;
    if v_status <> 'APPROVED' then
      raise exception 'após aprovar v1.1, pedido deveria voltar a APPROVED, ficou em %', v_status;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.6 reaprovação da nova versão (v1.1) -> APPROVED novamente', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.6 reaprovação da nova versão (v1.1) -> APPROVED novamente', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 5 — SPOT / gate de fila de produção
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.change_order_status(v_order_id, 'IN_PRODUCTION_QUEUE', v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('5', '5.1 SPOT sem search_time_status=RECORDED bloqueia entrada em IN_PRODUCTION_QUEUE', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%search_time_status%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('5', '5.1 SPOT sem search_time_status=RECORDED bloqueia entrada em IN_PRODUCTION_QUEUE', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('5', '5.1 SPOT sem search_time_status=RECORDED bloqueia entrada em IN_PRODUCTION_QUEUE', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 SPOT sem search_time_status=RECORDED bloqueia entrada em IN_PRODUCTION_QUEUE', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

-- TEST FIXTURE ONLY
-- Não representa caminho permitido para frontend/Edge Function.
-- Em produção, spot_item_details não recebe escrita direta de authenticated
-- nem de service_role fora de uma função controlada — este UPDATE só é
-- possível aqui porque a sessão de teste roda como owner do banco
-- (postgres). Existe unicamente para simular administrativamente que o
-- tempo de pesquisa/preparação já foi registrado, já que o Bloco 1 não
-- criou uma RPC dedicada para isso.
do $$
declare
  v_order_id uuid;
  v_item_id uuid;
begin
  begin
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    update public.spot_item_details
      set search_time_status = 'RECORDED', search_minutes = 30
      where order_item_id = v_item_id;

    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.2 [TEST FIXTURE ONLY] ajustar search_time_status=RECORDED diretamente', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.2 [TEST FIXTURE ONLY] ajustar search_time_status=RECORDED diretamente', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_status text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    perform public.change_order_status(v_order_id, 'IN_PRODUCTION_QUEUE', v_user_id);

    select order_status into v_status from public.orders where id = v_order_id;
    if v_status <> 'IN_PRODUCTION_QUEUE' then
      raise exception 'esperado IN_PRODUCTION_QUEUE após RECORDED, veio %', v_status;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.3 com search_time_status=RECORDED, entrada em IN_PRODUCTION_QUEUE é permitida', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.3 com search_time_status=RECORDED, entrada em IN_PRODUCTION_QUEUE é permitida', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 6 — Pagamentos
-- =============================================================================

do $$
declare
  v_order_id uuid;
  v_status text;
begin
  begin
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_order_id is null then raise exception 'fixture ausente'; end if;

    select payment_status into v_status from public.orders where id = v_order_id;
    if v_status <> 'WAITING_PAYMENT' then
      raise exception 'antes de qualquer pagamento, payment_status deveria ser WAITING_PAYMENT, veio %', v_status;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.1 sem pagamento -> WAITING_PAYMENT', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.1 sem pagamento -> WAITING_PAYMENT', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_status text;
  v_history_count integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    perform public.register_payment(v_order_id, 'PIX', 100.00, 'SINAL', now(), v_user_id);

    select payment_status into v_status from public.orders where id = v_order_id;
    select count(*) into v_history_count from public.payment_status_history
      where order_id = v_order_id and from_status = 'WAITING_PAYMENT' and to_status = 'DEPOSIT_RECEIVED';

    if v_status <> 'DEPOSIT_RECEIVED' then raise exception 'esperado DEPOSIT_RECEIVED, veio %', v_status; end if;
    if v_history_count <> 1 then raise exception 'esperado 1 payment_status_history WAITING_PAYMENT->DEPOSIT_RECEIVED, encontrado %', v_history_count; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.2 pagamento parcial (100/300) -> DEPOSIT_RECEIVED + histórico', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.2 pagamento parcial (100/300) -> DEPOSIT_RECEIVED + histórico', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_status text;
  v_history_count integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    perform public.register_payment(v_order_id, 'PIX', 200.00, 'FINAL', now(), v_user_id);

    select payment_status into v_status from public.orders where id = v_order_id;
    select count(*) into v_history_count from public.payment_status_history
      where order_id = v_order_id and from_status = 'DEPOSIT_RECEIVED' and to_status = 'PAID';

    if v_status <> 'PAID' then raise exception 'esperado PAID, veio %', v_status; end if;
    if v_history_count <> 1 then raise exception 'esperado 1 payment_status_history DEPOSIT_RECEIVED->PAID, encontrado %', v_history_count; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.3 completar pagamento (100+200=300) -> PAID + histórico', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.3 completar pagamento (100+200=300) -> PAID + histórico', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_status text;
  v_history_count_before integer;
  v_history_count_after integer;
  v_has_overpayment boolean;
  v_overpayment numeric;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select count(*) into v_history_count_before from public.payment_status_history where order_id = v_order_id;

    perform public.register_payment(v_order_id, 'PIX', 50.00, 'AJUSTE', now(), v_user_id);

    select payment_status into v_status from public.orders where id = v_order_id;
    select count(*) into v_history_count_after from public.payment_status_history where order_id = v_order_id;
    select has_overpayment, overpayment_amount into v_has_overpayment, v_overpayment
      from public.vw_order_summary where order_id = v_order_id;

    if v_status <> 'PAID' then raise exception 'excedente deveria continuar PAID, veio %', v_status; end if;
    if v_history_count_after <> v_history_count_before then
      raise exception 'payment_status não mudou (PAID->PAID), não deveria gerar novo histórico; antes=%, depois=%', v_history_count_before, v_history_count_after;
    end if;
    if not v_has_overpayment then raise exception 'vw_order_summary.has_overpayment deveria ser true'; end if;
    if v_overpayment <> 50.00 then raise exception 'overpayment_amount deveria ser 50.00, veio %', v_overpayment; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.4 pagamento excedente (+50) -> continua PAID, sem novo histórico, has_overpayment/overpayment_amount corretos', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.4 pagamento excedente (+50) -> continua PAID, sem novo histórico, has_overpayment/overpayment_amount corretos', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_overpayment numeric;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    perform public.register_payment(v_order_id, 'PIX', -30.00, 'AJUSTE', now(), v_user_id, 'estorno de teste');

    select overpayment_amount into v_overpayment from public.vw_order_summary where order_id = v_order_id;

    if v_overpayment <> 20.00 then
      raise exception 'overpayment_amount deveria ser 20.00 (100+200+50-30=320, receivable=300), veio %', v_overpayment;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.5 AJUSTE negativo com notes -> sucesso, recalcula excedente', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.5 AJUSTE negativo com notes -> sucesso, recalcula excedente', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_payment(v_order_id, 'PIX', -10.00, 'AJUSTE', now(), v_user_id, null);
      insert into zz_test_results(section, test_name, status, details)
        values ('6', '6.6 AJUSTE negativo SEM notes é rejeitado (constraint)', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%payments_negative_adjustment_requires_notes%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('6', '6.6 AJUSTE negativo SEM notes é rejeitado (constraint)', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('6', '6.6 AJUSTE negativo SEM notes é rejeitado (constraint)', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.6 AJUSTE negativo SEM notes é rejeitado (constraint)', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_payment(v_order_id, 'PIX', -10.00, 'SINAL', now(), v_user_id, 'nota qualquer');
      insert into zz_test_results(section, test_name, status, details)
        values ('6', '6.7 valor negativo com payment_type != AJUSTE é rejeitado (constraint)', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%payments_amount_type_consistency%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('6', '6.7 valor negativo com payment_type != AJUSTE é rejeitado (constraint)', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('6', '6.7 valor negativo com payment_type != AJUSTE é rejeitado (constraint)', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.7 valor negativo com payment_type != AJUSTE é rejeitado (constraint)', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_payment(v_order_id, 'PIX', -10000.00, 'AJUSTE', now(), v_user_id, 'estorno gigante de teste');
      insert into zz_test_results(section, test_name, status, details)
        values ('6', '6.8 ajuste que levaria soma de pagamentos a negativo é rejeitado', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%ficaria negativa%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('6', '6.8 ajuste que levaria soma de pagamentos a negativo é rejeitado', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('6', '6.8 ajuste que levaria soma de pagamentos a negativo é rejeitado', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.8 ajuste que levaria soma de pagamentos a negativo é rejeitado', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 7 — Semântica PATCH de update_order_item
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_quantity_before integer;
  v_unit_price_before numeric;
  v_quantity_after integer;
  v_unit_price_after numeric;
  v_notes_after text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_custom_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    select quantity, unit_price into v_quantity_before, v_unit_price_before
      from public.order_items where id = v_item_id;

    perform public.update_order_item(v_item_id, jsonb_build_object('notes', 'só uma nota de teste'), v_user_id);

    select quantity, unit_price, notes into v_quantity_after, v_unit_price_after, v_notes_after
      from public.order_items where id = v_item_id;

    if v_quantity_after <> v_quantity_before then raise exception 'quantity foi alterada indevidamente'; end if;
    if v_unit_price_after <> v_unit_price_before then raise exception 'unit_price foi alterada indevidamente'; end if;
    if v_notes_after <> 'só uma nota de teste' then raise exception 'notes não foi atualizada'; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.1 PATCH alterando só notes não afeta quantity/unit_price/demais campos', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.1 PATCH alterando só notes não afeta quantity/unit_price/demais campos', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_color_after_set text;
  v_color_after_clear text;
  v_quantity_after integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_custom_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    perform public.update_order_item(v_item_id, jsonb_build_object('color_description', 'Azul'), v_user_id);
    select color_description into v_color_after_set from public.order_items where id = v_item_id;
    if v_color_after_set <> 'Azul' then raise exception 'color_description deveria ser Azul após patch, veio %', v_color_after_set; end if;

    perform public.update_order_item(v_item_id, jsonb_build_object('color_description', null), v_user_id);
    select color_description, quantity into v_color_after_clear, v_quantity_after from public.order_items where id = v_item_id;

    if v_color_after_clear is not null then raise exception 'color_description deveria ser NULL após null explícito, veio %', v_color_after_clear; end if;
    if v_quantity_after is null then raise exception 'quantity não deveria ter sido afetada'; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2 null explícito limpa campo nullable (color_description), sem afetar demais campos', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2 null explícito limpa campo nullable (color_description), sem afetar demais campos', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_fake_id uuid := gen_random_uuid();
  v_fake_order_id uuid := gen_random_uuid();
  v_item_type_after text;
  v_order_id_after uuid;
  v_id_after uuid;
  v_current_version_after text;
  v_notes_after text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_custom_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    perform public.update_order_item(
      v_item_id,
      jsonb_build_object(
        'id', v_fake_id,
        'order_id', v_fake_order_id,
        'item_type', 'CATALOG',
        'notes', 'tentativa maliciosa',
        'custom_details', jsonb_build_object('current_version', 'v9.9')
      ),
      v_user_id
    );

    select id, order_id, item_type, notes into v_id_after, v_order_id_after, v_item_type_after, v_notes_after
      from public.order_items where id = v_item_id;
    select current_version into v_current_version_after
      from public.custom_item_details where order_item_id = v_item_id;

    if v_id_after <> v_item_id then raise exception 'id do order_item foi alterado indevidamente'; end if;
    if v_order_id_after <> v_order_id then raise exception 'order_id foi alterado indevidamente'; end if;
    if v_item_type_after <> 'CUSTOM' then raise exception 'item_type foi alterado indevidamente para %', v_item_type_after; end if;
    if v_current_version_after <> 'v1.1' then raise exception 'current_version foi alterado indevidamente para %', v_current_version_after; end if;
    if v_notes_after <> 'tentativa maliciosa' then raise exception 'notes (chave legítima no mesmo payload) deveria ter sido aplicada'; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.3 chaves protegidas (id/order_id/item_type/current_version, inclusive dentro de custom_details) são ignoradas; chave legítima no mesmo payload é aplicada',
              'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.3 chaves protegidas (id/order_id/item_type/current_version, inclusive dentro de custom_details) são ignoradas; chave legítima no mesmo payload é aplicada',
              'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 8 — Regras de bloqueio
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    begin
      perform public.remove_order_item(v_item_id, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.1 último item do pedido não pode ser removido', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%sem nenhum item%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.1 último item do pedido não pode ser removido', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.1 último item do pedido não pode ser removido', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.1 último item do pedido não pode ser removido', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_version_id uuid;
  v_item_count integer;
  v_history_count integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_mixed_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    -- Garante >= 2 itens no pedido ANTES de tentar a remoção, para que a
    -- regra de "último item" não seja a primeira condição bloqueante.
    -- order_mixed_id (teste 3.4) tem 3 itens (CATALOG+SPOT+CUSTOM) neste
    -- ponto do script — o teste 8.3, que remove um deles, só roda depois
    -- deste bloco.
    select count(*) into v_item_count from public.order_items where order_id = v_order_id;
    if v_item_count < 2 then
      raise exception 'fixture inválida: pedido misto precisa ter ao menos 2 itens antes deste teste, tem %', v_item_count;
    end if;

    select id into v_item_id from public.order_items where order_id = v_order_id and item_type = 'CUSTOM';
    if v_item_id is null then raise exception 'fixture ausente: item CUSTOM do pedido misto não encontrado'; end if;

    -- custom_item_details + custom_versions inicial já existem desde a
    -- criação do item (create_order, teste 3.4), graças à correção da
    -- Migration 17 — nenhum INSERT manual em custom_versions é feito aqui.
    select count(*) into v_history_count
      from public.custom_versions where order_item_id = v_item_id;
    if v_history_count = 0 then
      raise exception 'fixture inválida: item CUSTOM deveria ter custom_versions inicial (Migration 17), encontrado 0';
    end if;

    -- Reforço explícito pedido: registra também uma approval real para a
    -- versão inicial, pelo fluxo normal (mesmo padrão do teste 4.4) — não
    -- estritamente necessário para o exists() de remove_order_item (que já
    -- é satisfeito só por custom_versions), mas deixa a fixture mais
    -- próxima de um cenário real de produção.
    select id into v_version_id
      from public.custom_versions where order_item_id = v_item_id and version_number = 'v1.0';
    perform public.register_approval(v_item_id, 'FORMAL_DOCUMENT', now(), v_user_id, v_version_id);

    begin
      perform public.remove_order_item(v_item_id, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.2 item CUSTOM com histórico (custom_versions + approval) não pode ser removido, mesmo havendo outros itens no pedido',
                'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%histórico de versão/aprovação%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.2 item CUSTOM com histórico (custom_versions + approval) não pode ser removido, mesmo havendo outros itens no pedido',
                  'PASS', sqlerrm);
      elsif sqlerrm ilike '%sem nenhum item%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.2 item CUSTOM com histórico (custom_versions + approval) não pode ser removido, mesmo havendo outros itens no pedido',
                  'FAIL', 'fixture incorreta: bloqueou pela regra de último item, não pela regra de histórico — ' || sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.2 item CUSTOM com histórico (custom_versions + approval) não pode ser removido, mesmo havendo outros itens no pedido',
                  'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.2 item CUSTOM com histórico (custom_versions + approval) não pode ser removido, mesmo havendo outros itens no pedido',
              'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_count_before integer;
  v_count_after integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_mixed_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id and item_type = 'CATALOG';
    select count(*) into v_count_before from public.order_items where order_id = v_order_id;

    perform public.remove_order_item(v_item_id, v_user_id);

    select count(*) into v_count_after from public.order_items where order_id = v_order_id;

    if v_count_after <> v_count_before - 1 then
      raise exception 'esperado % itens após remoção, encontrado %', v_count_before - 1, v_count_after;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.3 item sem histórico é removido normalmente (pedido não fica sem itens)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.3 item sem histórico é removido normalmente (pedido não fica sem itens)', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_status text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    perform public.change_order_status(v_order_id, 'IN_PRODUCTION', v_user_id);

    select order_status into v_status from public.orders where id = v_order_id;
    if v_status <> 'IN_PRODUCTION' then raise exception 'esperado IN_PRODUCTION, veio %', v_status; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4a setup: avança pedido SPOT para IN_PRODUCTION', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4a setup: avança pedido SPOT para IN_PRODUCTION', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    begin
      perform public.update_order_item(v_item_id, jsonb_build_object('notes', 'x'), v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.4b update_order_item bloqueado após IN_PRODUCTION', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%início da produção%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.4b update_order_item bloqueado após IN_PRODUCTION', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.4b update_order_item bloqueado após IN_PRODUCTION', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4b update_order_item bloqueado após IN_PRODUCTION', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_product_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
    if v_user_id is null or v_order_id is null or v_product_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.add_order_item(
        v_order_id,
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'x', 'quantity', 1, 'unit_price', 10.00),
        v_user_id
      );
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.4c add_order_item bloqueado após IN_PRODUCTION', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%início da produção%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.4c add_order_item bloqueado após IN_PRODUCTION', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.4c add_order_item bloqueado após IN_PRODUCTION', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4c add_order_item bloqueado após IN_PRODUCTION', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    begin
      perform public.remove_order_item(v_item_id, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.4d remove_order_item bloqueado após IN_PRODUCTION', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%início da produção%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.4d remove_order_item bloqueado após IN_PRODUCTION', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.4d remove_order_item bloqueado após IN_PRODUCTION', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4d remove_order_item bloqueado após IN_PRODUCTION', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_custom_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    perform public.change_order_status(v_order_id, 'IN_PRODUCTION_QUEUE', v_user_id);
    perform public.change_order_status(v_order_id, 'IN_PRODUCTION', v_user_id);

    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4e setup: avança pedido CUSTOM para IN_PRODUCTION', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4e setup: avança pedido CUSTOM para IN_PRODUCTION', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_custom_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;

    begin
      perform public.register_custom_version(v_item_id, 'v1.2', v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.4f register_custom_version bloqueado após IN_PRODUCTION', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%início da produção%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.4f register_custom_version bloqueado após IN_PRODUCTION', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.4f register_custom_version bloqueado após IN_PRODUCTION', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4f register_custom_version bloqueado após IN_PRODUCTION', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.change_order_status(v_order_id, 'CANCELLED', v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.5a CANCELLED bloqueado após IN_PRODUCTION', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%antes do início da produção%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.5a CANCELLED bloqueado após IN_PRODUCTION', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.5a CANCELLED bloqueado após IN_PRODUCTION', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.5a CANCELLED bloqueado após IN_PRODUCTION', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_status text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_mixed_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    perform public.change_order_status(v_order_id, 'CANCELLED', v_user_id);

    select order_status into v_status from public.orders where id = v_order_id;
    if v_status <> 'CANCELLED' then raise exception 'esperado CANCELLED, veio %', v_status; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.5b CANCELLED permitido antes de IN_PRODUCTION (pedido ainda em QUOTE)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.5b CANCELLED permitido antes de IN_PRODUCTION (pedido ainda em QUOTE)', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_mixed_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.update_order(
        v_order_id, (select customer_id from public.orders where id = v_order_id),
        null, null, null, null, null, null, 0, 0, 'tentativa de editar cancelado', v_user_id
      );
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.6a update_order bloqueado em pedido CANCELLED', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%não pode mais ser editado%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.6a update_order bloqueado em pedido CANCELLED', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.6a update_order bloqueado em pedido CANCELLED', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.6a update_order bloqueado em pedido CANCELLED', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_custom_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    perform public.change_order_status(v_order_id, 'WAITING_DELIVERY', v_user_id);
    perform public.change_order_status(v_order_id, 'DELIVERED', v_user_id);

    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.6b setup: avança pedido CUSTOM até DELIVERED', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.6b setup: avança pedido CUSTOM até DELIVERED', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_order_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_custom_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.update_order(
        v_order_id, (select customer_id from public.orders where id = v_order_id),
        null, null, null, null, null, null, 0, 0, 'tentativa de editar entregue', v_user_id
      );
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.6c update_order bloqueado em pedido DELIVERED', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm ilike '%não pode mais ser editado%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.6c update_order bloqueado em pedido DELIVERED', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('8', '8.6c update_order bloqueado em pedido DELIVERED', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.6c update_order bloqueado em pedido DELIVERED', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 9 — Segurança (grants/RPCs/service_role/authenticated/RLS/views)
-- Fica no final da bateria, conforme pedido. Cada bloco que usa
-- SET LOCAL ROLE garante RESET ROLE incondicional antes de qualquer teste
-- seguinte (inclusive quando a tentativa protegida falha).
-- =============================================================================

do $$
declare
  v_signatures text[] := array[
    'create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)',
    'update_order(uuid,uuid,uuid,uuid,text,date,date,text,numeric,numeric,text,uuid)',
    'add_order_item(uuid,jsonb,uuid)',
    'update_order_item(uuid,jsonb,uuid)',
    'remove_order_item(uuid,uuid)',
    'change_order_status(uuid,text,uuid,text)',
    'register_approval(uuid,text,timestamptz,uuid,uuid,uuid,text)',
    'register_payment(uuid,text,numeric,text,timestamptz,uuid,text)',
    'register_custom_version(uuid,text,uuid,text,text,uuid)',
    'create_product(text,text,text,numeric,integer,numeric,integer,uuid,boolean,uuid)',
    'update_product_price(uuid,numeric,uuid,text,timestamptz)'
  ];
  v_sig text;
  v_auth_ok boolean;
  v_service_ok boolean;
begin
  begin
    foreach v_sig in array v_signatures loop
      v_auth_ok := has_function_privilege('authenticated', 'public.' || v_sig, 'EXECUTE');
      v_service_ok := has_function_privilege('service_role', 'public.' || v_sig, 'EXECUTE');
      insert into zz_test_results(section, test_name, status, details)
      values (
        '9', '9.1 EXECUTE das 11 RPCs (authenticated=false, service_role=true): ' || v_sig,
        case when v_auth_ok = false and v_service_ok = true then 'PASS' else 'FAIL' end,
        'authenticated=' || v_auth_ok || ' service_role=' || v_service_ok
      );
    end loop;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.1 EXECUTE loop RPCs', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_internal text[] := array[
    'assert_active_user(uuid)', 'jsonb_whitelist(jsonb,text[])', 'next_order_number()',
    'recalculate_order_financials(uuid,uuid,text)', 'try_auto_approve_order(uuid,uuid,text)'
  ];
  v_sig text;
  v_auth_ok boolean;
  v_service_ok boolean;
begin
  begin
    foreach v_sig in array v_internal loop
      v_auth_ok := has_function_privilege('authenticated', 'public.' || v_sig, 'EXECUTE');
      v_service_ok := has_function_privilege('service_role', 'public.' || v_sig, 'EXECUTE');
      insert into zz_test_results(section, test_name, status, details)
      values (
        '9', '9.1b helper interno sem grant externo (nem authenticated nem service_role): ' || v_sig,
        case when v_auth_ok = false and v_service_ok = false then 'PASS' else 'FAIL' end,
        'authenticated=' || v_auth_ok || ' service_role=' || v_service_ok
      );
    end loop;

    insert into zz_test_results(section, test_name, status, details)
    values (
      '9', '9.1c is_active_user tem EXECUTE para authenticated (helper de RLS, por desenho)',
      case when has_function_privilege('authenticated', 'public.is_active_user()', 'EXECUTE') then 'PASS' else 'FAIL' end,
      'authenticated=' || has_function_privilege('authenticated', 'public.is_active_user()', 'EXECUTE')
    );
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.1b/9.1c helpers internos', 'FAIL', sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.2a authenticated não tem INSERT em orders',
      case when has_table_privilege('authenticated', 'public.orders', 'INSERT') then 'FAIL' else 'PASS' end,
      'INSERT=' || has_table_privilege('authenticated', 'public.orders', 'INSERT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.2b authenticated não tem INSERT em payments',
      case when has_table_privilege('authenticated', 'public.payments', 'INSERT') then 'FAIL' else 'PASS' end,
      'INSERT=' || has_table_privilege('authenticated', 'public.payments', 'INSERT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.2c authenticated não tem INSERT em products (revogado na Migration 15)',
      case when has_table_privilege('authenticated', 'public.products', 'INSERT') then 'FAIL' else 'PASS' end,
      'INSERT=' || has_table_privilege('authenticated', 'public.products', 'INSERT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.2d authenticated não tem UPDATE em products.default_price',
      case when has_column_privilege('authenticated', 'public.products', 'default_price', 'UPDATE') then 'FAIL' else 'PASS' end,
      'UPDATE(default_price)=' || has_column_privilege('authenticated', 'public.products', 'default_price', 'UPDATE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.2e authenticated TEM UPDATE em products.name (coluna não financeira)',
      case when has_column_privilege('authenticated', 'public.products', 'name', 'UPDATE') then 'PASS' else 'FAIL' end,
      'UPDATE(name)=' || has_column_privilege('authenticated', 'public.products', 'name', 'UPDATE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.2f authenticated TEM SELECT em vw_order_summary',
      case when has_table_privilege('authenticated', 'public.vw_order_summary', 'SELECT') then 'PASS' else 'FAIL' end,
      'SELECT=' || has_table_privilege('authenticated', 'public.vw_order_summary', 'SELECT'));
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.2 checagens de privilégio em tabelas/colunas', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_customer_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';

  begin
    set local role authenticated;
    insert into public.orders (order_number, customer_id, order_status, payment_status)
      values ('FS-' || to_char(now(), 'YYYY') || '-9999', v_customer_id, 'QUOTE', 'WAITING_PAYMENT');
    v_status := 'FAIL';
    v_details := 'INSERT como authenticated foi permitido (não deveria)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  -- Reset explícito e incondicional, independentemente do resultado acima.
  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.3 [SET ROLE real] authenticated não consegue INSERT direto em orders', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.3 [SET ROLE real] authenticated não consegue INSERT direto em orders', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

do $$
declare
  v_auth_user_id_text text;
  v_status text;
  v_details text;
  v_count integer;
begin
  select value into v_auth_user_id_text from zz_fixtures where key = 'auth_user_id';

  begin
    if v_auth_user_id_text is null or v_auth_user_id_text = '' then
      raise exception 'fixture ausente: auth_user_id (usuário ativo sem auth_user_id vinculado)';
    end if;

    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_auth_user_id_text, 'role', 'authenticated')::text,
      true
    );

    select count(*) into v_count from public.orders;

    if v_count > 0 then
      v_status := 'PASS';
      v_details := 'orders visíveis para o usuário real: ' || v_count;
    else
      v_status := 'FAIL';
      v_details := 'esperado count > 0 (existem pedidos de teste), veio 0';
    end if;
  exception when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.4a [SET ROLE + JWT real] authenticated + RLS: usuário ativo real enxerga orders', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.4a [SET ROLE + JWT real] authenticated + RLS: usuário ativo real enxerga orders', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

do $$
declare
  v_status text;
  v_details text;
  v_count integer;
begin
  begin
    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text,
      true
    );

    select count(*) into v_count from public.orders;

    if v_count = 0 then
      v_status := 'PASS';
      v_details := 'RLS corretamente ocultou tudo para sub inexistente';
    else
      v_status := 'FAIL';
      v_details := 'esperado 0, veio ' || v_count;
    end if;
  exception when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.4b [SET ROLE + JWT falso] authenticated + RLS: sub inexistente não enxerga nada', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.4b [SET ROLE + JWT falso] authenticated + RLS: sub inexistente não enxerga nada', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

do $$
declare
  v_auth_user_id_text text;
  v_status text;
  v_details text;
  v_count integer;
begin
  select value into v_auth_user_id_text from zz_fixtures where key = 'auth_user_id';

  begin
    if v_auth_user_id_text is null or v_auth_user_id_text = '' then
      raise exception 'fixture ausente: auth_user_id';
    end if;

    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_auth_user_id_text, 'role', 'authenticated')::text,
      true
    );

    select count(*) into v_count from public.vw_order_summary;

    if v_count > 0 then
      v_status := 'PASS';
      v_details := 'vw_order_summary visível para usuário real: ' || v_count;
    else
      v_status := 'FAIL';
      v_details := 'esperado count > 0, veio 0';
    end if;
  exception when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.5a [SET ROLE + JWT real] vw_order_summary respeita RLS (security_invoker) para usuário real', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.5a [SET ROLE + JWT real] vw_order_summary respeita RLS (security_invoker) para usuário real', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

do $$
declare
  v_status text;
  v_details text;
  v_count integer;
begin
  begin
    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated')::text,
      true
    );

    select count(*) into v_count from public.vw_order_summary;

    if v_count = 0 then
      v_status := 'PASS';
      v_details := 'view corretamente vazia para sub inexistente';
    else
      v_status := 'FAIL';
      v_details := 'esperado 0, veio ' || v_count;
    end if;
  exception when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.5b [SET ROLE + JWT falso] vw_order_summary vazia para sub inexistente (confirma security_invoker propagando RLS)', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('9', '9.5b [SET ROLE + JWT falso] vw_order_summary vazia para sub inexistente (confirma security_invoker propagando RLS)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- =============================================================================
-- RESULTADO FINAL + ROLLBACK
-- =============================================================================

select section, test_name, status, details
from zz_test_results
order by seq;

rollback;
