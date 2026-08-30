-- =============================================================================
-- Forma Sky — estrutura produtiva por plates
-- TESTE DE INTEGRAÇÃO das funções de plates conforme o contrato ATUAL:
-- migration 20260829180000_add_categories_plate_weight_and_order_colors.sql
-- (ainda não aplicada), que redefiniu create_product_with_plates/
-- update_product_full/set_product_production e substituiu
-- validate_catalog_composition_for_creation por
-- validate_catalog_production_structure_for_creation. A partir desta
-- migration, plate.weight_grams é uma coluna DIRETA (nunca mais somada de
-- filamentos) e o Produto não tem mais NENHUMA composição de filamento —
-- filamentos/cores são uma escolha do Pedido (order_item_unit_plate_filaments,
-- coberta em supabase/tests/product_categories_plate_weight_order_colors_test.sql).
--
-- REESCRITO INTEGRALMENTE nesta rodada corretiva (2026-08-30) — a versão
-- anterior deste arquivo (validada contra a migration 20260829160000,
-- aplicada ao remoto) chamava create_product_with_plates/update_product_full
-- com a assinatura ANTIGA (p_category text, p_plates com "filaments":[...])
-- e testava validate_catalog_composition_for_creation/
-- ORDER_CATALOG_MISSING_COMPOSITION: — ambas as funções foram DROP+CREATE
-- (assinatura nova) ou substituídas pela migration 20260829180000. Todo o
-- conteúdo deste arquivo foi reescrito para o contrato atual; nenhuma
-- seção permanece na versão antiga.
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nenhum dado criado por este
-- script persiste no banco. Usa somente produto/tipo de filamento/cliente
-- "TESTE%", nunca dados oficiais ou Petlink.
--
-- IMPORTANTE — a migration 20260829180000 ainda NÃO foi aplicada ao projeto
-- Supabase remoto nesta rodada (restrição explícita desta tarefa). Por isso
-- este script NÃO PÔDE ser executado nesta rodada — as funções que ele
-- testa, na forma testada aqui, ainda não existem no banco remoto. Escrito
-- seguindo a mesma disciplina/estrutura já usada nos demais arquivos deste
-- diretório — pronto para ser executado assim que a migration for aplicada,
-- numa rodada futura autorizada.
--
-- Execução (quando a migration estiver aplicada):
--   npx supabase db query --linked --file supabase/tests/product_plates_test.sql

begin;

create temporary table zz_pp_test_results (
  seq serial primary key,
  section text not null,
  test_name text not null,
  status text not null,
  details text
);

create temporary table zz_pp_fixtures (
  key text primary key,
  value text not null
);

-- =============================================================================
-- SETUP — usuário ativo existente, 1 tipo de filamento TESTE ativo (usado só
-- para os testes de backfill/legado — nunca mais escolhido no cadastro do
-- Produto), 1 acessório e 1 embalagem TESTE ativos, 1 cliente TESTE.
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_accessory_id uuid;
  v_packaging_id uuid;
  v_customer_id uuid;
begin
  select id into v_user_id from public.users where is_active limit 1;
  if v_user_id is null then
    raise exception 'setup: nenhum usuário ativo encontrado para o teste';
  end if;
  insert into zz_pp_fixtures(key, value) values ('user_id', v_user_id::text);

  v_type_a := (public.create_filament_type(
    'PLA', 'TESTE Marca Plates A', 'Sólida', 'Preto', null, null, true, null, v_user_id
  )).id;
  insert into zz_pp_fixtures(key, value) values ('type_a', v_type_a::text);

  insert into public.accessories (name, is_active) values ('TESTE OPS Plates — Acessório', true)
    returning id into v_accessory_id;
  insert into public.packaging (name, is_active) values ('TESTE OPS Plates — Embalagem', true)
    returning id into v_packaging_id;
  insert into zz_pp_fixtures(key, value) values ('accessory_id', v_accessory_id::text);
  insert into zz_pp_fixtures(key, value) values ('packaging_id', v_packaging_id::text);

  insert into public.customers (name, is_active) values ('TESTE OPS Plates — Cliente', true)
    returning id into v_customer_id;
  insert into zz_pp_fixtures(key, value) values ('customer_id', v_customer_id::text);

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('0', '0.0 setup: usuário/tipo de filamento/acessório/embalagem/cliente TESTE criados', 'PASS',
      'user_id=' || v_user_id || ' type_a=' || v_type_a || ' customer_id=' || v_customer_id);
end $$;

-- =============================================================================
-- SEÇÃO 1 — criação com create_product_with_plates (peso direto, SEM
-- filamentos — contrato atual)
-- =============================================================================

-- 1.1 — 1 plate, peso direto — efetivo bate exatamente com o informado.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row public.products;
  v_plate_count integer;
  v_plate_weight numeric;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — Produto 1 plate', 'CATALOG',
      jsonb_build_array('teste'), 'produto de teste',
      50.00, null, true,
      jsonb_build_array(jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 40)),
      null, null,
      '[]'::jsonb, '[]'::jsonb,
      v_user_id
    );
    select * into v_row from public.products where id = v_product_id;
    select count(*) into v_plate_count from public.product_plates where product_id = v_product_id;
    select weight_grams into v_plate_weight from public.product_plates where product_id = v_product_id and plate_number = 1;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.1 criação com 1 plate: peso/tempo efetivos batem exatamente, weight_grams direto no plate',
        case when v_row.default_weight_grams = 40 and v_row.default_print_time_seconds = 3600
                and v_plate_count = 1 and v_plate_weight = 40
             then 'PASS' else 'FAIL' end,
        'weight=' || v_row.default_weight_grams || ' time=' || v_row.default_print_time_seconds ||
        ' plates=' || v_plate_count || ' plate_weight=' || v_plate_weight);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.1 criação com 1 plate', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.2 — 2 plates — exemplo de aceite (Suporte PS5): 37,16 g + 97,34 g =
-- 134,50 g; 01:17 (4620s) + 02:54 (10440s) = 04:11 (15060s).
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row public.products;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — Suporte PS5', 'CATALOG',
      jsonb_build_array('teste'), 'exemplo de aceite',
      80.00, null, true,
      jsonb_build_array(
        jsonb_build_object('production_time_seconds', 4620, 'weight_grams', 37.16),
        jsonb_build_object('production_time_seconds', 10440, 'weight_grams', 97.34)
      ),
      null, null,
      '[]'::jsonb, '[]'::jsonb,
      v_user_id
    );
    select * into v_row from public.products where id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.2 exemplo de aceite (Suporte PS5, 2 plates): 37,16+97,34=134,50g; 4620+10440=15060s (04:11)',
        case when v_row.default_weight_grams = 134.50 and v_row.default_print_time_seconds = 15060
             then 'PASS' else 'FAIL' end,
        'weight=' || v_row.default_weight_grams || ' time=' || v_row.default_print_time_seconds);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.2 exemplo de aceite (Suporte PS5)', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.3 — 3 plates — totais automáticos somam os 3 corretamente (robustez além
-- de 1-2 plates).
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row public.products;
  v_plate_count integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — 3 plates', 'CATALOG',
      jsonb_build_array('teste'), null,
      90.00, null, true,
      jsonb_build_array(
        jsonb_build_object('production_time_seconds', 600, 'weight_grams', 10),
        jsonb_build_object('production_time_seconds', 900, 'weight_grams', 15),
        jsonb_build_object('production_time_seconds', 300, 'weight_grams', 5)
      ),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
    select * into v_row from public.products where id = v_product_id;
    select count(*) into v_plate_count from public.product_plates where product_id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.3 3 plates: soma automática correta (30g, 1800s), 3 linhas persistidas',
        case when v_row.default_weight_grams = 30 and v_row.default_print_time_seconds = 1800 and v_plate_count = 3
             then 'PASS' else 'FAIL' end,
        'weight=' || v_row.default_weight_grams || ' time=' || v_row.default_print_time_seconds || ' plates=' || v_plate_count);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.3 3 plates', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.4 — Ajuste manual só do peso — tempo continua automático (independência
-- entre os dois campos).
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row public.products;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — Ajuste manual só peso', 'CATALOG',
      jsonb_build_array('teste'), null,
      80.00, null, true,
      jsonb_build_array(jsonb_build_object('production_time_seconds', 15060, 'weight_grams', 134.50)),
      134.49, null,
      '[]'::jsonb, '[]'::jsonb,
      v_user_id
    );
    select * into v_row from public.products where id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.4 ajuste manual só do peso: efetivo=134.49g, tempo continua automático=15060s',
        case when v_row.default_weight_grams = 134.49 and v_row.default_print_time_seconds = 15060
                and v_row.production_weight_manual_override_grams = 134.49
                and v_row.production_time_manual_override_seconds is null
             then 'PASS' else 'FAIL' end,
        'weight=' || v_row.default_weight_grams || ' time=' || v_row.default_print_time_seconds ||
        ' override_w=' || v_row.production_weight_manual_override_grams ||
        ' override_t=' || coalesce(v_row.production_time_manual_override_seconds::text, 'null'));
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.4 ajuste manual só do peso', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.5 — Ajuste manual de peso E tempo simultaneamente.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row public.products;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — Ajuste manual peso e tempo', 'CATALOG',
      jsonb_build_array('teste'), null,
      80.00, null, true,
      jsonb_build_array(jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 50)),
      45, 3000,
      '[]'::jsonb, '[]'::jsonb,
      v_user_id
    );
    select * into v_row from public.products where id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.5 ajuste manual de peso e tempo: efetivo=45g/3000s, automático preservado nas colunas de plate (50g/3600s)',
        case when v_row.default_weight_grams = 45 and v_row.default_print_time_seconds = 3000
                and v_row.production_weight_manual_override_grams = 45
                and v_row.production_time_manual_override_seconds = 3000
             then 'PASS' else 'FAIL' end,
        'weight=' || v_row.default_weight_grams || ' time=' || v_row.default_print_time_seconds);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.5 ajuste manual de peso e tempo', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.6 — Peso do plate nulo/negativo é rejeitado.
do $$
declare
  v_user_id uuid;
  v_raised_null boolean := false;
  v_raised_negative boolean := false;
  v_message_null text;
  v_message_negative text;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  begin
    perform public.create_product_with_plates(
      'TESTE OPS Plates — Peso nulo', 'CATALOG', jsonb_build_array('teste'), null,
      10.00, null, true,
      jsonb_build_array(jsonb_build_object('production_time_seconds', 60)),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised_null := true;
    v_message_null := sqlerrm;
  end;

  begin
    perform public.create_product_with_plates(
      'TESTE OPS Plates — Peso negativo', 'CATALOG', jsonb_build_array('teste'), null,
      10.00, null, true,
      jsonb_build_array(jsonb_build_object('production_time_seconds', 60, 'weight_grams', -5)),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised_negative := true;
    v_message_negative := sqlerrm;
  end;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('1', '1.6 weight_grams nulo/negativo é REJEITADO nos dois casos',
      case when v_raised_null and v_message_null ilike '%weight_grams%'
             and v_raised_negative and v_message_negative ilike '%weight_grams%'
           then 'PASS' else 'FAIL' end,
      'null: raised=' || v_raised_null || ' msg=' || coalesce(v_message_null, '') ||
      ' | negative: raised=' || v_raised_negative || ' msg=' || coalesce(v_message_negative, ''));
end $$;

-- 1.7 — Tempo do plate negativo é rejeitado (tempo em branco/zero continua
-- válido — nunca obrigatório, só não pode ser negativo).
do $$
declare
  v_user_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  begin
    perform public.create_product_with_plates(
      'TESTE OPS Plates — Tempo negativo', 'CATALOG', jsonb_build_array('teste'), null,
      10.00, null, true,
      jsonb_build_array(jsonb_build_object('production_time_seconds', -1, 'weight_grams', 10)),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('1', '1.7 production_time_seconds negativo é REJEITADO',
      case when v_raised and v_message ilike '%production_time_seconds%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- 1.8 — Falha parcial (peso inválido no 2º plate) desfaz TUDO — nenhum
-- Produto/plate órfão, mesmo o 1º plate tendo sido válido (rollback atômico).
do $$
declare
  v_user_id uuid;
  v_products_before integer;
  v_products_after integer;
  v_orphan_plates integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select count(*) into v_products_before from public.products where name like 'TESTE OPS Plates%';

  begin
    perform public.create_product_with_plates(
      'TESTE OPS Plates — Falha no 2º plate desfaz tudo', 'CATALOG', jsonb_build_array('teste'), null,
      10.00, null, true,
      jsonb_build_array(
        jsonb_build_object('production_time_seconds', 60, 'weight_grams', 10),
        jsonb_build_object('production_time_seconds', 60, 'weight_grams', -1)
      ),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.8 falha no 2º plate desfaz TUDO (Produto+1º plate incluídos, rollback atômico)', 'FAIL', 'não levantou exceção');
  exception when others then
    select count(*) into v_products_after from public.products
      where name like 'TESTE OPS Plates%' and name like '%Falha no 2º plate%';
    select count(*) into v_orphan_plates from public.product_plates pp
      join public.products p on p.id = pp.product_id
      where p.name like '%Falha no 2º plate%';
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.8 falha no 2º plate desfaz TUDO (Produto+1º plate incluídos, rollback atômico)',
        case when v_products_after = 0 and v_orphan_plates = 0 then 'PASS' else 'FAIL' end,
        sqlerrm || ' products_after=' || v_products_after || ' orphan_plates=' || v_orphan_plates);
  end;
end $$;

-- 1.9 — Acessórios/Embalagens vinculados atomicamente na criação (mesmo sem
-- nenhum plate — cadastro de Produto nunca exige plate).
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_packaging_id uuid;
  v_product_id uuid;
  v_accessory_count integer;
  v_packaging_count integer;
  v_plate_count integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_pp_fixtures where key = 'accessory_id';
  select value::uuid into v_packaging_id from zz_pp_fixtures where key = 'packaging_id';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — Com acessórios e embalagens, sem plate', 'CATALOG', jsonb_build_array('teste'), null,
      10.00, null, true,
      '[]'::jsonb,
      null, null,
      jsonb_build_array(jsonb_build_object('id', v_accessory_id, 'quantity', 2)),
      jsonb_build_array(jsonb_build_object('id', v_packaging_id, 'quantity', 1)),
      v_user_id
    );
    select count(*) into v_accessory_count from public.product_accessories where product_id = v_product_id;
    select count(*) into v_packaging_count from public.product_packaging where product_id = v_product_id;
    select count(*) into v_plate_count from public.product_plates where product_id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.9 Acessórios/Embalagens vinculados atomicamente na criação, mesmo sem nenhum plate (cadastro de Produto nunca exige plate)',
        case when v_accessory_count = 1 and v_packaging_count = 1 and v_plate_count = 0 then 'PASS' else 'FAIL' end,
        'accessory_count=' || v_accessory_count || ' packaging_count=' || v_packaging_count || ' plate_count=' || v_plate_count);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.9 Acessórios/Embalagens vinculados atomicamente na criação', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.10 — Quantidade inválida (zero) de acessório é rejeitada (defesa em
-- profundidade de set_product_composition — aqui só confirma que
-- create_product_with_plates propaga o erro).
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_pp_fixtures where key = 'accessory_id';

  begin
    perform public.create_product_with_plates(
      'TESTE OPS Plates — Quantidade inválida', 'CATALOG', jsonb_build_array('teste'), null,
      10.00, null, true,
      '[]'::jsonb, null, null,
      jsonb_build_array(jsonb_build_object('id', v_accessory_id, 'quantity', 0)),
      '[]'::jsonb,
      v_user_id
    );
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.10 quantidade de acessório <= 0 é REJEITADA', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.10 quantidade de acessório <= 0 é REJEITADA', 'PASS', sqlerrm);
  end;
end $$;

-- 1.11 — Criação sem NENHUM plate é permitida no cadastro do Produto — a
-- exigência de estrutura produtiva é uma regra do PEDIDO (Seção 3 abaixo),
-- nunca do cadastro do Produto em si.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_plate_count integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — Sem nenhum plate (Produto ainda incompleto)', 'CATALOG', jsonb_build_array('teste'), null,
      10.00, null, true, '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
    select count(*) into v_plate_count from public.product_plates where product_id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.11 criação sem nenhum plate é permitida (o Produto nasce, só o Pedido exige estrutura depois)',
        case when v_plate_count = 0 then 'PASS' else 'FAIL' end, 'plate_count=' || v_plate_count);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.11 criação sem nenhum plate', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 2 — edição com update_product_full: persistência, substituição
-- completa, rollback atômico
-- =============================================================================

-- 2.1 — Edição substitui plates completamente e recalcula totais.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row public.products;
  v_plate_count integer;
  v_plate_weight numeric;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Editar depois', 'CATALOG', jsonb_build_array('teste'), null,
    10.00, null, true,
    jsonb_build_array(jsonb_build_object('production_time_seconds', 60, 'weight_grams', 10)),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  begin
    v_row := public.update_product_full(
      v_product_id,
      jsonb_build_object('name', 'TESTE OPS Plates — Editado'),
      jsonb_build_array('teste'),
      jsonb_build_array(jsonb_build_object('production_time_seconds', 120, 'weight_grams', 20)),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
    select count(*) into v_plate_count from public.product_plates where product_id = v_product_id;
    select weight_grams into v_plate_weight from public.product_plates where product_id = v_product_id and plate_number = 1;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.1 edição substitui plates por completo e recalcula totais (peso/tempo persistidos)',
        case when v_row.name = 'TESTE OPS Plates — Editado' and v_row.default_weight_grams = 20
                and v_row.default_print_time_seconds = 120 and v_plate_count = 1 and v_plate_weight = 20
             then 'PASS' else 'FAIL' end,
        'name=' || v_row.name || ' weight=' || v_row.default_weight_grams ||
        ' time=' || v_row.default_print_time_seconds || ' plate_count=' || v_plate_count);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.1 edição substitui plates', 'FAIL', sqlerrm);
  end;
end $$;

-- 2.2 — Edição sem patch de campos descritivos (p_patch vazio) não chama
-- update_product() — nome preservado, plates ainda substituídos.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row public.products;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Editar só composição', 'CATALOG', jsonb_build_array('teste'), null,
    10.00, null, true, '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  begin
    v_row := public.update_product_full(
      v_product_id, '{}'::jsonb,
      jsonb_build_array('teste'),
      jsonb_build_array(jsonb_build_object('production_time_seconds', 30, 'weight_grams', 5)),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.2 p_patch vazio: nome do Produto preservado, plates ainda substituídos',
        case when v_row.name = 'TESTE OPS Plates — Editar só composição' and v_row.default_weight_grams = 5
             then 'PASS' else 'FAIL' end,
        'name=' || v_row.name || ' weight=' || v_row.default_weight_grams);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.2 p_patch vazio', 'FAIL', sqlerrm);
  end;
end $$;

-- 2.3 — Falha parcial na EDIÇÃO (peso inválido no 2º plate) desfaz TUDO — o
-- Produto continua com nome/composição ANTERIORES à tentativa (rollback
-- atômico também na edição, não só na criação).
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row_before public.products;
  v_row_after public.products;
  v_plate_count_after integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Editar com falha no meio', 'CATALOG', jsonb_build_array('teste'), null,
    10.00, null, true,
    jsonb_build_array(jsonb_build_object('production_time_seconds', 60, 'weight_grams', 10)),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  select * into v_row_before from public.products where id = v_product_id;

  begin
    perform public.update_product_full(
      v_product_id,
      jsonb_build_object('name', 'TESTE OPS Plates — Nome que não deveria persistir'),
      jsonb_build_array('teste'),
      jsonb_build_array(jsonb_build_object('production_time_seconds', 120, 'weight_grams', -1)),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.3 falha parcial na edição desfaz TUDO (nome e composição revertem ao estado anterior)', 'FAIL', 'não levantou exceção');
  exception when others then
    select * into v_row_after from public.products where id = v_product_id;
    select count(*) into v_plate_count_after from public.product_plates where product_id = v_product_id;
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.3 falha parcial na edição desfaz TUDO (nome e composição revertem ao estado anterior)',
        case when v_row_after.name = v_row_before.name and v_row_after.default_weight_grams = v_row_before.default_weight_grams
                and v_plate_count_after = 1
             then 'PASS' else 'FAIL' end,
        sqlerrm || ' name_after=' || v_row_after.name || ' weight_after=' || v_row_after.default_weight_grams ||
        ' plate_count_after=' || v_plate_count_after);
  end;
end $$;

-- 2.4 — Escrever/editar plates NUNCA grava em product_plate_filaments
-- (legada a partir desta migration) — confirma que nenhuma rota nova
-- escreve nessa tabela, nem na criação nem na edição.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_legacy_count_before integer;
  v_legacy_count_after integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Nunca escreve em product_plate_filaments', 'CATALOG', jsonb_build_array('teste'), null,
    10.00, null, true,
    jsonb_build_array(jsonb_build_object('production_time_seconds', 60, 'weight_grams', 10)),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  select count(*) into v_legacy_count_before
    from public.product_plate_filaments ppf
    join public.product_plates pp on pp.id = ppf.plate_id
    where pp.product_id = v_product_id;

  perform public.update_product_full(
    v_product_id, '{}'::jsonb, jsonb_build_array('teste'),
    jsonb_build_array(jsonb_build_object('production_time_seconds', 90, 'weight_grams', 20)),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  select count(*) into v_legacy_count_after
    from public.product_plate_filaments ppf
    join public.product_plates pp on pp.id = ppf.plate_id
    where pp.product_id = v_product_id;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('2', '2.4 criação e edição NUNCA gravam em product_plate_filaments (0 antes, 0 depois)',
      case when v_legacy_count_before = 0 and v_legacy_count_after = 0 then 'PASS' else 'FAIL' end,
      'before=' || v_legacy_count_before || ' after=' || v_legacy_count_after);
end $$;

-- 2.5 — "Remoção protegida": um plate ANTIGO com uma linha legada em
-- product_plate_filaments (resíduo pré-migration, inserido diretamente aqui
-- para simular esse estado) não trava a edição — a FK de
-- product_plate_filaments.plate_id foi alterada para ON DELETE CASCADE
-- nesta migration exatamente para permitir que o padrão de sempre
-- (delete+reinsert em set_product_production) continue funcionando mesmo
-- para um Produto com composição legada presa a um plate antigo. A linha
-- legada é removida em CASCATA (efeito do DELETE do plate, nunca um DELETE
-- direto desta função na tabela legada).
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_product_id uuid;
  v_old_plate_id uuid;
  v_row public.products;
  v_legacy_count_after integer;
  v_old_plate_still_exists boolean;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Plate antigo com legado preso', 'CATALOG', jsonb_build_array('teste'), null,
    10.00, null, true,
    jsonb_build_array(jsonb_build_object('production_time_seconds', 60, 'weight_grams', 10)),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  select id into v_old_plate_id from public.product_plates where product_id = v_product_id and plate_number = 1;

  -- Resíduo legado: nunca escrito por nenhuma rota nova (2.4 já provou
  -- isso) — inserido diretamente aqui só para simular um Produto que já
  -- existia antes desta migration.
  insert into public.product_plate_filaments (plate_id, filament_type_id, weight_grams)
    values (v_old_plate_id, v_type_a, 10);

  begin
    v_row := public.update_product_full(
      v_product_id, '{}'::jsonb, jsonb_build_array('teste'),
      jsonb_build_array(jsonb_build_object('production_time_seconds', 90, 'weight_grams', 25)),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
    select count(*) into v_legacy_count_after from public.product_plate_filaments where plate_id = v_old_plate_id;
    select exists(select 1 from public.product_plates where id = v_old_plate_id) into v_old_plate_still_exists;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.5 remoção protegida: editar um plate com legado preso NUNCA trava (FK CASCADE); plate antigo some, linha legada segue a cascata',
        case when v_row.default_weight_grams = 25 and not v_old_plate_still_exists and v_legacy_count_after = 0
             then 'PASS' else 'FAIL' end,
        'weight=' || v_row.default_weight_grams || ' old_plate_still_exists=' || v_old_plate_still_exists ||
        ' legacy_count_after=' || v_legacy_count_after);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.5 remoção protegida (FK CASCADE em product_plate_filaments)', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 3 — validação de estrutura produtiva para criação de Pedido
-- (validate_catalog_production_structure_for_creation) — a partir desta
-- migration exige SÓ a existência de ao menos 1 plate; nunca mais
-- filamento/composição de nenhuma forma (nem product_filaments, nem
-- product_plate_filaments).
-- =============================================================================

-- 3.1 — Produto com plates -> criação de Pedido NÃO bloqueada, entra direto
-- em IN_PRODUCTION_QUEUE.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_status text;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_pp_fixtures where key = 'customer_id';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Produto p/ Pedido', 'CATALOG', jsonb_build_array('teste'), null,
    30.00, null, true,
    jsonb_build_array(jsonb_build_object('production_time_seconds', 60, 'weight_grams', 15)),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG com plates -> Pedido',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 30
      )),
      v_user_id
    );
    select order_status into v_order_status from public.orders where id = v_order_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('3', '3.1 Produto com plates -> criação de Pedido NÃO bloqueada, entra em IN_PRODUCTION_QUEUE',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('3', '3.1 Produto com plates -> Pedido', 'FAIL', sqlerrm);
  end;
end $$;

-- 3.2 — Produto sem NENHUM plate continua bloqueado
-- (ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:, nome real do marcador a
-- partir desta migration).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_pp_fixtures where key = 'customer_id';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Produto sem estrutura', 'CATALOG', jsonb_build_array('teste'), null,
    30.00, null, true, '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG sem nenhum plate',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 30
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('3', '3.2 Produto sem nenhum plate continua BLOQUEADO na criação do Pedido (ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:)',
      case when v_raised and v_message ilike 'ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- 3.3 — uma linha legada em product_filaments SEM nenhum plate NUNCA é
-- suficiente — a validação a partir desta migration não olha para
-- product_filaments em NENHUMA circunstância (nem como alternativa, nem
-- como fallback); só a existência de product_plates importa.
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';
  select value::uuid into v_customer_id from zz_pp_fixtures where key = 'customer_id';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Só legado, sem plate', 'CATALOG', jsonb_build_array('teste'), null,
    30.00, null, true, '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  insert into public.product_filaments (product_id, filament_type_id, theoretical_weight_grams)
    values (v_product_id, v_type_a, 15);

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG só com product_filaments legado, sem plate',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 30
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('3', '3.3 product_filaments (legado) SOZINHO, sem plate, NUNCA é suficiente — Pedido bloqueado (prova que filamento não importa mais)',
      case when v_raised and v_message ilike 'ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- 3.4 — Produto que TINHA plates e teve a estrutura esvaziada
-- (update_product_full com plates: []) volta a bloquear NOVOS Pedidos —
-- nunca "salvo" por nenhum dado legado remanescente. (Pedidos já criados
-- antes de esvaziar não são afetados — snapshot imutável, coberto em
-- product_categories_plate_weight_order_colors_test.sql, Seção 3.2.)
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_pp_fixtures where key = 'customer_id';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Esvaziado depois de ter estrutura', 'CATALOG', jsonb_build_array('teste'), null,
    30.00, null, true,
    jsonb_build_array(jsonb_build_object('production_time_seconds', 60, 'weight_grams', 10)),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  perform public.update_product_full(
    v_product_id, '{}'::jsonb, jsonb_build_array('teste'), '[]'::jsonb,
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG com estrutura esvaziada depois de ter tido plates',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 30
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('3', '3.4 Produto que teve os plates esvaziados volta a bloquear NOVOS Pedidos',
      case when v_raised and v_message ilike 'ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- 3.5 — 1 plate já basta (a validação nunca exige "todos os plates com peso
-- realista" nem nenhum mínimo além do próprio CHECK weight_grams >= 0 já
-- garantido na escrita) — confirma que a regra é só "existe ao menos 1
-- linha", nada além disso.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_status text;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_pp_fixtures where key = 'customer_id';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — 1 plate de peso mínimo basta', 'CATALOG', jsonb_build_array('teste'), null,
    5.00, null, true,
    jsonb_build_array(jsonb_build_object('production_time_seconds', 0, 'weight_grams', 0.01)),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'CATALOG com 1 plate de peso mínimo',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 5
    )),
    v_user_id
  );
  select order_status into v_order_status from public.orders where id = v_order_id;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('3', '3.5 1 plate de peso mínimo (0.01g) já basta — validação exige só existência, nunca um peso "realista"',
      case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
      'order_status=' || v_order_status);
end $$;

-- =============================================================================
-- SEÇÃO 4 — backfill de Produtos antigos (peso direto por plate, Seção 16.2
-- da migration) — a migração real só roda uma vez, na aplicação; aqui
-- replicamos manualmente, para Produtos de teste específicos, a MESMA
-- fórmula do bloco de backfill, para provar que a fórmula em si está
-- correta (não que a migration inteira é atômica — isso é uma propriedade
-- do Postgres/Supabase CLI, já coberta pelas verificações internas da
-- própria migration, Seção 17).
-- =============================================================================

-- 4.1 — Produto antigo com 1 plate SEM filamentos legados: peso direto =
-- peso efetivo ANTERIOR (products.default_weight_grams), preservado
-- exatamente.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_plate_id uuid;
  v_effective_before numeric;
  v_legacy_weight numeric;
  v_weight_after numeric;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';

  -- Simula um Produto "congelado" no formato pré-20260829180000: 1 plate
  -- sem NENHUM filamento legado, mas com um peso efetivo já calculado
  -- (products.default_weight_grams) — cenário real de um Produto criado
  -- pela migration anterior (20260829160000) que já tinha peso, mas cuja
  -- composição de filamento nunca foi preenchida.
  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Backfill: 1 plate sem legado', 'CATALOG', jsonb_build_array('teste'), null,
    30.00, null, true,
    jsonb_build_array(jsonb_build_object('production_time_seconds', 60, 'weight_grams', 18.5)),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  select id into v_plate_id from public.product_plates where product_id = v_product_id and plate_number = 1;
  select default_weight_grams into v_effective_before from public.products where id = v_product_id;

  select coalesce(sum(weight_grams), 0) into v_legacy_weight
    from public.product_plate_filaments where plate_id = v_plate_id;

  -- Fórmula 16.2 (single plate sem legado): weight_grams = peso efetivo
  -- anterior.
  update public.product_plates
    set weight_grams = coalesce(v_effective_before, 0)
    where id = v_plate_id and v_legacy_weight = 0;

  select weight_grams into v_weight_after from public.product_plates where id = v_plate_id;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('4', '4.1 backfill simulado — 1 plate sem legado: weight_grams passa a ser o peso efetivo anterior (18.5g preservado)',
      case when v_legacy_weight = 0 and v_weight_after = v_effective_before then 'PASS' else 'FAIL' end,
      'legacy_weight=' || v_legacy_weight || ' effective_before=' || v_effective_before || ' weight_after=' || v_weight_after);
end $$;

-- 4.2 — Produto antigo com 1 plate COM filamentos legados: peso direto =
-- soma exata dos filamentos legados daquele plate.
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_product_id uuid;
  v_plate_id uuid;
  v_legacy_weight numeric;
  v_weight_after numeric;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Backfill: 1 plate com legado', 'CATALOG', jsonb_build_array('teste'), null,
    30.00, null, true,
    jsonb_build_array(jsonb_build_object('production_time_seconds', 60, 'weight_grams', 1)),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  select id into v_plate_id from public.product_plates where product_id = v_product_id and plate_number = 1;
  insert into public.product_plate_filaments (plate_id, filament_type_id, weight_grams)
    values (v_plate_id, v_type_a, 22.75);

  select coalesce(sum(weight_grams), 0) into v_legacy_weight
    from public.product_plate_filaments where plate_id = v_plate_id;

  -- Fórmula 16.2 (single plate com legado): weight_grams = soma do legado.
  update public.product_plates set weight_grams = v_legacy_weight where id = v_plate_id and v_legacy_weight > 0;

  select weight_grams into v_weight_after from public.product_plates where id = v_plate_id;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('4', '4.2 backfill simulado — 1 plate com legado: weight_grams passa a ser a soma exata dos filamentos legados (22.75g)',
      case when v_legacy_weight = 22.75 and v_weight_after = 22.75 then 'PASS' else 'FAIL' end,
      'legacy_weight=' || v_legacy_weight || ' weight_after=' || v_weight_after);
end $$;

-- 4.3 — Produto antigo com MÚLTIPLOS plates onde algum não tem filamento
-- legado próprio: a fórmula 16.2 ABORTA (distribuição ambígua, nunca
-- inventada) — replica a MESMA condição de exceção da migration real.
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_product_id uuid;
  v_plate_1_id uuid;
  v_plate_2_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Backfill: múltiplos plates, um sem legado (ambíguo)', 'CATALOG', jsonb_build_array('teste'), null,
    30.00, null, true,
    jsonb_build_array(
      jsonb_build_object('production_time_seconds', 60, 'weight_grams', 1),
      jsonb_build_object('production_time_seconds', 60, 'weight_grams', 1)
    ),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  select id into v_plate_1_id from public.product_plates where product_id = v_product_id and plate_number = 1;
  select id into v_plate_2_id from public.product_plates where product_id = v_product_id and plate_number = 2;

  -- Só o plate 1 tem legado — o plate 2 fica sem nenhum filamento legado
  -- próprio, exatamente a condição de ambiguidade que 16.2 aborta.
  insert into public.product_plate_filaments (plate_id, filament_type_id, weight_grams)
    values (v_plate_1_id, v_type_a, 10);

  begin
    -- Replica a MESMA checagem do loop de múltiplos plates em 16.2: para
    -- CADA plate, se a soma do legado for 0, aborta.
    declare
      v_plate record;
      v_legacy_weight numeric;
    begin
      for v_plate in select id from public.product_plates where product_id = v_product_id order by plate_number
      loop
        select coalesce(sum(weight_grams), 0) into v_legacy_weight
          from public.product_plate_filaments where plate_id = v_plate.id;
        if v_legacy_weight = 0 then
          raise exception 'Abortando: Produto % tem múltiplos plates e o plate % não tem nenhum filamento legado para determinar o peso direto — distribuição ambígua, não inventada.', v_product_id, v_plate.id;
        end if;
      end loop;
    end;
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('4', '4.3 backfill simulado — múltiplos plates com algum sem legado: ABORTA (distribuição ambígua nunca inventada)',
      case when v_raised and v_message ilike '%distribuição ambígua%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- =============================================================================
-- SEÇÃO 5 — permissões e segurança (assinaturas ATUAIS desta migration)
-- =============================================================================
do $$
declare
  v_ok boolean;
begin
  select
    not has_function_privilege('anon', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE')
    and not has_function_privilege(
      'authenticated',
      'public.create_product_with_plates(text,text,jsonb,text,numeric,uuid,boolean,jsonb,numeric,integer,jsonb,jsonb,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.create_product_with_plates(text,text,jsonb,text,numeric,uuid,boolean,jsonb,numeric,integer,jsonb,jsonb,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated', 'public.update_product_full(uuid,jsonb,jsonb,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE'
    )
    and has_function_privilege(
      'service_role', 'public.update_product_full(uuid,jsonb,jsonb,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE'
    )
    and not has_function_privilege('anon', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE')
    and not has_table_privilege('anon', 'public.product_plates', 'SELECT')
  into v_ok;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('5', '5.1 set_product_production/validate_catalog_production_structure_for_creation sem grant algum; create_product_with_plates/update_product_full exclusivas de service_role (assinaturas atuais)',
      case when v_ok then 'PASS' else 'FAIL' end, 'v_ok=' || v_ok);
exception when others then
  insert into zz_pp_test_results(section, test_name, status, details)
    values ('5', '5.1 permissões/grants', 'FAIL', sqlerrm);
end $$;

do $$
declare
  v_authenticated_select boolean;
  v_anon_select boolean;
begin
  select has_table_privilege('authenticated', 'public.product_plates', 'SELECT') into v_authenticated_select;
  select has_table_privilege('anon', 'public.product_plates', 'SELECT') into v_anon_select;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('5', '5.2 authenticated tem SELECT em product_plates (leitura compatível com o frontend); anon não tem nenhum acesso',
      case when v_authenticated_select and not v_anon_select then 'PASS' else 'FAIL' end,
      'authenticated_select=' || v_authenticated_select || ' anon_select=' || v_anon_select);
exception when others then
  insert into zz_pp_test_results(section, test_name, status, details)
    values ('5', '5.2 grants de leitura de product_plates', 'FAIL', sqlerrm);
end $$;

-- 5.3 — set_product_filaments (RPC legada) continua sem NENHUM EXECUTE —
-- desativada só para escrita operacional, função preservada (não apagada).
do $$
declare
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
begin
  select has_function_privilege('anon', 'public.set_product_filaments(uuid,jsonb,uuid)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.set_product_filaments(uuid,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.set_product_filaments(uuid,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('5', '5.3 set_product_filaments (legada) sem EXECUTE para nenhum papel — desativada só para escrita, função preservada',
      case when not v_anon_can_execute and not v_authenticated_can_execute and not v_service_role_can_execute
           then 'PASS' else 'FAIL' end,
      'anon=' || v_anon_can_execute || ' authenticated=' || v_authenticated_can_execute || ' service_role=' || v_service_role_can_execute);
exception when others then
  insert into zz_pp_test_results(section, test_name, status, details)
    values ('5', '5.3 grants de set_product_filaments', 'FAIL', sqlerrm);
end $$;

-- 5.4 — validate_catalog_production_structure_for_creation (função atual):
-- zero grants; corpo real (pg_get_functiondef) NUNCA referencia
-- product_filaments NEM product_plate_filaments — prova estrutural de que
-- filamento não importa mais para esta validação, de nenhuma forma; ambas
-- as tabelas legadas preservadas (to_regclass não nulo).
do $$
declare
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
  v_function_body text;
  v_product_filaments_exists boolean;
  v_product_plate_filaments_exists boolean;
begin
  select has_function_privilege('anon', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE') into v_service_role_can_execute;
  select pg_get_functiondef('public.validate_catalog_production_structure_for_creation(jsonb)'::regprocedure) into v_function_body;
  select (to_regclass('public.product_filaments') is not null) into v_product_filaments_exists;
  select (to_regclass('public.product_plate_filaments') is not null) into v_product_plate_filaments_exists;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('5', '5.4 validate_catalog_production_structure_for_creation sem grants; corpo real NUNCA referencia filamento (nem product_filaments nem product_plate_filaments); tabelas legadas preservadas',
      case when not v_anon_can_execute and not v_authenticated_can_execute and not v_service_role_can_execute
             and v_function_body not ilike '%product_filaments%'
             and v_function_body not ilike '%product_plate_filaments%'
             and v_function_body ilike '%product_plates%'
             and v_product_filaments_exists and v_product_plate_filaments_exists
           then 'PASS' else 'FAIL' end,
      'grants(anon/auth/service)=' || v_anon_can_execute || '/' || v_authenticated_can_execute || '/' || v_service_role_can_execute ||
      ' references_product_filaments=' || (v_function_body ilike '%product_filaments%') ||
      ' references_product_plate_filaments=' || (v_function_body ilike '%product_plate_filaments%') ||
      ' product_filaments_exists=' || v_product_filaments_exists ||
      ' product_plate_filaments_exists=' || v_product_plate_filaments_exists);
exception when others then
  insert into zz_pp_test_results(section, test_name, status, details)
    values ('5', '5.4 corpo/grants de validate_catalog_production_structure_for_creation', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- Resumo
-- =============================================================================
select
  (select count(*) from zz_pp_test_results where status = 'PASS') as pass_count,
  (select count(*) from zz_pp_test_results where status = 'FAIL') as fail_count,
  (select count(*) from zz_pp_test_results) as total_count,
  (select json_agg(json_build_object('section', section, 'test_name', test_name, 'status', status, 'details', details) order by seq) from zz_pp_test_results) as results;

rollback;
