-- Bloco 1 — Produtos
-- Migration: public.update_product — edição controlada dos campos
-- descritivos/de produção de um produto de Catálogo, com whitelist
-- explícita (ajuste solicitado pelo usuário em 2026-08-29, ver
-- docs/05_ROADMAP_MODULOS.md). Substitui o botão "Alterar preço" por
-- "Editar produto" no frontend — o preço continua editável só por
-- update_product_price (20260814030351), nunca por esta function.
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada). Aplicar exige autorização
-- explícita separada, fora do escopo desta entrada.
--
-- Nenhuma tabela é alterada. Campos deliberadamente FORA da whitelist desta
-- function (cada um por um motivo já documentado em outro lugar do banco,
-- nenhum reaberto aqui):
--   - default_price: só update_product_price grava histórico
--     (product_price_history) — permitir aqui duplicaria/contornaria essa
--     regra, exatamente o que o pedido do usuário pede para nunca acontecer;
--   - is_active: já editável via UPDATE direto grant a authenticated
--     (20260813205942_create_products_table.sql) — mecanismo diferente,
--     não tocado por esta migration;
--   - product_type: classificação de criação (CATALOG/CUSTOM/SPOT,
--     20260821090000_add_product_type.sql); mudar o tipo de um produto já
--     em uso em pedidos é uma operação de maior risco, fora do pedido atual
--     ("permitir editar somente campos realmente suportados");
--   - units_per_plate: legado, já removido de "Novo produto" e da Ficha
--     Técnica (não exibido/editável em nenhuma tela) — continua assim.
--
-- Mesmo idioma PATCH via jsonb_whitelist + CASE WHEN <chave> ? de
-- update_accessory/update_packaging/update_filament_type — chave ausente em
-- p_patch preserva o valor atual; chave fora da whitelist é REJEITADA (não
-- só silenciosamente descartada); p_patch vazio/só-com-chaves-desconhecidas
-- nunca vira um UPDATE "vazio" silencioso.
create or replace function public.update_product(
  p_product_id uuid,
  p_patch jsonb,
  p_changed_by uuid
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patch jsonb;
  v_unknown_keys text[];
  v_name text;
  v_row public.products;
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'products.id % não encontrado', p_product_id;
  end if;

  select array_agg(key) into v_unknown_keys
    from jsonb_each(coalesce(p_patch, '{}'::jsonb))
    where key <> all(array[
      'name', 'category', 'description', 'default_print_time_seconds',
      'default_weight_grams', 'default_file_id', 'allows_personalization'
    ]);

  if v_unknown_keys is not null and array_length(v_unknown_keys, 1) > 0 then
    raise exception 'update_product: chave(s) não suportada(s) em p_patch: %', array_to_string(v_unknown_keys, ', ');
  end if;

  v_patch := public.jsonb_whitelist(p_patch, array[
    'name', 'category', 'description', 'default_print_time_seconds',
    'default_weight_grams', 'default_file_id', 'allows_personalization'
  ]);

  if v_patch = '{}'::jsonb then
    raise exception 'update_product: p_patch vazio, informe ao menos um campo reconhecido';
  end if;

  if v_patch ? 'name' then
    v_name := btrim(v_patch ->> 'name');
    if v_name is null or v_name = '' then
      raise exception 'products.name não pode ser vazio nem null';
    end if;
  end if;

  update public.products
    set name = case when v_patch ? 'name' then v_name else name end,
        category = case when v_patch ? 'category' then v_patch ->> 'category' else category end,
        description = case when v_patch ? 'description' then v_patch ->> 'description' else description end,
        default_print_time_seconds = case when v_patch ? 'default_print_time_seconds'
                                        then nullif(v_patch ->> 'default_print_time_seconds', '')::integer
                                        else default_print_time_seconds end,
        default_weight_grams = case when v_patch ? 'default_weight_grams'
                                  then nullif(v_patch ->> 'default_weight_grams', '')::numeric
                                  else default_weight_grams end,
        default_file_id = case when v_patch ? 'default_file_id'
                             then nullif(v_patch ->> 'default_file_id', '')::uuid
                             else default_file_id end,
        allows_personalization = case when v_patch ? 'allows_personalization'
                                    then coalesce((v_patch ->> 'allows_personalization')::boolean, allows_personalization)
                                    else allows_personalization end
    where id = p_product_id
    returning * into v_row;

  return v_row;
end;
$$;

comment on function public.update_product(uuid, jsonb, uuid) is
  'Edita os campos descritivos/de produção de um produto de Catálogo (name/category/description/default_print_time_seconds/default_weight_grams/default_file_id/allows_personalization). Nunca altera default_price (só update_product_price), is_active (grant direto já existente) nem product_type/units_per_plate (fora de escopo). Chave ausente em p_patch preserva o valor atual.';

revoke execute on function public.update_product(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.update_product(uuid, jsonb, uuid)
  to service_role;
