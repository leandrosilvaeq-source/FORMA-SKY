-- =============================================================================
-- Forma Sky — infraestrutura compartilhada de foto principal por cadastro
-- (migration 20260906120000_add_shared_entity_image_infrastructure.sql).
-- TESTE DE INTEGRAÇÃO transacional: colunas novas, bucket privado, RPC
-- set_entity_image (permissões + comportamento) e a view de filamentos.
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Roda inteiro dentro de UMA ÚNICA
-- transação, terminada sempre com ROLLBACK — nada persiste. Usa somente
-- registros "TESTE%", nunca dados oficiais.
--
-- HISTÓRICO DE APLICAÇÃO:
--   - Seções 1–6: a migration 20260906120000 foi aplicada ao projeto remoto
--     e estas seções foram executadas e aprovadas (rodada de publicação da
--     Edge Function `entity-images` v1).
--   - Seção 7 (NOVA): cobre a migration corretiva
--     20260906130000_grant_service_role_select_entity_image_tables.sql, que
--     ainda NÃO foi aplicada. Não há Supabase local rodando nesta sessão,
--     portanto a SEÇÃO 7 NÃO FOI EXECUTADA — está escrita seguindo o padrão
--     do restante do arquivo e precisa de uma primeira execução real depois
--     de a migration 20260906130000 ser aplicada:
--   npx supabase db query --linked --file supabase/tests/entity_images_infrastructure_test.sql
-- =============================================================================

begin;

create temporary table zz_ei_results (
  seq serial primary key,
  section text not null,
  test_name text not null,
  status text not null,
  details text
);

-- ---------------------------------------------------------------------------
-- 1. As QUATRO tabelas ganharam image_path / image_thumb_path (text, NULL).
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(t.tbl || '.' || c.col, ', ')
    into v_missing
  from (values
    ('accessories','image_path'), ('accessories','image_thumb_path'),
    ('packaging','image_path'),   ('packaging','image_thumb_path'),
    ('filament_types','image_path'), ('filament_types','image_thumb_path'),
    ('products','image_path'), ('products','image_thumb_path')
  ) as c(col_tbl, col)
  cross join lateral (select c.col_tbl as tbl) t
  where not exists (
    select 1 from information_schema.columns ic
    where ic.table_schema = 'public' and ic.table_name = t.tbl
      and ic.column_name = c.col and ic.data_type = 'text' and ic.is_nullable = 'YES'
  );

  insert into zz_ei_results(section, test_name, status, details)
  values (
    '1. colunas',
    'as 8 colunas image_path/image_thumb_path existem como text NULLABLE',
    case when v_missing is null then 'PASS' else 'FAIL' end,
    coalesce('faltando: ' || v_missing, 'todas presentes')
  );
end $$;

-- Registro pré-existente continua válido (image_path/thumb em NULL por
-- padrão) — inserimos um acessório TESTE e conferimos o default.
do $$
declare
  v_id uuid;
  v_path text;
  v_thumb text;
begin
  insert into public.accessories (name) values ('TESTE ei acessório')
  returning id into v_id;
  select image_path, image_thumb_path into v_path, v_thumb
    from public.accessories where id = v_id;

  insert into zz_ei_results(section, test_name, status, details)
  values (
    '1. colunas',
    'acessório novo nasce com image_path/image_thumb_path NULL',
    case when v_path is null and v_thumb is null then 'PASS' else 'FAIL' end,
    format('image_path=%s image_thumb_path=%s', v_path, v_thumb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. Bucket entity-images existe e é PRIVADO com os limites certos.
-- ---------------------------------------------------------------------------
do $$
declare
  v_public boolean;
  v_limit bigint;
  v_mimes text[];
begin
  select public, file_size_limit, allowed_mime_types
    into v_public, v_limit, v_mimes
  from storage.buckets where id = 'entity-images';

  insert into zz_ei_results(section, test_name, status, details)
  values (
    '2. bucket',
    'entity-images existe, privado, 5 MiB, MIME jpeg/png/webp',
    case when v_public is false and v_limit = 5242880
              and v_mimes @> array['image/jpeg','image/png','image/webp']
              and array_length(v_mimes, 1) = 3
         then 'PASS' else 'FAIL' end,
    format('public=%s limit=%s mimes=%s', v_public, v_limit, v_mimes)
  );
end $$;

-- Nenhuma policy de storage.objects para o bucket (locked-down por ausência).
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and qual ilike '%entity-images%';

  insert into zz_ei_results(section, test_name, status, details)
  values (
    '2. bucket',
    'nenhuma policy de storage.objects menciona entity-images',
    case when v_count = 0 then 'PASS' else 'FAIL' end,
    format('policies encontradas: %s', v_count)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3. RPC set_entity_image: EXECUTE só service_role; nunca anon/authenticated.
-- ---------------------------------------------------------------------------
do $$
declare
  v_anon boolean;
  v_auth boolean;
  v_service boolean;
begin
  v_anon := has_function_privilege('anon',
    'public.set_entity_image(text, uuid, text, text, uuid)', 'EXECUTE');
  v_auth := has_function_privilege('authenticated',
    'public.set_entity_image(text, uuid, text, text, uuid)', 'EXECUTE');
  v_service := has_function_privilege('service_role',
    'public.set_entity_image(text, uuid, text, text, uuid)', 'EXECUTE');

  insert into zz_ei_results(section, test_name, status, details)
  values (
    '3. RPC grants',
    'set_entity_image executável só por service_role',
    case when v_anon is false and v_auth is false and v_service is true
         then 'PASS' else 'FAIL' end,
    format('anon=%s authenticated=%s service_role=%s', v_anon, v_auth, v_service)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4. set_entity_image: comportamento (definir, ler anteriores, remover,
--    entidade inválida, registro inexistente, caminho fora do padrão).
-- ---------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  v_acc uuid;
  v_res jsonb;
  v_p1 text;
  v_t1 text;
  v_p2 text;
  v_t2 text;
  v_row record;
  v_err text;
begin
  select id into v_user from public.users where is_active order by created_at limit 1;
  insert into public.accessories (name) values ('TESTE ei vínculo') returning id into v_acc;

  v_p1 := format('accessories/%s/%s-original.webp', v_acc, gen_random_uuid());
  v_t1 := replace(v_p1, '-original.webp', '-thumb.webp');

  -- 4a. Primeiro vínculo — previous_* deve vir NULL.
  v_res := public.set_entity_image('accessories', v_acc, v_p1, v_t1, v_user);
  select image_path, image_thumb_path into v_row from public.accessories where id = v_acc;
  insert into zz_ei_results(section, test_name, status, details)
  values (
    '4. set_entity_image',
    'primeiro vínculo grava as duas colunas e devolve previous_* NULL',
    case when v_row.image_path = v_p1 and v_row.image_thumb_path = v_t1
              and v_res->>'previous_image_path' is null
              and v_res->>'previous_image_thumb_path' is null
         then 'PASS' else 'FAIL' end,
    v_res::text
  );

  -- 4b. Substituição — previous_* deve devolver o par anterior.
  v_p2 := format('accessories/%s/%s-original.webp', v_acc, gen_random_uuid());
  v_t2 := replace(v_p2, '-original.webp', '-thumb.webp');
  v_res := public.set_entity_image('accessories', v_acc, v_p2, v_t2, v_user);
  insert into zz_ei_results(section, test_name, status, details)
  values (
    '4. set_entity_image',
    'substituição devolve previous_* com o par anterior',
    case when v_res->>'previous_image_path' = v_p1
              and v_res->>'previous_image_thumb_path' = v_t1
              and v_res->>'image_path' = v_p2
         then 'PASS' else 'FAIL' end,
    v_res::text
  );

  -- 4c. Remoção — NULL/NULL.
  v_res := public.set_entity_image('accessories', v_acc, null, null, v_user);
  select image_path, image_thumb_path into v_row from public.accessories where id = v_acc;
  insert into zz_ei_results(section, test_name, status, details)
  values (
    '4. set_entity_image',
    'remoção (NULL/NULL) limpa as colunas e devolve o par anterior',
    case when v_row.image_path is null and v_row.image_thumb_path is null
              and v_res->>'previous_image_path' = v_p2
         then 'PASS' else 'FAIL' end,
    v_res::text
  );

  -- 4d. Entidade inválida.
  begin
    perform public.set_entity_image('orders', v_acc, null, null, v_user);
    v_err := 'sem erro';
  exception when others then v_err := SQLERRM;
  end;
  insert into zz_ei_results(section, test_name, status, details)
  values (
    '4. set_entity_image',
    'entidade fora das quatro permitidas é recusada',
    case when v_err ilike '%entidade inválida%' then 'PASS' else 'FAIL' end,
    v_err
  );

  -- 4e. Registro inexistente.
  begin
    perform public.set_entity_image('accessories', gen_random_uuid(), null, null, v_user);
    v_err := 'sem erro';
  exception when others then v_err := SQLERRM;
  end;
  insert into zz_ei_results(section, test_name, status, details)
  values (
    '4. set_entity_image',
    'id inexistente é recusado com "não encontrado"',
    case when v_err ilike '%não encontrado%' then 'PASS' else 'FAIL' end,
    v_err
  );

  -- 4f. Caminho fora do prefixo {entity}/{id}/.
  begin
    perform public.set_entity_image(
      'accessories', v_acc,
      format('products/%s/%s-original.webp', gen_random_uuid(), gen_random_uuid()),
      format('products/%s/%s-thumb.webp', gen_random_uuid(), gen_random_uuid()),
      v_user);
    v_err := 'sem erro';
  exception when others then v_err := SQLERRM;
  end;
  insert into zz_ei_results(section, test_name, status, details)
  values (
    '4. set_entity_image',
    'caminho de outra entidade/registro é recusado (prefixo/sufixo)',
    case when v_err ilike '%fora do padrão%' then 'PASS' else 'FAIL' end,
    v_err
  );

  -- 4g. Só um dos dois caminhos.
  begin
    perform public.set_entity_image('accessories', v_acc, v_p1, null, v_user);
    v_err := 'sem erro';
  exception when others then v_err := SQLERRM;
  end;
  insert into zz_ei_results(section, test_name, status, details)
  values (
    '4. set_entity_image',
    'informar só um caminho (original sem thumb) é recusado',
    case when v_err ilike '%os dois caminhos%' then 'PASS' else 'FAIL' end,
    v_err
  );
end $$;

-- ---------------------------------------------------------------------------
-- 5. vw_filament_type_summary expõe image_path / image_thumb_path do tipo.
-- ---------------------------------------------------------------------------
do $$
declare
  v_has_cols boolean;
  v_user uuid;
  v_ft uuid;
  v_p text;
  v_summary_path text;
begin
  select bool_and(cnt = 1) into v_has_cols
  from (
    select count(*) as cnt
    from information_schema.columns
    where table_schema = 'public' and table_name = 'vw_filament_type_summary'
      and column_name in ('image_path','image_thumb_path')
    group by column_name
  ) s;

  select id into v_user from public.users where is_active order by created_at limit 1;
  insert into public.filament_types (material, manufacturer, line, commercial_color)
  values ('PLA', 'TESTE ei', 'Sólida', 'TESTE cor ei')
  returning id into v_ft;

  v_p := format('filament-types/%s/%s-original.webp', v_ft, gen_random_uuid());
  perform public.set_entity_image('filament-types', v_ft, v_p,
    replace(v_p, '-original.webp', '-thumb.webp'), v_user);

  select image_path into v_summary_path
  from public.vw_filament_type_summary where filament_type_id = v_ft;

  insert into zz_ei_results(section, test_name, status, details)
  values (
    '5. view',
    'vw_filament_type_summary tem as colunas e reflete o caminho gravado',
    case when v_has_cols and v_summary_path = v_p then 'PASS' else 'FAIL' end,
    format('has_cols=%s summary_path=%s', v_has_cols, v_summary_path)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 6. default_file_id e public.files permanecem INALTERADOS.
-- ---------------------------------------------------------------------------
do $$
declare
  v_default_file_id_exists boolean;
  v_files_exists boolean;
begin
  v_default_file_id_exists := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products'
      and column_name = 'default_file_id'
  );
  v_files_exists := exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'files'
  );
  insert into zz_ei_results(section, test_name, status, details)
  values (
    '6. não-regressão',
    'products.default_file_id e public.files continuam existindo, intocados',
    case when v_default_file_id_exists and v_files_exists then 'PASS' else 'FAIL' end,
    format('default_file_id=%s files=%s', v_default_file_id_exists, v_files_exists)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 7. Privilégios de tabela do service_role (migration
--    20260906130000_grant_service_role_select_entity_image_tables.sql).
--
--    A Edge Function `entity-images` (assertRecordExistence) faz uma leitura
--    DIRETA de accessories/packaging/filament_types/products pelo admin
--    client (service_role) para confirmar a existência do registro antes de
--    tocar no Storage. service_role bypassa RLS mas ainda precisa do GRANT
--    SELECT do Postgres — sem ele o upload real falhava com SQLSTATE 42501
--    "permission denied for table accessories". Esta seção prova que:
--      (a) service_role passou a ter SELECT nas quatro tabelas;
--      (b) service_role continua SEM INSERT/UPDATE/DELETE nelas — a escrita
--          de image_path/image_thumb_path é exclusivamente via a RPC
--          set_entity_image (conferida na seção 3);
--      (c) o grant de authenticated não mudou (SELECT preservado).
-- ---------------------------------------------------------------------------
do $$
declare
  v_tbl text;
  v_missing_select text := '';
  v_unexpected_write text := '';
  v_auth_missing_select text := '';
begin
  foreach v_tbl in array array[
    'public.accessories', 'public.packaging', 'public.filament_types', 'public.products'
  ] loop
    if not has_table_privilege('service_role', v_tbl, 'SELECT') then
      v_missing_select := v_missing_select || v_tbl || ' ';
    end if;
    if has_table_privilege('service_role', v_tbl, 'INSERT')
       or has_table_privilege('service_role', v_tbl, 'UPDATE')
       or has_table_privilege('service_role', v_tbl, 'DELETE') then
      v_unexpected_write := v_unexpected_write || v_tbl || ' ';
    end if;
    if not has_table_privilege('authenticated', v_tbl, 'SELECT') then
      v_auth_missing_select := v_auth_missing_select || v_tbl || ' ';
    end if;
  end loop;

  insert into zz_ei_results(section, test_name, status, details)
  values (
    '7. grants service_role',
    'service_role tem SELECT nas quatro tabelas de entidade',
    case when v_missing_select = '' then 'PASS' else 'FAIL' end,
    case when v_missing_select = '' then 'accessories, packaging, filament_types, products'
         else 'faltando SELECT: ' || v_missing_select end
  );

  insert into zz_ei_results(section, test_name, status, details)
  values (
    '7. grants service_role',
    'service_role NÃO tem INSERT/UPDATE/DELETE nessas tabelas (escrita só via RPC)',
    case when v_unexpected_write = '' then 'PASS' else 'FAIL' end,
    case when v_unexpected_write = '' then 'nenhum privilégio de escrita direto'
         else 'privilégio de escrita indevido em: ' || v_unexpected_write end
  );

  insert into zz_ei_results(section, test_name, status, details)
  values (
    '7. grants service_role',
    'authenticated mantém SELECT nas quatro tabelas (grant original intacto)',
    case when v_auth_missing_select = '' then 'PASS' else 'FAIL' end,
    case when v_auth_missing_select = '' then 'SELECT de authenticated preservado'
         else 'authenticated perdeu SELECT em: ' || v_auth_missing_select end
  );
end $$;

-- A leitura de existência que a Edge Function faz de fato (admin client):
-- select id from public.accessories where id = <id> — deve rodar sob o papel
-- service_role sem erro de permissão.
do $$
declare
  v_acc uuid;
  v_seen uuid;
  v_err text := 'sem erro';
begin
  insert into public.accessories (name) values ('TESTE ei grant service_role') returning id into v_acc;

  set local role service_role;
  begin
    select id into v_seen from public.accessories where id = v_acc;
  exception when others then
    v_err := SQLERRM;
  end;
  reset role;

  insert into zz_ei_results(section, test_name, status, details)
  values (
    '7. grants service_role',
    'SELECT id em accessories roda sob o papel service_role sem 42501',
    case when v_err = 'sem erro' and v_seen = v_acc then 'PASS' else 'FAIL' end,
    v_err
  );
end $$;

-- ---------------------------------------------------------------------------
-- RESULTADO
-- ---------------------------------------------------------------------------
select section, test_name, status, details from zz_ei_results order by seq;

do $$
declare
  v_fail int;
begin
  select count(*) into v_fail from zz_ei_results where status <> 'PASS';
  if v_fail > 0 then
    raise exception 'entity_images_infrastructure_test: % teste(s) falharam', v_fail;
  end if;
  raise notice 'entity_images_infrastructure_test: todos os testes passaram';
end $$;

rollback;
