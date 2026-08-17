-- Bloco 1 — Clientes e Pedidos
-- Migration 19: public.set_product_composition()
--
-- Único caminho de escrita para product_accessories/product_packaging
-- (Migration 18, que já revoga todo INSERT/UPDATE/DELETE direto dessas duas
-- tabelas a authenticated). Substitui o conjunto inteiro da composição de um
-- produto atomicamente: apaga as linhas atuais e insere o novo conjunto na
-- mesma transação — nunca um PATCH incremental linha a linha.
--
-- Validação de estrutura do jsonb: mesma decisão já documentada em
-- create_order (Migration 15) — os campos de cada item (id, quantity) não
-- são revalidados aqui além do necessário para o INSERT; se vierem
-- ausentes/malformados, a extração/cast resulta em erro ou NULL e a própria
-- constraint da tabela (NOT NULL/CHECK/FK, Migration 18) rejeita com uma
-- mensagem clara. A Edge Function (products/index.ts) já valida forma e tipo
-- de cada item antes de chamar esta função — a validação aqui é uma segunda
-- camada, não a primeira.
--
-- Nenhuma linha de accessories/packaging é lida além do necessário para
-- confirmar existência/is_active — esta função NUNCA lê nem escreve
-- current_stock, e não gera nenhuma linha em stock_movements/inventory_items
-- (nenhuma das duas tabelas existe nesta etapa).
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
begin
  perform public.assert_active_user(p_changed_by);

  -- Trava products (não as tabelas de composição): serializa duas chamadas
  -- concorrentes de set_product_composition para o mesmo produto, mesmo
  -- padrão de update_product_price.
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

  delete from public.product_accessories where product_id = p_product_id;
  delete from public.product_packaging where product_id = p_product_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_accessories, '[]'::jsonb))
  loop
    v_accessory_id := (v_item ->> 'id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    -- "não encontrado" no texto reaproveita o padrão já reconhecido por
    -- RAISE_EXCEPTION_PATTERNS (supabase/functions/_shared/errors.ts) —
    -- nenhuma alteração necessária naquele arquivo.
    if not exists (
      select 1 from public.accessories where id = v_accessory_id and is_active
    ) then
      raise exception 'accessories.id % não encontrado ou inativo', v_accessory_id;
    end if;

    insert into public.product_accessories (product_id, accessory_id, quantity)
    values (p_product_id, v_accessory_id, v_quantity);
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_packaging, '[]'::jsonb))
  loop
    v_packaging_id := (v_item ->> 'id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    if not exists (
      select 1 from public.packaging where id = v_packaging_id and is_active
    ) then
      raise exception 'packaging.id % não encontrado ou inativo', v_packaging_id;
    end if;

    insert into public.product_packaging (product_id, packaging_id, quantity)
    values (p_product_id, v_packaging_id, v_quantity);
  end loop;
end;
$$;

comment on function public.set_product_composition(uuid, jsonb, jsonb, uuid) is
  'Substitui atomicamente a composição padrão (acessórios/embalagens + quantidade) de um produto de Catálogo: apaga as linhas atuais de product_accessories/product_packaging e insere o novo conjunto na mesma transação. Não movimenta estoque nem altera accessories.current_stock/packaging.current_stock — nenhuma automação de estoque é implementada por esta função.';

revoke execute on function public.set_product_composition(uuid, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.set_product_composition(uuid, jsonb, jsonb, uuid)
  to service_role;
