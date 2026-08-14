-- Bloco 1 — Clientes e Pedidos
-- Migration 16/16: public.vw_order_item_approval_status,
-- public.vw_order_approval_status, public.vw_order_summary
-- docs/03_MODELO_BANCO_DADOS.md §28, decisão do plano final do Bloco 1
--
-- Views somente leitura, consolidando dados já existentes. Nenhuma nova
-- regra de escrita, nenhuma tabela, nenhuma função privilegiada nova.
--
-- security_invoker = true (disponível desde PostgreSQL 15; este projeto
-- roda PostgreSQL 17.6 via Supabase) em TODAS as três views: sem essa
-- opção, uma view roda por padrão com os privilégios do seu owner (quem a
-- criou via migration), o que poderia ignorar as RLS policies das tabelas
-- de origem — exatamente o risco apontado no pedido ("views não devem
-- acidentalmente contornar RLS"). Com security_invoker = true, a consulta
-- às tabelas de base (orders, order_items, custom_item_details,
-- custom_versions, approvals, payments) roda como o role que está
-- consultando a view, então as policies já existentes (is_active_user())
-- se aplicam normalmente. As views B e C referenciam outras views deste
-- arquivo — cada uma precisa do seu próprio security_invoker = true para
-- que a cadeia inteira propague a checagem de RLS até as tabelas base.

-- ---------------------------------------------------------------------------
-- A) vw_order_item_approval_status
-- ---------------------------------------------------------------------------
create view public.vw_order_item_approval_status
with (security_invoker = true) as
select
  oi.id as order_item_id,
  oi.order_id,
  oi.item_type,
  (oi.item_type <> 'CATALOG') as requires_approval,
  case
    when oi.item_type = 'CATALOG' then true
    when oi.item_type = 'SPOT' then exists (
      select 1
      from public.approvals a
      where a.order_item_id = oi.id
        and a.custom_version_id is null
    )
    when oi.item_type = 'CUSTOM' then exists (
      select 1
      from public.custom_versions cv
      join public.approvals a on a.custom_version_id = cv.id
      where cv.order_item_id = oi.id
        and cv.version_number = cid.current_version
        and a.order_item_id = oi.id
    )
    else false
  end as is_approved,
  cid.current_version,
  last_approval.version_number as approved_version,
  coalesce(all_approvals.approval_count, 0) as approval_count,
  all_approvals.latest_approved_at
from public.order_items oi
left join public.custom_item_details cid
  on cid.order_item_id = oi.id
left join lateral (
  select
    count(*) as approval_count,
    max(a.approved_at) as latest_approved_at
  from public.approvals a
  where a.order_item_id = oi.id
) all_approvals on true
left join lateral (
  -- Versão mais recentemente aprovada (por approved_at), não
  -- necessariamente a current_version — só populado para CUSTOM, já que
  -- approvals de SPOT sempre têm custom_version_id NULL (nunca casam com
  -- join a.custom_version_id = cv.id) e CATALOG nunca tem approvals
  -- (register_approval rejeita).
  select cv.version_number
  from public.approvals a
  join public.custom_versions cv on cv.id = a.custom_version_id
  where a.order_item_id = oi.id
  order by a.approved_at desc
  limit 1
) last_approval on true;

comment on view public.vw_order_item_approval_status is
  'Status de aprovação por order_item. CATALOG nunca exige aprovação. SPOT exige approval com custom_version_id NULL. CUSTOM exige approval vinculada à versão que é hoje custom_item_details.current_version — aprovação de versão antiga nunca aprova a versão atual. Somente leitura; security_invoker=true.';

revoke all on public.vw_order_item_approval_status from anon, authenticated;
grant select on public.vw_order_item_approval_status to authenticated;

-- ---------------------------------------------------------------------------
-- B) vw_order_approval_status
-- ---------------------------------------------------------------------------
-- Uma linha por pedido, mesmo para pedidos sem itens: parte de
-- public.orders (não de order_items), com LEFT JOIN LATERAL, para nunca
-- perder um order_id.
create view public.vw_order_approval_status
with (security_invoker = true) as
select
  o.id as order_id,
  coalesce(oi_stats.total_items, 0) as total_items,
  coalesce(oi_stats.items_requiring_approval, 0) as items_requiring_approval,
  coalesce(oi_stats.approved_required_items, 0) as approved_required_items,
  coalesce(oi_stats.pending_required_items, 0) as pending_required_items,
  (
    coalesce(oi_stats.total_items, 0) > 0
    and coalesce(oi_stats.pending_required_items, 0) = 0
  ) as is_fully_approved
from public.orders o
left join lateral (
  select
    count(*) as total_items,
    count(*) filter (where vias.requires_approval) as items_requiring_approval,
    count(*) filter (where vias.requires_approval and vias.is_approved) as approved_required_items,
    count(*) filter (where vias.requires_approval and not vias.is_approved) as pending_required_items
  from public.vw_order_item_approval_status vias
  where vias.order_id = o.id
) oi_stats on true;

comment on view public.vw_order_approval_status is
  'Uma linha por pedido. CATALOG nunca entra em items_requiring_approval. is_fully_approved só true com total_items > 0 e pending_required_items = 0 (pedido vazio nunca é fully approved; pedido só-CATALOG é fully approved automaticamente, pois items_requiring_approval=0). Somente leitura; security_invoker=true.';

revoke all on public.vw_order_approval_status from anon, authenticated;
grant select on public.vw_order_approval_status to authenticated;

-- ---------------------------------------------------------------------------
-- C) vw_order_summary
-- ---------------------------------------------------------------------------
create view public.vw_order_summary
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
  -- total_receivable nunca é persistido em orders (decisão do plano final
  -- do Bloco 1) — calculado aqui, igual ao que
  -- recalculate_order_financials() já calcula internamente (Migration 14).
  (o.total_value + o.shipping_cost) as total_receivable,
  coalesce(pay.total_paid, 0) as total_paid,
  greatest(
    (o.total_value + o.shipping_cost) - coalesce(pay.total_paid, 0), 0
  ) as balance_due,
  (coalesce(pay.total_paid, 0) > (o.total_value + o.shipping_cost)) as has_overpayment,
  greatest(
    coalesce(pay.total_paid, 0) - (o.total_value + o.shipping_cost), 0
  ) as overpayment_amount,
  -- approval_required: interpretação adotada para o booleano pedido — true
  -- quando o pedido tem ao menos um item que exige aprovação (CUSTOM/SPOT).
  (voas.items_requiring_approval > 0) as approval_required,
  voas.is_fully_approved,
  voas.pending_required_items as pending_approval_items
from public.orders o
left join lateral (
  select coalesce(sum(p.amount), 0) as total_paid
  from public.payments p
  where p.order_id = o.id
) pay on true
left join public.vw_order_approval_status voas
  on voas.order_id = o.id;

comment on view public.vw_order_summary is
  'Uma linha por pedido, com valores financeiros e de aprovação totalmente derivados (nenhum é persistido em orders além de subtotal/total_value, já mantidos por recalculate_order_financials). has_overpayment/overpayment_amount refletem pagamento excedente sem qualquer estorno automático. Somente leitura; security_invoker=true.';

revoke all on public.vw_order_summary from anon, authenticated;
grant select on public.vw_order_summary to authenticated;
