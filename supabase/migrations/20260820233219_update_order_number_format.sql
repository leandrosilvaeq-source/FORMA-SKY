-- Bloco 1 — Clientes e Pedidos
-- Migration: atualiza o formato de public.orders.order_number de
-- FS-YYYY-NNNN (ano com 4 dígitos, sequência fixa em 4 dígitos, teto
-- artificial de 9999/ano) para FS-XX-YYY (ano com 2 dígitos, sequência
-- anual com no mínimo 3 dígitos, sem teto artificial — 1000, 10000 etc.
-- continuam representados por extenso, nunca truncados).
--
-- Decisões aprovadas nesta rodada (auditoria técnica prévia, não escrita
-- neste arquivo):
--   - fonte do ano na conversão de dados existentes = o próprio YYYY já
--     embutido no order_number atual (não order_date/created_at);
--   - esse ano deve necessariamente coincidir com o ano de order_date —
--     qualquer divergência aborta a migration inteira, sem conversão
--     parcial e sem escolher uma fonte "por padrão";
--   - qualquer order_number fora do formato antigo, qualquer duplicidade
--     projetada, ou qualquer sequência extraída inválida também abortam a
--     migration inteira;
--   - a tabela public.order_number_counters (Migration 6,
--     supabase/migrations/20260813215856_create_order_number_counter.sql)
--     e a lógica atômica INSERT ... ON CONFLICT (year) DO UPDATE são
--     preservadas sem nenhuma alteração estrutural nem de conteúdo — só a
--     formatação de saída de next_order_number() muda. A migration prova
--     isso: valida a consistência dos contadores antes de alterar
--     qualquer dado e confirma, na pós-validação, que a tabela ficou
--     bit-a-bit idêntica ao estado anterior;
--   - nenhuma tabela permanente de auditoria é criada: todo o estado
--     intermediário (projeção de conversão, snapshot dos contadores,
--     identificação da CHECK antiga) vive só em tabelas TEMPORARY (ON
--     COMMIT DROP), que nunca sobrevivem ao fim desta transação.
--
-- IMPORTANTE sobre lpad(): lpad(texto, largura) com uma LARGURA FIXA pode
-- TRUNCAR — se o texto já for mais longo que a largura pedida, lpad()
-- corta o excesso (ex.: lpad('12345', 3) devolve '123', não '12345').
-- Por isso esta migration nunca usa uma largura fixa para a sequência:
-- usa greatest(3, length(texto)) como largura, ou seja, a largura pedida
-- nunca é menor que o próprio texto — lpad() então só adiciona zeros à
-- esquerda até 3 dígitos quando o valor é curto, e devolve o texto
-- integralmente, sem cortar nada, quando ele já tem 4 dígitos ou mais
-- (1000, 9999, 10000, ...).
--
-- Ordem das operações dentro desta única transação (Supabase aplica cada
-- migration como uma transação — qualquer RAISE EXCEPTION abaixo desfaz
-- tudo, inclusive a conversão de dados):
--   1. pré-validações, nesta ordem exata:
--      1.1 formato antigo;
--      1.2 projeção temporária (extrai YYYY/NNNN e calcula o novo valor);
--      1.3 contagem (projeção cobre 100% das linhas);
--      1.4 sequência extraída válida;
--      1.5 ano do código == ano de order_date;
--      1.6 ausência de colisão projetada;
--      1.7 consistência de order_number_counters (contador existe e é
--          >= a maior sequência já emitida, para cada ano presente nos
--          pedidos) + snapshot completo do estado atual dos contadores;
--      1.8 identificação inequívoca da CHECK constraint antiga (sem
--          removê-la ainda);
--   2. só depois de TODAS as pré-validações passarem, início das
--      alterações: remoção da CHECK identificada em 1.8, conversão (um
--      único UPDATE set-based, só em order_number), nova CHECK
--      constraint, substituição de next_order_number(), atualização dos
--      comentários;
--   3. pós-validações: formato novo em 100% das linhas, contagem
--      inalterada, unicidade, correspondência exata com a projeção,
--      order_number_counters idêntica ao snapshot de 1.7, e a função
--      recriada preservando SECURITY DEFINER, search_path e ausência de
--      qualquer permissão nova.

-- =============================================================================
-- 1. PRÉ-VALIDAÇÕES
-- =============================================================================

-- 1.1 Todo order_number precisa estar no formato antigo esperado. Se
-- houver qualquer linha fora disso, aborta aqui — antes de tocar em
-- qualquer constraint ou dado, e sem tentar "adivinhar" um formato.
do $$
declare
  v_bad_format_count integer;
begin
  select count(*) into v_bad_format_count
    from public.orders
    where order_number !~ '^FS-[0-9]{4}-[0-9]{4}$';

  if v_bad_format_count > 0 then
    raise exception
      'Abortando update_order_number_format: % pedido(s) com order_number fora do formato esperado FS-YYYY-NNNN.',
      v_bad_format_count;
  end if;
end $$;

-- 1.2 Só depois de 1.1 confirmar que 100% das linhas batem com o formato
-- antigo é seguro extrair YYYY/NNNN por posição fixa. Tabela TEMPORARY
-- (nunca permanente — ON COMMIT DROP garante que desaparece no fim desta
-- transação) com o mapeamento projetado, reaproveitada pela validação de
-- contadores (1.7), pela conversão (seção 2) e pela prova de preservação
-- nas pós-validações (seção 3).
--
-- new_order_number usa largura DINÂMICA (greatest(3, length(...))), não
-- uma largura fixa — ver nota sobre lpad() no cabeçalho deste arquivo:
-- uma largura fixa de 3 truncaria uma sequência de 4+ dígitos (ex.:
-- lpad('1000', 3) viraria '100', corrompendo o número); a largura
-- dinâmica garante que o valor pedido nunca é menor que o próprio texto,
-- então uma sequência de 1000, 9999, 10000 etc. é sempre preservada por
-- extenso, e só sequências curtas (1 a 999) recebem zeros à esquerda até
-- completar 3 dígitos.
create temporary table _order_number_conversion (
  id uuid primary key,
  old_order_number text not null,
  old_year integer not null,
  old_sequence integer not null,
  new_order_number text not null
) on commit drop;

insert into _order_number_conversion (id, old_order_number, old_year, old_sequence, new_order_number)
select
  o.id,
  o.order_number,
  substring(o.order_number from 4 for 4)::integer,
  substring(o.order_number from 9 for 4)::integer,
  'FS-' || lpad((substring(o.order_number from 4 for 4)::integer % 100)::text, 2, '0') || '-' ||
    lpad(
      (substring(o.order_number from 9 for 4)::integer)::text,
      greatest(3, length((substring(o.order_number from 9 for 4)::integer)::text)),
      '0'
    )
  from public.orders o;

-- 1.3 A contagem projetada precisa corresponder exatamente à contagem
-- atual de pedidos — nenhuma linha pode ficar de fora da projeção (ex.:
-- por um order_number nulo, o que NOT NULL já impede, mas fica a defesa
-- em profundidade).
do $$
declare
  v_orders_count integer;
  v_projected_count integer;
begin
  select count(*) into v_orders_count from public.orders;
  select count(*) into v_projected_count from _order_number_conversion;

  if v_orders_count <> v_projected_count then
    raise exception
      'Abortando update_order_number_format: contagem projetada (%) difere da contagem atual de pedidos (%).',
      v_projected_count, v_orders_count;
  end if;
end $$;

-- 1.4 A sequência extraída (NNNN do formato antigo) precisa ser um número
-- positivo e coerente com o teto do formato antigo (nunca deveria passar
-- de 9999, já que a regex de 1.1 já garante exatamente 4 dígitos — este
-- check é defesa em profundidade, não uma correção de dado).
do $$
declare
  v_invalid_sequence_count integer;
begin
  select count(*) into v_invalid_sequence_count
    from _order_number_conversion
    where old_sequence <= 0 or old_sequence > 9999;

  if v_invalid_sequence_count > 0 then
    raise exception
      'Abortando update_order_number_format: % pedido(s) com sequência extraída de order_number inválida (fora de 1..9999).',
      v_invalid_sequence_count;
  end if;
end $$;

-- 1.5 O ano embutido no order_number atual (fonte aprovada para a
-- conversão) precisa coincidir com o ano de order_date. Qualquer
-- divergência aborta a migration inteira — nunca escolhemos
-- silenciosamente qual das duas fontes usar.
do $$
declare
  v_mismatch_count integer;
begin
  select count(*) into v_mismatch_count
    from _order_number_conversion c
    join public.orders o on o.id = c.id
    where c.old_year <> extract(year from o.order_date)::integer;

  if v_mismatch_count > 0 then
    raise exception
      'Abortando update_order_number_format: % pedido(s) com o ano do order_number divergente do ano de order_date — conversão exige decisão manual, não é assumida automaticamente.',
      v_mismatch_count;
  end if;
end $$;

-- 1.6 A conversão projetada não pode gerar nenhuma duplicidade em
-- order_number (a UNIQUE constraint pegaria isso no UPDATE de qualquer
-- forma, mas queremos abortar com uma mensagem clara antes de sequer
-- tentar escrever).
do $$
declare
  v_total_count integer;
  v_distinct_count integer;
begin
  select count(*), count(distinct new_order_number)
    into v_total_count, v_distinct_count
    from _order_number_conversion;

  if v_total_count <> v_distinct_count then
    raise exception
      'Abortando update_order_number_format: a conversão projetada geraria order_number duplicado (% linhas, % valores distintos).',
      v_total_count, v_distinct_count;
  end if;
end $$;

-- 1.7 Consistência de public.order_number_counters. Para cada ano
-- presente nos pedidos existentes (ano/sequência extraídos do formato
-- antigo já validado, via _order_number_conversion): precisa existir uma
-- linha correspondente em order_number_counters, e last_number precisa
-- ser >= a maior sequência já emitida naquele ano. Um contador ausente ou
-- abaixo do maior número emitido indicaria uma inconsistência prévia ao
-- alcance desta migration — abortamos e exigimos correção manual, nunca
-- ajustamos o contador automaticamente aqui. Um contador ACIMA do maior
-- pedido existente é aceitável (pode refletir pedidos removidos ou
-- números já reservados) e não é tratado como erro.
--
-- Também tira um snapshot completo (todas as linhas, não só os anos
-- acima) do estado atual de order_number_counters, em tabela TEMPORARY
-- (nunca permanente), para provar na pós-validação (seção 3) que a
-- tabela ficou absolutamente inalterada por esta migration.
create temporary table _order_number_counters_snapshot (
  year integer primary key,
  last_number integer not null
) on commit drop;

insert into _order_number_counters_snapshot (year, last_number)
select year, last_number from public.order_number_counters;

do $$
declare
  v_inconsistent_count integer;
  v_details text;
begin
  select count(*), string_agg(
      format('ano=%s maior_sequencia_emitida=%s last_number_atual=%s', y.old_year, y.max_seq, onc.last_number),
      '; '
    )
    into v_inconsistent_count, v_details
    from (
      select old_year, max(old_sequence) as max_seq
        from _order_number_conversion
        group by old_year
    ) y
    left join public.order_number_counters onc on onc.year = y.old_year
    where onc.year is null or onc.last_number < y.max_seq;

  if v_inconsistent_count > 0 then
    raise exception
      'Abortando update_order_number_format: order_number_counters inconsistente para % ano(s) — contador ausente ou abaixo da maior sequência já emitida (%).',
      v_inconsistent_count, v_details;
  end if;
end $$;

-- 1.8 Identificação inequívoca da CHECK constraint antiga de
-- order_number — só identifica e valida aqui, NUNCA remove nesta etapa.
-- Exige: exatamente uma CHECK constraint relacionada exclusivamente à
-- coluna order_number (conkey = [attnum de order_number], nunca uma
-- constraint multi-coluna nem uma constraint de outra coluna), e que sua
-- definição (via pg_get_constraintdef) realmente contenha a regex do
-- formato antigo — nunca confiamos em um nome fixo/adivinhado. Zero
-- constraints, mais de uma, ou uma definição inesperada abortam a
-- migration. O nome encontrado é guardado numa tabela TEMPORARY (nunca
-- permanente) para a remoção de fato acontecer só na seção 2, já como
-- primeira alteração real.
create temporary table _order_number_old_check (
  constraint_name text not null
) on commit drop;

do $$
declare
  v_attnum smallint;
  v_match_count integer;
  v_constraint_name text;
  v_constraint_def text;
begin
  select attnum into v_attnum
    from pg_attribute
    where attrelid = 'public.orders'::regclass
      and attname = 'order_number'
      and not attisdropped;

  if v_attnum is null then
    raise exception 'Abortando update_order_number_format: coluna public.orders.order_number não encontrada.';
  end if;

  select count(*) into v_match_count
    from pg_constraint con
    where con.conrelid = 'public.orders'::regclass
      and con.contype = 'c'
      and con.conkey = array[v_attnum]::smallint[];

  if v_match_count = 0 then
    raise exception 'Abortando update_order_number_format: nenhuma CHECK constraint encontrada para public.orders.order_number.';
  elsif v_match_count > 1 then
    raise exception 'Abortando update_order_number_format: % CHECK constraints encontradas para public.orders.order_number (esperado exatamente 1) — remoção manual necessária.', v_match_count;
  end if;

  select con.conname, pg_get_constraintdef(con.oid)
    into v_constraint_name, v_constraint_def
    from pg_constraint con
    where con.conrelid = 'public.orders'::regclass
      and con.contype = 'c'
      and con.conkey = array[v_attnum]::smallint[];

  -- Busca por substring LITERAL (position(), não regex/LIKE) — evita
  -- qualquer ambiguidade de escaping dos metacaracteres da própria regex
  -- (^, [, ], {, }, $) dentro da definição textual da constraint.
  if position('^FS-[0-9]{4}-[0-9]{4}$' in v_constraint_def) = 0 then
    raise exception
      'Abortando update_order_number_format: a CHECK constraint % não representa o formato antigo esperado (definição encontrada: %).',
      v_constraint_name, v_constraint_def;
  end if;

  insert into _order_number_old_check (constraint_name) values (v_constraint_name);
end $$;

-- =============================================================================
-- 2. ALTERAÇÕES (só a partir daqui — todas as pré-validações da seção 1
-- já passaram)
-- =============================================================================

-- 2.1 Remove exclusivamente a CHECK constraint identificada e validada em
-- 1.8 — nunca uma constraint arbitrária, nunca por nome adivinhado. A
-- UNIQUE constraint e o NOT NULL de order_number não são tocados aqui.
do $$
declare
  v_constraint_name text;
begin
  select constraint_name into v_constraint_name from _order_number_old_check;

  if v_constraint_name is null then
    raise exception 'Abortando update_order_number_format: nome da CHECK constraint antiga não foi identificado na pré-validação 1.8.';
  end if;

  execute format('alter table public.orders drop constraint %I', v_constraint_name);
end $$;

-- 2.2 Conversão: único UPDATE set-based, só em order_number. id,
-- order_date, created_at, cliente, empresa, itens, valores, status,
-- pagamentos, aprovações e qualquer outra coluna (inclusive
-- order_number_counters, validada em 1.7 e confirmada intacta na
-- pós-validação 3.5) permanecem intocados.
do $$
declare
  v_expected_count integer;
  v_updated_count integer;
begin
  select count(*) into v_expected_count from _order_number_conversion;

  update public.orders o
     set order_number = c.new_order_number
    from _order_number_conversion c
   where c.id = o.id;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> v_expected_count then
    raise exception
      'Abortando update_order_number_format: UPDATE afetou % linha(s), esperado %.',
      v_updated_count, v_expected_count;
  end if;
end $$;

-- 2.3 Nova CHECK constraint: exatamente 2 dígitos de ano, no mínimo 3
-- dígitos de sequência, sem teto máximo artificial.
alter table public.orders
  add constraint orders_order_number_check
  check (order_number ~ '^FS-[0-9]{2}-[0-9]{3,}$');

-- 2.4 Nova next_order_number(): mesma tabela de contador (nunca
-- recriada/alterada), mesma técnica atômica INSERT ... ON CONFLICT ...
-- DO UPDATE ... RETURNING, mesmo timezone America/Sao_Paulo, mesmo
-- reinício automático por ano, mesmo SECURITY DEFINER, mesmo
-- search_path, mesma ausência de GRANT EXECUTE para sessão (só chamável
-- de dentro de outra função security definer do mesmo owner, ex.:
-- create_order()). Só a expressão da linha RETURN muda: ano truncado
-- para 2 dígitos (v_year % 100) e sequência com largura DINÂMICA via
-- greatest(3, length(...)).
--
-- Sobre lpad(): uma largura FIXA (ex.: lpad(v_last_number_text, 3, '0'))
-- truncaria qualquer sequência de 4+ dígitos (1000 viraria '100') — por
-- isso a largura usada aqui nunca é um número fixo, é
-- greatest(3, length(v_last_number_text)): nunca menor que o próprio
-- texto, então sequências de 1000, 9999, 10000 etc. são sempre devolvidas
-- por extenso, sem nenhum corte, e só sequências curtas (1 a 999) recebem
-- zeros à esquerda até completar 3 dígitos.
create or replace function public.next_order_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from now() at time zone 'America/Sao_Paulo')::integer;
  v_last_number integer;
  v_last_number_text text;
begin
  insert into public.order_number_counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update
    set last_number = public.order_number_counters.last_number + 1
  returning last_number into v_last_number;

  v_last_number_text := v_last_number::text;

  return 'FS-' || lpad((v_year % 100)::text, 2, '0') || '-' ||
    lpad(v_last_number_text, greatest(3, length(v_last_number_text)), '0');
end;
$$;

revoke execute on function public.next_order_number() from public, anon, authenticated;
-- Nenhum GRANT EXECUTE é concedido — mesmo padrão de antes da conversão:
-- só chamável de dentro de outra função security definer do mesmo owner
-- (create_order()).

-- 2.5 Comentários que citavam o formato antigo.
comment on table public.order_number_counters is
  'Contador técnico interno para geração de orders.order_number (FS-XX-YYY: ano com 2 dígitos, sequência anual com no mínimo 3 dígitos, sem teto artificial acima de 999). Sem acesso de anon/authenticated — só acessível via next_order_number().';

comment on function public.next_order_number() is
  'Gera o próximo order_number no formato FS-XX-YYY (ano com 2 dígitos, sequência anual com no mínimo 3 dígitos — 1000, 10000 etc. continuam por extenso, nunca truncados, pois a largura de lpad() é sempre greatest(3, length(sequência)), nunca fixa) de forma atômica, reiniciando a sequência a cada ano. Função interna: sem GRANT EXECUTE para nenhuma role de sessão (anon/authenticated) — só chamável de dentro de outra função security definer do mesmo owner (ex.: create_order()).';

-- =============================================================================
-- 3. PÓS-VALIDAÇÕES
-- =============================================================================

-- 3.1 100% dos order_number precisam bater com o novo formato.
do $$
declare
  v_bad_format_count integer;
begin
  select count(*) into v_bad_format_count
    from public.orders
    where order_number !~ '^FS-[0-9]{2}-[0-9]{3,}$';

  if v_bad_format_count > 0 then
    raise exception
      'Abortando update_order_number_format: pós-validação falhou — % pedido(s) com order_number fora do novo formato FS-XX-YYY.',
      v_bad_format_count;
  end if;
end $$;

-- 3.2 A contagem de pedidos precisa permanecer exatamente a mesma de
-- antes da conversão (o UPDATE nunca insere/remove linhas, mas fica a
-- prova explícita).
do $$
declare
  v_orders_count integer;
  v_projected_count integer;
begin
  select count(*) into v_orders_count from public.orders;
  select count(*) into v_projected_count from _order_number_conversion;

  if v_orders_count <> v_projected_count then
    raise exception
      'Abortando update_order_number_format: pós-validação falhou — contagem de pedidos (%) difere da contagem pré-conversão (%).',
      v_orders_count, v_projected_count;
  end if;
end $$;

-- 3.3 Unicidade final (defesa em profundidade — a UNIQUE constraint já
-- garantiria isso durante o UPDATE, mas confirmamos explicitamente).
do $$
declare
  v_total_count integer;
  v_distinct_count integer;
begin
  select count(*), count(distinct order_number)
    into v_total_count, v_distinct_count
    from public.orders;

  if v_total_count <> v_distinct_count then
    raise exception
      'Abortando update_order_number_format: pós-validação falhou — order_number duplicado após a conversão (% linhas, % valores distintos).',
      v_total_count, v_distinct_count;
  end if;
end $$;

-- 3.4 Prova de preservação: o order_number final de cada linha precisa
-- bater exatamente com o valor projetado na seção 1 — confirma que ano e
-- sequência foram preservados numericamente, sem nenhuma linha
-- convertida parcial ou incorretamente.
do $$
declare
  v_mismatch_count integer;
begin
  select count(*) into v_mismatch_count
    from public.orders o
    join _order_number_conversion c on c.id = o.id
    where o.order_number <> c.new_order_number;

  if v_mismatch_count > 0 then
    raise exception
      'Abortando update_order_number_format: pós-validação falhou — % pedido(s) com order_number final divergente do valor projetado.',
      v_mismatch_count;
  end if;
end $$;

-- 3.5 order_number_counters precisa estar bit-a-bit idêntica ao snapshot
-- tirado em 1.7, antes de qualquer alteração — esta migration muda
-- apenas a FORMATAÇÃO de saída de next_order_number(), nunca o conteúdo
-- do contador. Diferença simétrica via EXCEPT nos dois sentidos: qualquer
-- linha adicionada, removida ou com last_number alterado é detectada.
do $$
declare
  v_diff_count integer;
begin
  select
      (select count(*) from (
        select year, last_number from public.order_number_counters
        except
        select year, last_number from _order_number_counters_snapshot
      ) added_or_changed)
    +
      (select count(*) from (
        select year, last_number from _order_number_counters_snapshot
        except
        select year, last_number from public.order_number_counters
      ) removed_or_changed)
    into v_diff_count;

  if v_diff_count > 0 then
    raise exception
      'Abortando update_order_number_format: pós-validação falhou — order_number_counters foi alterada durante a migration (% diferença(s) contra o snapshot pré-conversão).',
      v_diff_count;
  end if;
end $$;

-- 3.6/3.7/3.8 A função recriada precisa preservar SECURITY DEFINER, o
-- mesmo search_path, e nenhuma permissão de EXECUTE nova para anon/
-- authenticated (nem para PUBLIC — checado via ausência de GRANT
-- explícito, já que revoke foi reafirmado em 2.4).
do $$
declare
  v_is_security_definer boolean;
  v_search_path_raw text;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
begin
  select prosecdef into v_is_security_definer
    from pg_proc
    where oid = 'public.next_order_number()'::regprocedure;

  if not v_is_security_definer then
    raise exception 'Abortando update_order_number_format: pós-validação falhou — next_order_number() perdeu SECURITY DEFINER.';
  end if;

  select setting into v_search_path_raw
    from pg_proc, unnest(proconfig) as setting
    where oid = 'public.next_order_number()'::regprocedure
      and setting like 'search_path=%';

  if v_search_path_raw is null or replace(v_search_path_raw, ' ', '') <> 'search_path=public,pg_temp' then
    raise exception 'Abortando update_order_number_format: pós-validação falhou — next_order_number() com search_path inesperado: %.', v_search_path_raw;
  end if;

  select has_function_privilege('anon', 'public.next_order_number()', 'EXECUTE')
    into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.next_order_number()', 'EXECUTE')
    into v_authenticated_can_execute;

  if v_anon_can_execute or v_authenticated_can_execute then
    raise exception
      'Abortando update_order_number_format: pós-validação falhou — next_order_number() ganhou permissão de EXECUTE indevida (anon=%, authenticated=%).',
      v_anon_can_execute, v_authenticated_can_execute;
  end if;
end $$;
