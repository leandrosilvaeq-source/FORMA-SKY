-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário), Incremento 5 — TESTE DE
-- INTEGRAÇÃO do fluxo de Compras (inventory_purchases/register_inventory_purchase)
-- =============================================================================
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Mesmo padrão e estrutura de
-- supabase/tests/inventory_movements_test.sql e
-- supabase/tests/filament_inventory_test.sql: roda inteiro dentro de UMA
-- ÚNICA transação, terminada sempre com ROLLBACK — nenhum dado criado por
-- este script persiste no banco.
--
-- Execução prevista (depois que as duas migrations desta rodada —
-- 20260828120000_create_inventory_purchases_table.sql e
-- 20260828121000_create_register_inventory_purchase_function.sql — forem
-- aplicadas ao projeto remoto, com autorização explícita separada; NÃO
-- aplicadas nesta rodada):
--   npx supabase db query --linked --file supabase/tests/inventory_purchases_test.sql
--
-- LIMITAÇÃO CONHECIDA (mesma já registrada nos dois arquivos irmãos): uma
-- única transação/conexão não pode exercitar concorrência real de duas
-- sessões — a Seção 7 (idempotência) testa só o caminho antecipado (a
-- checagem antes de qualquer trabalho pesado); o caso residual de duas
-- chamadas concorrentes com a MESMA chave é coberto só por leitura de código
-- (mesmo raciocínio já documentado no cabeçalho da migration
-- 20260828121000). A Seção 8 (atomicidade) É exercitável dentro de uma
-- transação só, porque não depende de concorrência — só de uma falha no
-- MEIO de uma chamada já em andamento, que o próprio savepoint implícito do
-- bloco DO/EXCEPTION reverte sozinho.
--
-- Nenhum destes testes foi executado nesta sessão: o ambiente não tem
-- Docker/Postgres local, e a aplicação remota das duas migrations desta
-- rodada não foi autorizada. Este arquivo foi revisado linha a linha contra
-- as duas migrations; sua execução real fica pendente — ver relatório final.

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
  v_accessory_active_id uuid;
  v_accessory_inactive_id uuid;
  v_packaging_active_id uuid;
begin
  begin
    select id into v_user_id from public.users where is_active limit 1;
    if v_user_id is null then raise exception 'nenhum usuário ativo encontrado em public.users'; end if;

    v_accessory_active_id := (public.create_accessory(
      'TESTE COMPRAS — Acessório ativo', null, null, null, true, v_user_id
    )).id;
    v_accessory_inactive_id := (public.create_accessory(
      'TESTE COMPRAS — Acessório inativo', null, null, null, false, v_user_id
    )).id;
    v_packaging_active_id := (public.create_packaging(
      'TESTE COMPRAS — Embalagem ativa', null, null, null, true, v_user_id
    )).id;

    insert into zz_fixtures(key, value) values
      ('user_id', v_user_id::text),
      ('accessory_active_id', v_accessory_active_id::text),
      ('accessory_inactive_id', v_accessory_inactive_id::text),
      ('packaging_active_id', v_packaging_active_id::text)
    on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 setup: usuário ativo + acessório ativo/inativo + embalagem ativa', 'PASS',
        'user_id=' || v_user_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 setup', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 1 — Compra de ACESSÓRIO
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_stock_before integer;
  v_purchase public.inventory_purchases;
  v_movement_count integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_active_id';
  begin
    select current_stock into v_stock_before from public.accessories where id = v_accessory_id;

    v_purchase := public.register_inventory_purchase(
      p_category => 'ACCESSORY', p_quantity => 5, p_item_value => 100.00, p_freight_value => 10.00,
      p_changed_by => v_user_id, p_item_id => v_accessory_id
    );

    select count(*) into v_movement_count
      from public.stock_movements
      where item_type = 'ACCESSORY' and item_id = v_accessory_id
        and movement_type = 'PURCHASE' and reference_type = 'PURCHASE' and reference_id = v_purchase.id
        and quantity_delta = 5;

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1 compra de acessório: purchase.total_value=110.00, current_stock +5, stock_movement PURCHASE vinculado por reference_id',
        case
          when v_purchase.total_value = 110.00
            and v_purchase.category = 'ACCESSORY'
            and v_purchase.item_id = v_accessory_id
            and (select current_stock from public.accessories where id = v_accessory_id) = v_stock_before + 5
            and v_movement_count = 1
          then 'PASS' else 'FAIL'
        end,
        'total_value=' || v_purchase.total_value || ' movement_count=' || v_movement_count);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1 compra de acessório (sucesso)', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_inactive_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_inactive_id from zz_fixtures where key = 'accessory_inactive_id';
  begin
    -- Postgres não aceita a palavra-chave DEFAULT como argumento posicional
    -- de chamada de função (só é válida em INSERT ... VALUES) — notação
    -- nomeada, omitindo os parâmetros que devem usar o próprio default da
    -- function.
    perform public.register_inventory_purchase(
      p_category => 'ACCESSORY', p_quantity => 1, p_item_value => 10, p_freight_value => 0,
      p_changed_by => v_user_id, p_item_id => v_accessory_inactive_id
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.2 compra bloqueada para acessório inativo', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.2 compra bloqueada para acessório inativo',
        case when sqlerrm like 'INVENTORY_PURCHASE_ITEM_INACTIVE:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    perform public.register_inventory_purchase(
      p_category => 'ACCESSORY', p_quantity => 1, p_item_value => 10, p_freight_value => 0,
      p_changed_by => v_user_id, p_item_id => gen_random_uuid()
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.3 compra bloqueada para acessório inexistente', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.3 compra bloqueada para acessório inexistente',
        case when sqlerrm like 'INVENTORY_PURCHASE_ITEM_INACTIVE:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_active_id';
  begin
    perform public.register_inventory_purchase(
      p_category => 'ACCESSORY', p_quantity => 0, p_item_value => 10, p_freight_value => 0,
      p_changed_by => v_user_id, p_item_id => v_accessory_id
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.4 quantity=0 rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.4 quantity=0 rejeitado',
        case when sqlerrm like 'register_inventory_purchase: p_quantity deve ser%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_active_id';
  begin
    perform public.register_inventory_purchase(
      p_category => 'ACCESSORY', p_quantity => 1, p_item_value => -10, p_freight_value => 0,
      p_changed_by => v_user_id, p_item_id => v_accessory_id
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.5 item_value negativo rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.5 item_value negativo rejeitado',
        case when sqlerrm like 'register_inventory_purchase: p_item_value%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_active_id';
  begin
    perform public.register_inventory_purchase(
      p_category => 'ACCESSORY', p_quantity => 1, p_item_value => 10, p_freight_value => -5,
      p_changed_by => v_user_id, p_item_id => v_accessory_id
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.6 freight_value negativo rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.6 freight_value negativo rejeitado',
        case when sqlerrm like 'register_inventory_purchase: p_freight_value%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 2 — Compra de EMBALAGEM (mesmas regras de Acessório)
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_stock_before integer;
  v_purchase public.inventory_purchases;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_active_id';
  begin
    select current_stock into v_stock_before from public.packaging where id = v_packaging_id;

    v_purchase := public.register_inventory_purchase(
      p_category => 'PACKAGING', p_quantity => 3, p_item_value => 30.00, p_freight_value => 0,
      p_changed_by => v_user_id, p_item_id => v_packaging_id
    );

    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.1 compra de embalagem: total_value=30.00, current_stock +3',
        case
          when v_purchase.total_value = 30.00
            and (select current_stock from public.packaging where id = v_packaging_id) = v_stock_before + 3
          then 'PASS' else 'FAIL'
        end, 'total_value=' || v_purchase.total_value);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.1 compra de embalagem (sucesso)', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_packaging_inactive_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  v_packaging_inactive_id := (public.create_packaging('TESTE COMPRAS — Embalagem inativa', null, null, null, false, v_user_id)).id;
  begin
    perform public.register_inventory_purchase(
      p_category => 'PACKAGING', p_quantity => 1, p_item_value => 10, p_freight_value => 0,
      p_changed_by => v_user_id, p_item_id => v_packaging_inactive_id
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.2 compra bloqueada para embalagem inativa', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.2 compra bloqueada para embalagem inativa',
        case when sqlerrm like 'INVENTORY_PURCHASE_ITEM_INACTIVE:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 3 — Compra de FILAMENTO: cria tipo novo + N rolos
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_purchase public.inventory_purchases;
  v_type public.filament_types;
  v_spool_count integer;
  v_movement_count integer;
  v_bad_spool_count integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    v_purchase := public.register_inventory_purchase(
      p_category => 'FILAMENT', p_quantity => 2, p_item_value => 200.00, p_freight_value => 20.00,
      p_changed_by => v_user_id, p_material => 'PLA', p_manufacturer => 'TESTE COMPRAS Voolt3D',
      p_line => 'Sólida', p_commercial_color => 'Preto', p_nominal_weight_grams => 1000,
      p_gross_weights_grams => array[1150, 1140]
    );

    select * into v_type from public.filament_types where id = v_purchase.item_id;

    select count(*) into v_spool_count
      from public.filament_spools
      where purchase_id = v_purchase.id and filament_type_id = v_type.id
        and status = 'LACRADO' and is_active and nominal_weight_grams = 1000;

    select count(*) into v_bad_spool_count
      from public.filament_spools
      where purchase_id = v_purchase.id
        and not (
          (initial_gross_weight_grams = 1150 and empty_spool_weight_grams = 150 and current_net_weight_grams = 1000)
          or (initial_gross_weight_grams = 1140 and empty_spool_weight_grams = 140 and current_net_weight_grams = 1000)
        );

    select count(*) into v_movement_count
      from public.filament_movements fm
      join public.filament_spools fs on fs.id = fm.spool_id
      where fs.purchase_id = v_purchase.id
        and fm.movement_type = 'PURCHASE' and fm.quantity_delta = 1000 and fm.balance_after = 1000
        and fm.reference_type = 'PURCHASE' and fm.reference_id = v_purchase.id;

    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.1 compra de filamento (tipo novo): cria filament_type sem color_code, 2 rolos com tara estimada correta, saldo inicial = nominal, 2 movimentos PURCHASE vinculados',
        case
          when v_type.color_code is null
            and v_type.material = 'PLA' and v_type.is_active
            and v_purchase.category = 'FILAMENT' and v_purchase.total_value = 220.00
            and v_spool_count = 2 and v_bad_spool_count = 0 and v_movement_count = 2
          then 'PASS' else 'FAIL'
        end,
        'spool_count=' || v_spool_count || ' bad_spool_count=' || v_bad_spool_count || ' movement_count=' || v_movement_count);

    insert into zz_fixtures(key, value) values ('filament_type_id', v_type.id::text)
      on conflict (key) do update set value = excluded.value;
    insert into zz_fixtures(key, value) values ('filament_purchase_id', v_purchase.id::text)
      on conflict (key) do update set value = excluded.value;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.1 compra de filamento (tipo novo)', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 4 — Compra de FILAMENTO: reaproveita tipo ativo já existente
-- (normalizado, case/espaço-insensível) — nunca cria duplicata
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_purchase public.inventory_purchases;
  v_type_count integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_id from zz_fixtures where key = 'filament_type_id';
  begin
    v_purchase := public.register_inventory_purchase(
      p_category => 'FILAMENT', p_quantity => 1, p_item_value => 100.00, p_freight_value => 0,
      p_changed_by => v_user_id, p_material => 'PLA', p_manufacturer => '  teste compras voolt3d  ',
      p_line => 'SÓLIDA', p_commercial_color => '  preto  ', p_nominal_weight_grams => 1000,
      p_gross_weights_grams => array[1120]
    );

    select count(*) into v_type_count
      from public.filament_types
      where material = 'PLA'
        and lower(btrim(manufacturer)) = 'teste compras voolt3d'
        and lower(btrim(line)) = 'sólida'
        and lower(btrim(commercial_color)) = 'preto';

    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.1 mesma combinação (maiúsculas/espaços diferentes) reaproveita o tipo — nunca cria duplicata',
        case when v_purchase.item_id = v_type_id and v_type_count = 1 then 'PASS' else 'FAIL' end,
        'purchase.item_id=' || v_purchase.item_id || ' expected=' || v_type_id || ' type_count=' || v_type_count);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.1 reaproveita tipo existente (normalizado)', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 5 — Compra de FILAMENTO: correspondência só com tipo INATIVO nunca
-- reativa nem usa silenciosamente
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_inactive_type_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    v_inactive_type_id := (public.create_filament_type(
      'PETG', 'TESTE COMPRAS Inativo', 'Sólida', 'Azul', null, null, false, null, v_user_id
    )).id;
    insert into zz_fixtures(key, value) values ('inactive_filament_type_id', v_inactive_type_id::text)
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.0 setup: tipo de filamento inativo pré-existente', 'PASS', 'type_id=' || v_inactive_type_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.0 setup', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_inactive_type_id uuid;
  v_spool_count_before integer;
  v_spool_count_after integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_inactive_type_id from zz_fixtures where key = 'inactive_filament_type_id';
  select count(*) into v_spool_count_before from public.filament_spools where filament_type_id = v_inactive_type_id;
  begin
    perform public.register_inventory_purchase(
      p_category => 'FILAMENT', p_quantity => 1, p_item_value => 100.00, p_freight_value => 0,
      p_changed_by => v_user_id, p_material => 'PETG', p_manufacturer => 'TESTE COMPRAS Inativo',
      p_line => 'Sólida', p_commercial_color => 'Azul', p_nominal_weight_grams => 1000,
      p_gross_weights_grams => array[1100]
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 compra bloqueada quando só existe correspondência inativa — nunca reativa em silêncio', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_spool_count_after from public.filament_spools where filament_type_id = v_inactive_type_id;
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 compra bloqueada quando só existe correspondência inativa — nunca reativa em silêncio',
        case
          when sqlerrm like 'FILAMENT_TYPE_INACTIVE_MATCH:%'
            and not (select is_active from public.filament_types where id = v_inactive_type_id)
            and v_spool_count_after = v_spool_count_before
          then 'PASS' else 'FAIL'
        end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 6 — Validações estruturais (defesa em profundidade da RPC)
-- =============================================================================

do $$
declare
  v_user_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    perform public.register_inventory_purchase(
      p_category => 'FILAMENT', p_quantity => 1, p_item_value => 10, p_freight_value => 0,
      p_changed_by => v_user_id, p_material => 'PLA', p_manufacturer => 'X', p_line => 'Y',
      p_commercial_color => 'Z', p_nominal_weight_grams => 1000, p_gross_weights_grams => array[1000]
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.1 peso bruto igual ao nominal é rejeitado (deve ser estritamente maior)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.1 peso bruto igual ao nominal é rejeitado',
        case when sqlerrm like 'register_inventory_purchase: peso bruto do rolo%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    perform public.register_inventory_purchase(
      p_category => 'FILAMENT', p_quantity => 2, p_item_value => 10, p_freight_value => 0,
      p_changed_by => v_user_id, p_material => 'PLA', p_manufacturer => 'X', p_line => 'Y',
      p_commercial_color => 'Z', p_nominal_weight_grams => 1000, p_gross_weights_grams => array[1100]
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.2 quantidade de pesos brutos diferente de quantity é rejeitada', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.2 quantidade de pesos brutos diferente de quantity é rejeitada',
        case when sqlerrm like 'register_inventory_purchase: informe exatamente%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    perform public.register_inventory_purchase(
      p_category => 'FILAMENT', p_quantity => 1, p_item_value => 10, p_freight_value => 0,
      p_changed_by => v_user_id, p_material => 'ABS', p_manufacturer => 'X', p_line => 'Y',
      p_commercial_color => 'Z', p_nominal_weight_grams => 1000, p_gross_weights_grams => array[1100]
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.3 material ABS é rejeitado (fora do MVP aprovado)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.3 material ABS é rejeitado',
        case when sqlerrm like '%material inválido%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_type_id uuid;
begin
  select value::uuid into v_type_id from zz_fixtures where key = 'filament_type_id';
  begin
    -- Defesa em profundidade na própria tabela (auditoria 2026-08-28):
    -- mesmo contornando a RPC com um INSERT direto (só alcançável nesta
    -- sessão porque roda com privilégios de owner/service via `db query`,
    -- nunca por authenticated — sem grant de INSERT), a CHECK entre colunas
    -- ainda bloqueia peso bruto <= peso nominal.
    insert into public.filament_spools (code, filament_type_id, nominal_weight_grams, initial_gross_weight_grams)
    values ('RL-TESTE-CHECK', v_type_id, 1000, 900);
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.4 CHECK de tabela bloqueia initial_gross_weight_grams <= nominal_weight_grams mesmo via INSERT direto', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.4 CHECK de tabela bloqueia initial_gross_weight_grams <= nominal_weight_grams mesmo via INSERT direto',
        case when sqlstate = '23514' and sqlerrm like '%filament_spools_initial_gross_weight_exceeds_nominal%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 7 — Idempotência
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_first public.inventory_purchases;
  v_second public.inventory_purchases;
  v_purchase_count integer;
  v_movement_count integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_active_id';
  begin
    v_first := public.register_inventory_purchase(
      p_category => 'ACCESSORY', p_quantity => 2, p_item_value => 20, p_freight_value => 0,
      p_changed_by => v_user_id, p_idempotency_key => 'teste-compras-idempotencia-1',
      p_item_id => v_accessory_id
    );
    v_second := public.register_inventory_purchase(
      p_category => 'ACCESSORY', p_quantity => 2, p_item_value => 20, p_freight_value => 0,
      p_changed_by => v_user_id, p_idempotency_key => 'teste-compras-idempotencia-1',
      p_item_id => v_accessory_id
    );

    select count(*) into v_purchase_count from public.inventory_purchases where idempotency_key = 'teste-compras-idempotencia-1';
    select count(*) into v_movement_count from public.stock_movements where reference_type = 'PURCHASE' and reference_id = v_first.id;

    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.1 reenviar a MESMA idempotency_key com o MESMO payload devolve a mesma compra, sem duplicar linha nem movimento',
        case when v_first.id = v_second.id and v_purchase_count = 1 and v_movement_count = 1 then 'PASS' else 'FAIL' end,
        'first=' || v_first.id || ' second=' || v_second.id || ' purchase_count=' || v_purchase_count || ' movement_count=' || v_movement_count);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.1 idempotência (mesmo payload)', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_active_id';
  begin
    -- Mesma chave da 7.1, payload diferente (quantidade 9 em vez de 2).
    perform public.register_inventory_purchase(
      p_category => 'ACCESSORY', p_quantity => 9, p_item_value => 20, p_freight_value => 0,
      p_changed_by => v_user_id, p_idempotency_key => 'teste-compras-idempotencia-1',
      p_item_id => v_accessory_id
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2 reenviar a MESMA idempotency_key com payload DIFERENTE é rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2 reenviar a MESMA idempotency_key com payload DIFERENTE é rejeitado',
        case when sqlerrm like 'IDEMPOTENCY_KEY_CONFLICT:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 8 — Atomicidade: uma falha no meio de uma compra de filamento
-- (segundo rolo) não deixa nenhum resíduo (nem o primeiro rolo, nem a
-- compra) — a função inteira é uma única transação.
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_count_before integer;
  v_spool_count_before integer;
  v_purchase_count_before integer;
  v_type_count_after integer;
  v_spool_count_after integer;
  v_purchase_count_after integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

  select count(*) into v_type_count_before from public.filament_types where manufacturer = 'TESTE COMPRAS Atomicidade';
  select count(*) into v_spool_count_before
    from public.filament_spools fs join public.filament_types ft on ft.id = fs.filament_type_id
    where ft.manufacturer = 'TESTE COMPRAS Atomicidade';
  select count(*) into v_purchase_count_before from public.inventory_purchases where idempotency_key = 'teste-compras-atomicidade';

  begin
    -- Pré-insere (fora do fluxo normal, só para forçar a colisão) uma
    -- filament_movements com a MESMA chave que o SEGUNDO rolo desta compra
    -- usaria internamente ('<key>:spool:2') — register_filament_movement
    -- vai rejeitar essa chamada com IDEMPOTENCY_KEY_CONFLICT: (payload
    -- necessariamente diferente, porque aponta para outro spool_id), o que
    -- propaga como falha de TODA a chamada a register_inventory_purchase.
    insert into public.filament_movements (
      filament_type_id, spool_id, movement_type, quantity_delta, balance_before, balance_after,
      idempotency_key, created_by
    )
    select ft.id, fs.id, 'PURCHASE', 1, 0, 1, 'teste-compras-atomicidade:spool:2', v_user_id
    from public.filament_types ft
    join public.filament_spools fs on fs.filament_type_id = ft.id
    limit 1;

    perform public.register_inventory_purchase(
      p_category => 'FILAMENT', p_quantity => 2, p_item_value => 10, p_freight_value => 0,
      p_changed_by => v_user_id, p_idempotency_key => 'teste-compras-atomicidade',
      p_material => 'PLA', p_manufacturer => 'TESTE COMPRAS Atomicidade', p_line => 'Sólida',
      p_commercial_color => 'Verde', p_nominal_weight_grams => 1000, p_gross_weights_grams => array[1100, 1100]
    );

    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.1 falha no segundo rolo desfaz TODA a compra (tipo/primeiro rolo incluídos)', 'FAIL', 'não levantou exceção — a colisão de idempotency_key deveria ter bloqueado o segundo rolo');
  exception when others then
    select count(*) into v_type_count_after from public.filament_types where manufacturer = 'TESTE COMPRAS Atomicidade';
    select count(*) into v_spool_count_after
      from public.filament_spools fs join public.filament_types ft on ft.id = fs.filament_type_id
      where ft.manufacturer = 'TESTE COMPRAS Atomicidade';
    select count(*) into v_purchase_count_after from public.inventory_purchases where idempotency_key = 'teste-compras-atomicidade';

    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.1 falha no segundo rolo desfaz TODA a compra (tipo/primeiro rolo incluídos)',
        case
          when v_type_count_after = v_type_count_before
            and v_spool_count_after = v_spool_count_before
            and v_purchase_count_after = v_purchase_count_before
          then 'PASS' else 'FAIL'
        end,
        'types_before=' || v_type_count_before || ' types_after=' || v_type_count_after ||
        ' spools_before=' || v_spool_count_before || ' spools_after=' || v_spool_count_after ||
        ' purchases_before=' || v_purchase_count_before || ' purchases_after=' || v_purchase_count_after ||
        ' err=' || sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 9 — Regressão: fluxos manuais existentes continuam funcionando
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_spool_id uuid;
  v_movement public.filament_movements;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    -- create_filament_spool/register_filament_movement continuam
    -- utilizáveis diretamente (fluxo "Novo rolo" do drawer, inalterado por
    -- este incremento) — o rolo criado assim tem purchase_id/
    -- initial_gross_weight_grams em null, nunca populados por esse caminho.
    select value::uuid into v_type_id from zz_fixtures where key = 'filament_type_id';
    v_spool_id := (public.create_filament_spool(v_type_id, 500, null, null, null, null, true, v_user_id)).id;
    v_movement := public.register_filament_movement(v_spool_id, 'INITIAL_BALANCE', 500, v_user_id);

    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.1 fluxo manual (create_filament_spool + register_filament_movement) continua funcionando, purchase_id/initial_gross_weight_grams ficam null',
        case
          when v_movement.balance_after = 500
            and (select purchase_id from public.filament_spools where id = v_spool_id) is null
            and (select initial_gross_weight_grams from public.filament_spools where id = v_spool_id) is null
          then 'PASS' else 'FAIL'
        end, 'balance_after=' || v_movement.balance_after);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.1 fluxo manual de rolo continua funcionando', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 10 — Imutabilidade do histórico e privilégios (RLS/grants)
-- =============================================================================

do $$
begin
  begin
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.1a authenticated TEM SELECT em inventory_purchases',
        case when has_table_privilege('authenticated', 'public.inventory_purchases', 'SELECT') then 'PASS' else 'FAIL' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.1b authenticated NÃO tem INSERT em inventory_purchases (só via RPC)',
        case when has_table_privilege('authenticated', 'public.inventory_purchases', 'INSERT') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.1c authenticated NÃO tem UPDATE em inventory_purchases',
        case when has_table_privilege('authenticated', 'public.inventory_purchases', 'UPDATE') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.1d authenticated NÃO tem DELETE em inventory_purchases',
        case when has_table_privilege('authenticated', 'public.inventory_purchases', 'DELETE') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.1e anon NÃO tem SELECT em inventory_purchases',
        case when has_table_privilege('anon', 'public.inventory_purchases', 'SELECT') then 'FAIL' else 'PASS' end, null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.x checagens de privilégio', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- Resultado final
-- =============================================================================

select
  count(*) filter (where status = 'PASS') as total_pass,
  count(*) filter (where status = 'FAIL') as total_fail,
  count(*) filter (where status = 'SKIP') as total_skip,
  count(*) as total
from zz_test_results;

select * from zz_test_results order by seq;

rollback;
