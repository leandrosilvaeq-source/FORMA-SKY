-- Bloco 1 — Pedidos
-- Migration: public.delete_order — exclusão física protegida de pedido
-- (ajuste solicitado pelo usuário em 2026-08-29, ver docs/05_ROADMAP_MODULOS.md).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada). Aplicar exige autorização
-- explícita separada, fora do escopo desta entrada.
--
-- Nenhuma tabela é alterada. Auditoria de dependências (antes desta
-- migration, via grep de "references public.orders "/"references public.order_items "
-- em todas as migrations) confirmou exatamente estas 8 FKs a considerar:
--   order_items.order_id -> orders (RESTRICT)
--   custom_item_details.order_item_id -> order_items (RESTRICT, unique)
--   spot_item_details.order_item_id -> order_items (RESTRICT, unique)
--   custom_versions.order_item_id -> order_items (RESTRICT)
--   approvals.order_item_id -> order_items (RESTRICT)
--   payments.order_id -> orders (RESTRICT)
--   order_status_history.order_id -> orders (RESTRICT)
--   payment_status_history.order_id -> orders (RESTRICT)
-- Nenhuma tabela de reserva/consumo de estoque existe hoje nem referencia
-- orders/order_items (reserva e consumo automático continuam fora de
-- escopo, só intenção documentada) — nada a checar além do que já é
-- coberto abaixo.
--
-- REVISÃO OBRIGATÓRIA FUTURA (Incremento 6B — reserva/consumo automático de
-- estoque, ainda não implementado, docs/05_ROADMAP_MODULOS.md §9b): quando
-- reserva e/ou consumo automático de filamento/acessório/embalagem por
-- pedido forem implementados, esta function DEVE ser revisada antes de
-- qualquer aplicação da migration correspondente — um pedido com reserva
-- ativa ou consumo já registrado (mesmo em QUOTE/CANCELLED, se a reserva
-- sobreviver ao cancelamento) precisará de uma checagem de bloqueio nova,
-- do mesmo padrão das quatro já existentes abaixo (payments/approvals/
-- custom_versions/status), nunca silenciosamente ignorado. Esta nota é o
-- lembrete formal exigido para essa revisão — delete_order nunca deve ser
-- estendida "de passagem" junto de outra migration sem essa checagem.
--
-- REGRA DE EXCLUSÃO PROTEGIDA (pedido do usuário, literal):
--   - status QUOTE ou CANCELLED apenas;
--   - nenhum pagamento (payments.order_id);
--   - nenhuma aprovação (approvals, via order_items);
--   - nenhuma reserva/consumo de estoque (não existe hoje — nada a checar);
--   - nenhuma dependência externa (nenhuma outra FK encontrada além das 8
--     acima, todas cobertas por esta function).
-- Adicionalmente bloqueado: item com custom_versions vinculado (histórico de
-- versão de item Personalizado) — mesmo raciocínio já usado por
-- update_quote_order() (20260821031143), que também recusa substituir itens
-- com esse tipo de vínculo em vez de apagá-lo silenciosamente.
--
-- Exclusão nunca em cascata ampla: cada DELETE abaixo tem escopo
-- explicitamente restrito a p_order_id (via order_id = p_order_id ou
-- order_item_id IN (SELECT ... WHERE order_id = p_order_id)) — nunca afeta
-- linhas de outro pedido, nunca toca customers/companies/products.
create or replace function public.delete_order(
  p_order_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_payment_count integer;
  v_approval_count integer;
  v_version_count integer;
begin
  perform public.assert_active_user(p_changed_by);

  select order_status into v_order_status
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  if v_order_status not in ('QUOTE', 'CANCELLED') then
    raise exception 'ORDER_DELETE_INVALID_STATUS: Só é possível excluir pedidos em Orçamento ou Cancelado (status atual: %).', v_order_status;
  end if;

  select count(*) into v_payment_count
    from public.payments
    where order_id = p_order_id;

  if v_payment_count > 0 then
    raise exception 'ORDER_DELETE_HAS_PAYMENTS: Este pedido possui pagamento(s) registrado(s) e não pode ser excluído.';
  end if;

  select count(*) into v_approval_count
    from public.approvals a
    join public.order_items oi on oi.id = a.order_item_id
    where oi.order_id = p_order_id;

  if v_approval_count > 0 then
    raise exception 'ORDER_DELETE_HAS_APPROVALS: Este pedido possui aprovação(ões) registrada(s) e não pode ser excluído.';
  end if;

  select count(*) into v_version_count
    from public.custom_versions cv
    join public.order_items oi on oi.id = cv.order_item_id
    where oi.order_id = p_order_id;

  if v_version_count > 0 then
    raise exception 'ORDER_DELETE_HAS_VERSIONS: Este pedido possui versão(ões) de item Personalizado registrada(s) e não pode ser excluído.';
  end if;

  delete from public.custom_item_details
    where order_item_id in (select id from public.order_items where order_id = p_order_id);
  delete from public.spot_item_details
    where order_item_id in (select id from public.order_items where order_id = p_order_id);
  delete from public.order_items where order_id = p_order_id;
  delete from public.payment_status_history where order_id = p_order_id;
  delete from public.order_status_history where order_id = p_order_id;
  delete from public.orders where id = p_order_id;
end;
$$;

comment on function public.delete_order(uuid, uuid) is
  'Exclusão física protegida de um pedido: só permitida em QUOTE/CANCELLED, sem pagamento, sem aprovação e sem versão de item Personalizado vinculados. Apaga só order_items (+ custom_item_details/spot_item_details), order_status_history, payment_status_history e orders deste pedido — nunca customers/companies/products, nunca outro pedido. Bloqueio levanta ORDER_DELETE_INVALID_STATUS:/ORDER_DELETE_HAS_PAYMENTS:/ORDER_DELETE_HAS_APPROVALS:/ORDER_DELETE_HAS_VERSIONS: <mensagem amigável>, marcadores estáveis reconhecidos por _shared/errors.ts (mapeados para 409).';

revoke execute on function public.delete_order(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_order(uuid, uuid)
  to service_role;
