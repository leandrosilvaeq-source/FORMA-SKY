-- Bloco 1 — Módulo 3 (Estoque e Inventário), Incremento 1 (continuação) —
-- atualiza delete_accessory/delete_packaging para também bloquear exclusão
-- física quando o item já teve QUALQUER movimentação de estoque registrada
-- em public.stock_movements (criada pela migration anterior,
-- 20260827090000_create_stock_movements_table.sql).
--
-- Esta é exatamente a lacuna que os comentários originais dessas duas
-- functions já anteciparam (20260822120000_create_accessory_write_functions.sql,
-- 20260823120000_create_packaging_write_functions.sql): "quando
-- stock_movements/stock_reservations existirem... esta function deverá
-- também verificar vínculos nessas tabelas". stock_movements agora existe;
-- stock_reservations continua não implementada (Incremento 7, futuro) e não
-- é referenciada aqui.
--
-- CREATE OR REPLACE FUNCTION com a MESMA assinatura de tipos das duas
-- funções originais — (uuid, uuid) returns void para ambas — portanto
-- substitui a mesma entrada de catálogo/OID, sem criar sobrecarga nova e
-- sem exigir novos grants (os já concedidos em
-- 20260822120000/20260823120000 permanecem válidos).
--
-- Verificações preservadas sem alteração: a checagem de vínculo em
-- product_accessories/product_packaging continua exatamente igual, na
-- mesma ordem relativa (antes da nova checagem de histórico de estoque).
-- Nenhum registro existente em accessories/packaging/product_accessories/
-- product_packaging é alterado por esta migration — só o corpo das duas
-- functions muda.
--
-- CONCORRÊNCIA — o `select ... for update` já existente em ambas as
-- functions (linha do próprio accessories/packaging) continua sendo o
-- único lock necessário: stock_movements.item_id não é uma foreign key
-- (campo polimórfico, ver comentário em stock_movements.item_id), então
-- não há o mecanismo de FOR KEY SHARE via FK que já protegia a checagem de
-- product_accessories/product_packaging. Em vez disso, a proteção vem da
-- MESMA convenção documentada em register_stock_movement() (migration
-- anterior): toda function que escreve o estado de estoque de um item
-- primeiro obtém FOR UPDATE na linha desse item em accessories/packaging.
-- register_stock_movement() faz exatamente isso antes de inserir em
-- stock_movements — logo, uma chamada concorrente a
-- register_stock_movement() para o MESMO item disputa o mesmo lock de
-- linha que delete_accessory/delete_packaging já seguram, e as duas ordens
-- possíveis ficam serializadas (quem chega primeiro bloqueia quem chega
-- depois até commit/rollback) exatamente como já valia para a checagem de
-- product_accessories/product_packaging.

-- ---------------------------------------------------------------------------
-- delete_accessory — agora também bloqueado por histórico de estoque
-- ---------------------------------------------------------------------------
create or replace function public.delete_accessory(
  p_accessory_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.accessories where id = p_accessory_id for update;
  if not found then
    raise exception 'accessories.id % não encontrado', p_accessory_id;
  end if;

  if exists (select 1 from public.product_accessories where accessory_id = p_accessory_id) then
    raise exception 'ACCESSORY_IN_USE: Este acessório está vinculado a um produto e não pode ser excluído. Desative o item.';
  end if;

  -- Nova checagem (Módulo 3, Incremento 1): qualquer movimentação
  -- histórica (INITIAL_BALANCE, PURCHASE, ajuste, perda etc.) também
  -- impede a exclusão física — o histórico de estoque nunca pode ficar
  -- órfão de item_id.
  if exists (
    select 1 from public.stock_movements
    where item_type = 'ACCESSORY' and item_id = p_accessory_id
  ) then
    raise exception 'ACCESSORY_HAS_STOCK_HISTORY: Este acessório já teve movimentação de estoque registrada e não pode ser excluído. Desative o item.';
  end if;

  delete from public.accessories where id = p_accessory_id;
end;
$$;

comment on function public.delete_accessory(uuid, uuid) is
  'Exclusão física protegida de um acessório: bloqueada quando há vínculo em product_accessories (ACCESSORY_IN_USE:) OU quando há qualquer movimentação em stock_movements (ACCESSORY_HAS_STOCK_HISTORY:, adicionado em 2026-08-27). Nenhuma exclusão em cascata em nenhum dos dois casos. Bloqueio orienta desativação em vez de exclusão.';

revoke execute on function public.delete_accessory(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_accessory(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- delete_packaging — agora também bloqueado por histórico de estoque
-- ---------------------------------------------------------------------------
create or replace function public.delete_packaging(
  p_packaging_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.packaging where id = p_packaging_id for update;
  if not found then
    raise exception 'packaging.id % não encontrado', p_packaging_id;
  end if;

  if exists (select 1 from public.product_packaging where packaging_id = p_packaging_id) then
    raise exception 'PACKAGING_IN_USE: Esta embalagem está vinculada a um produto e não pode ser excluída. Desative o item.';
  end if;

  -- Nova checagem (Módulo 3, Incremento 1): mesma regra de
  -- delete_accessory, espelhada para packaging.
  if exists (
    select 1 from public.stock_movements
    where item_type = 'PACKAGING' and item_id = p_packaging_id
  ) then
    raise exception 'PACKAGING_HAS_STOCK_HISTORY: Esta embalagem já teve movimentação de estoque registrada e não pode ser excluída. Desative o item.';
  end if;

  delete from public.packaging where id = p_packaging_id;
end;
$$;

comment on function public.delete_packaging(uuid, uuid) is
  'Exclusão física protegida de uma embalagem: bloqueada quando há vínculo em product_packaging (PACKAGING_IN_USE:) OU quando há qualquer movimentação em stock_movements (PACKAGING_HAS_STOCK_HISTORY:, adicionado em 2026-08-27). Nenhuma exclusão em cascata em nenhum dos dois casos. Bloqueio orienta desativação em vez de exclusão.';

revoke execute on function public.delete_packaging(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_packaging(uuid, uuid)
  to service_role;
