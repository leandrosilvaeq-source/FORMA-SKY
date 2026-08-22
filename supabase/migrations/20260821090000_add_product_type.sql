-- Bloco 1 — Produtos
-- Migration: adiciona public.products.product_type (CATALOG/CUSTOM/SPOT —
-- mesmos 3 valores técnicos já usados em order_items.item_type, migration
-- 20260814005328_create_order_items_table.sql, nunca reinventados) e
-- recria create_product() com o novo parâmetro p_product_type.
--
-- Contexto (decisão aprovada): "Novo produto" ganhou uma seleção de Tipo
-- (Catálogo/Personalizado/SPOT), com Catálogo como padrão. Produtos
-- existentes são todos classificados como CATALOG. Só CATALOG está
-- habilitado nos fluxos de Pedidos por enquanto — esta migration só
-- classifica o produto no Catálogo, não habilita nenhum fluxo novo de
-- pedido para CUSTOM/SPOT.
--
-- Estratégia da coluna: ADD COLUMN ... NOT NULL DEFAULT 'CATALOG' CHECK
-- (...) — uma única instrução atende às 4 exigências da migration ao mesmo
-- tempo: (a) toda linha existente é classificada como CATALOG (o DEFAULT é
-- aplicado retroativamente a todas as linhas já existentes no momento do
-- ADD COLUMN, não só às futuras); (b) CATALOG também vira o padrão para
-- INSERTs futuros que não informem a coluna explicitamente; (c) o CHECK
-- limita os valores a CATALOG/CUSTOM/SPOT desde o primeiro momento em que a
-- coluna existe — nunca há uma janela com valores fora dessa lista; (d)
-- nenhum dado existente é perdido (nenhuma coluna removida, nenhum UPDATE
-- destrutivo).
--
-- create_product(): adicionar um parâmetro novo (diferente de renomear um
-- existente, caso já tratado na migration anterior) muda o número de
-- argumentos da função — isso por si só já cria uma assinatura de tipos
-- diferente da atual, então CREATE OR REPLACE FUNCTION criaria uma
-- SEGUNDA sobrecarga (10 e 11 parâmetros coexistindo), não substituiria a
-- existente. Para evitar duas sobrecargas simultâneas de create_product
-- (o único caminho de criação de produto, sem nenhum motivo para manter
-- compatibilidade retroativa com a assinatura de 10 parâmetros — ao
-- contrário de create_order, que preserva a assinatura antiga por ela ser
-- chamada por integrações externas), a função antiga é removida
-- explicitamente (DROP FUNCTION pela assinatura exata) e a nova (11
-- parâmetros) é criada imediatamente em seguida, na mesma transação.
--
-- Auditado antes do DROP: consulta direta a pg_depend contra a assinatura
-- exata de create_product(text,text,text,numeric,integer,numeric,integer,
-- uuid,boolean,uuid) — ZERO dependências (nenhuma view, trigger ou outra
-- função). DROP FUNCTION sem CASCADE, sem necessidade dele.
--
-- Grants: um DROP FUNCTION remove a função (e seus grants) por completo —
-- reconcedidos explicitamente logo depois (obrigatório, não só defensivo).
-- Owner: quem executa esta migration (mesmo papel administrativo que já
-- era dono da função antes).
--
-- Nenhuma migration antiga foi alterada. Transacional: mesma convenção já
-- usada por todas as demais migrations deste projeto (nenhuma usa
-- BEGIN/COMMIT explícito — o Supabase CLI aplica cada arquivo de migration
-- como uma única transação).

-- =============================================================================
-- 1) Coluna nova, com DEFAULT retroativo + CHECK, em uma única instrução.
-- =============================================================================
alter table public.products
  add column product_type text not null default 'CATALOG'
    check (product_type in ('CATALOG', 'CUSTOM', 'SPOT'));

comment on column public.products.product_type is
  'Classificação do produto no Catálogo: CATALOG (produto de catálogo permanente), CUSTOM (produto Personalizado cadastrado) ou SPOT. Mesmos valores técnicos de order_items.item_type, reutilizados de propósito. DEFAULT CATALOG — todo produto existente antes desta migration foi classificado como CATALOG automaticamente. Só CATALOG está habilitado nos fluxos de criação de pedido (create_order/update_quote_order) por enquanto; esta coluna não habilita nenhum fluxo novo de pedido para CUSTOM/SPOT.';

-- =============================================================================
-- 2) create_product(): DROP explícito da assinatura de 10 parâmetros +
--    CREATE imediato com 11 parâmetros (p_product_type adicionado). Ver
--    "CORREÇÃO CRÍTICA" documentada na migration anterior
--    (20260821070000_rename_default_print_time_to_seconds.sql) — mesmo
--    raciocínio de por que CREATE OR REPLACE não é usado para mudanças de
--    assinatura, aqui aplicado a uma mudança de NÚMERO de parâmetros (que
--    por si só já impediria o CREATE OR REPLACE de substituir a função
--    existente, criando uma sobrecarga nova em vez de atualizar a atual).
-- =============================================================================
drop function public.create_product(text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid);

create function public.create_product(
  p_name text,
  p_product_type text,
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

  -- Mesma validação explícita já usada para p_payment_method em
  -- create_order()/update_quote_order() — mensagem de erro clara antes de
  -- qualquer INSERT, além do CHECK da própria tabela (defesa em
  -- profundidade, não uma validação duplicada substituindo a outra).
  if p_product_type not in ('CATALOG', 'CUSTOM', 'SPOT') then
    raise exception 'p_product_type inválido: % (permitido: CATALOG, CUSTOM ou SPOT)', p_product_type;
  end if;

  insert into public.products (
    name, product_type, category, description, default_price,
    default_print_time_seconds, default_weight_grams, units_per_plate,
    default_file_id, allows_personalization
  ) values (
    p_name, p_product_type, p_category, p_description, p_default_price,
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

comment on function public.create_product(text, text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid) is
  'Único caminho para criar um produto de Catálogo: insere products (incluindo product_type, validado explicitamente antes do INSERT) e a primeira linha de product_price_history (effective_to NULL, price = default_price) na mesma transação. created_by resolvido pelo chamador, nunca por auth.uid(). p_default_print_time_seconds é armazenado em SEGUNDOS. Assinatura recriada via DROP + CREATE (mudança no número de parâmetros), não via CREATE OR REPLACE.';

-- Grants: obrigatório reconceder após o DROP (ver nota acima).
revoke execute on function public.create_product(text, text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.create_product(text, text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid)
  to service_role;

-- =============================================================================
-- Verificações finais.
-- =============================================================================
do $$
declare
  v_column_data_type text;
  v_column_default text;
  v_check_definition text;
  v_non_catalog_before_count integer;
  v_function_count integer;
  v_second_param_name text;
  v_is_security_definer boolean;
  v_search_path_raw text;
  v_owner_name text;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
begin
  select data_type, column_default into v_column_data_type, v_column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'product_type';

  if v_column_data_type is null then
    raise exception 'Abortando: product_type não existe após o ADD COLUMN.';
  end if;
  if v_column_data_type <> 'text' then
    raise exception 'Abortando: product_type deveria ser text, veio %.', v_column_data_type;
  end if;
  if v_column_default is null or v_column_default !~ 'CATALOG' then
    raise exception 'Abortando: DEFAULT de product_type deveria envolver CATALOG, veio %.', v_column_default;
  end if;

  select pg_get_constraintdef(oid) into v_check_definition
    from pg_constraint
    where conrelid = 'public.products'::regclass and contype = 'c' and conname = 'products_product_type_check';
  if v_check_definition is null then
    raise exception 'Abortando: constraint products_product_type_check não encontrada.';
  end if;
  if v_check_definition !~ 'CATALOG' or v_check_definition !~ 'CUSTOM' or v_check_definition !~ 'SPOT' then
    raise exception 'Abortando: definição inesperada da CHECK de product_type: %', v_check_definition;
  end if;

  -- Nenhuma linha pode ter ficado fora de CATALOG/CUSTOM/SPOT — o CHECK já
  -- garante isso estruturalmente, esta consulta prova contra os dados reais.
  select count(*) into v_non_catalog_before_count
    from public.products where product_type not in ('CATALOG', 'CUSTOM', 'SPOT');
  if v_non_catalog_before_count > 0 then
    raise exception 'Abortando: % linha(s) com product_type fora de CATALOG/CUSTOM/SPOT.', v_non_catalog_before_count;
  end if;

  select count(*) into v_function_count
    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_product';
  if v_function_count <> 1 then
    raise exception 'Abortando: esperada exatamente 1 função create_product, encontrada %.', v_function_count;
  end if;

  select proargnames[2] into v_second_param_name
    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_product';
  if v_second_param_name <> 'p_product_type' then
    raise exception 'Abortando: 2º parâmetro de create_product deveria ser p_product_type, veio %.', v_second_param_name;
  end if;

  select prosecdef, pg_get_userbyid(proowner) into v_is_security_definer, v_owner_name
    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_product';
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

  select has_function_privilege('anon', 'public.create_product(text,text,text,text,numeric,integer,numeric,integer,uuid,boolean,uuid)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.create_product(text,text,text,text,numeric,integer,numeric,integer,uuid,boolean,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.create_product(text,text,text,text,numeric,integer,numeric,integer,uuid,boolean,uuid)', 'EXECUTE') into v_service_role_can_execute;

  if v_anon_can_execute or v_authenticated_can_execute then
    raise exception 'Abortando: anon/authenticated têm EXECUTE em create_product (anon=%, authenticated=%) — não deveriam.', v_anon_can_execute, v_authenticated_can_execute;
  end if;
  if not v_service_role_can_execute then
    raise exception 'Abortando: service_role deveria ter EXECUTE em create_product.';
  end if;
end $$;
