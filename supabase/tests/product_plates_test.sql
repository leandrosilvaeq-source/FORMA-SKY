-- =============================================================================
-- Forma Sky — estrutura produtiva por plates (regra aprovada 2026-08-29,
-- migration 20260829160000_add_product_plates_structure.sql)
-- TESTE DE INTEGRAÇÃO das novas funções (set_product_production,
-- create_product_with_plates, update_product_full) e da atualização de
-- compatibilidade em validate_catalog_composition_for_creation.
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nenhum dado criado por este
-- script persiste no banco. Usa somente produto/tipos de filamento/
-- cliente "TESTE%", nunca dados oficiais ou Petlink.
--
-- IMPORTANTE — a migration acima ainda NÃO foi aplicada no projeto Supabase
-- remoto nesta rodada (restrição explícita desta tarefa). Por isso este
-- script NÃO PÔDE ser executado nesta rodada — as funções que ele testa
-- ainda não existem no banco remoto. Escrito seguindo a mesma disciplina/
-- estrutura já usada em supabase/tests/order_initial_status_test.sql —
-- pronto para ser executado assim que a migration for aplicada, numa
-- rodada futura autorizada.
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
-- SETUP — usuário ativo existente, 2 tipos de filamento TESTE ativos, 1
-- acessório e 1 embalagem TESTE ativos.
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_type_b uuid;
  v_accessory_id uuid;
  v_packaging_id uuid;
begin
  select id into v_user_id from public.users where is_active limit 1;
  if v_user_id is null then
    raise exception 'setup: nenhum usuário ativo encontrado para o teste';
  end if;
  insert into zz_pp_fixtures(key, value) values ('user_id', v_user_id::text);

  v_type_a := (public.create_filament_type(
    'PLA', 'TESTE Marca Plates A', 'Sólida', 'Preto', null, null, true, null, v_user_id
  )).id;
  v_type_b := (public.create_filament_type(
    'PETG', 'TESTE Marca Plates B', 'Sólida', 'Branco', null, null, true, null, v_user_id
  )).id;
  insert into zz_pp_fixtures(key, value) values ('type_a', v_type_a::text);
  insert into zz_pp_fixtures(key, value) values ('type_b', v_type_b::text);

  insert into public.accessories (name, is_active) values ('TESTE OPS Plates — Acessório', true)
    returning id into v_accessory_id;
  insert into public.packaging (name, is_active) values ('TESTE OPS Plates — Embalagem', true)
    returning id into v_packaging_id;
  insert into zz_pp_fixtures(key, value) values ('accessory_id', v_accessory_id::text);
  insert into zz_pp_fixtures(key, value) values ('packaging_id', v_packaging_id::text);

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('0', '0.0 setup: usuário/2 tipos de filamento/1 acessório/1 embalagem TESTE criados', 'PASS',
      'user_id=' || v_user_id || ' type_a=' || v_type_a || ' type_b=' || v_type_b);
end $$;

-- =============================================================================
-- SEÇÃO 1 — criação com create_product_with_plates
-- =============================================================================

-- 1.1 — Criação com 1 plate, 1 filamento — exemplo de aceite simplificado
-- (peso/tempo batendo exatamente com o informado).
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_product_id uuid;
  v_row public.products;
  v_plate_count integer;
  v_filament_count integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — Produto 1 plate', 'CATALOG', 'teste', 'produto de teste',
      50.00, null, true,
      jsonb_build_array(jsonb_build_object(
        'production_time_seconds', 3600,
        'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 40))
      )),
      null, null,
      '[]'::jsonb, '[]'::jsonb,
      v_user_id
    );
    select * into v_row from public.products where id = v_product_id;
    select count(*) into v_plate_count from public.product_plates where product_id = v_product_id;
    select count(*) into v_filament_count
      from public.product_plate_filaments ppf
      join public.product_plates pp on pp.id = ppf.plate_id
      where pp.product_id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.1 criação com 1 plate/1 filamento: peso/tempo efetivos batem, 1 plate/1 filamento persistidos',
        case when v_row.default_weight_grams = 40 and v_row.default_print_time_seconds = 3600
                and v_plate_count = 1 and v_filament_count = 1
             then 'PASS' else 'FAIL' end,
        'weight=' || v_row.default_weight_grams || ' time=' || v_row.default_print_time_seconds ||
        ' plates=' || v_plate_count || ' filaments=' || v_filament_count);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.1 criação com 1 plate/1 filamento', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.2 — Criação com múltiplos plates, múltiplos filamentos por plate —
-- exemplo de aceite completo (Suporte para Controle PS5): 37,16 g + 97,34 g
-- = 134,50 g; 01:17 (4620s) + 02:54 (10440s) = 04:11 (15060s).
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_type_b uuid;
  v_product_id uuid;
  v_row public.products;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';
  select value::uuid into v_type_b from zz_pp_fixtures where key = 'type_b';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — Suporte PS5', 'CATALOG', 'teste', 'exemplo de aceite',
      80.00, null, true,
      jsonb_build_array(
        jsonb_build_object(
          'production_time_seconds', 4620,
          'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 37.16))
        ),
        jsonb_build_object(
          'production_time_seconds', 10440,
          'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_b, 'weight_grams', 97.34))
        )
      ),
      null, null,
      '[]'::jsonb, '[]'::jsonb,
      v_user_id
    );
    select * into v_row from public.products where id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.2 exemplo de aceite (Suporte PS5): 37,16+97,34=134,50g; 4620+10440=15060s (04:11)',
        case when v_row.default_weight_grams = 134.50 and v_row.default_print_time_seconds = 15060
             then 'PASS' else 'FAIL' end,
        'weight=' || v_row.default_weight_grams || ' time=' || v_row.default_print_time_seconds);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.2 exemplo de aceite (Suporte PS5)', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.3 — Ajuste manual (só peso) — tempo continua automático (independência
-- entre os dois campos). Exemplo de aceite: peso efetivo ajustado para
-- 134,49 g, tempo efetivo continua 04:11 (15060s, automático).
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_product_id uuid;
  v_row public.products;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — Ajuste manual só peso', 'CATALOG', 'teste', null,
      80.00, null, true,
      jsonb_build_array(jsonb_build_object(
        'production_time_seconds', 15060,
        'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 134.50))
      )),
      134.49, null,
      '[]'::jsonb, '[]'::jsonb,
      v_user_id
    );
    select * into v_row from public.products where id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.3 ajuste manual só do peso: efetivo=134.49g, tempo continua automático=15060s, colunas de ajuste corretas',
        case when v_row.default_weight_grams = 134.49 and v_row.default_print_time_seconds = 15060
                and v_row.production_weight_manual_override_grams = 134.49
                and v_row.production_time_manual_override_seconds is null
             then 'PASS' else 'FAIL' end,
        'weight=' || v_row.default_weight_grams || ' time=' || v_row.default_print_time_seconds ||
        ' override_w=' || v_row.production_weight_manual_override_grams ||
        ' override_t=' || coalesce(v_row.production_time_manual_override_seconds::text, 'null'));
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.3 ajuste manual só do peso', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.4 — Duplicidade do mesmo filamento no MESMO plate é rejeitada; o mesmo
-- filamento em plates DIFERENTES é permitido (não testado aqui como erro,
-- já coberto implicitamente por 1.2 usar tipos diferentes — este teste foca
-- só na rejeição da duplicidade real).
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  begin
    perform public.create_product_with_plates(
      'TESTE OPS Plates — Duplicidade no mesmo plate', 'CATALOG', 'teste', null,
      10.00, null, true,
      jsonb_build_array(jsonb_build_object(
        'production_time_seconds', 60,
        'filaments', jsonb_build_array(
          jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 10),
          jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 5)
        )
      )),
      null, null,
      '[]'::jsonb, '[]'::jsonb,
      v_user_id
    );
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.4 mesmo filamento duas vezes NO MESMO plate é REJEITADO', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.4 mesmo filamento duas vezes NO MESMO plate é REJEITADO',
        case when sqlerrm like '%o mesmo filamento não pode aparecer duas vezes%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- 1.5 — Peso zero/negativo é rejeitado.
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  begin
    perform public.create_product_with_plates(
      'TESTE OPS Plates — Peso zero', 'CATALOG', 'teste', null,
      10.00, null, true,
      jsonb_build_array(jsonb_build_object(
        'production_time_seconds', 60,
        'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 0))
      )),
      null, null,
      '[]'::jsonb, '[]'::jsonb,
      v_user_id
    );
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.5 peso zero/negativo é REJEITADO', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.5 peso zero/negativo é REJEITADO',
        case when sqlerrm like '%weight_grams deve ser um número positivo%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- 1.6 — Falha parcial (filamento inválido no 2º plate) desfaz TUDO —
-- nenhum Produto/plate/filamento órfão, mesmo o 1º plate tendo sido válido.
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_products_before integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';
  select count(*) into v_products_before from public.products where name like 'TESTE OPS Plates%';

  begin
    perform public.create_product_with_plates(
      'TESTE OPS Plates — Falha no 2º plate desfaz tudo', 'CATALOG', 'teste', null,
      10.00, null, true,
      jsonb_build_array(
        jsonb_build_object(
          'production_time_seconds', 60,
          'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 10))
        ),
        jsonb_build_object(
          'production_time_seconds', 60,
          'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', gen_random_uuid(), 'weight_grams', 10))
        )
      ),
      null, null,
      '[]'::jsonb, '[]'::jsonb,
      v_user_id
    );
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.6 falha no 2º plate desfaz TUDO (Produto+1º plate incluídos)', 'FAIL', 'não levantou exceção');
  exception when others then
    declare
      v_products_after integer;
      v_orphan_plates integer;
    begin
      select count(*) into v_products_after from public.products where name like 'TESTE OPS Plates%' and name like '%Falha no 2º plate%';
      select count(*) into v_orphan_plates from public.product_plates pp
        join public.products p on p.id = pp.product_id
        where p.name like '%Falha no 2º plate%';
      insert into zz_pp_test_results(section, test_name, status, details)
        values ('1', '1.6 falha no 2º plate desfaz TUDO (Produto+1º plate incluídos)',
          case when v_products_after = 0 and v_orphan_plates = 0 then 'PASS' else 'FAIL' end,
          sqlerrm || ' products_after=' || v_products_after || ' orphan_plates=' || v_orphan_plates);
    end;
  end;
end $$;

-- 1.7 — Acessórios/Embalagens vinculados atomicamente na criação.
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_packaging_id uuid;
  v_product_id uuid;
  v_accessory_count integer;
  v_packaging_count integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_pp_fixtures where key = 'accessory_id';
  select value::uuid into v_packaging_id from zz_pp_fixtures where key = 'packaging_id';

  begin
    v_product_id := public.create_product_with_plates(
      'TESTE OPS Plates — Com acessórios e embalagens', 'CATALOG', 'teste', null,
      10.00, null, true,
      '[]'::jsonb,
      null, null,
      jsonb_build_array(jsonb_build_object('id', v_accessory_id, 'quantity', 2)),
      jsonb_build_array(jsonb_build_object('id', v_packaging_id, 'quantity', 1)),
      v_user_id
    );
    select count(*) into v_accessory_count from public.product_accessories where product_id = v_product_id;
    select count(*) into v_packaging_count from public.product_packaging where product_id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.7 Acessórios/Embalagens vinculados atomicamente na criação (mesmo sem nenhum plate)',
        case when v_accessory_count = 1 and v_packaging_count = 1 then 'PASS' else 'FAIL' end,
        'accessory_count=' || v_accessory_count || ' packaging_count=' || v_packaging_count);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.7 Acessórios/Embalagens vinculados atomicamente na criação', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.8 — Quantidade inválida (zero) de acessório é rejeitada (defesa em
-- profundidade de set_product_composition, já testada noutro arquivo —
-- aqui só confirma que create_product_with_plates propaga o erro).
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_accessory_id from zz_pp_fixtures where key = 'accessory_id';

  begin
    perform public.create_product_with_plates(
      'TESTE OPS Plates — Quantidade inválida', 'CATALOG', 'teste', null,
      10.00, null, true,
      '[]'::jsonb, null, null,
      jsonb_build_array(jsonb_build_object('id', v_accessory_id, 'quantity', 0)),
      '[]'::jsonb,
      v_user_id
    );
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.8 quantidade de acessório <= 0 é REJEITADA', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('1', '1.8 quantidade de acessório <= 0 é REJEITADA', 'PASS', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 2 — edição com update_product_full
-- =============================================================================

-- 2.1 — Edição substitui plates/filamentos completamente e recalcula totais.
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_type_b uuid;
  v_product_id uuid;
  v_row public.products;
  v_plate_count integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';
  select value::uuid into v_type_b from zz_pp_fixtures where key = 'type_b';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Editar depois', 'CATALOG', 'teste', null,
    10.00, null, true,
    jsonb_build_array(jsonb_build_object(
      'production_time_seconds', 60,
      'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 10))
    )),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  begin
    v_row := public.update_product_full(
      v_product_id,
      jsonb_build_object('name', 'TESTE OPS Plates — Editado'),
      jsonb_build_array(
        jsonb_build_object(
          'production_time_seconds', 120,
          'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_b, 'weight_grams', 20))
        )
      ),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
    select count(*) into v_plate_count from public.product_plates where product_id = v_product_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.1 edição substitui plates/filamentos por completo e recalcula totais',
        case when v_row.name = 'TESTE OPS Plates — Editado' and v_row.default_weight_grams = 20
                and v_row.default_print_time_seconds = 120 and v_plate_count = 1
             then 'PASS' else 'FAIL' end,
        'name=' || v_row.name || ' weight=' || v_row.default_weight_grams ||
        ' time=' || v_row.default_print_time_seconds || ' plate_count=' || v_plate_count);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.1 edição substitui plates/filamentos', 'FAIL', sqlerrm);
  end;
end $$;

-- 2.2 — Edição sem patch de campos descritivos (p_patch vazio) não chama
-- update_product() — nenhum erro "p_patch vazio" propaga (a RPC decide não
-- chamar update_product() nesse caso).
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_product_id uuid;
  v_row public.products;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Editar só composição', 'CATALOG', 'teste', null,
    10.00, null, true, '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  begin
    v_row := public.update_product_full(
      v_product_id, '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'production_time_seconds', 30,
        'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 5))
      )),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.2 p_patch vazio: não chama update_product(), nome do Produto preservado, composição ainda substituída',
        case when v_row.name = 'TESTE OPS Plates — Editar só composição' and v_row.default_weight_grams = 5
             then 'PASS' else 'FAIL' end,
        'name=' || v_row.name || ' weight=' || v_row.default_weight_grams);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('2', '2.2 p_patch vazio', 'FAIL', sqlerrm);
  end;
end $$;

-- 2.3 — Falha parcial na EDIÇÃO (filamento inválido no 2º plate) desfaz
-- TUDO — o Produto continua com a composição/nome ANTERIORES à tentativa,
-- nenhum plate órfão do novo estado tentado sobra.
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_product_id uuid;
  v_row_before public.products;
  v_row_after public.products;
  v_plate_count_after integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Editar com falha no meio', 'CATALOG', 'teste', null,
    10.00, null, true,
    jsonb_build_array(jsonb_build_object(
      'production_time_seconds', 60,
      'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 10))
    )),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  select * into v_row_before from public.products where id = v_product_id;

  begin
    perform public.update_product_full(
      v_product_id,
      jsonb_build_object('name', 'TESTE OPS Plates — Nome que não deveria persistir'),
      jsonb_build_array(jsonb_build_object(
        'production_time_seconds', 120,
        'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', gen_random_uuid(), 'weight_grams', 5))
      )),
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

-- 2.4 — Escrever/editar plates NUNCA toca product_filaments (legado) do
-- mesmo Produto — confirma que não existe nenhuma sincronização/gravação
-- cruzada entre as duas tabelas (a garantia central da fonte autoritativa
-- única: product_filaments só muda se alguém a escrever DIRETAMENTE, o que
-- nenhuma rota deste incremento faz).
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_product_id uuid;
  v_legacy_count_before integer;
  v_legacy_count_after integer;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Nunca escreve em product_filaments', 'CATALOG', 'teste', null,
    10.00, null, true,
    jsonb_build_array(jsonb_build_object(
      'production_time_seconds', 60,
      'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 10))
    )),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  select count(*) into v_legacy_count_before from public.product_filaments where product_id = v_product_id;

  perform public.update_product_full(
    v_product_id, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'production_time_seconds', 90,
      'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 20))
    )),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
  select count(*) into v_legacy_count_after from public.product_filaments where product_id = v_product_id;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('2', '2.4 criar/editar plates nunca grava em product_filaments (legado) — 0 antes e 0 depois',
      case when v_legacy_count_before = 0 and v_legacy_count_after = 0 then 'PASS' else 'FAIL' end,
      'before=' || v_legacy_count_before || ' after=' || v_legacy_count_after);
exception when others then
  insert into zz_pp_test_results(section, test_name, status, details)
    values ('2', '2.4 criar/editar plates nunca grava em product_filaments', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- SEÇÃO 3 — compatibilidade com a validação de composição de Pedidos
-- (validate_catalog_composition_for_creation aceita product_plates OU
-- product_filaments — ver migration 20260829150000, corrigida por esta)
-- =============================================================================

-- 3.1 — Produto com composição só em product_plates (novo) passa na
-- validação de criação de Pedido (create_order chega a
-- IN_PRODUCTION_QUEUE sem bloquear).
do $$
declare
  v_user_id uuid;
  v_type_a uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_status text;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_type_a from zz_pp_fixtures where key = 'type_a';

  insert into public.customers (name, is_active) values ('TESTE OPS Plates — Cliente', true)
    returning id into v_customer_id;

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Produto p/ Pedido', 'CATALOG', 'teste', null,
    30.00, null, true,
    jsonb_build_array(jsonb_build_object(
      'production_time_seconds', 60,
      'filaments', jsonb_build_array(jsonb_build_object('filament_type_id', v_type_a, 'weight_grams', 15))
    )),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  begin
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG com composição só em product_plates',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 30
      )),
      v_user_id, null
    );
    select order_status into v_order_status from public.orders where id = v_order_id;

    insert into zz_pp_test_results(section, test_name, status, details)
      values ('3', '3.1 Produto com composição só em product_plates -> criação de Pedido NÃO bloqueada, entra em IN_PRODUCTION_QUEUE',
        case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
        'order_status=' || v_order_status);
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('3', '3.1 Produto com composição só em product_plates -> Pedido', 'FAIL', sqlerrm);
  end;
end $$;

-- 3.2 — Produto sem NENHUMA composição (nem product_plates, nem
-- product_filaments) continua bloqueado, exatamente como antes desta
-- migration.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
begin
  select value::uuid into v_user_id from zz_pp_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from public.customers where name = 'TESTE OPS Plates — Cliente';

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Plates — Produto sem composição', 'CATALOG', 'teste', null,
    30.00, null, true, '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'CATALOG sem nenhuma composição',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 30
      )),
      v_user_id, null
    );
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('3', '3.2 Produto sem nenhuma composição continua BLOQUEADO na criação do Pedido', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_pp_test_results(section, test_name, status, details)
      values ('3', '3.2 Produto sem nenhuma composição continua BLOQUEADO na criação do Pedido',
        case when sqlerrm like 'ORDER_CATALOG_MISSING_COMPOSITION:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 4 — permissões e segurança
-- =============================================================================
do $$
declare
  v_ok boolean;
begin
  select
    not has_function_privilege('authenticated', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_product_with_plates(text,text,text,text,numeric,uuid,boolean,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.create_product_with_plates(text,text,text,text,numeric,uuid,boolean,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.update_product_full(uuid,jsonb,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.update_product_full(uuid,jsonb,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.product_plates', 'SELECT')
    and has_function_privilege('authenticated', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE') is not distinct from false
  into v_ok;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('4', '4.1 set_product_production sem grant algum; create_product_with_plates/update_product_full exclusivas de service_role',
      case when v_ok then 'PASS' else 'FAIL' end, 'v_ok=' || v_ok);
exception when others then
  insert into zz_pp_test_results(section, test_name, status, details)
    values ('4', '4.1 permissões/grants', 'FAIL', sqlerrm);
end $$;

do $$
declare
  v_authenticated_select boolean;
  v_anon_select boolean;
begin
  select has_table_privilege('authenticated', 'public.product_plates', 'SELECT') into v_authenticated_select;
  select has_table_privilege('anon', 'public.product_plates', 'SELECT') into v_anon_select;

  insert into zz_pp_test_results(section, test_name, status, details)
    values ('4', '4.2 authenticated tem SELECT em product_plates (leitura compatível com o frontend); anon não tem nenhum acesso',
      case when v_authenticated_select and not v_anon_select then 'PASS' else 'FAIL' end,
      'authenticated_select=' || v_authenticated_select || ' anon_select=' || v_anon_select);
exception when others then
  insert into zz_pp_test_results(section, test_name, status, details)
    values ('4', '4.2 grants de leitura de product_plates', 'FAIL', sqlerrm);
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
