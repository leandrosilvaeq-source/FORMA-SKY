-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- Remoção segura de tipo de filamento: exclusão física só quando NÃO há
-- nenhuma referência; caso contrário, arquivamento atômico do tipo e de
-- TODOS os seus rolos, preservando históricos, movimentações, compras e
-- vínculos de pedidos finalizados/cancelados. Bloqueio total quando o tipo
-- está em pedido ativo (status não-terminal).
--
-- Decisão revisada do usuário (2026-09-03):
--   1. excluir um tipo que possui rolos = arquivar o tipo + arquivar todos
--      os rolos, preservando históricos e movimentações;
--   2. bloquear se houver pedido ativo; permitir arquivamento quando os
--      únicos pedidos vinculados estiverem DELIVERED ou CANCELLED,
--      preservando seus vínculos e snapshots.
--
-- Migration APPEND-ONLY — não altera nenhuma migration anterior. A função
-- antiga public.delete_filament_type(uuid, uuid) é redefinida via CREATE OR
-- REPLACE (mesma assinatura) para DELEGAR a esta nova RPC — assim não
-- sobra nenhum caminho operacional com a regra antiga (que levantava
-- FILAMENT_TYPE_HAS_SPOOLS:/FILAMENT_TYPE_HAS_COMPOSITION:).
--
-- NENHUMA exclusão em cascata. NENHUM ON DELETE CASCADE. NENHUMA linha
-- dependente (filament_movements, inventory_purchases, product_filaments,
-- product_plate_filaments, order_item_unit_plate_filaments) é apagada.
--
-- Referências reais a filament_types.id mapeadas na auditoria:
--   - filament_spools.filament_type_id            (FK, on delete restrict)
--   - filament_movements.filament_type_id         (FK, on delete restrict — denormalizado; também alcançável via spool_id)
--   - product_filaments.filament_type_id          (FK, on delete restrict — LEGADO)
--   - product_plate_filaments.filament_type_id    (FK, on delete restrict — LEGADO)
--   - order_item_unit_plate_filaments.filament_type_id (FK, on delete restrict — seleção de cor do Pedido)
--   - inventory_purchases (category='FILAMENT' AND item_id=<tipo>) — SEM FK (polimórfico), mas é referência real
--
-- Caminho pedido: order_item_unit_plate_filaments.order_item_id
--   -> order_items.id ; order_items.order_id -> orders.id ; orders.order_status
-- Estados terminais reais da máquina de status (orders_order_status_check):
--   DELIVERED, CANCELLED. Qualquer outro (QUOTE, WAITING_APPROVAL, APPROVED,
--   IN_PRODUCTION_QUEUE, IN_PRODUCTION, WAITING_DELIVERY) é "pedido ativo".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- remove_filament_type — RPC transacional única
-- ---------------------------------------------------------------------------
create or replace function public.remove_filament_type(
  p_filament_type_id uuid,
  p_changed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_order_numbers text[];
  v_has_spools boolean;
  v_has_movements boolean;
  v_has_purchases boolean;
  v_has_product_filaments boolean;
  v_has_product_plate_filaments boolean;
  v_has_order_selection boolean;
  v_has_any_dependency boolean;
  v_archived_spool_count integer := 0;
begin
  perform public.assert_active_user(p_changed_by);

  -- Trava a linha do tipo por TODA a operação. Se falhar qualquer etapa
  -- adiante, o RAISE aborta a transação inteira e nada é alterado (a RPC
  -- roda numa única transação implícita — nenhuma sequência parcial).
  perform 1 from public.filament_types where id = p_filament_type_id for update;
  if not found then
    raise exception 'filament_types.id % não encontrado', p_filament_type_id;
  end if;

  -- (3 na REGRA FINAL) BLOQUEIO por pedido ATIVO — verificado ANTES de
  -- qualquer alteração. Um pedido é "ativo" quando o status NÃO é terminal
  -- (DELIVERED/CANCELLED). Pedidos DELIVERED/CANCELLED NÃO bloqueiam: seus
  -- vínculos (order_item_unit_plate_filaments) e snapshots (order_item_plates)
  -- são preservados intactos pelo arquivamento (que só toca filament_types
  -- e filament_spools).
  select array_agg(distinct o.order_number order by o.order_number)
    into v_active_order_numbers
    from public.order_item_unit_plate_filaments oiupf
    join public.order_items oi on oi.id = oiupf.order_item_id
    join public.orders o on o.id = oi.order_id
    where oiupf.filament_type_id = p_filament_type_id
      and o.order_status not in ('DELIVERED', 'CANCELLED');

  if v_active_order_numbers is not null and array_length(v_active_order_numbers, 1) > 0 then
    raise exception
      'FILAMENT_TYPE_IN_ACTIVE_ORDER: Este tipo de filamento está sendo utilizado por pedido(s) ativo(s) e não pode ser removido. Pedido(s): %.',
      array_to_string(v_active_order_numbers, ', ');
  end if;

  -- (1 vs 2 na REGRA FINAL) Existe QUALQUER referência a este tipo?
  select exists (
    select 1 from public.filament_spools where filament_type_id = p_filament_type_id
  ) into v_has_spools;

  select exists (
    select 1 from public.filament_movements where filament_type_id = p_filament_type_id
  ) into v_has_movements;

  select exists (
    select 1 from public.inventory_purchases
    where category = 'FILAMENT' and item_id = p_filament_type_id
  ) into v_has_purchases;

  select exists (
    select 1 from public.product_filaments where filament_type_id = p_filament_type_id
  ) into v_has_product_filaments;

  select exists (
    select 1 from public.product_plate_filaments where filament_type_id = p_filament_type_id
  ) into v_has_product_plate_filaments;

  -- Aqui só sobram seleções de pedidos DELIVERED/CANCELLED (as ativas já
  -- teriam abortado acima) — mesmo assim contam como referência: força o
  -- arquivamento em vez da exclusão física, preservando o vínculo.
  select exists (
    select 1 from public.order_item_unit_plate_filaments where filament_type_id = p_filament_type_id
  ) into v_has_order_selection;

  v_has_any_dependency :=
    v_has_spools
    or v_has_movements
    or v_has_purchases
    or v_has_product_filaments
    or v_has_product_plate_filaments
    or v_has_order_selection;

  if not v_has_any_dependency then
    -- (1) EXCLUSÃO FÍSICA DEFINITIVA — nenhuma referência de nenhum tipo.
    delete from public.filament_types where id = p_filament_type_id;
    return jsonb_build_object(
      'result', 'PHYSICALLY_DELETED',
      'archived_spool_count', 0
    );
  end if;

  -- (2) ARQUIVAMENTO ATÔMICO — mesma transação:
  --   - todos os rolos ativos do tipo -> is_active = false;
  --   - o tipo -> is_active = false.
  -- filament_movements / inventory_purchases / product_filaments /
  -- product_plate_filaments / order_item_unit_plate_filaments NÃO são
  -- tocados: nenhuma linha dependente é apagada, nenhum snapshot alterado.
  update public.filament_spools
    set is_active = false
    where filament_type_id = p_filament_type_id
      and is_active;
  get diagnostics v_archived_spool_count = row_count;

  update public.filament_types
    set is_active = false
    where id = p_filament_type_id;

  return jsonb_build_object(
    'result', 'ARCHIVED',
    'archived_spool_count', v_archived_spool_count
  );
end;
$$;

comment on function public.remove_filament_type(uuid, uuid) is
  'Remoção segura e transacional de um tipo de filamento. BLOQUEIA (FILAMENT_TYPE_IN_ACTIVE_ORDER:) quando o tipo está em order_item_unit_plate_filaments de algum pedido cujo status não é terminal (DELIVERED/CANCELLED). Sem nenhuma referência (rolos, movimentações, compras FILAMENT, product_filaments, product_plate_filaments, seleção em pedido) -> exclusão física (result=PHYSICALLY_DELETED). Com qualquer referência -> arquiva o tipo (is_active=false) e todos os seus rolos ativos (is_active=false) na mesma transação (result=ARCHIVED, archived_spool_count=N), sem apagar nenhuma linha dependente e sem cascata. Retorno jsonb: { result, archived_spool_count }.';

revoke execute on function public.remove_filament_type(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_filament_type(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- delete_filament_type — redefinida para DELEGAR a remove_filament_type.
-- Mesma assinatura (uuid, uuid) returns void. A partir daqui NÃO existe
-- mais o caminho antigo que levantava FILAMENT_TYPE_HAS_SPOOLS: /
-- FILAMENT_TYPE_HAS_COMPOSITION: — qualquer chamador (Edge Function ou
-- chamada direta) passa a obedecer exatamente à regra nova. O jsonb de
-- retorno da nova RPC é descartado aqui (compatibilidade de assinatura);
-- chamadores que precisam do resultado estruturado devem chamar
-- remove_filament_type diretamente (é o que a Edge Function `filament-types`
-- passa a fazer).
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
  perform public.remove_filament_type(p_filament_type_id, p_changed_by);
end;
$$;

comment on function public.delete_filament_type(uuid, uuid) is
  'COMPATIBILIDADE: delega integralmente para remove_filament_type(uuid, uuid) (2026-09-03). Não levanta mais FILAMENT_TYPE_HAS_SPOOLS:/FILAMENT_TYPE_HAS_COMPOSITION: — a regra de exclusão física vs. arquivamento atômico vs. bloqueio por pedido ativo é única e vive em remove_filament_type. Retorno void mantém a assinatura antiga; o jsonb estruturado é descartado.';

revoke execute on function public.delete_filament_type(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_filament_type(uuid, uuid)
  to service_role;
