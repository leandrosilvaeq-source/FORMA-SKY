-- =============================================================================
-- Forma Sky — categorias múltiplas, peso direto no plate e cores no Pedido
-- (migration 20260829180000_add_categories_plate_weight_and_order_colors.sql)
-- TESTE DE INTEGRAÇÃO transacional das novas funções (set_product_categories,
-- set_product_production redefinida sem filamentos, create_product_with_plates/
-- update_product_full redefinidas com p_categories, validate_catalog_
-- production_structure_for_creation, create_order — snapshot order_item_plates
-- + production_colors opcionais —, update_order_item_production_colors,
-- validate_order_production_readiness e o gate novo em change_order_status).
--
-- AMPLIADO NESTA RODADA CORRETIVA (2026-08-30) — Seção 7 (nova): a regra de
-- congelamento de cores foi revisada — update_order_item_production_colors
-- passa a usar uma allow-list explícita (QUOTE/WAITING_APPROVAL/APPROVED/
-- IN_PRODUCTION_QUEUE), nunca uma lista de bloqueio; testados os 8 status
-- reais da máquina de estados individualmente, unit_number/plate_number/
-- filament_type_id inexistentes na atualização pós-criação, e a limpeza de
-- cores antigas ao editar itens (update_quote_order) por mudança de
-- quantidade.
--
-- CORRIGIDO NESTA RODADA (2026-08-30, após 1ª execução real contra o remoto
-- já migrado) — Seções 1.2/1.4 usavam `select public.update_product_full(...)
-- into v_row;`, que falha com "invalid input syntax for type uuid" ao chamar
-- uma função SECURITY DEFINER que retorna public.products dessa forma
-- (confirmado por reprodução isolada); trocado para `v_row :=
-- public.update_product_full(...);`, forma que funciona corretamente e já é
-- usada em outros pontos deste arquivo. Bug do script de teste, não da
-- migration nem das funções testadas.
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nenhum dado criado por este
-- script persiste no banco. Usa somente cliente/produto/tipo de filamento
-- "TESTE%", nunca dados oficiais ou Petlink.
--
-- IMPORTANTE — a migration acima ainda NÃO foi aplicada no projeto Supabase
-- remoto nesta rodada (restrição explícita desta tarefa: "não aplique a
-- migration"). Por isso este script NÃO PÔDE ser executado nesta rodada — as
-- funções que ele testa ainda não existem no banco remoto. Escrito seguindo a
-- mesma disciplina/estrutura já usada em supabase/tests/product_plates_test.sql
-- e supabase/tests/order_initial_status_test.sql — pronto para ser executado
-- assim que a migration for aplicada, numa rodada futura autorizada.
--
-- ESCOPO — cobertura representativa (não exaustiva, decisão explícita desta
-- rodada dado o tamanho do incremento): cada seção cobre o caminho principal
-- e os desvios mais importantes de cada função nova/redefinida; não tenta
-- replicar a exaustividade de 80+ casos por arquivo já vista em rodadas de
-- escopo menor. supabase/tests/bloco1_integration_test.sql (35 falhas
-- estruturais pré-existentes, não relacionadas a este incremento) permanece
-- fora de escopo, sem nenhuma tentativa de correção aqui.
--
-- Execução (quando a migration estiver aplicada):
--   npx supabase db query --linked --file supabase/tests/product_categories_plate_weight_order_colors_test.sql

begin;

create temporary table zz_cpo_test_results (
  seq serial primary key,
  section text not null,
  test_name text not null,
  status text not null,
  details text
);

create temporary table zz_cpo_fixtures (
  key text primary key,
  value text not null
);

-- =============================================================================
-- SETUP — usuário ativo existente, cliente TESTE, 2 tipos de filamento TESTE
-- ativos (ft_a/ft_b) + 1 inativo (ft_inactive), 1 Produto CATALOG TESTE com 2
-- categorias e 2 plates (weight_grams direto, sem filamento).
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_ft_a uuid;
  v_ft_b uuid;
  v_ft_inactive uuid;
  v_product_id uuid;
  v_category_count integer;
  v_plate_count integer;
begin
  select id into v_user_id from public.users where is_active limit 1;
  if v_user_id is null then
    raise exception 'setup: nenhum usuário ativo encontrado para o teste';
  end if;
  insert into zz_cpo_fixtures(key, value) values ('user_id', v_user_id::text);

  insert into public.customers (name, is_active)
    values ('TESTE OPS — Cliente cores/categorias', true)
    returning id into v_customer_id;
  insert into zz_cpo_fixtures(key, value) values ('customer_id', v_customer_id::text);

  v_ft_a := (public.create_filament_type(
    'PLA', 'TESTE Marca Cores A', 'Sólida', 'Preto', null, null, true, null, v_user_id
  )).id;
  v_ft_b := (public.create_filament_type(
    'PETG', 'TESTE Marca Cores B', 'Sólida', 'Branco', null, null, true, null, v_user_id
  )).id;
  v_ft_inactive := (public.create_filament_type(
    'TPU', 'TESTE Marca Cores Inativo', 'Sólida', 'Cinza', null, null, false, null, v_user_id
  )).id;
  insert into zz_cpo_fixtures(key, value) values ('ft_a', v_ft_a::text);
  insert into zz_cpo_fixtures(key, value) values ('ft_b', v_ft_b::text);
  insert into zz_cpo_fixtures(key, value) values ('ft_inactive', v_ft_inactive::text);

  v_product_id := public.create_product_with_plates(
    'TESTE OPS Cores — Produto 2 plates', 'CATALOG',
    jsonb_build_array('Chaveiro', 'Decoração'),
    'produto de teste com 2 plates', 50.00, null, true,
    jsonb_build_array(
      jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 40),
      jsonb_build_object('production_time_seconds', 1800, 'weight_grams', 10)
    ),
    null, null,
    '[]'::jsonb, '[]'::jsonb,
    v_user_id
  );
  insert into zz_cpo_fixtures(key, value) values ('product_id', v_product_id::text);

  select count(*) into v_category_count from public.product_categories where product_id = v_product_id;
  select count(*) into v_plate_count from public.product_plates where product_id = v_product_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('0', '0.0 setup: usuário/cliente/3 tipos de filamento/1 produto (2 categorias, 2 plates) criados',
      case when v_category_count = 2 and v_plate_count = 2 then 'PASS' else 'FAIL' end,
      'user_id=' || v_user_id || ' product_id=' || v_product_id ||
      ' category_count=' || v_category_count || ' plate_count=' || v_plate_count);
end $$;

-- =============================================================================
-- SEÇÃO 1 — categorias múltiplas (set_product_categories via
-- create_product_with_plates/update_product_full)
-- =============================================================================

-- 1.1 — setup já provou 2 categorias em ordem — confirma position 1/2 e o
-- espelho products.category = categories[0].
do $$
declare
  v_product_id uuid;
  v_cat1 text;
  v_cat2 text;
  v_mirror text;
begin
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  select category into v_cat1 from public.product_categories where product_id = v_product_id and position = 1;
  select category into v_cat2 from public.product_categories where product_id = v_product_id and position = 2;
  select category into v_mirror from public.products where id = v_product_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('1', '1.1 position 1/2 na ordem enviada; products.category espelha position=1',
      case when v_cat1 = 'Chaveiro' and v_cat2 = 'Decoração' and v_mirror = 'Chaveiro'
           then 'PASS' else 'FAIL' end,
      'cat1=' || v_cat1 || ' cat2=' || v_cat2 || ' mirror=' || v_mirror);
end $$;

-- 1.2 — update_product_full substitui TODO o conjunto de categorias (nunca
-- incremental) — de 2 categorias para 1 categoria diferente.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row public.products;
  v_category_count integer;
  v_only_category text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  v_row := public.update_product_full(
    v_product_id, '{}'::jsonb,
    jsonb_build_array('Suporte'),
    jsonb_build_array(
      jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 40),
      jsonb_build_object('production_time_seconds', 1800, 'weight_grams', 10)
    ),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  select count(*) into v_category_count from public.product_categories where product_id = v_product_id;
  select category into v_only_category from public.product_categories where product_id = v_product_id and position = 1;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('1', '1.2 update_product_full substitui o conjunto inteiro (2 -> 1 categoria diferente)',
      case when v_category_count = 1 and v_only_category = 'Suporte' and v_row.category = 'Suporte'
           then 'PASS' else 'FAIL' end,
      'category_count=' || v_category_count || ' only=' || v_only_category || ' mirror=' || v_row.category);

  -- Restaura as 2 categorias originais para não afetar as seções seguintes.
  perform public.update_product_full(
    v_product_id, '{}'::jsonb,
    jsonb_build_array('Chaveiro', 'Decoração'),
    jsonb_build_array(
      jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 40),
      jsonb_build_object('production_time_seconds', 1800, 'weight_grams', 10)
    ),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
end $$;

-- 1.3 — categoria repetida no mesmo array é rejeitada.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  begin
    perform public.update_product_full(
      v_product_id, '{}'::jsonb,
      jsonb_build_array('Pet', 'Pet'),
      jsonb_build_array(jsonb_build_object('production_time_seconds', 0, 'weight_grams', 5)),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('1', '1.3 categoria repetida no mesmo array é rejeitada',
      case when v_raised and v_message ilike '%repetida%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- 1.4 — array vazio/null é válido: zero categorias, espelho volta a NULL.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_row public.products;
  v_category_count integer;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  v_row := public.update_product_full(
    v_product_id, '{}'::jsonb, '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 40),
      jsonb_build_object('production_time_seconds', 1800, 'weight_grams', 10)
    ),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  select count(*) into v_category_count from public.product_categories where product_id = v_product_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('1', '1.4 array de categorias vazio é válido: 0 linhas, products.category volta a NULL',
      case when v_category_count = 0 and v_row.category is null then 'PASS' else 'FAIL' end,
      'category_count=' || v_category_count || ' mirror=' || coalesce(v_row.category, '<null>'));

  -- Restaura as 2 categorias originais para as seções seguintes.
  perform public.update_product_full(
    v_product_id, '{}'::jsonb,
    jsonb_build_array('Chaveiro', 'Decoração'),
    jsonb_build_array(
      jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 40),
      jsonb_build_object('production_time_seconds', 1800, 'weight_grams', 10)
    ),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
end $$;

-- =============================================================================
-- SEÇÃO 2 — peso direto do plate (set_product_production sem filamentos)
-- =============================================================================

-- 2.1 — os 2 plates do setup têm weight_grams diretos corretos, tempo
-- correto, e NENHUMA linha em product_plate_filaments (nunca mais escrita).
do $$
declare
  v_product_id uuid;
  v_weight_1 numeric;
  v_weight_2 numeric;
  v_legacy_filament_count integer;
  v_effective_weight numeric;
  v_effective_time integer;
begin
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  select weight_grams into v_weight_1 from public.product_plates where product_id = v_product_id and plate_number = 1;
  select weight_grams into v_weight_2 from public.product_plates where product_id = v_product_id and plate_number = 2;
  select count(*) into v_legacy_filament_count
    from public.product_plate_filaments ppf
    join public.product_plates pp on pp.id = ppf.plate_id
    where pp.product_id = v_product_id;
  select default_weight_grams, default_print_time_seconds into v_effective_weight, v_effective_time
    from public.products where id = v_product_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('2', '2.1 weight_grams direto por plate (40/10), zero linhas legadas, efetivo = soma (50g/01:30:00)',
      case when v_weight_1 = 40 and v_weight_2 = 10 and v_legacy_filament_count = 0
             and v_effective_weight = 50 and v_effective_time = 5400
           then 'PASS' else 'FAIL' end,
      'weight_1=' || v_weight_1 || ' weight_2=' || v_weight_2 ||
      ' legacy_filament_count=' || v_legacy_filament_count ||
      ' effective_weight=' || v_effective_weight || ' effective_time=' || v_effective_time);
end $$;

-- 2.2 — plate sem weight_grams (null) é rejeitado.
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  begin
    perform public.update_product_full(
      v_product_id, '{}'::jsonb,
      jsonb_build_array('Chaveiro', 'Decoração'),
      jsonb_build_array(jsonb_build_object('production_time_seconds', 60)),
      null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('2', '2.2 plate sem weight_grams é rejeitado',
      case when v_raised and v_message ilike '%weight_grams%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));

  -- Confirma que os 2 plates originais permanecem intactos (rollback total
  -- da RPC — nenhuma alteração parcial).
  perform 1 from public.product_plates where product_id = v_product_id and plate_number = 2;
  if not found then
    insert into zz_cpo_test_results(section, test_name, status, details)
      values ('2', '2.2b plates originais preservados após falha (rollback total da RPC)', 'FAIL', 'Plate 2 desapareceu');
  else
    insert into zz_cpo_test_results(section, test_name, status, details)
      values ('2', '2.2b plates originais preservados após falha (rollback total da RPC)', 'PASS', null);
  end if;
end $$;

-- =============================================================================
-- SEÇÃO 3 — criação de Pedido: snapshot (order_item_plates) e validação de
-- estrutura produtiva SEM exigir filamento
-- =============================================================================

-- 3.1 — CATALOG com plates -> IN_PRODUCTION_QUEUE direto, snapshot de 2
-- plates com peso/tempo idênticos ao Produto no momento da criação.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_order_status text;
  v_snapshot_count integer;
  v_snapshot_weight_1 numeric;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — pedido 3.1',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 2, 'unit_price', 50
    )),
    v_user_id
  );
  insert into zz_cpo_fixtures(key, value) values ('order_id_31', v_order_id::text);

  select id into v_order_item_id from public.order_items where order_id = v_order_id;
  insert into zz_cpo_fixtures(key, value) values ('order_item_id_31', v_order_item_id::text);

  select order_status into v_order_status from public.orders where id = v_order_id;
  select count(*) into v_snapshot_count from public.order_item_plates where order_item_id = v_order_item_id;
  select weight_grams into v_snapshot_weight_1
    from public.order_item_plates where order_item_id = v_order_item_id and plate_number = 1;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('3', '3.1 CATALOG com plates -> IN_PRODUCTION_QUEUE direto, snapshot com 2 plates (peso igual ao Produto)',
      case when v_order_status = 'IN_PRODUCTION_QUEUE' and v_snapshot_count = 2 and v_snapshot_weight_1 = 40
           then 'PASS' else 'FAIL' end,
      'order_status=' || v_order_status || ' snapshot_count=' || v_snapshot_count || ' weight_1=' || v_snapshot_weight_1);
end $$;

-- 3.2 — editar o Produto DEPOIS de criado o Pedido nunca altera o snapshot
-- já congelado (imutabilidade do snapshot).
do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_order_item_id uuid;
  v_snapshot_weight_1_before numeric;
  v_snapshot_weight_1_after numeric;
  v_product_weight_1_after numeric;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_order_item_id from zz_cpo_fixtures where key = 'order_item_id_31';

  select weight_grams into v_snapshot_weight_1_before
    from public.order_item_plates where order_item_id = v_order_item_id and plate_number = 1;

  perform public.update_product_full(
    v_product_id, '{}'::jsonb,
    jsonb_build_array('Chaveiro', 'Decoração'),
    jsonb_build_array(
      jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 999),
      jsonb_build_object('production_time_seconds', 1800, 'weight_grams', 10)
    ),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );

  select weight_grams into v_snapshot_weight_1_after
    from public.order_item_plates where order_item_id = v_order_item_id and plate_number = 1;
  select weight_grams into v_product_weight_1_after
    from public.product_plates where product_id = v_product_id and plate_number = 1;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('3', '3.2 editar o Produto depois nunca altera o snapshot já congelado (order_item_plates imutável)',
      case when v_snapshot_weight_1_before = 40 and v_snapshot_weight_1_after = 40 and v_product_weight_1_after = 999
           then 'PASS' else 'FAIL' end,
      'snapshot_before=' || v_snapshot_weight_1_before || ' snapshot_after=' || v_snapshot_weight_1_after ||
      ' product_after=' || v_product_weight_1_after);

  -- Restaura o peso original do Produto (999 -> 40) para não afetar seções
  -- seguintes que criam novos pedidos a partir deste Produto.
  perform public.update_product_full(
    v_product_id, '{}'::jsonb,
    jsonb_build_array('Chaveiro', 'Decoração'),
    jsonb_build_array(
      jsonb_build_object('production_time_seconds', 3600, 'weight_grams', 40),
      jsonb_build_object('production_time_seconds', 1800, 'weight_grams', 10)
    ),
    null, null, '[]'::jsonb, '[]'::jsonb, v_user_id
  );
end $$;

-- 3.3 — CATALOG apontando para um Produto sem NENHUM plate bloqueia toda a
-- criação (ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:), listando o nome do
-- Produto — nunca exige filamento (só estrutura de plates).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_empty_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';

  v_product_empty_id := public.create_product(
    'TESTE OPS Cores — Produto sem plates', 'CATALOG', 'teste',
    'produto sem estrutura produtiva', 30.00, null, null, null, null, false, v_user_id
  );

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — pedido 3.3',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_empty_id,
        'item_name', 'Item sem plates', 'quantity', 1, 'unit_price', 30
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('3', '3.3 CATALOG sem nenhum plate bloqueia a criação (ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:), nunca exige filamento',
      case when v_raised and v_message ilike 'ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:%'
             and v_message ilike '%sem plates%'
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- =============================================================================
-- SEÇÃO 4 — production_colors OPCIONAIS na criação do Pedido
-- =============================================================================

-- 4.1 — Pedido criado SEM nenhuma cor: entra em IN_PRODUCTION_QUEUE
-- normalmente, zero linhas em order_item_unit_plate_filaments (cores
-- pendentes nunca bloqueiam a entrada na Fila).
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
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — pedido 4.x',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 2, 'unit_price', 50
    )),
    v_user_id
  );
  insert into zz_cpo_fixtures(key, value) values ('order_id_4x', v_order_id::text);

  select id into v_order_item_id from public.order_items where order_id = v_order_id;
  insert into zz_cpo_fixtures(key, value) values ('order_item_id_4x', v_order_item_id::text);

  select order_status into v_order_status from public.orders where id = v_order_id;
  select count(*) into v_color_count from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('4', '4.1 Pedido sem nenhuma cor entra em IN_PRODUCTION_QUEUE normalmente, 0 seleções',
      case when v_order_status = 'IN_PRODUCTION_QUEUE' and v_color_count = 0 then 'PASS' else 'FAIL' end,
      'order_status=' || v_order_status || ' color_count=' || v_color_count);
end $$;

-- 4.2 — production_colors com múltiplas cores no MESMO plate/unidade é
-- aceito integralmente (2 linhas).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_ft_a uuid;
  v_ft_b uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_color_count integer;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';
  select value::uuid into v_ft_b from zz_cpo_fixtures where key = 'ft_b';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — pedido 4.2',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50,
      'production_colors', jsonb_build_array(jsonb_build_object(
        'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a, v_ft_b)
      ))
    )),
    v_user_id
  );

  select id into v_order_item_id from public.order_items where order_id = v_order_id;
  select count(*) into v_color_count from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('4', '4.2 múltiplas cores no mesmo plate/unidade na criação: 2 linhas aceitas',
      case when v_color_count = 2 then 'PASS' else 'FAIL' end,
      'color_count=' || v_color_count);
end $$;

-- 4.3 — filamento inativo em production_colors na criação é sempre
-- rejeitado (é uma criação, nunca existe seleção "antiga" a preservar).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_ft_inactive uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_ft_inactive from zz_cpo_fixtures where key = 'ft_inactive';

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — pedido 4.3',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50,
        'production_colors', jsonb_build_array(jsonb_build_object(
          'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_inactive)
        ))
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('4', '4.3 filamento inativo em production_colors na criação é rejeitado',
      case when v_raised and v_message ilike '%inativo%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- 4.4 — unit_number fora do intervalo 1..quantity é rejeitado.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_ft_a uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — pedido 4.4',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50,
        'production_colors', jsonb_build_array(jsonb_build_object(
          'plate_number', 1, 'unit_number', 2, 'filament_type_ids', jsonb_build_array(v_ft_a)
        ))
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('4', '4.4 unit_number fora de 1..quantity é rejeitado',
      case when v_raised and v_message ilike '%unit_number%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- 4.5 — plate_number que não existe no snapshot do item é rejeitado.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_ft_a uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';

  begin
    perform public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — pedido 4.5',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50,
        'production_colors', jsonb_build_array(jsonb_build_object(
          'plate_number', 99, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)
        ))
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('4', '4.5 plate_number fora do snapshot do item é rejeitado',
      case when v_raised and v_message ilike '%plate_number%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- =============================================================================
-- SEÇÃO 5 — completar/alterar cores DEPOIS da criação
-- (update_order_item_production_colors)
-- =============================================================================

-- 5.1 — pedido criado sem cores (fixture 4.1/order_id_4x, quantity=2,
-- 2 plates -> 4 combinações unidade/plate): completar TODAS via
-- update_order_item_production_colors, cores diferentes por unidade.
do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_ft_a uuid;
  v_ft_b uuid;
  v_color_count integer;
  v_unit1_plate1 uuid;
  v_unit2_plate1 uuid;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_order_id from zz_cpo_fixtures where key = 'order_id_4x';
  select value::uuid into v_order_item_id from zz_cpo_fixtures where key = 'order_item_id_4x';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';
  select value::uuid into v_ft_b from zz_cpo_fixtures where key = 'ft_b';

  perform public.update_order_item_production_colors(
    v_order_id,
    jsonb_build_array(
      jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)),
      jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 2, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)),
      jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 2, 'filament_type_ids', jsonb_build_array(v_ft_b)),
      jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 2, 'unit_number', 2, 'filament_type_ids', jsonb_build_array(v_ft_b))
    ),
    v_user_id
  );

  select count(*) into v_color_count from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;
  select filament_type_id into v_unit1_plate1
    from public.order_item_unit_plate_filaments opucf
    join public.order_item_plates oip on oip.id = opucf.order_item_plate_id
    where opucf.order_item_id = v_order_item_id and oip.plate_number = 1 and opucf.unit_number = 1;
  select filament_type_id into v_unit2_plate1
    from public.order_item_unit_plate_filaments opucf
    join public.order_item_plates oip on oip.id = opucf.order_item_plate_id
    where opucf.order_item_id = v_order_item_id and oip.plate_number = 1 and opucf.unit_number = 2;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('5', '5.1 completar cores pós-criação: 4 seleções (2 unidades x 2 plates), cores diferentes por unidade',
      case when v_color_count = 4 and v_unit1_plate1 = v_ft_a and v_unit2_plate1 = v_ft_b
           then 'PASS' else 'FAIL' end,
      'color_count=' || v_color_count || ' unit1_plate1=' || v_unit1_plate1 || ' unit2_plate1=' || v_unit2_plate1);
end $$;

-- 5.2 — nunca altera order_status (continua IN_PRODUCTION_QUEUE após
-- completar as cores).
do $$
declare
  v_order_id uuid;
  v_order_status text;
begin
  select value::uuid into v_order_id from zz_cpo_fixtures where key = 'order_id_4x';
  select order_status into v_order_status from public.orders where id = v_order_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('5', '5.2 update_order_item_production_colors nunca altera order_status',
      case when v_order_status = 'IN_PRODUCTION_QUEUE' then 'PASS' else 'FAIL' end,
      'order_status=' || v_order_status);
end $$;

-- 5.3 — uma seleção já existente sobrevive mesmo que o filamento fique
-- inativo DEPOIS (só uma seleção NOVA exige filamento ativo) — desativa
-- ft_b, reenvia a MESMA seleção que já existia (unidade 2, plate 1) e uma
-- seleção NOVA para outro plate — a antiga sobrevive, a nova é rejeitada.
do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_ft_a uuid;
  v_ft_b uuid;
  v_raised boolean := false;
  v_message text;
  v_preserved_count integer;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_order_id from zz_cpo_fixtures where key = 'order_id_4x';
  select value::uuid into v_order_item_id from zz_cpo_fixtures where key = 'order_item_id_4x';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';
  select value::uuid into v_ft_b from zz_cpo_fixtures where key = 'ft_b';

  perform public.update_filament_type(v_ft_b, jsonb_build_object('is_active', false), v_user_id);

  -- Tuplas existentes antes desta chamada (da 5.1): (plate1,unit1,ft_a),
  -- (plate2,unit1,ft_a), (plate1,unit2,ft_b), (plate2,unit2,ft_b). O array
  -- abaixo repete a tupla (plate1,unit2,ft_b) — já existia, deve sobreviver
  -- — e acrescenta uma tupla GENUINAMENTE NOVA (plate2,unit1,ft_b — antes
  -- só tinha ft_a nesse par) com ft_b já inativo — deve ser rejeitada.
  begin
    perform public.update_order_item_production_colors(
      v_order_id,
      jsonb_build_array(
        jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 2, 'filament_type_ids', jsonb_build_array(v_ft_b)),
        jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 2, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a, v_ft_b))
      ),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('5', '5.3a seleção NOVA com filamento inativo (plate 2, unidade 1, tupla nunca selecionada antes) é rejeitada',
      case when v_raised and v_message ilike '%inativo%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));

  -- Reenvia só a seleção que já existia (preservação) + as demais válidas,
  -- sem a seleção nova inválida — deve funcionar normalmente.
  perform public.update_order_item_production_colors(
    v_order_id,
    jsonb_build_array(
      jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)),
      jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 2, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)),
      jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 2, 'filament_type_ids', jsonb_build_array(v_ft_b)),
      jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 2, 'unit_number', 2, 'filament_type_ids', jsonb_build_array(v_ft_b))
    ),
    v_user_id
  );

  select count(*) into v_preserved_count
    from public.order_item_unit_plate_filaments opucf
    join public.order_item_plates oip on oip.id = opucf.order_item_plate_id
    where opucf.order_item_id = v_order_item_id and oip.plate_number = 1 and opucf.unit_number = 2
      and opucf.filament_type_id = v_ft_b;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('5', '5.3b reenviar a MESMA seleção antiga (filamento agora inativo) é preservada, nunca removida',
      case when v_preserved_count = 1 then 'PASS' else 'FAIL' end,
      'preserved_count=' || v_preserved_count);
end $$;

-- 5.4 — bloqueado em DELIVERED/CANCELLED. Usa um Pedido dedicado, cancelado
-- antes do início da produção (transição permitida), depois tenta alterar
-- cores.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_ft_a uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — pedido 5.4 (cancelado)',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
    )),
    v_user_id
  );
  select id into v_order_item_id from public.order_items where order_id = v_order_id;

  perform public.change_order_status(v_order_id, 'CANCELLED', v_user_id, 'teste cancelamento antes de produção');

  begin
    perform public.update_order_item_production_colors(
      v_order_id,
      jsonb_build_array(jsonb_build_object(
        'order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('5', '5.4 update_order_item_production_colors bloqueado em pedido CANCELLED',
      case when v_raised and v_message ilike '%CANCELLED%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- =============================================================================
-- SEÇÃO 6 — gate de início real de produção (change_order_status:
-- IN_PRODUCTION_QUEUE -> IN_PRODUCTION)
-- =============================================================================

-- 6.1 — pedido novo (sem nenhuma cor) tenta ir para IN_PRODUCTION: bloqueado
-- com ORDER_PRODUCTION_COLORS_PENDING:, identificando produto/item/unidade/
-- plate na mensagem; order_status permanece IN_PRODUCTION_QUEUE.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_raised boolean := false;
  v_message text;
  v_order_status_after text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — pedido 6.x (gate)',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item Gate Teste', 'quantity', 1, 'unit_price', 50
    )),
    v_user_id
  );
  insert into zz_cpo_fixtures(key, value) values ('order_id_6x', v_order_id::text);

  begin
    perform public.change_order_status(v_order_id, 'IN_PRODUCTION', v_user_id, null);
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select order_status into v_order_status_after from public.orders where id = v_order_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('6', '6.1 gate bloqueia IN_PRODUCTION_QUEUE -> IN_PRODUCTION com cor pendente, identifica produto/item/unidade/plate, status inalterado',
      case when v_raised and v_message ilike 'ORDER_PRODUCTION_COLORS_PENDING:%'
             and v_message ilike '%Item Gate Teste%' and v_message ilike '%Unidade 1%' and v_message ilike '%Plate 1%'
             and v_order_status_after = 'IN_PRODUCTION_QUEUE'
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' status_after=' || v_order_status_after || ' message=' || coalesce(v_message, ''));
end $$;

-- 6.2 — completar as cores pendentes libera a transição.
do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_ft_a uuid;
  v_order_status_after text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_order_id from zz_cpo_fixtures where key = 'order_id_6x';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';
  select id into v_order_item_id from public.order_items where order_id = v_order_id;

  -- O Produto tem 2 plates (fixture do setup) — completar só o plate 1
  -- deixaria o plate 2 ainda pendente; as duas linhas abaixo cobrem os 2
  -- plates da única unidade (quantity=1) deste item.
  perform public.update_order_item_production_colors(
    v_order_id,
    jsonb_build_array(
      jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)),
      jsonb_build_object('order_item_id', v_order_item_id, 'plate_number', 2, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a))
    ),
    v_user_id
  );

  perform public.change_order_status(v_order_id, 'IN_PRODUCTION', v_user_id, null);
  select order_status into v_order_status_after from public.orders where id = v_order_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('6', '6.2 completar as cores pendentes libera a transição para IN_PRODUCTION',
      case when v_order_status_after = 'IN_PRODUCTION' then 'PASS' else 'FAIL' end,
      'order_status_after=' || v_order_status_after);
end $$;

-- 6.3 — próxima transição (IN_PRODUCTION -> WAITING_DELIVERY) segue livre,
-- sem nenhum gate de cor (só a transição QUEUE->PRODUCTION é afetada).
do $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_order_status_after text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_order_id from zz_cpo_fixtures where key = 'order_id_6x';

  perform public.change_order_status(v_order_id, 'WAITING_DELIVERY', v_user_id, null);
  select order_status into v_order_status_after from public.orders where id = v_order_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('6', '6.3 transições seguintes (IN_PRODUCTION -> WAITING_DELIVERY) continuam livres, sem gate de cor',
      case when v_order_status_after = 'WAITING_DELIVERY' then 'PASS' else 'FAIL' end,
      'order_status_after=' || v_order_status_after);
end $$;

-- 6.4 — cancelamento (CANCELLED) continua permitido normalmente ANTES do
-- início da produção, independente de cor pendente (gate só se aplica à
-- transição QUEUE->PRODUCTION, nunca ao cancelamento).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_status_after text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — pedido 6.4 (cancelamento sem cor)',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
    )),
    v_user_id
  );

  perform public.change_order_status(v_order_id, 'CANCELLED', v_user_id, 'teste 6.4');
  select order_status into v_order_status_after from public.orders where id = v_order_id;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('6', '6.4 cancelamento continua permitido sem exigir cor (gate só afeta QUEUE->PRODUCTION)',
      case when v_order_status_after = 'CANCELLED' then 'PASS' else 'FAIL' end,
      'order_status_after=' || v_order_status_after);
end $$;

-- =============================================================================
-- SEÇÃO 7 — CONGELAMENTO de cores por status (rodada corretiva 2026-08-30):
-- update_order_item_production_colors só é permitida em
-- QUOTE/WAITING_APPROVAL/APPROVED/IN_PRODUCTION_QUEUE (allow-list, nunca
-- uma lista de bloqueio) — bloqueada em
-- IN_PRODUCTION/WAITING_DELIVERY/DELIVERED/CANCELLED
-- (ORDER_PRODUCTION_COLORS_FROZEN:). Os 8 status reais da máquina de
-- estados (auditados em ORDER_STATUS_SEQUENCE/change_order_status) são
-- testados individualmente abaixo — o status é forçado via UPDATE direto
-- em public.orders (nunca via change_order_status, que exigiria percorrer
-- toda a máquina/aprovações CUSTOM só para chegar num estado — aqui o
-- objetivo é isolar e testar exclusivamente o gate de
-- update_order_item_production_colors, não a máquina de estados inteira,
-- já testada em bloco1_integration_test.sql/order_initial_status_test.sql).
-- =============================================================================

-- 7.1 — permitido em QUOTE, WAITING_APPROVAL, APPROVED, IN_PRODUCTION_QUEUE:
-- a chamada grava normalmente, sem nenhum erro.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_ft_a uuid;
  v_status text;
  v_allowed_statuses text[] := array['QUOTE', 'WAITING_APPROVAL', 'APPROVED', 'IN_PRODUCTION_QUEUE'];
  v_order_id uuid;
  v_order_item_id uuid;
  v_color_count integer;
  v_all_pass boolean := true;
  v_details text := '';
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';

  foreach v_status in array v_allowed_statuses
  loop
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — congelamento 7.1 (' || v_status || ')',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
      )),
      v_user_id
    );
    select id into v_order_item_id from public.order_items where order_id = v_order_id;
    update public.orders set order_status = v_status where id = v_order_id;

    begin
      perform public.update_order_item_production_colors(
        v_order_id,
        jsonb_build_array(jsonb_build_object(
          'order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)
        )),
        v_user_id
      );
      select count(*) into v_color_count from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;
      if v_color_count <> 1 then
        v_all_pass := false;
        v_details := v_details || v_status || ': esperava 1 cor gravada, achou ' || v_color_count || '; ';
      end if;
    exception when others then
      v_all_pass := false;
      v_details := v_details || v_status || ': rejeitado indevidamente (' || sqlerrm || '); ';
    end;
  end loop;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('7', '7.1 update_order_item_production_colors PERMITIDA em QUOTE/WAITING_APPROVAL/APPROVED/IN_PRODUCTION_QUEUE',
      case when v_all_pass then 'PASS' else 'FAIL' end, nullif(v_details, ''));
end $$;

-- 7.2 — bloqueado em IN_PRODUCTION, WAITING_DELIVERY, DELIVERED, CANCELLED:
-- a chamada é rejeitada com ORDER_PRODUCTION_COLORS_FROZEN:, e NENHUMA
-- alteração residual sobra (zero linhas gravadas, seleção anterior — se
-- houver — permanece intacta).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_ft_a uuid;
  v_ft_b uuid;
  v_status text;
  v_blocked_statuses text[] := array['IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED'];
  v_order_id uuid;
  v_order_item_id uuid;
  v_color_count_before integer;
  v_color_count_after integer;
  v_raised boolean;
  v_message text;
  v_all_pass boolean := true;
  v_details text := '';
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';
  select value::uuid into v_ft_b from zz_cpo_fixtures where key = 'ft_b';

  foreach v_status in array v_blocked_statuses
  loop
    v_order_id := public.create_order(
      v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — congelamento 7.2 (' || v_status || ')',
      jsonb_build_array(jsonb_build_object(
        'item_type', 'CATALOG', 'product_id', v_product_id,
        'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50,
        -- Já nasce com 1 cor (enquanto ainda IN_PRODUCTION_QUEUE, criação
        -- sempre permitida) — prova que a tentativa bloqueada preserva
        -- essa seleção anterior intacta, nunca a apaga.
        'production_colors', jsonb_build_array(jsonb_build_object(
          'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)
        ))
      )),
      v_user_id
    );
    select id into v_order_item_id from public.order_items where order_id = v_order_id;
    update public.orders set order_status = v_status where id = v_order_id;

    select count(*) into v_color_count_before from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;

    v_raised := false;
    begin
      perform public.update_order_item_production_colors(
        v_order_id,
        jsonb_build_array(jsonb_build_object(
          'order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_b)
        )),
        v_user_id
      );
    exception when others then
      v_raised := true;
      v_message := sqlerrm;
    end;

    select count(*) into v_color_count_after from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id;

    if not (v_raised and v_message ilike 'ORDER_PRODUCTION_COLORS_FROZEN:%' and v_message ilike '%' || v_status || '%'
            and v_color_count_before = 1 and v_color_count_after = 1) then
      v_all_pass := false;
      v_details := v_details || v_status || ': raised=' || v_raised || ' msg=' || coalesce(v_message, '') ||
        ' before=' || v_color_count_before || ' after=' || v_color_count_after || '; ';
    end if;
  end loop;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('7', '7.2 update_order_item_production_colors BLOQUEADA em IN_PRODUCTION/WAITING_DELIVERY/DELIVERED/CANCELLED (ORDER_PRODUCTION_COLORS_FROZEN:), zero alteração residual, seleção anterior preservada',
      case when v_all_pass then 'PASS' else 'FAIL' end, nullif(v_details, ''));
end $$;

-- 7.3 — unit_number inexistente (fora de 1..quantity) é rejeitado também
-- na atualização pós-criação (mesma validação de create_order, agora no
-- caminho de update_order_item_production_colors).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_ft_a uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — 7.3 unit inexistente',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
    )),
    v_user_id
  );
  select id into v_order_item_id from public.order_items where order_id = v_order_id;

  begin
    perform public.update_order_item_production_colors(
      v_order_id,
      jsonb_build_array(jsonb_build_object(
        'order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 5, 'filament_type_ids', jsonb_build_array(v_ft_a)
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('7', '7.3 update_order_item_production_colors: unit_number fora de 1..quantity é rejeitado',
      case when v_raised and v_message ilike '%unit_number%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- 7.4 — plate_number inexistente no snapshot do item é rejeitado na
-- atualização pós-criação.
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_ft_a uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — 7.4 plate inexistente',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
    )),
    v_user_id
  );
  select id into v_order_item_id from public.order_items where order_id = v_order_id;

  begin
    perform public.update_order_item_production_colors(
      v_order_id,
      jsonb_build_array(jsonb_build_object(
        'order_item_id', v_order_item_id, 'plate_number', 99, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('7', '7.4 update_order_item_production_colors: plate_number fora do snapshot é rejeitado',
      case when v_raised and v_message ilike '%plate_number%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- 7.5 — filament_type_id inexistente é rejeitado na atualização
-- pós-criação (mesma validação de create_order).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_raised boolean := false;
  v_message text;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';

  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — 7.5 filamento inexistente',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50
    )),
    v_user_id
  );
  select id into v_order_item_id from public.order_items where order_id = v_order_id;

  begin
    perform public.update_order_item_production_colors(
      v_order_id,
      jsonb_build_array(jsonb_build_object(
        'order_item_id', v_order_item_id, 'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(gen_random_uuid())
      )),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('7', '7.5 update_order_item_production_colors: filament_type_id inexistente é rejeitado',
      case when v_raised and v_message ilike '%não encontrado%' then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, ''));
end $$;

-- 7.6 — editar itens via update_quote_order (mudança de quantidade) limpa
-- as cores antigas e re-snapshota os plates — nenhuma cor órfã sobrevive
-- referenciando um order_item_plates já apagado (a FK RESTRICT exigiria
-- essa ordem de limpeza; este teste prova que a ordem está correta).
do $$
declare
  v_user_id uuid;
  v_customer_id uuid;
  v_product_id uuid;
  v_ft_a uuid;
  v_order_id uuid;
  v_order_item_id_before uuid;
  v_order_item_id_after uuid;
  v_color_count_after integer;
  v_snapshot_count_after integer;
  v_new_quantity integer;
begin
  select value::uuid into v_user_id from zz_cpo_fixtures where key = 'user_id';
  select value::uuid into v_customer_id from zz_cpo_fixtures where key = 'customer_id';
  select value::uuid into v_product_id from zz_cpo_fixtures where key = 'product_id';
  select value::uuid into v_ft_a from zz_cpo_fixtures where key = 'ft_a';

  -- Nasce em QUOTE (item CUSTOM misturado só para forçar QUOTE — depois
  -- removido na própria edição, já que update_quote_order só aceita
  -- CATALOG) — mais simples: usa quantity=1 e força QUOTE via UPDATE
  -- direto (mesmo raciocínio de isolamento da Seção 7.1/7.2 — testar só
  -- update_quote_order, não a máquina de estados inteira).
  v_order_id := public.create_order(
    v_customer_id, null, null, null, null, 0, 0, 'TESTE OPS Cores — 7.6 quantidade alterada',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 1, 'unit_price', 50,
      'production_colors', jsonb_build_array(jsonb_build_object(
        'plate_number', 1, 'unit_number', 1, 'filament_type_ids', jsonb_build_array(v_ft_a)
      ))
    )),
    v_user_id
  );
  select id into v_order_item_id_before from public.order_items where order_id = v_order_id;
  update public.orders set order_status = 'QUOTE' where id = v_order_id;

  perform public.update_quote_order(
    v_order_id, v_customer_id, null, null, null, null, null, null, null,
    'quantidade alterada de 1 para 3',
    jsonb_build_array(jsonb_build_object(
      'item_type', 'CATALOG', 'product_id', v_product_id,
      'item_name', 'Item teste', 'quantity', 3, 'unit_price', 50
    )),
    v_user_id
  );

  select id, quantity into v_order_item_id_after, v_new_quantity from public.order_items where order_id = v_order_id;
  select count(*) into v_color_count_after from public.order_item_unit_plate_filaments where order_item_id = v_order_item_id_after;
  select count(*) into v_snapshot_count_after from public.order_item_plates where order_item_id = v_order_item_id_after;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('7', '7.6 editar itens (quantidade 1->3) via update_quote_order limpa cores antigas e re-snapshota plates, zero cor órfã',
      case when v_new_quantity = 3 and v_color_count_after = 0 and v_snapshot_count_after = 2
             and v_order_item_id_after <> v_order_item_id_before
           then 'PASS' else 'FAIL' end,
      'new_quantity=' || v_new_quantity || ' color_count_after=' || v_color_count_after ||
      ' snapshot_count_after=' || v_snapshot_count_after ||
      ' item_id_changed=' || (v_order_item_id_after <> v_order_item_id_before));
end $$;

-- =============================================================================
-- SEÇÃO 8 — grants (funções internas sem NENHUM EXECUTE; RPCs públicas só
-- para service_role)
-- =============================================================================
do $$
declare
  v_row record;
  v_all_pass boolean := true;
  v_details text := '';
  v_anon boolean;
  v_authenticated boolean;
  v_service_role boolean;
begin
  for v_row in
    select * from (values
      ('public.set_product_categories(uuid,jsonb,uuid)', 'internal'),
      ('public.validate_catalog_production_structure_for_creation(jsonb)', 'internal'),
      ('public.validate_order_production_readiness(uuid)', 'internal'),
      ('public.update_order_item_production_colors(uuid,jsonb,uuid)', 'service_role_only')
    ) as t(signature, kind)
  loop
    select has_function_privilege('anon', v_row.signature, 'EXECUTE') into v_anon;
    select has_function_privilege('authenticated', v_row.signature, 'EXECUTE') into v_authenticated;
    select has_function_privilege('service_role', v_row.signature, 'EXECUTE') into v_service_role;

    if v_row.kind = 'internal' then
      if v_anon or v_authenticated or v_service_role then
        v_all_pass := false;
        v_details := v_details || v_row.signature || ' deveria ter ZERO grants; ';
      end if;
    else
      if v_anon or v_authenticated or not v_service_role then
        v_all_pass := false;
        v_details := v_details || v_row.signature || ' deveria ter EXECUTE só para service_role; ';
      end if;
    end if;
  end loop;

  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('8', '8.1 grants corretos: 3 funções internas com zero grants, update_order_item_production_colors só service_role',
      case when v_all_pass then 'PASS' else 'FAIL' end, nullif(v_details, ''));
exception when others then
  insert into zz_cpo_test_results(section, test_name, status, details)
    values ('8', '8.1 grants', 'FAIL', sqlerrm);
end $$;

-- =============================================================================
-- Resumo
-- =============================================================================
select
  (select count(*) from zz_cpo_test_results where status = 'PASS') as pass_count,
  (select count(*) from zz_cpo_test_results where status = 'FAIL') as fail_count,
  (select count(*) from zz_cpo_test_results) as total_count,
  (select json_agg(json_build_object('section', section, 'test_name', test_name, 'status', status, 'details', details) order by seq) from zz_cpo_test_results) as results;

rollback;
