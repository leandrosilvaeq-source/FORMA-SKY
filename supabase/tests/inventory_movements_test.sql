-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário), Incremento 1 — TESTE DE
-- INTEGRAÇÃO de public.stock_movements / public.register_stock_movement
-- =============================================================================
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION.
-- NÃO deve ser colocado em supabase/migrations/, NUNCA deve ser executado
-- via `supabase db push`, e não deve ser referenciado pelo histórico de
-- migrations do projeto. Mesmo padrão e mesma estrutura de
-- supabase/tests/bloco1_integration_test.sql (não duplicado aqui — este
-- arquivo cobre só o Módulo 3, Incremento 1; o Bloco 1 continua coberto
-- pelo arquivo irmão).
--
-- Roda inteiro dentro de UMA ÚNICA transação, terminada sempre com ROLLBACK
-- (nunca COMMIT) — nenhum dado criado por este script persiste no banco.
--
-- Execução prevista (depois que as duas migrations desta rodada forem
-- aplicadas ao projeto remoto, com autorização explícita separada — NÃO
-- aplicadas nesta rodada):
--   npx supabase db query --linked --file supabase/tests/inventory_movements_test.sql
--
-- LIMITAÇÃO CONHECIDA E DELIBERADA (registrada aqui em vez de escondida):
-- este script roda em UMA transação/conexão só, portanto não pode executar
-- duas transações genuinamente concorrentes (isso exigiria duas conexões
-- reais, coordenadas — ex.: dois processos psql, ou pgbench). O teste
-- "duas saídas concorrentes não deixam saldo negativo" (Seção 4.4 abaixo)
-- é, por isso, uma aproximação SEQUENCIAL: duas saídas em sequência cuja
-- soma ultrapassaria o saldo, confirmando que a segunda é bloqueada pela
-- checagem de saldo. Isso valida a REGRA de negócio, mas não prova por si
-- só a ausência de condição de corrida sob concorrência real — a garantia
-- de concorrência real vem do `select ... for update` na linha do item
-- (revisado por leitura de código no relatório final desta rodada, mesmo
-- padrão de lock já usado e testado em produção por orders/payments). Uma
-- verificação de concorrência real (duas sessões psql simultâneas, ou
-- pgbench) fica registrada como próximo passo recomendado antes/durante a
-- aplicação remota desta migration.
--
-- Nenhum destes testes foi executado nesta sessão: o ambiente não tem
-- Docker/Postgres local nem a migration aplicada no remoto ainda. Este
-- arquivo foi revisado linha a linha contra a migration, mas sua execução
-- real fica pendente — ver relatório final.

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
  v_inactive_user_id uuid;
begin
  begin
    select id into v_user_id from public.users where is_active limit 1;
    if v_user_id is null then
      raise exception 'nenhum usuário ativo encontrado em public.users';
    end if;
    insert into zz_fixtures(key, value) values ('user_id', v_user_id::text)
      on conflict (key) do update set value = excluded.value;

    select id into v_inactive_user_id from public.users where not is_active limit 1;
    insert into zz_fixtures(key, value) values ('inactive_user_id', coalesce(v_inactive_user_id::text, ''))
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 localizar usuário ativo (e opcionalmente um inativo) em public.users', 'PASS',
              'user_id=' || v_user_id || ' inactive_user_id=' || coalesce(v_inactive_user_id::text, '(nenhum encontrado)'));
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 localizar usuário ativo em public.users', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_accessory_no_history_id uuid;
  v_packaging_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    if v_user_id is null then raise exception 'fixture ausente: user_id (setup 0.1 falhou)'; end if;

    v_accessory_id := (public.create_accessory(
      'TESTE ESTOQUE — Acessório principal', null, null, null, true, v_user_id
    )).id;
    v_accessory_no_history_id := (public.create_accessory(
      'TESTE ESTOQUE — Acessório sem histórico', null, null, null, true, v_user_id
    )).id;
    v_packaging_id := (public.create_packaging(
      'TESTE ESTOQUE — Embalagem principal', null, null, null, true, v_user_id
    )).id;

    insert into zz_fixtures(key, value) values ('accessory_id', v_accessory_id::text)
      on conflict (key) do update set value = excluded.value;
    insert into zz_fixtures(key, value) values ('accessory_no_history_id', v_accessory_no_history_id::text)
      on conflict (key) do update set value = excluded.value;
    insert into zz_fixtures(key, value) values ('packaging_id', v_packaging_id::text)
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.2 criar acessórios/embalagem de teste (via create_accessory/create_packaging já existentes)',
              'PASS', 'accessory_id=' || v_accessory_id || ' packaging_id=' || v_packaging_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.2 criar acessórios/embalagem de teste', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 1 — INITIAL_BALANCE
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_row public.stock_movements;
  v_current_stock integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    v_row := public.register_stock_movement('ACCESSORY', v_accessory_id, 'INITIAL_BALANCE', 50, v_user_id);

    select current_stock into v_current_stock from public.accessories where id = v_accessory_id;

    if v_row.balance_before <> 0 then raise exception 'balance_before deveria ser 0, veio %', v_row.balance_before; end if;
    if v_row.balance_after <> 50 then raise exception 'balance_after deveria ser 50, veio %', v_row.balance_after; end if;
    if v_row.quantity_delta <> 50 then raise exception 'quantity_delta deveria ser +50, veio %', v_row.quantity_delta; end if;
    if v_current_stock <> 50 then raise exception 'accessories.current_stock deveria ser 50, veio %', v_current_stock; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1 INITIAL_BALANCE válido (0 -> 50): balance_before/after, quantity_delta e current_stock corretos', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1 INITIAL_BALANCE válido (0 -> 50)', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'INITIAL_BALANCE', 10, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('1', '1.2 INITIAL_BALANCE repetido no mesmo item é rejeitado', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'INITIAL_BALANCE_ALREADY_EXISTS:%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('1', '1.2 INITIAL_BALANCE repetido no mesmo item é rejeitado', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('1', '1.2 INITIAL_BALANCE repetido no mesmo item é rejeitado', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.2 INITIAL_BALANCE repetido no mesmo item é rejeitado', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 2 — Entradas (PURCHASE, RETURN)
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_current_stock integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'PURCHASE', 20, v_user_id, 'compra de teste');

    select current_stock into v_current_stock from public.accessories where id = v_accessory_id;
    if v_current_stock <> 70 then raise exception 'esperado current_stock=70 (50+20), veio %', v_current_stock; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.1 PURCHASE (+20, com observação opcional) incrementa saldo (50 -> 70)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.1 PURCHASE incrementa saldo', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_current_stock integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    -- RETURN sem observação: opcional, não deve ser exigida.
    perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'RETURN', 5, v_user_id);

    select current_stock into v_current_stock from public.accessories where id = v_accessory_id;
    if v_current_stock <> 75 then raise exception 'esperado current_stock=75 (70+5), veio %', v_current_stock; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.2 RETURN (+5, sem observação) incrementa saldo (70 -> 75) — observação não é obrigatória', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.2 RETURN incrementa saldo sem exigir observação', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 3 — Ajustes e saídas manuais (motivo obrigatório)
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_current_stock integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'POSITIVE_ADJUSTMENT', 3, v_user_id, 'contagem física encontrou 3 a mais');

    select current_stock into v_current_stock from public.accessories where id = v_accessory_id;
    if v_current_stock <> 78 then raise exception 'esperado current_stock=78 (75+3), veio %', v_current_stock; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.1 POSITIVE_ADJUSTMENT com motivo é aceito (75 -> 78)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.1 POSITIVE_ADJUSTMENT com motivo é aceito', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_current_stock integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'LOSS', 2, v_user_id, 'peça quebrada na bancada');

    select current_stock into v_current_stock from public.accessories where id = v_accessory_id;
    if v_current_stock <> 76 then raise exception 'esperado current_stock=76 (78-2), veio %', v_current_stock; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.2 LOSS com motivo é aceito (78 -> 76)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.2 LOSS com motivo é aceito', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'LOSS', 1, v_user_id, null);
      insert into zz_test_results(section, test_name, status, details)
        values ('3', '3.3 LOSS sem motivo é rejeitado', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'register_stock_movement: motivo obrigatório%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('3', '3.3 LOSS sem motivo é rejeitado', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('3', '3.3 LOSS sem motivo é rejeitado', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.3 LOSS sem motivo é rejeitado', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_current_stock integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'SAMPLE_DONATION', 1, v_user_id, 'amostra enviada a cliente XYZ');

    select current_stock into v_current_stock from public.accessories where id = v_accessory_id;
    if v_current_stock <> 75 then raise exception 'esperado current_stock=75 (76-1), veio %', v_current_stock; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.4 SAMPLE_DONATION com motivo é aceito (76 -> 75)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.4 SAMPLE_DONATION com motivo é aceito', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'SAMPLE_DONATION', 1, v_user_id, '   ');
      insert into zz_test_results(section, test_name, status, details)
        values ('3', '3.4b SAMPLE_DONATION com motivo só de espaços em branco é rejeitado (btrim)', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'register_stock_movement: motivo obrigatório%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('3', '3.4b SAMPLE_DONATION com motivo só de espaços em branco é rejeitado (btrim)', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('3', '3.4b SAMPLE_DONATION com motivo só de espaços', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.4b SAMPLE_DONATION com motivo só de espaços', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_current_stock integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'INTERNAL_USE', 4, v_user_id, 'usado para fotografar o catálogo');

    select current_stock into v_current_stock from public.accessories where id = v_accessory_id;
    if v_current_stock <> 71 then raise exception 'esperado current_stock=71 (75-4), veio %', v_current_stock; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.5 INTERNAL_USE com motivo é aceito (75 -> 71)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.5 INTERNAL_USE com motivo é aceito', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_current_stock integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'NEGATIVE_ADJUSTMENT', 1, v_user_id, 'contagem física encontrou 1 a menos');

    select current_stock into v_current_stock from public.accessories where id = v_accessory_id;
    if v_current_stock <> 70 then raise exception 'esperado current_stock=70 (71-1), veio %', v_current_stock; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.6 NEGATIVE_ADJUSTMENT com motivo é aceito (71 -> 70)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.6 NEGATIVE_ADJUSTMENT com motivo é aceito', 'FAIL', sqlerrm);
  end;
end $$;

-- Estado do acessório principal ao fim da Seção 3: current_stock = 70.

-- =============================================================================
-- SEÇÃO 4 — Validações de quantidade, saldo, item e enums
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'PURCHASE', 0, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('4', '4.1 quantidade zero é rejeitada', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'register_stock_movement: p_quantity deve ser um inteiro positivo%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.1 quantidade zero é rejeitada', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.1 quantidade zero é rejeitada', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.1 quantidade zero é rejeitada', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    -- current_stock = 70 ao final da Seção 3 — pedir uma saída de 999 deve
    -- ser bloqueada.
    begin
      perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'INTERNAL_USE', 999, v_user_id, 'tentativa acima do saldo');
      insert into zz_test_results(section, test_name, status, details)
        values ('4', '4.2 saída maior que o saldo é bloqueada', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'STOCK_INSUFFICIENT_BALANCE:%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.2 saída maior que o saldo é bloqueada', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.2 saída maior que o saldo é bloqueada', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.2 saída maior que o saldo é bloqueada', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_current_stock integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    -- current_stock = 70 — uma saída de exatamente 70 deve deixar o saldo
    -- em exatamente zero (permitido: zero não é negativo).
    perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'INTERNAL_USE', 70, v_user_id, 'zerar saldo para o próximo teste');

    select current_stock into v_current_stock from public.accessories where id = v_accessory_id;
    if v_current_stock <> 0 then raise exception 'esperado current_stock=0, veio %', v_current_stock; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.3 saída que deixa o saldo exatamente em zero é aceita (70 -> 0)', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.3 saída que deixa o saldo exatamente em zero é aceita', 'FAIL', sqlerrm);
  end;
end $$;

-- 4.4 — ver LIMITAÇÃO CONHECIDA no cabeçalho do arquivo: aproximação
-- SEQUENCIAL de "duas saídas concorrentes não deixam saldo negativo", não
-- um teste de concorrência real (impossível numa única transação/conexão).
do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_second_status text;
  v_second_details text;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    -- Repõe saldo para 10 antes do cenário (saldo estava em 0 após 4.3).
    perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'PURCHASE', 10, v_user_id, 'reposição para teste 4.4');

    -- "Saída 1": consome 6 de 10 — deve suceder, deixando saldo em 4.
    perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'INTERNAL_USE', 6, v_user_id, 'saída 1 do cenário 4.4');

    -- "Saída 2": tenta consumir mais 6 (só há 4 disponíveis) — deve ser
    -- bloqueada, nunca deixando o saldo materializado ir a negativo.
    begin
      perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'INTERNAL_USE', 6, v_user_id, 'saída 2 do cenário 4.4 (deveria falhar)');
      v_second_status := 'FAIL';
      v_second_details := 'a segunda saída foi aceita indevidamente (saldo ficaria negativo)';
    exception when others then
      if sqlerrm like 'STOCK_INSUFFICIENT_BALANCE:%' then
        v_second_status := 'PASS';
        v_second_details := sqlerrm;
      else
        v_second_status := 'FAIL';
        v_second_details := 'erro inesperado: ' || sqlerrm;
      end if;
    end;

    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.4 [aproximação SEQUENCIAL, não concorrência real — ver limitação no cabeçalho] duas saídas cuja soma ultrapassa o saldo: a segunda é bloqueada, saldo nunca fica negativo',
              v_second_status, v_second_details);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.4 duas saídas cuja soma ultrapassa o saldo', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_fake_id uuid := gen_random_uuid();
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    if v_user_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_stock_movement('ACCESSORY', v_fake_id, 'PURCHASE', 1, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('4', '4.5 item (accessory) inexistente é rejeitado', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like '%não encontrado%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.5 item (accessory) inexistente é rejeitado', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.5 item (accessory) inexistente é rejeitado', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.5 item inexistente é rejeitado', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_stock_movement('FILAMENT_SPOOL', v_accessory_id, 'PURCHASE', 1, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('4', '4.6 item_type inválido (FILAMENT_SPOOL, ainda não suportado nesta etapa) é rejeitado', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'stock_movements.item_type inválido%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.6 item_type inválido é rejeitado', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.6 item_type inválido é rejeitado', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.6 item_type inválido é rejeitado', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'RESERVATION', 1, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('4', '4.7 movement_type inválido (RESERVATION, ainda não suportado nesta etapa) é rejeitado', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'stock_movements.movement_type inválido%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.7 movement_type inválido é rejeitado', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.7 movement_type inválido é rejeitado', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.7 movement_type inválido é rejeitado', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'PURCHASE', 1.5, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('4', '4.8 quantidade fracionada (1.5) em ACCESSORY é rejeitada', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'register_stock_movement: p_quantity deve ser um número inteiro%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.8 quantidade fracionada em ACCESSORY é rejeitada', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.8 quantidade fracionada em ACCESSORY é rejeitada', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.8 quantidade fracionada em ACCESSORY', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id';
    if v_user_id is null or v_packaging_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.register_stock_movement('PACKAGING', v_packaging_id, 'INITIAL_BALANCE', 2.25, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('4', '4.9 quantidade fracionada (2.25) em PACKAGING é rejeitada', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'register_stock_movement: p_quantity deve ser um número inteiro%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.9 quantidade fracionada em PACKAGING é rejeitada', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('4', '4.9 quantidade fracionada em PACKAGING é rejeitada', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.9 quantidade fracionada em PACKAGING', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 5 — Idempotência
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
  v_row1 public.stock_movements;
  v_row2 public.stock_movements;
  v_count integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id';
    if v_user_id is null or v_packaging_id is null then raise exception 'fixture ausente'; end if;

    v_row1 := public.register_stock_movement(
      'PACKAGING', v_packaging_id, 'INITIAL_BALANCE', 30, v_user_id,
      null, now(), null, null, 'idem-key-teste-5.1'
    );
    v_row2 := public.register_stock_movement(
      'PACKAGING', v_packaging_id, 'INITIAL_BALANCE', 30, v_user_id,
      null, now(), null, null, 'idem-key-teste-5.1'
    );

    select count(*) into v_count from public.stock_movements where idempotency_key = 'idem-key-teste-5.1';

    if v_row1.id <> v_row2.id then
      raise exception 'a segunda chamada com a mesma idempotency_key/payload deveria devolver a MESMA linha (id1=%, id2=%)', v_row1.id, v_row2.id;
    end if;
    if v_count <> 1 then
      raise exception 'esperado exatamente 1 linha gravada para a idempotency_key reusada, encontrado %', v_count;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 idempotency_key repetida com o MESMO payload é idempotente (mesma linha devolvida, sem duplicar)', 'PASS', 'id=' || v_row1.id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 idempotency_key repetida com o mesmo payload', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id';
    if v_user_id is null or v_packaging_id is null then raise exception 'fixture ausente'; end if;

    -- Mesma chave de 5.1, payload diferente (quantidade distinta) — deve
    -- ser rejeitado, nunca devolver sucesso silencioso.
    begin
      perform public.register_stock_movement(
        'PACKAGING', v_packaging_id, 'INITIAL_BALANCE', 99, v_user_id,
        null, now(), null, null, 'idem-key-teste-5.1'
      );
      insert into zz_test_results(section, test_name, status, details)
        values ('5', '5.2 idempotency_key repetida com payload DIFERENTE é rejeitada', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'IDEMPOTENCY_KEY_CONFLICT:%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('5', '5.2 idempotency_key repetida com payload diferente é rejeitada', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('5', '5.2 idempotency_key repetida com payload diferente é rejeitada', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.2 idempotency_key repetida com payload diferente', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 6 — Imutabilidade (UPDATE/DELETE proibidos para authenticated)
-- =============================================================================

do $$
declare
  v_movement_id uuid;
  v_status text;
  v_details text;
begin
  select id into v_movement_id from public.stock_movements limit 1;

  begin
    set local role authenticated;
    update public.stock_movements set reason = 'tentativa de edição' where id = v_movement_id;
    v_status := 'FAIL';
    v_details := 'UPDATE como authenticated foi permitido (não deveria)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('6', '6.1 [SET ROLE real] authenticated não consegue UPDATE em stock_movements', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('6', '6.1 [SET ROLE real] authenticated não consegue UPDATE em stock_movements', 'FAIL', 'erro no bloco: ' || sqlerrm);
end $$;

do $$
declare
  v_movement_id uuid;
  v_status text;
  v_details text;
begin
  select id into v_movement_id from public.stock_movements limit 1;

  begin
    set local role authenticated;
    delete from public.stock_movements where id = v_movement_id;
    v_status := 'FAIL';
    v_details := 'DELETE como authenticated foi permitido (não deveria)';
  exception when insufficient_privilege then
    v_status := 'PASS';
    v_details := sqlerrm;
  when others then
    v_status := 'FAIL';
    v_details := 'erro inesperado: ' || sqlerrm;
  end;

  reset role;

  insert into zz_test_results(section, test_name, status, details)
    values ('6', '6.2 [SET ROLE real] authenticated não consegue DELETE em stock_movements', v_status, v_details);
exception when others then
  reset role;
  insert into zz_test_results(section, test_name, status, details)
    values ('6', '6.2 [SET ROLE real] authenticated não consegue DELETE em stock_movements', 'FAIL', 'erro no bloco: ' || sqlerrm);
end $$;

-- Nota: authenticated não tem INSERT/UPDATE/DELETE grants em
-- stock_movements (revoke all + só grant select, migration
-- 20260827090000). service_role NÃO é explicitamente revogado ao nível de
-- grant nesta tabela — mesmo padrão já usado por todo o Bloco 1 para
-- order_status_history/payment_status_history/product_price_history/
-- payments (nenhuma dessas tabelas revoga UPDATE/DELETE de service_role
-- via GRANT/REVOKE). A imutabilidade "para uso normal da aplicação" depende
-- de disciplina arquitetural já estabelecida no projeto: Edge Functions
-- nunca fazem INSERT/UPDATE/DELETE direto em tabela nenhuma, só chamam
-- RPCs — e nenhuma RPC deste Incremento 1 expõe UPDATE/DELETE de
-- stock_movements. Isto é reportado explicitamente (não testado como
-- grant, para não afirmar uma proteção que não existe neste nível).

-- =============================================================================
-- SEÇÃO 7 — Exclusão segura de accessories/packaging com histórico
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.delete_accessory(v_accessory_id, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('7', '7.1 exclusão de accessory com histórico de estoque é bloqueada', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'ACCESSORY_HAS_STOCK_HISTORY:%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('7', '7.1 exclusão de accessory com histórico de estoque é bloqueada', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('7', '7.1 exclusão de accessory com histórico de estoque é bloqueada', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.1 exclusão de accessory com histórico', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_packaging_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_packaging_id from zz_fixtures where key = 'packaging_id';
    if v_user_id is null or v_packaging_id is null then raise exception 'fixture ausente'; end if;

    begin
      perform public.delete_packaging(v_packaging_id, v_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('7', '7.2 exclusão de packaging com histórico de estoque é bloqueada', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like 'PACKAGING_HAS_STOCK_HISTORY:%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('7', '7.2 exclusão de packaging com histórico de estoque é bloqueada', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('7', '7.2 exclusão de packaging com histórico de estoque é bloqueada', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2 exclusão de packaging com histórico', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_accessory_no_history_id uuid;
  v_still_exists boolean;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_no_history_id from zz_fixtures where key = 'accessory_no_history_id';
    if v_user_id is null or v_accessory_no_history_id is null then raise exception 'fixture ausente'; end if;

    -- Regressão: um accessory SEM nenhuma movimentação (nem vínculo em
    -- product_accessories) continua excluível normalmente — a nova
    -- checagem de stock_movements não bloqueia quando não há histórico.
    perform public.delete_accessory(v_accessory_no_history_id, v_user_id);

    select exists(select 1 from public.accessories where id = v_accessory_no_history_id) into v_still_exists;
    if v_still_exists then raise exception 'accessory sem histórico deveria ter sido excluído fisicamente'; end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.3 [regressão] exclusão de accessory SEM histórico/vínculo continua funcionando normalmente', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.3 [regressão] exclusão de accessory sem histórico continua funcionando', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 8 — Item desativado preserva saldo e histórico
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_accessory_id uuid;
  v_stock_before integer;
  v_stock_after integer;
  v_movement_count_before integer;
  v_movement_count_after integer;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_user_id is null or v_accessory_id is null then raise exception 'fixture ausente'; end if;

    select current_stock into v_stock_before from public.accessories where id = v_accessory_id;
    select count(*) into v_movement_count_before from public.stock_movements where item_type = 'ACCESSORY' and item_id = v_accessory_id;

    perform public.update_accessory(v_accessory_id, jsonb_build_object('is_active', false), v_user_id);

    select current_stock into v_stock_after from public.accessories where id = v_accessory_id;
    select count(*) into v_movement_count_after from public.stock_movements where item_type = 'ACCESSORY' and item_id = v_accessory_id;

    if v_stock_after <> v_stock_before then
      raise exception 'desativar o item alterou current_stock (antes=%, depois=%)', v_stock_before, v_stock_after;
    end if;
    if v_movement_count_after <> v_movement_count_before then
      raise exception 'desativar o item alterou a contagem de movimentações (antes=%, depois=%)', v_movement_count_before, v_movement_count_after;
    end if;

    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.1 desativar accessory (is_active=false) preserva current_stock e todo o histórico de stock_movements', 'PASS',
              'current_stock=' || v_stock_after || ' movimentações=' || v_movement_count_after);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.1 item desativado preserva saldo e histórico', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 9 — Usuário inválido/inativo/inexistente
-- =============================================================================

do $$
declare
  v_inactive_user_id_text text;
  v_accessory_id uuid;
begin
  begin
    select value into v_inactive_user_id_text from zz_fixtures where key = 'inactive_user_id';
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_accessory_id is null then raise exception 'fixture ausente: accessory_id'; end if;

    if v_inactive_user_id_text is null or v_inactive_user_id_text = '' then
      insert into zz_test_results(section, test_name, status, details)
        values ('9', '9.1 usuário inativo é rejeitado', 'SKIP', 'nenhum usuário inativo encontrado em public.users para este ambiente — não foi possível montar o cenário (não é uma falha do código, é limitação de dados do ambiente)');
    else
      begin
        perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'PURCHASE', 1, v_inactive_user_id_text::uuid);
        insert into zz_test_results(section, test_name, status, details)
          values ('9', '9.1 usuário inativo é rejeitado', 'FAIL', 'nenhuma exceção foi lançada');
      exception when others then
        if sqlerrm like '%inválido ou inativo%' then
          insert into zz_test_results(section, test_name, status, details)
            values ('9', '9.1 usuário inativo é rejeitado', 'PASS', sqlerrm);
        else
          insert into zz_test_results(section, test_name, status, details)
            values ('9', '9.1 usuário inativo é rejeitado', 'FAIL', 'erro inesperado: ' || sqlerrm);
        end if;
      end;
    end if;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.1 usuário inativo é rejeitado', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

do $$
declare
  v_fake_user_id uuid := gen_random_uuid();
  v_accessory_id uuid;
begin
  begin
    select value::uuid into v_accessory_id from zz_fixtures where key = 'accessory_id';
    if v_accessory_id is null then raise exception 'fixture ausente: accessory_id'; end if;

    begin
      perform public.register_stock_movement('ACCESSORY', v_accessory_id, 'PURCHASE', 1, v_fake_user_id);
      insert into zz_test_results(section, test_name, status, details)
        values ('9', '9.2 usuário inexistente é rejeitado', 'FAIL', 'nenhuma exceção foi lançada');
    exception when others then
      if sqlerrm like '%inválido ou inativo%' then
        insert into zz_test_results(section, test_name, status, details)
          values ('9', '9.2 usuário inexistente é rejeitado', 'PASS', sqlerrm);
      else
        insert into zz_test_results(section, test_name, status, details)
          values ('9', '9.2 usuário inexistente é rejeitado', 'FAIL', 'erro inesperado: ' || sqlerrm);
      end if;
    end;
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.2 usuário inexistente é rejeitado', 'FAIL', 'erro no bloco: ' || sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 10 — Grants e permissões
-- =============================================================================

do $$
declare
  v_sig text := 'register_stock_movement(text,uuid,text,numeric,uuid,text,timestamptz,text,uuid,text)';
  v_auth_ok boolean;
  v_service_ok boolean;
begin
  begin
    v_auth_ok := has_function_privilege('authenticated', 'public.' || v_sig, 'EXECUTE');
    v_service_ok := has_function_privilege('service_role', 'public.' || v_sig, 'EXECUTE');
    insert into zz_test_results(section, test_name, status, details)
    values (
      '10', '10.1 EXECUTE de register_stock_movement (authenticated=false, service_role=true)',
      case when v_auth_ok = false and v_service_ok = true then 'PASS' else 'FAIL' end,
      'authenticated=' || v_auth_ok || ' service_role=' || v_service_ok
    );
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.1 EXECUTE de register_stock_movement', 'FAIL', sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.2a authenticated TEM SELECT em stock_movements',
      case when has_table_privilege('authenticated', 'public.stock_movements', 'SELECT') then 'PASS' else 'FAIL' end,
      'SELECT=' || has_table_privilege('authenticated', 'public.stock_movements', 'SELECT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.2b authenticated NÃO tem INSERT em stock_movements',
      case when has_table_privilege('authenticated', 'public.stock_movements', 'INSERT') then 'FAIL' else 'PASS' end,
      'INSERT=' || has_table_privilege('authenticated', 'public.stock_movements', 'INSERT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.2c authenticated NÃO tem UPDATE em stock_movements',
      case when has_table_privilege('authenticated', 'public.stock_movements', 'UPDATE') then 'FAIL' else 'PASS' end,
      'UPDATE=' || has_table_privilege('authenticated', 'public.stock_movements', 'UPDATE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.2d authenticated NÃO tem DELETE em stock_movements',
      case when has_table_privilege('authenticated', 'public.stock_movements', 'DELETE') then 'FAIL' else 'PASS' end,
      'DELETE=' || has_table_privilege('authenticated', 'public.stock_movements', 'DELETE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.2e anon NÃO tem SELECT em stock_movements',
      case when has_table_privilege('anon', 'public.stock_movements', 'SELECT') then 'FAIL' else 'PASS' end,
      'SELECT(anon)=' || has_table_privilege('anon', 'public.stock_movements', 'SELECT'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.2f authenticated NÃO tem UPDATE em accessories.current_stock (coluna protegida desde a Migration 18)',
      case when has_column_privilege('authenticated', 'public.accessories', 'current_stock', 'UPDATE') then 'FAIL' else 'PASS' end,
      'UPDATE(current_stock)=' || has_column_privilege('authenticated', 'public.accessories', 'current_stock', 'UPDATE'));

    insert into zz_test_results(section, test_name, status, details)
    values ('10', '10.2g authenticated NÃO tem UPDATE em packaging.current_stock (coluna protegida desde a Migration 18)',
      case when has_column_privilege('authenticated', 'public.packaging', 'current_stock', 'UPDATE') then 'FAIL' else 'PASS' end,
      'UPDATE(current_stock)=' || has_column_privilege('authenticated', 'public.packaging', 'current_stock', 'UPDATE'));
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('10', '10.2 checagens de privilégio em stock_movements/accessories/packaging', 'FAIL', sqlerrm);
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
