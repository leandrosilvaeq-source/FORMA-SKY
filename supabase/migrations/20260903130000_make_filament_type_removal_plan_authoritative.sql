-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- Rodada corretiva da remoção segura de tipos de filamento (2026-09-03),
-- ANTES de aplicar a migration no Supabase remoto.
--
-- Três problemas resolvidos:
--
-- 1) CONFIRMAÇÃO AUTORITATIVA. A interface escolhia entre "exclusão
--    permanente" e "arquivamento" só olhando se o tipo tinha rolos. Um tipo
--    SEM rolos ainda pode ter movimentações, compras, composição legada ou
--    seleção em pedido finalizado/cancelado — nesses casos a RPC arquiva,
--    mas a interface prometia exclusão permanente. Agora existe uma RPC
--    somente-leitura public.get_filament_type_removal_plan(...) que devolve
--    o plano REAL (PHYSICALLY_DELETED | ARCHIVED | BLOCKED_ACTIVE_ORDER) e
--    todos os contadores/flags que a sustentam. A interface consulta esse
--    plano ANTES de abrir a confirmação.
--
-- 2) PLANO PODE MUDAR ENTRE A CONSULTA E A EXECUÇÃO.
--    public.remove_filament_type(...) ganha um 3º parâmetro
--    p_expected_result. Dentro da transação, DEPOIS de obter o lock, o plano
--    é recalculado e comparado com p_expected_result; se divergiu, nada é
--    alterado e a função levanta FILAMENT_TYPE_REMOVAL_PLAN_CHANGED: — a
--    interface recarrega o plano e pede nova confirmação. Nunca executa uma
--    ação diferente da que o usuário confirmou.
--
-- 3) CONCORRÊNCIA COM NOVAS REFERÊNCIAS.
--    O ponto único de serialização é a LINHA public.filament_types do tipo:
--      - remove_filament_type  -> SELECT ... FOR UPDATE (já existia);
--      - create_filament_spool -> SELECT ... FOR UPDATE (já existia; também
--        recusa tipo inativo);
--      - register_inventory_purchase (ramo FILAMENT) -> SELECT ... FOR
--        UPDATE no tipo casado (já existia; também recusa casar com tipo
--        inativo via FILAMENT_TYPE_INACTIVE_MATCH:);
--      - create_order (as duas sobrecargas) e
--        update_order_item_production_colors -> a checagem de is_active do
--        filamento passa a ser SELECT ... FOR KEY SHARE (ÚNICA mudança no
--        corpo dessas três funções, feita nesta migration);
--      - toda FK filho -> public.filament_types (filament_spools,
--        filament_movements, order_item_unit_plate_filaments,
--        product_filaments, product_plate_filaments) já pega FOR KEY SHARE
--        na linha pai em cada INSERT.
--    FOR KEY SHARE conflita com o FOR UPDATE de remove_filament_type, então:
--    ou a escrita concorrente termina primeiro (e remove_filament_type
--    enxerga a nova referência — bloqueia por pedido ativo ou recai em
--    ARCHIVED), ou remove_filament_type termina primeiro (e a escrita
--    concorrente falha na checagem de is_active / na FK). Não é um lock
--    unilateral: as duas pontas usam a mesma linha.
--    IMPACTO: enquanto um tipo específico está sendo removido, uma criação/
--    edição de pedido que selecione ESSE tipo (ou uma compra/rolo desse
--    tipo) espera o commit da remoção (sub-milissegundo). Pedidos que não
--    referenciam o tipo não são afetados — não há lock de tabela.
--
-- Migration APPEND-ONLY — não altera nenhuma migration anterior. Nenhuma
-- exclusão em cascata. Nenhum ON DELETE CASCADE. Nenhuma linha dependente
-- (filament_movements, inventory_purchases, product_filaments,
-- product_plate_filaments, order_item_unit_plate_filaments) é apagada.
-- Pedidos DELIVERED/CANCELLED continuam permitindo o arquivamento; pedidos
-- ativos continuam bloqueando. delete_filament_type continua delegando para
-- a regra única.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- _compute_filament_type_removal_plan — função INTERNA (zero grants).
-- Cálculo PURO e somente-leitura do plano de remoção de um tipo. Não faz
-- checagem de existência nem de usuário (é responsabilidade de quem chama:
-- get_filament_type_removal_plan e remove_filament_type). Não pega nenhum
-- lock — quem precisa de serialização (remove_filament_type) trava a linha
-- do tipo ANTES de chamar esta função.
-- ---------------------------------------------------------------------------
create or replace function public._compute_filament_type_removal_plan(
  p_filament_type_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_order_numbers text[];
  v_spool_count integer;
  v_active_spool_count integer;
  v_has_movements boolean;
  v_has_purchases boolean;
  v_has_product_filaments boolean;
  v_has_product_plate_filaments boolean;
  v_has_order_selection boolean;
  v_planned_result text;
begin
  select
    coalesce(count(*), 0)::integer,
    coalesce(count(*) filter (where is_active), 0)::integer
    into v_spool_count, v_active_spool_count
    from public.filament_spools
    where filament_type_id = p_filament_type_id;

  -- Pedido "ativo" = status NÃO terminal. Estados terminais reais da máquina
  -- de status (orders_order_status_check): DELIVERED, CANCELLED.
  select coalesce(array_agg(distinct o.order_number order by o.order_number), '{}')
    into v_active_order_numbers
    from public.order_item_unit_plate_filaments oiupf
    join public.order_items oi on oi.id = oiupf.order_item_id
    join public.orders o on o.id = oi.order_id
    where oiupf.filament_type_id = p_filament_type_id
      and o.order_status not in ('DELIVERED', 'CANCELLED');

  v_has_movements := exists (
    select 1 from public.filament_movements where filament_type_id = p_filament_type_id
  );
  v_has_purchases := exists (
    select 1 from public.inventory_purchases
    where category = 'FILAMENT' and item_id = p_filament_type_id
  );
  v_has_product_filaments := exists (
    select 1 from public.product_filaments where filament_type_id = p_filament_type_id
  );
  v_has_product_plate_filaments := exists (
    select 1 from public.product_plate_filaments where filament_type_id = p_filament_type_id
  );
  v_has_order_selection := exists (
    select 1 from public.order_item_unit_plate_filaments where filament_type_id = p_filament_type_id
  );

  if array_length(v_active_order_numbers, 1) is not null then
    v_planned_result := 'BLOCKED_ACTIVE_ORDER';
  elsif v_spool_count = 0
    and not v_has_movements
    and not v_has_purchases
    and not v_has_product_filaments
    and not v_has_product_plate_filaments
    and not v_has_order_selection then
    v_planned_result := 'PHYSICALLY_DELETED';
  else
    v_planned_result := 'ARCHIVED';
  end if;

  return jsonb_build_object(
    'planned_result', v_planned_result,
    'spool_count', v_spool_count,
    'active_spool_count', v_active_spool_count,
    'active_order_numbers', to_jsonb(v_active_order_numbers),
    'has_movements', v_has_movements,
    'has_purchases', v_has_purchases,
    'has_product_filaments', v_has_product_filaments,
    'has_product_plate_filaments', v_has_product_plate_filaments,
    'has_order_selection', v_has_order_selection
  );
end;
$$;

comment on function public._compute_filament_type_removal_plan(uuid) is
  'INTERNA (zero grants). Cálculo puro/somente-leitura do plano de remoção de um tipo de filamento: planned_result (PHYSICALLY_DELETED sem nenhuma referência; ARCHIVED com qualquer referência; BLOCKED_ACTIVE_ORDER quando selecionado em pedido de status não terminal) + spool_count, active_spool_count, active_order_numbers e as flags has_movements/has_purchases/has_product_filaments/has_product_plate_filaments/has_order_selection. Não checa existência nem usuário nem pega lock — responsabilidade de quem chama (get_filament_type_removal_plan, remove_filament_type).';

revoke execute on function public._compute_filament_type_removal_plan(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_filament_type_removal_plan — RPC somente-leitura, consumida pela
-- interface (via Edge Function `filament-types`, rota
-- GET /filament-types/:id/removal-plan) ANTES de abrir a confirmação.
-- ---------------------------------------------------------------------------
create or replace function public.get_filament_type_removal_plan(
  p_filament_type_id uuid,
  p_changed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_user(p_changed_by);

  if not exists (select 1 from public.filament_types where id = p_filament_type_id) then
    raise exception 'filament_types.id % não encontrado', p_filament_type_id;
  end if;

  return public._compute_filament_type_removal_plan(p_filament_type_id);
end;
$$;

comment on function public.get_filament_type_removal_plan(uuid, uuid) is
  'Planejamento AUTORITATIVO e somente-leitura da remoção de um tipo de filamento (2026-09-03). Devolve o mesmo jsonb de _compute_filament_type_removal_plan. A interface consulta esta RPC antes de abrir a confirmação: PHYSICALLY_DELETED -> confirmação de exclusão permanente; ARCHIVED -> confirmação de remoção lógica com preservação de histórico; BLOCKED_ACTIVE_ORDER -> mensagem de bloqueio, sem confirmação destrutiva. Não altera nada.';

revoke execute on function public.get_filament_type_removal_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_filament_type_removal_plan(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- remove_filament_type — nova assinatura (uuid, uuid, text). A antiga
-- (uuid, uuid) da migration 20260903120000 é REMOVIDA para não deixar
-- sobrecarga ambígua quando a Edge Function chama com argumentos nomeados.
-- ---------------------------------------------------------------------------
drop function if exists public.remove_filament_type(uuid, uuid);

create or replace function public.remove_filament_type(
  p_filament_type_id uuid,
  p_changed_by uuid,
  p_expected_result text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_planned_result text;
  v_active_order_numbers text[];
  v_archived_spool_count integer := 0;
begin
  perform public.assert_active_user(p_changed_by);

  if p_expected_result is not null
     and p_expected_result not in ('PHYSICALLY_DELETED', 'ARCHIVED') then
    raise exception
      'remove_filament_type: p_expected_result inválido: % (esperado PHYSICALLY_DELETED, ARCHIVED ou null)',
      p_expected_result;
  end if;

  -- Trava a linha do tipo por TODA a transação — ponto único de
  -- serialização (ver cabeçalho da migration). Todo caminho concorrente que
  -- criaria uma referência a este tipo (novo rolo, nova compra, nova seleção
  -- de pedido, ou qualquer INSERT com FK para filament_types) pega FOR
  -- UPDATE / FOR KEY SHARE nesta MESMA linha e, portanto, ou espera este
  -- commit ou já terminou antes deste SELECT.
  perform 1 from public.filament_types where id = p_filament_type_id for update;
  if not found then
    raise exception 'filament_types.id % não encontrado', p_filament_type_id;
  end if;

  -- Recalcula o plano DEPOIS do lock: entre este ponto e o commit nenhuma
  -- dependência nova pode surgir.
  v_plan := public._compute_filament_type_removal_plan(p_filament_type_id);
  v_planned_result := v_plan ->> 'planned_result';

  if v_planned_result = 'BLOCKED_ACTIVE_ORDER' then
    select array_agg(t.order_number order by t.order_number)
      into v_active_order_numbers
      from jsonb_array_elements_text(v_plan -> 'active_order_numbers') as t(order_number);
    raise exception
      'FILAMENT_TYPE_IN_ACTIVE_ORDER: Este tipo de filamento está sendo utilizado por pedido(s) ativo(s) e não pode ser removido. Pedido(s): %.',
      array_to_string(v_active_order_numbers, ', ');
  end if;

  -- Guard de divergência: se o usuário confirmou um resultado e o plano
  -- real (recalculado sob lock) é outro, NÃO executa nada. p_expected_result
  -- null = caminho de compatibilidade (delete_filament_type), que adota o
  -- plano corrente sem esse guard.
  if p_expected_result is not null and v_planned_result <> p_expected_result then
    raise exception
      'FILAMENT_TYPE_REMOVAL_PLAN_CHANGED: O plano de remoção mudou desde a conferência (agora: %). Recarregue as informações e confirme novamente.',
      v_planned_result;
  end if;

  if v_planned_result = 'PHYSICALLY_DELETED' then
    -- Nenhuma referência de nenhum tipo -> exclusão física definitiva da
    -- única linha do tipo. Se, por uma corrida improvável, uma FK tiver
    -- surgido apesar do lock, o ON DELETE RESTRICT aborta a transação
    -- inteira aqui (nunca gera órfão).
    delete from public.filament_types where id = p_filament_type_id;
    return jsonb_build_object('result', 'PHYSICALLY_DELETED', 'archived_spool_count', 0);
  end if;

  -- ARCHIVED — arquivamento atômico na mesma transação: todos os rolos
  -- ativos do tipo e o próprio tipo -> is_active = false. Nenhuma linha
  -- dependente é apagada, nenhum snapshot alterado.
  update public.filament_spools
    set is_active = false
    where filament_type_id = p_filament_type_id
      and is_active;
  get diagnostics v_archived_spool_count = row_count;

  update public.filament_types
    set is_active = false
    where id = p_filament_type_id;

  return jsonb_build_object('result', 'ARCHIVED', 'archived_spool_count', v_archived_spool_count);
end;
$$;

comment on function public.remove_filament_type(uuid, uuid, text) is
  'Remoção segura e transacional de um tipo de filamento (2026-09-03, revisada). Trava a linha do tipo (FOR UPDATE) e recalcula o plano sob lock via _compute_filament_type_removal_plan. BLOCKED_ACTIVE_ORDER -> FILAMENT_TYPE_IN_ACTIVE_ORDER: (409, sem UUID, com números de pedido). p_expected_result (PHYSICALLY_DELETED|ARCHIVED) é o resultado que o usuário confirmou: se divergir do plano recalculado -> FILAMENT_TYPE_REMOVAL_PLAN_CHANGED: e nada muda. p_expected_result null = caminho de compatibilidade (delete_filament_type), adota o plano corrente. PHYSICALLY_DELETED -> DELETE só da linha do tipo. ARCHIVED -> tipo e todos os rolos ativos com is_active=false, sem apagar dependências, sem cascata. Retorno jsonb { result, archived_spool_count }.';

revoke execute on function public.remove_filament_type(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.remove_filament_type(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- delete_filament_type — mesma assinatura (uuid, uuid) returns void, agora
-- delega para a sobrecarga de 3 args com p_expected_result = null (adota o
-- plano corrente, sem guard de divergência). Continua sujeita ao bloqueio
-- por pedido ativo.
-- ---------------------------------------------------------------------------
create or replace function public.delete_filament_type(
  p_filament_type_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.remove_filament_type(p_filament_type_id, p_changed_by, null);
end;
$$;

comment on function public.delete_filament_type(uuid, uuid) is
  'COMPATIBILIDADE: delega para remove_filament_type(uuid, uuid, text) com p_expected_result = null (2026-09-03). Não levanta mais FILAMENT_TYPE_HAS_SPOOLS:/FILAMENT_TYPE_HAS_COMPOSITION:. Retorno void mantém a assinatura antiga; o jsonb estruturado é descartado.';

revoke execute on function public.delete_filament_type(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_filament_type(uuid, uuid) to service_role;

-- =============================================================================
-- SERIALIZAÇÃO DAS SELEÇÕES DE FILAMENTO EM PEDIDO
--
-- create_order (sobrecargas de 10 e 11 args) e
-- update_order_item_production_colors são REDEFINIDAS abaixo com CREATE OR
-- REPLACE (assinaturas idênticas — nenhum DROP necessário; grants e
-- comentários existentes são preservados). ÚNICA mudança em cada corpo: a
-- linha
--     select is_active into v_is_active from public.filament_types
--       where id = v_filament_type_id;
-- passa a terminar em "... for key share;" — a checagem de filamento ativo
-- passa a segurar a linha do tipo até o fim da transação, serializando
-- contra remove_filament_type. Toda a demais lógica (incluindo a exceção
-- para uma seleção que já existia antes, em
-- update_order_item_production_colors) é idêntica. Corpos conferidos linha a
-- linha contra 20260829180000_add_categories_plate_weight_and_order_colors.sql.
-- =============================================================================

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
  v_initial_status text;
  v_quantity integer;
  v_plate jsonb;
  v_order_item_plate_id uuid;
  v_color jsonb;
  v_filament_type_id uuid;
  v_unit_number integer;
  v_is_active boolean;
begin
  perform public.assert_active_user(p_changed_by);

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order exige ao menos um item em p_items';
  end if;

  v_initial_status := public.determine_order_initial_status(p_items);
  if v_initial_status = 'IN_PRODUCTION_QUEUE' then
    perform public.validate_catalog_production_structure_for_creation(p_items);
  end if;

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
    v_initial_status, 'WAITING_PAYMENT',
    p_expected_delivery_date, p_delivery_method,
    coalesce(p_shipping_cost, 0), coalesce(p_discount_value, 0), p_notes
  )
  returning id into v_order_id;

  insert into public.order_status_history (
    order_id, from_status, to_status, changed_by, reason
  ) values (
    v_order_id, null, v_initial_status, p_changed_by,
    case when v_initial_status = 'IN_PRODUCTION_QUEUE'
      then 'Pedido criado — só itens de Catálogo/Spot, enviado direto para a Fila de produção'
      else 'Pedido criado'
    end
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item ->> 'item_type';
    v_quantity := (v_item ->> 'quantity')::integer;

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
      v_quantity,
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

    elsif v_item_type = 'CATALOG' then
      -- Snapshot congelado dos plates ATUAIS do Produto — cópia
      -- independente, nunca uma referência viva a product_plates.
      for v_plate in
        select jsonb_build_object(
          'plate_number', plate_number, 'weight_grams', weight_grams,
          'production_time_seconds', production_time_seconds
        )
        from public.product_plates
        where product_id = nullif(v_item ->> 'product_id', '')::uuid
        order by plate_number
      loop
        insert into public.order_item_plates (order_item_id, plate_number, weight_grams, production_time_seconds)
        values (
          v_order_item_id,
          (v_plate ->> 'plate_number')::integer,
          (v_plate ->> 'weight_grams')::numeric,
          (v_plate ->> 'production_time_seconds')::integer
        );
      end loop;

      -- Cores/filamentos por unidade+plate — SEMPRE opcionais na criação
      -- (decisão do usuário: "definidas ao fechar o Pedido" ou depois,
      -- nunca bloqueiam a entrada na Fila). Quando informadas, exigem
      -- filamento ATIVO (é uma criação — não existe seleção "antiga" a
      -- preservar aqui).
      if v_item -> 'production_colors' is not null and jsonb_typeof(v_item -> 'production_colors') = 'array' then
        for v_color in select * from jsonb_array_elements(v_item -> 'production_colors')
        loop
          v_unit_number := (v_color ->> 'unit_number')::integer;
          if v_unit_number is null or v_unit_number < 1 or v_unit_number > v_quantity then
            raise exception 'production_colors: unit_number % fora do intervalo 1..% (quantity do item)', v_unit_number, v_quantity;
          end if;

          select id into v_order_item_plate_id
            from public.order_item_plates
            where order_item_id = v_order_item_id and plate_number = (v_color ->> 'plate_number')::integer;
          if v_order_item_plate_id is null then
            raise exception 'production_colors: plate_number % não existe no snapshot deste item', v_color ->> 'plate_number';
          end if;

          for v_filament_type_id in select value::uuid from jsonb_array_elements_text(coalesce(v_color -> 'filament_type_ids', '[]'::jsonb)) as value
          loop
            select is_active into v_is_active from public.filament_types where id = v_filament_type_id for key share;
            if not found then
              raise exception 'production_colors: filament_types.id % não encontrado', v_filament_type_id;
            end if;
            if not v_is_active then
              raise exception 'production_colors: filament_types.id % está inativo — não pode ser escolhido como seleção nova', v_filament_type_id;
            end if;

            insert into public.order_item_unit_plate_filaments (
              order_item_id, order_item_plate_id, unit_number, filament_type_id, position
            ) values (
              v_order_item_id, v_order_item_plate_id, v_unit_number, v_filament_type_id,
              coalesce(array_position(array(select value::uuid from jsonb_array_elements_text(v_color -> 'filament_type_ids') as value), v_filament_type_id), 1)
            )
            on conflict (order_item_plate_id, unit_number, filament_type_id) do nothing;
          end loop;
        end loop;
      end if;
    end if;
  end loop;

  perform public.recalculate_order_financials(
    v_order_id, p_changed_by, 'Cálculo inicial na criação do pedido'
  );

  return v_order_id;
end;
$$;

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
  v_initial_status text;
  v_quantity integer;
  v_plate jsonb;
  v_order_item_plate_id uuid;
  v_color jsonb;
  v_filament_type_id uuid;
  v_unit_number integer;
  v_is_active boolean;
begin
  perform public.assert_active_user(p_changed_by);

  if p_payment_method is not null and p_payment_method not in ('PIX', 'DINHEIRO', 'CARTAO') then
    raise exception 'p_payment_method inválido: % (permitido: null, PIX, DINHEIRO ou CARTAO)', p_payment_method;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order exige ao menos um item em p_items';
  end if;

  v_initial_status := public.determine_order_initial_status(p_items);
  if v_initial_status = 'IN_PRODUCTION_QUEUE' then
    perform public.validate_catalog_production_structure_for_creation(p_items);
  end if;

  v_lead_source_id := p_lead_source_id;
  if v_lead_source_id is null then
    select acquisition_source_id into v_lead_source_id
      from public.customers
      where id = p_customer_id;
  end if;

  v_order_number := public.next_order_number();

  insert into public.orders (
    order_number, customer_id, company_id, lead_source_id,
    order_status, payment_status, payment_method,
    expected_delivery_date, delivery_method,
    shipping_cost, discount_value, notes
  ) values (
    v_order_number, p_customer_id, p_company_id, v_lead_source_id,
    v_initial_status, 'WAITING_PAYMENT', p_payment_method,
    p_expected_delivery_date, p_delivery_method,
    coalesce(p_shipping_cost, 0), coalesce(p_discount_value, 0), p_notes
  )
  returning id into v_order_id;

  insert into public.order_status_history (
    order_id, from_status, to_status, changed_by, reason
  ) values (
    v_order_id, null, v_initial_status, p_changed_by,
    case when v_initial_status = 'IN_PRODUCTION_QUEUE'
      then 'Pedido criado — só itens de Catálogo/Spot, enviado direto para a Fila de produção'
      else 'Pedido criado'
    end
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item ->> 'item_type';
    v_quantity := (v_item ->> 'quantity')::integer;

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
      v_quantity,
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

    elsif v_item_type = 'CATALOG' then
      for v_plate in
        select jsonb_build_object(
          'plate_number', plate_number, 'weight_grams', weight_grams,
          'production_time_seconds', production_time_seconds
        )
        from public.product_plates
        where product_id = nullif(v_item ->> 'product_id', '')::uuid
        order by plate_number
      loop
        insert into public.order_item_plates (order_item_id, plate_number, weight_grams, production_time_seconds)
        values (
          v_order_item_id,
          (v_plate ->> 'plate_number')::integer,
          (v_plate ->> 'weight_grams')::numeric,
          (v_plate ->> 'production_time_seconds')::integer
        );
      end loop;

      if v_item -> 'production_colors' is not null and jsonb_typeof(v_item -> 'production_colors') = 'array' then
        for v_color in select * from jsonb_array_elements(v_item -> 'production_colors')
        loop
          v_unit_number := (v_color ->> 'unit_number')::integer;
          if v_unit_number is null or v_unit_number < 1 or v_unit_number > v_quantity then
            raise exception 'production_colors: unit_number % fora do intervalo 1..% (quantity do item)', v_unit_number, v_quantity;
          end if;

          select id into v_order_item_plate_id
            from public.order_item_plates
            where order_item_id = v_order_item_id and plate_number = (v_color ->> 'plate_number')::integer;
          if v_order_item_plate_id is null then
            raise exception 'production_colors: plate_number % não existe no snapshot deste item', v_color ->> 'plate_number';
          end if;

          for v_filament_type_id in select value::uuid from jsonb_array_elements_text(coalesce(v_color -> 'filament_type_ids', '[]'::jsonb)) as value
          loop
            select is_active into v_is_active from public.filament_types where id = v_filament_type_id for key share;
            if not found then
              raise exception 'production_colors: filament_types.id % não encontrado', v_filament_type_id;
            end if;
            if not v_is_active then
              raise exception 'production_colors: filament_types.id % está inativo — não pode ser escolhido como seleção nova', v_filament_type_id;
            end if;

            insert into public.order_item_unit_plate_filaments (
              order_item_id, order_item_plate_id, unit_number, filament_type_id, position
            ) values (
              v_order_item_id, v_order_item_plate_id, v_unit_number, v_filament_type_id,
              coalesce(array_position(array(select value::uuid from jsonb_array_elements_text(v_color -> 'filament_type_ids') as value), v_filament_type_id), 1)
            )
            on conflict (order_item_plate_id, unit_number, filament_type_id) do nothing;
          end loop;
        end loop;
      end if;
    end if;
  end loop;

  perform public.recalculate_order_financials(
    v_order_id, p_changed_by, 'Cálculo inicial na criação do pedido'
  );

  return v_order_id;
end;
$$;

create or replace function public.update_order_item_production_colors(
  p_order_id uuid,
  p_selections jsonb,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_old_keys text[];
  v_sel jsonb;
  v_order_item_id uuid;
  v_plate_number integer;
  v_unit_number integer;
  v_order_item_plate_id uuid;
  v_item_order_id uuid;
  v_item_type text;
  v_item_quantity integer;
  v_filament_type_id uuid;
  v_is_active boolean;
  v_tuple_key text;
begin
  perform public.assert_active_user(p_changed_by);

  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then
    raise exception 'p_selections deve ser um array';
  end if;

  select order_status into v_order_status from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;
  -- Allow-list explícita (nunca uma lista de bloqueio) — só os 4 estados
  -- anteriores ao início real da produção permitem editar cores; qualquer
  -- outro status (IN_PRODUCTION, WAITING_DELIVERY, DELIVERED, CANCELLED, ou
  -- um status futuro ainda não previsto) é bloqueado por padrão.
  if v_order_status not in ('QUOTE', 'WAITING_APPROVAL', 'APPROVED', 'IN_PRODUCTION_QUEUE') then
    raise exception 'ORDER_PRODUCTION_COLORS_FROZEN: A configuração de cores foi congelada ao iniciar a produção (status atual: %).', v_order_status;
  end if;

  select coalesce(array_agg(
    opucf.order_item_plate_id::text || ':' || opucf.unit_number::text || ':' || opucf.filament_type_id::text
  ), '{}')
    into v_old_keys
    from public.order_item_unit_plate_filaments opucf
    join public.order_items oi on oi.id = opucf.order_item_id
    where oi.order_id = p_order_id;

  delete from public.order_item_unit_plate_filaments
    where order_item_id in (select id from public.order_items where order_id = p_order_id);

  for v_sel in select * from jsonb_array_elements(p_selections)
  loop
    v_order_item_id := nullif(v_sel ->> 'order_item_id', '')::uuid;
    v_plate_number := (v_sel ->> 'plate_number')::integer;
    v_unit_number := (v_sel ->> 'unit_number')::integer;

    select order_id, item_type, quantity into v_item_order_id, v_item_type, v_item_quantity
      from public.order_items where id = v_order_item_id;

    if v_item_order_id is null or v_item_order_id <> p_order_id or v_item_type <> 'CATALOG' then
      raise exception 'order_item_id % não pertence a este pedido ou não é CATALOG', v_order_item_id;
    end if;

    if v_unit_number is null or v_unit_number < 1 or v_unit_number > v_item_quantity then
      raise exception 'unit_number % fora do intervalo 1..% (quantity do item)', v_unit_number, v_item_quantity;
    end if;

    select id into v_order_item_plate_id
      from public.order_item_plates
      where order_item_id = v_order_item_id and plate_number = v_plate_number;
    if v_order_item_plate_id is null then
      raise exception 'plate_number % não existe no snapshot do item %', v_plate_number, v_order_item_id;
    end if;

    for v_filament_type_id in select value::uuid from jsonb_array_elements_text(coalesce(v_sel -> 'filament_type_ids', '[]'::jsonb)) as value
    loop
      v_tuple_key := v_order_item_plate_id::text || ':' || v_unit_number::text || ':' || v_filament_type_id::text;

      select is_active into v_is_active from public.filament_types where id = v_filament_type_id for key share;
      if not found then
        raise exception 'filament_types.id % não encontrado', v_filament_type_id;
      end if;
      if not v_is_active and not (v_tuple_key = any(v_old_keys)) then
        raise exception 'filament_types.id % está inativo — não pode ser escolhido como seleção nova', v_filament_type_id;
      end if;

      insert into public.order_item_unit_plate_filaments (
        order_item_id, order_item_plate_id, unit_number, filament_type_id, position
      ) values (
        v_order_item_id, v_order_item_plate_id, v_unit_number, v_filament_type_id, 1
      )
      on conflict (order_item_plate_id, unit_number, filament_type_id) do nothing;
    end loop;
  end loop;
end;
$$;
