-- Bloco 1 — Pedidos
-- Migration: public.orders.payment_condition + public.create_order_with_payment
-- (ajuste solicitado pelo usuário em 2026-08-29, ver docs/05_ROADMAP_MODULOS.md).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada). Aplicar exige autorização
-- explícita separada, fora do escopo desta entrada.
--
-- Contexto: "Novo Pedido" ganhou uma segunda escolha, além de "Método de
-- pagamento" (PIX/DINHEIRO/CARTAO, já existente) — "Forma de pagamento"
-- (Adiantado/Sinal/Na entrega, valores internos ADVANCE/DEPOSIT/
-- ON_DELIVERY). Só afeta a CRIAÇÃO de um pedido novo — update_order() e
-- update_quote_order() (edição de pedido existente) não são tocadas por
-- esta migration; nenhuma delas ganha payment_condition nem chama
-- register_payment. A edição de um pedido em QUOTE nunca recria o
-- pagamento inicial, estruturalmente: só create_order_with_payment (abaixo)
-- tem esse efeito, e só é chamada pela rota de criação.
--
-- 1) Coluna nova em orders — nullable (pedidos existentes/criados por
-- create_order "puro" continuam sem essa informação, sem erro), CHECK
-- restringindo aos 3 valores válidos.
alter table public.orders
  add column payment_condition text
    check (payment_condition is null or payment_condition in ('ADVANCE', 'DEPOSIT', 'ON_DELIVERY'));

comment on column public.orders.payment_condition is
  'Forma de pagamento escolhida na criação do pedido: ADVANCE (adiantado — paga o total na criação), DEPOSIT (sinal — paga uma parte na criação, saldo depois) ou ON_DELIVERY (na entrega — nenhum pagamento na criação). Nullable: só preenchida por create_order_with_payment(); pedidos criados por create_order() "puro" (sem essa escolha) permanecem null. Nunca reescrita por edição de pedido — update_order()/update_quote_order() não tocam esta coluna.';

-- ---------------------------------------------------------------------------
-- create_order_with_payment — cria o pedido (reaproveitando create_order,
-- 11 parâmetros, sem duplicar seu corpo) e, conforme p_payment_condition,
-- registra atomicamente o pagamento inicial via register_payment (reaproveitada,
-- nunca duplicada) — tudo dentro de UMA ÚNICA chamada de função/transação:
-- se register_payment levantar exceção (ex.: pagamento excedente, valor <= 0),
-- a exceção propaga e desfaz TAMBÉM o INSERT de orders/order_items já feito
-- por create_order() nesta mesma chamada — o pedido nunca fica criado sem o
-- pagamento correspondente. Chamar create_order() e register_payment() como
-- duas chamadas HTTP/RPC separadas do frontend foi deliberadamente evitado
-- por esse motivo.
--
-- Como esta function e create_order()/register_payment() têm o MESMO owner
-- (a role que aplica as migrations), a chamada interna abaixo funciona sem
-- precisar de nenhum GRANT EXECUTE adicional para as duas — mesmo mecanismo
-- já usado por change_order_status() ao chamar try_auto_approve_order()
-- (que tem EXECUTE zero, nem para service_role) e por create_order()/
-- update_order()/... ao chamar recalculate_order_financials() (idem).
--
-- paid_at nunca é parâmetro desta function: o pagamento inicial acontece no
-- exato instante da criação do pedido, então usa now() diretamente — evita
-- reintroduzir a mesma classe de bug já corrigida em RegisterPaymentForm
-- (comparação de data local vs. UTC), que só existe quando o cliente
-- calcula/envia uma data; aqui não há data nenhuma para calcular.
create or replace function public.create_order_with_payment(
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
  p_payment_method text,
  p_payment_condition text,
  p_deposit_amount numeric(10, 2)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_payment_id uuid;
  v_total_value numeric(10, 2);
  v_shipping_cost numeric(10, 2);
  v_total_receivable numeric(10, 2);
begin
  perform public.assert_active_user(p_changed_by);

  if p_payment_condition not in ('ADVANCE', 'DEPOSIT', 'ON_DELIVERY') then
    raise exception 'create_order_with_payment: p_payment_condition inválido: % (esperado ADVANCE, DEPOSIT ou ON_DELIVERY)', p_payment_condition;
  end if;

  if p_payment_condition in ('ADVANCE', 'DEPOSIT') and p_payment_method is null then
    raise exception 'create_order_with_payment: p_payment_method é obrigatório quando p_payment_condition = %', p_payment_condition;
  end if;

  if p_payment_condition = 'DEPOSIT' and (p_deposit_amount is null or p_deposit_amount <= 0) then
    raise exception 'create_order_with_payment: p_deposit_amount deve ser maior que zero quando p_payment_condition = DEPOSIT';
  end if;

  -- Reaproveita create_order (sobrecarga de 11 parâmetros,
  -- 20260821014342_extend_order_summary_and_payment_method.sql) para criar
  -- pedido + itens — nenhuma duplicação do corpo já existente/testado. Já
  -- chama recalculate_order_financials() internamente, então orders.total_value
  -- já está correto quando lido de volta abaixo.
  v_order_id := public.create_order(
    p_customer_id, p_company_id, p_lead_source_id, p_expected_delivery_date,
    p_delivery_method, p_shipping_cost, p_discount_value, p_notes, p_items,
    p_changed_by, p_payment_method
  );

  update public.orders set payment_condition = p_payment_condition where id = v_order_id;

  if p_payment_condition = 'ADVANCE' then
    select total_value, shipping_cost into v_total_value, v_shipping_cost
      from public.orders where id = v_order_id;
    v_total_receivable := v_total_value + v_shipping_cost;

    -- total_receivable = 0 é possível (ex.: desconto total) — payments.amount
    -- exige <> 0 (Migration 12), então nenhum pagamento é criado nesse caso;
    -- o pedido já nasce PAID (recalculate_order_financials: total_paid=0 >=
    -- total_receivable=0 cai no branch PAID). Nenhum estorno/ajuste é
    -- inventado aqui para um caso que não representa dinheiro real.
    if v_total_receivable > 0 then
      v_payment_id := public.register_payment(
        v_order_id, p_payment_method, v_total_receivable, 'INTEGRAL', now(), p_changed_by, null
      );
    end if;

  elsif p_payment_condition = 'DEPOSIT' then
    select total_value, shipping_cost into v_total_value, v_shipping_cost
      from public.orders where id = v_order_id;
    v_total_receivable := v_total_value + v_shipping_cost;

    if p_deposit_amount >= v_total_receivable then
      raise exception 'create_order_with_payment: p_deposit_amount (%) deve ser menor que o total do pedido (%)', p_deposit_amount, v_total_receivable;
    end if;

    v_payment_id := public.register_payment(
      v_order_id, p_payment_method, p_deposit_amount, 'SINAL', now(), p_changed_by, null
    );
  end if;
  -- ON_DELIVERY: nenhum pagamento criado — saldo devedor = total do pedido,
  -- payment_status permanece WAITING_PAYMENT (já calculado por create_order()).

  return jsonb_build_object('order_id', v_order_id, 'payment_id', v_payment_id);
end;
$$;

comment on function public.create_order_with_payment(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text, text, numeric) is
  'Cria um pedido (via create_order, reaproveitada) e, conforme p_payment_condition (ADVANCE/DEPOSIT/ON_DELIVERY), registra atomicamente o pagamento inicial (via register_payment, reaproveitada) na MESMA transação — se o pagamento falhar (ex.: DEPOSIT >= total), o pedido inteiro é desfeito. Grava orders.payment_condition. Nunca chamada por edição de pedido existente (update_order/update_quote_order não a tocam). paid_at do pagamento é sempre now() — nunca calculado a partir de input do cliente.';

revoke execute on function public.create_order_with_payment(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.create_order_with_payment(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text, text, numeric)
  to service_role;
