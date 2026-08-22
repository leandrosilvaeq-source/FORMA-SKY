-- Bloco 1 — Clientes e Pedidos
-- Migration: adiciona public.update_quote_order(), RPC transacional única
-- para a edição completa do cabeçalho + itens de um pedido em QUOTE
-- (Catálogo apenas), substituindo a versão anterior de "Alterar pedido"
-- que só editava 5 campos do cabeçalho via update_order().
--
-- Contexto (auditoria aprovada): permitir editar cliente/empresa/origem/
-- itens/produto/quantidade/preço exigiria, do jeito antigo, várias
-- chamadas HTTP sequenciais (update_order + add/update/remove_order_item
-- por item alterado) — não atômico entre si, com risco real de "total
-- parcial" se uma chamada no meio falhasse. Esta migration resolve isso
-- com uma ÚNICA função, chamada uma única vez, cobrindo cabeçalho e
-- substituição de itens na mesma transação.
--
-- Escopo desta função (deliberadamente restrito): só pedidos em QUOTE,
-- só itens CATALOG (atuais e nos itens enviados) — cobre exatamente o
-- caso do pedido de homologação FS-26-001 e evita mexer em pedidos já
-- aprovados, em produção, ou com itens Personalizado/Spot (que têm regras
-- próprias de aprovação/versionamento não replicadas aqui). Pedidos fora
-- desse escopo continuam só com os campos já cobertos por update_order()
-- (Origem, Método de pagamento, Forma de entrega, Prazo, Observações) —
-- update_order() não é alterada nem removida por esta migration.
--
-- Nenhuma tabela é alterada. Nenhum dado existente é tocado (é uma
-- migration de schema pura: CREATE FUNCTION nova). update_order(),
-- create_order() (as duas sobrecargas), recalculate_order_financials() e
-- todas as demais funções já existentes permanecem intocadas.

-- =============================================================================
-- update_quote_order
-- =============================================================================
create function public.update_quote_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_company_id uuid,
  p_lead_source_id uuid,
  p_payment_method text,
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
  v_order_status text;
  v_item jsonb;
  v_item_type text;
  v_product_id uuid;
  v_dependency_count integer;
  v_foreign_item_count integer;
begin
  perform public.assert_active_user(p_changed_by);

  -- Validação explícita de payment_method ANTES de qualquer outra coisa —
  -- mesma regra e mesma mensagem já usada pela sobrecarga de 11 parâmetros
  -- de create_order() (migration 20260821014342), para que mapPgError já
  -- reconheça o padrão sem precisar de uma entrada nova.
  if p_payment_method is not null and p_payment_method not in ('PIX', 'DINHEIRO', 'CARTAO') then
    raise exception 'p_payment_method inválido: % (permitido: null, PIX, DINHEIRO ou CARTAO)', p_payment_method;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'update_quote_order exige ao menos um item em p_items';
  end if;

  -- Convenção obrigatória de locking (Migration 14): trava a linha do
  -- pedido ANTES de ler/escrever qualquer coisa que dependa do estado
  -- atual — nenhuma outra transação concorrente pode alterar o status ou
  -- os itens deste pedido enquanto esta transação estiver em andamento.
  select order_status into v_order_status
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  if v_order_status <> 'QUOTE' then
    raise exception 'update_quote_order só permite pedidos em QUOTE (status atual: %)', v_order_status;
  end if;

  -- Confirma que TODOS os itens já existentes deste pedido são CATALOG —
  -- nunca assumido a partir do status sozinho; um pedido em QUOTE com
  -- itens CUSTOM/SPOT (situação hoje só teoricamente possível, mas não
  -- descartada aqui sem prova) é recusado antes de qualquer escrita.
  select count(*) into v_foreign_item_count
    from public.order_items
    where order_id = p_order_id
      and item_type <> 'CATALOG';

  if v_foreign_item_count > 0 then
    raise exception 'update_quote_order não pode ser usada em pedidos com itens CUSTOM/SPOT existentes (% encontrado(s))', v_foreign_item_count;
  end if;

  -- Valida CADA item do payload ANTES de qualquer DELETE/INSERT: todos
  -- precisam ser CATALOG com product_id — nenhuma escrita parcial se um
  -- item no meio da lista for inválido.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item ->> 'item_type';
    if v_item_type <> 'CATALOG' then
      raise exception 'update_quote_order só aceita itens CATALOG (recebido: %)', coalesce(v_item_type, 'null');
    end if;

    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    if v_product_id is null then
      raise exception 'Item CATALOG exige product_id';
    end if;
  end loop;

  -- Confirma que nenhum item ATUAL deste pedido tem histórico de versão
  -- ou aprovação vinculado — nunca assumido: pedidos só-CATALOG nunca
  -- deveriam ter linhas em custom_versions/approvals (essas tabelas só
  -- existem para CUSTOM/SPOT), mas esta checagem prova isso explicitamente
  -- antes do DELETE, em vez de confiar na regra geral. Qualquer
  -- dependência inesperada aborta a transação inteira (nenhuma exclusão
  -- em cascata "ampla" é introduzida — cada checagem é restrita aos itens
  -- deste pedido específico).
  select count(*) into v_dependency_count
    from public.order_items oi
    where oi.order_id = p_order_id
      and (
        exists (select 1 from public.custom_versions cv where cv.order_item_id = oi.id)
        or exists (select 1 from public.approvals a where a.order_item_id = oi.id)
      );

  if v_dependency_count > 0 then
    raise exception 'update_quote_order não pode substituir os itens: % item(ns) com histórico de versão/aprovação vinculado', v_dependency_count;
  end if;

  -- Substitui o cabeçalho — nunca order_number, order_status nem
  -- payment_status (não fazem parte da lista de colunas do UPDATE
  -- abaixo). Validação de customer_id/company_id existentes fica a cargo
  -- das próprias FKs de orders (ON DELETE RESTRICT, Migration 7) — mesmo
  -- padrão já usado por update_order(), nenhuma checagem duplicada aqui.
  update public.orders
    set customer_id = p_customer_id,
        company_id = p_company_id,
        lead_source_id = p_lead_source_id,
        payment_method = p_payment_method,
        expected_delivery_date = p_expected_delivery_date,
        delivery_method = p_delivery_method,
        shipping_cost = coalesce(p_shipping_cost, 0),
        discount_value = coalesce(p_discount_value, 0),
        notes = p_notes
    where id = p_order_id;

  -- Substitui o conjunto de itens CATALOG: DELETE seguido de INSERT, na
  -- mesma transação — já comprovado acima que nenhum item atual tem
  -- dependência (custom_versions/approvals), então este DELETE nunca
  -- encontra uma FK RESTRICT no caminho. Escopo do DELETE é só
  -- order_id = p_order_id — nunca afeta itens de outro pedido.
  delete from public.order_items where order_id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, item_type, product_id, item_name, description,
      quantity, unit_price, personalization_fee, discount_value,
      color_description, number_of_colors, customization_data,
      expected_delivery_date, notes
    ) values (
      p_order_id,
      'CATALOG',
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
    );
  end loop;

  -- Recalcula subtotal/total_value/payment_status na mesma transação —
  -- pagamentos e aprovações nunca são tocados por esta função (nenhuma
  -- linha de payments/approvals é lida, escrita ou apagada aqui).
  perform public.recalculate_order_financials(
    p_order_id, p_changed_by, 'Recálculo após edição completa do pedido (QUOTE, itens CATALOG)'
  );

  return p_order_id;
end;
$$;

comment on function public.update_quote_order(uuid, uuid, uuid, uuid, text, date, text, numeric, numeric, text, jsonb, uuid) is
  'Edição atômica completa (cabeçalho + itens) de um pedido em QUOTE com itens exclusivamente CATALOG. Valida payment_method, exige order_status=QUOTE, exige que todos os itens atuais e enviados sejam CATALOG, recusa a operação se algum item atual tiver histórico de versão/aprovação vinculado. Substitui o conjunto de order_items (DELETE + INSERT) e o cabeçalho editável na mesma transação, preservando order_number/order_status/payment_status/pagamentos/aprovações/históricos. Chama recalculate_order_financials() ao final. Nunca cria order_status_history (não altera order_status).';

-- Grants nascem vazios (exceto o implícito do owner) para toda função
-- nova — REVOKE explícito aqui é, na prática, redundante com o estado
-- inicial, mas mantido por clareza/idempotência e paridade com o restante
-- do projeto. Só service_role tem EXECUTE, mesmo padrão de create_order/
-- update_order/add_order_item/update_order_item/remove_order_item.
revoke execute on function public.update_quote_order(uuid, uuid, uuid, uuid, text, date, text, numeric, numeric, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.update_quote_order(uuid, uuid, uuid, uuid, text, date, text, numeric, numeric, text, jsonb, uuid)
  to service_role;

-- =============================================================================
-- Verificações — provam SECURITY DEFINER, search_path seguro e grants
-- corretos antes de considerar a migration concluída.
-- =============================================================================
do $$
declare
  v_is_security_definer boolean;
  v_search_path_raw text;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
begin
  select prosecdef into v_is_security_definer
    from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'update_quote_order';

  if not v_is_security_definer then
    raise exception 'Abortando: update_quote_order não é SECURITY DEFINER.';
  end if;

  select setting into v_search_path_raw
    from pg_proc, unnest(proconfig) as setting
    where pronamespace = 'public'::regnamespace and proname = 'update_quote_order'
      and setting like 'search_path=%';

  if v_search_path_raw is null then
    raise exception 'Abortando: search_path não configurado em update_quote_order.';
  end if;
  if trim(both '"' from substring(v_search_path_raw from 13)) <> '' then
    raise exception 'Abortando: search_path de update_quote_order deveria ser vazio, veio: %.', v_search_path_raw;
  end if;

  select has_function_privilege('anon', 'public.update_quote_order(uuid,uuid,uuid,uuid,text,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.update_quote_order(uuid,uuid,uuid,uuid,text,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.update_quote_order(uuid,uuid,uuid,uuid,text,date,text,numeric,numeric,text,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;

  if v_anon_can_execute or v_authenticated_can_execute then
    raise exception 'Abortando: anon/authenticated têm EXECUTE em update_quote_order (anon=%, authenticated=%) — não deveriam.', v_anon_can_execute, v_authenticated_can_execute;
  end if;
  if not v_service_role_can_execute then
    raise exception 'Abortando: service_role deveria ter EXECUTE em update_quote_order.';
  end if;
end $$;
