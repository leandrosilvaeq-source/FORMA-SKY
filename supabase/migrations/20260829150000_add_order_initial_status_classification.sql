-- Bloco 1 — Pedidos
-- Migration: status inicial automático de Pedidos NOVOS conforme a
-- composição de itens (regra aprovada pelo usuário em 2026-08-29, ver
-- docs/05_ROADMAP_MODULOS.md).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada). Aplicar exige autorização
-- explícita separada, fora do escopo desta entrada.
--
-- REGRA (só se aplica à CRIAÇÃO de um Pedido novo — nunca à edição de um
-- Pedido existente):
--   - conjunto de itens vazio: já rejeitado hoje (create_order exige ao
--     menos 1 item) — não alterado por esta migration.
--   - todos os itens são CATALOG e/ou SPOT (nenhum CUSTOM): o pedido nasce
--     diretamente em IN_PRODUCTION_QUEUE — pula QUOTE/WAITING_APPROVAL/
--     APPROVED por completo. Só um registro de order_status_history é
--     criado (from_status=null, to_status=IN_PRODUCTION_QUEUE) — nenhum
--     histórico intermediário fictício de QUOTE/WAITING_APPROVAL/APPROVED,
--     nenhuma approval fictícia.
--   - existe ao menos um item CUSTOM: comportamento ATUAL preservado
--     integralmente — o pedido nasce em QUOTE, com o fluxo normal de
--     Orçamento/Aprovação (change_order_status, register_approval,
--     try_auto_approve_order — nenhuma delas é tocada por esta migration).
--   - item_type desconhecido (fora de CATALOG/SPOT/CUSTOM): rejeitado antes
--     de qualquer escrita — já coberto estruturalmente pela CHECK de
--     order_items (Migration 8), mas agora também detectado ANTES do INSERT
--     pela nova função determine_order_initial_status(), com uma mensagem
--     mais clara.
--
-- Cada item CATALOG do pedido precisa ter product_id apontando para um
-- Produto de Catálogo REAL com ao menos uma linha em product_filaments —
-- mas só quando o resultado da classificação acima for IN_PRODUCTION_QUEUE
-- (nenhum CUSTOM no pedido). DECISÃO DE ESCOPO (interpretação necessária,
-- documentada explicitamente): um pedido CATALOG+CUSTOM continua seguindo o
-- fluxo normal de QUOTE (regra 4 do pedido do usuário, "mantém o fluxo
-- normal de Orçamento e Aprovação") — não ganha nenhuma exigência nova de
-- composição de filamento, porque (a) a mensagem de bloqueio sugerida pelo
-- usuário ("Não foi possível enviar o pedido para a Fila de produção...")
-- só faz sentido para um pedido que de fato tentaria ir para a Fila; (b) um
-- pedido CATALOG+CUSTOM nunca foi, nem antes nem depois desta migration,
-- automaticamente enviado à Fila de produção — continua exigindo aprovação
-- manual do item CUSTOM antes de chegar lá, via change_order_status; (c)
-- exigir composição de filamento HOJE para um item CATALOG que só vai
-- avançar bem mais tarde no fluxo normal seria uma restrição nova não
-- pedida, adicionada por conta própria. Itens SPOT nunca passam por esta
-- checagem (não têm product_id — já garantido pela CHECK
-- order_items_product_id_matches_item_type, Migration 8). Itens CUSTOM
-- mantêm exatamente as validações já existentes (custom_details
-- obrigatório) — nenhuma delas é alterada.
--
-- CORREÇÃO INCLUÍDA NESTA MESMA MIGRATION (2026-08-29, rodada seguinte à
-- criação original acima, decisão explícita do usuário): "o tempo de
-- pesquisa/modelagem de itens SPOT não deverá ser considerado para entrada
-- na Fila de produção". A rodada original desta migration tinha registrado
-- (parágrafo abaixo, mantido como histórico da auditoria que motivou a
-- correção) um GAP encontrado mas deliberadamente não fechado: o gate de
-- SPOT em change_order_status() (Migration 15) — "nenhum item SPOT pode
-- entrar em IN_PRODUCTION_QUEUE sem search_time_status = RECORDED" — só era
-- checado na TRANSIÇÃO via change_order_status(), nunca na criação direta
-- desta migration; isso deixava a regra de admissão à Fila INCONSISTENTE
-- entre "pedido novo" (sem checagem) e "pedido existente avançando"
-- (com checagem). O usuário decidiu que a checagem em si nunca deveria
-- existir — não que a criação direta devesse passar a replicá-la. Por
-- isso, nesta correção, o bloco inteiro que fazia essa checagem foi
-- REMOVIDO de change_order_status() (Seção 5 abaixo) — nenhum código foi
-- adicionado a create_order()/determine_order_initial_status() para
-- replicá-la. Resultado: SPOT (novo ou existente avançando) nunca mais
-- depende de search_time_status em nenhum ponto do sistema.
-- spot_item_details.search_time_status/search_minutes CONTINUAM existindo,
-- com o mesmo CHECK de consistência da própria tabela (RECORDED exige
-- search_minutes preenchido — regra de integridade do dado, não um gate de
-- produção) — passam a ser só informativos/históricos. Na prática, hoje,
-- itens SPOT ainda não são criáveis pelo frontend (OrderForm.tsx mantém
-- "Personalizado"/"Spot" desabilitados como "Em breve"), então esta
-- correção é estrutural mas ainda não exercitável pela interface atual —
-- fica pronta para quando SPOT for habilitado.
--
-- Registro histórico do achado original (motivo da correção acima, não
-- mais um gap aberto): "um Pedido SPOT-only (ou CATALOG+SPOT) criado
-- diretamente já em IN_PRODUCTION_QUEUE nunca passava por
-- change_order_status() na criação, então nascia sem a checagem de tempo
-- — só uma transição de um pedido já existente é que passava por ela."
--
-- IMPACTO CONFIRMADO NO FLUXO DE EDIÇÃO (auditado, não corrigido por não
-- ter sido pedido): update_quote_order() (20260821031143) só edita pedidos
-- em order_status = 'QUOTE'. A partir desta migration, um pedido só-
-- CATALOG/SPOT recém-criado nunca estará em QUOTE — logo "Alterar pedido"
-- (OrderEditForm.tsx) abrirá em modo somente leitura para ele, com a
-- mensagem já existente 'Este pedido está em "..." — nesta versão, só
-- pedidos em Orçamento (QUOTE) podem ser totalmente editados.' — esse
-- comportamento JÁ EXISTE hoje para qualquer pedido fora de QUOTE (ex.: um
-- pedido que avançou manualmente); esta migration só faz mais pedidos
-- caírem nesse caminho já tratado, sem exigir nenhuma mudança de código no
-- frontend.
--
-- INTERAÇÃO COM RESERVA/CONGELAMENTO FUTUROS (Incremento 6B, ainda não
-- implementado, nenhuma linha de código criada aqui): quando a composição
-- de um produto for CONGELADA e a RESERVA de filamento passar a acontecer
-- no momento em que um pedido entra em IN_PRODUCTION_QUEUE (decisão já
-- registrada em rodadas anteriores do roadmap), create_order() TAMBÉM
-- precisará participar desse mecanismo atômico para os pedidos que esta
-- migration cria JÁ diretamente em IN_PRODUCTION_QUEUE — não é suficiente
-- que só change_order_status() (a transição QUEUE-normal) trate reserva; a
-- criação direta não pode contornar esse congelamento/reserva quando o 6B
-- existir. Nenhuma reserva ou consumo é implementado agora — só o status
-- operacional muda; nenhuma baixa de estoque acontece em nenhum momento
-- desta migration.
--
-- Pedidos JÁ EXISTENTES nunca são tocados por esta migration (nenhum
-- UPDATE em orders/order_items/order_status_history é executado aqui — só
-- CREATE OR REPLACE FUNCTION). Nenhuma promoção automática de pedido
-- antigo.

-- =============================================================================
-- 1) determine_order_initial_status — classifica o status inicial a partir
--    só do array de itens (nenhum acesso a tabela: função pura). Centraliza
--    a regra lógica (Passo 3 do pedido do usuário) num único lugar,
--    reutilizado pelas duas sobrecargas de create_order() abaixo — nunca
--    duplicado como texto solto dentro de cada uma.
-- =============================================================================
create or replace function public.determine_order_initial_status(p_items jsonb)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_item_type text;
  v_has_custom boolean := false;
  v_count integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'determine_order_initial_status: p_items deve ser um array jsonb';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    v_item_type := v_item ->> 'item_type';

    if v_item_type not in ('CATALOG', 'SPOT', 'CUSTOM') then
      raise exception 'Tipo de item desconhecido em p_items: %', coalesce(v_item_type, 'null');
    end if;

    if v_item_type = 'CUSTOM' then
      v_has_custom := true;
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'determine_order_initial_status exige ao menos um item';
  end if;

  if v_has_custom then
    return 'QUOTE';
  else
    return 'IN_PRODUCTION_QUEUE';
  end if;
end;
$$;

comment on function public.determine_order_initial_status(jsonb) is
  'Classifica o status inicial de um Pedido NOVO a partir só do array de itens (p_items, mesmo formato de create_order): QUOTE se existir ao menos um item CUSTOM, IN_PRODUCTION_QUEUE se todos os itens forem CATALOG e/ou SPOT. Rejeita item_type desconhecido e array vazio. Função pura (nenhum acesso a tabela) — chamada de dentro das duas sobrecargas de create_order(), nunca diretamente pelo frontend/Sky. Nunca usada para reclassificar um pedido já existente.';

-- Função interna: nenhum EXECUTE concedido a ninguém, nem service_role —
-- mesmo padrão de assert_active_user/jsonb_whitelist (Migration 15): só
-- chamável de dentro de outra função SECURITY DEFINER do mesmo owner, que
-- já assume a identidade do owner ao executar (proowner com EXECUTE
-- implícito sobre seus próprios objetos, independente de REVOKE/GRANT
-- explícitos).
revoke execute on function public.determine_order_initial_status(jsonb)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- 2) validate_catalog_composition_for_creation — valida TODOS os itens
--    CATALOG de um pedido novo antes de qualquer escrita definitiva (Passo
--    4 do pedido do usuário): product_id obrigatório, Produto precisa
--    existir E corresponder ao item selecionado (product_type = 'CATALOG'),
--    Produto precisa ter ao menos uma linha em product_filaments. Se mais
--    de um Produto estiver sem composição, todos aparecem, deduplicados por
--    nome, numa única mensagem. SPOT/CUSTOM não passam por aqui (SPOT nunca
--    tem product_id; CUSTOM mantém suas validações próprias, inalteradas).
--    Só chamada quando determine_order_initial_status() já decidiu
--    IN_PRODUCTION_QUEUE (nenhum CUSTOM no pedido) — ver nota de escopo no
--    cabeçalho desta migration.
-- =============================================================================
create or replace function public.validate_catalog_composition_for_creation(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_item_type text;
  v_product_id uuid;
  v_product_name text;
  v_product_type text;
  v_has_composition boolean;
  v_missing_names text[] := '{}';
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item ->> 'item_type';
    if v_item_type <> 'CATALOG' then
      continue;
    end if;

    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    if v_product_id is null then
      raise exception 'Item CATALOG exige product_id';
    end if;

    select name, product_type into v_product_name, v_product_type
      from public.products
      where id = v_product_id;

    if not found or v_product_type <> 'CATALOG' then
      raise exception 'products.id % não encontrado ou não corresponde a um produto de Catálogo', v_product_id;
    end if;

    select exists (
      select 1 from public.product_filaments where product_id = v_product_id
    ) into v_has_composition;

    if not v_has_composition and not (v_product_name = any(v_missing_names)) then
      v_missing_names := v_missing_names || v_product_name;
    end if;
  end loop;

  if array_length(v_missing_names, 1) > 0 then
    raise exception 'ORDER_CATALOG_MISSING_COMPOSITION: Não foi possível enviar o pedido para a Fila de produção. Cadastre a composição de filamentos dos produtos: %.', array_to_string(v_missing_names, ', ');
  end if;
end;
$$;

comment on function public.validate_catalog_composition_for_creation(jsonb) is
  'Valida, para um Pedido novo que nasceria em IN_PRODUCTION_QUEUE (nenhum item CUSTOM), que todo item CATALOG tem product_id apontando para um Produto de Catálogo real com ao menos uma linha em product_filaments. Bloqueia toda a criação (nenhuma escrita ainda ocorreu) e lista, deduplicados por nome, todos os produtos sem composição na mesma mensagem (ORDER_CATALOG_MISSING_COMPOSITION:). Nunca chamada para pedidos com item CUSTOM (fluxo normal de QUOTE, inalterado) nem para editar um pedido existente.';

revoke execute on function public.validate_catalog_composition_for_creation(jsonb)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- 3) create_order — sobrecarga de 10 parâmetros (Migration 17,
--    20260814051143_create_initial_custom_version_fix.sql — versão real
--    atualmente em vigor, conferida integralmente antes desta substituição;
--    preservada por compatibilidade, embora nenhuma Edge Function a chame
--    hoje — ver nota abaixo). Corpo idêntico ao anterior, exceto:
--      (a) chama determine_order_initial_status(p_items) em vez de
--          hardcode 'QUOTE';
--      (b) chama validate_catalog_composition_for_creation(p_items) ANTES
--          de qualquer INSERT, só quando o status determinado for
--          IN_PRODUCTION_QUEUE;
--      (c) usa v_initial_status (em vez do literal 'QUOTE') no INSERT de
--          orders e no primeiro order_status_history.
--    Nenhuma outra linha do corpo é alterada.
--
--    NOTA SOBRE ESTA SOBRECARGA ESTAR "MORTA": auditado nesta rodada que
--    nenhuma Edge Function chama create_order com 10 argumentos hoje — a
--    Edge Function `orders` sempre envia p_payment_method nomeado (rota
--    POST /orders) e create_order_with_payment() sempre chama a versão de
--    11 parâmetros posicionalmente. Mesmo assim, esta função permanece
--    aplicada/atualizada por precaução e consistência com o restante do
--    projeto (ex.: a correção de custom_versions na Migration 17 também
--    atualizou as DUAS sobrecargas de uma vez) — deixar uma sobrecarga
--    viva, mas com a regra de negócio antiga, seria uma inconsistência
--    silenciosa no schema.
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
begin
  perform public.assert_active_user(p_changed_by);

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order exige ao menos um item em p_items';
  end if;

  -- Classificação do status inicial + validação de composição CATALOG,
  -- ANTES de qualquer INSERT — nenhuma escrita parcial possível se a
  -- classificação ou a composição rejeitarem o pedido.
  v_initial_status := public.determine_order_initial_status(p_items);
  if v_initial_status = 'IN_PRODUCTION_QUEUE' then
    perform public.validate_catalog_composition_for_creation(p_items);
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
    -- CATALOG: nenhuma tabela satélite; product_id/composição já validados
    -- acima (quando o pedido nasce em IN_PRODUCTION_QUEUE) ou é o mesmo
    -- comportamento de sempre (quando há CUSTOM no pedido).
  end loop;

  perform public.recalculate_order_financials(
    v_order_id, p_changed_by, 'Cálculo inicial na criação do pedido'
  );

  return v_order_id;
end;
$$;

comment on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid) is
  'Cria um pedido com um ou mais itens (CUSTOM/SPOT/CATALOG) na mesma transação. Status inicial determinado por determine_order_initial_status(): QUOTE se houver item CUSTOM (fluxo normal preservado), IN_PRODUCTION_QUEUE se só houver CATALOG/SPOT (após validate_catalog_composition_for_creation() confirmar que todo item CATALOG tem composição de filamentos). Gera order_number via next_order_number(), herda lead_source_id de customers.acquisition_source_id quando não informado, e chama recalculate_order_financials() ao final. Item CUSTOM sempre nasce com uma linha correspondente em custom_versions (version_number = current_version, change_type = INITIAL). Nunca reclassifica um pedido já existente.';

revoke execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid)
  to service_role;

-- =============================================================================
-- 4) create_order — sobrecarga de 11 parâmetros, com p_payment_method
--    (Migration 20260821014342_extend_order_summary_and_payment_method.sql —
--    versão real atualmente em vigor, conferida integralmente antes desta
--    substituição; é esta sobrecarga que a Edge Function `orders` (rota
--    POST /orders) e create_order_with_payment() efetivamente chamam hoje).
--    Mesmas três mudanças da sobrecarga de 10 parâmetros acima — nenhuma
--    outra linha do corpo é alterada.
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

  -- Classificação do status inicial + validação de composição CATALOG,
  -- ANTES de qualquer INSERT — nenhuma escrita parcial possível se a
  -- classificação ou a composição rejeitarem o pedido.
  v_initial_status := public.determine_order_initial_status(p_items);
  if v_initial_status = 'IN_PRODUCTION_QUEUE' then
    perform public.validate_catalog_composition_for_creation(p_items);
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
    -- CATALOG: nenhuma tabela satélite; product_id/composição já validados
    -- acima (quando o pedido nasce em IN_PRODUCTION_QUEUE) ou é o mesmo
    -- comportamento de sempre (quando há CUSTOM no pedido).
  end loop;

  perform public.recalculate_order_financials(
    v_order_id, p_changed_by, 'Cálculo inicial na criação do pedido'
  );

  return v_order_id;
end;
$$;

comment on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text) is
  'Sobrecarga de 11 parâmetros de create_order (com p_payment_method), efetivamente chamada hoje pela Edge Function `orders` (POST /orders) e por create_order_with_payment(). Status inicial determinado por determine_order_initial_status(): QUOTE se houver item CUSTOM (fluxo normal preservado), IN_PRODUCTION_QUEUE se só houver CATALOG/SPOT (após validate_catalog_composition_for_creation() confirmar que todo item CATALOG tem composição de filamentos). Valida e persiste payment_method (null ou PIX/DINHEIRO/CARTAO) no mesmo INSERT. Item CUSTOM sempre nasce com uma linha correspondente em custom_versions. Nunca reclassifica um pedido já existente.';

revoke execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text)
  to service_role;

-- =============================================================================
-- 5) change_order_status — CORREÇÃO ADICIONADA NESTA MESMA MIGRATION AINDA
--    PENDENTE (decisão do usuário, 2026-08-29, rodada seguinte à criação
--    original desta migration): "o tempo de pesquisa/modelagem de itens
--    SPOT não deverá ser considerado para entrada na Fila de produção".
--
--    Corpo idêntico ao real hoje em vigor (Migration 15,
--    20260814030351_create_order_business_functions.sql — conferido
--    integralmente, nunca modificado por nenhuma migration desde então),
--    EXCETO pela remoção completa do bloco:
--        if p_to_status = 'IN_PRODUCTION_QUEUE' then
--          if exists (... sid.search_time_status <> 'RECORDED' ...) then
--            raise exception 'Existe item SPOT com tempo de pesquisa/...';
--          end if;
--        end if;
--    Nenhuma outra linha do corpo é alterada: máquina de transições
--    (sequência linear QUOTE->...->DELIVERED, um passo por vez),
--    autenticação (assert_active_user), changed_by, histórico
--    (order_status_history), cancelamento (CANCELLED só antes de
--    IN_PRODUCTION), aprovações (bloco APPROVED via
--    try_auto_approve_order(), inalterado), auto-aprovação após
--    WAITING_APPROVAL (inalterada), mensagens de erro não relacionadas
--    (inalteradas palavra por palavra) — tudo preservado byte a byte.
--    Nenhuma regra de pagamento existe nesta função (nunca existiu:
--    change_order_status "nunca altera payment_status", comentário já
--    preservado). Nenhuma idempotência própria existe nesta função (ela
--    nunca teve — idempotência é exclusiva de create_order_with_payment,
--    intocada aqui).
--
--    spot_item_details.search_time_status/search_minutes CONTINUAM
--    existindo, com o mesmo CHECK de consistência da tabela
--    (spot_item_details_search_time_consistency, Migration 10, não tocada
--    por esta migration: RECORDED ainda exige search_minutes preenchido —
--    isso é uma regra de INTEGRIDADE DO PRÓPRIO DADO, não um gate de
--    produção, e continua válida) — o campo passa a ser só informativo e
--    histórico, nunca mais lido por change_order_status(). Nenhuma coluna,
--    tabela, dado ou tempo já registrado é apagado por esta migration.
-- =============================================================================
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

  -- Gate de SPOT (search_time_status <> RECORDED) REMOVIDO nesta migration
  -- (decisão do usuário, 2026-08-29): o tempo de pesquisa/modelagem de
  -- itens SPOT não é mais considerado para entrada na Fila de produção, em
  -- nenhuma transição. Nenhum outro gate de IN_PRODUCTION_QUEUE existia
  -- aqui — a transição agora só passa pelas checagens genéricas já feitas
  -- acima (sequência linear, um passo por vez).
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
  'Máquina de estados de orders.order_status: só permite avançar uma posição por vez na sequência QUOTE->WAITING_APPROVAL->APPROVED->IN_PRODUCTION_QUEUE->IN_PRODUCTION->WAITING_DELIVERY->DELIVERED, ou CANCELLED antes de IN_PRODUCTION. A transição para APPROVED delega a validação de aprovações a try_auto_approve_order(). Após QUOTE->WAITING_APPROVAL, chama try_auto_approve_order() para não deixar pedidos só-CATALOG (ou já totalmente aprovados) parados indefinidamente. Nunca altera payment_status. A partir de 2026-08-29, a transição para IN_PRODUCTION_QUEUE NÃO valida mais search_time_status de itens SPOT (gate removido por decisão do usuário) — spot_item_details.search_time_status/search_minutes permanecem só informativos/históricos, nunca mais lidos por esta função.';

revoke execute on function public.change_order_status(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.change_order_status(uuid, text, uuid, text) to service_role;

-- =============================================================================
-- 6) Verificações — mesmo padrão de todas as migrations anteriores deste
--    projeto: prova estruturalmente que nada além do pretendido mudou.
-- =============================================================================
do $$
declare
  v_count_10 integer;
  v_count_11 integer;
  v_is_security_definer boolean;
  v_search_path_raw text;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
begin
  -- 5.1 Ainda exatamente 2 sobrecargas de create_order (10 e 11
  -- parâmetros) — esta migration não cria nem remove nenhuma sobrecarga.
  select count(*) into v_count_10
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_order' and pronargs = 10;
  select count(*) into v_count_11
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_order' and pronargs = 11;

  if v_count_10 <> 1 then
    raise exception 'Abortando: esperada exatamente 1 função create_order com 10 parâmetros, encontrada %.', v_count_10;
  end if;
  if v_count_11 <> 1 then
    raise exception 'Abortando: esperada exatamente 1 função create_order com 11 parâmetros, encontrada %.', v_count_11;
  end if;

  -- 5.2 determine_order_initial_status / validate_catalog_composition_for_creation:
  -- SECURITY DEFINER, search_path vazio, e ZERO grants (nem para
  -- service_role) — mesmo padrão de assert_active_user/jsonb_whitelist.
  select prosecdef into v_is_security_definer
    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'validate_catalog_composition_for_creation';
  if not v_is_security_definer then
    raise exception 'Abortando: validate_catalog_composition_for_creation não é SECURITY DEFINER.';
  end if;

  select setting into v_search_path_raw
    from pg_proc, unnest(proconfig) as setting
    where pronamespace = 'public'::regnamespace and proname = 'validate_catalog_composition_for_creation'
      and setting like 'search_path=%';
  if v_search_path_raw is null or trim(both '"' from substring(v_search_path_raw from 13)) <> '' then
    raise exception 'Abortando: search_path de validate_catalog_composition_for_creation deveria ser vazio, veio: %.', v_search_path_raw;
  end if;

  select has_function_privilege('anon', 'public.determine_order_initial_status(jsonb)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.determine_order_initial_status(jsonb)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.determine_order_initial_status(jsonb)', 'EXECUTE') into v_service_role_can_execute;
  if v_anon_can_execute or v_authenticated_can_execute or v_service_role_can_execute then
    raise exception 'Abortando: determine_order_initial_status tem EXECUTE concedido a alguém (anon=%, authenticated=%, service_role=%) — deveria ser função interna sem nenhum grant.',
      v_anon_can_execute, v_authenticated_can_execute, v_service_role_can_execute;
  end if;

  select has_function_privilege('anon', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_service_role_can_execute;
  if v_anon_can_execute or v_authenticated_can_execute or v_service_role_can_execute then
    raise exception 'Abortando: validate_catalog_composition_for_creation tem EXECUTE concedido a alguém (anon=%, authenticated=%, service_role=%) — deveria ser função interna sem nenhum grant.',
      v_anon_can_execute, v_authenticated_can_execute, v_service_role_can_execute;
  end if;

  -- 5.3 As duas sobrecargas de create_order continuam exclusivas de
  -- service_role.
  select has_function_privilege('authenticated', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  if v_authenticated_can_execute then
    raise exception 'Abortando: authenticated tem EXECUTE em create_order(10) — não deveria.';
  end if;
  select has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;
  if not v_service_role_can_execute then
    raise exception 'Abortando: service_role deveria ter EXECUTE em create_order(10).';
  end if;

  select has_function_privilege('authenticated', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE') into v_authenticated_can_execute;
  if v_authenticated_can_execute then
    raise exception 'Abortando: authenticated tem EXECUTE em create_order(11) — não deveria.';
  end if;
  select has_function_privilege('service_role', 'public.create_order(uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb,uuid,text)', 'EXECUTE') into v_service_role_can_execute;
  if not v_service_role_can_execute then
    raise exception 'Abortando: service_role deveria ter EXECUTE em create_order(11).';
  end if;

  -- 6.4 change_order_status: continua exatamente 1 função (mesma
  -- assinatura, nenhuma sobrecarga nova), SECURITY DEFINER, search_path
  -- vazio, grants inalterados (só service_role).
  if (select count(*) from pg_proc
      where pronamespace = 'public'::regnamespace and proname = 'change_order_status') <> 1 then
    raise exception 'Abortando: esperada exatamente 1 função change_order_status.';
  end if;

  select prosecdef into v_is_security_definer
    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'change_order_status';
  if not v_is_security_definer then
    raise exception 'Abortando: change_order_status não é SECURITY DEFINER.';
  end if;

  select setting into v_search_path_raw
    from pg_proc, unnest(proconfig) as setting
    where pronamespace = 'public'::regnamespace and proname = 'change_order_status'
      and setting like 'search_path=%';
  if v_search_path_raw is null or trim(both '"' from substring(v_search_path_raw from 13)) <> '' then
    raise exception 'Abortando: search_path de change_order_status deveria ser vazio, veio: %.', v_search_path_raw;
  end if;

  select has_function_privilege('anon', 'public.change_order_status(uuid,text,uuid,text)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.change_order_status(uuid,text,uuid,text)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.change_order_status(uuid,text,uuid,text)', 'EXECUTE') into v_service_role_can_execute;
  if v_anon_can_execute or v_authenticated_can_execute then
    raise exception 'Abortando: anon/authenticated têm EXECUTE em change_order_status (anon=%, authenticated=%) — não deveriam.', v_anon_can_execute, v_authenticated_can_execute;
  end if;
  if not v_service_role_can_execute then
    raise exception 'Abortando: service_role deveria ter EXECUTE em change_order_status.';
  end if;

  -- 6.5 O gate de SPOT foi mesmo removido: nenhum JOIN/referência
  -- qualificada a spot_item_details.search_time_status sobra no
  -- código-fonte real da função (prova textual direta contra
  -- pg_get_functiondef, não só uma suposição de que o CREATE OR REPLACE
  -- acima "deveria" ter funcionado). Checa o padrão de código
  -- efetivamente removido (`sid.search_time_status`, `join public.
  -- spot_item_details`) — não uma busca genérica por "search_time_status"
  -- sozinho, que também casaria com o comentário explicativo deixado de
  -- propósito no corpo da função (ver acima), gerando falso positivo.
  if pg_get_functiondef('public.change_order_status(uuid,text,uuid,text)'::regprocedure) ilike '%sid.search_time_status%'
     or pg_get_functiondef('public.change_order_status(uuid,text,uuid,text)'::regprocedure) ilike '%join public.spot_item_details%'
  then
    raise exception 'Abortando: change_order_status ainda referencia spot_item_details.search_time_status — o gate de SPOT não foi removido corretamente.';
  end if;

  -- 6.6 spot_item_details.search_time_status/search_minutes continuam
  -- existindo (nenhuma coluna/tabela apagada por esta migration).
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spot_item_details' and column_name = 'search_time_status'
  ) then
    raise exception 'Abortando: spot_item_details.search_time_status não existe mais — nenhuma coluna deveria ser removida por esta migration.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spot_item_details' and column_name = 'search_minutes'
  ) then
    raise exception 'Abortando: spot_item_details.search_minutes não existe mais — nenhuma coluna deveria ser removida por esta migration.';
  end if;
end $$;
