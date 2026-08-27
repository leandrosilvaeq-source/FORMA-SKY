-- Bloco 2 — Módulo 3 (Estoque e Inventário), Incremento 4 do plano de
-- estoque operacional (docs/05_ROADMAP_MODULOS.md §9b) — MVP de controle de
-- filamentos, quarta e última peça deste incremento: PREPARAÇÃO do modelo
-- de composição de produto para filamentos (requisito 9).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto. Aplicar exige autorização explícita separada.
--
-- ESCOPO EXPLÍCITO (requisito 9): implementar SOMENTE o MODELO (tabela +
-- function de escrita atômica), com integridade e testes, SEM ativar
-- consumo automático. Nenhuma automação lê esta tabela nesta rodada:
--   - Nenhum trigger em orders/order_items é criado ou alterado.
--   - create_order/update_order/change_order_status (Bloco 1) não são
--     tocados por esta migration.
--   - Nenhuma reserva/consumo de filamento é gerada a partir de um pedido.
-- O incremento de consumo automático (ler product_filaments × quantidade do
-- pedido para gerar filament_movements) é o PRÓXIMO incremento, ainda não
-- implementado — ver docs/05_ROADMAP_MODULOS.md §9b.
--
-- DECISÃO DE ARQUITETURA: product_filaments é uma tabela NOVA, independente
-- de product_accessories/product_packaging (20260816150000) — mesmo
-- raciocínio já documentado no comentário original daquela migration:
-- "quantity integer not null... unidades discretas... nunca fração, ao
-- contrário de filamento (gramas)". theoretical_weight_grams é numeric,
-- fracionário; reaproveitar product_accessories exigiria alterar uma coluna
-- integer já em produção só para acomodar um caso que ela nunca foi
-- desenhada para cobrir. set_product_composition (20260816150500) TAMBÉM
-- não é alterada — nenhuma modificação na function já testada/publicada que
-- edita a composição de acessórios/embalagens; set_product_filaments abaixo
-- é uma function nova e paralela, exclusiva de filamentos.
--
-- Interface de edição desta composição (formulário no Catálogo, análogo a
-- ProductCompositionForm.tsx) fica FORA DE ESCOPO nesta rodada — "preparar
-- o modelo" foi entendido como schema + function + testes, sem exigir UI
-- nova. A UI de composição por filamento é trabalho futuro, junto com o
-- consumo automático.
create table public.product_filaments (
  id uuid primary key default gen_random_uuid(),

  product_id uuid not null references public.products (id) on delete restrict,
  filament_type_id uuid not null references public.filament_types (id) on delete restrict,

  -- Peso teórico, em gramas, do tipo de filamento por unidade produzida —
  -- fracionário (numeric), ao contrário de product_accessories.quantity/
  -- product_packaging.quantity (integer).
  theoretical_weight_grams numeric(10, 2) not null check (theoretical_weight_grams > 0),

  created_at timestamptz not null default now(),

  -- Impede duas linhas para o mesmo tipo no mesmo produto — mesmo padrão de
  -- product_accessories/product_packaging.
  unique (product_id, filament_type_id)
);

comment on table public.product_filaments is
  'Preparação do modelo de composição de filamento por produto (Módulo 3, Incremento 4 — requisito 9): "quais tipos de filamento e quanto peso teórico por unidade produzida" um produto de Catálogo usa. NUNCA um ledger de estoque e NUNCA lido por nenhuma automação nesta etapa — consumo automático por pedido é incremento futuro, ainda não implementado. Escrita só via set_product_filaments (abaixo): substitui o conjunto inteiro atomicamente.';

create index idx_product_filaments_product_id
  on public.product_filaments (product_id);

alter table public.product_filaments enable row level security;

revoke all on public.product_filaments from anon;
revoke all on public.product_filaments from authenticated;
grant select on public.product_filaments to authenticated;

create policy "Active users can view product filaments"
  on public.product_filaments
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- set_product_filaments — substitui atomicamente a composição de filamentos
-- de um produto, mesmo idioma de set_product_composition (20260816150500),
-- mas com um único array (não dois) e sem tocar product_accessories/
-- product_packaging.
-- ---------------------------------------------------------------------------
create or replace function public.set_product_filaments(
  p_product_id uuid,
  p_filaments jsonb,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_filament_type_id uuid;
  v_weight numeric;
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'products.id % não encontrado', p_product_id;
  end if;

  if p_filaments is not null and jsonb_typeof(p_filaments) <> 'array' then
    raise exception 'set_product_filaments: p_filaments deve ser um array';
  end if;

  delete from public.product_filaments where product_id = p_product_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_filaments, '[]'::jsonb))
  loop
    v_filament_type_id := (v_item ->> 'id')::uuid;
    v_weight := (v_item ->> 'theoretical_weight_grams')::numeric;

    if not exists (
      select 1 from public.filament_types where id = v_filament_type_id and is_active
    ) then
      raise exception 'filament_types.id % não encontrado ou inativo', v_filament_type_id;
    end if;

    if v_weight is null or v_weight <= 0 then
      raise exception 'set_product_filaments: theoretical_weight_grams deve ser um número positivo (recebido %)', v_weight;
    end if;

    insert into public.product_filaments (product_id, filament_type_id, theoretical_weight_grams)
    values (p_product_id, v_filament_type_id, v_weight);
  end loop;
end;
$$;

comment on function public.set_product_filaments(uuid, jsonb, uuid) is
  'Substitui atomicamente a composição de filamentos (tipo + peso teórico em gramas) de um produto de Catálogo. Não movimenta estoque nem altera filament_spools.current_net_weight_grams — nenhuma automação de consumo é implementada por esta função (preparação de modelo, requisito 9).';

revoke execute on function public.set_product_filaments(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.set_product_filaments(uuid, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- delete_filament_type — adiciona o bloqueio por composição de produto,
-- agora que product_filaments existe. CREATE OR REPLACE (mesma assinatura),
-- combinando com o bloqueio por rolo já adicionado em
-- 20260827103000_create_filament_spools_table.sql.
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
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.filament_types where id = p_filament_type_id for update;
  if not found then
    raise exception 'filament_types.id % não encontrado', p_filament_type_id;
  end if;

  if exists (select 1 from public.filament_spools where filament_type_id = p_filament_type_id) then
    raise exception 'FILAMENT_TYPE_HAS_SPOOLS: Este tipo de filamento possui rolo(s) cadastrado(s) e não pode ser excluído. Desative o tipo.';
  end if;

  if exists (select 1 from public.product_filaments where filament_type_id = p_filament_type_id) then
    raise exception 'FILAMENT_TYPE_HAS_COMPOSITION: Este tipo de filamento está vinculado à composição de um produto e não pode ser excluído. Desative o tipo.';
  end if;

  delete from public.filament_types where id = p_filament_type_id;
end;
$$;

comment on function public.delete_filament_type(uuid, uuid) is
  'Exclusão física protegida de um tipo de filamento: bloqueada quando há rolo (FILAMENT_TYPE_HAS_SPOOLS:) ou composição de produto (FILAMENT_TYPE_HAS_COMPOSITION:) vinculados. Nenhuma exclusão em cascata.';

revoke execute on function public.delete_filament_type(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_filament_type(uuid, uuid)
  to service_role;
