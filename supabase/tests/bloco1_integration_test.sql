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

    -- create_product agora tem 11 parâmetros: p_product_type foi
    -- adicionado como 2º argumento pela migration
    -- 20260821090000_add_product_type.sql (já aplicada). O 5º argumento
    -- (antes p_default_print_time_minutes) passou a ser
    -- p_default_print_time_seconds pela migration
    -- 20260821070000_rename_default_print_time_to_seconds.sql — o valor
    -- literal 120 não é usado por nenhuma asserção deste arquivo (só
    -- product_id/default_price desta fixture são verificados em outras
    -- seções), então não precisou ser reescalado.
    v_product_id := public.create_product(
      'Produto Teste Integração', 'CATALOG', 'teste', 'produto criado pelo script de integração',
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

-- Correção da pendência conhecida deste arquivo (achado de auditoria de uma
-- rodada anterior): este arquivo nunca deu nenhuma composição real ao
-- Produto criado acima ("Produto Teste Integração") — nem product_filaments
-- (legado), nem, mais recentemente, product_plates/product_plate_filaments
-- (fonte autoritativa a partir de 20260829160000_add_product_plates_structure.sql).
-- Isso já fazia este arquivo abortar por inteiro (não um FAIL normal, uma
-- exceção não capturada) assim que a regra de composição obrigatória para
-- Pedidos CATALOG entrou em vigor, porque uma das seções mais abaixo cria
-- um Pedido CATALOG usando exatamente este product_id. Corrigido aqui,
-- imediatamente após a criação do Produto (mesmo local lógico de um
-- "setup" de fixture, robusto a mudanças de posição das seções abaixo):
-- cria um tipo de filamento TESTE e um Plate 1 com uma linha de composição
-- para o Produto, preservando default_weight_grams/default_print_time_seconds
-- já fixados na criação acima (25.50 / 120) — o Plate 1 tem seu próprio
-- tempo (120, mesmo valor) e uma linha de filamento (peso arbitrário,
-- nenhuma asserção deste arquivo depende do peso exato), sem enviar nenhum
-- ajuste manual (os efetivos já fixados em create_product continuam
-- valendo através dos 2 ajustes manuais, preenchidos verbatim, mesmo
-- padrão do backfill real da migration).
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_filament_type_id uuid;
  v_plate_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
    if v_user_id is null or v_product_id is null then
      raise exception 'fixtures ausentes: user_id/product_id (Seção 1 falhou)';
    end if;

    v_filament_type_id := (public.create_filament_type(
      'PLA', 'TESTE Marca Bloco1 Integração', 'Sólida', 'Preto', null, null, true, null, v_user_id
    )).id;

    insert into public.product_plates (product_id, plate_number, production_time_seconds)
      values (v_product_id, 1, 120)
      returning id into v_plate_id;
    insert into public.product_plate_filaments (plate_id, filament_type_id, weight_grams)
      values (v_plate_id, v_filament_type_id, 25.50);
    update public.products
      set production_weight_manual_override_grams = 25.50,
          production_time_manual_override_seconds = 120
      where id = v_product_id;

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1b Produto Teste Integração ganha Plate 1 + composição real (correção da pendência de composição ausente)',
              'PASS', 'product_id=' || v_product_id || ' plate_id=' || v_plate_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1b Produto Teste Integração ganha Plate 1 + composição real', 'FAIL', sqlerrm);
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

    if v_order_number !~ '^FS-[0-9]{2}-[0-9]{3,}$' then
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

    if v_order_number !~ '^FS-[0-9]{2}-[0-9]{3,}$' then raise exception 'order_number fora do formato: %', v_order_number; end if;
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

    if v_order_number !~ '^FS-[0-9]{2}-[0-9]{3,}$' then raise exception 'order_number fora do formato: %', v_order_number; end if;
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
-- SEÇÃO 5 — SPOT / fila de produção (ATUALIZADA 2026-08-29: o gate de
-- search_time_status=RECORDED foi REMOVIDO de change_order_status() por
-- decisão do usuário — "o tempo de pesquisa/modelagem de itens SPOT não
-- deverá ser considerado para entrada na Fila de produção". Os 3 testes
-- originais desta seção (5.1 esperava bloqueio sem RECORDED, 5.2 ajustava
-- RECORDED só para poder desbloquear, 5.3 confirmava que só com RECORDED a
-- entrada era permitida) são SUBSTITUÍDOS abaixo pelos testes da nova
-- decisão — não apagados silenciosamente, a intenção original de cada um
-- está preservada em comentário. O estado final exigido por esta seção
-- para as seções seguintes (order_spot_id termina em IN_PRODUCTION_QUEUE)
-- é mantido idêntico ao comportamento anterior.
-- =============================================================================

-- 5.1 (era: "SPOT sem RECORDED bloqueia entrada") — AGORA: SPOT sem
-- search_time_status=RECORDED (ainda NOT_INFORMED, valor padrão desde a
-- criação em create_order()) tem a transição para IN_PRODUCTION_QUEUE
-- PERMITIDA — nenhum erro de tempo é emitido. Confirma também que a
-- transição não lê/escreve search_time_status (permanece NOT_INFORMED).
do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_status text;
  v_search_time_status text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_user_id is null or v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;
    select search_time_status into v_search_time_status from public.spot_item_details where order_item_id = v_item_id;
    if v_search_time_status <> 'NOT_INFORMED' then
      raise exception 'pré-condição do teste: search_time_status deveria ainda ser NOT_INFORMED, veio %', v_search_time_status;
    end if;

    perform public.change_order_status(v_order_id, 'IN_PRODUCTION_QUEUE', v_user_id);

    select order_status into v_status from public.orders where id = v_order_id;
    select search_time_status into v_search_time_status from public.spot_item_details where order_item_id = v_item_id;

    if v_status <> 'IN_PRODUCTION_QUEUE' then
      raise exception 'SPOT sem search_time_status=RECORDED deveria poder entrar em IN_PRODUCTION_QUEUE, ficou em %', v_status;
    end if;
    if v_search_time_status <> 'NOT_INFORMED' then
      raise exception 'a transição não deveria alterar search_time_status, veio %', v_search_time_status;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 SPOT sem search_time_status=RECORDED NÃO bloqueia mais entrada em IN_PRODUCTION_QUEUE (gate removido, 2026-08-29)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 SPOT sem search_time_status=RECORDED NÃO bloqueia mais entrada em IN_PRODUCTION_QUEUE', 'FAIL', sqlerrm);
  end;
end $$;

-- 5.2 (era: "[TEST FIXTURE ONLY] ajustar RECORDED para poder desbloquear")
-- — AGORA: não existe mais nada para "desbloquear" (5.1 já concluiu a
-- transição). Este passo continua só uma escrita administrativa direta
-- (TEST FIXTURE ONLY, mesma ressalva de sempre: não representa caminho
-- permitido para frontend/Edge Function — spot_item_details não recebe
-- escrita direta de authenticated nem de service_role fora de uma função
-- controlada), agora só para preparar o teste 5.3 (o tempo permanece
-- armazenado/histórico mesmo já em IN_PRODUCTION_QUEUE).
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
      values ('5', '5.2 [TEST FIXTURE ONLY] ajustar search_time_status=RECORDED diretamente (só para preparar 5.3, não para desbloquear nada)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.2 [TEST FIXTURE ONLY] ajustar search_time_status=RECORDED diretamente', 'FAIL', sqlerrm);
  end;
end $$;

-- 5.3 (era: "com RECORDED, entrada é permitida" — agora trivial, já que
-- SEMPRE é permitida) — AGORA: confirma que um tempo já registrado
-- (RECORDED/30, ajustado em 5.2) permanece armazenado tal como gravado,
-- só relido, sem nenhuma escrita adicional — nenhum trigger/função apaga
-- ou reseta esses campos.
do $$
declare
  v_order_id uuid;
  v_item_id uuid;
  v_search_time_status text;
  v_search_minutes integer;
begin
  begin
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;
    select search_time_status, search_minutes into v_search_time_status, v_search_minutes
      from public.spot_item_details where order_item_id = v_item_id;

    if v_search_time_status <> 'RECORDED' or v_search_minutes <> 30 then
      raise exception 'tempo previamente registrado deveria permanecer RECORDED/30, veio %/%', v_search_time_status, v_search_minutes;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.3 tempo previamente registrado (RECORDED/30) permanece armazenado, nunca apagado/resetado', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.3 tempo previamente registrado permanece armazenado', 'FAIL', sqlerrm);
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

-- 8.4a-bis (nova, 2026-08-29): prova que remover o gate de SPOT em
-- change_order_status() não alterou NENHUMA outra transição real — a
-- mesmíssima transição IN_PRODUCTION_QUEUE -> IN_PRODUCTION do teste 8.4a
-- acima continua funcionando, e o tempo já registrado (RECORDED/30, desde
-- a Seção 5) continua intacto depois dela — search_time_status nunca é
-- lido nem escrito por nenhuma transição, em nenhum sentido.
do $$
declare
  v_order_id uuid;
  v_item_id uuid;
  v_search_time_status text;
  v_search_minutes integer;
begin
  begin
    select value::uuid into v_order_id from zz_fixtures where key = 'order_spot_id';
    if v_order_id is null then raise exception 'fixture ausente'; end if;

    select id into v_item_id from public.order_items where order_id = v_order_id;
    select search_time_status, search_minutes into v_search_time_status, v_search_minutes
      from public.spot_item_details where order_item_id = v_item_id;

    if v_search_time_status <> 'RECORDED' or v_search_minutes <> 30 then
      raise exception 'tempo registrado deveria continuar RECORDED/30 após a transição p/ IN_PRODUCTION, veio %/%', v_search_time_status, v_search_minutes;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4a-bis tempo registrado (RECORDED/30) permanece intacto após transição real IN_PRODUCTION_QUEUE -> IN_PRODUCTION', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4a-bis tempo registrado permanece intacto após transição real', 'FAIL', sqlerrm);
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
    -- 11 parâmetros desde a migration 20260821090000_add_product_type.sql
    -- (p_product_type acrescentado como 2º argumento) — assinatura antiga
    -- de 10 parâmetros não existe mais.
    'create_product(text,text,text,text,numeric,integer,numeric,integer,uuid,boolean,uuid)',
    'update_product_price(uuid,numeric,uuid,text,timestamptz)',
    'set_product_composition(uuid,jsonb,jsonb,uuid)'
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
      values ('FS-' || to_char(now(), 'YY') || '-999', v_customer_id, 'QUOTE', 'WAITING_PAYMENT');
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
-- SEÇÃO 10 — accessories/packaging/composição padrão de produtos
-- Migrations 18 (create_accessories_packaging_and_composition_tables), 19
-- (create_product_composition_function) e 20260822120000
-- (create_accessory_write_functions — Módulo 3, Incremento 2: backend
-- protegido de Acessórios, revoga INSERT/UPDATE direto de accessories a
-- authenticated e cria create_accessory/update_accessory/delete_accessory).
-- =============================================================================

-- 10.0 Setup: fixtures de accessories/packaging (via role de dono da
-- transação, não authenticated — mesmo padrão da Seção 0).
do $$
declare
  v_accessory_id_1 uuid;
  v_accessory_id_2 uuid;
  v_accessory_id_inactive uuid;
  v_packaging_id_1 uuid;
begin
  begin
    insert into public.accessories (name, material, size, variant)
      values ('Ímã de teste 6x2', 'neodímio', '6x2mm', null)
      returning id into v_accessory_id_1;

    insert into public.accessories (name, material, size, variant)
      values ('Parafuso de teste M3', 'aço', 'M3', null)
      returning id into v_accessory_id_2;

    insert into public.accessories (name, is_active)
      values ('Acessório de teste descontinuado', false)
      returning id into v_accessory_id_inactive;

    insert into public.packaging (name, material, size, variant)
      values ('Caixa de teste M', 'papelão', 'M', null)
      returning id into v_packaging_id_1;

    insert into zz_fixtures(key, value) values ('accessory_id_1', v_accessory_id_1::text)
      on conflict (key) do update set value = excluded.value;
    insert into zz_fixtures(key, value) values ('accessory_id_2', v_accessory_id_2::text)
      on conflict (key) do update set value = excluded.value;
    insert into zz_fixtures(key, value) values ('accessory_id_inactive', v_accessory_id_inactive::text)
      on conflict (key) do update set value = excluded.value;
    insert into zz_fixtures(key, value) values ('packaging_id_1', v_packaging_id_1::text)
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.0 setup: accessories/packaging de teste criados', 'PASS',
              'accessory_id_1=' || v_accessory_id_1 || ' accessory_id_2=' || v_accessory_id_2);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.0 setup: accessories/packaging de teste criados', 'FAIL', sqlerrm);
  end;
end $$;

-- 10.1 [SET ROLE real] authenticated NÃO consegue mais INSERT direto em
-- accessories — revogado por
-- 20260822120000_create_accessory_write_functions.sql (Módulo 3,
-- Incremento 2: toda escrita passa a exigir a Edge Function `accessories`
-- via create_accessory). Substitui o teste original desta seção (Migration
-- 18), que esperava o INSERT direto como permitido — comportamento
-- deliberadamente revertido nesta etapa.
do $$
declare
  v_auth_user_id_text text;
  v_status text;
  v_details text;
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

    insert into public.accessories (name) values ('Não deveria ser inserido por authenticated');
    v_status := 'FAIL';
    v_details := 'INSERT direto em accessories foi permitido a authenticated (não deveria mais)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.1 [SET ROLE real] authenticated não consegue mais INSERT direto em accessories', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.1 [SET ROLE real] authenticated não consegue mais INSERT direto em accessories', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.1b [SET ROLE real] authenticated NÃO consegue mais UPDATE direto de
-- accessories.name — revogado pela mesma migration do Incremento 2
-- (anteriormente permitido, ver Migration 18 e o teste 10.9e original).
do $$
declare
  v_auth_user_id_text text;
  v_accessory_id uuid;
  v_status text;
  v_details text;
begin
  select value into v_auth_user_id_text from zz_fixtures where key = 'auth_user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_1';

  begin
    if v_auth_user_id_text is null or v_accessory_id is null then
      raise exception 'fixture ausente: auth_user_id/accessory_id_1';
    end if;

    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_auth_user_id_text, 'role', 'authenticated')::text,
      true
    );

    update public.accessories set name = 'Não deveria ser alterado' where id = v_accessory_id;
    v_status := 'FAIL';
    v_details := 'UPDATE de name como authenticated foi permitido (não deveria mais)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.1b [SET ROLE real] authenticated não consegue mais UPDATE direto de accessories.name', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.1b [SET ROLE real] authenticated não consegue mais UPDATE direto de accessories.name', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.2 [SET ROLE real] authenticated NÃO consegue UPDATE de current_stock
-- direto (coluna reservada para função controlada futura do Módulo 3).
do $$
declare
  v_auth_user_id_text text;
  v_accessory_id uuid;
  v_status text;
  v_details text;
begin
  select value into v_auth_user_id_text from zz_fixtures where key = 'auth_user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_1';

  begin
    if v_auth_user_id_text is null or v_accessory_id is null then
      raise exception 'fixture ausente: auth_user_id/accessory_id_1';
    end if;

    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_auth_user_id_text, 'role', 'authenticated')::text,
      true
    );

    update public.accessories set current_stock = 10 where id = v_accessory_id;
    v_status := 'FAIL';
    v_details := 'UPDATE de current_stock como authenticated foi permitido (não deveria)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.2 [SET ROLE real] authenticated não consegue UPDATE direto de accessories.current_stock', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.2 [SET ROLE real] authenticated não consegue UPDATE direto de accessories.current_stock', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.3 set_product_composition: caminho feliz (2 acessórios + 1 embalagem).
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_accessory_id_1 uuid;
  v_accessory_id_2 uuid;
  v_packaging_id_1 uuid;
  v_accessory_count integer;
  v_packaging_count integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
    select value::uuid into v_accessory_id_1 from zz_fixtures where key = 'accessory_id_1';
    select value::uuid into v_accessory_id_2 from zz_fixtures where key = 'accessory_id_2';
    select value::uuid into v_packaging_id_1 from zz_fixtures where key = 'packaging_id_1';

    perform public.set_product_composition(
      v_product_id,
      jsonb_build_array(
        jsonb_build_object('id', v_accessory_id_1, 'quantity', 2),
        jsonb_build_object('id', v_accessory_id_2, 'quantity', 4)
      ),
      jsonb_build_array(
        jsonb_build_object('id', v_packaging_id_1, 'quantity', 1)
      ),
      v_user_id
    );

    select count(*) into v_accessory_count from public.product_accessories where product_id = v_product_id;
    select count(*) into v_packaging_count from public.product_packaging where product_id = v_product_id;

    if v_accessory_count <> 2 then
      raise exception 'esperado 2 linhas em product_accessories, encontrado %', v_accessory_count;
    end if;
    if v_packaging_count <> 1 then
      raise exception 'esperado 1 linha em product_packaging, encontrado %', v_packaging_count;
    end if;
    if not exists (
      select 1 from public.product_accessories
      where product_id = v_product_id and accessory_id = v_accessory_id_1 and quantity = 2
    ) then
      raise exception 'quantidade do acessório 1 deveria ser 2';
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.3 set_product_composition cria composição (2 acessórios + 1 embalagem)', 'PASS',
              'accessory_count=' || v_accessory_count || ' packaging_count=' || v_packaging_count);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.3 set_product_composition cria composição (2 acessórios + 1 embalagem)', 'FAIL', sqlerrm);
  end;
end $$;

-- 10.4 set_product_composition: segunda chamada substitui o conjunto
-- inteiro (1 acessório, nenhuma embalagem).
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_accessory_id_1 uuid;
  v_accessory_count integer;
  v_packaging_count integer;
  v_quantity integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
    select value::uuid into v_accessory_id_1 from zz_fixtures where key = 'accessory_id_1';

    perform public.set_product_composition(
      v_product_id,
      jsonb_build_array(jsonb_build_object('id', v_accessory_id_1, 'quantity', 5)),
      '[]'::jsonb,
      v_user_id
    );

    select count(*) into v_accessory_count from public.product_accessories where product_id = v_product_id;
    select count(*) into v_packaging_count from public.product_packaging where product_id = v_product_id;
    select quantity into v_quantity from public.product_accessories
      where product_id = v_product_id and accessory_id = v_accessory_id_1;

    if v_accessory_count <> 1 then
      raise exception 'esperado 1 linha em product_accessories após substituição, encontrado %', v_accessory_count;
    end if;
    if v_packaging_count <> 0 then
      raise exception 'esperado 0 linhas em product_packaging após substituição, encontrado %', v_packaging_count;
    end if;
    if v_quantity <> 5 then
      raise exception 'quantidade deveria ser 5, veio %', v_quantity;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.4 set_product_composition substitui atomicamente o conjunto inteiro', 'PASS',
              'accessory_count=' || v_accessory_count || ' packaging_count=' || v_packaging_count);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.4 set_product_composition substitui atomicamente o conjunto inteiro', 'FAIL', sqlerrm);
  end;
end $$;

-- 10.5 set_product_composition: quantity <= 0 é rejeitado (CHECK) e a
-- composição permanece INALTERADA (rollback atômico da função inteira).
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_accessory_id_1 uuid;
  v_accessory_count integer;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
  select value::uuid into v_accessory_id_1 from zz_fixtures where key = 'accessory_id_1';

  begin
    perform public.set_product_composition(
      v_product_id,
      jsonb_build_array(jsonb_build_object('id', v_accessory_id_1, 'quantity', 0)),
      '[]'::jsonb,
      v_user_id
    );
    v_status := 'FAIL';
    v_details := 'quantity=0 deveria ter sido rejeitado pela CHECK (quantity > 0)';
  exception when check_violation then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  select count(*) into v_accessory_count from public.product_accessories where product_id = v_product_id;
  if v_status = 'PASS' and v_accessory_count <> 1 then
    v_status := 'FAIL';
    v_details := 'composição deveria continuar com 1 linha (estado da 10.4) após falha, encontrado ' || v_accessory_count;
  end if;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.5 set_product_composition rejeita quantity<=0 e não altera a composição existente', v_status, v_details);
exception when others then
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.5 set_product_composition rejeita quantity<=0 e não altera a composição existente', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.6 set_product_composition: accessory_id inexistente/inativo é
-- rejeitado, composição permanece inalterada.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_accessory_id_inactive uuid;
  v_accessory_count integer;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
  select value::uuid into v_accessory_id_inactive from zz_fixtures where key = 'accessory_id_inactive';

  begin
    perform public.set_product_composition(
      v_product_id,
      jsonb_build_array(jsonb_build_object('id', v_accessory_id_inactive, 'quantity', 1)),
      '[]'::jsonb,
      v_user_id
    );
    v_status := 'FAIL';
    v_details := 'accessory inativo deveria ter sido rejeitado';
  exception when others then
    if sqlerrm like '%não encontrado ou inativo%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'exceção inesperada: ' || sqlerrm;
    end if;
  end;

  select count(*) into v_accessory_count from public.product_accessories where product_id = v_product_id;
  if v_status = 'PASS' and v_accessory_count <> 1 then
    v_status := 'FAIL';
    v_details := 'composição deveria continuar com 1 linha (estado da 10.4) após falha, encontrado ' || v_accessory_count;
  end if;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.6 set_product_composition rejeita accessory_id inativo/inexistente e não altera a composição', v_status, v_details);
exception when others then
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.6 set_product_composition rejeita accessory_id inativo/inexistente e não altera a composição', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.7 set_product_composition: id duplicado no mesmo array é rejeitado
-- (UNIQUE product_id+accessory_id), composição permanece inalterada.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_accessory_id_2 uuid;
  v_accessory_count integer;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
  select value::uuid into v_accessory_id_2 from zz_fixtures where key = 'accessory_id_2';

  begin
    perform public.set_product_composition(
      v_product_id,
      jsonb_build_array(
        jsonb_build_object('id', v_accessory_id_2, 'quantity', 1),
        jsonb_build_object('id', v_accessory_id_2, 'quantity', 2)
      ),
      '[]'::jsonb,
      v_user_id
    );
    v_status := 'FAIL';
    v_details := 'id duplicado no mesmo array deveria ter sido rejeitado (unique_violation)';
  exception when unique_violation then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  select count(*) into v_accessory_count from public.product_accessories where product_id = v_product_id;
  if v_status = 'PASS' and v_accessory_count <> 1 then
    v_status := 'FAIL';
    v_details := 'composição deveria continuar com 1 linha (estado da 10.4) após falha, encontrado ' || v_accessory_count;
  end if;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.7 set_product_composition rejeita id duplicado no mesmo array e não altera a composição', v_status, v_details);
exception when others then
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.7 set_product_composition rejeita id duplicado no mesmo array e não altera a composição', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.8 [SET ROLE real] authenticated + RLS: usuário ativo real enxerga
-- product_accessories (leitura permitida).
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

    select count(*) into v_count from public.product_accessories;

    if v_count > 0 then
      v_status := 'PASS';
      v_details := 'product_accessories visível para usuário real: ' || v_count;
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
    values ('10', '10.8 [SET ROLE real] authenticated + RLS enxerga product_accessories', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.8 [SET ROLE real] authenticated + RLS enxerga product_accessories', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.9 Grants: authenticated só tem SELECT em product_accessories/
-- product_packaging (sem INSERT/UPDATE/DELETE — escrita só via
-- set_product_composition).
do $$
begin
  begin
    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.9a authenticated TEM SELECT em product_accessories',
      case when has_table_privilege('authenticated', 'public.product_accessories', 'SELECT') then 'PASS' else 'FAIL' end,
      'SELECT=' || has_table_privilege('authenticated', 'public.product_accessories', 'SELECT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.9b authenticated não tem INSERT em product_accessories',
      case when has_table_privilege('authenticated', 'public.product_accessories', 'INSERT') then 'FAIL' else 'PASS' end,
      'INSERT=' || has_table_privilege('authenticated', 'public.product_accessories', 'INSERT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.9c authenticated não tem UPDATE em product_packaging',
      case when has_table_privilege('authenticated', 'public.product_packaging', 'UPDATE') then 'FAIL' else 'PASS' end,
      'UPDATE=' || has_table_privilege('authenticated', 'public.product_packaging', 'UPDATE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.9d authenticated não tem DELETE em product_packaging',
      case when has_table_privilege('authenticated', 'public.product_packaging', 'DELETE') then 'FAIL' else 'PASS' end,
      'DELETE=' || has_table_privilege('authenticated', 'public.product_packaging', 'DELETE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.9e authenticated NÃO tem mais UPDATE em accessories.name (revogado no Incremento 2 — ver 10.18c; expectativa invertida em relação ao teste original da Migration 18)',
      case when has_column_privilege('authenticated', 'public.accessories', 'name', 'UPDATE') then 'FAIL' else 'PASS' end,
      'UPDATE(name)=' || has_column_privilege('authenticated', 'public.accessories', 'name', 'UPDATE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.9f authenticated não tem UPDATE em accessories.current_stock (coluna reservada)',
      case when has_column_privilege('authenticated', 'public.accessories', 'current_stock', 'UPDATE') then 'FAIL' else 'PASS' end,
      'UPDATE(current_stock)=' || has_column_privilege('authenticated', 'public.accessories', 'current_stock', 'UPDATE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.9g authenticated não tem UPDATE em packaging.current_stock (coluna reservada)',
      case when has_column_privilege('authenticated', 'public.packaging', 'current_stock', 'UPDATE') then 'FAIL' else 'PASS' end,
      'UPDATE(current_stock)=' || has_column_privilege('authenticated', 'public.packaging', 'current_stock', 'UPDATE'));
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.9 checagens de privilégio em accessories/packaging/product_accessories/product_packaging', 'FAIL', sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 10.10 a 10.18 — Módulo 3, Incremento 2 (backend protegido de Acessórios,
-- 20260822120000_create_accessory_write_functions.sql).
-- ---------------------------------------------------------------------------

-- 10.10 [SET ROLE real] service_role executa create_accessory; is_active
-- assume o default (true) quando omitido; material/unit_cost/current_stock
-- nunca são tocados por esta function (permanecem null/null/0).
do $$
declare
  v_user_id uuid;
  v_row public.accessories;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;

    v_row := public.create_accessory(
      'Acessório criado via create_accessory (teste)', 'M', 'azul', 3, null, v_user_id
    );

    if v_row.id is null then
      raise exception 'create_accessory não retornou um id';
    end if;
    if v_row.is_active is distinct from true then
      raise exception 'is_active deveria assumir o default true, veio %', v_row.is_active;
    end if;
    if v_row.material is not null then
      raise exception 'material deveria continuar null (nunca setado por create_accessory), veio %', v_row.material;
    end if;
    if v_row.unit_cost is not null then
      raise exception 'unit_cost deveria continuar null, veio %', v_row.unit_cost;
    end if;
    if v_row.current_stock <> 0 then
      raise exception 'current_stock deveria continuar 0 (default da tabela), veio %', v_row.current_stock;
    end if;

    insert into zz_fixtures(key, value) values ('accessory_id_created', v_row.id::text)
      on conflict (key) do update set value = excluded.value;

    v_status := 'PASS';
    v_details := 'id=' || v_row.id || ' is_active=' || v_row.is_active || ' current_stock=' || v_row.current_stock;
  exception when others then
    v_status := 'FAIL';
    v_details := sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.10 [SET ROLE real] service_role executa create_accessory (defaults corretos, material/unit_cost/current_stock nunca tocados)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.10 [SET ROLE real] service_role executa create_accessory (defaults corretos, material/unit_cost/current_stock nunca tocados)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.11 [SET ROLE real] authenticated NÃO consegue executar create_accessory
-- diretamente (EXECUTE só concedido a service_role).
do $$
declare
  v_auth_user_id_text text;
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value into v_auth_user_id_text from zz_fixtures where key = 'auth_user_id';
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_auth_user_id_text, 'role', 'authenticated')::text,
      true
    );

    perform public.create_accessory('Não deveria ser criado', null, null, null, null, v_user_id);
    v_status := 'FAIL';
    v_details := 'create_accessory foi executado por authenticated (não deveria)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.11 [SET ROLE real] authenticated não consegue executar create_accessory diretamente', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.11 [SET ROLE real] authenticated não consegue executar create_accessory diretamente', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.12 [SET ROLE real] anon NÃO consegue executar create_accessory.
do $$
declare
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role anon;
    perform public.create_accessory('Não deveria ser criado (anon)', null, null, null, null, v_user_id);
    v_status := 'FAIL';
    v_details := 'create_accessory foi executado por anon (não deveria)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.12 [SET ROLE real] anon não consegue executar create_accessory diretamente', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.12 [SET ROLE real] anon não consegue executar create_accessory diretamente', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.13 [SET ROLE real] service_role executa update_accessory: chave
-- ausente preserva o valor atual — inclusive o size legado 'M3' de
-- accessory_id_2 (fora do enum PP/P/M/G/GG, fixture da 10.0), nunca tocado
-- porque o patch só envia minimum_stock.
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_row public.accessories;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_2';

  begin
    set local role service_role;

    v_row := public.update_accessory(
      v_accessory_id,
      jsonb_build_object('minimum_stock', 7),
      v_user_id
    );

    if v_row.size is distinct from 'M3' then
      raise exception 'size legado deveria ser preservado (M3), veio %', v_row.size;
    end if;
    if v_row.minimum_stock <> 7 then
      raise exception 'minimum_stock deveria ser 7, veio %', v_row.minimum_stock;
    end if;

    v_status := 'PASS';
    v_details := 'size preservado=' || v_row.size || ' minimum_stock=' || v_row.minimum_stock;
  exception when others then
    v_status := 'FAIL';
    v_details := sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.13 [SET ROLE real] update_accessory preserva size legado quando a chave não é enviada', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.13 [SET ROLE real] update_accessory preserva size legado quando a chave não é enviada', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.14 [SET ROLE real] update_accessory rejeita novo size fora do enum
-- quando a chave É enviada explicitamente (diferente de 10.13, onde a
-- chave ausente preserva o valor legado sem revalidar).
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_2';

  begin
    set local role service_role;
    perform public.update_accessory(v_accessory_id, jsonb_build_object('size', 'XG'), v_user_id);
    v_status := 'FAIL';
    v_details := 'size=XG deveria ter sido rejeitado (fora do enum PP/P/M/G/GG)';
  exception when others then
    if sqlerrm like '%size inválido%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.14 [SET ROLE real] update_accessory rejeita novo size fora do enum PP/P/M/G/GG', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.14 [SET ROLE real] update_accessory rejeita novo size fora do enum PP/P/M/G/GG', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.15 [SET ROLE real] delete_accessory exclui fisicamente um acessório
-- nunca utilizado (sem vínculo em product_accessories) — accessory_id_created,
-- criado na 10.10.
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_status text;
  v_details text;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_created';

  begin
    set local role service_role;
    perform public.delete_accessory(v_accessory_id, v_user_id);

    select count(*) into v_count from public.accessories where id = v_accessory_id;
    if v_count <> 0 then
      raise exception 'acessório deveria ter sido excluído fisicamente, ainda encontrado';
    end if;

    v_status := 'PASS';
    v_details := 'acessório sem vínculo excluído com sucesso';
  exception when others then
    v_status := 'FAIL';
    v_details := sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.15 [SET ROLE real] delete_accessory exclui fisicamente um acessório nunca utilizado', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.15 [SET ROLE real] delete_accessory exclui fisicamente um acessório nunca utilizado', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.16 [SET ROLE real] delete_accessory bloqueia exclusão de acessório
-- vinculado a product_accessories (accessory_id_1, composição criada nas
-- 10.3/10.4) e não remove o vínculo nem executa cascata.
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_status text;
  v_details text;
  v_link_count_before integer;
  v_link_count_after integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_1';

  select count(*) into v_link_count_before from public.product_accessories where accessory_id = v_accessory_id;

  begin
    set local role service_role;
    perform public.delete_accessory(v_accessory_id, v_user_id);
    v_status := 'FAIL';
    v_details := 'delete_accessory deveria ter sido bloqueado (acessório vinculado a um produto)';
  exception when others then
    if sqlerrm like '%vinculado a um produto e não pode ser excluído%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  select count(*) into v_link_count_after from public.product_accessories where accessory_id = v_accessory_id;

  if v_status = 'PASS' and (v_link_count_before = 0 or v_link_count_after <> v_link_count_before) then
    v_status := 'FAIL';
    v_details := 'vínculo em product_accessories não deveria ser alterado (antes=' || v_link_count_before || ' depois=' || v_link_count_after || ')';
  end if;

  if v_status = 'PASS' and not exists (select 1 from public.accessories where id = v_accessory_id) then
    v_status := 'FAIL';
    v_details := 'acessório não deveria ter sido excluído (bloqueio deveria impedir o DELETE)';
  end if;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.16 [SET ROLE real] delete_accessory bloqueia exclusão vinculada a product_accessories, sem cascata', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.16 [SET ROLE real] delete_accessory bloqueia exclusão vinculada a product_accessories, sem cascata', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.17 [SET ROLE real] authenticated NÃO consegue executar delete_accessory
-- diretamente (EXECUTE só concedido a service_role).
do $$
declare
  v_auth_user_id_text text;
  v_user_id uuid;
  v_accessory_id uuid;
  v_status text;
  v_details text;
begin
  select value into v_auth_user_id_text from zz_fixtures where key = 'auth_user_id';
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_1';

  begin
    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_auth_user_id_text, 'role', 'authenticated')::text,
      true
    );

    perform public.delete_accessory(v_accessory_id, v_user_id);
    v_status := 'FAIL';
    v_details := 'delete_accessory foi executado por authenticated (não deveria)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.17 [SET ROLE real] authenticated não consegue executar delete_accessory diretamente', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.17 [SET ROLE real] authenticated não consegue executar delete_accessory diretamente', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.18 Grants: accessories perde INSERT/UPDATE de authenticated (mantém
-- SELECT, sem DELETE); create_accessory/update_accessory/delete_accessory
-- só têm EXECUTE concedido a service_role.
do $$
begin
  begin
    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18a authenticated mantém SELECT em accessories',
      case when has_table_privilege('authenticated', 'public.accessories', 'SELECT') then 'PASS' else 'FAIL' end,
      'SELECT=' || has_table_privilege('authenticated', 'public.accessories', 'SELECT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18b authenticated NÃO tem mais INSERT em accessories',
      case when has_table_privilege('authenticated', 'public.accessories', 'INSERT') then 'FAIL' else 'PASS' end,
      'INSERT=' || has_table_privilege('authenticated', 'public.accessories', 'INSERT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18c authenticated NÃO tem mais UPDATE em accessories.name',
      case when has_column_privilege('authenticated', 'public.accessories', 'name', 'UPDATE') then 'FAIL' else 'PASS' end,
      'UPDATE(name)=' || has_column_privilege('authenticated', 'public.accessories', 'name', 'UPDATE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18d authenticated não tem DELETE em accessories',
      case when has_table_privilege('authenticated', 'public.accessories', 'DELETE') then 'FAIL' else 'PASS' end,
      'DELETE=' || has_table_privilege('authenticated', 'public.accessories', 'DELETE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18e anon não tem DELETE em accessories',
      case when has_table_privilege('anon', 'public.accessories', 'DELETE') then 'FAIL' else 'PASS' end,
      'DELETE=' || has_table_privilege('anon', 'public.accessories', 'DELETE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18f service_role tem EXECUTE em create_accessory',
      case when has_function_privilege('service_role', 'public.create_accessory(text, text, text, integer, boolean, uuid)', 'EXECUTE') then 'PASS' else 'FAIL' end,
      'EXECUTE=' || has_function_privilege('service_role', 'public.create_accessory(text, text, text, integer, boolean, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18g authenticated NÃO tem EXECUTE em create_accessory',
      case when has_function_privilege('authenticated', 'public.create_accessory(text, text, text, integer, boolean, uuid)', 'EXECUTE') then 'FAIL' else 'PASS' end,
      'EXECUTE=' || has_function_privilege('authenticated', 'public.create_accessory(text, text, text, integer, boolean, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18h service_role tem EXECUTE em update_accessory',
      case when has_function_privilege('service_role', 'public.update_accessory(uuid, jsonb, uuid)', 'EXECUTE') then 'PASS' else 'FAIL' end,
      'EXECUTE=' || has_function_privilege('service_role', 'public.update_accessory(uuid, jsonb, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18i authenticated NÃO tem EXECUTE em update_accessory',
      case when has_function_privilege('authenticated', 'public.update_accessory(uuid, jsonb, uuid)', 'EXECUTE') then 'FAIL' else 'PASS' end,
      'EXECUTE=' || has_function_privilege('authenticated', 'public.update_accessory(uuid, jsonb, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18j service_role tem EXECUTE em delete_accessory',
      case when has_function_privilege('service_role', 'public.delete_accessory(uuid, uuid)', 'EXECUTE') then 'PASS' else 'FAIL' end,
      'EXECUTE=' || has_function_privilege('service_role', 'public.delete_accessory(uuid, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18k authenticated NÃO tem EXECUTE em delete_accessory',
      case when has_function_privilege('authenticated', 'public.delete_accessory(uuid, uuid)', 'EXECUTE') then 'FAIL' else 'PASS' end,
      'EXECUTE=' || has_function_privilege('authenticated', 'public.delete_accessory(uuid, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.18l anon NÃO tem EXECUTE em delete_accessory',
      case when has_function_privilege('anon', 'public.delete_accessory(uuid, uuid)', 'EXECUTE') then 'FAIL' else 'PASS' end,
      'EXECUTE=' || has_function_privilege('anon', 'public.delete_accessory(uuid, uuid)', 'EXECUTE'));
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.18 checagens de privilégio nas novas functions protegidas de Acessórios', 'FAIL', sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 10.19 a 10.25 — invariantes de defesa em profundidade adicionadas na
-- rodada corretiva do Incremento 2 (create_accessory/update_accessory
-- chamadas diretamente como service_role, fora da Edge Function — que já
-- valida tudo isso antes, mas as RPCs SECURITY DEFINER não podem depender
-- só dela).
-- ---------------------------------------------------------------------------

-- 10.19 [SET ROLE real] create_accessory rejeita nome vazio mesmo chamada
-- diretamente (NOT NULL sozinho não barra '').
do $$
declare
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;
    perform public.create_accessory('   ', null, null, null, null, v_user_id);
    v_status := 'FAIL';
    v_details := 'nome vazio (só espaços) deveria ter sido rejeitado';
  exception when others then
    if sqlerrm like '%name não pode ser vazio%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.19 [SET ROLE real] create_accessory rejeita nome vazio (chamada direta, fora da Edge Function)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.19 [SET ROLE real] create_accessory rejeita nome vazio (chamada direta, fora da Edge Function)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.20 [SET ROLE real] create_accessory rejeita minimum_stock negativo
-- (CHECK da tabela, Migration 18 — não uma checagem redundante da function).
do $$
declare
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;
    perform public.create_accessory('Acessório com estoque negativo', null, null, -1, null, v_user_id);
    v_status := 'FAIL';
    v_details := 'minimum_stock=-1 deveria ter sido rejeitado pela CHECK (minimum_stock >= 0)';
  exception when check_violation then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.20 [SET ROLE real] create_accessory rejeita minimum_stock negativo (CHECK da tabela)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.20 [SET ROLE real] create_accessory rejeita minimum_stock negativo (CHECK da tabela)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.21 [SET ROLE real] update_accessory rejeita nome vazio.
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_2';

  begin
    set local role service_role;
    perform public.update_accessory(v_accessory_id, jsonb_build_object('name', '   '), v_user_id);
    v_status := 'FAIL';
    v_details := 'nome vazio (só espaços) deveria ter sido rejeitado';
  exception when others then
    if sqlerrm like '%name não pode ser vazio%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.21 [SET ROLE real] update_accessory rejeita nome vazio', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.21 [SET ROLE real] update_accessory rejeita nome vazio', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.22 [SET ROLE real] update_accessory rejeita is_active null explícito
-- (coluna NOT NULL) quando a chave é enviada com valor JSON null.
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_2';

  begin
    set local role service_role;
    perform public.update_accessory(v_accessory_id, jsonb_build_object('is_active', null), v_user_id);
    v_status := 'FAIL';
    v_details := 'is_active=null deveria ter sido rejeitado (coluna NOT NULL)';
  exception when not_null_violation then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.22 [SET ROLE real] update_accessory rejeita is_active null explícito (NOT NULL)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.22 [SET ROLE real] update_accessory rejeita is_active null explícito (NOT NULL)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.23 [SET ROLE real] update_accessory rejeita minimum_stock negativo
-- (CHECK da tabela).
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_2';

  begin
    set local role service_role;
    perform public.update_accessory(v_accessory_id, jsonb_build_object('minimum_stock', -3), v_user_id);
    v_status := 'FAIL';
    v_details := 'minimum_stock=-3 deveria ter sido rejeitado pela CHECK (minimum_stock >= 0)';
  exception when check_violation then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.23 [SET ROLE real] update_accessory rejeita minimum_stock negativo (CHECK da tabela)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.23 [SET ROLE real] update_accessory rejeita minimum_stock negativo (CHECK da tabela)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.24 [SET ROLE real] update_accessory rejeita p_patch nulo e '{}' — nunca
-- vira um UPDATE vazio silencioso.
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_status text;
  v_details text;
  v_null_rejected boolean := false;
  v_empty_rejected boolean := false;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_2';

  set local role service_role;

  begin
    perform public.update_accessory(v_accessory_id, null, v_user_id);
  exception when others then
    if sqlerrm like '%p_patch vazio%' then
      v_null_rejected := true;
    end if;
  end;

  begin
    perform public.update_accessory(v_accessory_id, '{}'::jsonb, v_user_id);
  exception when others then
    if sqlerrm like '%p_patch vazio%' then
      v_empty_rejected := true;
    end if;
  end;

  reset role;

  if v_null_rejected and v_empty_rejected then
    v_status := 'PASS';
    v_details := 'p_patch nulo e {} rejeitados corretamente';
  else
    v_status := 'FAIL';
    v_details := 'null_rejected=' || v_null_rejected || ' empty_rejected=' || v_empty_rejected;
  end if;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.24 [SET ROLE real] update_accessory rejeita p_patch nulo e vazio ({})', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.24 [SET ROLE real] update_accessory rejeita p_patch nulo e vazio ({})', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.25 [SET ROLE real] update_accessory rejeita chave desconhecida em
-- p_patch — não é só silenciosamente removida por jsonb_whitelist.
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id_2';

  begin
    set local role service_role;
    perform public.update_accessory(v_accessory_id, jsonb_build_object('material', 'titânio'), v_user_id);
    v_status := 'FAIL';
    v_details := 'chave desconhecida (material) deveria ter sido rejeitada, não silenciosamente ignorada';
  exception when others then
    if sqlerrm like '%chave(s) não suportada(s)%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.25 [SET ROLE real] update_accessory rejeita chave desconhecida em p_patch (não silenciosamente removida)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.25 [SET ROLE real] update_accessory rejeita chave desconhecida em p_patch (não silenciosamente removida)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 10.26 a 10.49 — Módulo 3, Incremento 3 (backend protegido de Embalagens,
-- 20260823120000_create_packaging_write_functions.sql). Espelha
-- integralmente 10.10–10.25 (Acessórios, Incremento 2), adaptado a
-- packaging/product_packaging, mais cobertura adicional (varredura completa
-- do enum de tamanho, embalagem inexistente) pedida explicitamente nesta
-- rodada.
-- ---------------------------------------------------------------------------

-- 10.26 Setup: fixtures dedicadas de packaging para os testes de backend
-- protegido — packaging_id_1 (Seção 10.0) já foi consumida pela composição
-- das 10.3/10.4 e não tem valores legados fora do enum, então esta seção
-- cria as suas próprias fixtures (via role de dono da transação, mesmo
-- padrão da 10.0).
do $$
declare
  v_packaging_id_legacy uuid;
begin
  begin
    -- Valores legados propositalmente fora do que a interface aceitaria
    -- (size fora do enum, material/unit_cost preenchidos) — usados para
    -- confirmar preservação em update_packaging (10.34).
    insert into public.packaging (name, material, size, variant, unit_cost)
      values ('Embalagem de teste legada', 'plástico reciclado', 'EMBALAGEM-XL', 'transparente', 12.50)
      returning id into v_packaging_id_legacy;

    insert into zz_fixtures(key, value) values ('packaging_id_legacy', v_packaging_id_legacy::text)
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.26 setup: packaging_id_legacy criado (size/material/unit_cost fora do padrão da interface)', 'PASS',
              'packaging_id_legacy=' || v_packaging_id_legacy);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.26 setup: packaging_id_legacy criado (size/material/unit_cost fora do padrão da interface)', 'FAIL', sqlerrm);
  end;
end $$;

-- 10.27 [SET ROLE real] authenticated NÃO consegue mais INSERT direto em
-- packaging — revogado por
-- 20260823120000_create_packaging_write_functions.sql (mesma decisão de
-- accessories no Incremento 2).
do $$
declare
  v_auth_user_id_text text;
  v_status text;
  v_details text;
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

    insert into public.packaging (name) values ('Não deveria ser inserido por authenticated');
    v_status := 'FAIL';
    v_details := 'INSERT direto em packaging foi permitido a authenticated (não deveria mais)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.27 [SET ROLE real] authenticated não consegue mais INSERT direto em packaging', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.27 [SET ROLE real] authenticated não consegue mais INSERT direto em packaging', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.27b [SET ROLE real] authenticated NÃO consegue mais UPDATE direto de
-- packaging.name.
do $$
declare
  v_auth_user_id_text text;
  v_packaging_id uuid;
  v_status text;
  v_details text;
begin
  select value into v_auth_user_id_text from zz_fixtures where key = 'auth_user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id_1';

  begin
    if v_auth_user_id_text is null or v_packaging_id is null then
      raise exception 'fixture ausente: auth_user_id/packaging_id_1';
    end if;

    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_auth_user_id_text, 'role', 'authenticated')::text,
      true
    );

    update public.packaging set name = 'Não deveria ser alterado' where id = v_packaging_id;
    v_status := 'FAIL';
    v_details := 'UPDATE de name como authenticated foi permitido (não deveria mais)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.27b [SET ROLE real] authenticated não consegue mais UPDATE direto de packaging.name', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.27b [SET ROLE real] authenticated não consegue mais UPDATE direto de packaging.name', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.28 [SET ROLE real] service_role executa create_packaging; is_active
-- assume o default (true) quando omitido; material/unit_cost/current_stock
-- nunca são tocados por esta function (permanecem null/null/0).
do $$
declare
  v_user_id uuid;
  v_row public.packaging;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;

    v_row := public.create_packaging(
      'Embalagem criada via create_packaging (teste)', 'M', 'kraft', 3, null, v_user_id
    );

    if v_row.id is null then
      raise exception 'create_packaging não retornou um id';
    end if;
    if v_row.is_active is distinct from true then
      raise exception 'is_active deveria assumir o default true, veio %', v_row.is_active;
    end if;
    if v_row.material is not null then
      raise exception 'material deveria continuar null (nunca setado por create_packaging), veio %', v_row.material;
    end if;
    if v_row.unit_cost is not null then
      raise exception 'unit_cost deveria continuar null, veio %', v_row.unit_cost;
    end if;
    if v_row.current_stock <> 0 then
      raise exception 'current_stock deveria continuar 0 (default da tabela), veio %', v_row.current_stock;
    end if;

    insert into zz_fixtures(key, value) values ('packaging_id_created', v_row.id::text)
      on conflict (key) do update set value = excluded.value;

    v_status := 'PASS';
    v_details := 'id=' || v_row.id || ' is_active=' || v_row.is_active || ' current_stock=' || v_row.current_stock;
  exception when others then
    v_status := 'FAIL';
    v_details := sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.28 [SET ROLE real] service_role executa create_packaging (defaults corretos, material/unit_cost/current_stock nunca tocados)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.28 [SET ROLE real] service_role executa create_packaging (defaults corretos, material/unit_cost/current_stock nunca tocados)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.29 [SET ROLE real] authenticated NÃO consegue executar create_packaging
-- diretamente (EXECUTE só concedido a service_role).
do $$
declare
  v_auth_user_id_text text;
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value into v_auth_user_id_text from zz_fixtures where key = 'auth_user_id';
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_auth_user_id_text, 'role', 'authenticated')::text,
      true
    );

    perform public.create_packaging('Não deveria ser criada', null, null, null, null, v_user_id);
    v_status := 'FAIL';
    v_details := 'create_packaging foi executado por authenticated (não deveria)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.29 [SET ROLE real] authenticated não consegue executar create_packaging diretamente', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.29 [SET ROLE real] authenticated não consegue executar create_packaging diretamente', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.30 [SET ROLE real] anon NÃO consegue executar create_packaging.
do $$
declare
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role anon;
    perform public.create_packaging('Não deveria ser criada (anon)', null, null, null, null, v_user_id);
    v_status := 'FAIL';
    v_details := 'create_packaging foi executado por anon (não deveria)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.30 [SET ROLE real] anon não consegue executar create_packaging diretamente', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.30 [SET ROLE real] anon não consegue executar create_packaging diretamente', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.31 [SET ROLE real] create_packaging aceita size null ("Não se
-- aplica").
do $$
declare
  v_user_id uuid;
  v_row public.packaging;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;
    v_row := public.create_packaging('Embalagem sem tamanho', null, null, null, null, v_user_id);
    if v_row.size is not null then
      raise exception 'size deveria ser null, veio %', v_row.size;
    end if;
    v_status := 'PASS';
    v_details := 'size=null aceito corretamente';
  exception when others then
    v_status := 'FAIL';
    v_details := sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.31 [SET ROLE real] create_packaging aceita size null (Não se aplica)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.31 [SET ROLE real] create_packaging aceita size null (Não se aplica)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.32 [SET ROLE real] create_packaging aceita as 5 opções oficiais de
-- tamanho (PP, P, M, G, GG) — varredura completa do enum.
do $$
declare
  v_user_id uuid;
  v_row public.packaging;
  v_size text;
  v_all_ok boolean := true;
  v_details text := '';
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;
    foreach v_size in array array['PP', 'P', 'M', 'G', 'GG']
    loop
      v_row := public.create_packaging('Embalagem tamanho ' || v_size, v_size, null, null, null, v_user_id);
      if v_row.size is distinct from v_size then
        v_all_ok := false;
        v_details := v_details || format('esperado=%s obtido=%s; ', v_size, v_row.size);
      end if;
    end loop;
    reset role;

    if v_all_ok then
      insert into zz_test_results(section, test_name, status, details)
        values ('10', '10.32 [SET ROLE real] create_packaging aceita PP, P, M, G e GG', 'PASS', 'todas as 5 opções aceitas corretamente');
    else
      insert into zz_test_results(section, test_name, status, details)
        values ('10', '10.32 [SET ROLE real] create_packaging aceita PP, P, M, G e GG', 'FAIL', v_details);
    end if;
  exception when others then
    reset role;
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.32 [SET ROLE real] create_packaging aceita PP, P, M, G e GG', 'FAIL', sqlerrm);
  end;
end $$;

-- 10.33 [SET ROLE real] create_packaging rejeita tamanho livre fora do
-- enum.
do $$
declare
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;
    perform public.create_packaging('Embalagem tamanho inválido', 'XG', null, null, null, v_user_id);
    v_status := 'FAIL';
    v_details := 'size=XG deveria ter sido rejeitado (fora do enum PP/P/M/G/GG)';
  exception when others then
    if sqlerrm like '%size inválido%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.33 [SET ROLE real] create_packaging rejeita tamanho livre fora do enum', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.33 [SET ROLE real] create_packaging rejeita tamanho livre fora do enum', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.34 [SET ROLE real] update_packaging preserva size/material/unit_cost
-- legados (packaging_id_legacy, 10.26) quando as chaves não são enviadas —
-- patch só toca minimum_stock.
do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_row public.packaging;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id_legacy';

  begin
    set local role service_role;

    v_row := public.update_packaging(
      v_packaging_id,
      jsonb_build_object('minimum_stock', 9),
      v_user_id
    );

    if v_row.size is distinct from 'EMBALAGEM-XL' then
      raise exception 'size legado deveria ser preservado (EMBALAGEM-XL), veio %', v_row.size;
    end if;
    if v_row.material is distinct from 'plástico reciclado' then
      raise exception 'material legado deveria ser preservado, veio %', v_row.material;
    end if;
    if v_row.unit_cost is distinct from 12.50 then
      raise exception 'unit_cost legado deveria ser preservado (12.50), veio %', v_row.unit_cost;
    end if;
    if v_row.minimum_stock <> 9 then
      raise exception 'minimum_stock deveria ser 9, veio %', v_row.minimum_stock;
    end if;

    v_status := 'PASS';
    v_details := 'size/material/unit_cost legados preservados; minimum_stock=' || v_row.minimum_stock;
  exception when others then
    v_status := 'FAIL';
    v_details := sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.34 [SET ROLE real] update_packaging preserva size/material/unit_cost legados quando as chaves não são enviadas', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.34 [SET ROLE real] update_packaging preserva size/material/unit_cost legados quando as chaves não são enviadas', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.35 [SET ROLE real] update_packaging rejeita novo size fora do enum
-- quando a chave É enviada explicitamente (diferente de 10.34, onde a
-- chave ausente preserva o valor legado sem revalidar).
do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id_legacy';

  begin
    set local role service_role;
    perform public.update_packaging(v_packaging_id, jsonb_build_object('size', 'XG'), v_user_id);
    v_status := 'FAIL';
    v_details := 'size=XG deveria ter sido rejeitado (fora do enum PP/P/M/G/GG)';
  exception when others then
    if sqlerrm like '%size inválido%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.35 [SET ROLE real] update_packaging rejeita novo size fora do enum PP/P/M/G/GG', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.35 [SET ROLE real] update_packaging rejeita novo size fora do enum PP/P/M/G/GG', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.36 [SET ROLE real] update_packaging ativa e desativa via is_active —
-- mesmo contrato PATCH, sem rota redundante.
do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_row public.packaging;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;
    v_packaging_id := (public.create_packaging('Embalagem para ativar/desativar', null, null, null, null, v_user_id)).id;

    v_row := public.update_packaging(v_packaging_id, jsonb_build_object('is_active', false), v_user_id);
    if v_row.is_active is distinct from false then
      raise exception 'esperado is_active=false após desativar, veio %', v_row.is_active;
    end if;

    v_row := public.update_packaging(v_packaging_id, jsonb_build_object('is_active', true), v_user_id);
    if v_row.is_active is distinct from true then
      raise exception 'esperado is_active=true após reativar, veio %', v_row.is_active;
    end if;

    v_status := 'PASS';
    v_details := 'desativou e reativou corretamente';
  exception when others then
    v_status := 'FAIL';
    v_details := sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.36 [SET ROLE real] update_packaging ativa e desativa via is_active', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.36 [SET ROLE real] update_packaging ativa e desativa via is_active', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.37 [SET ROLE real] update_packaging retorna erro reconhecível para
-- embalagem inexistente (uuid válido, sem linha correspondente).
do $$
declare
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;
    perform public.update_packaging(
      '00000000-0000-0000-0000-000000000000'::uuid,
      jsonb_build_object('minimum_stock', 1),
      v_user_id
    );
    v_status := 'FAIL';
    v_details := 'embalagem inexistente deveria ter sido rejeitada';
  exception when others then
    if sqlerrm like '%não encontrado%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.37 [SET ROLE real] update_packaging rejeita embalagem inexistente', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.37 [SET ROLE real] update_packaging rejeita embalagem inexistente', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.38 [SET ROLE real] delete_packaging retorna erro reconhecível para
-- embalagem inexistente.
do $$
declare
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;
    perform public.delete_packaging('00000000-0000-0000-0000-000000000000'::uuid, v_user_id);
    v_status := 'FAIL';
    v_details := 'embalagem inexistente deveria ter sido rejeitada';
  exception when others then
    if sqlerrm like '%não encontrado%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.38 [SET ROLE real] delete_packaging rejeita embalagem inexistente', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.38 [SET ROLE real] delete_packaging rejeita embalagem inexistente', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.39 [SET ROLE real] create_packaging rejeita nome vazio mesmo chamada
-- diretamente (NOT NULL sozinho não barra '').
do $$
declare
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;
    perform public.create_packaging('   ', null, null, null, null, v_user_id);
    v_status := 'FAIL';
    v_details := 'nome vazio (só espaços) deveria ter sido rejeitado';
  exception when others then
    if sqlerrm like '%name não pode ser vazio%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.39 [SET ROLE real] create_packaging rejeita nome vazio (chamada direta, fora da Edge Function)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.39 [SET ROLE real] create_packaging rejeita nome vazio (chamada direta, fora da Edge Function)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.40 [SET ROLE real] create_packaging rejeita minimum_stock negativo
-- (CHECK da tabela, Migration 18 — não uma checagem redundante da
-- function).
do $$
declare
  v_user_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  begin
    set local role service_role;
    perform public.create_packaging('Embalagem com estoque negativo', null, null, -1, null, v_user_id);
    v_status := 'FAIL';
    v_details := 'minimum_stock=-1 deveria ter sido rejeitado pela CHECK (minimum_stock >= 0)';
  exception when check_violation then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.40 [SET ROLE real] create_packaging rejeita minimum_stock negativo (CHECK da tabela)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.40 [SET ROLE real] create_packaging rejeita minimum_stock negativo (CHECK da tabela)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.41 [SET ROLE real] update_packaging rejeita nome vazio.
do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id_legacy';

  begin
    set local role service_role;
    perform public.update_packaging(v_packaging_id, jsonb_build_object('name', '   '), v_user_id);
    v_status := 'FAIL';
    v_details := 'nome vazio (só espaços) deveria ter sido rejeitado';
  exception when others then
    if sqlerrm like '%name não pode ser vazio%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.41 [SET ROLE real] update_packaging rejeita nome vazio', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.41 [SET ROLE real] update_packaging rejeita nome vazio', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.42 [SET ROLE real] update_packaging rejeita is_active null explícito
-- (coluna NOT NULL) quando a chave é enviada com valor JSON null.
do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id_legacy';

  begin
    set local role service_role;
    perform public.update_packaging(v_packaging_id, jsonb_build_object('is_active', null), v_user_id);
    v_status := 'FAIL';
    v_details := 'is_active=null deveria ter sido rejeitado (coluna NOT NULL)';
  exception when not_null_violation then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.42 [SET ROLE real] update_packaging rejeita is_active null explícito (NOT NULL)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.42 [SET ROLE real] update_packaging rejeita is_active null explícito (NOT NULL)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.43 [SET ROLE real] update_packaging rejeita minimum_stock negativo
-- (CHECK da tabela).
do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id_legacy';

  begin
    set local role service_role;
    perform public.update_packaging(v_packaging_id, jsonb_build_object('minimum_stock', -3), v_user_id);
    v_status := 'FAIL';
    v_details := 'minimum_stock=-3 deveria ter sido rejeitado pela CHECK (minimum_stock >= 0)';
  exception when check_violation then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.43 [SET ROLE real] update_packaging rejeita minimum_stock negativo (CHECK da tabela)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.43 [SET ROLE real] update_packaging rejeita minimum_stock negativo (CHECK da tabela)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.44 [SET ROLE real] update_packaging rejeita p_patch nulo e '{}' —
-- nunca vira um UPDATE vazio silencioso.
do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_status text;
  v_details text;
  v_null_rejected boolean := false;
  v_empty_rejected boolean := false;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id_legacy';

  set local role service_role;

  begin
    perform public.update_packaging(v_packaging_id, null, v_user_id);
  exception when others then
    if sqlerrm like '%p_patch vazio%' then
      v_null_rejected := true;
    end if;
  end;

  begin
    perform public.update_packaging(v_packaging_id, '{}'::jsonb, v_user_id);
  exception when others then
    if sqlerrm like '%p_patch vazio%' then
      v_empty_rejected := true;
    end if;
  end;

  reset role;

  if v_null_rejected and v_empty_rejected then
    v_status := 'PASS';
    v_details := 'p_patch nulo e {} rejeitados corretamente';
  else
    v_status := 'FAIL';
    v_details := 'null_rejected=' || v_null_rejected || ' empty_rejected=' || v_empty_rejected;
  end if;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.44 [SET ROLE real] update_packaging rejeita p_patch nulo e vazio ({})', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.44 [SET ROLE real] update_packaging rejeita p_patch nulo e vazio ({})', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.45 [SET ROLE real] update_packaging rejeita chave desconhecida em
-- p_patch — não é só silenciosamente removida por jsonb_whitelist.
do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id_legacy';

  begin
    set local role service_role;
    perform public.update_packaging(v_packaging_id, jsonb_build_object('material', 'titânio'), v_user_id);
    v_status := 'FAIL';
    v_details := 'chave desconhecida (material) deveria ter sido rejeitada, não silenciosamente ignorada';
  exception when others then
    if sqlerrm like '%chave(s) não suportada(s)%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'erro inesperado: ' || sqlerrm;
    end if;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.45 [SET ROLE real] update_packaging rejeita chave desconhecida em p_patch (não silenciosamente removida)', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.45 [SET ROLE real] update_packaging rejeita chave desconhecida em p_patch (não silenciosamente removida)', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.46 [SET ROLE real] delete_packaging exclui fisicamente uma embalagem
-- nunca utilizada (sem vínculo em product_packaging) — packaging_id_created,
-- criada na 10.28.
do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_status text;
  v_details text;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id_created';

  begin
    set local role service_role;
    perform public.delete_packaging(v_packaging_id, v_user_id);

    select count(*) into v_count from public.packaging where id = v_packaging_id;
    if v_count <> 0 then
      raise exception 'embalagem deveria ter sido excluída fisicamente, ainda encontrada';
    end if;

    v_status := 'PASS';
    v_details := 'embalagem sem vínculo excluída com sucesso';
  exception when others then
    v_status := 'FAIL';
    v_details := sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.46 [SET ROLE real] delete_packaging exclui fisicamente uma embalagem nunca utilizada', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.46 [SET ROLE real] delete_packaging exclui fisicamente uma embalagem nunca utilizada', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.47 [SET ROLE real] delete_packaging bloqueia exclusão de embalagem
-- vinculada a product_packaging e não remove o vínculo nem executa
-- cascata. Cria uma embalagem nova e vincula via set_product_composition
-- (mesmo caminho real de escrita da composição — nunca um INSERT bruto em
-- product_packaging) para não depender do estado remanescente de outras
-- seções.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_accessory_id_1 uuid;
  v_packaging_id uuid;
  v_status text;
  v_details text;
  v_link_count_before integer;
  v_link_count_after integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
  select value::uuid into v_accessory_id_1 from zz_fixtures where key = 'accessory_id_1';

  begin
    set local role service_role;
    v_packaging_id := (public.create_packaging('Embalagem vinculada a produto (teste)', null, null, null, null, v_user_id)).id;
    reset role;

    -- Vincula via o caminho real de escrita (nunca um INSERT bruto em
    -- product_packaging) — preserva a composição de acessórios já existente
    -- do produto (accessory_id_1, estado deixado pela 10.4) para não
    -- interferir em nenhum teste anterior.
    perform public.set_product_composition(
      v_product_id,
      jsonb_build_array(jsonb_build_object('id', v_accessory_id_1, 'quantity', 5)),
      jsonb_build_array(jsonb_build_object('id', v_packaging_id, 'quantity', 1)),
      v_user_id
    );

    select count(*) into v_link_count_before from public.product_packaging where packaging_id = v_packaging_id;
    if v_link_count_before <> 1 then
      raise exception 'esperado 1 vínculo criado via set_product_composition, encontrado %', v_link_count_before;
    end if;

    set local role service_role;
    begin
      perform public.delete_packaging(v_packaging_id, v_user_id);
      v_status := 'FAIL';
      v_details := 'delete_packaging deveria ter sido bloqueado (embalagem vinculada a um produto)';
    exception when others then
      if sqlerrm like '%vinculada a um produto e não pode ser excluída%' then
        v_status := 'PASS';
        v_details := sqlerrm;
      else
        v_status := 'FAIL';
        v_details := 'erro inesperado: ' || sqlerrm;
      end if;
    end;
    reset role;

    select count(*) into v_link_count_after from public.product_packaging where packaging_id = v_packaging_id;

    if v_status = 'PASS' and v_link_count_after <> v_link_count_before then
      v_status := 'FAIL';
      v_details := 'vínculo em product_packaging não deveria ser alterado (antes=' || v_link_count_before || ' depois=' || v_link_count_after || ')';
    end if;

    if v_status = 'PASS' and not exists (select 1 from public.packaging where id = v_packaging_id) then
      v_status := 'FAIL';
      v_details := 'embalagem não deveria ter sido excluída (bloqueio deveria impedir o DELETE)';
    end if;
  exception when others then
    reset role;
    v_status := 'FAIL';
    v_details := 'erro no setup do teste: ' || sqlerrm;
  end;

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.47 [SET ROLE real] delete_packaging bloqueia exclusão vinculada a product_packaging, sem cascata', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.47 [SET ROLE real] delete_packaging bloqueia exclusão vinculada a product_packaging, sem cascata', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.48 [SET ROLE real] authenticated NÃO consegue executar delete_packaging
-- diretamente (EXECUTE só concedido a service_role).
do $$
declare
  v_auth_user_id_text text;
  v_user_id uuid;
  v_packaging_id uuid;
  v_status text;
  v_details text;
begin
  select value into v_auth_user_id_text from zz_fixtures where key = 'auth_user_id';
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id_legacy';

  begin
    set local role authenticated;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_auth_user_id_text, 'role', 'authenticated')::text,
      true
    );

    perform public.delete_packaging(v_packaging_id, v_user_id);
    v_status := 'FAIL';
    v_details := 'delete_packaging foi executado por authenticated (não deveria)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;
  reset "request.jwt.claims";

  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.48 [SET ROLE real] authenticated não consegue executar delete_packaging diretamente', v_status, v_details);
exception when others then
  reset role;
  reset "request.jwt.claims";
  insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.48 [SET ROLE real] authenticated não consegue executar delete_packaging diretamente', 'FAIL', 'erro no bloco de teste: ' || sqlerrm);
end $$;

-- 10.49 Grants: packaging perde INSERT/UPDATE de authenticated (mantém
-- SELECT, sem DELETE); create_packaging/update_packaging/delete_packaging
-- só têm EXECUTE concedido a service_role.
do $$
begin
  begin
    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49a authenticated mantém SELECT em packaging',
      case when has_table_privilege('authenticated', 'public.packaging', 'SELECT') then 'PASS' else 'FAIL' end,
      'SELECT=' || has_table_privilege('authenticated', 'public.packaging', 'SELECT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49b authenticated NÃO tem mais INSERT em packaging',
      case when has_table_privilege('authenticated', 'public.packaging', 'INSERT') then 'FAIL' else 'PASS' end,
      'INSERT=' || has_table_privilege('authenticated', 'public.packaging', 'INSERT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49c authenticated NÃO tem mais UPDATE em packaging.name',
      case when has_column_privilege('authenticated', 'public.packaging', 'name', 'UPDATE') then 'FAIL' else 'PASS' end,
      'UPDATE(name)=' || has_column_privilege('authenticated', 'public.packaging', 'name', 'UPDATE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49d authenticated não tem DELETE em packaging',
      case when has_table_privilege('authenticated', 'public.packaging', 'DELETE') then 'FAIL' else 'PASS' end,
      'DELETE=' || has_table_privilege('authenticated', 'public.packaging', 'DELETE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49e anon não tem DELETE em packaging',
      case when has_table_privilege('anon', 'public.packaging', 'DELETE') then 'FAIL' else 'PASS' end,
      'DELETE=' || has_table_privilege('anon', 'public.packaging', 'DELETE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49f service_role tem EXECUTE em create_packaging',
      case when has_function_privilege('service_role', 'public.create_packaging(text, text, text, integer, boolean, uuid)', 'EXECUTE') then 'PASS' else 'FAIL' end,
      'EXECUTE=' || has_function_privilege('service_role', 'public.create_packaging(text, text, text, integer, boolean, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49g authenticated NÃO tem EXECUTE em create_packaging',
      case when has_function_privilege('authenticated', 'public.create_packaging(text, text, text, integer, boolean, uuid)', 'EXECUTE') then 'FAIL' else 'PASS' end,
      'EXECUTE=' || has_function_privilege('authenticated', 'public.create_packaging(text, text, text, integer, boolean, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49h service_role tem EXECUTE em update_packaging',
      case when has_function_privilege('service_role', 'public.update_packaging(uuid, jsonb, uuid)', 'EXECUTE') then 'PASS' else 'FAIL' end,
      'EXECUTE=' || has_function_privilege('service_role', 'public.update_packaging(uuid, jsonb, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49i authenticated NÃO tem EXECUTE em update_packaging',
      case when has_function_privilege('authenticated', 'public.update_packaging(uuid, jsonb, uuid)', 'EXECUTE') then 'FAIL' else 'PASS' end,
      'EXECUTE=' || has_function_privilege('authenticated', 'public.update_packaging(uuid, jsonb, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49j service_role tem EXECUTE em delete_packaging',
      case when has_function_privilege('service_role', 'public.delete_packaging(uuid, uuid)', 'EXECUTE') then 'PASS' else 'FAIL' end,
      'EXECUTE=' || has_function_privilege('service_role', 'public.delete_packaging(uuid, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49k authenticated NÃO tem EXECUTE em delete_packaging',
      case when has_function_privilege('authenticated', 'public.delete_packaging(uuid, uuid)', 'EXECUTE') then 'FAIL' else 'PASS' end,
      'EXECUTE=' || has_function_privilege('authenticated', 'public.delete_packaging(uuid, uuid)', 'EXECUTE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.49l anon NÃO tem EXECUTE em delete_packaging',
      case when has_function_privilege('anon', 'public.delete_packaging(uuid, uuid)', 'EXECUTE') then 'FAIL' else 'PASS' end,
      'EXECUTE=' || has_function_privilege('anon', 'public.delete_packaging(uuid, uuid)', 'EXECUTE'));
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.49 checagens de privilégio nas novas functions protegidas de Embalagens', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 11 — Formatação de order_number (FS-XX-YYY, migration
-- 20260820233219_update_order_number_format.sql)
-- =============================================================================
-- Testa a EXPRESSÃO de formatação isoladamente (mesma lógica usada dentro
-- de next_order_number(): lpad(seq::text, greatest(3, length(seq::text)),
-- '0')) para uma tabela de casos que cobre a exigência de "nunca truncar
-- acima de 999" — sem criar nenhum pedido nem chamar next_order_number()
-- milhares de vezes. Controlado e transacional: só SELECTs sobre valores
-- literais, nenhuma escrita.

do $$
declare
  v_case record;
  v_result text;
  v_all_ok boolean := true;
  v_details text := '';
begin
  begin
    for v_case in
      select * from (values
        (1, '001'),
        (10, '010'),
        (999, '999'),
        (1000, '1000'),
        (9999, '9999'),
        (10000, '10000')
      ) as t(input_number, expected)
    loop
      v_result := lpad(
        v_case.input_number::text,
        greatest(3, length(v_case.input_number::text)),
        '0'
      );
      if v_result <> v_case.expected then
        v_all_ok := false;
        v_details := v_details || format('input=%s esperado=%s obtido=%s; ', v_case.input_number, v_case.expected, v_result);
      end if;
    end loop;

    if not v_all_ok then
      raise exception 'divergência(s) na formatação da sequência: %', v_details;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('11', '11.1 formatação da sequência (1, 10, 999, 1000, 9999, 10000) nunca trunca acima de 999', 'PASS', '1->001, 10->010, 999->999, 1000->1000, 9999->9999, 10000->10000');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('11', '11.1 formatação da sequência (1, 10, 999, 1000, 9999, 10000) nunca trunca acima de 999', 'FAIL', sqlerrm);
  end;
end $$;

-- Confirma o formato final ponta a ponta (FS-XX-YYY, ano com 2 dígitos)
-- usando a própria next_order_number(), sem depender de literais soltos.
-- Chamada dentro da mesma transação com ROLLBACK no fim deste arquivo —
-- o incremento em order_number_counters para o ano corrente nunca
-- persiste, mesmo sem a restauração explícita abaixo.
do $$
declare
  v_generated text;
  v_year integer := extract(year from now() at time zone 'America/Sao_Paulo')::integer;
begin
  begin
    v_generated := public.next_order_number();

    if v_generated !~ '^FS-[0-9]{2}-[0-9]{3,}$' then
      raise exception 'next_order_number() retornou fora do formato FS-XX-YYY: %', v_generated;
    end if;
    if substring(v_generated from 4 for 2) <> lpad((v_year % 100)::text, 2, '0') then
      raise exception 'next_order_number() retornou ano diferente do ano corrente: %', v_generated;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('11', '11.2 next_order_number() gera FS-XX-YYY com o ano corrente (2 dígitos)', 'PASS', 'gerado=' || v_generated);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('11', '11.2 next_order_number() gera FS-XX-YYY com o ano corrente (2 dígitos)', 'FAIL', sqlerrm);
  end;
end $$;

-- Confirma next_order_number() acima de 999 no mesmo ano, sem criar 1000
-- pedidos: avança o contador do ano corrente diretamente para 999 (dentro
-- desta mesma transação, sob ROLLBACK) e chama a função uma única vez
-- para observar a próxima saída (1000). O valor original do contador é
-- restaurado explicitamente logo em seguida — tanto no caminho de
-- sucesso quanto no de exceção — como defesa em profundidade, mesmo o
-- ROLLBACK final já garantindo que nada disto persiste.
do $$
declare
  v_year integer := extract(year from now() at time zone 'America/Sao_Paulo')::integer;
  v_original_last_number integer;
  v_had_row boolean := false;
  v_generated text;
begin
  begin
    select last_number into v_original_last_number
      from public.order_number_counters
      where year = v_year;
    v_had_row := found;

    insert into public.order_number_counters (year, last_number)
      values (v_year, 999)
      on conflict (year) do update set last_number = 999;

    v_generated := public.next_order_number();

    if v_generated <> 'FS-' || lpad((v_year % 100)::text, 2, '0') || '-1000' then
      raise exception 'esperado sequência 1000 sem truncamento, obtido: %', v_generated;
    end if;

    -- Restauração explícita do contador do ano corrente.
    if v_had_row then
      update public.order_number_counters set last_number = v_original_last_number where year = v_year;
    else
      delete from public.order_number_counters where year = v_year;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('11', '11.3 next_order_number() ultrapassa 999 sem truncar (contador restaurado)', 'PASS', 'gerado=' || v_generated);
  exception when others then
    -- Restaura mesmo no caminho de exceção, antes de registrar o FAIL.
    if v_had_row then
      update public.order_number_counters set last_number = v_original_last_number where year = v_year;
    else
      delete from public.order_number_counters where year = v_year;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('11', '11.3 next_order_number() ultrapassa 999 sem truncar (contador restaurado)', 'FAIL', sqlerrm);
  end;
end $$;

-- Confirma que a lógica de validação de consistência de
-- order_number_counters (pré-validação 1.7 da migration
-- 20260820233219_update_order_number_format.sql) detecta corretamente um
-- contador abaixo da maior sequência já emitida no ano — sem aplicar a
-- migration real, só reproduzindo a mesma consulta de detecção contra um
-- cenário manipulado dentro desta transação (sob ROLLBACK). Nenhum dado
-- real é usado: reaproveita o pedido de teste já criado na Seção 3
-- (fixture order_catalog_id). O contador do ano do pedido de teste é
-- restaurado explicitamente logo em seguida — tanto no caminho de
-- sucesso quanto no de exceção — mesma defesa em profundidade dos testes
-- 11.2/11.3, mesmo o ROLLBACK final já garantindo que nada disto persiste.
do $$
declare
  v_order_id uuid;
  v_order_number text;
  v_order_date date;
  v_year integer;
  v_sequence integer;
  v_original_last_number integer;
  v_had_row boolean := false;
  v_inconsistent_count integer;
begin
  begin
    select value::uuid into v_order_id from zz_fixtures where key = 'order_catalog_id';
    if v_order_id is null then
      raise exception 'fixture order_catalog_id ausente (Seção 3 falhou)';
    end if;

    select order_number, order_date into v_order_number, v_order_date from public.orders where id = v_order_id;

    -- Validação estrutural do formato FS-XX-YYY (mesma regex do CHECK
    -- constraint da migration
    -- 20260820233219_update_order_number_format.sql): prefixo FS, ano com
    -- 2 dígitos, sequência com 3 OU MAIS dígitos — nunca largura fixa,
    -- pois sequências >= 1000 não são truncadas por essa migration.
    if v_order_number !~ '^FS-[0-9]{2}-[0-9]{3,}$' then
      raise exception 'order_number % fora do formato esperado FS-XX-YYY', v_order_number;
    end if;

    -- Extração estrutural pelos segmentos separados por hífen (nunca por
    -- posição fixa, que é incompatível com sequência de largura
    -- variável): split_part(...,'-',2)=ano de 2 dígitos,
    -- split_part(...,'-',3)=sequência (o cast para integer já descarta
    -- zeros à esquerda: '001'->1, '010'->10, '999'->999).
    v_sequence := split_part(v_order_number, '-', 3)::integer;

    -- order_number_counters.year guarda o ano cheio (ex.: 2026), enquanto
    -- order_number traz só os 2 últimos dígitos. Deriva o ano cheio a
    -- partir do order_date real do pedido (não assume século por
    -- aritmética) e valida que os 2 últimos dígitos batem com o sufixo do
    -- order_number, como checagem de consistência.
    v_year := extract(year from v_order_date)::integer;
    if v_year % 100 <> split_part(v_order_number, '-', 2)::integer then
      raise exception 'sufixo de ano do order_number (%) não corresponde ao ano de order_date (%)',
        split_part(v_order_number, '-', 2), v_year;
    end if;

    select last_number into v_original_last_number
      from public.order_number_counters
      where year = v_year;
    v_had_row := found;

    -- Força o contador do ano do pedido de teste para abaixo da
    -- sequência já emitida — exatamente o cenário que a pré-validação 1.7
    -- da migration deve recusar com RAISE EXCEPTION.
    insert into public.order_number_counters (year, last_number)
      values (v_year, greatest(v_sequence - 1, 0))
      on conflict (year) do update set last_number = greatest(v_sequence - 1, 0);

    -- Mesma consulta de detecção usada na migration (seção 1.7): conta
    -- anos cujo contador está ausente ou é menor que a maior sequência já
    -- emitida naquele ano.
    select count(*) into v_inconsistent_count
      from (select v_year as old_year, v_sequence as max_seq) y
      left join public.order_number_counters onc on onc.year = y.old_year
      where onc.year is null or onc.last_number < y.max_seq;

    if v_inconsistent_count <> 1 then
      raise exception 'esperado detectar 1 inconsistência de contador, detectado %', v_inconsistent_count;
    end if;

    -- Restauração explícita do contador do ano do pedido de teste.
    if v_had_row then
      update public.order_number_counters set last_number = v_original_last_number where year = v_year;
    else
      delete from public.order_number_counters where year = v_year;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('11', '11.4 detecção de contador abaixo da maior sequência emitida (pré-validação 1.7 da migration, contador restaurado)', 'PASS', 'ano=' || v_year || ' sequência=' || v_sequence);
  exception when others then
    if v_had_row then
      update public.order_number_counters set last_number = v_original_last_number where year = v_year;
    else
      delete from public.order_number_counters where year = v_year;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('11', '11.4 detecção de contador abaixo da maior sequência emitida (pré-validação 1.7 da migration, contador restaurado)', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 12 — as duas sobrecargas de create_order() (10 e 11 parâmetros) e
-- agregação de itens em vw_order_summary (migration
-- 20260821014342_extend_order_summary_and_payment_method.sql — AINDA NÃO
-- APLICADA no momento em que esta seção foi escrita; os testes abaixo só
-- devem passar depois que a migration for aplicada no ambiente onde este
-- arquivo rodar).
-- =============================================================================

-- 12.1 Chamada ANTIGA, com exatamente 10 argumentos posicionais: resolve
-- exclusivamente para a função preservada da Migration 17 (que não tem
-- parâmetro payment_method) — prova que a compatibilidade retroativa
-- continua funcionando sem nenhuma alteração de comportamento.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_payment_method text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
    if v_user_id is null or v_customer_id is null or v_product_id is null then
      raise exception 'fixture ausente (setup/seção 1 falhou)';
    end if;

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste chamada antiga (10 parâmetros)',
      jsonb_build_array(
        jsonb_build_object(
          'item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item Catálogo Chamada Antiga', 'quantity', 1, 'unit_price', 20.00
        )
      ),
      v_user_id
    );

    select payment_method into v_payment_method from public.orders where id = v_order_id;

    if v_payment_method is not null then
      raise exception 'a função de 10 parâmetros não deveria gravar payment_method (nem tem esse parâmetro), veio %', v_payment_method;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.1 chamada antiga com 10 parâmetros continua funcionando, resolve exclusivamente para a função preservada (payment_method sempre null)', 'PASS', 'order_id=' || v_order_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.1 chamada antiga com 10 parâmetros continua funcionando, resolve exclusivamente para a função preservada (payment_method sempre null)', 'FAIL', sqlerrm);
  end;
end $$;

-- 12.2 Chamada NOVA, com 11 argumentos posicionais e payment_method=PIX.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_payment_method text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste payment_method PIX (11 parâmetros)',
      jsonb_build_array(
        jsonb_build_object(
          'item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item Catálogo PIX', 'quantity', 1, 'unit_price', 50.00
        )
      ),
      v_user_id,
      'PIX'
    );

    select payment_method into v_payment_method from public.orders where id = v_order_id;

    if v_payment_method <> 'PIX' then
      raise exception 'payment_method deveria ser PIX, veio %', v_payment_method;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.2 create_order (11 parâmetros) aceita payment_method=PIX e persiste no mesmo INSERT (criação atômica)', 'PASS', 'order_id=' || v_order_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.2 create_order (11 parâmetros) aceita payment_method=PIX e persiste no mesmo INSERT (criação atômica)', 'FAIL', sqlerrm);
  end;
end $$;

-- 12.3 Chamada NOVA com payment_method=null ENVIADO EXPLICITAMENTE (não
-- omitido — a sobrecarga de 11 parâmetros não tem DEFAULT, então só
-- existe a forma explícita).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_payment_method text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste payment_method null explícito (11 parâmetros)',
      jsonb_build_array(
        jsonb_build_object(
          'item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item Catálogo Método Null', 'quantity', 1, 'unit_price', 30.00
        )
      ),
      v_user_id,
      null
    );

    select payment_method into v_payment_method from public.orders where id = v_order_id;

    if v_payment_method is not null then
      raise exception 'payment_method deveria ser null (enviado explicitamente), veio %', v_payment_method;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.3 create_order (11 parâmetros) com payment_method=null explícito persiste null — nenhuma obrigatoriedade inventada', 'PASS', 'order_id=' || v_order_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.3 create_order (11 parâmetros) com payment_method=null explícito persiste null — nenhuma obrigatoriedade inventada', 'FAIL', sqlerrm);
  end;
end $$;

-- 12.4 Caso de falha esperada: payment_method fora de
-- PIX/DINHEIRO/CARTAO/null é rejeitado pela VALIDAÇÃO EXPLÍCITA dentro da
-- função nova, antes de qualquer INSERT (a CHECK de orders.payment_method
-- continua existindo como defesa adicional, mas não é ela quem dispara
-- aqui — a função rejeita antes de chegar lá).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_status text;
  v_details text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste payment_method inválido (11 parâmetros)',
      jsonb_build_array(
        jsonb_build_object(
          'item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item Catálogo Método Inválido', 'quantity', 1, 'unit_price', 10.00
        )
      ),
      v_user_id,
      'BOLETO'
    );

    v_status := 'FAIL';
    v_details := 'create_order (11 parâmetros) aceitou payment_method=BOLETO (não deveria)';
  exception when others then
    if sqlerrm like '%p_payment_method inválido%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'esperada mensagem de validação de p_payment_method, veio outra exceção: ' || sqlerrm;
    end if;
  end;

  insert into zz_test_results(section, test_name, status, details)
    values ('12', '12.4 create_order (11 parâmetros) rejeita payment_method inválido (BOLETO) com mensagem clara, antes do INSERT', v_status, v_details);
end $$;

-- 12.5 Exatamente duas sobrecargas de create_order (10 e 11 parâmetros) —
-- nenhuma ambígua, nenhuma extra/inesperada.
do $$
declare
  v_count_10 integer;
  v_count_11 integer;
begin
  begin
    select count(*) into v_count_10
      from pg_proc
      where pronamespace = 'public'::regnamespace and proname = 'create_order' and pronargs = 10;
    select count(*) into v_count_11
      from pg_proc
      where pronamespace = 'public'::regnamespace and proname = 'create_order' and pronargs = 11;

    if v_count_10 <> 1 or v_count_11 <> 1 then
      raise exception 'esperado exatamente 1 função de 10 e 1 de 11 parâmetros, encontrado 10=%, 11=%', v_count_10, v_count_11;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.5 exatamente duas sobrecargas de create_order (10 e 11 parâmetros), sem ambiguidade possível', 'PASS', '10=' || v_count_10 || ' 11=' || v_count_11);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.5 exatamente duas sobrecargas de create_order (10 e 11 parâmetros), sem ambiguidade possível', 'FAIL', sqlerrm);
  end;
end $$;

-- 12.6 Permissões: anon/authenticated sem EXECUTE em NENHUMA das duas
-- sobrecargas; só service_role com EXECUTE nas duas.
do $$
declare
  v_anon_10 boolean;
  v_anon_11 boolean;
  v_authenticated_10 boolean;
  v_authenticated_11 boolean;
  v_service_role_10 boolean;
  v_service_role_11 boolean;
begin
  begin
    select has_function_privilege('anon', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_anon_10;
    select has_function_privilege('anon', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE') into v_anon_11;
    select has_function_privilege('authenticated', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_authenticated_10;
    select has_function_privilege('authenticated', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE') into v_authenticated_11;
    select has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_service_role_10;
    select has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE') into v_service_role_11;

    if v_anon_10 or v_anon_11 or v_authenticated_10 or v_authenticated_11 or not v_service_role_10 or not v_service_role_11 then
      raise exception 'permissões inesperadas: anon(10=%,11=%) authenticated(10=%,11=%) service_role(10=%,11=%)',
        v_anon_10, v_anon_11, v_authenticated_10, v_authenticated_11, v_service_role_10, v_service_role_11;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.6 permissões: anon/authenticated sem EXECUTE em nenhuma sobrecarga; service_role com EXECUTE nas duas', 'PASS', 'ok');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.6 permissões: anon/authenticated sem EXECUTE em nenhuma sobrecarga; service_role com EXECUTE nas duas', 'FAIL', sqlerrm);
  end;
end $$;

-- 12.7 item_types em ordem EXPLÍCITA CATALOG→CUSTOM→SPOT (CASE), mesmo
-- com os itens criados em ordem embaralhada (SPOT primeiro) — prova que a
-- ordem não depende implicitamente da coincidência alfabética.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_item_types text[];
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste ordem explícita de item_types',
      jsonb_build_array(
        jsonb_build_object(
          'item_type', 'SPOT', 'item_name', 'Item Spot Primeiro', 'quantity', 1, 'unit_price', 10.00,
          'spot_details', jsonb_build_object('source_reference', 'teste ordem')
        ),
        jsonb_build_object(
          'item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item Catálogo Segundo', 'quantity', 1, 'unit_price', 10.00
        ),
        jsonb_build_object(
          'item_type', 'CUSTOM', 'item_name', 'Item Custom Terceiro', 'quantity', 1, 'unit_price', 10.00,
          'custom_details', jsonb_build_object('current_version', 'v1.0')
        )
      ),
      v_user_id,
      null
    );

    select item_types into v_item_types from public.vw_order_summary where order_id = v_order_id;

    if v_item_types <> array['CATALOG', 'CUSTOM', 'SPOT'] then
      raise exception 'item_types deveria ser {CATALOG,CUSTOM,SPOT} mesmo com criação em ordem embaralhada, veio %', v_item_types;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.7 item_types em ordem explícita CATALOG→CUSTOM→SPOT (CASE), independente da ordem de criação (SPOT criado primeiro)', 'PASS', 'item_types=' || array_to_string(v_item_types, ','));
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.7 item_types em ordem explícita CATALOG→CUSTOM→SPOT (CASE), independente da ordem de criação (SPOT criado primeiro)', 'FAIL', sqlerrm);
  end;
end $$;

-- 12.8 item_names usa order_items.id como desempate quando created_at é
-- forçado a ser idêntico entre dois itens — prova a ordenação
-- determinística exigida (created_at, id), não só created_at sozinho.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_item1_id uuid;
  v_item2_id uuid;
  v_item_names text[];
  v_expected_first text;
  v_expected_second text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste desempate created_at/id',
      jsonb_build_array(
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item Empate A', 'quantity', 1, 'unit_price', 10.00),
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item Empate B', 'quantity', 1, 'unit_price', 10.00)
      ),
      v_user_id,
      null
    );

    select id into v_item1_id from public.order_items where order_id = v_order_id and item_name = 'Item Empate A';
    select id into v_item2_id from public.order_items where order_id = v_order_id and item_name = 'Item Empate B';

    -- Força created_at idêntico nas duas linhas — o único critério de
    -- desempate que resta é order_items.id.
    update public.order_items set created_at = timestamptz '2026-01-01 00:00:00+00' where id in (v_item1_id, v_item2_id);

    if v_item1_id < v_item2_id then
      v_expected_first := 'Item Empate A';
      v_expected_second := 'Item Empate B';
    else
      v_expected_first := 'Item Empate B';
      v_expected_second := 'Item Empate A';
    end if;

    select item_names into v_item_names from public.vw_order_summary where order_id = v_order_id;

    if v_item_names <> array[v_expected_first, v_expected_second] then
      raise exception 'esperado item_names em ordem de id como desempate (%, %), veio %', v_expected_first, v_expected_second, v_item_names;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.8 item_names usa order_items.id como desempate quando created_at é idêntico', 'PASS', 'ordem=' || array_to_string(v_item_names, ','));
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.8 item_names usa order_items.id como desempate quando created_at é idêntico', 'FAIL', sqlerrm);
  end;
end $$;

-- 12.9 Agregação geral: 2 itens CATALOG + 1 CUSTOM — item_types
-- deduplicado (só 2 valores); item_names com os 3, sem deduplicar, na
-- ordem determinística (created_at, id) documentada pela própria view
-- (ver comentário da migration
-- 20260821014342_extend_order_summary_and_payment_method.sql:
-- "array_agg(oi.item_name order by oi.created_at, oi.id)").
--
-- Correção (instabilidade intermitente): os 3 itens são inseridos por
-- uma única chamada de create_order(), ou seja, dentro de uma única
-- transação/execução de função — e now() é fixo para toda a transação
-- (= transaction_timestamp()), nunca avança entre os INSERTs. Logo os 3
-- order_items recebem created_at IDÊNTICO sempre, e o desempate real cai
-- inteiramente em order_items.id (uuid aleatório, sem relação com a
-- ordem de criação) — exatamente o mesmo desempate já comprovado
-- pelo teste 12.7/12.8. Este teste antes cravava o array literal na
-- ordem de criação, o que só passava por coincidência de ordenação de
-- uuid. Não há aqui um requisito de contrato de preservar ordem de
-- inserção (não existe coluna de posição/sequência em order_items); o
-- contrato real e já documentado é a ordem (created_at, id). A correção
-- é assertar contra essa ordem computada a partir dos dados reais, e não
-- contra um literal.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_item_types text[];
  v_item_names text[];
  v_expected_names text[];
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste agregação de itens',
      jsonb_build_array(
        jsonb_build_object(
          'item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item Catálogo Um', 'quantity', 1, 'unit_price', 10.00
        ),
        jsonb_build_object(
          'item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item Catálogo Dois', 'quantity', 1, 'unit_price', 10.00
        ),
        jsonb_build_object(
          'item_type', 'CUSTOM', 'item_name', 'Item Personalizado Três', 'quantity', 1, 'unit_price', 10.00,
          'custom_details', jsonb_build_object('current_version', 'v1.0')
        )
      ),
      v_user_id,
      null
    );

    select item_types, item_names into v_item_types, v_item_names
      from public.vw_order_summary
      where order_id = v_order_id;

    -- Ordem esperada de item_names computada a partir dos dados reais de
    -- order_items, usando o MESMO critério determinístico documentado
    -- pela view (created_at, id) — não um literal de ordem de criação,
    -- que não é garantida quando created_at empata (ver comentário acima).
    select array_agg(item_name order by created_at, id) into v_expected_names
      from public.order_items
      where order_id = v_order_id;

    -- 2 itens CATALOG + 1 CUSTOM: item_types deve deduplicar para só 2
    -- valores, em ordem explícita CATALOG→CUSTOM — nunca 3 valores.
    if v_item_types <> array['CATALOG', 'CUSTOM'] then
      raise exception 'item_types deveria ser {CATALOG,CUSTOM} (deduplicado, ordem explícita), veio %', v_item_types;
    end if;
    -- item_names NUNCA deduplica: os 3 itens devem aparecer.
    if array_length(v_item_names, 1) <> 3 then
      raise exception 'item_names deveria conter os 3 itens sem deduplicar, veio % (tamanho %)', v_item_names, array_length(v_item_names, 1);
    end if;
    -- ... na ordem determinística (created_at, id) real da view.
    if v_item_names <> v_expected_names then
      raise exception 'item_names deveria seguir a ordem determinística (created_at, id) da view, esperado %, veio %', v_expected_names, v_item_names;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.9 vw_order_summary.item_types deduplicado em ordem explícita; item_names sem dedup, ordem determinística (created_at, id) (3 itens: 2 CATALOG + 1 CUSTOM)', 'PASS', 'order_id=' || v_order_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.9 vw_order_summary.item_types deduplicado em ordem explícita; item_names sem dedup, ordem determinística (created_at, id) (3 itens: 2 CATALOG + 1 CUSTOM)', 'FAIL', sqlerrm);
  end;
end $$;

-- 12.10 delivery_method repassado pela view.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_delivery_method text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, 'Transportadora', 15.00, 0, 'pedido teste delivery_method na view',
      jsonb_build_array(
        jsonb_build_object(
          'item_type', 'CATALOG', 'product_id', v_product_id,
          'item_name', 'Item Catálogo Entrega', 'quantity', 1, 'unit_price', 10.00
        )
      ),
      v_user_id,
      null
    );

    select delivery_method into v_delivery_method from public.vw_order_summary where order_id = v_order_id;

    if v_delivery_method <> 'Transportadora' then
      raise exception 'delivery_method deveria ser Transportadora, veio %', v_delivery_method;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.10 vw_order_summary.delivery_method repassa o valor gravado em orders.delivery_method', 'PASS', 'order_id=' || v_order_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('12', '12.10 vw_order_summary.delivery_method repassa o valor gravado em orders.delivery_method', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 13 — update_quote_order() (migration
-- 20260821031143_add_update_quote_order.sql — AINDA NÃO APLICADA no momento
-- em que esta seção foi escrita; os testes abaixo só devem passar depois
-- que a migration for aplicada no ambiente onde este arquivo rodar).
-- Edição atômica completa (cabeçalho + itens) de pedidos QUOTE/CATALOG.
-- =============================================================================

-- 13.1 Atualização atômica de cabeçalho + itens numa única chamada: troca
-- notes/delivery_method/shipping_cost/payment_method do cabeçalho e
-- substitui o item único por 2 itens novos, tudo na mesma chamada de
-- update_quote_order.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_lead_source_id uuid;
  v_order_id uuid;
  v_notes text;
  v_delivery_method text;
  v_shipping_cost numeric;
  v_payment_method text;
  v_item_count integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
    select id into v_lead_source_id from public.lead_sources where is_active limit 1;

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.1 (antes da edição)',
      jsonb_build_array(
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item Original', 'quantity', 1, 'unit_price', 10.00)
      ),
      v_user_id
    );

    perform public.update_quote_order(
      v_order_id, v_customer_id, null, v_lead_source_id, 'PIX', null, 'Correios', 20.00, 0, 'observação atualizada 13.1',
      jsonb_build_array(
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item Novo A', 'quantity', 2, 'unit_price', 15.00),
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item Novo B', 'quantity', 1, 'unit_price', 5.00)
      ),
      v_user_id
    );

    select notes, delivery_method, shipping_cost, payment_method into v_notes, v_delivery_method, v_shipping_cost, v_payment_method
      from public.orders where id = v_order_id;
    select count(*) into v_item_count from public.order_items where order_id = v_order_id;

    if v_notes <> 'observação atualizada 13.1' or v_delivery_method <> 'Correios' or v_shipping_cost <> 20.00
       or v_payment_method <> 'PIX' or v_item_count <> 2 then
      raise exception 'cabeçalho/itens não refletem a edição atômica: notes=%, delivery_method=%, shipping_cost=%, payment_method=%, item_count=%',
        v_notes, v_delivery_method, v_shipping_cost, v_payment_method, v_item_count;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('13', '13.1 update_quote_order atualiza cabeçalho e substitui o conjunto de itens numa única chamada atômica', 'PASS', 'order_id=' || v_order_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('13', '13.1 update_quote_order atualiza cabeçalho e substitui o conjunto de itens numa única chamada atômica', 'FAIL', sqlerrm);
  end;
end $$;

-- 13.2 order_number nunca é alterado pela edição.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_number_before text;
  v_order_number_after text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.2',
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.2', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );
    select order_number into v_order_number_before from public.orders where id = v_order_id;

    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, null, null, null, 0, 0, 'edição 13.2',
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.2 editado', 'quantity', 3, 'unit_price', 12.00)),
      v_user_id
    );
    select order_number into v_order_number_after from public.orders where id = v_order_id;

    if v_order_number_before <> v_order_number_after then
      raise exception 'order_number mudou: antes=%, depois=%', v_order_number_before, v_order_number_after;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('13', '13.2 update_quote_order preserva order_number', 'PASS', v_order_number_before);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('13', '13.2 update_quote_order preserva order_number', 'FAIL', sqlerrm);
  end;
end $$;

-- 13.3 order_status e payment_status nunca são alterados pela edição.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_status text;
  v_payment_status text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.3',
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.3', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, 'DINHEIRO', null, null, 0, 0, 'edição 13.3',
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.3 editado', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    select order_status, payment_status into v_status, v_payment_status from public.orders where id = v_order_id;

    if v_status <> 'QUOTE' or v_payment_status <> 'WAITING_PAYMENT' then
      raise exception 'status deveria continuar QUOTE/WAITING_PAYMENT, veio order_status=%, payment_status=%', v_status, v_payment_status;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('13', '13.3 update_quote_order preserva order_status e payment_status', 'PASS', 'order_status=' || v_status || ' payment_status=' || v_payment_status);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('13', '13.3 update_quote_order preserva order_status e payment_status', 'FAIL', sqlerrm);
  end;
end $$;

-- 13.4 subtotal/total_value são recalculados a partir do NOVO conjunto de
-- itens, na mesma chamada.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_subtotal numeric;
  v_total numeric;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.4',
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.4', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    -- 2 itens: 3×20,00 + 1×5,00 = 65,00.
    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, null, null, null, 0, 0, null,
      jsonb_build_array(
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.4 A', 'quantity', 3, 'unit_price', 20.00),
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.4 B', 'quantity', 1, 'unit_price', 5.00)
      ),
      v_user_id
    );

    select subtotal, total_value into v_subtotal, v_total from public.orders where id = v_order_id;

    if v_subtotal <> 65.00 or v_total <> 65.00 then
      raise exception 'subtotal/total_value deveriam ser 65.00, veio subtotal=%, total_value=%', v_subtotal, v_total;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('13', '13.4 update_quote_order recalcula subtotal/total_value a partir do novo conjunto de itens', 'PASS', 'subtotal=' || v_subtotal);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('13', '13.4 update_quote_order recalcula subtotal/total_value a partir do novo conjunto de itens', 'FAIL', sqlerrm);
  end;
end $$;

-- 13.5 Rollback completo quando um item no MEIO da lista é inválido: nem o
-- cabeçalho nem os itens originais podem ser afetados.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_notes_before text;
  v_notes_after text;
  v_item_count_after integer;
  v_item_name_after text;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'notes originais 13.5',
    jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item Original 13.5', 'quantity', 1, 'unit_price', 10.00)),
    v_user_id
  );
  select notes into v_notes_before from public.orders where id = v_order_id;

  begin
    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, null, null, null, 0, 0, 'notes NUNCA deveriam persistir 13.5',
      jsonb_build_array(
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item Válido', 'quantity', 1, 'unit_price', 10.00),
        jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item Inválido', 'quantity', 1, 'unit_price', -5.00)
      ),
      v_user_id
    );
    v_status := 'FAIL';
    v_details := 'update_quote_order aceitou item com unit_price negativo (não deveria)';
  exception when others then
    select notes into v_notes_after from public.orders where id = v_order_id;
    select count(*), max(item_name) into v_item_count_after, v_item_name_after
      from public.order_items where order_id = v_order_id;

    if v_notes_after <> v_notes_before or v_item_count_after <> 1 or v_item_name_after <> 'Item Original 13.5' then
      v_status := 'FAIL';
      v_details := format('exceção ocorreu, mas dados não voltaram ao estado original: notes=%s, item_count=%s, item_name=%s', v_notes_after, v_item_count_after, v_item_name_after);
    else
      v_status := 'PASS';
      v_details := sqlerrm;
    end if;
  end;

  insert into zz_test_results(section, test_name, status, details)
    values ('13', '13.5 rollback completo quando um item do meio da lista viola CHECK (unit_price negativo) — cabeçalho e itens originais preservados', v_status, v_details);
end $$;

-- 13.6 Rejeita pedidos fora de QUOTE.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_status text;
  v_details text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.6',
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.6', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );
    -- Força o status para fora de QUOTE só para exercitar a guarda de
    -- update_quote_order — não passa pelo fluxo de negócio real de
    -- aprovação (fora de escopo deste teste específico).
    update public.orders set order_status = 'APPROVED' where id = v_order_id;

    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, null, null, null, 0, 0, null,
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.6 editado', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    v_status := 'FAIL';
    v_details := 'update_quote_order aceitou um pedido fora de QUOTE (não deveria)';
  exception when others then
    if sqlerrm like '%só permite pedidos em QUOTE%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'esperada mensagem de bloqueio por status, veio outra exceção: ' || sqlerrm;
    end if;
  end;

  insert into zz_test_results(section, test_name, status, details)
    values ('13', '13.6 update_quote_order rejeita pedidos fora de QUOTE', v_status, v_details);
end $$;

-- 13.7a Rejeita pedidos com item CUSTOM/SPOT já existente.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_status text;
  v_details text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.7a (SPOT existente)',
      jsonb_build_array(
        jsonb_build_object('item_type', 'SPOT', 'item_name', 'Item Spot 13.7a', 'quantity', 1, 'unit_price', 10.00,
          'spot_details', jsonb_build_object('source_reference', 'teste 13.7a'))
      ),
      v_user_id
    );

    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, null, null, null, 0, 0, null,
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.7a novo', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    v_status := 'FAIL';
    v_details := 'update_quote_order aceitou um pedido com item SPOT existente (não deveria)';
  exception when others then
    if sqlerrm like '%não pode ser usada em pedidos com itens CUSTOM/SPOT existentes%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'esperada mensagem de bloqueio por item SPOT existente, veio outra exceção: ' || sqlerrm;
    end if;
  end;

  insert into zz_test_results(section, test_name, status, details)
    values ('13', '13.7a update_quote_order rejeita pedidos com item CUSTOM/SPOT já existente', v_status, v_details);
end $$;

-- 13.7b Rejeita item CUSTOM/SPOT enviado no payload, mesmo com o pedido
-- hoje só-CATALOG.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_status text;
  v_details text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.7b',
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.7b', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, null, null, null, 0, 0, null,
      jsonb_build_array(jsonb_build_object('item_type', 'CUSTOM', 'item_name', 'Item Custom no payload', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    v_status := 'FAIL';
    v_details := 'update_quote_order aceitou item CUSTOM no payload (não deveria)';
  exception when others then
    if sqlerrm like '%só aceita itens CATALOG%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'esperada mensagem de bloqueio por item não-CATALOG no payload, veio outra exceção: ' || sqlerrm;
    end if;
  end;

  insert into zz_test_results(section, test_name, status, details)
    values ('13', '13.7b update_quote_order rejeita item CUSTOM/SPOT enviado no payload', v_status, v_details);
end $$;

-- 13.8 Rejeita payload sem itens (array vazio).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_status text;
  v_details text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.8',
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.8', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, null, null, null, 0, 0, null,
      '[]'::jsonb,
      v_user_id
    );

    v_status := 'FAIL';
    v_details := 'update_quote_order aceitou um payload sem itens (não deveria)';
  exception when others then
    if sqlerrm like '%exige ao menos um item%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'esperada mensagem de bloqueio por payload vazio, veio outra exceção: ' || sqlerrm;
    end if;
  end;

  insert into zz_test_results(section, test_name, status, details)
    values ('13', '13.8 update_quote_order rejeita payload sem itens (array vazio)', v_status, v_details);
end $$;

-- 13.9 Rejeita payment_method inválido.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_status text;
  v_details text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.9',
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.9', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, 'BOLETO', null, null, 0, 0, null,
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.9 editado', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    v_status := 'FAIL';
    v_details := 'update_quote_order aceitou payment_method=BOLETO (não deveria)';
  exception when others then
    if sqlerrm like '%p_payment_method inválido%' then
      v_status := 'PASS';
      v_details := sqlerrm;
    else
      v_status := 'FAIL';
      v_details := 'esperada mensagem de validação de p_payment_method, veio outra exceção: ' || sqlerrm;
    end if;
  end;

  insert into zz_test_results(section, test_name, status, details)
    values ('13', '13.9 update_quote_order rejeita payment_method inválido (BOLETO)', v_status, v_details);
end $$;

-- 13.10 Rejeita valores negativos/inválidos (quantity <= 0, unit_price < 0)
-- via CHECK constraint de order_items — nenhuma validação duplicada na
-- função, mas o resultado (rejeição) deve se manter.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_status text;
  v_details text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
    select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.10',
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.10', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );

    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, null, null, null, 0, 0, null,
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.10 negativo', 'quantity', -1, 'unit_price', 10.00)),
      v_user_id
    );

    v_status := 'FAIL';
    v_details := 'update_quote_order aceitou quantity negativa (não deveria)';
  exception when others then
    v_status := 'PASS';
    v_details := sqlerrm;
  end;

  insert into zz_test_results(section, test_name, status, details)
    values ('13', '13.10 update_quote_order rejeita quantity/unit_price inválidos (CHECK de order_items)', v_status, v_details);
end $$;

-- 13.11 Permissões e search_path seguros: anon/authenticated sem EXECUTE;
-- só service_role. search_path vazio.
do $$
declare
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
  v_search_path_raw text;
begin
  begin
    select has_function_privilege('anon', 'public.update_quote_order(uuid,uuid,uuid,uuid,text,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_anon_can_execute;
    select has_function_privilege('authenticated', 'public.update_quote_order(uuid,uuid,uuid,uuid,text,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
    select has_function_privilege('service_role', 'public.update_quote_order(uuid,uuid,uuid,uuid,text,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;

    select setting into v_search_path_raw
      from pg_proc, unnest(proconfig) as setting
      where pronamespace = 'public'::regnamespace and proname = 'update_quote_order'
        and setting like 'search_path=%';

    if v_anon_can_execute or v_authenticated_can_execute or not v_service_role_can_execute then
      raise exception 'permissões inesperadas: anon=%, authenticated=%, service_role=%', v_anon_can_execute, v_authenticated_can_execute, v_service_role_can_execute;
    end if;
    if v_search_path_raw is null or trim(both '"' from substring(v_search_path_raw from 13)) <> '' then
      raise exception 'search_path deveria ser vazio, veio: %', v_search_path_raw;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('13', '13.11 update_quote_order: anon/authenticated sem EXECUTE, só service_role; search_path vazio', 'PASS', 'ok');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('13', '13.11 update_quote_order: anon/authenticated sem EXECUTE, só service_role; search_path vazio', 'FAIL', sqlerrm);
  end;
end $$;

-- 13.12 Dependência inesperada (approval vinculado a um item atual) bloqueia
-- a substituição de itens e provoca rollback total — nenhuma exclusão em
-- cascata é introduzida.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_item_count_after integer;
  v_status text;
  v_details text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'pedido teste 13.12 (item com approval vinculado)',
    jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.12 com approval', 'quantity', 1, 'unit_price', 10.00)),
    v_user_id
  );
  select id into v_item_id from public.order_items where order_id = v_order_id;

  -- Vínculo deliberadamente "fora do fluxo normal" (approvals hoje só
  -- deveria existir para itens CUSTOM/SPOT) — exatamente o cenário que a
  -- checagem explícita da função precisa capturar, mesmo sem depender do
  -- item_type sozinho.
  insert into public.approvals (order_item_id, approval_type, approved_at, created_by)
    values (v_item_id, 'OTHER', now(), v_user_id);

  begin
    perform public.update_quote_order(
      v_order_id, v_customer_id, null, null, null, null, null, 0, 0, null,
      jsonb_build_array(jsonb_build_object('item_type', 'CATALOG', 'product_id', v_product_id, 'item_name', 'Item 13.12 substituto', 'quantity', 1, 'unit_price', 10.00)),
      v_user_id
    );
    v_status := 'FAIL';
    v_details := 'update_quote_order substituiu um item com approval vinculado (não deveria)';
  exception when others then
    if sqlerrm like '%histórico de versão/aprovação vinculado%' then
      select count(*) into v_item_count_after from public.order_items where id = v_item_id;
      if v_item_count_after <> 1 then
        v_status := 'FAIL';
        v_details := 'exceção correta ocorreu, mas o item original não sobreviveu ao rollback (item_count=' || v_item_count_after || ')';
      else
        v_status := 'PASS';
        v_details := sqlerrm;
      end if;
    else
      v_status := 'FAIL';
      v_details := 'esperada mensagem de bloqueio por dependência, veio outra exceção: ' || sqlerrm;
    end if;
  end;

  insert into zz_test_results(section, test_name, status, details)
    values ('13', '13.12 update_quote_order recusa substituir item com approval vinculado, com rollback total (sem cascata)', v_status, v_details);
end $$;

-- =============================================================================
-- RESULTADO FINAL + ROLLBACK
-- =============================================================================

-- =============================================================================
-- RESULTADO FINAL + ROLLBACK
-- =============================================================================

select section, test_name, status, details
from zz_test_results
order by seq;

rollback;
