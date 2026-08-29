-- =============================================================================
-- Forma Sky — Módulo 3, Incremento 6A (composição de Filamentos no Produto)
-- TESTE DE INTEGRAÇÃO complementar a supabase/tests/filament_inventory_test.sql
-- Seção 8 (que já cobre: grava composição com 1 item, substituição por
-- conjunto vazio, filament_type_id inexistente, peso <= 0, bloqueio de
-- exclusão de tipo vinculado).
--
-- Este script cobre especificamente os cenários que a Seção 8 NÃO cobre,
-- pedidos na auditoria do Incremento 6A: múltiplos tipos/pesos válidos na
-- mesma composição, duplicidade do mesmo filament_type_id no mesmo array
-- (defesa em profundidade no banco — a Edge Function já bloqueia isso antes
-- de chamar a RPC, mas a RPC precisa recusar mesmo assim se chamada
-- diretamente), peso negativo (a Seção 8 só testa zero) e tipo INATIVO
-- (existente, mas is_active = false — distinto de "não existe").
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nenhum dado criado por este
-- script persiste no banco. Usa somente produto/tipos "TESTE%", nunca dados
-- oficiais ou Petlink.
--
-- Execução:
--   npx supabase db query --linked --file supabase/tests/product_filaments_composition_test.sql

begin;

create temporary table zz_pf_test_results (
  seq serial primary key,
  test_name text not null,
  status text not null,
  details text
);

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_type_a uuid;
  v_type_b uuid;
  v_type_inactive uuid;
  v_count integer;
  v_weight_a numeric;
  v_weight_b numeric;
begin
  -- Setup: usuário ativo existente (não cria usuário novo), produto TESTE,
  -- dois tipos de filamento TESTE ativos e um tipo TESTE inativo.
  select id into v_user_id from public.users where is_active limit 1;
  if v_user_id is null then
    raise exception 'setup: nenhum usuário ativo encontrado para o teste';
  end if;

  v_product_id := public.create_product(
    'TESTE INCREMENTO 6A — Produto Composição Filamentos', 'CATALOG', 'teste',
    'produto criado pelo script de teste de composição de filamentos', 100.00, 120, 25.50, 4, null, false, v_user_id
  );

  v_type_a := (public.create_filament_type('PLA', 'TESTE Marca A', 'Sólida', 'Preto', null, null, true, null, v_user_id)).id;
  v_type_b := (public.create_filament_type('PLA', 'TESTE Marca B', 'Sólida', 'Branco', null, null, true, null, v_user_id)).id;
  v_type_inactive := (public.create_filament_type('PETG', 'TESTE Marca C', 'Sólida', 'Cinza', null, null, true, null, v_user_id)).id;
  perform public.update_filament_type(v_type_inactive, jsonb_build_object('is_active', false), v_user_id);

  insert into zz_pf_test_results(test_name, status, details)
    values ('0. setup: produto + 2 tipos ativos + 1 tipo inativo criados', 'PASS',
      'product_id=' || v_product_id || ' type_a=' || v_type_a || ' type_b=' || v_type_b || ' type_inactive=' || v_type_inactive);

  -- 1. Múltiplos tipos + pesos válidos (dois itens, dois tipos distintos).
  begin
    perform public.set_product_filaments(
      v_product_id,
      jsonb_build_array(
        jsonb_build_object('id', v_type_a, 'theoretical_weight_grams', 12.5),
        jsonb_build_object('id', v_type_b, 'theoretical_weight_grams', 3.75)
      ),
      v_user_id
    );
    select count(*) into v_count from public.product_filaments where product_id = v_product_id;
    select theoretical_weight_grams into v_weight_a from public.product_filaments where product_id = v_product_id and filament_type_id = v_type_a;
    select theoretical_weight_grams into v_weight_b from public.product_filaments where product_id = v_product_id and filament_type_id = v_type_b;
    insert into zz_pf_test_results(test_name, status, details)
      values ('1. grava composição com múltiplos tipos e pesos fracionários distintos',
        case when v_count = 2 and v_weight_a = 12.5 and v_weight_b = 3.75 then 'PASS' else 'FAIL' end,
        'count=' || v_count || ' weight_a=' || v_weight_a || ' weight_b=' || v_weight_b);
  exception when others then
    insert into zz_pf_test_results(test_name, status, details)
      values ('1. grava composição com múltiplos tipos e pesos fracionários distintos', 'FAIL', sqlerrm);
  end;

  -- 2. Duplicidade do mesmo filament_type_id no mesmo array — deve ser
  -- rejeitada (unique_violation no INSERT, dentro da própria RPC).
  begin
    perform public.set_product_filaments(
      v_product_id,
      jsonb_build_array(
        jsonb_build_object('id', v_type_a, 'theoretical_weight_grams', 10),
        jsonb_build_object('id', v_type_a, 'theoretical_weight_grams', 20)
      ),
      v_user_id
    );
    insert into zz_pf_test_results(test_name, status, details)
      values ('2. rejeita o mesmo filament_type_id repetido no mesmo array', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_pf_test_results(test_name, status, details)
      values ('2. rejeita o mesmo filament_type_id repetido no mesmo array',
        case when sqlerrm like '%duplicate key%' or sqlerrm like '%unique%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  -- 2b. Confirma que a tentativa 2 (que falhou) não deixou resíduo parcial —
  -- a composição válida da etapa 1 deve continuar intacta (2 linhas).
  select count(*) into v_count from public.product_filaments where product_id = v_product_id;
  insert into zz_pf_test_results(test_name, status, details)
    values ('2b. falha de duplicidade não corrompe a composição anterior (atomicidade)',
      case when v_count = 2 then 'PASS' else 'FAIL' end, 'count=' || v_count);

  -- 3. Peso negativo (Seção 8 do teste de filamentos só cobre peso = 0).
  begin
    perform public.set_product_filaments(
      v_product_id,
      jsonb_build_array(jsonb_build_object('id', v_type_a, 'theoretical_weight_grams', -5)),
      v_user_id
    );
    insert into zz_pf_test_results(test_name, status, details)
      values ('3. rejeita theoretical_weight_grams negativo', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_pf_test_results(test_name, status, details)
      values ('3. rejeita theoretical_weight_grams negativo', 'PASS', sqlerrm);
  end;

  -- 4. Tipo INATIVO (existe, mas is_active = false) — distinto de "não
  -- existe" (já coberto na Seção 8.3 do outro script).
  begin
    perform public.set_product_filaments(
      v_product_id,
      jsonb_build_array(jsonb_build_object('id', v_type_inactive, 'theoretical_weight_grams', 10)),
      v_user_id
    );
    insert into zz_pf_test_results(test_name, status, details)
      values ('4. rejeita tipo de filamento inativo (existente, mas is_active=false)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_pf_test_results(test_name, status, details)
      values ('4. rejeita tipo de filamento inativo (existente, mas is_active=false)',
        case when sqlerrm like '%não encontrado ou inativo%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;

  -- 5. Conjunto vazio permitido (substitui pelo vazio, remove tudo).
  begin
    perform public.set_product_filaments(v_product_id, '[]'::jsonb, v_user_id);
    select count(*) into v_count from public.product_filaments where product_id = v_product_id;
    insert into zz_pf_test_results(test_name, status, details)
      values ('5. conjunto vazio é permitido e remove a composição anterior',
        case when v_count = 0 then 'PASS' else 'FAIL' end, 'count=' || v_count);
  exception when others then
    insert into zz_pf_test_results(test_name, status, details)
      values ('5. conjunto vazio é permitido e remove a composição anterior', 'FAIL', sqlerrm);
  end;

  -- 6. filaments ausente (null) do corpo é equivalente a array vazio — mesmo
  -- contrato usado pela Edge Function (validateFilamentCompositionItems
  -- retorna [] quando o campo está ausente/nulo).
  begin
    perform public.set_product_filaments(
      v_product_id,
      jsonb_build_array(jsonb_build_object('id', v_type_a, 'theoretical_weight_grams', 7)),
      v_user_id
    );
    perform public.set_product_filaments(v_product_id, null, v_user_id);
    select count(*) into v_count from public.product_filaments where product_id = v_product_id;
    insert into zz_pf_test_results(test_name, status, details)
      values ('6. p_filaments = null é tratado como composição vazia',
        case when v_count = 0 then 'PASS' else 'FAIL' end, 'count=' || v_count);
  exception when others then
    insert into zz_pf_test_results(test_name, status, details)
      values ('6. p_filaments = null é tratado como composição vazia', 'FAIL', sqlerrm);
  end;
end $$;

select
  (select count(*) from zz_pf_test_results where status = 'PASS') as pass_count,
  (select count(*) from zz_pf_test_results where status = 'FAIL') as fail_count,
  (select count(*) from zz_pf_test_results) as total_count,
  (select json_agg(json_build_object('test_name', test_name, 'status', status, 'details', details) order by seq) from zz_pf_test_results) as results;

rollback;
