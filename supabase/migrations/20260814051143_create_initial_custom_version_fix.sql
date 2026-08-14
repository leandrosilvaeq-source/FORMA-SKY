-- Bloco 1 — Clientes e Pedidos
-- Migration 17: correção — versão inicial de item CUSTOM sem linha em custom_versions
--
-- Problema encontrado durante o planejamento dos testes de integração: ao
-- criar um item CUSTOM, create_order() e add_order_item() (Migration 15)
-- gravavam custom_item_details.current_version como texto solto (ex.:
-- 'v1.0'), sem nunca inserir a linha correspondente em custom_versions.
-- Consequência: register_approval() para CUSTOM exige um custom_version_id
-- apontando para uma linha real em custom_versions — sem essa linha, era
-- estruturalmente impossível aprovar a versão inicial de qualquer item
-- CUSTOM. Verificação somente leitura confirmou zero itens CUSTOM
-- persistidos no banco remoto até este momento — nenhum dado real afetado.
--
-- Esta migration usa CREATE OR REPLACE FUNCTION com as assinaturas atuais
-- de create_order() e add_order_item(), alterando só a lógica descrita
-- acima. register_custom_version() não é tocada — continua responsável
-- somente pelas versões seguintes (v1.1 em diante). Nenhuma outra tabela,
-- função, grant, revoke ou trigger é criada/alterada.

-- ---------------------------------------------------------------------------
-- create_order (só o ramo CUSTOM do loop de itens foi alterado)
-- ---------------------------------------------------------------------------
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

      -- CORREÇÃO: garante que current_version tenha uma linha real
      -- correspondente em custom_versions antes da função concluir — sem
      -- isso, register_approval() nunca teria um custom_version_id válido
      -- para aprovar a versão inicial. file_id fica NULL: o payload
      -- custom_details atual (documentado no topo da Migration 15) não
      -- inclui um file_id inicial — sinalizado aqui, não resolvido nesta
      -- correção (fora do escopo pedido).
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

comment on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid) is
  'Cria um pedido com um ou mais itens (CUSTOM/SPOT/CATALOG) na mesma transação. Gera order_number via next_order_number(), herda lead_source_id de customers.acquisition_source_id quando não informado, e chama recalculate_order_financials() ao final. Item CUSTOM sempre nasce com uma linha correspondente em custom_versions (version_number = current_version, change_type = INITIAL).';

-- Grants preservados exatamente como na Migration 15 (CREATE OR REPLACE não
-- altera privilégios existentes, mas reafirmamos por clareza/idempotência).
revoke execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- add_order_item (mesma correção, só o ramo CUSTOM foi alterado)
-- ---------------------------------------------------------------------------
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

    -- CORREÇÃO: mesma lógica aplicada em create_order acima.
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
  'Adiciona um item a um pedido existente (mesmo formato de payload jsonb de create_order). Item CUSTOM sempre nasce com uma linha correspondente em custom_versions (version_number = current_version, change_type = INITIAL). Bloqueado a partir de IN_PRODUCTION.';

revoke execute on function public.add_order_item(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.add_order_item(uuid, jsonb, uuid) to service_role;
