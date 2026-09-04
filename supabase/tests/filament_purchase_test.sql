-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- TESTE DE INTEGRAÇÃO da Compra de Filamentos com MÚLTIPLOS itens (2026-09-04,
-- migration 20260904130000_support_multi_item_filament_purchases.sql) —
-- register_filament_purchase + inventory_purchase_filament_items. A Seção 8
-- cobre a migration seguinte da mesma rodada (reorganização compacta da
-- janela, 20260904140000_add_purchase_channel_to_filament_purchases.sql):
-- purchase_channel obrigatório, fechado aos 4 valores, persistido e
-- comparado pela idempotência — todas as chamadas das Seções 1–5 (já
-- existentes) foram atualizadas para informar p_purchase_channel, já que a
-- RPC passou a exigi-lo.
-- =============================================================================
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Mesmo padrão de
-- supabase/tests/inventory_purchases_test.sql: roda inteiro dentro de UMA
-- ÚNICA transação, terminada sempre com ROLLBACK — nenhum dado criado por
-- este script persiste no banco.
--
-- Execução:
--   npx supabase db query --linked --file supabase/tests/filament_purchase_test.sql
--
-- Este arquivo cobre só a RPC NOVA (register_filament_purchase) e a tabela
-- nova (inventory_purchase_filament_items). O fluxo antigo de item único
-- (register_inventory_purchase — ACCESSORY/PACKAGING e FILAMENT de item
-- único, por nome ou por filament_type_id) continua coberto integralmente
-- por inventory_purchases_test.sql, sem nenhuma alteração — a Seção 6 deste
-- arquivo só faz uma checagem de regressão rápida (o caminho antigo continua
-- funcionando depois da migration desta rodada).
--
-- LIMITAÇÃO CONHECIDA (mesma já registrada nos arquivos irmãos): uma única
-- transação/conexão não pode exercitar concorrência real de duas sessões —
-- a Seção 4 (idempotência) testa só o caminho antecipado. A Seção 5
-- (atomicidade) É exercitável dentro de uma transação só, porque não
-- depende de concorrência — só de uma falha no MEIO de uma chamada já em
-- andamento, revertida pelo savepoint implícito do bloco DO/EXCEPTION.

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
  v_type_a_id uuid;
  v_type_b_id uuid;
  v_type_inactive_id uuid;
begin
  begin
    select id into v_user_id from public.users where is_active limit 1;
    if v_user_id is null then raise exception 'nenhum usuário ativo encontrado em public.users'; end if;

    v_type_a_id := (public.create_filament_type(
      'PLA', 'Não informado', 'Matte', 'Preto', null, null, true, null, v_user_id
    )).id;
    v_type_b_id := (public.create_filament_type(
      'PLA', 'Não informado', 'Silk', 'Dourado', null, null, true, null, v_user_id
    )).id;
    v_type_inactive_id := (public.create_filament_type(
      'PETG', 'Não informado', 'Sólida', 'Transparente', null, null, false, null, v_user_id
    )).id;

    insert into zz_fixtures(key, value) values
      ('user_id', v_user_id::text),
      ('type_a_id', v_type_a_id::text),
      ('type_b_id', v_type_b_id::text),
      ('type_inactive_id', v_type_inactive_id::text)
    on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 setup: usuário ativo + 2 tipos ativos (Matte Preto / Silk Dourado) + 1 tipo inativo', 'PASS',
        'type_a=' || v_type_a_id || ' type_b=' || v_type_b_id || ' type_inactive=' || v_type_inactive_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 setup', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 1 — Sucesso: compra com 2 itens (tipos e marcas diferentes) cria UM
-- único cabeçalho, os 2 itens e os 3 rolos correspondentes (exemplo do
-- pedido: PLA Matte Preto x2 da Bambu Lab + PLA Silk Dourado x1 da Voolt).
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_a_id uuid;
  v_type_b_id uuid;
  v_type_count_before integer;
  v_result jsonb;
  v_purchase_id uuid;
  v_purchase public.inventory_purchases;
  v_item_count integer;
  v_spool_count integer;
  v_type_count_after integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_a_id from zz_fixtures where key = 'type_a_id';
  select value::uuid into v_type_b_id from zz_fixtures where key = 'type_b_id';
  select count(*) into v_type_count_before from public.filament_types;

  begin
    v_result := public.register_filament_purchase(
      p_freight_value => 30.00,
      p_changed_by => v_user_id,
      p_items => jsonb_build_array(
        jsonb_build_object(
          'filament_type_id', v_type_a_id, 'manufacturer', 'Bambu Lab',
          'nominal_weight_grams', 1000, 'quantity', 2, 'unit_value', 95.00
        ),
        jsonb_build_object(
          'filament_type_id', v_type_b_id, 'manufacturer', 'Voolt',
          'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 110.00
        )
      ),
      p_idempotency_key => 'teste-compra-multi-1',
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    v_purchase_id := (v_result ->> 'purchase_id')::uuid;
    select * into v_purchase from public.inventory_purchases where id = v_purchase_id;
    select count(*) into v_item_count from public.inventory_purchase_filament_items where purchase_id = v_purchase_id;
    select count(*) into v_spool_count from public.filament_spools where purchase_id = v_purchase_id;
    select count(*) into v_type_count_after from public.filament_types;

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1 um único cabeçalho criado (item_id null, category=FILAMENT)',
        case when v_purchase.item_id is null and v_purchase.category = 'FILAMENT' then 'PASS' else 'FAIL' end,
        'item_id=' || coalesce(v_purchase.item_id::text, 'null'));

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.2 quantity do cabeçalho = soma das quantidades dos itens (2+1=3)',
        case when v_purchase.quantity = 3 then 'PASS' else 'FAIL' end, 'quantity=' || v_purchase.quantity);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.3 subtotal (item_value) = soma de quantidade×valor unitário (2×95 + 1×110 = 300)',
        case when v_purchase.item_value = 300.00 then 'PASS' else 'FAIL' end, 'item_value=' || v_purchase.item_value);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.4 frete registrado uma única vez no cabeçalho (30.00)',
        case when v_purchase.freight_value = 30.00 then 'PASS' else 'FAIL' end, 'freight_value=' || v_purchase.freight_value);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.5 total = subtotal + frete (300 + 30 = 330, coluna gerada)',
        case when v_purchase.total_value = 330.00 then 'PASS' else 'FAIL' end, 'total_value=' || v_purchase.total_value);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.6 exatamente 2 itens criados, vinculados ao cabeçalho',
        case when v_item_count = 2 then 'PASS' else 'FAIL' end, 'item_count=' || v_item_count);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.7 exatamente 3 rolos criados (2 do item A + 1 do item B), soma correta',
        case when v_spool_count = 3 then 'PASS' else 'FAIL' end, 'spool_count=' || v_spool_count);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.8 nenhum filament_type novo foi criado durante a compra',
        case when v_type_count_after = v_type_count_before then 'PASS' else 'FAIL' end,
        'types_before=' || v_type_count_before || ' types_after=' || v_type_count_after);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.9 cada rolo do item A fica no tipo A, com a marca/peso do item A (via purchase_item_id)',
        case when (
          select count(*) from public.filament_spools s
          join public.inventory_purchase_filament_items it on it.id = s.purchase_item_id
          where s.purchase_id = v_purchase_id and it.filament_type_id = v_type_a_id
            and it.manufacturer = 'Bambu Lab' and s.nominal_weight_grams = 1000
            and s.filament_type_id = v_type_a_id
        ) = 2 then 'PASS' else 'FAIL' end, null);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.10 o rolo do item B fica no tipo B, com a marca/peso do item B',
        case when (
          select count(*) from public.filament_spools s
          join public.inventory_purchase_filament_items it on it.id = s.purchase_item_id
          where s.purchase_id = v_purchase_id and it.filament_type_id = v_type_b_id
            and it.manufacturer = 'Voolt' and s.nominal_weight_grams = 1000
            and s.filament_type_id = v_type_b_id
        ) = 1 then 'PASS' else 'FAIL' end, null);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.11 nenhum rolo pede/recebe peso bruto individual (empty_spool_weight_grams e initial_gross_weight_grams ficam null)',
        case when (
          select count(*) from public.filament_spools
          where purchase_id = v_purchase_id
            and (empty_spool_weight_grams is not null or initial_gross_weight_grams is not null)
        ) = 0 then 'PASS' else 'FAIL' end, null);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.12 cada rolo inicia com o peso líquido informado (current_net_weight_grams = nominal, via register_filament_movement)',
        case when (
          select count(*) from public.filament_spools
          where purchase_id = v_purchase_id and current_net_weight_grams <> nominal_weight_grams
        ) = 0 then 'PASS' else 'FAIL' end, null);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.13 item_value de cada item = quantity×unit_value (coluna gerada)',
        case when (
          select count(*) from public.inventory_purchase_filament_items
          where purchase_id = v_purchase_id and item_value <> quantity * unit_value
        ) = 0 then 'PASS' else 'FAIL' end, null);

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.14 purchase_channel do cabeçalho é gravado como o valor informado (MERCADO_LIVRE)',
        case when v_purchase.purchase_channel = 'MERCADO_LIVRE' then 'PASS' else 'FAIL' end,
        'purchase_channel=' || coalesce(v_purchase.purchase_channel, 'null'));

    insert into zz_fixtures(key, value) values ('success_purchase_id', v_purchase_id::text)
      on conflict (key) do update set value = excluded.value;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.x compra multi-item bem-sucedida', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 2 — Validação estrutural: cada erro rejeita ANTES de criar qualquer
-- coisa (cabeçalho/item/rolo).
-- =============================================================================

-- Cada checagem é um bloco begin/exception independente (mesmo estilo do
-- resto do arquivo — PL/pgSQL de um bloco DO não suporta procedure/function
-- aninhada na própria declare section, por isso nenhum helper compartilhado
-- é usado aqui). Todas comparam a contagem de inventory_purchases antes/
-- depois: um payload inválido em QUALQUER ponto nunca cria nada.

do $$
declare
  v_user_id uuid;
  v_type_a_id uuid;
  v_purchase_count_before integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_a_id from zz_fixtures where key = 'type_a_id';

  select count(*) into v_purchase_count_before from public.inventory_purchases;
  begin
    perform public.register_filament_purchase(
      p_freight_value => -1, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'filament_type_id', v_type_a_id, 'manufacturer', 'X', 'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 10
      )),
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.1 frete negativo rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.1 frete negativo rejeitado',
      case when (select count(*) from public.inventory_purchases) = v_purchase_count_before then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  select count(*) into v_purchase_count_before from public.inventory_purchases;
  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id, p_items => '[]'::jsonb,
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.2 lista de itens vazia rejeitada', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.2 lista de itens vazia rejeitada',
      case when (select count(*) from public.inventory_purchases) = v_purchase_count_before then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  select count(*) into v_purchase_count_before from public.inventory_purchases;
  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'manufacturer', 'X', 'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 10
      )),
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.3 item sem filament_type_id rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.3 item sem filament_type_id rejeitado',
      case when (select count(*) from public.inventory_purchases) = v_purchase_count_before then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  select count(*) into v_purchase_count_before from public.inventory_purchases;
  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'filament_type_id', v_type_a_id, 'manufacturer', '   ', 'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 10
      )),
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.4 item com marca vazia rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.4 item com marca vazia rejeitado',
      case when (select count(*) from public.inventory_purchases) = v_purchase_count_before then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  select count(*) into v_purchase_count_before from public.inventory_purchases;
  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'filament_type_id', v_type_a_id, 'manufacturer', 'X', 'nominal_weight_grams', 0, 'quantity', 1, 'unit_value', 10
      )),
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.5 item com peso líquido zero/negativo rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.5 item com peso líquido zero/negativo rejeitado',
      case when (select count(*) from public.inventory_purchases) = v_purchase_count_before then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  select count(*) into v_purchase_count_before from public.inventory_purchases;
  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'filament_type_id', v_type_a_id, 'manufacturer', 'X', 'nominal_weight_grams', 1000, 'quantity', 0, 'unit_value', 10
      )),
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.6 item com quantidade zero/negativa rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.6 item com quantidade zero/negativa rejeitado',
      case when (select count(*) from public.inventory_purchases) = v_purchase_count_before then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  select count(*) into v_purchase_count_before from public.inventory_purchases;
  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'filament_type_id', v_type_a_id, 'manufacturer', 'X', 'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', -1
      )),
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.7 item com valor unitário negativo rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details) values ('2', '2.7 item com valor unitário negativo rejeitado',
      case when (select count(*) from public.inventory_purchases) = v_purchase_count_before then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  -- 2.8: o primeiro item é válido, o segundo é inválido — a compra inteira é
  -- rejeitada (nenhum cabeçalho/item/rolo do primeiro item fica órfão) —
  -- validação estrutural roda TODA antes de qualquer escrita (primeira
  -- passagem da função, ver migration).
  select count(*) into v_purchase_count_before from public.inventory_purchases;
  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(
        jsonb_build_object('filament_type_id', v_type_a_id, 'manufacturer', 'X', 'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 10),
        jsonb_build_object('filament_type_id', v_type_a_id, 'manufacturer', 'X', 'nominal_weight_grams', 1000, 'quantity', -1, 'unit_value', 10)
      ),
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.8 um item inválido no meio da lista rejeita a compra inteira (nada do 1º item fica órfão)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.8 um item inválido no meio da lista rejeita a compra inteira (nada do 1º item fica órfão)',
        case when (select count(*) from public.inventory_purchases) = v_purchase_count_before then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 3 — Tipo inexistente ou inativo é rejeitado, nada é criado; nenhum
-- tipo novo é criado por localização por Material+Cor+Acabamento.
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_inactive_id uuid;
  v_purchase_count_before integer;
  v_type_count_before integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_inactive_id from zz_fixtures where key = 'type_inactive_id';
  select count(*) into v_purchase_count_before from public.inventory_purchases;
  select count(*) into v_type_count_before from public.filament_types;

  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'filament_type_id', gen_random_uuid(), 'manufacturer', 'X',
        'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 10
      )),
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.1 filament_type_id inexistente rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.1 filament_type_id inexistente rejeitado',
        case when (select count(*) from public.inventory_purchases) = v_purchase_count_before
          and (select count(*) from public.filament_types) = v_type_count_before
        then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'filament_type_id', v_type_inactive_id, 'manufacturer', 'X',
        'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 10
      )),
      p_purchase_channel => 'MERCADO_LIVRE'
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.2 filament_type_id inativo rejeitado, nunca reativado em silêncio', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.2 filament_type_id inativo rejeitado, nunca reativado em silêncio',
        case when sqlerrm like '%não encontrado ou inativo%'
          and (select is_active from public.filament_types where id = v_type_inactive_id) = false
          and (select count(*) from public.inventory_purchases) = v_purchase_count_before
        then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 4 — Idempotência: mesma chave + mesmo payload devolve a compra já
-- registrada (sem duplicar); mesma chave + payload diferente é rejeitada.
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_a_id uuid;
  v_items jsonb;
  v_result_1 jsonb;
  v_result_2 jsonb;
  v_purchase_count_before integer;
  v_purchase_count_after integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_a_id from zz_fixtures where key = 'type_a_id';
  v_items := jsonb_build_array(jsonb_build_object(
    'filament_type_id', v_type_a_id, 'manufacturer', 'Bambu Lab',
    'nominal_weight_grams', 500, 'quantity', 1, 'unit_value', 50
  ));

  begin
    v_result_1 := public.register_filament_purchase(
      p_freight_value => 5, p_changed_by => v_user_id, p_items => v_items,
      p_idempotency_key => 'teste-compra-multi-idempotencia', p_purchase_channel => 'ALIEXPRESS'
    );
    select count(*) into v_purchase_count_before from public.inventory_purchases;

    v_result_2 := public.register_filament_purchase(
      p_freight_value => 5, p_changed_by => v_user_id, p_items => v_items,
      p_idempotency_key => 'teste-compra-multi-idempotencia', p_purchase_channel => 'ALIEXPRESS'
    );
    select count(*) into v_purchase_count_after from public.inventory_purchases;

    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.1 mesma chave + mesmo payload devolve a MESMA compra, sem duplicar',
        case when (v_result_1 ->> 'purchase_id') = (v_result_2 ->> 'purchase_id')
          and v_purchase_count_after = v_purchase_count_before
        then 'PASS' else 'FAIL' end,
        'purchase_1=' || (v_result_1 ->> 'purchase_id') || ' purchase_2=' || (v_result_2 ->> 'purchase_id'));
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.1 idempotência (mesmo payload)', 'FAIL', sqlerrm);
  end;

  begin
    perform public.register_filament_purchase(
      p_freight_value => 999, p_changed_by => v_user_id, p_items => v_items,
      p_idempotency_key => 'teste-compra-multi-idempotencia', p_purchase_channel => 'ALIEXPRESS'
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.2 mesma chave + payload diferente rejeitado (IDEMPOTENCY_KEY_CONFLICT)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.2 mesma chave + payload diferente rejeitado (IDEMPOTENCY_KEY_CONFLICT)',
        case when sqlerrm like 'IDEMPOTENCY_KEY_CONFLICT:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 5 — Atomicidade: falha no rolo do SEGUNDO item não deixa nenhum
-- resíduo (nem o cabeçalho, nem o primeiro item, nem nenhum rolo já criado).
-- Mesma técnica de inventory_purchases_test.sql Seção 8: pré-insere uma
-- filament_movements colidindo com a idempotency_key interna que o primeiro
-- rolo do SEGUNDO item usaria.
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_a_id uuid;
  v_type_b_id uuid;
  v_purchase_count_before integer;
  v_item_count_before integer;
  v_spool_count_before integer;
  v_purchase_count_after integer;
  v_item_count_after integer;
  v_spool_count_after integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_a_id from zz_fixtures where key = 'type_a_id';
  select value::uuid into v_type_b_id from zz_fixtures where key = 'type_b_id';

  select count(*) into v_purchase_count_before from public.inventory_purchases where idempotency_key = 'teste-compra-multi-atomicidade';
  select count(*) into v_item_count_before from public.inventory_purchase_filament_items
    where manufacturer in ('TESTE MULTI ATOM A', 'TESTE MULTI ATOM B');
  select count(*) into v_spool_count_before from public.filament_spools
    where filament_type_id in (v_type_a_id, v_type_b_id) and current_net_weight_grams = 777;

  begin
    -- O item 1 (tipo A, quantidade 1) cria seu único rolo com sucesso; o
    -- item 2 (tipo B, quantidade 1) colide na chave interna do seu único
    -- rolo ('...:item:2:spool:1') — register_filament_movement rejeita com
    -- IDEMPOTENCY_KEY_CONFLICT:, propagando como falha de TODA a chamada.
    insert into public.filament_movements (
      filament_type_id, spool_id, movement_type, quantity_delta, balance_before, balance_after,
      idempotency_key, created_by
    )
    select v_type_b_id, fs.id, 'PURCHASE', 1, 0, 1, 'teste-compra-multi-atomicidade:item:2:spool:1', v_user_id
    from public.filament_spools fs where fs.filament_type_id = v_type_b_id limit 1;

    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(
        jsonb_build_object('filament_type_id', v_type_a_id, 'manufacturer', 'TESTE MULTI ATOM A', 'nominal_weight_grams', 777, 'quantity', 1, 'unit_value', 10),
        jsonb_build_object('filament_type_id', v_type_b_id, 'manufacturer', 'TESTE MULTI ATOM B', 'nominal_weight_grams', 777, 'quantity', 1, 'unit_value', 10)
      ),
      p_idempotency_key => 'teste-compra-multi-atomicidade', p_purchase_channel => 'SHOPEE'
    );

    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 falha no rolo do 2º item desfaz a compra inteira (cabeçalho + 1º item + seu rolo incluídos)', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_purchase_count_after from public.inventory_purchases where idempotency_key = 'teste-compra-multi-atomicidade';
    select count(*) into v_item_count_after from public.inventory_purchase_filament_items
      where manufacturer in ('TESTE MULTI ATOM A', 'TESTE MULTI ATOM B');
    select count(*) into v_spool_count_after from public.filament_spools
      where filament_type_id in (v_type_a_id, v_type_b_id) and current_net_weight_grams = 777;

    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 falha no rolo do 2º item desfaz a compra inteira (cabeçalho + 1º item + seu rolo incluídos)',
        case
          when v_purchase_count_after = v_purchase_count_before
            and v_item_count_after = v_item_count_before
            and v_spool_count_after = v_spool_count_before
          then 'PASS' else 'FAIL'
        end,
        'purchases_before=' || v_purchase_count_before || ' purchases_after=' || v_purchase_count_after ||
        ' items_before=' || v_item_count_before || ' items_after=' || v_item_count_after ||
        ' spools_before=' || v_spool_count_before || ' spools_after=' || v_spool_count_after ||
        ' err=' || sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 6 — Regressão: o fluxo antigo de item único (register_inventory_purchase,
-- caminho por filament_type_id) continua funcionando sem nenhuma alteração
-- depois desta migration — compras antigas continuam legíveis (item_id
-- preenchido, mesmo formato de sempre).
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_a_id uuid;
  v_purchase public.inventory_purchases;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_a_id from zz_fixtures where key = 'type_a_id';
  begin
    v_purchase := public.register_inventory_purchase(
      p_category => 'FILAMENT', p_quantity => 1, p_item_value => 95.00, p_freight_value => 0,
      p_changed_by => v_user_id, p_filament_type_id => v_type_a_id,
      p_nominal_weight_grams => 1000, p_gross_weights_grams => array[1100]
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.1 fluxo antigo de item único (register_inventory_purchase por filament_type_id) continua funcionando, item_id preenchido',
        case when v_purchase.item_id = v_type_a_id and v_purchase.quantity = 1 then 'PASS' else 'FAIL' end,
        'item_id=' || v_purchase.item_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.1 fluxo antigo de item único continua funcionando', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 7 — Estrutura e privilégios (RLS/grants) da tabela nova.
-- =============================================================================

do $$
begin
  begin
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.1 inventory_purchases.item_id agora aceita NULL (nullable)',
        case when (
          select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'inventory_purchases' and column_name = 'item_id'
        ) = 'YES' then 'PASS' else 'FAIL' end, null);

    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2a authenticated TEM SELECT em inventory_purchase_filament_items',
        case when has_table_privilege('authenticated', 'public.inventory_purchase_filament_items', 'SELECT') then 'PASS' else 'FAIL' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2b authenticated NÃO tem INSERT em inventory_purchase_filament_items (só via RPC)',
        case when has_table_privilege('authenticated', 'public.inventory_purchase_filament_items', 'INSERT') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2c authenticated NÃO tem UPDATE em inventory_purchase_filament_items',
        case when has_table_privilege('authenticated', 'public.inventory_purchase_filament_items', 'UPDATE') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2d authenticated NÃO tem DELETE em inventory_purchase_filament_items',
        case when has_table_privilege('authenticated', 'public.inventory_purchase_filament_items', 'DELETE') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2e anon NÃO tem SELECT em inventory_purchase_filament_items',
        case when has_table_privilege('anon', 'public.inventory_purchase_filament_items', 'SELECT') then 'FAIL' else 'PASS' end, null);

    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.3 filament_spools.purchase_item_id existe e é nullable',
        case when (
          select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'filament_spools' and column_name = 'purchase_item_id'
        ) = 'YES' then 'PASS' else 'FAIL' end, null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.x checagens estruturais/privilégio', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 8 — purchase_channel (Local da compra, migration 20260904140000):
-- obrigatório, fechado aos 4 valores, persistido, e comparado pela
-- idempotência.
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_a_id uuid;
  v_purchase_count_before integer;
  v_channel text;
  v_result jsonb;
  v_purchase_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_a_id from zz_fixtures where key = 'type_a_id';

  -- 8.1: purchase_channel ausente (null) é rejeitado, nada é criado.
  select count(*) into v_purchase_count_before from public.inventory_purchases;
  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'filament_type_id', v_type_a_id, 'manufacturer', 'X', 'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 10
      ))
    );
    insert into zz_test_results(section, test_name, status, details) values ('8', '8.1 purchase_channel ausente rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details) values ('8', '8.1 purchase_channel ausente rejeitado',
      case when sqlerrm like '%purchase_channel é obrigatório%'
        and (select count(*) from public.inventory_purchases) = v_purchase_count_before
      then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  -- 8.2: purchase_channel com valor fora dos 4 aceitos é rejeitado.
  select count(*) into v_purchase_count_before from public.inventory_purchases;
  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'filament_type_id', v_type_a_id, 'manufacturer', 'X', 'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 10
      )),
      p_purchase_channel => 'AMAZON'
    );
    insert into zz_test_results(section, test_name, status, details) values ('8', '8.2 purchase_channel inválido (fora dos 4 valores) rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details) values ('8', '8.2 purchase_channel inválido (fora dos 4 valores) rejeitado',
      case when sqlerrm like '%purchase_channel é obrigatório%'
        and (select count(*) from public.inventory_purchases) = v_purchase_count_before
      then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  -- 8.3: os 4 valores oficiais são aceitos e persistidos corretamente, cada
  -- um numa compra própria (idempotency_key distinta por valor).
  foreach v_channel in array array['MERCADO_LIVRE', 'ALIEXPRESS', 'SHOPEE', 'PRESENCIAL']
  loop
    begin
      v_result := public.register_filament_purchase(
        p_freight_value => 0, p_changed_by => v_user_id,
        p_items => jsonb_build_array(jsonb_build_object(
          'filament_type_id', v_type_a_id, 'manufacturer', 'X', 'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 10
        )),
        p_idempotency_key => 'teste-compra-multi-canal-' || v_channel,
        p_purchase_channel => v_channel
      );
      v_purchase_id := (v_result ->> 'purchase_id')::uuid;
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.3 purchase_channel=' || v_channel || ' aceito e persistido', case when (
          select purchase_channel from public.inventory_purchases where id = v_purchase_id
        ) = v_channel then 'PASS' else 'FAIL' end, null);
    exception when others then
      insert into zz_test_results(section, test_name, status, details)
        values ('8', '8.3 purchase_channel=' || v_channel || ' aceito e persistido', 'FAIL', sqlerrm);
    end;
  end loop;

  -- 8.4: idempotência também compara purchase_channel — mesma chave, mesmo
  -- payload de itens/frete, mas canal DIFERENTE -> IDEMPOTENCY_KEY_CONFLICT:.
  begin
    perform public.register_filament_purchase(
      p_freight_value => 0, p_changed_by => v_user_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'filament_type_id', v_type_a_id, 'manufacturer', 'X', 'nominal_weight_grams', 1000, 'quantity', 1, 'unit_value', 10
      )),
      p_idempotency_key => 'teste-compra-multi-canal-MERCADO_LIVRE', p_purchase_channel => 'SHOPEE'
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4 idempotência rejeita quando só o purchase_channel muda (mesma chave)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4 idempotência rejeita quando só o purchase_channel muda (mesma chave)',
        case when sqlerrm like 'IDEMPOTENCY_KEY_CONFLICT:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- Limpeza — remove por ID EXATO só as fixtures/dados criados por este
-- arquivo (nunca LIKE como mecanismo de remoção, nunca TRUNCATE/CASCADE).
-- Executada só por disciplina: o ROLLBACK final já desfaz tudo sozinho.
-- =============================================================================

-- (sem limpeza manual necessária — toda a transação é revertida por ROLLBACK)

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
