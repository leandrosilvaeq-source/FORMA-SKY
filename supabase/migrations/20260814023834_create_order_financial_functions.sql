-- Bloco 1 — Clientes e Pedidos
-- Migration 14/16: public.recalculate_order_financials(), public.try_auto_approve_order()
-- decisão do plano final do Bloco 1
--
-- Funções internas de suporte, chamadas de dentro das funções transacionais
-- da Migration 15 (create_order, add/update/remove_order_item,
-- register_payment, register_approval etc.) — nenhuma delas é criada aqui.

-- ---------------------------------------------------------------------------
-- recalculate_order_financials(order_id, changed_by, reason)
-- ---------------------------------------------------------------------------
create or replace function public.recalculate_order_financials(
  p_order_id uuid,
  p_changed_by uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discount_value numeric(10, 2);
  v_shipping_cost numeric(10, 2);
  v_old_payment_status text;
  v_subtotal numeric(10, 2);
  v_total_value numeric(10, 2);
  v_total_receivable numeric(10, 2);
  v_total_paid numeric(10, 2);
  v_new_payment_status text;
begin
  -- changed_by não é derivado de auth.uid(): esta função é chamada por
  -- Edge Functions via service_role, e auth.uid() não reflete o operador
  -- original nesse contexto (não é a sessão do usuário final). Por isso o
  -- chamador deve resolver o id do operador a partir do JWT verificado e
  -- passá-lo explicitamente aqui. Esta validação garante que o valor
  -- recebido corresponde a um usuário real e ativo, não um uuid arbitrário.
  if not exists (
    select 1 from public.users where id = p_changed_by and is_active
  ) then
    raise exception 'changed_by inválido ou inativo: %', p_changed_by;
  end if;

  -- Lock da linha do pedido: torna orders.id o ponto único de serialização
  -- para qualquer operação que afete os valores/pagamento deste pedido.
  -- Enquanto esta transação não terminar (commit/rollback), qualquer outra
  -- chamada concorrente que também trave esta mesma linha (esta função, ou
  -- as funções da Migration 15 que a chamam) fica bloqueada aguardando —
  -- não existe janela em que dois recálculos leiam o mesmo estado "antigo"
  -- e gravem resultados conflitantes.
  select discount_value, shipping_cost, payment_status
    into v_discount_value, v_shipping_cost, v_old_payment_status
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  select coalesce(sum(total_price), 0)
    into v_subtotal
    from public.order_items
    where order_id = p_order_id;

  v_total_value := greatest(v_subtotal - v_discount_value, 0);
  -- total_receivable nunca é persistido (decisão do plano final): calculado
  -- aqui só em memória, para determinar payment_status.
  v_total_receivable := v_total_value + v_shipping_cost;

  select coalesce(sum(amount), 0)
    into v_total_paid
    from public.payments
    where order_id = p_order_id;

  if v_total_paid < 0 then
    raise exception 'total_paid ficou negativo para orders.id %: %', p_order_id, v_total_paid;
  end if;

  if v_total_paid = 0 then
    v_new_payment_status := 'WAITING_PAYMENT';
  elsif v_total_paid < v_total_receivable then
    v_new_payment_status := 'DEPOSIT_RECEIVED';
  else
    -- Cobre total_paid = total_receivable e também total_paid >
    -- total_receivable (pagamento excedente): PAID nos dois casos, sem
    -- nenhum ajuste automático criado aqui. O indicador de excedente será
    -- calculado depois em view (Migration 16), não nesta função.
    v_new_payment_status := 'PAID';
  end if;

  update public.orders
    set subtotal = v_subtotal,
        total_value = v_total_value,
        payment_status = v_new_payment_status
    where id = p_order_id;

  if v_new_payment_status <> v_old_payment_status then
    insert into public.payment_status_history (
      order_id, from_status, to_status, changed_by, reason
    ) values (
      p_order_id,
      v_old_payment_status,
      v_new_payment_status,
      p_changed_by,
      coalesce(p_reason, 'Recálculo automático de payment_status')
    );
  end if;
end;
$$;

comment on function public.recalculate_order_financials(uuid, uuid, text) is
  'Recalcula orders.subtotal/total_value a partir de order_items e orders.payment_status a partir de payments, gravando payment_status_history quando o status muda. Função interna: chamada por funções transacionais da Migration 15, nunca diretamente por sessão de frontend/Sky.';

revoke execute on function public.recalculate_order_financials(uuid, uuid, text)
  from public, anon, authenticated;
-- Nenhum GRANT EXECUTE é concedido — nem para service_role, mesmo padrão de
-- next_order_number() (Migration 6): só chamável de dentro de outra função
-- security definer do mesmo owner.

-- ---------------------------------------------------------------------------
-- try_auto_approve_order(order_id, changed_by, reason)
-- ---------------------------------------------------------------------------
create or replace function public.try_auto_approve_order(
  p_order_id uuid,
  p_changed_by uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_item_count integer;
  v_all_approved boolean;
begin
  if not exists (
    select 1 from public.users where id = p_changed_by and is_active
  ) then
    raise exception 'changed_by inválido ou inativo: %', p_changed_by;
  end if;

  -- Mesmo mecanismo de lock/serialização de recalculate_order_financials
  -- acima, aplicado a order_status em vez de valores financeiros.
  select order_status
    into v_order_status
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  -- Só age quando o pedido está aguardando aprovação.
  if v_order_status <> 'WAITING_APPROVAL' then
    return;
  end if;

  select count(*) into v_item_count
    from public.order_items
    where order_id = p_order_id;

  -- Nunca aprova pedido vazio.
  if v_item_count = 0 then
    return;
  end if;

  -- CATALOG nunca bloqueia (não entra em nenhuma das duas condições OR
  -- abaixo). SPOT exige approval com custom_version_id NULL. CUSTOM exige
  -- approval cujo custom_version_id aponte para a versão que é hoje o
  -- current_version do item (via custom_item_details + custom_versions).
  select not exists (
    select 1
    from public.order_items oi
    where oi.order_id = p_order_id
      and (
        (
          oi.item_type = 'SPOT'
          and not exists (
            select 1
            from public.approvals a
            where a.order_item_id = oi.id
              and a.custom_version_id is null
          )
        )
        or (
          oi.item_type = 'CUSTOM'
          and not exists (
            select 1
            from public.custom_item_details cid
            join public.custom_versions cv
              on cv.order_item_id = cid.order_item_id
             and cv.version_number = cid.current_version
            join public.approvals a
              on a.order_item_id = cid.order_item_id
             and a.custom_version_id = cv.id
            where cid.order_item_id = oi.id
          )
        )
      )
  )
  into v_all_approved;

  -- Existe CUSTOM/SPOT pendente: não altera o status.
  if not v_all_approved then
    return;
  end if;

  update public.orders
    set order_status = 'APPROVED',
        approval_date = (now() at time zone 'America/Sao_Paulo')::date
    where id = p_order_id;

  insert into public.order_status_history (
    order_id, from_status, to_status, changed_by, reason
  ) values (
    p_order_id,
    'WAITING_APPROVAL',
    'APPROVED',
    p_changed_by,
    coalesce(p_reason, 'Aprovação automática: todas as aprovações obrigatórias concluídas')
  );
end;
$$;

comment on function public.try_auto_approve_order(uuid, uuid, text) is
  'Aprova automaticamente um pedido em WAITING_APPROVAL quando todos os itens CUSTOM/SPOT possuem approval correspondente à versão/ao item; CATALOG nunca bloqueia. Função interna: chamada por register_approval (Migration 15), nunca diretamente por sessão de frontend/Sky.';

revoke execute on function public.try_auto_approve_order(uuid, uuid, text)
  from public, anon, authenticated;
-- Nenhum GRANT EXECUTE é concedido — mesmo padrão de
-- recalculate_order_financials acima e de next_order_number() (Migration 6).

-- ---------------------------------------------------------------------------
-- Convenção obrigatória de locking para a Migration 15
-- ---------------------------------------------------------------------------
-- Toda função transacional que alterar order_items, payments, approvals,
-- custom_versions ou qualquer outro dado que afete o estado/financeiro de um
-- pedido DEVE adquirir primeiro o lock da linha correspondente em
-- public.orders com SELECT ... FOR UPDATE, antes de escrever nas
-- tabelas-filhas (e antes de chamar recalculate_order_financials() e/ou
-- try_auto_approve_order(), que também travam essa mesma linha). Isso
-- garante que todas as operações que afetam um mesmo pedido — inclusive as
-- duas funções acima — operem dentro da mesma disciplina de serialização,
-- usando orders.id como ponto único de mutex para aquele pedido.
