-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário), Incremento 4 — TESTE DE
-- INTEGRAÇÃO do MVP de filamentos (filament_types/filament_spools/
-- filament_movements/product_filaments)
-- =============================================================================
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Mesmo padrão e estrutura de
-- supabase/tests/inventory_movements_test.sql: roda inteiro dentro de UMA
-- ÚNICA transação, terminada sempre com ROLLBACK — nenhum dado criado por
-- este script persiste no banco.
--
-- Execução prevista (depois que as 4 migrations desta rodada
-- (20260827100000/103000/106000/109000) forem aplicadas ao projeto remoto,
-- com autorização explícita separada — NÃO aplicadas nesta rodada):
--   npx supabase db query --linked --file supabase/tests/filament_inventory_test.sql
--
-- LIMITAÇÃO CONHECIDA (mesma de inventory_movements_test.sql): uma única
-- transação/conexão não pode exercitar concorrência real de duas sessões —
-- "duas movimentações concorrentes não deixam saldo negativo" é testado só
-- como aproximação SEQUENCIAL (Seção 3.7). A garantia real de concorrência
-- vem do `select ... for update` na linha do rolo (revisado por leitura de
-- código, mesmo padrão já usado por register_stock_movement).
--
-- NENHUM destes testes foi executado nesta sessão: o ambiente não tem
-- Docker/Postgres local nem as migrations aplicadas no remoto ainda. Este
-- arquivo foi revisado linha a linha contra as 4 migrations, mas sua
-- execução real fica pendente — ver relatório final.

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
begin
  begin
    select id into v_user_id from public.users where is_active limit 1;
    if v_user_id is null then raise exception 'nenhum usuário ativo encontrado em public.users'; end if;
    insert into zz_fixtures(key, value) values ('user_id', v_user_id::text)
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 localizar usuário ativo em public.users', 'PASS', 'user_id=' || v_user_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('0', '0.1 localizar usuário ativo em public.users', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 1 — filament_types: criação, material fechado, line livre, duplicata
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_id uuid;
begin
  begin
    select value::uuid into v_user_id from zz_fixtures where key = 'user_id';

    v_type_id := (public.create_filament_type(
      'PLA', 'Voolt3D', 'Sólida', 'Preto', 'PLA-BLK-01', 200, true, null, v_user_id
    )).id;
    insert into zz_fixtures(key, value) values ('type_id', v_type_id::text)
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1 create_filament_type cria tipo PLA/Voolt3D/Sólida/Preto', 'PASS', 'type_id=' || v_type_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.1 create_filament_type cria tipo válido', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    perform public.create_filament_type('ABS', 'Voolt3D', 'Sólida', 'Preto', null, null, true, null, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.2 create_filament_type rejeita ABS (fora do MVP aprovado)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.2 create_filament_type rejeita ABS (fora do MVP aprovado)',
        case when sqlerrm like '%material inválido%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_type_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    -- Linha livre: "Metálica" não está entre as 5 linhas sugeridas
    -- (Sólida/Silk/Velvet/Translúcido/DuoColor) e ainda assim deve ser
    -- aceita — line não é um enum travado no banco.
    v_type_id := (public.create_filament_type(
      'PETG', 'Fabricante Y', 'Metálica', 'Bronze', null, null, true, null, v_user_id
    )).id;
    insert into zz_fixtures(key, value) values ('type_free_line_id', v_type_id::text)
      on conflict (key) do update set value = excluded.value;
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.3 line aceita valor fora das 5 sugestões ("Metálica") — nunca um enum travado', 'PASS', 'type_id=' || v_type_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.3 line aceita valor livre não sugerido', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    -- Mesma combinação material+fabricante+linha+cor do 1.1 — deve violar a
    -- unique constraint (color_code diferente não muda a chave de unicidade).
    perform public.create_filament_type('PLA', 'Voolt3D', 'Sólida', 'Preto', 'outro-codigo', null, true, null, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.4 unique(material,manufacturer,line,commercial_color) bloqueia duplicata', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('1', '1.4 unique(material,manufacturer,line,commercial_color) bloqueia duplicata',
        case when sqlstate = '23505' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 2 — filament_spools: múltiplos rolos, pesos nominais diferentes,
-- saldo independente, código gerado
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_spool_1000_id uuid;
  v_spool_250_id uuid;
  v_code_1 text;
  v_code_2 text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_id from zz_fixtures where key = 'type_id';
  begin
    select id, code into v_spool_1000_id, v_code_1
      from public.create_filament_spool(v_type_id, 1000, 200, current_date, 'LACRADO', null, true, v_user_id);
    select id, code into v_spool_250_id, v_code_2
      from public.create_filament_spool(v_type_id, 250, null, current_date, 'LACRADO', null, true, v_user_id);

    insert into zz_fixtures(key, value) values
      ('spool_1000_id', v_spool_1000_id::text),
      ('spool_250_id', v_spool_250_id::text)
      on conflict (key) do update set value = excluded.value;

    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.1 dois rolos do mesmo tipo com pesos nominais diferentes (1000g e 250g — nunca fixo)',
        case when v_code_1 <> v_code_2 and v_code_1 like 'RL-%' and v_code_2 like 'RL-%' then 'PASS' else 'FAIL' end,
        'code_1=' || v_code_1 || ' code_2=' || v_code_2);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.1 dois rolos do mesmo tipo com pesos nominais diferentes', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_spool_1000_id uuid;
  v_spool_250_id uuid;
  v_balance_1000 numeric;
  v_balance_250 numeric;
begin
  select value::uuid into v_spool_1000_id from zz_fixtures where key = 'spool_1000_id';
  select value::uuid into v_spool_250_id from zz_fixtures where key = 'spool_250_id';
  begin
    select current_net_weight_grams into v_balance_1000 from public.filament_spools where id = v_spool_1000_id;
    select current_net_weight_grams into v_balance_250 from public.filament_spools where id = v_spool_250_id;
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.2 rolo recém-criado começa com peso disponível 0 (saldo inicial exige movimentação)',
        case when v_balance_1000 = 0 and v_balance_250 = 0 then 'PASS' else 'FAIL' end,
        'balance_1000=' || v_balance_1000 || ' balance_250=' || v_balance_250);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.2 rolo recém-criado começa com peso disponível 0', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_type_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_id from zz_fixtures where key = 'type_id';
  begin
    perform public.create_filament_spool(v_type_id, 0, null, null, null, null, true, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.3 nominal_weight_grams <= 0 é rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('2', '2.3 nominal_weight_grams <= 0 é rejeitado', 'PASS', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 3 — Movimentações: saldo inicial, compra, consumo, perda, ajustes,
-- teto do nominal, saldo negativo bloqueado, idempotência
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_movement public.filament_movements;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  begin
    v_movement := public.register_filament_movement(v_spool_id, 'INITIAL_BALANCE', 1000, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.1 INITIAL_BALANCE estabelece saldo inicial (1000g)',
        case when v_movement.balance_after = 1000 and v_movement.balance_before = 0 then 'PASS' else 'FAIL' end,
        'balance_after=' || v_movement.balance_after);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.1 INITIAL_BALANCE estabelece saldo inicial', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  begin
    perform public.register_filament_movement(v_spool_id, 'INITIAL_BALANCE', 500, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.2 INITIAL_BALANCE só pode ser a primeira movimentação do rolo', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.2 INITIAL_BALANCE só pode ser a primeira movimentação do rolo',
        case when sqlerrm like 'INITIAL_BALANCE_ALREADY_EXISTS:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_movement public.filament_movements;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  begin
    -- Saldo atual 1000/nominal 1000 — mais 100g de PURCHASE ultrapassaria o
    -- nominal (entrada de rotina, teto aplicado).
    v_movement := public.register_filament_movement(v_spool_id, 'PURCHASE', 100, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.3 PURCHASE que ultrapassaria o peso nominal é bloqueado (entrada de rotina)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.3 PURCHASE que ultrapassaria o peso nominal é bloqueado',
        case when sqlerrm like 'FILAMENT_EXCEEDS_NOMINAL:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_movement public.filament_movements;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  begin
    -- POSITIVE_ADJUSTMENT é isento do teto do nominal (ajuste explícito e
    -- documentado) — mesmo partindo de saldo já igual ao nominal (1000g).
    v_movement := public.register_filament_movement(v_spool_id, 'POSITIVE_ADJUSTMENT', 50, v_user_id, 'peso real acima do nominal cadastrado, conferido na balança');
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.4 POSITIVE_ADJUSTMENT é isento do teto do nominal (ajuste explícito e documentado)',
        case when v_movement.balance_after = 1050 then 'PASS' else 'FAIL' end, 'balance_after=' || v_movement.balance_after);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.4 POSITIVE_ADJUSTMENT é isento do teto do nominal', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  begin
    perform public.register_filament_movement(v_spool_id, 'MANUAL_CONSUMPTION', 100, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.5 MANUAL_CONSUMPTION sem motivo é rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.5 MANUAL_CONSUMPTION sem motivo é rejeitado',
        case when sqlerrm like '%motivo obrigatório%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_movement public.filament_movements;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  begin
    v_movement := public.register_filament_movement(v_spool_id, 'MANUAL_CONSUMPTION', 100, v_user_id, 'peça de teste impressa');
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.6 MANUAL_CONSUMPTION com motivo reduz o saldo (1050g -> 950g)',
        case when v_movement.balance_after = 950 then 'PASS' else 'FAIL' end, 'balance_after=' || v_movement.balance_after);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.6 MANUAL_CONSUMPTION com motivo reduz o saldo', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  begin
    -- Saldo atual 950g — pedir 2000g de LOSS deve estourar saldo negativo.
    perform public.register_filament_movement(v_spool_id, 'LOSS', 2000, v_user_id, 'rolo caiu no chão');
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.7 saldo negativo é bloqueado (aproximação sequencial de concorrência)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.7 saldo negativo é bloqueado',
        case when sqlerrm like 'FILAMENT_INSUFFICIENT_BALANCE:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_key text := 'zz-filament-idem-' || gen_random_uuid()::text;
  v_first public.filament_movements;
  v_second public.filament_movements;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  begin
    v_first := public.register_filament_movement(v_spool_id, 'RETURN', 10, v_user_id, null, now(), null, null, v_key);
    v_second := public.register_filament_movement(v_spool_id, 'RETURN', 10, v_user_id, null, now(), null, null, v_key);
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.8 idempotency_key reusada com o MESMO payload devolve a mesma movimentação (sem duplicar)',
        case when v_first.id = v_second.id then 'PASS' else 'FAIL' end,
        'first=' || v_first.id || ' second=' || v_second.id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.8 idempotency_key reusada com o mesmo payload é idempotente', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_key text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  select 'zz-filament-idem-' || gen_random_uuid()::text into v_key;
  begin
    perform public.register_filament_movement(v_spool_id, 'RETURN', 10, v_user_id, null, now(), null, null, v_key);
    -- Mesma chave, payload DIFERENTE (quantidade diferente) — deve ser rejeitado.
    perform public.register_filament_movement(v_spool_id, 'RETURN', 20, v_user_id, null, now(), null, null, v_key);
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.9 idempotency_key reusada com payload DIFERENTE é rejeitada', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.9 idempotency_key reusada com payload diferente é rejeitada',
        case when sqlerrm like 'IDEMPOTENCY_KEY_CONFLICT:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    perform public.register_filament_movement(
      (select value::uuid from zz_fixtures where key = 'spool_1000_id'),
      'WEIGHING_ADJUSTMENT', 10, v_user_id, 'tentativa indevida'
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.10 register_filament_movement rejeita WEIGHING_ADJUSTMENT (exclusivo de register_filament_weighing)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('3', '3.10 register_filament_movement rejeita WEIGHING_ADJUSTMENT',
        case when sqlerrm like '%WEIGHING_ADJUSTMENT só pode ser gravado por register_filament_weighing%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 4 — Rolo esgotado (ESGOTADO automático) e rolo descartado (terminal)
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_movement public.filament_movements;
  v_status text;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_250_id';
  begin
    perform public.register_filament_movement(v_spool_id, 'INITIAL_BALANCE', 250, v_user_id);
    v_movement := public.register_filament_movement(v_spool_id, 'MANUAL_CONSUMPTION', 250, v_user_id, 'consumo total do rolo em produção');
    select status into v_status from public.filament_spools where id = v_spool_id;
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.1 status ESGOTADO é aplicado automaticamente quando o saldo chega a zero',
        case when v_movement.balance_after = 0 and v_status = 'ESGOTADO' then 'PASS' else 'FAIL' end, 'status=' || v_status);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.1 status ESGOTADO é aplicado automaticamente ao chegar a zero', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_movement public.filament_movements;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_250_id';
  begin
    -- Rolo ESGOTADO ainda aceita movimentação (não é terminal como DESCARTADO).
    v_movement := public.register_filament_movement(v_spool_id, 'RETURN', 50, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.2 rolo ESGOTADO ainda aceita movimentação (não é terminal, diferente de DESCARTADO)',
        case when v_movement.balance_after = 50 then 'PASS' else 'FAIL' end, 'balance_after=' || v_movement.balance_after);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.2 rolo ESGOTADO ainda aceita movimentação', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_id from zz_fixtures where key = 'type_id';
  begin
    v_spool_id := (public.create_filament_spool(v_type_id, 500, null, null, 'ABERTO', null, true, v_user_id)).id;
    insert into zz_fixtures(key, value) values ('spool_discard_id', v_spool_id::text)
      on conflict (key) do update set value = excluded.value;
    perform public.update_filament_spool(v_spool_id, jsonb_build_object('status', 'DESCARTADO'), v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.3 update_filament_spool descarta um rolo (status=DESCARTADO)', 'PASS', 'spool_id=' || v_spool_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.3 update_filament_spool descarta um rolo', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_discard_id';
  begin
    perform public.register_filament_movement(v_spool_id, 'PURCHASE', 10, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.4 rolo DESCARTADO não aceita nova movimentação', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.4 rolo DESCARTADO não aceita nova movimentação',
        case when sqlerrm like 'FILAMENT_SPOOL_DISCARDED:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_discard_id';
  begin
    perform public.update_filament_spool(v_spool_id, jsonb_build_object('status', 'ABERTO'), v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.5 rolo DESCARTADO nunca é reativado automaticamente (transição de volta é bloqueada)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('4', '4.5 rolo DESCARTADO nunca é reativado (transição de volta bloqueada)',
        case when sqlerrm like 'FILAMENT_SPOOL_DISCARD_IS_FINAL:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 5 — Exclusão protegida e desativação segura
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  begin
    -- spool_1000_id já tem movimentações (Seção 3) — exclusão física deve
    -- ser bloqueada.
    perform public.delete_filament_spool(v_spool_id, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 rolo com movimentações não pode ser excluído fisicamente', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.1 rolo com movimentações não pode ser excluído',
        case when sqlerrm like 'FILAMENT_SPOOL_HAS_MOVEMENTS:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_type_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_id from zz_fixtures where key = 'type_id';
  begin
    -- type_id tem rolos vinculados — exclusão física deve ser bloqueada.
    perform public.delete_filament_type(v_type_id, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.2 tipo com rolo(s) vinculado(s) não pode ser excluído fisicamente', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.2 tipo com rolo(s) vinculado(s) não pode ser excluído',
        case when sqlerrm like 'FILAMENT_TYPE_HAS_SPOOLS:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_spool_id uuid;
  v_row public.filament_spools;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_id from zz_fixtures where key = 'type_id';
  begin
    v_spool_id := (public.create_filament_spool(v_type_id, 500, null, null, null, null, true, v_user_id)).id;
    perform public.delete_filament_spool(v_spool_id, v_user_id);
    select * into v_row from public.filament_spools where id = v_spool_id;
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.3 rolo SEM movimentações pode ser excluído fisicamente', case when v_row is null then 'PASS' else 'FAIL' end, 'spool_id=' || v_spool_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.3 rolo sem movimentações pode ser excluído', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_row public.filament_spools;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_1000_id';
  begin
    v_row := public.update_filament_spool(v_spool_id, jsonb_build_object('is_active', false), v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.4 desativação segura (is_active=false) não altera status físico do rolo',
        case when v_row.is_active = false and v_row.status <> 'DESCARTADO' then 'PASS' else 'FAIL' end,
        'is_active=' || v_row.is_active || ' status=' || v_row.status);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('5', '5.4 desativação segura não altera status físico', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 6 — vw_filament_type_summary: soma por tipo, exclui inativos/
-- esgotados/descartados
-- =============================================================================

do $$
declare
  v_type_id uuid;
  v_total numeric;
  v_usable_count integer;
begin
  select value::uuid into v_type_id from zz_fixtures where key = 'type_id';
  begin
    select total_available_grams, usable_spool_count into v_total, v_usable_count
      from public.vw_filament_type_summary where filament_type_id = v_type_id;
    -- spool_1000_id: saldo 950g mas is_active=false (Seção 5.4) -> excluído.
    -- spool_250_id: saldo 50g, ABERTO/ativo -> incluído.
    -- spool_discard_id: DESCARTADO -> excluído.
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.1 total_available_grams soma só rolos ativos e utilizáveis (exclui inativo/esgotado/descartado)',
        case when v_total = 50 and v_usable_count = 1 then 'PASS' else 'FAIL' end,
        'total=' || v_total || ' usable_count=' || v_usable_count);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('6', '6.1 total_available_grams soma só rolos ativos e utilizáveis', 'FAIL', sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 7 — Pesagem física
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_type_id uuid;
  v_spool_tare_id uuid;
  v_spool_no_tare_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_type_id from zz_fixtures where key = 'type_id';
  begin
    v_spool_tare_id := (public.create_filament_spool(v_type_id, 1000, 200, null, null, null, true, v_user_id)).id;
    v_spool_no_tare_id := (public.create_filament_spool(v_type_id, 1000, null, null, null, null, true, v_user_id)).id;
    perform public.register_filament_movement(v_spool_tare_id, 'INITIAL_BALANCE', 800, v_user_id);
    perform public.register_filament_movement(v_spool_no_tare_id, 'INITIAL_BALANCE', 800, v_user_id);
    insert into zz_fixtures(key, value) values
      ('spool_tare_id', v_spool_tare_id::text),
      ('spool_no_tare_id', v_spool_no_tare_id::text)
      on conflict (key) do update set value = excluded.value;
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.0 setup: dois rolos novos (com e sem tara conhecida), saldo inicial 800g', 'PASS', null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.0 setup pesagem', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_movement public.filament_movements;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_tare_id';
  begin
    -- Tara conhecida = 200g. Peso bruto medido = 950g -> líquido = 750g
    -- (saldo anterior 800g -> diferença de -50g).
    v_movement := public.register_filament_weighing(v_spool_id, 950, null, 'conferência mensal', v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.1 pesagem com tara conhecida: peso disponível = peso bruto - tara (950-200=750)',
        case when v_movement.balance_after = 750 and v_movement.quantity_delta = -50 then 'PASS' else 'FAIL' end,
        'balance_after=' || v_movement.balance_after || ' delta=' || v_movement.quantity_delta);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.1 pesagem com tara conhecida calcula peso líquido corretamente', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_movement public.filament_movements;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_no_tare_id';
  begin
    -- Tara desconhecida -> peso líquido informado diretamente (820g,
    -- diferença de +20g em relação ao saldo anterior de 800g).
    v_movement := public.register_filament_weighing(v_spool_id, null, 820, 'pesagem direta, carretel sem tara cadastrada', v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2 pesagem sem tara conhecida aceita peso líquido informado diretamente (nunca inventa tara)',
        case when v_movement.balance_after = 820 and v_movement.quantity_delta = 20 then 'PASS' else 'FAIL' end,
        'balance_after=' || v_movement.balance_after);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.2 pesagem sem tara conhecida aceita peso líquido direto', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_tare_id';
  begin
    -- peso bruto medido informado, mas o rolo tem tara conhecida (200g) —
    -- pedir peso bruto abaixo da tara não faz sentido físico.
    perform public.register_filament_weighing(v_spool_id, 100, null, 'teste', v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.3 peso bruto medido abaixo da tara é rejeitado (resultado líquido negativo)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.3 peso bruto medido abaixo da tara é rejeitado', 'PASS', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_no_tare_id';
  begin
    -- Peso líquido negativo direto é rejeitado.
    perform public.register_filament_weighing(v_spool_id, null, -5, 'teste', v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.4 peso líquido negativo é rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.4 peso líquido negativo é rejeitado', 'PASS', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_tare_id';
  begin
    perform public.register_filament_weighing(v_spool_id, 950, 750, 'os dois pesos ao mesmo tempo', v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.5 informar os dois pesos ao mesmo tempo é rejeitado', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.5 informar os dois pesos ao mesmo tempo é rejeitado', 'PASS', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
  v_movement public.filament_movements;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_tare_id';
  begin
    -- Saldo atual do spool_tare_id é 750g (após 7.1) — pesagem que confirma
    -- exatamente o mesmo peso líquido não deve gravar movimentação (delta
    -- zero: nada mudou).
    v_movement := public.register_filament_weighing(v_spool_id, 950, null, 'conferência repetida', v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.6 pesagem com diferença zero não grava movimentação (devolve null)',
        case when v_movement is null then 'PASS' else 'FAIL' end, 'movement=' || coalesce(v_movement.id::text, 'null'));
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.6 pesagem com diferença zero não grava movimentação', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_spool_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_spool_id from zz_fixtures where key = 'spool_tare_id';
  begin
    perform public.register_filament_weighing(v_spool_id, 900, null, null, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.7 motivo é sempre obrigatório na pesagem (nenhuma tolerância percentual inventada)', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('7', '7.7 motivo é sempre obrigatório na pesagem',
        case when sqlerrm like '%motivo obrigatório%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 8 — product_filaments (preparação de composição, requisito 9)
-- =============================================================================

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  begin
    v_product_id := public.create_product(
      'TESTE FILAMENTO — Produto Composição', 'CATALOG', 'teste', 'produto criado pelo script de teste de filamentos',
      100.00, 120, 25.50, 4, null, false, v_user_id
    );
    insert into zz_fixtures(key, value) values ('product_id', v_product_id::text)
      on conflict (key) do update set value = excluded.value;
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.0 setup: produto de teste criado', 'PASS', 'product_id=' || v_product_id);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.0 setup: criar produto de teste', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_type_id uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
  select value::uuid into v_type_id from zz_fixtures where key = 'type_id';
  begin
    perform public.set_product_filaments(
      v_product_id,
      jsonb_build_array(jsonb_build_object('id', v_type_id, 'theoretical_weight_grams', 35.5)),
      v_user_id
    );
    select count(*) into v_count from public.product_filaments where product_id = v_product_id;
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.1 set_product_filaments grava a composição (peso teórico fracionário)',
        case when v_count = 1 then 'PASS' else 'FAIL' end, 'count=' || v_count);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.1 set_product_filaments grava a composição', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_count integer;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
  begin
    -- Substitui pelo conjunto vazio — atômico (delete + insert do zero).
    perform public.set_product_filaments(v_product_id, '[]'::jsonb, v_user_id);
    select count(*) into v_count from public.product_filaments where product_id = v_product_id;
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.2 set_product_filaments substitui atomicamente (conjunto vazio remove a composição anterior)',
        case when v_count = 0 then 'PASS' else 'FAIL' end, 'count=' || v_count);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.2 set_product_filaments substitui atomicamente', 'FAIL', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
  begin
    perform public.set_product_filaments(
      v_product_id, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'theoretical_weight_grams', 10)), v_user_id
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.3 set_product_filaments rejeita filament_type_id inexistente', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.3 set_product_filaments rejeita filament_type_id inexistente',
        case when sqlerrm like '%não encontrado ou inativo%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_type_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
  select value::uuid into v_type_id from zz_fixtures where key = 'type_id';
  begin
    perform public.set_product_filaments(
      v_product_id, jsonb_build_array(jsonb_build_object('id', v_type_id, 'theoretical_weight_grams', 0)), v_user_id
    );
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4 set_product_filaments rejeita theoretical_weight_grams <= 0', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.4 set_product_filaments rejeita theoretical_weight_grams <= 0', 'PASS', sqlerrm);
  end;
end $$;

do $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_type_id uuid;
begin
  select value::uuid into v_user_id from zz_fixtures where key = 'user_id';
  select value::uuid into v_product_id from zz_fixtures where key = 'product_id';
  select value::uuid into v_type_id from zz_fixtures where key = 'type_id';
  begin
    perform public.set_product_filaments(
      v_product_id, jsonb_build_array(jsonb_build_object('id', v_type_id, 'theoretical_weight_grams', 35.5)), v_user_id
    );
    perform public.delete_filament_type(v_type_id, v_user_id);
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.5 tipo vinculado à composição de um produto não pode ser excluído', 'FAIL', 'não levantou exceção');
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('8', '8.5 tipo vinculado à composição de um produto não pode ser excluído',
        case when sqlerrm like 'FILAMENT_TYPE_HAS_COMPOSITION:%' or sqlerrm like 'FILAMENT_TYPE_HAS_SPOOLS:%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end $$;

-- =============================================================================
-- SEÇÃO 9 — Imutabilidade do histórico e privilégios (RLS/grants)
-- =============================================================================

do $$
begin
  begin
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.1a authenticated TEM SELECT em filament_movements',
        case when has_table_privilege('authenticated', 'public.filament_movements', 'SELECT') then 'PASS' else 'FAIL' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.1b authenticated NÃO tem INSERT em filament_movements (histórico imutável, só via RPC)',
        case when has_table_privilege('authenticated', 'public.filament_movements', 'INSERT') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.1c authenticated NÃO tem UPDATE em filament_movements',
        case when has_table_privilege('authenticated', 'public.filament_movements', 'UPDATE') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.1d authenticated NÃO tem DELETE em filament_movements',
        case when has_table_privilege('authenticated', 'public.filament_movements', 'DELETE') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.1e anon NÃO tem SELECT em filament_movements',
        case when has_table_privilege('anon', 'public.filament_movements', 'SELECT') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.2a authenticated NÃO tem INSERT/UPDATE direto em filament_types (só via RPC)',
        case when has_table_privilege('authenticated', 'public.filament_types', 'INSERT')
               or has_table_privilege('authenticated', 'public.filament_types', 'UPDATE') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.2b authenticated NÃO tem INSERT/UPDATE direto em filament_spools (só via RPC)',
        case when has_table_privilege('authenticated', 'public.filament_spools', 'INSERT')
               or has_table_privilege('authenticated', 'public.filament_spools', 'UPDATE') then 'FAIL' else 'PASS' end, null);
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.3 authenticated TEM SELECT em vw_filament_type_summary',
        case when has_table_privilege('authenticated', 'public.vw_filament_type_summary', 'SELECT') then 'PASS' else 'FAIL' end, null);
  exception when others then
    insert into zz_test_results(section, test_name, status, details)
      values ('9', '9.x checagens de privilégio', 'FAIL', sqlerrm);
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
