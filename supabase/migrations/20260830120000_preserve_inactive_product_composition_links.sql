-- Bloco 1 — Clientes e Pedidos
-- Migration corretiva: preserva vínculo INATIVO HISTÓRICO em
-- set_product_composition() (20260816150500_create_product_composition_function.sql,
-- nunca redefinida até agora).
--
-- BLOQUEIO ENCONTRADO (rodada anterior, frontend): o formulário de Produto
-- já foi corrigido para mostrar um acessório/embalagem inativo já vinculado,
-- permitir preservá-lo (com quantidade editável) e nunca exigir sua remoção
-- para salvar outra alteração. Mas o payload resultante ainda era rejeitado
-- pelo banco: set_product_composition (chamada por create_product_with_plates
-- e update_product_full, e pelo diálogo independente "Acessórios e
-- Embalagem" da listagem) exige `is_active` para TODO accessory_id/
-- packaging_id no array recebido, sem nenhuma exceção para um vínculo que já
-- existia antes do item ser desativado — deixar o frontend enviar e só
-- mostrar o erro do banco depois não resolve a preservação histórica
-- pedida, só troca "bloqueado no frontend" por "bloqueado no backend com uma
-- mensagem pior".
--
-- REGRA NOVA (única mudança desta migration): um accessory_id/packaging_id é
-- aceito quando ESTÁ ATIVO, OU quando já estava vinculado a ESTE MESMO
-- produto imediatamente antes desta chamada. Nunca um histórico global/
-- permanente — não existe (e esta migration não cria) nenhuma tabela ou
-- coluna de "itens que já estiveram vinculados algum dia"; a única fonte da
-- exceção é o conjunto de product_accessories/product_packaging deste
-- produto capturado no INÍCIO desta própria chamada, antes do delete. Um
-- item inativo nunca vinculado a este produto (nem vinculado só a OUTRO
-- produto, nem removido numa chamada anterior e reintroduzido depois)
-- continua rejeitado exatamente como antes.
--
-- Assinatura, retorno, autenticação (assert_active_user), lock de products
-- (for update — já suficiente para a concorrência abaixo, nenhum lock novo
-- necessário), validação de tipo dos arrays, delete+reinsert atômico,
-- CHECK de quantidade (product_accessories/product_packaging.quantity > 0,
-- Migration 18) e UNIQUE (product_id, accessory_id|packaging_id) contra
-- duplicidade — todos preservados byte a byte. security definer/
-- search_path=''/owner/grants (revoke de public/anon/authenticated, grant só
-- a service_role) reafirmados abaixo, inalterados.
--
-- CONCORRÊNCIA — por que a captura do vínculo anterior é segura sem nenhum
-- lock adicional: toda escrita em product_accessories/product_packaging
-- acontece exclusivamente dentro desta function (RLS + grants das duas
-- tabelas nunca concederam INSERT/UPDATE/DELETE a authenticated — Migration
-- 18 — e nenhuma outra function grava nelas). O `perform ... for update` em
-- products, já existente na function original, serializa duas chamadas
-- concorrentes desta function para o MESMO produto: a segunda só entra
-- depois que a primeira faz COMMIT ou ROLLBACK, e portanto sempre enxerga o
-- estado final e consistente que a primeira deixou — nunca um estado
-- intermediário. Dentro de uma única chamada, a captura acontece DEPOIS do
-- lock e ANTES do delete, na mesma transação implícita da function: não há
-- nenhuma janela em que outra sessão possa gravar nessas tabelas para este
-- produto entre a captura e o delete. Se o loop de inserção falhar em
-- qualquer ponto (item inválido, duplicidade, quantidade inválida), a
-- exceção propaga para fora da function e o Postgres desfaz TODA a
-- transação — o delete já executado, os inserts parciais já executados e a
-- captura em si são todos revertidos juntos; a composição anterior nunca
-- fica perdida por uma tentativa que falhou (mesma garantia de atomicidade
-- que a function original já tinha, agora também coberta pelos novos testes
-- SQL — ver supabase/tests/product_composition_inactive_links_test.sql).
create or replace function public.set_product_composition(
  p_product_id uuid,
  p_accessories jsonb,
  p_packaging jsonb,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_accessory_id uuid;
  v_packaging_id uuid;
  v_quantity integer;
  v_previous_accessory_ids uuid[];
  v_previous_packaging_ids uuid[];
begin
  perform public.assert_active_user(p_changed_by);

  -- Trava products (não as tabelas de composição): serializa duas chamadas
  -- concorrentes de set_product_composition para o mesmo produto, mesmo
  -- padrão de update_product_price — ver nota de concorrência acima para o
  -- porquê de bastar esta trava, mesmo com a captura de vínculo anterior
  -- adicionada nesta migration.
  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'products.id % não encontrado', p_product_id;
  end if;

  if p_accessories is not null and jsonb_typeof(p_accessories) <> 'array' then
    raise exception 'set_product_composition: p_accessories deve ser um array';
  end if;
  if p_packaging is not null and jsonb_typeof(p_packaging) <> 'array' then
    raise exception 'set_product_composition: p_packaging deve ser um array';
  end if;

  -- Vínculo IMEDIATAMENTE ANTERIOR a esta operação — capturado DEPOIS do
  -- lock acima e ANTES do delete abaixo, na mesma transação implícita desta
  -- function. É a ÚNICA fonte da exceção "inativo histórico": nunca um
  -- histórico global, nunca persistido em nenhuma tabela própria — some
  -- automaticamente assim que este produto deixar de tê-lo vinculado (a
  -- próxima chamada simplesmente não o encontra mais aqui).
  select coalesce(array_agg(accessory_id), '{}'::uuid[]) into v_previous_accessory_ids
    from public.product_accessories where product_id = p_product_id;
  select coalesce(array_agg(packaging_id), '{}'::uuid[]) into v_previous_packaging_ids
    from public.product_packaging where product_id = p_product_id;

  delete from public.product_accessories where product_id = p_product_id;
  delete from public.product_packaging where product_id = p_product_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_accessories, '[]'::jsonb))
  loop
    v_accessory_id := (v_item ->> 'id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    -- Aceito quando ATIVO, OU quando já constava em v_previous_accessory_ids
    -- (vínculo com ESTE produto, capturado acima) — um id inexistente, um id
    -- inativo nunca vinculado a este produto, um id inativo vinculado só a
    -- OUTRO produto, ou um id inativo já removido deste produto numa chamada
    -- anterior caem todos fora das duas condições e são rejeitados aqui,
    -- exatamente como antes desta migration.
    if not exists (
      select 1 from public.accessories
      where id = v_accessory_id
        and (is_active or id = any(v_previous_accessory_ids))
    ) then
      raise exception 'accessories.id % não encontrado, inativo e sem vínculo anterior com este produto', v_accessory_id;
    end if;

    insert into public.product_accessories (product_id, accessory_id, quantity)
    values (p_product_id, v_accessory_id, v_quantity);
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_packaging, '[]'::jsonb))
  loop
    v_packaging_id := (v_item ->> 'id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    if not exists (
      select 1 from public.packaging
      where id = v_packaging_id
        and (is_active or id = any(v_previous_packaging_ids))
    ) then
      raise exception 'packaging.id % não encontrado, inativo e sem vínculo anterior com este produto', v_packaging_id;
    end if;

    insert into public.product_packaging (product_id, packaging_id, quantity)
    values (p_product_id, v_packaging_id, v_quantity);
  end loop;
end;
$$;

comment on function public.set_product_composition(uuid, jsonb, jsonb, uuid) is
  'Substitui atomicamente a composição padrão (acessórios/embalagens + quantidade) de um produto de Catálogo: apaga as linhas atuais de product_accessories/product_packaging e insere o novo conjunto na mesma transação. Um accessory_id/packaging_id inativo é aceito somente se já estava vinculado a ESTE MESMO produto imediatamente antes desta chamada (nunca um histórico global/permanente, nunca em Produto novo, nunca vínculo de outro produto) — permite editar outros campos do Produto ou ajustar a quantidade de um item já vinculado sem exigir sua remoção, sem nunca permitir uma associação NOVA a um item inativo. Não movimenta estoque nem altera accessories.current_stock/packaging.current_stock — nenhuma automação de estoque é implementada por esta função.';

revoke execute on function public.set_product_composition(uuid, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.set_product_composition(uuid, jsonb, jsonb, uuid)
  to service_role;
