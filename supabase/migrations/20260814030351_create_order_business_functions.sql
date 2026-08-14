-- Bloco 1 — Clientes e Pedidos
-- Migration 15/16: funções de negócio transacionais para pedidos
-- decisão do plano final do Bloco 1
--
-- Estas são as únicas funções que as Edge Functions (ainda não criadas)
-- chamarão via RPC com service_role. Nenhuma Edge Function, view ou tabela
-- de produção/estoque é criada aqui.
--
-- Decisão sobre parâmetros JSONB (requisito 5 do pedido): create_order
-- precisa aceitar uma lista de itens heterogênea (CATALOG/CUSTOM/SPOT, cada
-- um com um sub-payload de detalhes diferente) — um array de estruturas
-- variáveis não é representável de forma razoável como parâmetros
-- escalares nomeados. Usei jsonb para a lista de itens em create_order e
-- para o payload de um item em add_order_item/update_order_item, pelo
-- mesmo motivo (o payload de update_order_item também precisa carregar um
-- sub-objeto custom_details/spot_details polimórfico conforme o
-- item_type). As demais funções (update_order, change_order_status,
-- register_approval, register_payment, register_custom_version,
-- update_product_price) têm um conjunto fixo e plano de campos por
-- operação — mantive parâmetros tipados normais nelas, mais seguros
-- (validação de tipo pelo Postgres) e mais simples de ler do que jsonb.
--
-- Validação de estrutura do jsonb: os campos obrigatórios de cada item
-- (item_type, item_name, quantity, unit_price) não são revalidados em
-- PL/pgSQL antes do INSERT — se estiverem ausentes/malformados no jsonb, a
-- extração resulta em NULL e a própria constraint da coluna (NOT NULL/CHECK
-- já criada nas Migrations 7-10) rejeita o INSERT com uma mensagem clara.
-- Não dupliquei essas validações aqui.

-- ---------------------------------------------------------------------------
-- assert_active_user(user_id): helper interno de validação
-- ---------------------------------------------------------------------------
create or replace function public.assert_active_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (
    select 1 from public.users where id = p_user_id and is_active
  ) then
    raise exception 'Usuário inválido ou inativo: %', p_user_id;
  end if;
end;
$$;

comment on function public.assert_active_user(uuid) is
  'Valida que p_user_id existe em public.users e está ativo. Usado por todas as funções de negócio deste bloco para validar p_changed_by/p_created_by. Função interna: nunca chamada diretamente por sessão de frontend/Sky.';

revoke execute on function public.assert_active_user(uuid) from public, anon, authenticated;
-- Nenhum GRANT EXECUTE é concedido — mesmo padrão de next_order_number()
-- (Migration 6): só chamável de dentro de outra função security definer do
-- mesmo owner.

-- ---------------------------------------------------------------------------
-- jsonb_whitelist(data, allowed_keys): helper interno de sanitização
-- ---------------------------------------------------------------------------
-- Usado por update_order_item para garantir que só as chaves explicitamente
-- permitidas de um payload jsonb (nunca "id", "order_id", "item_type",
-- "current_version" ou qualquer outra chave fora da whitelist) sejam lidas
-- adiante — não confia em chaves arbitrárias presentes no JSON recebido.
-- Função pura (não acessa tabelas), mas mantida com o mesmo isolamento das
-- demais funções internas por consistência.
create or replace function public.jsonb_whitelist(p_data jsonb, p_allowed_keys text[])
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_object_agg(key, value)
      from jsonb_each(coalesce(p_data, '{}'::jsonb))
      where key = any(p_allowed_keys)
    ),
    '{}'::jsonb
  );
$$;

comment on function public.jsonb_whitelist(jsonb, text[]) is
  'Retorna um novo jsonb contendo somente as chaves de p_data presentes em p_allowed_keys — usado para sanitizar payloads jsonb antes de ler seus valores, evitando confiar em chaves arbitrárias enviadas pelo chamador.';

revoke execute on function public.jsonb_whitelist(jsonb, text[]) from public, anon, authenticated;
-- Nenhum GRANT EXECUTE é concedido — função interna, só usada de dentro de
-- update_order_item.

-- ---------------------------------------------------------------------------
-- A) create_order
-- ---------------------------------------------------------------------------
-- p_items: array jsonb, um objeto por item, com as chaves:
--   item_type (CUSTOM|SPOT|CATALOG), product_id, item_name, description,
--   quantity, unit_price, personalization_fee, discount_value,
--   color_description, number_of_colors, customization_data,
--   expected_delivery_date, notes,
--   e, conforme item_type:
--     custom_details: { current_version, is_exclusive, prototype_required,
--                        development_minutes, notes }
--     spot_details: { model_source_id, source_reference, is_exclusive,
--                      test_print_required, search_time_status,
--                      search_minutes, preparation_minutes,
--                      market_reference_price, market_reference_source,
--                      market_reference_date, notes }
create or replace function public.create_order(
  p_customer_id uuid,
  p_company_id uuid,
  p_lead_source_id uuid,
  p_expected_delivery_date date,
  p_delivery_method text,
  p_shipping_cost numeric(10, 2),
  p_discount_value numeric(10, 2),
  p_notes text,
  p_items jsonb,
  p_changed_by uuid
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

  insert into public.orders (
    order_number, customer_id, company_id, lead_source_id,
    order_status, payment_status,
    expected_delivery_date, delivery_method,
    shipping_cost, discount_value, notes
  ) values (
    v_order_number, p_customer_id, p_company_id, v_lead_source_id,
    'QUOTE', 'WAITING_PAYMENT',
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
        -- prototype_completed sempre nasce false: não é possível ter
        -- concluído um protótipo no mesmo instante em que o item é criado.
        false,
        nullif(v_custom ->> 'development_minutes', '')::integer,
        v_custom ->> 'notes'
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

comment on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid) is
  'Cria um pedido com um ou mais itens (CUSTOM/SPOT/CATALOG) na mesma transação. Gera order_number via next_order_number(), herda lead_source_id de customers.acquisition_source_id quando não informado, e chama recalculate_order_financials() ao final.';

revoke execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- B) update_order
-- ---------------------------------------------------------------------------
-- Substituição completa dos campos editáveis do cabeçalho (a Edge Function
-- sempre envia o estado completo desejado, não um patch parcial — evita a
-- ambiguidade de "campo omitido" vs. "campo deve virar NULL"). Não altera
-- order_status nem order_items.
create or replace function public.update_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_company_id uuid,
  p_lead_source_id uuid,
  p_payment_method text,
  p_expected_delivery_date date,
  p_actual_delivery_date date,
  p_delivery_method text,
  p_shipping_cost numeric(10, 2),
  p_discount_value numeric(10, 2),
  p_notes text,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_current_customer_id uuid;
begin
  perform public.assert_active_user(p_changed_by);

  select order_status, customer_id
    into v_order_status, v_current_customer_id
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  if v_order_status in ('DELIVERED', 'CANCELLED') then
    raise exception 'Pedido em % não pode mais ser editado', v_order_status;
  end if;

  if p_customer_id is distinct from v_current_customer_id
     and v_order_status not in ('QUOTE', 'WAITING_APPROVAL') then
    raise exception 'customer_id não pode ser alterado após aprovação (status atual: %)', v_order_status;
  end if;

  update public.orders
    set customer_id = p_customer_id,
        company_id = p_company_id,
        lead_source_id = p_lead_source_id,
        payment_method = p_payment_method,
        expected_delivery_date = p_expected_delivery_date,
        actual_delivery_date = p_actual_delivery_date,
        delivery_method = p_delivery_method,
        shipping_cost = coalesce(p_shipping_cost, 0),
        discount_value = coalesce(p_discount_value, 0),
        notes = p_notes
    where id = p_order_id;

  perform public.recalculate_order_financials(
    p_order_id, p_changed_by, 'Recálculo após edição do cabeçalho do pedido'
  );
end;
$$;

comment on function public.update_order(uuid, uuid, uuid, uuid, text, date, date, text, numeric, numeric, text, uuid) is
  'Atualiza o cabeçalho do pedido (substituição completa dos campos editáveis). Bloqueia edição de pedidos DELIVERED/CANCELLED e troca de customer_id após QUOTE/WAITING_APPROVAL. Não altera order_status.';

revoke execute on function public.update_order(uuid, uuid, uuid, uuid, text, date, date, text, numeric, numeric, text, uuid)
  from public, anon, authenticated;
grant execute on function public.update_order(uuid, uuid, uuid, uuid, text, date, date, text, numeric, numeric, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- C) add_order_item / update_order_item / remove_order_item
-- ---------------------------------------------------------------------------
-- "Produção já começada" é bloqueada nas três funções pelos mesmos status:
-- IN_PRODUCTION, WAITING_DELIVERY, DELIVERED, CANCELLED.

create or replace function public.add_order_item(
  p_order_id uuid,
  p_item jsonb,
  p_changed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_order_item_id uuid;
  v_item_type text;
  v_custom jsonb;
  v_spot jsonb;
begin
  perform public.assert_active_user(p_changed_by);

  select order_status into v_order_status
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  if v_order_status in ('IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED') then
    raise exception 'Não é possível adicionar item após início da produção (status atual: %)', v_order_status;
  end if;

  v_item_type := p_item ->> 'item_type';

  insert into public.order_items (
    order_id, item_type, product_id, item_name, description,
    quantity, unit_price, personalization_fee, discount_value,
    color_description, number_of_colors, customization_data,
    expected_delivery_date, notes
  ) values (
    p_order_id,
    v_item_type,
    nullif(p_item ->> 'product_id', '')::uuid,
    p_item ->> 'item_name',
    p_item ->> 'description',
    (p_item ->> 'quantity')::integer,
    (p_item ->> 'unit_price')::numeric,
    coalesce((p_item ->> 'personalization_fee')::numeric, 0),
    coalesce((p_item ->> 'discount_value')::numeric, 0),
    p_item ->> 'color_description',
    nullif(p_item ->> 'number_of_colors', '')::integer,
    coalesce(p_item -> 'customization_data', '{}'::jsonb),
    nullif(p_item ->> 'expected_delivery_date', '')::date,
    p_item ->> 'notes'
  )
  returning id into v_order_item_id;

  if v_item_type = 'CUSTOM' then
    v_custom := p_item -> 'custom_details';
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

  elsif v_item_type = 'SPOT' then
    v_spot := p_item -> 'spot_details';
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

  perform public.recalculate_order_financials(
    p_order_id, p_changed_by, 'Recálculo após adicionar item'
  );

  return v_order_item_id;
end;
$$;

comment on function public.add_order_item(uuid, jsonb, uuid) is
  'Adiciona um item a um pedido existente (mesmo formato de payload jsonb de create_order). Bloqueado a partir de IN_PRODUCTION.';

revoke execute on function public.add_order_item(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.add_order_item(uuid, jsonb, uuid) to service_role;

-- update_order_item: NÃO permite alterar item_type nem product_id (fixados
-- na criação do item — se estiverem errados, o item deve ser removido e
-- recriado). p_item carrega os campos mutáveis de order_items e,
-- opcionalmente, custom_details/spot_details com os campos mutáveis das
-- tabelas satélite (current_version e model_source_id de origem
-- permanecem, mas current_version NUNCA é alterada por aqui — só por
-- register_custom_version).
create or replace function public.update_order_item(
  p_order_item_id uuid,
  p_item jsonb,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_item_type text;
  v_order_status text;
  v_item jsonb;
  v_custom jsonb;
  v_spot jsonb;
begin
  perform public.assert_active_user(p_changed_by);

  select order_id, item_type into v_order_id, v_item_type
    from public.order_items
    where id = p_order_item_id;

  if not found then
    raise exception 'order_items.id % não encontrado', p_order_item_id;
  end if;

  select order_status into v_order_status
    from public.orders
    where id = v_order_id
    for update;

  if v_order_status in ('IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED') then
    raise exception 'Não é possível alterar item após início da produção (status atual: %)', v_order_status;
  end if;

  -- Whitelist explícita: só estas chaves de p_item são lidas a partir daqui
  -- — id, order_id, item_type, current_version ou qualquer outra chave
  -- fora desta lista são descartadas por jsonb_whitelist() e nunca chegam
  -- a ser processadas, mesmo que estejam presentes no payload recebido.
  v_item := public.jsonb_whitelist(p_item, array[
    'quantity', 'unit_price', 'personalization_fee', 'discount_value',
    'color_description', 'number_of_colors', 'customization_data',
    'expected_delivery_date', 'notes', 'custom_details', 'spot_details'
  ]);

  -- Semântica PATCH: cada coluna só é tocada se a chave correspondente
  -- estiver presente em v_item (`v_item ? 'chave'`). Ausência de chave
  -- preserva o valor atual (branch `else <coluna>`); presença com valor
  -- define esse valor; presença com `null` explícito no JSON define NULL
  -- na coluna (permitido só onde a coluna é nullable — colunas NOT NULL
  -- como quantity/unit_price/personalization_fee/discount_value/
  -- customization_data usam coalesce(...) para cair de volta no valor
  -- atual em vez de violar a constraint quando um null explícito chega).
  update public.order_items
    set quantity = case when v_item ? 'quantity'
                      then (v_item ->> 'quantity')::integer
                      else quantity end,
        unit_price = case when v_item ? 'unit_price'
                       then (v_item ->> 'unit_price')::numeric
                       else unit_price end,
        personalization_fee = case when v_item ? 'personalization_fee'
                                 then coalesce((v_item ->> 'personalization_fee')::numeric, personalization_fee)
                                 else personalization_fee end,
        discount_value = case when v_item ? 'discount_value'
                            then coalesce((v_item ->> 'discount_value')::numeric, discount_value)
                            else discount_value end,
        color_description = case when v_item ? 'color_description'
                               then v_item ->> 'color_description'
                               else color_description end,
        number_of_colors = case when v_item ? 'number_of_colors'
                              then nullif(v_item ->> 'number_of_colors', '')::integer
                              else number_of_colors end,
        customization_data = case when v_item ? 'customization_data'
                                then coalesce(v_item -> 'customization_data', customization_data)
                                else customization_data end,
        expected_delivery_date = case when v_item ? 'expected_delivery_date'
                                    then nullif(v_item ->> 'expected_delivery_date', '')::date
                                    else expected_delivery_date end,
        notes = case when v_item ? 'notes'
                   then v_item ->> 'notes'
                   else notes end
    where id = p_order_item_id;

  if v_item_type = 'CUSTOM' and v_item ? 'custom_details' then
    -- Whitelist do sub-objeto: current_version não está nesta lista, então
    -- mesmo que o payload tente incluí-la dentro de custom_details, é
    -- descartada aqui — só register_custom_version pode alterá-la. Mesma
    -- semântica PATCH campo a campo do bloco acima.
    v_custom := public.jsonb_whitelist(v_item -> 'custom_details', array[
      'is_exclusive', 'prototype_required', 'prototype_completed',
      'development_minutes', 'notes'
    ]);
    update public.custom_item_details
      set is_exclusive = case when v_custom ? 'is_exclusive'
                            then coalesce((v_custom ->> 'is_exclusive')::boolean, is_exclusive)
                            else is_exclusive end,
          prototype_required = case when v_custom ? 'prototype_required'
                                  then coalesce((v_custom ->> 'prototype_required')::boolean, prototype_required)
                                  else prototype_required end,
          prototype_completed = case when v_custom ? 'prototype_completed'
                                   then coalesce((v_custom ->> 'prototype_completed')::boolean, prototype_completed)
                                   else prototype_completed end,
          development_minutes = case when v_custom ? 'development_minutes'
                                   then nullif(v_custom ->> 'development_minutes', '')::integer
                                   else development_minutes end,
          notes = case when v_custom ? 'notes'
                     then v_custom ->> 'notes'
                     else notes end
      where order_item_id = p_order_item_id;

  elsif v_item_type = 'SPOT' and v_item ? 'spot_details' then
    v_spot := public.jsonb_whitelist(v_item -> 'spot_details', array[
      'model_source_id', 'source_reference', 'is_exclusive',
      'test_print_required', 'test_print_completed', 'search_time_status',
      'search_minutes', 'preparation_minutes', 'market_reference_price',
      'market_reference_source', 'market_reference_date',
      'catalog_conversion_suggested', 'notes'
    ]);
    update public.spot_item_details
      set model_source_id = case when v_spot ? 'model_source_id'
                               then nullif(v_spot ->> 'model_source_id', '')::uuid
                               else model_source_id end,
          source_reference = case when v_spot ? 'source_reference'
                                then v_spot ->> 'source_reference'
                                else source_reference end,
          is_exclusive = case when v_spot ? 'is_exclusive'
                            then coalesce((v_spot ->> 'is_exclusive')::boolean, is_exclusive)
                            else is_exclusive end,
          test_print_required = case when v_spot ? 'test_print_required'
                                   then coalesce((v_spot ->> 'test_print_required')::boolean, test_print_required)
                                   else test_print_required end,
          test_print_completed = case when v_spot ? 'test_print_completed'
                                    then coalesce((v_spot ->> 'test_print_completed')::boolean, test_print_completed)
                                    else test_print_completed end,
          search_time_status = case when v_spot ? 'search_time_status'
                                  then coalesce(v_spot ->> 'search_time_status', search_time_status)
                                  else search_time_status end,
          search_minutes = case when v_spot ? 'search_minutes'
                              then nullif(v_spot ->> 'search_minutes', '')::integer
                              else search_minutes end,
          preparation_minutes = case when v_spot ? 'preparation_minutes'
                                   then nullif(v_spot ->> 'preparation_minutes', '')::integer
                                   else preparation_minutes end,
          market_reference_price = case when v_spot ? 'market_reference_price'
                                      then nullif(v_spot ->> 'market_reference_price', '')::numeric
                                      else market_reference_price end,
          market_reference_source = case when v_spot ? 'market_reference_source'
                                       then v_spot ->> 'market_reference_source'
                                       else market_reference_source end,
          market_reference_date = case when v_spot ? 'market_reference_date'
                                     then nullif(v_spot ->> 'market_reference_date', '')::date
                                     else market_reference_date end,
          catalog_conversion_suggested = case when v_spot ? 'catalog_conversion_suggested'
                                            then coalesce((v_spot ->> 'catalog_conversion_suggested')::boolean, catalog_conversion_suggested)
                                            else catalog_conversion_suggested end,
          notes = case when v_spot ? 'notes'
                     then v_spot ->> 'notes'
                     else notes end
      where order_item_id = p_order_item_id;
  end if;

  perform public.recalculate_order_financials(
    v_order_id, p_changed_by, 'Recálculo após editar item'
  );
end;
$$;

comment on function public.update_order_item(uuid, jsonb, uuid) is
  'Atualiza (semântica PATCH: só altera colunas cuja chave está presente no jsonb) os campos mutáveis de um order_item existente e, opcionalmente, os campos mutáveis de custom_item_details/spot_item_details, usando jsonb_whitelist() para nunca ler id/order_id/item_type/current_version ou qualquer chave fora do escopo. Nunca altera item_type, product_id nem current_version. Bloqueado a partir de IN_PRODUCTION.';

revoke execute on function public.update_order_item(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_order_item(uuid, jsonb, uuid) to service_role;

-- remove_order_item: NÃO tenta DELETE físico de order_items quando existe
-- histórico de versão/aprovação vinculado — as FKs de custom_versions e
-- approvals para order_items usam ON DELETE RESTRICT propositalmente
-- (Migration 9) para nunca perder esse histórico. Um item CUSTOM/SPOT que
-- já teve alguma versão registrada ou aprovação recebida não pode mais ser
-- removido; a única forma de "descartar" esse item a partir daí é cancelar
-- o pedido inteiro. Um item recém-adicionado, ainda sem histórico, pode ser
-- removido normalmente (inclusive apagando sua linha de
-- custom_item_details/spot_item_details, se existir).
create or replace function public.remove_order_item(
  p_order_item_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_status text;
  v_item_count integer;
begin
  perform public.assert_active_user(p_changed_by);

  select order_id into v_order_id
    from public.order_items
    where id = p_order_item_id;

  if not found then
    raise exception 'order_items.id % não encontrado', p_order_item_id;
  end if;

  select order_status into v_order_status
    from public.orders
    where id = v_order_id
    for update;

  if v_order_status in ('IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED') then
    raise exception 'Não é possível remover item após início da produção (status atual: %)', v_order_status;
  end if;

  select count(*) into v_item_count
    from public.order_items
    where order_id = v_order_id;

  if v_item_count <= 1 then
    raise exception 'Pedido não pode ficar sem nenhum item';
  end if;

  if exists (select 1 from public.custom_versions where order_item_id = p_order_item_id)
     or exists (select 1 from public.approvals where order_item_id = p_order_item_id) then
    raise exception 'Item possui histórico de versão/aprovação e não pode ser removido — cancele o pedido se necessário';
  end if;

  delete from public.custom_item_details where order_item_id = p_order_item_id;
  delete from public.spot_item_details where order_item_id = p_order_item_id;
  delete from public.order_items where id = p_order_item_id;

  perform public.recalculate_order_financials(
    v_order_id, p_changed_by, 'Recálculo após remover item'
  );
end;
$$;

comment on function public.remove_order_item(uuid, uuid) is
  'Remove um order_item sem histórico (sem custom_versions/approvals vinculados) e mantém o pedido com pelo menos um item. Bloqueado a partir de IN_PRODUCTION. Itens com histórico não podem ser removidos (RESTRICT nas FKs de custom_versions/approvals).';

revoke execute on function public.remove_order_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_order_item(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- D) change_order_status
-- ---------------------------------------------------------------------------
create or replace function public.change_order_status(
  p_order_id uuid,
  p_to_status text,
  p_changed_by uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
  v_sequence text[] := array[
    'QUOTE', 'WAITING_APPROVAL', 'APPROVED', 'IN_PRODUCTION_QUEUE',
    'IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED'
  ];
  v_current_pos integer;
  v_target_pos integer;
  v_status_after_approval_attempt text;
begin
  perform public.assert_active_user(p_changed_by);

  select order_status into v_current_status
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  v_current_pos := array_position(v_sequence, v_current_status);

  if p_to_status = 'CANCELLED' then
    if v_current_pos is null or v_current_pos >= array_position(v_sequence, 'IN_PRODUCTION') then
      raise exception 'Cancelamento só é permitido antes do início da produção (status atual: %)', v_current_status;
    end if;

    update public.orders set order_status = 'CANCELLED' where id = p_order_id;

    insert into public.order_status_history (
      order_id, from_status, to_status, changed_by, reason
    ) values (
      p_order_id, v_current_status, 'CANCELLED', p_changed_by,
      coalesce(p_reason, 'Pedido cancelado')
    );

    return;
  end if;

  v_target_pos := array_position(v_sequence, p_to_status);

  if v_target_pos is null then
    raise exception 'order_status de destino inválido: %', p_to_status;
  end if;

  if v_current_pos is null then
    raise exception 'Pedido está em % — nenhuma transição de status é permitida a partir daqui', v_current_status;
  end if;

  if v_target_pos <> v_current_pos + 1 then
    raise exception 'Transição de status inválida: % -> % (não é possível pular estados)', v_current_status, p_to_status;
  end if;

  if p_to_status = 'APPROVED' then
    -- Reutiliza try_auto_approve_order() (Migration 14): ela só aprova se
    -- todos os itens CUSTOM/SPOT tiverem approval válida para a versão
    -- atual. Se não aprovar, o pedido permanece em WAITING_APPROVAL e esta
    -- função sinaliza o motivo.
    perform public.try_auto_approve_order(p_order_id, p_changed_by, p_reason);

    select order_status into v_status_after_approval_attempt
      from public.orders
      where id = p_order_id;

    if v_status_after_approval_attempt <> 'APPROVED' then
      raise exception 'Aprovações obrigatórias pendentes — pedido permanece em WAITING_APPROVAL';
    end if;

    -- approval_date e order_status_history já foram gravados por
    -- try_auto_approve_order(); nada mais a fazer aqui.
    return;
  end if;

  if p_to_status = 'IN_PRODUCTION_QUEUE' then
    -- Gate de SPOT: nenhum item SPOT pode entrar em fila de produção sem
    -- ter o tempo de pesquisa/preparação registrado (docs/02
    -- ESPECIFICACAO_TECNICA.md §6.5). A constraint
    -- spot_item_details_search_time_consistency (Migration 10) já garante
    -- que RECORDED implica search_minutes preenchido — não revalidado
    -- aqui. Nenhum cronômetro/automação é implementado nesta migration.
    if exists (
      select 1
      from public.order_items oi
      join public.spot_item_details sid on sid.order_item_id = oi.id
      where oi.order_id = p_order_id
        and sid.search_time_status <> 'RECORDED'
    ) then
      raise exception 'Existe item SPOT com tempo de pesquisa/preparação não registrado (search_time_status <> RECORDED)';
    end if;
  end if;

  update public.orders set order_status = p_to_status where id = p_order_id;

  insert into public.order_status_history (
    order_id, from_status, to_status, changed_by, reason
  ) values (
    p_order_id, v_current_status, p_to_status, p_changed_by,
    coalesce(p_reason, 'Transição de status')
  );

  if p_to_status = 'WAITING_APPROVAL' then
    -- Após QUOTE -> WAITING_APPROVAL, tenta aprovar automaticamente: se o
    -- pedido só tiver itens CATALOG (nenhum exige aprovação) ou todos os
    -- itens CUSTOM/SPOT já estiverem aprovados, avança direto para
    -- APPROVED em vez de ficar parado indefinidamente em WAITING_APPROVAL.
    -- Se houver qualquer CUSTOM/SPOT pendente, try_auto_approve_order()
    -- não faz nada e o pedido permanece em WAITING_APPROVAL normalmente.
    perform public.try_auto_approve_order(p_order_id, p_changed_by, p_reason);
  end if;
end;
$$;

comment on function public.change_order_status(uuid, text, uuid, text) is
  'Máquina de estados de orders.order_status: só permite avançar uma posição por vez na sequência QUOTE->WAITING_APPROVAL->APPROVED->IN_PRODUCTION_QUEUE->IN_PRODUCTION->WAITING_DELIVERY->DELIVERED, ou CANCELLED antes de IN_PRODUCTION. A transição para APPROVED delega a validação de aprovações a try_auto_approve_order(). A transição para IN_PRODUCTION_QUEUE bloqueia se existir item SPOT com search_time_status <> RECORDED. Após QUOTE->WAITING_APPROVAL, chama try_auto_approve_order() para não deixar pedidos só-CATALOG (ou já totalmente aprovados) parados indefinidamente. Nunca altera payment_status.';

revoke execute on function public.change_order_status(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.change_order_status(uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- E) register_approval
-- ---------------------------------------------------------------------------
create or replace function public.register_approval(
  p_order_item_id uuid,
  p_approval_type text,
  p_approved_at timestamptz,
  p_changed_by uuid,
  p_custom_version_id uuid default null,
  p_approval_evidence_file_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_item_type text;
  v_current_version text;
  v_version_number text;
  v_approval_id uuid;
begin
  perform public.assert_active_user(p_changed_by);

  select order_id, item_type into v_order_id, v_item_type
    from public.order_items
    where id = p_order_item_id;

  if not found then
    raise exception 'order_items.id % não encontrado', p_order_item_id;
  end if;

  -- Trava orders antes de escrever em approvals (convenção da Migration 14).
  perform 1 from public.orders where id = v_order_id for update;

  if v_item_type = 'CATALOG' then
    raise exception 'Item CATALOG não exige aprovação';

  elsif v_item_type = 'SPOT' then
    if p_custom_version_id is not null then
      raise exception 'Item SPOT não usa custom_version_id';
    end if;

  elsif v_item_type = 'CUSTOM' then
    if p_custom_version_id is null then
      raise exception 'Item CUSTOM exige custom_version_id';
    end if;

    select version_number into v_version_number
      from public.custom_versions
      where id = p_custom_version_id
        and order_item_id = p_order_item_id;

    if not found then
      raise exception 'custom_version_id % não pertence a order_items.id %', p_custom_version_id, p_order_item_id;
    end if;

    select current_version into v_current_version
      from public.custom_item_details
      where order_item_id = p_order_item_id;

    if v_version_number <> v_current_version then
      raise exception 'Só é possível aprovar a versão atual (%) — versão informada: %', v_current_version, v_version_number;
    end if;
  end if;

  insert into public.approvals (
    order_item_id, custom_version_id, approval_type, approved_at,
    approval_evidence_file_id, notes, created_by
  ) values (
    p_order_item_id, p_custom_version_id, p_approval_type, p_approved_at,
    p_approval_evidence_file_id, p_notes, p_changed_by
  )
  returning id into v_approval_id;

  -- Nunca sobrescreve aprovações antigas: só INSERT, nunca UPDATE/DELETE
  -- nesta tabela.
  perform public.try_auto_approve_order(
    v_order_id, p_changed_by,
    'Aprovação automática: todas as aprovações obrigatórias concluídas'
  );

  return v_approval_id;
end;
$$;

comment on function public.register_approval(uuid, text, timestamptz, uuid, uuid, uuid, text) is
  'Registra uma aprovação para um order_item. SPOT exige custom_version_id NULL; CUSTOM exige custom_version_id apontando para a versão que é hoje o current_version do item; CATALOG é rejeitado. Chama try_auto_approve_order() ao final, que avança o pedido para APPROVED automaticamente se todas as aprovações obrigatórias estiverem concluídas.';

revoke execute on function public.register_approval(uuid, text, timestamptz, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_approval(uuid, text, timestamptz, uuid, uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- F) register_payment
-- ---------------------------------------------------------------------------
create or replace function public.register_payment(
  p_order_id uuid,
  p_payment_method text,
  p_amount numeric(10, 2),
  p_payment_type text,
  p_paid_at timestamptz,
  p_changed_by uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_total numeric(10, 2);
  v_payment_id uuid;
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  select coalesce(sum(amount), 0) into v_current_total
    from public.payments
    where order_id = p_order_id;

  if v_current_total + p_amount < 0 then
    raise exception 'Soma dos pagamentos ficaria negativa para orders.id % (atual: %, novo lançamento: %)',
      p_order_id, v_current_total, p_amount;
  end if;

  -- As demais regras de amount/payment_type (amount <> 0, AJUSTE como único
  -- tipo que aceita negativo, notes obrigatório em ajuste negativo) já são
  -- garantidas pelas CHECK constraints de payments (Migration 12) — não
  -- duplicadas aqui.
  insert into public.payments (
    order_id, payment_method, amount, payment_type, paid_at, notes, created_by
  ) values (
    p_order_id, p_payment_method, p_amount, p_payment_type, p_paid_at, p_notes, p_changed_by
  )
  returning id into v_payment_id;

  -- Nenhum estorno automático: pagamento excedente é permitido e só resulta
  -- em payment_status = PAID (o indicador de excedente é calculado depois
  -- em view, Migration 16).
  perform public.recalculate_order_financials(
    p_order_id, p_changed_by, 'Recálculo após registrar pagamento'
  );

  return v_payment_id;
end;
$$;

comment on function public.register_payment(uuid, text, numeric, text, timestamptz, uuid, text) is
  'Registra um pagamento (ou ajuste). Impede que a soma dos pagamentos do pedido fique negativa. Chama recalculate_order_financials() ao final, que recalcula payment_status. Nenhum estorno automático.';

revoke execute on function public.register_payment(uuid, text, numeric, text, timestamptz, uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_payment(uuid, text, numeric, text, timestamptz, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- G) register_custom_version
-- ---------------------------------------------------------------------------
create or replace function public.register_custom_version(
  p_order_item_id uuid,
  p_version_number text,
  p_changed_by uuid,
  p_change_type text default null,
  p_change_description text default null,
  p_file_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_item_type text;
  v_order_status text;
  v_version_id uuid;
begin
  perform public.assert_active_user(p_changed_by);

  select order_id, item_type into v_order_id, v_item_type
    from public.order_items
    where id = p_order_item_id;

  if not found then
    raise exception 'order_items.id % não encontrado', p_order_item_id;
  end if;

  -- Regra de negócio antecipada nos comentários da Migration 9: aqui é onde
  -- se confirma que order_item_id pertence a um item CUSTOM.
  if v_item_type <> 'CUSTOM' then
    raise exception 'register_custom_version só se aplica a itens CUSTOM (item_type=%)', v_item_type;
  end if;

  select order_status into v_order_status
    from public.orders
    where id = v_order_id
    for update;

  if v_order_status in ('IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED') then
    raise exception 'Não é possível registrar nova versão após início da produção (status atual: %)', v_order_status;
  end if;

  if exists (
    select 1 from public.custom_versions
    where order_item_id = p_order_item_id and version_number = p_version_number
  ) then
    raise exception 'Versão % já existe para order_items.id %', p_version_number, p_order_item_id;
  end if;

  insert into public.custom_versions (
    order_item_id, version_number, change_type, change_description, file_id
  ) values (
    p_order_item_id, p_version_number, p_change_type, p_change_description, p_file_id
  )
  returning id into v_version_id;

  -- Atualiza current_version na mesma transação. A partir daqui, nenhuma
  -- approval existente aponta para esta nova versão — o item volta a
  -- precisar de aprovação (mecanismo de comparação de versão descrito na
  -- Migration 9, sem apagar nenhuma approval antiga).
  update public.custom_item_details
    set current_version = p_version_number
    where order_item_id = p_order_item_id;

  -- Se o pedido já havia avançado além de WAITING_APPROVAL (APPROVED ou
  -- IN_PRODUCTION_QUEUE — produção ainda não começou nesses dois estados),
  -- a nova versão invalida a aprovação vigente: o pedido regride para
  -- WAITING_APPROVAL e approval_date é limpo. As approvals antigas
  -- permanecem intactas, vinculadas às versões antigas — nada é apagado.
  -- Em QUOTE ou WAITING_APPROVAL, nenhuma regressão é necessária (o pedido
  -- já está antes ou no próprio estágio de aprovação).
  if v_order_status in ('APPROVED', 'IN_PRODUCTION_QUEUE') then
    update public.orders
      set order_status = 'WAITING_APPROVAL',
          approval_date = null
      where id = v_order_id;

    insert into public.order_status_history (
      order_id, from_status, to_status, changed_by, reason
    ) values (
      v_order_id, v_order_status, 'WAITING_APPROVAL', p_changed_by,
      'Nova versão do item Personalizado exige nova aprovação'
    );
  end if;

  return v_version_id;
end;
$$;

comment on function public.register_custom_version(uuid, text, uuid, text, text, uuid) is
  'Cria uma nova versão para um item CUSTOM e atualiza custom_item_details.current_version na mesma transação. Nunca apaga custom_versions/approvals anteriores. Se o pedido estava APPROVED/IN_PRODUCTION_QUEUE, regride para WAITING_APPROVAL e limpa approval_date. Bloqueado a partir de IN_PRODUCTION.';

revoke execute on function public.register_custom_version(uuid, text, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.register_custom_version(uuid, text, uuid, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- H) create_product
-- ---------------------------------------------------------------------------
-- Único caminho para criar um produto de Catálogo a partir desta migration:
-- a Migration 5 concedia INSERT direto em products a authenticated, mas
-- criar um produto agora precisa gravar a primeira linha de
-- product_price_history atomicamente — deixou de ser "CRUD simples e
-- reversível" no sentido da decisão original do Bloco 1. O INSERT direto é
-- revogado logo após esta função (ver bloco "Ajuste de permissões" abaixo).
create or replace function public.create_product(
  p_name text,
  p_category text,
  p_description text,
  p_default_price numeric(10, 2),
  p_default_print_time_minutes integer,
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

  -- Sem SELECT ... FOR UPDATE: produto novo, sem linha existente para
  -- travar — mesma exceção já usada em create_order (nenhuma outra
  -- transação pode conhecer este id antes do commit).
  --
  -- p_default_price >= 0 já é garantido pela CHECK da própria tabela
  -- (Migration 5) — não revalidado aqui.
  insert into public.products (
    name, category, description, default_price,
    default_print_time_minutes, default_weight_grams, units_per_plate,
    default_file_id, allows_personalization
  ) values (
    p_name, p_category, p_description, p_default_price,
    p_default_print_time_minutes, p_default_weight_grams, p_units_per_plate,
    p_default_file_id, coalesce(p_allows_personalization, false)
  )
  returning id into v_product_id;

  -- Primeira linha de histórico, na mesma transação: effective_to NULL
  -- marca este como o preço vigente. Como é a primeira linha deste
  -- product_id, não há conflito possível com o índice único parcial
  -- idx_product_price_history_one_current (Migration 11).
  insert into public.product_price_history (
    product_id, price, effective_from, effective_to, reason, created_by
  ) values (
    v_product_id, p_default_price, now(), null, 'Preço inicial do produto', p_changed_by
  );

  return v_product_id;
end;
$$;

comment on function public.create_product(text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid) is
  'Único caminho para criar um produto de Catálogo: insere products e a primeira linha de product_price_history (effective_to NULL, price = default_price) na mesma transação. created_by resolvido pelo chamador, nunca por auth.uid().';

revoke execute on function public.create_product(text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.create_product(text, text, text, numeric, integer, numeric, integer, uuid, boolean, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Ajuste de permissões em public.products
-- ---------------------------------------------------------------------------
-- A Migration 5 concedeu INSERT direto em products a authenticated
-- (tratado então como cadastro simples e reversível). Agora que criar um
-- produto exige gravar product_price_history atomicamente, esse caminho é
-- revogado: a partir desta migration, criar produto só é possível via
-- create_product(). SELECT e o UPDATE restrito a colunas não financeiras
-- (tudo exceto default_price, já bloqueado desde a Migration 5) permanecem
-- inalterados — nenhum outro grant de products é tocado aqui.
revoke insert on public.products from authenticated;

-- ---------------------------------------------------------------------------
-- I) update_product_price
-- ---------------------------------------------------------------------------
create or replace function public.update_product_price(
  p_product_id uuid,
  p_new_price numeric(10, 2),
  p_changed_by uuid,
  p_reason text default null,
  p_effective_from timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_history_id uuid;
begin
  perform public.assert_active_user(p_changed_by);

  -- Não é uma operação sobre orders: trava products (não orders) pelo
  -- mesmo motivo — serializar alterações concorrentes de preço para o
  -- mesmo produto.
  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'products.id % não encontrado', p_product_id;
  end if;

  -- Fecha a linha vigente ANTES de inserir a nova: o índice único parcial
  -- idx_product_price_history_one_current (Migration 11) só permite uma
  -- linha com effective_to NULL por produto — inserir a nova antes de
  -- fechar a antiga violaria essa constraint.
  update public.product_price_history
    set effective_to = p_effective_from
    where product_id = p_product_id
      and effective_to is null;

  insert into public.product_price_history (
    product_id, price, effective_from, reason, created_by
  ) values (
    p_product_id, p_new_price, p_effective_from, p_reason, p_changed_by
  )
  returning id into v_history_id;

  update public.products
    set default_price = p_new_price
    where id = p_product_id;

  return v_history_id;
end;
$$;

comment on function public.update_product_price(uuid, numeric, uuid, text, timestamptz) is
  'Único caminho para alterar products.default_price: fecha o período vigente anterior em product_price_history, insere a nova linha e atualiza products.default_price na mesma transação.';

revoke execute on function public.update_product_price(uuid, numeric, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.update_product_price(uuid, numeric, uuid, text, timestamptz)
  to service_role;
