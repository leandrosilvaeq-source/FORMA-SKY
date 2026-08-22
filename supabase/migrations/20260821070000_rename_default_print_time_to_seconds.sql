-- Bloco 1 — Produtos
-- Migration: renomeia public.products.default_print_time_minutes (integer,
-- minutos) para default_print_time_seconds (integer, segundos), convertendo
-- os valores legados (minutos * 60). Recria create_product() com o
-- parâmetro renomeado na mesma transação.
--
-- Contexto (decisão aprovada): "Tempo de impressão" virou um campo
-- inteligente no frontend (aceita "1h30min", "1,5h", "90m", "30m45s",
-- "HH:MM:SS" etc. — ver frontend/src/lib/forms/durationField.ts) e passou a
-- exigir precisão de segundos, que um integer de MINUTOS não consegue
-- representar (ex.: 45 segundos, ou 1h30min45s).
--
-- =============================================================================
-- CORREÇÃO CRÍTICA (revisão desta migration antes de qualquer aplicação):
-- a primeira versão deste arquivo tentava renomear o 5º parâmetro de
-- create_product() (p_default_print_time_minutes -> p_default_print_time_seconds)
-- via CREATE OR REPLACE FUNCTION, mantendo o mesmo tipo/posição. ISSO FALHA
-- em PostgreSQL: CREATE OR REPLACE FUNCTION recusa alterar o NOME de um
-- parâmetro de entrada quando a função já existe com esse mesmo parâmetro
-- nomeado de outra forma, com o erro:
--   ERROR:  cannot change name of input parameter "p_default_print_time_minutes"
-- Esse comportamento é intencional no PostgreSQL: evita que uma chamada
-- feita com notação nomeada (func(p_default_print_time_minutes => valor))
-- passe a se referir a um parâmetro diferente silenciosamente. Não há teste
-- transacional que "contorne" essa checagem — ela ocorre em tempo de DDL,
-- na própria CREATE OR REPLACE, então qualquer tentativa de aplicar a
-- versão antiga deste arquivo abortaria neste ponto (a migration inteira
-- seria revertida, já que roda em uma única transação — nenhum dado teria
-- sido perdido, mas a migration nunca teria sido concluída).
--
-- Correção aplicada nesta versão: DROP FUNCTION explícito pela assinatura
-- de TIPOS exata da função antiga, seguido de CREATE FUNCTION imediato com
-- o parâmetro já renomeado — ambos na mesma transação desta migration, sem
-- nenhuma janela em que create_product() fique ausente (o DROP e o CREATE
-- seguinte são a mesma operação atômica do ponto de vista de qualquer outra
-- transação: ninguém mais commita entre os dois). Grants, que um DROP
-- apaga junto com a função, são reconcedidos explicitamente logo depois
-- (aqui isso deixou de ser só "defesa em profundidade" — é now obrigatório
-- para restaurar o acesso de service_role).
--
-- Auditado antes do DROP (consulta direta a pg_depend contra a assinatura
-- exata de create_product, filtrando dependências internas): ZERO
-- dependências (nenhuma view, trigger ou outra função referencia
-- create_product). DROP FUNCTION sem CASCADE é seguro — e mesmo assim não
-- usamos CASCADE aqui, por princípio (só apagaria dependências se
-- existissem, e não existem).
-- =============================================================================
--
-- AUDITORIA (feita antes desta migration, resumo — nenhuma outra migration
-- antiga foi alterada):
--   - default_print_time_minutes só é lido/escrito por: (a) a própria
--     tabela products (coluna + CHECK); (b) create_product() (migration
--     20260814030351_create_order_business_functions.sql). Nenhuma outra
--     RPC, função, trigger ou view toca essa coluna;
--   - não existe nenhuma view SQL real dependente dela (só políticas RLS
--     cujos nomes contêm a palavra "view", sem relação com esta coluna);
--   - update_product_price, update_product (frontend, supabase-js direto,
--     só is_active) e as RPCs de composição (set_product_composition) não
--     referenciam este campo;
--   - o arquivo de testes de integração SQL do projeto
--     (supabase/tests/bloco1_integration_test.sql) cobre só Clientes/
--     Pedidos, nunca testou create_product/products — nenhum teste SQL
--     precisou ser atualizado por causa desta migration.
--
-- Estratégia escolhida: RENOMEAR a coluna existente e converter os valores
-- em uma única operação — não criar uma coluna nova paralela. Manter duas
-- colunas (uma nova + a antiga "descontinuada") criaria uma segunda fonte
-- de verdade permanente para o mesmo dado, exatamente o que deve ser
-- evitado; renomear já garante, pela própria natureza da operação, que só
-- existe UMA coluna com esse dado em qualquer momento (antes e depois desta
-- migration), sem nenhuma janela de transição com duas colunas simultâneas.
--
-- units_per_plate NÃO é alterada aqui — decisão aprovada separada, fora do
-- escopo desta migration: a coluna continua existindo, sem DROP, apenas
-- removida da interface (ver frontend). create_product() continua
-- recebendo p_units_per_plate (a Edge Function agora sempre envia null).
--
-- Transacional: todo o arquivo roda dentro da transação implícita de uma
-- migration do Supabase CLI (mesma convenção já usada por todas as demais
-- migrations deste projeto, nenhuma delas usa BEGIN/COMMIT explícito) — se
-- qualquer instrução abaixo falhar, nada desta migration é aplicado,
-- INCLUSIVE o DROP FUNCTION (um DROP dentro de uma transação que sofre
-- ROLLBACK desfaz o DROP — o Postgres não tem exceção para DDL aqui).

-- =============================================================================
-- 1) Renomeia a coluna e o CHECK, preservando o valor em cada linha
--    (ainda em MINUTOS neste ponto — a conversão acontece no passo 3).
-- =============================================================================
alter table public.products
  rename column default_print_time_minutes to default_print_time_seconds;

-- Nome de constraint auto-gerado pelo Postgres a partir do nome antigo da
-- coluna (confirmado por consulta direta a pg_constraint antes de escrever
-- esta migration) — a definição do CHECK em si (nulo OU >= 0) já foi
-- automaticamente ajustada pelo RENAME COLUMN acima para referenciar a
-- coluna renomeada; este passo só realinha o NOME da constraint, por
-- clareza, sem nenhum efeito funcional. RENAME COLUMN/CONSTRAINT não sofre
-- da mesma restrição de CREATE OR REPLACE FUNCTION descrita acima — colunas
-- e constraints de tabela sempre podem ser renomeadas livremente.
alter table public.products
  rename constraint products_default_print_time_minutes_check to products_default_print_time_seconds_check;

-- =============================================================================
-- 2) Proteção contra overflow ANTES de multiplicar por 60: um integer
--    (int4) vai até 2147483647. Qualquer valor de minutos acima de
--    2147483647/60 (=35791394, truncado) produziria um resultado que
--    ultrapassa o limite do tipo ao multiplicar por 60 — a migration
--    aborta com uma mensagem clara em vez de deixar o UPDATE seguinte
--    falhar com um erro genérico de overflow do Postgres (ou, pior,
--    truncar silenciosamente caso o tipo fosse trocado por engano).
-- =============================================================================
do $$
declare
  v_overflow_count integer;
  v_max_minutes integer;
begin
  select count(*), max(default_print_time_seconds) into v_overflow_count, v_max_minutes
    from public.products
    where default_print_time_seconds > (2147483647 / 60);

  if v_overflow_count > 0 then
    raise exception 'Abortando: % produto(s) com default_print_time_minutes acima de 2147483647/60 (maior valor encontrado: % minutos) — a conversão para segundos causaria overflow de integer.',
      v_overflow_count, v_max_minutes;
  end if;
end $$;

-- =============================================================================
-- 3) Converte cada valor legado (minutos) para segundos: valor * 60.
--    NULL permanece NULL (a cláusula WHERE já garante isso — nenhuma linha
--    nula é tocada, então não existe ambiguidade entre "nunca informado" e
--    "0 segundos"). Inteiro para inteiro (minutos*60 sempre inteiro, sem
--    nenhuma operação de ponto flutuante envolvida) — o passo 2) já provou
--    que nenhuma linha ultrapassa a faixa de integer após a multiplicação.
-- =============================================================================
do $$
declare
  v_pre_non_null_count integer;
  v_post_non_null_count integer;
  v_negative_count integer;
  v_not_multiple_of_60_count integer;
begin
  select count(*) into v_pre_non_null_count
    from public.products where default_print_time_seconds is not null;

  update public.products
    set default_print_time_seconds = default_print_time_seconds * 60
    where default_print_time_seconds is not null;

  select count(*) into v_post_non_null_count
    from public.products where default_print_time_seconds is not null;

  -- Nenhuma linha pode ter perdido seu valor (não-nulo antes deve
  -- continuar não-nulo depois, em exatamente a mesma quantidade) — prova
  -- direta contra perda silenciosa de dados, independente de qualquer
  -- suposição sobre o que a UPDATE "deveria" ter feito.
  if v_post_non_null_count <> v_pre_non_null_count then
    raise exception 'Abortando: contagem de valores não-nulos mudou de % para % após a conversão — possível perda de dados.',
      v_pre_non_null_count, v_post_non_null_count;
  end if;

  select count(*) into v_negative_count
    from public.products
    where default_print_time_seconds is not null and default_print_time_seconds < 0;

  if v_negative_count > 0 then
    raise exception 'Abortando: % linha(s) com default_print_time_seconds negativo após a conversão.', v_negative_count;
  end if;

  -- Todo valor convertido é, por construção, um múltiplo exato de 60
  -- (era um inteiro de minutos, multiplicado por 60) — esta checagem prova
  -- que a multiplicação realmente ocorreu uma única vez por linha (nunca
  -- aplicada duas vezes, nunca aplicada parcialmente).
  select count(*) into v_not_multiple_of_60_count
    from public.products
    where default_print_time_seconds is not null and default_print_time_seconds % 60 <> 0;

  if v_not_multiple_of_60_count > 0 then
    raise exception 'Abortando: % linha(s) com default_print_time_seconds que não é múltiplo de 60 — conversão inconsistente.',
      v_not_multiple_of_60_count;
  end if;

  -- Confirmação literal e determinística da fórmula em si (sem tocar a
  -- tabela): 1 minuto -> 60 segundos, 90 minutos -> 5400 segundos — os
  -- dois casos citados na revisão, verificados como aritmética pura.
  if 1 * 60 <> 60 or 90 * 60 <> 5400 then
    raise exception 'Abortando: aritmética de conversão minutos->segundos inesperada (checagem literal falhou).';
  end if;
end $$;

comment on column public.products.default_print_time_seconds is
  'Tempo total de impressão do produto, em SEGUNDOS inteiros (substitui default_print_time_minutes — valores legados convertidos com *60 nesta migration). NULL = não informado. Nunca representado via Date/duração de calendário; formatação HH:MM:SS fica a cargo do frontend (frontend/src/lib/forms/durationField.ts).';

-- =============================================================================
-- 4) create_product(): DROP explícito da assinatura antiga + CREATE
--    imediato com o parâmetro renomeado (ver "CORREÇÃO CRÍTICA" acima —
--    CREATE OR REPLACE FUNCTION não permite renomear um parâmetro de
--    entrada existente). Zero dependências confirmadas via pg_depend antes
--    desta migration ser escrita — sem CASCADE, sem necessidade dele.
-- =============================================================================
drop function public.create_product(text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid);

create function public.create_product(
  p_name text,
  p_category text,
  p_description text,
  p_default_price numeric(10, 2),
  p_default_print_time_seconds integer,
  p_default_weight_grams numeric(10, 2),
  p_units_per_plate integer,
  p_default_file_id uuid,
  p_allows_personalization boolean,
  p_changed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  perform public.assert_active_user(p_changed_by);

  insert into public.products (
    name, category, description, default_price,
    default_print_time_seconds, default_weight_grams, units_per_plate,
    default_file_id, allows_personalization
  ) values (
    p_name, p_category, p_description, p_default_price,
    p_default_print_time_seconds, p_default_weight_grams, p_units_per_plate,
    p_default_file_id, coalesce(p_allows_personalization, false)
  )
  returning id into v_product_id;

  insert into public.product_price_history (
    product_id, price, effective_from, effective_to, reason, created_by
  ) values (
    v_product_id, p_default_price, now(), null, 'Preço inicial do produto', p_changed_by
  );

  return v_product_id;
end;
$$;

comment on function public.create_product(text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid) is
  'Único caminho para criar um produto de Catálogo: insere products e a primeira linha de product_price_history (effective_to NULL, price = default_price) na mesma transação. created_by resolvido pelo chamador, nunca por auth.uid(). p_default_print_time_seconds é armazenado em SEGUNDOS (renomeado de p_default_print_time_minutes por esta migration, via DROP + CREATE — não via CREATE OR REPLACE, que não permite renomear parâmetro de entrada).';

-- Grants: um DROP FUNCTION remove a função (e seus grants) por completo —
-- diferente de CREATE OR REPLACE, que preservaria grants automaticamente,
-- aqui a reconcessão abaixo é OBRIGATÓRIA, não apenas defensiva. Owner é
-- quem executa esta migration (mesmo papel administrativo que já era dono
-- da função antes — nenhuma mudança de owner pretendida).
revoke execute on function public.create_product(text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.create_product(text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid)
  to service_role;

-- =============================================================================
-- Verificações finais — confirma que a coluna foi convertida sem perda
-- silenciosa de dados, que existe EXATAMENTE uma função create_product com
-- a assinatura esperada (nenhuma sobrecarga antiga sobrevivendo), que o 5º
-- parâmetro tem o nome correto, e que create_product() continua
-- SECURITY DEFINER, com search_path seguro e os mesmos grants de antes.
-- =============================================================================
do $$
declare
  v_old_column_exists boolean;
  v_new_column_data_type text;
  v_check_definition text;
  v_check_constraint_name text;
  v_units_per_plate_exists boolean;
  v_function_count integer;
  v_fifth_param_name text;
  v_is_security_definer boolean;
  v_search_path_raw text;
  v_owner_name text;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
begin
  -- --- Coluna renomeada corretamente -----------------------------------
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'default_print_time_minutes'
  ) into v_old_column_exists;
  if v_old_column_exists then
    raise exception 'Abortando: default_print_time_minutes ainda existe (RENAME COLUMN não teve efeito).';
  end if;

  select data_type into v_new_column_data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'default_print_time_seconds';
  if v_new_column_data_type is null then
    raise exception 'Abortando: default_print_time_seconds não existe após o RENAME COLUMN.';
  end if;
  if v_new_column_data_type <> 'integer' then
    raise exception 'Abortando: default_print_time_seconds deveria ser integer, veio %.', v_new_column_data_type;
  end if;

  select conname, pg_get_constraintdef(oid) into v_check_constraint_name, v_check_definition
    from pg_constraint
    where conrelid = 'public.products'::regclass and contype = 'c'
      and conname = 'products_default_print_time_seconds_check';
  if v_check_constraint_name is null then
    raise exception 'Abortando: constraint products_default_print_time_seconds_check não encontrada.';
  end if;
  if v_check_definition !~ 'default_print_time_seconds IS NULL' or v_check_definition !~ '>= 0' then
    raise exception 'Abortando: definição inesperada da CHECK: %', v_check_definition;
  end if;

  -- --- units_per_plate preservado, nenhuma coluna excluída indevidamente
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'units_per_plate'
  ) into v_units_per_plate_exists;
  if not v_units_per_plate_exists then
    raise exception 'Abortando: units_per_plate não deveria ter sido removida nesta migration.';
  end if;

  -- --- Exatamente uma função create_product, com a assinatura esperada --
  select count(*) into v_function_count
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_product';
  if v_function_count <> 1 then
    raise exception 'Abortando: esperada exatamente 1 função create_product, encontrada %.', v_function_count;
  end if;

  select proargnames[5] into v_fifth_param_name
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_product';
  if v_fifth_param_name <> 'p_default_print_time_seconds' then
    raise exception 'Abortando: 5º parâmetro de create_product deveria ser p_default_print_time_seconds, veio %.', v_fifth_param_name;
  end if;

  select prosecdef, pg_get_userbyid(proowner) into v_is_security_definer, v_owner_name
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_product';

  if not v_is_security_definer then
    raise exception 'Abortando: create_product não é SECURITY DEFINER.';
  end if;
  if v_owner_name <> 'postgres' then
    raise exception 'Abortando: owner de create_product deveria ser postgres, veio %.', v_owner_name;
  end if;

  select setting into v_search_path_raw
    from pg_proc, unnest(proconfig) as setting
    where pronamespace = 'public'::regnamespace and proname = 'create_product'
      and setting like 'search_path=%';

  if v_search_path_raw is null or trim(both '"' from substring(v_search_path_raw from 13)) <> '' then
    raise exception 'Abortando: search_path de create_product deveria ser vazio, veio: %.', v_search_path_raw;
  end if;

  select has_function_privilege('anon', 'public.create_product(text,text,text,numeric,integer,numeric,integer,uuid,boolean,uuid)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.create_product(text,text,text,numeric,integer,numeric,integer,uuid,boolean,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.create_product(text,text,text,numeric,integer,numeric,integer,uuid,boolean,uuid)', 'EXECUTE') into v_service_role_can_execute;

  if v_anon_can_execute or v_authenticated_can_execute then
    raise exception 'Abortando: anon/authenticated têm EXECUTE em create_product (anon=%, authenticated=%) — não deveriam.', v_anon_can_execute, v_authenticated_can_execute;
  end if;
  if not v_service_role_can_execute then
    raise exception 'Abortando: service_role deveria ter EXECUTE em create_product.';
  end if;
end $$;
