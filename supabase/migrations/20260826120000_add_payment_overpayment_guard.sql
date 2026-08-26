-- Bloco 1 — Pedidos
-- Migration: bloqueio de pagamento excedente em register_payment()
-- Regra confirmada explicitamente pelo usuário em 2026-08-26: "o total
-- acumulado dos pagamentos nunca poderá ultrapassar o valor total do
-- pedido" — reverte a decisão anterior registrada nesta mesma função
-- ("Nenhum estorno automático: pagamento excedente é permitido"), agora
-- proibido deliberadamente.
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada). Aplicar exige autorização
-- explícita separada (supabase db push ou equivalente), fora do escopo
-- desta entrada — ver docs/05_ROADMAP_MODULOS.md.
--
-- CREATE OR REPLACE FUNCTION com a MESMA lista de tipos de parâmetro
-- (uuid, text, numeric, text, timestamptz, uuid, text) da função original
-- (Migration 20260814030351) — não é uma nova sobrecarga, substitui a
-- mesma entrada de catálogo (mesmo OID), preservando os grants existentes.
-- REVOKE/GRANT abaixo reafirmados por clareza/idempotência, mesmo padrão já
-- usado em 20260821014342_extend_order_summary_and_payment_method.sql para
-- grants de view.
--
-- "Total do pedido" para efeito deste teto é total_receivable
-- (orders.total_value + orders.shipping_cost) — a MESMA fórmula usada por
-- vw_order_summary.total_receivable (Migration 20260814040037) e é
-- exatamente o valor exibido como "Total do pedido" em
-- RegisterPaymentForm.tsx/OrderManagementPanel.tsx. Usar só total_value
-- (ignorando o frete) deixaria o teto do backend inconsistente com o valor
-- que o usuário vê na tela.
--
-- ATOMICIDADE / CONDIÇÃO DE CORRIDA — nenhuma mudança de estratégia de lock
-- em relação à função original: o `select ... for update` sobre a linha de
-- orders (agora também lendo total_value/shipping_cost, além de só
-- confirmar existência) continua sendo o único ponto de serialização
-- necessário. Duas chamadas concorrentes de register_payment() para o
-- MESMO pedido disputam esse mesmo lock de linha; a segunda só prossegue
-- (e só enxerga a soma de pagamentos já atualizada pela primeira, via
-- v_current_total) depois que a primeira transação commitar ou desfazer —
-- exatamente o mesmo raciocínio já documentado para a checagem de soma
-- nunca negativa, aplicado agora também ao teto superior. Não há, portanto,
-- nenhuma janela em que duas inserções concorrentes possam, juntas,
-- ultrapassar o total do pedido sem que uma das duas veja o estado já
-- atualizado da outra.
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
  v_total_value numeric(10, 2);
  v_shipping_cost numeric(10, 2);
  v_total_receivable numeric(10, 2);
  v_new_total numeric(10, 2);
  v_payment_id uuid;
begin
  perform public.assert_active_user(p_changed_by);

  -- Mesmo lock de linha da função original (FOR UPDATE), agora também
  -- lendo total_value/shipping_cost — não é uma segunda leitura separada,
  -- é a MESMA instrução que já existia, só selecionando mais colunas da
  -- mesma linha já travada.
  select total_value, shipping_cost into v_total_value, v_shipping_cost
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  v_total_receivable := v_total_value + v_shipping_cost;

  select coalesce(sum(amount), 0) into v_current_total
    from public.payments
    where order_id = p_order_id;

  v_new_total := v_current_total + p_amount;

  if v_new_total < 0 then
    raise exception 'Soma dos pagamentos ficaria negativa para orders.id % (atual: %, novo lançamento: %)',
      p_order_id, v_current_total, p_amount;
  end if;

  -- NOVA REGRA (2026-08-26): o total acumulado de pagamentos nunca pode
  -- ultrapassar o total do pedido (total_receivable). Mensagem inclui o
  -- saldo restante ANTES deste lançamento, para o chamador poder informar
  -- ao usuário o valor máximo que teria sido aceito.
  if v_new_total > v_total_receivable then
    raise exception
      'Pagamento excedente: a soma dos pagamentos (%) ultrapassaria o total do pedido (%) para orders.id % — já pago: %, novo lançamento: %, saldo restante antes deste lançamento: %',
      v_new_total, v_total_receivable, p_order_id, v_current_total, p_amount, (v_total_receivable - v_current_total);
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

  -- Estorno automático continua não implementado (nunca foi o escopo desta
  -- regra) — a novidade é só impedir que o pagamento excedente chegue a
  -- existir. has_overpayment/overpayment_amount (vw_order_summary,
  -- Migration 20260814040037) permanecem no schema só como proteção
  -- histórica (dados legados anteriores a esta regra, se existirem) — nunca
  -- mais deveriam ficar diferentes de false/0 para pagamentos novos.
  perform public.recalculate_order_financials(
    p_order_id, p_changed_by, 'Recálculo após registrar pagamento'
  );

  return v_payment_id;
end;
$$;

comment on function public.register_payment(uuid, text, numeric, text, timestamptz, uuid, text) is
  'Registra um pagamento (ou ajuste). Impede que a soma dos pagamentos do pedido fique negativa E que ultrapasse total_receivable (total_value + shipping_cost) — bloqueio de pagamento excedente adicionado em 2026-08-26. Chama recalculate_order_financials() ao final, que recalcula payment_status. Nenhum estorno automático.';

revoke execute on function public.register_payment(uuid, text, numeric, text, timestamptz, uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_payment(uuid, text, numeric, text, timestamptz, uuid, text)
  to service_role;
