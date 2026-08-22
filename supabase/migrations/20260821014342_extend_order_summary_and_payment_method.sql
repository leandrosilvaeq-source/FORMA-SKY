-- Bloco 1 — Clientes e Pedidos
-- Migration: estende public.vw_order_summary (payment_method,
-- delivery_method, item_types, item_names) e adiciona uma NOVA sobrecarga
-- de public.create_order() que aceita payment_method já na criação do
-- pedido, atomicamente.
--
-- CORREÇÃO DE UMA VERSÃO ANTERIOR DESTA MIGRATION (ainda não aplicada em
-- nenhum ambiente): a versão anterior tentava usar CREATE OR REPLACE
-- FUNCTION para "acrescentar" p_payment_method (com DEFAULT null) à
-- assinatura de create_order(), com comentários afirmando que isso
-- preservaria a mesma função/OID/grants. Essa afirmação estava ERRADA.
--
-- Em PostgreSQL, a IDENTIDADE de uma função é (schema, nome, LISTA DE
-- TIPOS DOS PARÂMETROS) — não inclui nomes de parâmetro, DEFAULT nem tipo
-- de retorno. create_order(uuid,uuid,uuid,date,text,numeric,numeric,
-- text,jsonb,uuid) — 10 tipos — e create_order(...os mesmos 10...,text)
-- — 11 tipos — são DUAS ASSINATURAS DIFERENTES, ou seja, DUAS FUNÇÕES
-- DISTINTAS (dois pg_proc, duas OIDs), mesmo com DEFAULT no 11º parâmetro.
-- CREATE OR REPLACE FUNCTION só substitui uma função cuja lista de TIPOS
-- já exista exatamente igual; como a lista de 11 tipos nunca existiu
-- antes, aquele CREATE OR REPLACE FUNCTION teria criado uma função NOVA
-- (com grants vazios, exigindo os REVOKE/GRANT explícitos que a migration
-- já tinha) e deixado a função de 10 parâmetros INTOCADA e ainda
-- existente — coexistindo as duas, só que documentado incorretamente
-- como "a mesma função".
--
-- Importante: essa restrição de identidade é específica de FUNÇÕES. Para
-- VIEWS, CREATE OR REPLACE VIEW *é* documentado como suporte legítimo a
-- acrescentar colunas de SAÍDA ao final da lista, preservando a mesma
-- entrada de catálogo (mesmo OID, mesmos grants) — é exatamente a técnica
-- usada na Seção 1 abaixo, e continua correta; não é a mesma situação de
-- "adicionar parâmetro de entrada a uma função".
--
-- SOLUÇÃO ADOTADA NESTA VERSÃO (aprovada explicitamente): já que as duas
-- assinaturas seriam duas funções de qualquer forma, tornamos isso
-- INTENCIONAL e EXPLÍCITO em vez de um efeito colateral mal documentado:
--   - a função de 10 parâmetros (Migration 17,
--     supabase/migrations/20260814051143_create_initial_custom_version_fix.sql)
--     NÃO é tocada nesta migration — nenhum CREATE OR REPLACE, nenhum
--     REVOKE/GRANT, nenhuma linha sua é executada aqui. Preservada
--     integralmente, para compatibilidade;
--   - uma função NOVA e distinta, com 11 parâmetros, é criada via CREATE
--     FUNCTION (não "OR REPLACE" — não existe nada para substituir). O
--     11º parâmetro (p_payment_method) NÃO tem DEFAULT: precisa ser
--     sempre enviado explicitamente, inclusive null — decisão deliberada
--     para eliminar qualquer ambiguidade de chamada;
--   - a Edge Function (supabase/functions/orders/index.ts) sempre envia
--     os 11 parâmetros nomeados, inclusive payment_method (null quando
--     não informado) — o PostgREST/supabase-js resolve overloads por
--     NOME dos parâmetros informados na chamada: como só a função de 11
--     parâmetros tem um parâmetro chamado p_payment_method, enviar esse
--     nome elimina a função de 10 parâmetros do conjunto de candidatas —
--     nunca há ambiguidade de resolução;
--   - CORREÇÃO sobre grants da função nova (versão anterior desta mesma
--     migration afirmava, incorretamente, que uma função nova "nasce sem
--     nenhum grant, exceto o do owner"): no PostgreSQL, por padrão de
--     privilégios (default privileges), toda função nova recebe EXECUTE
--     para PUBLIC automaticamente na própria criação — diferente de
--     tabelas, que não recebem nenhum privilégio padrão para PUBLIC.
--     Ou seja, a função de 11 parâmetros nasce, por uma fração de
--     instrução, com EXECUTE concedido a PUBLIC (o que implicitamente
--     cobriria anon e authenticated também, por herança de PUBLIC).
--     Isso NUNCA fica exposto externamente: esta mesma migration, dentro
--     da MESMA transação, revoga EXECUTE de PUBLIC, anon e authenticated
--     logo em seguida ao CREATE FUNCTION, e só então concede EXECUTE a
--     service_role — tudo isso antes do COMMIT da migration. Como
--     nenhuma outra sessão enxerga a função nova antes do commit (isolamento
--     transacional padrão do Postgres), e o REVOKE já aconteceu antes
--     desse commit, não existe nenhuma janela real em que a função fique
--     publicamente executável para além do controle desta transação;
--   - portanto, os grants finais da função nova são: REVOKE EXECUTE de
--     PUBLIC, anon e authenticated (desfazendo o EXECUTE-para-PUBLIC
--     padrão do CREATE FUNCTION) + GRANT EXECUTE só para service_role —
--     réplica exata dos grants já usados na função de 10 parâmetros;
--   - verificações ao final da migration (Seção 3) prova
--     estruturalmente: exatamente 2 funções create_order (10 e 11
--     parâmetros); nenhuma ambiguidade possível (contagens de parâmetro
--     diferentes); anon/authenticated sem EXECUTE em nenhuma das duas;
--     só service_role com EXECUTE nas duas; SECURITY DEFINER e
--     search_path = '' na função nova; mesmo owner nas duas.
--
-- Decisões desta rodada, mantidas do desenho já aprovado:
--   - vw_order_summary estendida via CREATE OR REPLACE VIEW, com as 4
--     colunas novas acrescentadas estritamente ao FINAL das 21 colunas
--     originais (a view tem 21 colunas, não 20 — contagem corrigida
--     nesta versão; nenhuma delas muda de nome, tipo ou posição);
--   - item_types: deduplicado, em ordem EXPLÍCITA CATALOG → CUSTOM →
--     SPOT (via CASE, nunca dependendo implicitamente da ordem
--     alfabética das strings, mesmo esta coincidir hoje);
--   - item_names: TODOS os itens (sem dedup), ordenados por
--     order_items.created_at, order_items.id — o id como desempate
--     determinístico entre itens criados no mesmo instante;
--   - a função nova valida p_payment_method explicitamente (null ou
--     PIX/DINHEIRO/CARTAO, erro claro caso contrário) ANTES do INSERT —
--     a CHECK já existente em orders.payment_method continua como defesa
--     adicional, não substituída;
--   - payment_method é gravado no MESMO INSERT que cria o pedido —
--     criação atômica, nunca um INSERT seguido de UPDATE/PUT separado.
--
-- Nenhuma tabela é alterada. Nenhum dado existente é tocado (é uma
-- migration de schema pura: CREATE OR REPLACE VIEW + CREATE FUNCTION
-- nova). A função de 10 parâmetros e todos os seus grants permanecem
-- byte-a-byte como estavam.

-- =============================================================================
-- 1. vw_order_summary — estendida (21 colunas originais preservadas +
-- 4 novas ao final)
-- =============================================================================
create or replace view public.vw_order_summary
with (security_invoker = true) as
select
  o.id as order_id,
  o.order_number,
  o.customer_id,
  o.company_id,
  o.order_status,
  o.payment_status,
  o.order_date,
  o.expected_delivery_date,
  o.actual_delivery_date,
  o.subtotal,
  o.discount_value,
  o.total_value,
  o.shipping_cost,
  (o.total_value + o.shipping_cost) as total_receivable,
  coalesce(pay.total_paid, 0) as total_paid,
  greatest(
    (o.total_value + o.shipping_cost) - coalesce(pay.total_paid, 0), 0
  ) as balance_due,
  (coalesce(pay.total_paid, 0) > (o.total_value + o.shipping_cost)) as has_overpayment,
  greatest(
    coalesce(pay.total_paid, 0) - (o.total_value + o.shipping_cost), 0
  ) as overpayment_amount,
  (voas.items_requiring_approval > 0) as approval_required,
  voas.is_fully_approved,
  voas.pending_required_items as pending_approval_items,
  -- Colunas novas — sempre ao final (21 colunas acima são as originais,
  -- intocadas). payment_method/delivery_method já existiam em orders
  -- (Migration 7); só não eram selecionadas por esta view até agora.
  o.payment_method,
  o.delivery_method,
  coalesce(item_types_agg.item_types, array[]::text[]) as item_types,
  coalesce(item_names_agg.item_names, array[]::text[]) as item_names
from public.orders o
left join lateral (
  select coalesce(sum(p.amount), 0) as total_paid
  from public.payments p
  where p.order_id = o.id
) pay on true
left join public.vw_order_approval_status voas
  on voas.order_id = o.id
left join lateral (
  -- Dedup por SELECT DISTINCT numa subconsulta interna (não por
  -- array_agg(DISTINCT ...)): array_agg(DISTINCT expr ORDER BY x) exige
  -- que a expressão do ORDER BY seja um dos argumentos do agregado — um
  -- CASE de ranking explícito não se qualifica. Fazendo o DISTINCT antes,
  -- numa subconsulta, o agregado externo não precisa de DISTINCT (já não
  -- há duplicata a eliminar) e pode ordenar livremente pelo rank.
  select array_agg(t.item_type order by t.rnk) as item_types
  from (
    select distinct oi.item_type,
      case oi.item_type
        when 'CATALOG' then 1
        when 'CUSTOM' then 2
        when 'SPOT' then 3
        else 4
      end as rnk
    from public.order_items oi
    where oi.order_id = o.id
  ) t
) item_types_agg on true
left join lateral (
  -- Sem DISTINCT: todo item entra. order_items.id como desempate garante
  -- ordem determinística mesmo entre itens com created_at idêntico
  -- (mesmo instante de criação, no loop de create_order()).
  select array_agg(oi.item_name order by oi.created_at, oi.id) as item_names
  from public.order_items oi
  where oi.order_id = o.id
) item_names_agg on true;

comment on view public.vw_order_summary is
  'Uma linha por pedido, com valores financeiros e de aprovação totalmente derivados (nenhum é persistido em orders além de subtotal/total_value, já mantidos por recalculate_order_financials), mais payment_method/delivery_method (colunas de orders) e item_types/item_names (agregados de order_items: item_types deduplicado em ordem explícita CATALOG/CUSTOM/SPOT via CASE, item_names na ordem created_at/id, cobrindo CATALOG/CUSTOM/SPOT igualmente). has_overpayment/overpayment_amount refletem pagamento excedente sem qualquer estorno automático. Somente leitura; security_invoker=true.';

-- Grants preservados exatamente como já eram (CREATE OR REPLACE VIEW não
-- altera privilégios existentes na view; reafirmados por
-- clareza/idempotência, mesmo padrão já usado no restante do projeto).
revoke all on public.vw_order_summary from anon, authenticated;
grant select on public.vw_order_summary to authenticated;

-- =============================================================================
-- 2. create_order() — NOVA sobrecarga de 11 parâmetros (a de 10 NÃO é
-- tocada nesta migration)
-- =============================================================================
-- Corpo copiado da versão de 10 parâmetros
-- (supabase/migrations/20260814051143_create_initial_custom_version_fix.sql)
-- com duas adições: o novo parâmetro p_payment_method (sem DEFAULT — deve
-- ser sempre enviado, inclusive null) e a validação/coluna/valor
-- payment_method no INSERT INTO orders. Duplicação de corpo é o custo
-- aceito da estratégia "duas sobrecargas explícitas" — inevitável em
-- PostgreSQL, que não tem herança/reuso de corpo entre funções distintas;
-- a alternativa (função nova chamando a antiga e depois um UPDATE
-- separado) foi descartada por afastar a gravação de payment_method do
-- mesmo INSERT, contrariando a exigência de criação atômica.
create function public.create_order(
  p_customer_id uuid,
  p_company_id uuid,
  p_lead_source_id uuid,
  p_expected_delivery_date date,
  p_delivery_method text,
  p_shipping_cost numeric(10, 2),
  p_discount_value numeric(10, 2),
  p_notes text,
  p_items jsonb,
  p_changed_by uuid,
  p_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_item_id uuid;
  v_order_number text;
  v_lead_source_id uuid;
  v_item jsonb;
  v_item_type text;
  v_custom jsonb;
  v_spot jsonb;
begin
  perform public.assert_active_user(p_changed_by);

  -- Validação explícita de payment_method ANTES do INSERT: null é
  -- permitido; PIX/DINHEIRO/CARTAO são os únicos valores aceitos; erro
  -- claro para qualquer outro. A CHECK de orders.payment_method (mesma
  -- lista) continua existindo e agindo como defesa adicional — esta
  -- validação aqui só antecipa o erro com uma mensagem melhor, nunca a
  -- substitui.
  if p_payment_method is not null and p_payment_method not in ('PIX', 'DINHEIRO', 'CARTAO') then
    raise exception 'p_payment_method inválido: % (permitido: null, PIX, DINHEIRO ou CARTAO)', p_payment_method;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order exige ao menos um item em p_items';
  end if;

  -- Sem SELECT ... FOR UPDATE aqui: é um pedido novo, sem linha existente
  -- para travar. Nenhuma outra transação pode referenciar este order_id
  -- antes desta transação ser confirmada (o id só passa a existir/ser
  -- conhecido depois do INSERT abaixo).
  v_lead_source_id := p_lead_source_id;
  if v_lead_source_id is null then
    select acquisition_source_id into v_lead_source_id
      from public.customers
      where id = p_customer_id;
  end if;

  v_order_number := public.next_order_number();

  -- payment_method entra na MESMA operação de INSERT que cria o pedido —
  -- criação atômica, nunca um INSERT seguido de UPDATE/PUT separado.
  insert into public.orders (
    order_number, customer_id, company_id, lead_source_id,
    order_status, payment_status, payment_method,
    expected_delivery_date, delivery_method,
    shipping_cost, discount_value, notes
  ) values (
    v_order_number, p_customer_id, p_company_id, v_lead_source_id,
    'QUOTE', 'WAITING_PAYMENT', p_payment_method,
    p_expected_delivery_date, p_delivery_method,
    coalesce(p_shipping_cost, 0), coalesce(p_discount_value, 0), p_notes
  )
  returning id into v_order_id;

  insert into public.order_status_history (
    order_id, from_status, to_status, changed_by, reason
  ) values (
    v_order_id, null, 'QUOTE', p_changed_by, 'Pedido criado'
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item ->> 'item_type';

    insert into public.order_items (
      order_id, item_type, product_id, item_name, description,
      quantity, unit_price, personalization_fee, discount_value,
      color_description, number_of_colors, customization_data,
      expected_delivery_date, notes
    ) values (
      v_order_id,
      v_item_type,
      nullif(v_item ->> 'product_id', '')::uuid,
      v_item ->> 'item_name',
      v_item ->> 'description',
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'unit_price')::numeric,
      coalesce((v_item ->> 'personalization_fee')::numeric, 0),
      coalesce((v_item ->> 'discount_value')::numeric, 0),
      v_item ->> 'color_description',
      nullif(v_item ->> 'number_of_colors', '')::integer,
      coalesce(v_item -> 'customization_data', '{}'::jsonb),
      nullif(v_item ->> 'expected_delivery_date', '')::date,
      v_item ->> 'notes'
    )
    returning id into v_order_item_id;

    if v_item_type = 'CUSTOM' then
      v_custom := v_item -> 'custom_details';
      if v_custom is null then
        raise exception 'Item CUSTOM exige custom_details';
      end if;

      insert into public.custom_item_details (
        order_item_id, current_version, is_exclusive,
        prototype_required, prototype_completed, development_minutes, notes
      ) values (
        v_order_item_id,
        v_custom ->> 'current_version',
        coalesce((v_custom ->> 'is_exclusive')::boolean, false),
        coalesce((v_custom ->> 'prototype_required')::boolean, false),
        false,
        nullif(v_custom ->> 'development_minutes', '')::integer,
        v_custom ->> 'notes'
      );

      insert into public.custom_versions (
        order_item_id, version_number, change_type, change_description, file_id
      ) values (
        v_order_item_id,
        v_custom ->> 'current_version',
        'INITIAL',
        'Versão inicial',
        null
      );

    elsif v_item_type = 'SPOT' then
      v_spot := v_item -> 'spot_details';
      if v_spot is null then
        raise exception 'Item SPOT exige spot_details';
      end if;

      insert into public.spot_item_details (
        order_item_id, model_source_id, source_reference, is_exclusive,
        test_print_required, test_print_completed, search_time_status,
        search_minutes, preparation_minutes,
        market_reference_price, market_reference_source, market_reference_date,
        catalog_conversion_suggested, notes
      ) values (
        v_order_item_id,
        nullif(v_spot ->> 'model_source_id', '')::uuid,
        v_spot ->> 'source_reference',
        coalesce((v_spot ->> 'is_exclusive')::boolean, false),
        coalesce((v_spot ->> 'test_print_required')::boolean, false),
        false,
        coalesce(v_spot ->> 'search_time_status', 'NOT_INFORMED'),
        nullif(v_spot ->> 'search_minutes', '')::integer,
        nullif(v_spot ->> 'preparation_minutes', '')::integer,
        nullif(v_spot ->> 'market_reference_price', '')::numeric,
        v_spot ->> 'market_reference_source',
        nullif(v_spot ->> 'market_reference_date', '')::date,
        false,
        v_spot ->> 'notes'
      );
    end if;
    -- CATALOG: nenhuma tabela satélite; product_id já é exigido pela
    -- constraint order_items_product_id_matches_item_type (Migration 8).
  end loop;

  perform public.recalculate_order_financials(
    v_order_id, p_changed_by, 'Cálculo inicial na criação do pedido'
  );

  return v_order_id;
end;
$$;

comment on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text) is
  'Sobrecarga NOVA e distinta de create_order (11 parâmetros — diferente da versão de 10 parâmetros da Migration 17, preservada intocada). Cria um pedido com um ou mais itens (CUSTOM/SPOT/CATALOG) na mesma transação. Gera order_number via next_order_number(), herda lead_source_id de customers.acquisition_source_id quando não informado, valida e persiste payment_method (null ou PIX/DINHEIRO/CARTAO, sem DEFAULT — sempre exigido na chamada) no mesmo INSERT, e chama recalculate_order_financials() ao final. Item CUSTOM sempre nasce com uma linha correspondente em custom_versions (version_number = current_version, change_type = INITIAL).';

-- Esta assinatura nova não herda nenhum grant da função de 10 parâmetros
-- (são pg_proc distintos) — mas NASCE com EXECUTE para PUBLIC, por padrão
-- de privilégios do PostgreSQL para funções (ver nota no cabeçalho deste
-- arquivo). O REVOKE abaixo desfaz esse EXECUTE-para-PUBLIC padrão
-- imediatamente, na MESMA transação desta migration, antes de qualquer
-- commit — nunca há uma janela externa em que a função fique executável
-- por PUBLIC/anon/authenticated. Resultado final réplica exato dos grants
-- já usados na função de 10 parâmetros: só service_role com EXECUTE.
revoke execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text)
  to service_role;

-- =============================================================================
-- 3. Verificações — provam que as duas sobrecargas coexistem sem
-- ambiguidade e com as permissões corretas
-- =============================================================================

-- 3.1 Exatamente 2 funções chamadas create_order em public: uma com 10
-- parâmetros (preservada), outra com 11 (nova). Nem mais, nem menos.
do $$
declare
  v_count_10 integer;
  v_count_11 integer;
  v_count_other integer;
begin
  select count(*) into v_count_10
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'create_order'
      and pronargs = 10;

  select count(*) into v_count_11
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'create_order'
      and pronargs = 11;

  select count(*) into v_count_other
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'create_order'
      and pronargs not in (10, 11);

  if v_count_10 <> 1 then
    raise exception 'Abortando: esperada exatamente 1 função create_order com 10 parâmetros (preservada), encontrada %.', v_count_10;
  end if;
  if v_count_11 <> 1 then
    raise exception 'Abortando: esperada exatamente 1 função create_order com 11 parâmetros (nova), encontrada %.', v_count_11;
  end if;
  if v_count_other <> 0 then
    raise exception 'Abortando: encontrada(s) % função(ões) create_order com número de parâmetros inesperado (nem 10 nem 11).', v_count_other;
  end if;
end $$;

-- 3.2 Nenhuma ambiguidade possível: as duas assinaturas têm contagens de
-- parâmetro diferentes (10 vs 11) — PostgreSQL nunca as trataria como
-- candidatas ambíguas para uma mesma chamada por posição, e o
-- PostgREST/supabase-js (chamada por nome de parâmetro) só resolve para a
-- de 11 quando p_payment_method está entre os nomes enviados, o que a
-- função de 10 parâmetros não possui. Esta checagem confirma
-- estruturalmente que os dois pronargs são distintos (pré-requisito para
-- a ausência de ambiguidade).
do $$
declare
  v_pronargs_10 integer;
  v_pronargs_11 integer;
begin
  select pronargs into v_pronargs_10
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_order' and pronargs = 10;

  select pronargs into v_pronargs_11
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_order' and pronargs = 11;

  if v_pronargs_10 = v_pronargs_11 then
    raise exception 'Abortando: as duas assinaturas de create_order têm o mesmo número de parâmetros — ambiguidade real.';
  end if;
end $$;

-- 3.3 Permissões: anon e authenticated sem EXECUTE em NENHUMA das duas
-- assinaturas; só service_role com EXECUTE nas duas.
do $$
declare
  v_anon_10 boolean;
  v_anon_11 boolean;
  v_authenticated_10 boolean;
  v_authenticated_11 boolean;
  v_service_role_10 boolean;
  v_service_role_11 boolean;
begin
  select has_function_privilege('anon', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_anon_10;
  select has_function_privilege('anon', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE') into v_anon_11;
  select has_function_privilege('authenticated', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_authenticated_10;
  select has_function_privilege('authenticated', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE') into v_authenticated_11;
  select has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_service_role_10;
  select has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE') into v_service_role_11;

  if v_anon_10 or v_anon_11 then
    raise exception 'Abortando: anon tem EXECUTE em create_order (10=%, 11=%) — não deveria.', v_anon_10, v_anon_11;
  end if;
  if v_authenticated_10 or v_authenticated_11 then
    raise exception 'Abortando: authenticated tem EXECUTE em create_order (10=%, 11=%) — não deveria.', v_authenticated_10, v_authenticated_11;
  end if;
  if not v_service_role_10 or not v_service_role_11 then
    raise exception 'Abortando: service_role deveria ter EXECUTE nas duas assinaturas (10=%, 11=%).', v_service_role_10, v_service_role_11;
  end if;
end $$;

-- 3.4 SECURITY DEFINER, search_path e ownership da função nova, e
-- comparação de ownership com a função de 10 parâmetros (devem
-- coincidir — mesma migration/role aplicando ambas ao longo do tempo).
do $$
declare
  v_is_security_definer_11 boolean;
  v_search_path_raw text;
  v_owner_10 oid;
  v_owner_11 oid;
begin
  select prosecdef into v_is_security_definer_11
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_order' and pronargs = 11;

  if not v_is_security_definer_11 then
    raise exception 'Abortando: a nova create_order (11 parâmetros) não é SECURITY DEFINER.';
  end if;

  select setting into v_search_path_raw
    from pg_proc, unnest(proconfig) as setting
    where pronamespace = 'public'::regnamespace and proname = 'create_order' and pronargs = 11
      and setting like 'search_path=%';

  if v_search_path_raw is null then
    raise exception 'Abortando: search_path não configurado na nova create_order (11 parâmetros).';
  end if;
  -- Remove o prefixo "search_path=" e quaisquer aspas, tolerando a forma
  -- exata de serialização do GUC no catálogo — o valor efetivo precisa
  -- ser vazio (equivalente a SET search_path = '', todas as referências
  -- já totalmente qualificadas dentro da função).
  if trim(both '"' from substring(v_search_path_raw from 13)) <> '' then
    raise exception 'Abortando: search_path da nova create_order deveria ser vazio, veio: %.', v_search_path_raw;
  end if;

  select proowner into v_owner_10
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_order' and pronargs = 10;
  select proowner into v_owner_11
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_order' and pronargs = 11;

  if v_owner_10 <> v_owner_11 then
    raise exception 'Abortando: owners diferentes entre create_order de 10 (%) e 11 (%) parâmetros.', v_owner_10, v_owner_11;
  end if;
end $$;
