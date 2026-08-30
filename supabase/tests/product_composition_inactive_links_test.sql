-- =============================================================================
-- Forma Sky — preservação de vínculo INATIVO HISTÓRICO em Acessórios/Embalagens
-- (migration 20260830120000_preserve_inactive_product_composition_links.sql)
-- TESTE DE INTEGRAÇÃO transacional de set_product_composition() redefinida
-- (chamada por create_product_with_plates/update_product_full e pelo
-- diálogo independente "Acessórios e Embalagem" da listagem).
--
-- REGRA TESTADA: um accessory_id/packaging_id é aceito quando ATIVO, OU
-- quando já estava vinculado a ESTE MESMO produto imediatamente antes da
-- chamada — nunca um histórico global (não existe tabela de "já vinculado
-- algum dia"), nunca em Produto novo, nunca vínculo pertencente só a OUTRO
-- produto, nunca depois de já ter sido removido numa chamada anterior.
--
-- IMPORTANTE — set_product_composition SEMPRE substitui o conjunto INTEIRO
-- (delete + reinsert, nunca incremental — comportamento pré-existente,
-- inalterado por esta migration). Por isso cada chamada abaixo reenvia
-- TODOS os itens que devem continuar vinculados, nunca só o item novo —
-- exatamente como o frontend real já faz (ProductForm sempre envia o estado
-- completo das linhas, nunca um delta). O comentário de cada bloco registra
-- o payload completo enviado e o estado resultante esperado.
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nenhum dado criado por este
-- script persiste no banco. Usa somente Produto/acessório/embalagem/cliente
-- "TESTE%", nunca dados oficiais ou Petlink.
--
-- IMPORTANTE — a migration 20260830120000 ainda NÃO foi aplicada ao projeto
-- Supabase remoto nesta rodada (restrição explícita desta tarefa: "não
-- aplique a nova migration"). Por isso este script NÃO PÔDE ser executado
-- nesta rodada — a regra de preservação testada aqui ainda não existe no
-- banco remoto (set_product_composition ainda rejeita qualquer item inativo,
-- histórico ou não). Escrito seguindo a mesma disciplina/estrutura já usada
-- nos demais arquivos deste diretório — pronto para ser executado assim que
-- a migration for aplicada, numa rodada futura autorizada.
--
-- Execução (quando a migration estiver aplicada):
--   npx supabase db query --linked --file supabase/tests/product_composition_inactive_links_test.sql

begin;

create temporary table zz_pcil_test_results (
  seq serial primary key,
  section text not null,
  test_name text not null,
  status text not null,
  details text
);

create temporary table zz_pcil_fixtures (
  key text primary key,
  value text not null
);

-- =============================================================================
-- SETUP — usuário ativo existente; 2 Produtos TESTE (A = sujeito principal
-- dos testes, B = usado só para provar que um vínculo histórico de OUTRO
-- produto nunca é aceito); acessórios/embalagens TESTE nos 4 estados
-- necessários:
--   *_active       — ativo, nunca vinculado a nada ainda ("ativo novo").
--   *_hist         — criado ATIVO, vinculado ao Produto A, DEPOIS
--                    desativado — é o "inativo histórico" de A.
--   *_never        — criado JÁ inativo, nunca vinculado a nenhum produto.
--   *_other        — criado ATIVO, vinculado ao Produto B, DEPOIS
--                    desativado — é histórico de B, nunca de A.
-- Estado inicial do Produto A: accessories={a_hist:1}, packaging={k_hist:1}.
-- =============================================================================
do $$
declare
  v_user_id uuid;
  v_a_active uuid;
  v_a_hist uuid;
  v_a_never uuid;
  v_a_other uuid;
  v_k_active uuid;
  v_k_hist uuid;
  v_k_never uuid;
  v_k_other uuid;
  v_plates jsonb;
  v_product_a uuid;
  v_product_b uuid;
  v_accessory_count_a integer;
  v_packaging_count_a integer;
begin
  select id into v_user_id from public.users where is_active limit 1;
  if v_user_id is null then
    raise exception 'setup: nenhum usuário ativo encontrado para o teste';
  end if;
  insert into zz_pcil_fixtures(key, value) values ('user_id', v_user_id::text);

  insert into public.accessories (name, is_active) values ('TESTE OPS PCIL — Acessório ativo', true)
    returning id into v_a_active;
  insert into public.accessories (name, is_active) values ('TESTE OPS PCIL — Acessório histórico A', true)
    returning id into v_a_hist;
  insert into public.accessories (name, is_active) values ('TESTE OPS PCIL — Acessório nunca vinculado', false)
    returning id into v_a_never;
  insert into public.accessories (name, is_active) values ('TESTE OPS PCIL — Acessório de outro produto', true)
    returning id into v_a_other;

  insert into public.packaging (name, is_active) values ('TESTE OPS PCIL — Embalagem ativa', true)
    returning id into v_k_active;
  insert into public.packaging (name, is_active) values ('TESTE OPS PCIL — Embalagem histórica A', true)
    returning id into v_k_hist;
  insert into public.packaging (name, is_active) values ('TESTE OPS PCIL — Embalagem nunca vinculada', false)
    returning id into v_k_never;
  insert into public.packaging (name, is_active) values ('TESTE OPS PCIL — Embalagem de outro produto', true)
    returning id into v_k_other;

  insert into zz_pcil_fixtures(key, value) values ('a_active', v_a_active::text);
  insert into zz_pcil_fixtures(key, value) values ('a_hist', v_a_hist::text);
  insert into zz_pcil_fixtures(key, value) values ('a_never', v_a_never::text);
  insert into zz_pcil_fixtures(key, value) values ('a_other', v_a_other::text);
  insert into zz_pcil_fixtures(key, value) values ('k_active', v_k_active::text);
  insert into zz_pcil_fixtures(key, value) values ('k_hist', v_k_hist::text);
  insert into zz_pcil_fixtures(key, value) values ('k_never', v_k_never::text);
  insert into zz_pcil_fixtures(key, value) values ('k_other', v_k_other::text);

  v_plates := jsonb_build_array(jsonb_build_object('production_time_seconds', 600, 'weight_grams', 10));
  insert into zz_pcil_fixtures(key, value) values ('plates', v_plates::text);

  -- Produto B — só para vincular *_other enquanto ainda ativos, depois
  -- desativados; nunca mais tocado depois disso (existe só para provar que
  -- um vínculo histórico é específico ao PAR item+produto, nunca global).
  v_product_b := public.create_product_with_plates(
    'TESTE OPS PCIL — Produto B (histórico de outro produto)', 'CATALOG',
    jsonb_build_array('teste'), 'produto B', 30.00, null, true,
    v_plates, null, null,
    jsonb_build_array(jsonb_build_object('id', v_a_other, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('id', v_k_other, 'quantity', 1)),
    v_user_id
  );
  insert into zz_pcil_fixtures(key, value) values ('product_b', v_product_b::text);

  -- Produto A — sujeito principal: nasce com *_hist vinculado (ainda ativo
  -- neste momento).
  v_product_a := public.create_product_with_plates(
    'TESTE OPS PCIL — Produto A (sujeito principal)', 'CATALOG',
    jsonb_build_array('teste'), 'produto A', 50.00, null, true,
    v_plates, null, null,
    jsonb_build_array(jsonb_build_object('id', v_a_hist, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('id', v_k_hist, 'quantity', 1)),
    v_user_id
  );
  insert into zz_pcil_fixtures(key, value) values ('product_a', v_product_a::text);

  -- Desativa DEPOIS de vinculados — *_hist/*_other passam a ser "inativos
  -- históricos", cada um só do produto ao qual já estava vinculado.
  update public.accessories set is_active = false where id in (v_a_hist, v_a_other);
  update public.packaging set is_active = false where id in (v_k_hist, v_k_other);

  select count(*) into v_accessory_count_a from public.product_accessories where product_id = v_product_a;
  select count(*) into v_packaging_count_a from public.product_packaging where product_id = v_product_a;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('0', '0.0 setup: usuário/2 Produtos/4 acessórios/4 embalagens TESTE criados; *_hist/*_other desativados após vínculo',
      case when v_accessory_count_a = 1 and v_packaging_count_a = 1 then 'PASS' else 'FAIL' end,
      'user_id=' || v_user_id || ' product_a=' || v_product_a || ' product_b=' || v_product_b ||
      ' accessory_count_a=' || v_accessory_count_a || ' packaging_count_a=' || v_packaging_count_a);
end $$;

-- =============================================================================
-- SEÇÃO 1 — ACESSÓRIOS: os 10 cenários pedidos, em sequência narrativa sobre
-- o Produto A (cada teste parte do estado deixado pelo anterior; payload de
-- cada chamada é sempre o CONJUNTO COMPLETO desejado, nunca um delta — ver
-- nota "IMPORTANTE" no topo do arquivo).
-- Estado inicial: {a_hist:1}.
-- =============================================================================

-- 1.1 — {a_hist:1, a_active:3}: ativo novo (nunca vinculado antes) é
-- permitido, coexistindo com o histórico já existente. Estado -> {a_hist:1, a_active:3}.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid; v_a_hist uuid;
  v_count integer; v_qty_active integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';
  select value::uuid into v_a_hist from zz_pcil_fixtures where key = 'a_hist';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_a_hist, 'quantity', 1),
        jsonb_build_object('id', v_a_active, 'quantity', 3)
      ),
      '[]'::jsonb, v_user_id
    );
    select count(*) into v_count from public.product_accessories where product_id = v_product_a;
    select quantity into v_qty_active from public.product_accessories where product_id = v_product_a and accessory_id = v_a_active;

    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('1', '1.1 acessório ATIVO novo (nunca vinculado) é permitido, coexistindo com o histórico já existente',
        case when v_count = 2 and v_qty_active = 3 then 'PASS' else 'FAIL' end,
        'count=' || v_count || ' qty_active=' || v_qty_active);
  exception when others then
    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('1', '1.1 acessório ATIVO novo', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.2 — resenvia {a_hist:1, a_active:3} sem alteração: confirma que o item
-- INATIVO já vinculado ao MESMO Produto é genuinamente aceito (join contra
-- accessories.is_active prova que o item aceito está mesmo inativo agora).
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid; v_a_hist uuid;
  v_is_active boolean;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';
  select value::uuid into v_a_hist from zz_pcil_fixtures where key = 'a_hist';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_a_hist, 'quantity', 1),
        jsonb_build_object('id', v_a_active, 'quantity', 3)
      ),
      '[]'::jsonb, v_user_id
    );
    select acc.is_active into v_is_active
      from public.product_accessories pa join public.accessories acc on acc.id = pa.accessory_id
      where pa.product_id = v_product_a and pa.accessory_id = v_a_hist;

    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('1', '1.2 acessório INATIVO já vinculado ao MESMO Produto (histórico) é permitido — confirmado genuinamente inativo',
        case when v_is_active = false then 'PASS' else 'FAIL' end, 'accessories.is_active=' || v_is_active);
  exception when others then
    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('1', '1.2 acessório inativo histórico', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.3 — {a_hist:9, a_active:3}: alteração de quantidade do inativo
-- histórico é permitida. Estado -> {a_hist:9, a_active:3}.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid; v_a_hist uuid;
  v_quantity integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';
  select value::uuid into v_a_hist from zz_pcil_fixtures where key = 'a_hist';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_a_hist, 'quantity', 9),
        jsonb_build_object('id', v_a_active, 'quantity', 3)
      ),
      '[]'::jsonb, v_user_id
    );
    select quantity into v_quantity from public.product_accessories where product_id = v_product_a and accessory_id = v_a_hist;

    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('1', '1.3 alterar a quantidade do inativo histórico (1 -> 9) é permitido',
        case when v_quantity = 9 then 'PASS' else 'FAIL' end, 'quantity=' || v_quantity);
  exception when others then
    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('1', '1.3 quantidade do inativo histórico', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.4 — editar outro campo do Produto (descrição), reenviando a mesma
-- composição {a_hist:9, a_active:3}: preserva o vínculo, sem exigir tocar
-- na composição para poder salvar outro campo.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid; v_a_hist uuid;
  v_row public.products; v_count integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';
  select value::uuid into v_a_hist from zz_pcil_fixtures where key = 'a_hist';

  begin
    select public.update_product_full(
      v_product_a, jsonb_build_object('description', 'descrição editada, cores/composição não tocadas'),
      jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_a_hist, 'quantity', 9),
        jsonb_build_object('id', v_a_active, 'quantity', 3)
      ),
      '[]'::jsonb, v_user_id
    ) into v_row;
    select count(*) into v_count from public.product_accessories where product_id = v_product_a and accessory_id = v_a_hist;

    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('1', '1.4 editar outro campo (descrição) preserva o vínculo histórico, sem bloquear',
        case when v_row.description = 'descrição editada, cores/composição não tocadas' and v_count = 1
             then 'PASS' else 'FAIL' end,
        'description=' || v_row.description || ' count=' || v_count);
  exception when others then
    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('1', '1.4 editar outro campo preservando o vínculo', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.5 — confirmação explícita: ativo + inativo histórico coexistem na mesma
-- linha de composição (estado já deixado por 1.1-1.4, reafirmado aqui).
do $$
declare
  v_product_a uuid; v_a_active uuid; v_a_hist uuid; v_count integer;
begin
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';
  select value::uuid into v_a_hist from zz_pcil_fixtures where key = 'a_hist';

  select count(*) into v_count from public.product_accessories
    where product_id = v_product_a and accessory_id in (v_a_active, v_a_hist);

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('1', '1.5 ativo + inativo histórico coexistem na mesma composição',
      case when v_count = 2 then 'PASS' else 'FAIL' end, 'count=' || v_count);
end $$;

-- 1.6 — {a_hist:9, a_active:3, a_never:1}: inativo NUNCA vinculado a nenhum
-- produto é rejeitado. Rollback integral: composição anterior (2 linhas)
-- permanece intacta.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid; v_a_hist uuid; v_a_never uuid;
  v_raised boolean := false; v_message text; v_count_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';
  select value::uuid into v_a_hist from zz_pcil_fixtures where key = 'a_hist';
  select value::uuid into v_a_never from zz_pcil_fixtures where key = 'a_never';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_a_hist, 'quantity', 9),
        jsonb_build_object('id', v_a_active, 'quantity', 3),
        jsonb_build_object('id', v_a_never, 'quantity', 1)
      ),
      '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select count(*) into v_count_after from public.product_accessories where product_id = v_product_a;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('1', '1.6 inativo NUNCA vinculado a nenhum produto é rejeitado; composição anterior (2 linhas) intacta',
      case when v_raised and v_message ilike '%não encontrado, inativo e sem vínculo anterior%' and v_count_after = 2
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, '') || ' count_after=' || v_count_after);
end $$;

-- 1.7 — {a_hist:9, a_active:3, a_other:1}: inativo vinculado SÓ a outro
-- Produto (a_other, histórico de B) é rejeitado para o Produto A.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid; v_a_hist uuid; v_a_other uuid;
  v_raised boolean := false; v_message text; v_count_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';
  select value::uuid into v_a_hist from zz_pcil_fixtures where key = 'a_hist';
  select value::uuid into v_a_other from zz_pcil_fixtures where key = 'a_other';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_a_hist, 'quantity', 9),
        jsonb_build_object('id', v_a_active, 'quantity', 3),
        jsonb_build_object('id', v_a_other, 'quantity', 1)
      ),
      '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select count(*) into v_count_after from public.product_accessories where product_id = v_product_a;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('1', '1.7 inativo vinculado só a OUTRO Produto é rejeitado (nunca um histórico global); composição intacta',
      case when v_raised and v_message ilike '%não encontrado, inativo e sem vínculo anterior%' and v_count_after = 2
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, '') || ' count_after=' || v_count_after);
end $$;

-- 1.8 — inativo em Produto NOVO é rejeitado (nenhum vínculo anterior pode
-- existir para um produto que ainda não existia).
do $$
declare
  v_user_id uuid; v_plates jsonb; v_a_hist uuid;
  v_raised boolean := false; v_message text; v_products_before integer; v_products_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_hist from zz_pcil_fixtures where key = 'a_hist';

  select count(*) into v_products_before from public.products where name like 'TESTE OPS PCIL%';

  begin
    perform public.create_product_with_plates(
      'TESTE OPS PCIL — Produto novo com inativo (deve falhar)', 'CATALOG',
      jsonb_build_array('teste'), 'nao deveria ser criado', 20.00, null, true,
      v_plates, null, null,
      jsonb_build_array(jsonb_build_object('id', v_a_hist, 'quantity', 1)),
      '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select count(*) into v_products_after from public.products where name like 'TESTE OPS PCIL%';

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('1', '1.8 inativo em Produto NOVO é rejeitado; nenhum Produto órfão criado (rollback total)',
      case when v_raised and v_message ilike '%não encontrado, inativo e sem vínculo anterior%'
             and v_products_after = v_products_before
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, '') ||
      ' products_before=' || v_products_before || ' products_after=' || v_products_after);
end $$;

-- 1.9 — {a_active:3}: remover o inativo histórico é permitido (voluntário).
-- Estado -> {a_active:3}.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid; v_a_hist uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';
  select value::uuid into v_a_hist from zz_pcil_fixtures where key = 'a_hist';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(jsonb_build_object('id', v_a_active, 'quantity', 3)),
      '[]'::jsonb, v_user_id
    );
    select count(*) into v_count from public.product_accessories where product_id = v_product_a and accessory_id = v_a_hist;

    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('1', '1.9 remover o inativo histórico (voluntário) é permitido',
        case when v_count = 0 then 'PASS' else 'FAIL' end, 'count_a_hist_after=' || v_count);
  exception when others then
    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('1', '1.9 remover inativo histórico', 'FAIL', sqlerrm);
  end;
end $$;

-- 1.10 — {a_active:3, a_hist:1}: depois de removido, tentar reintroduzir o
-- MESMO item (ainda inativo) é rejeitado — ele deixou de ser histórico
-- deste Produto na chamada anterior (1.9). Estado permanece {a_active:3}.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid; v_a_hist uuid;
  v_raised boolean := false; v_message text; v_count_hist_after integer; v_qty_active_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';
  select value::uuid into v_a_hist from zz_pcil_fixtures where key = 'a_hist';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_a_active, 'quantity', 3),
        jsonb_build_object('id', v_a_hist, 'quantity', 1)
      ),
      '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select count(*) into v_count_hist_after from public.product_accessories where product_id = v_product_a and accessory_id = v_a_hist;
  select quantity into v_qty_active_after from public.product_accessories where product_id = v_product_a and accessory_id = v_a_active;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('1', '1.10 reintroduzir o inativo depois de removido é rejeitado (não é mais histórico deste Produto); a_active preservado intacto',
      case when v_raised and v_message ilike '%não encontrado, inativo e sem vínculo anterior%'
             and v_count_hist_after = 0 and v_qty_active_after = 3
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, '') ||
      ' count_hist_after=' || v_count_hist_after || ' qty_active_after=' || v_qty_active_after);
end $$;

-- =============================================================================
-- SEÇÃO 2 — EMBALAGENS: os mesmos 10 cenários, mesma disciplina de payload
-- completo a cada chamada (cobre qualquer assimetria de copy/paste entre os
-- dois loops da RPC). Estado inicial: {k_hist:1}.
-- =============================================================================

-- 2.1 — {k_hist:1, k_active:4}: ativa nova é permitida, coexistindo com a
-- histórica. Estado -> {k_hist:1, k_active:4}.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_k_active uuid; v_k_hist uuid;
  v_count integer; v_qty_active integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_k_active from zz_pcil_fixtures where key = 'k_active';
  select value::uuid into v_k_hist from zz_pcil_fixtures where key = 'k_hist';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('id', v_k_hist, 'quantity', 1),
        jsonb_build_object('id', v_k_active, 'quantity', 4)
      ),
      v_user_id
    );
    select count(*) into v_count from public.product_packaging where product_id = v_product_a;
    select quantity into v_qty_active from public.product_packaging where product_id = v_product_a and packaging_id = v_k_active;

    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('2', '2.1 embalagem ATIVA nova (nunca vinculada) é permitida, coexistindo com a histórica já existente',
        case when v_count = 2 and v_qty_active = 4 then 'PASS' else 'FAIL' end,
        'count=' || v_count || ' qty_active=' || v_qty_active);
  exception when others then
    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('2', '2.1 embalagem ativa nova', 'FAIL', sqlerrm);
  end;
end $$;

-- 2.2 — resenvia {k_hist:1, k_active:4} sem alteração: confirma que a
-- embalagem INATIVA já vinculada ao MESMO Produto é genuinamente aceita.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_k_active uuid; v_k_hist uuid;
  v_is_active boolean;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_k_active from zz_pcil_fixtures where key = 'k_active';
  select value::uuid into v_k_hist from zz_pcil_fixtures where key = 'k_hist';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('id', v_k_hist, 'quantity', 1),
        jsonb_build_object('id', v_k_active, 'quantity', 4)
      ),
      v_user_id
    );
    select pkg.is_active into v_is_active
      from public.product_packaging pp join public.packaging pkg on pkg.id = pp.packaging_id
      where pp.product_id = v_product_a and pp.packaging_id = v_k_hist;

    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('2', '2.2 embalagem INATIVA já vinculada ao MESMO Produto (histórica) é permitida — confirmada genuinamente inativa',
        case when v_is_active = false then 'PASS' else 'FAIL' end, 'packaging.is_active=' || v_is_active);
  exception when others then
    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('2', '2.2 embalagem inativa histórica', 'FAIL', sqlerrm);
  end;
end $$;

-- 2.3 — {k_hist:7, k_active:4}: alteração de quantidade da histórica é
-- permitida. Estado -> {k_hist:7, k_active:4}.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_k_active uuid; v_k_hist uuid;
  v_quantity integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_k_active from zz_pcil_fixtures where key = 'k_active';
  select value::uuid into v_k_hist from zz_pcil_fixtures where key = 'k_hist';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('id', v_k_hist, 'quantity', 7),
        jsonb_build_object('id', v_k_active, 'quantity', 4)
      ),
      v_user_id
    );
    select quantity into v_quantity from public.product_packaging where product_id = v_product_a and packaging_id = v_k_hist;

    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('2', '2.3 alterar a quantidade da embalagem histórica (1 -> 7) é permitido',
        case when v_quantity = 7 then 'PASS' else 'FAIL' end, 'quantity=' || v_quantity);
  exception when others then
    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('2', '2.3 quantidade da embalagem histórica', 'FAIL', sqlerrm);
  end;
end $$;

-- 2.4 — editar outro campo (nome), reenviando {k_hist:7, k_active:4}:
-- preserva o vínculo.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_k_active uuid; v_k_hist uuid;
  v_row public.products; v_count integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_k_active from zz_pcil_fixtures where key = 'k_active';
  select value::uuid into v_k_hist from zz_pcil_fixtures where key = 'k_hist';

  begin
    select public.update_product_full(
      v_product_a, jsonb_build_object('name', 'TESTE OPS PCIL — Produto A (nome editado)'),
      jsonb_build_array('teste'), v_plates, null, null,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('id', v_k_hist, 'quantity', 7),
        jsonb_build_object('id', v_k_active, 'quantity', 4)
      ),
      v_user_id
    ) into v_row;
    select count(*) into v_count from public.product_packaging where product_id = v_product_a and packaging_id = v_k_hist;

    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('2', '2.4 editar outro campo (nome) preserva o vínculo histórico de embalagem',
        case when v_row.name = 'TESTE OPS PCIL — Produto A (nome editado)' and v_count = 1
             then 'PASS' else 'FAIL' end, 'name=' || v_row.name || ' count=' || v_count);
  exception when others then
    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('2', '2.4 editar nome preservando embalagem histórica', 'FAIL', sqlerrm);
  end;
end $$;

-- 2.5 — {k_hist:7, k_active:4, k_never:1}: embalagem NUNCA vinculada a
-- nenhum produto é rejeitada; rollback integral (composição anterior de 2
-- linhas intacta).
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_k_active uuid; v_k_hist uuid; v_k_never uuid;
  v_raised boolean := false; v_message text; v_count_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_k_active from zz_pcil_fixtures where key = 'k_active';
  select value::uuid into v_k_hist from zz_pcil_fixtures where key = 'k_hist';
  select value::uuid into v_k_never from zz_pcil_fixtures where key = 'k_never';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('id', v_k_hist, 'quantity', 7),
        jsonb_build_object('id', v_k_active, 'quantity', 4),
        jsonb_build_object('id', v_k_never, 'quantity', 1)
      ),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select count(*) into v_count_after from public.product_packaging where product_id = v_product_a;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('2', '2.5 embalagem NUNCA vinculada a nenhum produto é rejeitada; composição anterior (2 linhas) intacta',
      case when v_raised and v_message ilike '%não encontrado, inativo e sem vínculo anterior%' and v_count_after = 2
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, '') || ' count_after=' || v_count_after);
end $$;

-- 2.6 — {k_hist:7, k_active:4, k_other:1}: embalagem vinculada SÓ a outro
-- Produto (k_other, histórico de B) é rejeitada para o Produto A.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_k_active uuid; v_k_hist uuid; v_k_other uuid;
  v_raised boolean := false; v_message text; v_count_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_k_active from zz_pcil_fixtures where key = 'k_active';
  select value::uuid into v_k_hist from zz_pcil_fixtures where key = 'k_hist';
  select value::uuid into v_k_other from zz_pcil_fixtures where key = 'k_other';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('id', v_k_hist, 'quantity', 7),
        jsonb_build_object('id', v_k_active, 'quantity', 4),
        jsonb_build_object('id', v_k_other, 'quantity', 1)
      ),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select count(*) into v_count_after from public.product_packaging where product_id = v_product_a;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('2', '2.6 embalagem vinculada só a OUTRO Produto é rejeitada (nunca um histórico global); composição intacta',
      case when v_raised and v_message ilike '%não encontrado, inativo e sem vínculo anterior%' and v_count_after = 2
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, '') || ' count_after=' || v_count_after);
end $$;

-- 2.7 — embalagem inativa em Produto NOVO é rejeitada.
do $$
declare
  v_user_id uuid; v_plates jsonb; v_k_hist uuid;
  v_raised boolean := false; v_message text; v_products_before integer; v_products_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_k_hist from zz_pcil_fixtures where key = 'k_hist';

  select count(*) into v_products_before from public.products where name like 'TESTE OPS PCIL%';

  begin
    perform public.create_product_with_plates(
      'TESTE OPS PCIL — Produto novo com embalagem inativa (deve falhar)', 'CATALOG',
      jsonb_build_array('teste'), 'nao deveria ser criado', 20.00, null, true,
      v_plates, null, null,
      '[]'::jsonb, jsonb_build_array(jsonb_build_object('id', v_k_hist, 'quantity', 1)),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select count(*) into v_products_after from public.products where name like 'TESTE OPS PCIL%';

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('2', '2.7 embalagem inativa em Produto NOVO é rejeitada; nenhum Produto órfão criado',
      case when v_raised and v_message ilike '%não encontrado, inativo e sem vínculo anterior%'
             and v_products_after = v_products_before
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, '') ||
      ' products_before=' || v_products_before || ' products_after=' || v_products_after);
end $$;

-- 2.8 — {k_active:4}: remover a embalagem histórica é permitido. Estado ->
-- {k_active:4}.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_k_active uuid; v_k_hist uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_k_active from zz_pcil_fixtures where key = 'k_active';
  select value::uuid into v_k_hist from zz_pcil_fixtures where key = 'k_hist';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      '[]'::jsonb, jsonb_build_array(jsonb_build_object('id', v_k_active, 'quantity', 4)),
      v_user_id
    );
    select count(*) into v_count from public.product_packaging where product_id = v_product_a and packaging_id = v_k_hist;

    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('2', '2.8 remover a embalagem histórica (voluntário) é permitido',
        case when v_count = 0 then 'PASS' else 'FAIL' end, 'count_k_hist_after=' || v_count);
  exception when others then
    insert into zz_pcil_test_results(section, test_name, status, details)
      values ('2', '2.8 remover embalagem histórica', 'FAIL', sqlerrm);
  end;
end $$;

-- 2.9 — {k_active:4, k_hist:1}: depois de removida, tentar reintroduzi-la é
-- rejeitado. Estado permanece {k_active:4}.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_k_active uuid; v_k_hist uuid;
  v_raised boolean := false; v_message text; v_count_hist_after integer; v_qty_active_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_k_active from zz_pcil_fixtures where key = 'k_active';
  select value::uuid into v_k_hist from zz_pcil_fixtures where key = 'k_hist';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('id', v_k_active, 'quantity', 4),
        jsonb_build_object('id', v_k_hist, 'quantity', 1)
      ),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select count(*) into v_count_hist_after from public.product_packaging where product_id = v_product_a and packaging_id = v_k_hist;
  select quantity into v_qty_active_after from public.product_packaging where product_id = v_product_a and packaging_id = v_k_active;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('2', '2.9 reintroduzir a embalagem depois de removida é rejeitado (não é mais histórica deste Produto); k_active preservado intacto',
      case when v_raised and v_message ilike '%não encontrado, inativo e sem vínculo anterior%'
             and v_count_hist_after = 0 and v_qty_active_after = 4
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, '') ||
      ' count_hist_after=' || v_count_hist_after || ' qty_active_after=' || v_qty_active_after);
end $$;

-- 2.10 — {k_active:99, k_other:1}: mistura inválida (embalagem histórica de
-- OUTRO produto) continua rejeitada mesmo junto de uma seleção válida —
-- prova que a rejeição de UM item inválido barra a chamada inteira: a
-- quantidade de k_active NÃO vira 99, permanece 4 (nenhuma inserção
-- parcial).
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_k_active uuid; v_k_other uuid;
  v_raised boolean := false; v_message text; v_qty_active_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_k_active from zz_pcil_fixtures where key = 'k_active';
  select value::uuid into v_k_other from zz_pcil_fixtures where key = 'k_other';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('id', v_k_active, 'quantity', 99),
        jsonb_build_object('id', v_k_other, 'quantity', 1)
      ),
      v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select quantity into v_qty_active_after from public.product_packaging where product_id = v_product_a and packaging_id = v_k_active;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('2', '2.10 item inválido junto de item válido rejeita a chamada inteira; quantidade do item válido (4) NÃO vira 99',
      case when v_raised and v_message ilike '%não encontrado, inativo e sem vínculo anterior%' and v_qty_active_after = 4
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, '') || ' qty_active_after=' || v_qty_active_after);
end $$;

-- =============================================================================
-- SEÇÃO 3 — ATOMICIDADE (erro não apaga/altera a composição anterior;
-- duplicidade e quantidade inválida continuam rejeitadas; rollback integral;
-- zero mistura). Estado no início desta seção: acessórios={a_active:3},
-- embalagens={k_active:4}.
-- =============================================================================

-- 3.1 — duplicidade (mesmo accessory_id 2x no array) continua rejeitada
-- pela UNIQUE(product_id, accessory_id) — comportamento pré-existente,
-- inalterado por esta migration; quantidade anterior (3) intacta.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid;
  v_raised boolean := false; v_message text; v_quantity_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_a_active, 'quantity', 1),
        jsonb_build_object('id', v_a_active, 'quantity', 2)
      ),
      '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised := true;
    v_message := sqlerrm;
  end;

  select quantity into v_quantity_after from public.product_accessories where product_id = v_product_a and accessory_id = v_a_active;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('3', '3.1 duplicidade (mesmo id 2x) continua rejeitada; quantidade anterior (3) intacta',
      case when v_raised and v_quantity_after = 3 then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' message=' || coalesce(v_message, '') || ' quantity_after=' || v_quantity_after);
end $$;

-- 3.2 — quantidade inválida (0) continua rejeitada pela CHECK da tabela;
-- composição anterior intacta.
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid;
  v_raised boolean := false; v_quantity_after integer;
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(jsonb_build_object('id', v_a_active, 'quantity', 0)),
      '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised := true;
  end;

  select quantity into v_quantity_after from public.product_accessories where product_id = v_product_a and accessory_id = v_a_active;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('3', '3.2 quantidade inválida (0) continua rejeitada; quantidade anterior (3) intacta, nenhuma linha zerada',
      case when v_raised and v_quantity_after = 3 then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' quantity_after=' || v_quantity_after);
end $$;

-- 3.3 — falha no MEIO do array (1º item válido, 2º inválido) não deixa o 1º
-- item inserido sozinho — nem a composição fica "misturada" entre o
-- conjunto antigo e o novo: volta inteiramente ao estado anterior (1 linha,
-- {a_active:3}).
do $$
declare
  v_user_id uuid; v_product_a uuid; v_plates jsonb; v_a_active uuid; v_a_never uuid;
  v_raised boolean := false; v_count_before integer; v_count_after integer;
  v_ids_before uuid[]; v_ids_after uuid[];
begin
  select value::uuid into v_user_id from zz_pcil_fixtures where key = 'user_id';
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::jsonb into v_plates from zz_pcil_fixtures where key = 'plates';
  select value::uuid into v_a_active from zz_pcil_fixtures where key = 'a_active';
  select value::uuid into v_a_never from zz_pcil_fixtures where key = 'a_never';

  select count(*) into v_count_before from public.product_accessories where product_id = v_product_a;
  select coalesce(array_agg(accessory_id order by accessory_id), '{}') into v_ids_before
    from public.product_accessories where product_id = v_product_a;

  begin
    perform public.update_product_full(
      v_product_a, '{}'::jsonb, jsonb_build_array('teste'), v_plates, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_a_active, 'quantity', 55),
        jsonb_build_object('id', v_a_never, 'quantity', 1)
      ),
      '[]'::jsonb, v_user_id
    );
  exception when others then
    v_raised := true;
  end;

  select count(*) into v_count_after from public.product_accessories where product_id = v_product_a;
  select coalesce(array_agg(accessory_id order by accessory_id), '{}') into v_ids_after
    from public.product_accessories where product_id = v_product_a;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('3', '3.3 falha no meio do array: zero mistura entre conjunto antigo e novo, conjunto exatamente igual ao anterior (1 linha, qty=3)',
      case when v_raised and v_count_before = 1 and v_count_before = v_count_after and v_ids_before = v_ids_after
           then 'PASS' else 'FAIL' end,
      'raised=' || v_raised || ' count_before=' || v_count_before || ' count_after=' || v_count_after);
end $$;

-- =============================================================================
-- SEÇÃO 4 — SEGURANÇA (owner, SECURITY DEFINER, search_path, grants).
-- =============================================================================
do $$
declare
  v_owner text;
  v_security_definer boolean;
  v_search_path text;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
  v_public_can_execute boolean;
begin
  select pg_get_userbyid(proowner), prosecdef,
    (select setting from unnest(proconfig) as setting where setting like 'search_path=%')
    into v_owner, v_security_definer, v_search_path
    from pg_proc where proname = 'set_product_composition' and pronamespace = 'public'::regnamespace;

  select has_function_privilege('anon', 'public.set_product_composition(uuid,jsonb,jsonb,uuid)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.set_product_composition(uuid,jsonb,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.set_product_composition(uuid,jsonb,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;
  select has_function_privilege('public', 'public.set_product_composition(uuid,jsonb,jsonb,uuid)', 'EXECUTE') into v_public_can_execute;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('4', '4.1 owner=postgres, SECURITY DEFINER, search_path=vazio, EXECUTE só para service_role',
      case when v_owner = 'postgres' and v_security_definer and v_search_path = 'search_path=""'
             and not v_anon_can_execute and not v_authenticated_can_execute and not v_public_can_execute
             and v_service_role_can_execute
           then 'PASS' else 'FAIL' end,
      'owner=' || v_owner || ' secdef=' || v_security_definer || ' search_path=' || coalesce(v_search_path, '<null>') ||
      ' grants(anon/auth/public/service)=' || v_anon_can_execute || '/' || v_authenticated_can_execute || '/' ||
      v_public_can_execute || '/' || v_service_role_can_execute);
end $$;

-- =============================================================================
-- SEÇÃO 5 — ZERO RESÍDUO: composição final do Produto A é exatamente
-- {a_active:3}/{k_active:4} (1 linha cada, únicos sobreviventes depois das
-- remoções em 1.9/2.8); Produto B nunca foi tocado depois do setup, segue
-- com {a_other:1}/{k_other:1}.
-- =============================================================================
do $$
declare
  v_product_a uuid; v_product_b uuid;
  v_accessory_count_a integer; v_packaging_count_a integer;
  v_accessory_count_b integer; v_packaging_count_b integer;
begin
  select value::uuid into v_product_a from zz_pcil_fixtures where key = 'product_a';
  select value::uuid into v_product_b from zz_pcil_fixtures where key = 'product_b';

  select count(*) into v_accessory_count_a from public.product_accessories where product_id = v_product_a;
  select count(*) into v_packaging_count_a from public.product_packaging where product_id = v_product_a;
  select count(*) into v_accessory_count_b from public.product_accessories where product_id = v_product_b;
  select count(*) into v_packaging_count_b from public.product_packaging where product_id = v_product_b;

  insert into zz_pcil_test_results(section, test_name, status, details)
    values ('5', '5.1 zero resíduo: Produto A com 1 acessório ativo + 1 embalagem ativa; Produto B inalterado desde o setup (1+1)',
      case when v_accessory_count_a = 1 and v_packaging_count_a = 1
             and v_accessory_count_b = 1 and v_packaging_count_b = 1
           then 'PASS' else 'FAIL' end,
      'a: acc=' || v_accessory_count_a || ' pkg=' || v_packaging_count_a ||
      ' | b: acc=' || v_accessory_count_b || ' pkg=' || v_packaging_count_b);
end $$;

-- =============================================================================
-- Resumo
-- =============================================================================
select
  (select count(*) from zz_pcil_test_results where status = 'PASS') as pass_count,
  (select count(*) from zz_pcil_test_results where status = 'FAIL') as fail_count,
  (select count(*) from zz_pcil_test_results) as total_count,
  (select json_agg(json_build_object('section', section, 'test_name', test_name, 'status', status, 'details', details) order by seq) from zz_pcil_test_results) as results;

rollback;
