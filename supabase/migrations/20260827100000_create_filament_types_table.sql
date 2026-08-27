-- Bloco 2 — Módulo 3 (Estoque e Inventário), Incremento 4 do plano de
-- estoque operacional (docs/05_ROADMAP_MODULOS.md §9b) — MVP de controle de
-- filamentos, primeira peça: o cadastro de TIPO de filamento.
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada, na branch
-- feature/inventory-operations). Aplicar exige autorização explícita
-- separada, fora do escopo desta entrada.
--
-- Regras aprovadas nesta rodada como HIPÓTESES INICIAIS DO MVP (sujeitas a
-- revisão após o uso real — mesmo disclaimer já usado em
-- docs/01_ESPECIFICACAO_FUNCIONAL.md §20 para as 22 regras de estoque):
--   - O tipo identifica comercialmente o filamento: material + fabricante +
--     linha + cor. Um tipo pode ter vários rolos físicos (filament_spools,
--     próxima migration) — o tipo nunca controla saldo diretamente, só
--     agrega (soma dos rolos ativos e utilizáveis, ver vw_filament_type_summary
--     na migration de movimentações).
--   - material é fechado (PLA/PETG/TPU) — ABS explicitamente NÃO faz parte
--     do MVP aprovado.
--   - line é LIVRE (texto, sem CHECK): "Sólida", "Silk", "Velvet",
--     "Translúcido", "DuoColor" são sugestões cadastráveis na interface, não
--     um enum travado no banco — mesma decisão já tomada para
--     accessories.size ser validado só em camada de aplicação quando o
--     requisito é "nunca limitar o cadastro de novos valores futuros" (aqui
--     ainda mais explícito: o pedido desta rodada pede literalmente para não
--     travar novas linhas). Ao contrário de accessories.size, não há sequer
--     um enum sugerido validado na Edge Function — a lista de 5 linhas é só
--     sugestão de interface (frontend), nunca validação de servidor.
--   - Divergência deliberada frente à especificação prévia (docs/03
--     §12.1, nunca implementada): o doc original não previa color_code nem
--     notes. Esta migration ACRESCENTA os dois campos porque o pedido desta
--     rodada os exige explicitamente ("código ou identificação da cor,
--     opcional"; "observações opcionais") — docs/03 será atualizado para
--     refletir o schema realmente implementado, nunca o inverso.
create table public.filament_types (
  id uuid primary key default gen_random_uuid(),

  material text not null check (material in ('PLA', 'PETG', 'TPU')),
  manufacturer text not null,
  line text not null,
  commercial_color text not null,

  -- Código/identificação da cor do fabricante (ex.: "PLA-BLK-01" ou um hex) —
  -- opcional, sem formato imposto (fabricantes diferentes usam convenções
  -- diferentes; validar um formato específico travaria fabricantes reais).
  color_code text,

  -- Peso mínimo de alerta, em gramas — nullable (sem alerta configurado),
  -- mesmo padrão de accessories.minimum_stock/packaging.minimum_stock
  -- (Migration 18), mas numeric (não integer): gramas são uma grandeza
  -- fracionável, ao contrário da contagem de unidades de acessórios/
  -- embalagens.
  minimum_stock_grams numeric(10, 2) check (minimum_stock_grams is null or minimum_stock_grams >= 0),

  is_active boolean not null default true,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Um tipo é definido pela combinação material+fabricante+linha+cor — a
  -- mesma combinação não pode ser cadastrada duas vezes (color_code fica de
  -- fora da chave: é só um identificador auxiliar do fabricante, não parte
  -- da definição comercial do tipo).
  unique (material, manufacturer, line, commercial_color)
);

comment on table public.filament_types is
  'Cadastro mestre de tipos de filamento (Módulo 3, Incremento 4 — MVP, regras sujeitas a revisão após uso real). Um tipo identifica comercialmente o filamento (material+fabricante+linha+cor); nunca controla saldo diretamente — a quantidade disponível é a soma dos rolos ativos e utilizáveis vinculados (filament_spools, próxima migration). Materiais aceitos nesta etapa: PLA, PETG, TPU (ABS explicitamente fora do MVP aprovado). Exclusão física bloqueada quando há rolo ou composição de produto vinculados (delete_filament_type, abaixo) — inativação lógica via is_active é sempre permitida.';

comment on column public.filament_types.line is
  'Texto livre, sem CHECK — "Sólida"/"Silk"/"Velvet"/"Translúcido"/"DuoColor" são sugestões de interface (frontend), nunca um enum travado no banco, para nunca impedir o cadastro de uma linha nova ainda não prevista.';

comment on column public.filament_types.minimum_stock_grams is
  'Limiar de alerta de estoque baixo, em gramas. Comparado contra a soma do peso disponível dos rolos ativos e utilizáveis do tipo (nunca contra o peso de um único rolo) — ver vw_filament_type_summary.';

create trigger set_filament_types_updated_at
  before update on public.filament_types
  for each row
  execute function public.set_updated_at();

alter table public.filament_types enable row level security;

revoke all on public.filament_types from anon;
revoke all on public.filament_types from authenticated;
-- Somente leitura direta — toda escrita passa pelas 3 functions abaixo,
-- mesmo padrão já estabelecido para accessories/packaging
-- (20260822120000_create_accessory_write_functions.sql):
-- security definer, EXECUTE só para service_role, chamadas exclusivamente
-- pela Edge Function `filament-types`.
grant select on public.filament_types to authenticated;

create policy "Active users can view filament types"
  on public.filament_types
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- create_filament_type
-- ---------------------------------------------------------------------------
create or replace function public.create_filament_type(
  p_material text,
  p_manufacturer text,
  p_line text,
  p_commercial_color text,
  p_color_code text,
  p_minimum_stock_grams numeric,
  p_is_active boolean,
  p_notes text,
  p_changed_by uuid
)
returns public.filament_types
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manufacturer text;
  v_line text;
  v_commercial_color text;
  v_row public.filament_types;
begin
  perform public.assert_active_user(p_changed_by);

  if p_material is null or p_material not in ('PLA', 'PETG', 'TPU') then
    raise exception 'filament_types.material inválido: % (esperado PLA, PETG ou TPU)', p_material;
  end if;

  v_manufacturer := btrim(coalesce(p_manufacturer, ''));
  if v_manufacturer = '' then
    raise exception 'filament_types.manufacturer não pode ser vazio nem null';
  end if;

  v_line := btrim(coalesce(p_line, ''));
  if v_line = '' then
    raise exception 'filament_types.line não pode ser vazio nem null';
  end if;

  v_commercial_color := btrim(coalesce(p_commercial_color, ''));
  if v_commercial_color = '' then
    raise exception 'filament_types.commercial_color não pode ser vazio nem null';
  end if;

  insert into public.filament_types (
    material, manufacturer, line, commercial_color, color_code,
    minimum_stock_grams, is_active, notes
  ) values (
    p_material, v_manufacturer, v_line, v_commercial_color, nullif(btrim(coalesce(p_color_code, '')), ''),
    p_minimum_stock_grams, coalesce(p_is_active, true), nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_filament_type(text, text, text, text, text, numeric, boolean, text, uuid) is
  'Cria um tipo de filamento do cadastro mestre (Módulo 3, Incremento 4). material restrito a PLA/PETG/TPU; line é texto livre (sem CHECK).';

revoke execute on function public.create_filament_type(text, text, text, text, text, numeric, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_filament_type(text, text, text, text, text, numeric, boolean, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- update_filament_type — semântica PATCH via jsonb_whitelist, mesmo idioma
-- de update_accessory/update_packaging.
-- ---------------------------------------------------------------------------
create or replace function public.update_filament_type(
  p_filament_type_id uuid,
  p_patch jsonb,
  p_changed_by uuid
)
returns public.filament_types
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patch jsonb;
  v_unknown_keys text[];
  v_material text;
  v_manufacturer text;
  v_line text;
  v_commercial_color text;
  v_row public.filament_types;
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.filament_types where id = p_filament_type_id for update;
  if not found then
    raise exception 'filament_types.id % não encontrado', p_filament_type_id;
  end if;

  select array_agg(key) into v_unknown_keys
    from jsonb_each(coalesce(p_patch, '{}'::jsonb))
    where key <> all(array[
      'material', 'manufacturer', 'line', 'commercial_color', 'color_code',
      'minimum_stock_grams', 'is_active', 'notes'
    ]);

  if v_unknown_keys is not null and array_length(v_unknown_keys, 1) > 0 then
    raise exception 'update_filament_type: chave(s) não suportada(s) em p_patch: %', array_to_string(v_unknown_keys, ', ');
  end if;

  v_patch := public.jsonb_whitelist(p_patch, array[
    'material', 'manufacturer', 'line', 'commercial_color', 'color_code',
    'minimum_stock_grams', 'is_active', 'notes'
  ]);

  if v_patch = '{}'::jsonb then
    raise exception 'update_filament_type: p_patch vazio, informe ao menos um campo reconhecido';
  end if;

  if v_patch ? 'material' then
    v_material := v_patch ->> 'material';
    if v_material is null or v_material not in ('PLA', 'PETG', 'TPU') then
      raise exception 'filament_types.material inválido: % (esperado PLA, PETG ou TPU)', v_material;
    end if;
  end if;

  if v_patch ? 'manufacturer' then
    v_manufacturer := btrim(coalesce(v_patch ->> 'manufacturer', ''));
    if v_manufacturer = '' then
      raise exception 'filament_types.manufacturer não pode ser vazio nem null';
    end if;
  end if;

  if v_patch ? 'line' then
    v_line := btrim(coalesce(v_patch ->> 'line', ''));
    if v_line = '' then
      raise exception 'filament_types.line não pode ser vazio nem null';
    end if;
  end if;

  if v_patch ? 'commercial_color' then
    v_commercial_color := btrim(coalesce(v_patch ->> 'commercial_color', ''));
    if v_commercial_color = '' then
      raise exception 'filament_types.commercial_color não pode ser vazio nem null';
    end if;
  end if;

  update public.filament_types
    set material = case when v_patch ? 'material' then v_material else material end,
        manufacturer = case when v_patch ? 'manufacturer' then v_manufacturer else manufacturer end,
        line = case when v_patch ? 'line' then v_line else line end,
        commercial_color = case when v_patch ? 'commercial_color' then v_commercial_color else commercial_color end,
        color_code = case when v_patch ? 'color_code' then nullif(btrim(coalesce(v_patch ->> 'color_code', '')), '') else color_code end,
        minimum_stock_grams = case when v_patch ? 'minimum_stock_grams'
                                 then nullif(v_patch ->> 'minimum_stock_grams', '')::numeric
                                 else minimum_stock_grams end,
        is_active = case when v_patch ? 'is_active' then (v_patch ->> 'is_active')::boolean else is_active end,
        notes = case when v_patch ? 'notes' then nullif(btrim(coalesce(v_patch ->> 'notes', '')), '') else notes end
    where id = p_filament_type_id
    returning * into v_row;

  return v_row;
end;
$$;

comment on function public.update_filament_type(uuid, jsonb, uuid) is
  'Edita um tipo de filamento e/ou ativa/desativa (is_active é só mais uma chave do mesmo patch). Chave ausente em p_patch preserva o valor atual.';

revoke execute on function public.update_filament_type(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.update_filament_type(uuid, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- delete_filament_type — exclusão física protegida
-- ---------------------------------------------------------------------------
-- Bloqueada quando há rolo físico (filament_spools, próxima migration) ou
-- composição de produto (product_filaments, migration futura desta mesma
-- rodada) vinculados. Ambas as tabelas ainda não existem neste ponto da
-- migration — a checagem correspondente é adicionada em
-- 20260827103000_create_filament_spools_table.sql e
-- 20260827109000_create_product_filaments_table.sql via CREATE OR REPLACE,
-- nunca uma segunda function paralela.
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

  delete from public.filament_types where id = p_filament_type_id;
end;
$$;

comment on function public.delete_filament_type(uuid, uuid) is
  'Exclusão física de um tipo de filamento. Nesta migration ainda sem nenhum bloqueio (filament_spools/product_filaments não existem ainda) — CREATE OR REPLACE nas migrations seguintes adiciona os bloqueios FILAMENT_TYPE_HAS_SPOOLS:/FILAMENT_TYPE_HAS_COMPOSITION: assim que as tabelas correspondentes existirem.';

revoke execute on function public.delete_filament_type(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_filament_type(uuid, uuid)
  to service_role;
