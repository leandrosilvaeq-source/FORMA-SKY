-- Bloco 1 — Produtos e Pedidos
-- Migration: múltiplas categorias por Produto, peso direto por plate
-- (removendo filamentos/cores do cadastro do Produto) e escolha de
-- filamentos/cores por UNIDADE/PLATE movida para o Pedido, com snapshot da
-- estrutura produtiva no momento da criação do item (decisão aprovada
-- 2026-08-29, ver docs/05_ROADMAP_MODULOS.md).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto nesta rodada (só criada localmente). Aplicar exige autorização
-- explícita separada, fora do escopo desta entrada. O remoto continua hoje
-- na migration anterior (20260829160000) — Produto com composição de
-- filamentos, categoria única.
--
-- RESUMO DAS MUDANÇAS:
--   1) product_categories — Produto passa a ter N categorias (chips),
--      substituindo a seleção única. products.category vira um espelho
--      DERIVADO (sempre = primeira categoria por posição, escrito só por
--      set_product_categories — nunca uma segunda fonte independente).
--   2) product_plates.weight_grams — peso do plate passa a ser informado
--      DIRETAMENTE (não mais somado de product_plate_filaments). Filamentos/
--      cores somem do cadastro do Produto por completo.
--   3) product_plate_filaments e product_filaments (as DUAS estruturas de
--      composição de filamento no Produto, a nova por plate e a antiga
--      flat) passam a ser LEGADAS/históricas — nenhuma tela ou fluxo do
--      Produto lê ou escreve nelas a partir desta migration.
--   4) Filamentos/cores por UNIDADE não desaparecem do sistema — MUDAM DE
--      LUGAR: passam a ser escolhidos no PEDIDO (order_item_unit_plate_filaments),
--      por unidade e por plate, com um snapshot congelado da estrutura
--      produtiva do Produto no momento da criação do item
--      (order_item_plates) — editar o Produto depois nunca muda um Pedido
--      já criado.
--   5) Pedido CATALOG pode entrar em IN_PRODUCTION_QUEUE sem nenhuma cor
--      definida — cores só se tornam obrigatórias para avançar de
--      IN_PRODUCTION_QUEUE para IN_PRODUCTION (gate novo em
--      change_order_status). Validação de criação passa a exigir só
--      estrutura produtiva (plate com peso/tempo), nunca mais filamento.
--
-- CONFLITO DE FK RESOLVIDO EXPLICITAMENTE (product_plate_filaments):
-- set_product_production() continua substituindo TODO o conjunto de plates
-- de um Produto a cada edição (delete+reinsert, mesmo padrão desde
-- 20260829160000) — mas agora nunca mais escreve composição de filamento
-- alguma. Um único Produto real hoje ("teste - Produtos") ainda tem linhas
-- legadas em product_plate_filaments presas aos plates atuais por FK
-- ON DELETE RESTRICT — isso bloquearia PARA SEMPRE qualquer edição futura
-- desse Produto (o delete dos plates falharia). A FK é alterada aqui para
-- ON DELETE CASCADE: se um plate for substituído pelo fluxo normal de
-- edição, as linhas legadas de product_plate_filaments PRESAS A ESSE PLATE
-- ESPECÍFICO são removidas como consequência estrutural inevitável da
-- própria FK — nunca por um DELETE direto/deliberado na tabela legada, e
-- nunca em massa fora do ciclo de vida normal de edição de plates. Fora
-- desse cenário (nenhuma edição de plates), as linhas legadas permanecem
-- exatamente como estão. product_filaments (a tabela flat, sem relação de
-- FK com product_plates) NÃO tem este conflito — permanece 100% intocada,
-- sem exceção.
--
-- Nenhuma reserva ou consumo de estoque é implementado por esta migration
-- — peso por plate e composição por unidade continuam sendo só modelo/
-- registro, nenhuma automação lê estas tabelas para movimentar estoque.

-- =============================================================================
-- 1) product_categories — múltiplas categorias por Produto (substitui a
--    seleção única). Chave estrangeira/unicidade/índices/timestamps no
--    mesmo padrão de product_plates/product_accessories.
-- =============================================================================
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),

  product_id uuid not null references public.products (id) on delete restrict,

  -- Texto livre (uma das opções pré-definidas do frontend OU um valor
  -- digitado em "Outro") — mesma liberdade que a coluna products.category
  -- (legada) já tinha; nenhum enum/check de valores fixos aqui, pelo mesmo
  -- motivo que products.category nunca teve.
  category text not null check (length(trim(category)) > 0),

  -- Posição/ordem de seleção (1..N, sem buraco) — atribuída por
  -- set_product_categories() a partir da posição no array recebido, nunca
  -- informada livremente. categories[1] (position=1) é o valor espelhado
  -- em products.category.
  position integer not null check (position > 0),

  created_at timestamptz not null default now(),

  -- Nunca a mesma categoria duas vezes no mesmo Produto; nunca duas
  -- categorias na mesma posição.
  unique (product_id, category),
  unique (product_id, position)
);

comment on table public.product_categories is
  'Categorias (N por Produto) — fonte AUTORITATIVA a partir desta migration, substituindo products.category como seleção única. products.category passa a ser um espelho DERIVADO (sempre = categoria de position=1, ou NULL se nenhuma) — escrito exclusivamente por set_product_categories(), nunca uma segunda fonte independente. Escrita só via set_product_categories() (chamada de dentro de create_product_with_plates/update_product_full).';

create index idx_product_categories_product_id on public.product_categories (product_id);

alter table public.product_categories enable row level security;

revoke all on public.product_categories from anon;
revoke all on public.product_categories from authenticated;
grant select on public.product_categories to authenticated;

create policy "Active users can view product categories"
  on public.product_categories
  for select
  to authenticated
  using (public.is_active_user());

-- =============================================================================
-- 2) set_product_categories — função INTERNA (zero grants, mesmo padrão de
--    set_product_production/jsonb_whitelist/assert_active_user): substitui
--    atomicamente o conjunto inteiro de categorias de um Produto e
--    atualiza o espelho em products.category. Chamada só de dentro de
--    create_product_with_plates/update_product_full (Seção 4/5).
--
--    p_categories: array jsonb de strings, na ORDEM de seleção do usuário
--    (a posição no array define `position`, nunca um campo separado no
--    payload). Array vazio/null é válido — "categoria continua opcional",
--    mesma regra que products.category (nullable) já tinha.
-- =============================================================================
create or replace function public.set_product_categories(
  p_product_id uuid,
  p_categories jsonb,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
  v_index integer := 0;
  v_first_category text;
  v_seen text[] := '{}';
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'products.id % não encontrado', p_product_id;
  end if;

  if p_categories is not null and jsonb_typeof(p_categories) <> 'array' then
    raise exception 'p_categories deve ser um array ou null';
  end if;

  delete from public.product_categories where product_id = p_product_id;

  if p_categories is not null then
    for v_category in select trim(both from value) from jsonb_array_elements_text(p_categories) as value
    loop
      v_index := v_index + 1;

      if v_category = '' then
        raise exception 'Categoria %: não pode ser vazia.', v_index;
      end if;
      if v_category = any(v_seen) then
        raise exception 'Categoria "%" repetida — cada categoria só pode aparecer uma vez.', v_category;
      end if;
      v_seen := v_seen || v_category;

      insert into public.product_categories (product_id, category, position)
      values (p_product_id, v_category, v_index);

      if v_index = 1 then
        v_first_category := v_category;
      end if;
    end loop;
  end if;

  update public.products set category = v_first_category where id = p_product_id;
end;
$$;

comment on function public.set_product_categories(uuid, jsonb, uuid) is
  'Função INTERNA (zero grants) — substitui atomicamente o conjunto de categorias de um Produto e mantém products.category (legado) espelhando a primeira (position=1), ou NULL se nenhuma. Chamada só de dentro de create_product_with_plates/update_product_full.';

revoke execute on function public.set_product_categories(uuid, jsonb, uuid) from public, anon, authenticated, service_role;

-- =============================================================================
-- 3) product_plates.weight_grams — peso do plate passa a ser informado
--    DIRETAMENTE (não mais somado de product_plate_filaments). FK de
--    product_plate_filaments alterada para CASCADE (ver nota no cabeçalho
--    desta migration) — a tabela em si não é apagada nem tem nenhuma linha
--    removida por um DELETE direto nesta migration, só pela FK quando um
--    plate específico for substituído por uma edição futura.
-- =============================================================================
alter table public.product_plates
  add column weight_grams numeric(10, 2) not null default 0 check (weight_grams >= 0);

comment on column public.product_plates.weight_grams is
  'Peso deste plate, em gramas — informado DIRETAMENTE pelo usuário a partir desta migration (substitui a soma de product_plate_filaments, que vira legada). Nenhum arredondamento oculto.';

alter table public.product_plate_filaments
  drop constraint product_plate_filaments_plate_id_fkey,
  add constraint product_plate_filaments_plate_id_fkey
    foreign key (plate_id) references public.product_plates (id) on delete cascade;

comment on table public.product_plate_filaments is
  'LEGADA a partir desta migration — não é mais escrita por nenhum fluxo operacional (peso do plate agora é direto em product_plates.weight_grams; filamentos/cores por unidade agora vivem no Pedido, ver order_item_unit_plate_filaments). Preservada só como histórico. FK para product_plates é ON DELETE CASCADE (ver nota no cabeçalho) — nunca apagada por um DELETE direto desta migration.';

-- =============================================================================
-- 4) set_product_production — REDEFINIDA: p_plates passa a ter o formato
--    [{"production_time_seconds": <int >= 0>, "weight_grams": <numeric >= 0>}, ...]
--    — SEM "filaments". Nunca mais escreve em product_plate_filaments.
--    Mesma assinatura/grants (zero grants, interna) da versão anterior
--    (20260829160000) — CREATE OR REPLACE, não precisa de DROP.
-- =============================================================================
create or replace function public.set_product_production(
  p_product_id uuid,
  p_plates jsonb,
  p_manual_weight_override_grams numeric(10, 2),
  p_manual_time_override_seconds integer,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plate jsonb;
  v_index integer := 0;
  v_weight numeric(10, 2);
  v_time integer;
  v_auto_weight_total numeric(10, 2) := 0;
  v_auto_time_total integer := 0;
  v_plate_count integer;
  v_effective_weight numeric(10, 2);
  v_effective_time integer;
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'products.id % não encontrado', p_product_id;
  end if;

  if p_plates is not null and jsonb_typeof(p_plates) <> 'array' then
    raise exception 'p_plates deve ser um array ou null';
  end if;
  if p_manual_weight_override_grams is not null and p_manual_weight_override_grams < 0 then
    raise exception 'p_manual_weight_override_grams deve ser maior ou igual a 0';
  end if;
  if p_manual_time_override_seconds is not null and p_manual_time_override_seconds < 0 then
    raise exception 'p_manual_time_override_seconds deve ser maior ou igual a 0';
  end if;

  -- Substitui TODO o conjunto de plates (delete+reinsert, mesmo padrão de
  -- sempre) — a FK de product_plate_filaments agora é CASCADE (Seção 3),
  -- então este DELETE nunca mais falha por causa de composição legada
  -- presa a um plate antigo.
  delete from public.product_plates where product_id = p_product_id;

  if p_plates is not null then
    for v_plate in select * from jsonb_array_elements(p_plates)
    loop
      v_index := v_index + 1;

      v_weight := nullif(v_plate ->> 'weight_grams', '')::numeric;
      v_time := coalesce(nullif(v_plate ->> 'production_time_seconds', '')::integer, 0);

      if v_weight is null or v_weight < 0 then
        raise exception 'Plate %: weight_grams deve ser um número maior ou igual a 0.', v_index;
      end if;
      if v_time < 0 then
        raise exception 'Plate %: production_time_seconds deve ser maior ou igual a 0.', v_index;
      end if;

      insert into public.product_plates (product_id, plate_number, production_time_seconds, weight_grams)
      values (p_product_id, v_index, v_time, v_weight);

      v_auto_weight_total := v_auto_weight_total + v_weight;
      v_auto_time_total := v_auto_time_total + v_time;
    end loop;
  end if;

  select count(*) into v_plate_count from public.product_plates where product_id = p_product_id;

  if v_plate_count = 0 then
    -- Sem nenhum plate: o efetivo é só o ajuste manual (ou null) — nunca um
    -- zero fabricado. Mesmo comportamento de "sem produção cadastrada" de
    -- antes desta migration.
    v_effective_weight := p_manual_weight_override_grams;
    v_effective_time := p_manual_time_override_seconds;
  else
    v_effective_weight := coalesce(p_manual_weight_override_grams, v_auto_weight_total);
    v_effective_time := coalesce(p_manual_time_override_seconds, v_auto_time_total);
  end if;

  update public.products
    set default_weight_grams = v_effective_weight,
        default_print_time_seconds = v_effective_time,
        production_weight_manual_override_grams = p_manual_weight_override_grams,
        production_time_manual_override_seconds = p_manual_time_override_seconds
    where id = p_product_id;
end;
$$;

comment on function public.set_product_production(uuid, jsonb, numeric, integer, uuid) is
  'Função INTERNA (zero grants) — substitui atomicamente o conjunto de plates de um Produto (posição, tempo, peso DIRETO — nunca mais filamentos) e recalcula/grava os totais efetivos. A partir desta migration, nunca escreve em product_plate_filaments (legada). Chamada só de dentro de create_product_with_plates/update_product_full.';

revoke execute on function public.set_product_production(uuid, jsonb, numeric, integer, uuid) from public, anon, authenticated, service_role;

-- =============================================================================
-- 5) create_product_with_plates — REDEFINIDA: p_category (text) vira
--    p_categories (jsonb, array de strings) — mudança de TIPO na mesma
--    posição, então é uma assinatura diferente para o Postgres (não um
--    CREATE OR REPLACE válido) — DROP explícito da assinatura antiga
--    (criada em 20260829160000) seguido de CREATE da nova. Chama
--    set_product_categories() (Seção 2) além de create_product/
--    set_product_production/set_product_composition já reaproveitadas.
--    p_plates usa o novo formato sem filamentos (Seção 4).
-- =============================================================================
drop function if exists public.create_product_with_plates(
  text, text, text, text, numeric, uuid, boolean, jsonb, numeric, integer, jsonb, jsonb, uuid
);

create function public.create_product_with_plates(
  p_name text,
  p_product_type text,
  p_categories jsonb,
  p_description text,
  p_default_price numeric(10, 2),
  p_default_file_id uuid,
  p_allows_personalization boolean,
  p_plates jsonb,
  p_manual_weight_override_grams numeric(10, 2),
  p_manual_time_override_seconds integer,
  p_accessories jsonb,
  p_packaging jsonb,
  p_changed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  v_product_id := public.create_product(
    p_name, p_product_type, null, p_description, p_default_price,
    null, null, null, p_default_file_id, p_allows_personalization, p_changed_by
  );

  perform public.set_product_categories(v_product_id, p_categories, p_changed_by);
  perform public.set_product_production(
    v_product_id, p_plates, p_manual_weight_override_grams, p_manual_time_override_seconds, p_changed_by
  );
  perform public.set_product_composition(v_product_id, p_accessories, p_packaging, p_changed_by);

  return v_product_id;
end;
$$;

comment on function public.create_product_with_plates(text, text, jsonb, text, numeric, uuid, boolean, jsonb, numeric, integer, jsonb, jsonb, uuid) is
  'Cria um Produto e, na mesma transação, suas categorias (N, substituindo a categoria única), plates (posição+peso direto+tempo, SEM filamentos — ver Seção 4/7 desta migration), ajuste manual e Acessórios/Embalagens — reaproveita create_product/set_product_categories/set_product_production/set_product_composition, nenhuma lógica duplicada. Rollback total se qualquer etapa falhar.';

revoke execute on function public.create_product_with_plates(text, text, jsonb, text, numeric, uuid, boolean, jsonb, numeric, integer, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_product_with_plates(text, text, jsonb, text, numeric, uuid, boolean, jsonb, numeric, integer, jsonb, jsonb, uuid)
  to service_role;

-- =============================================================================
-- 6) update_product_full — REDEFINIDA: ganha p_categories (jsonb, SEMPRE
--    substituição completa — mesmo padrão de p_plates/p_accessories/
--    p_packaging, nunca opcional). p_patch nunca mais aceita "category"
--    (update_product(), reaproveitada aqui, mantém sua própria whitelist —
--    a Edge Function passa a rejeitar "category" dentro de p_patch nesta
--    rota, ver products/handler.ts). Assinatura ganha 1 parâmetro — DROP +
--    CREATE, mesmo motivo da Seção 5.
-- =============================================================================
drop function if exists public.update_product_full(
  uuid, jsonb, jsonb, numeric, integer, jsonb, jsonb, uuid
);

create function public.update_product_full(
  p_product_id uuid,
  p_patch jsonb,
  p_categories jsonb,
  p_plates jsonb,
  p_manual_weight_override_grams numeric(10, 2),
  p_manual_time_override_seconds integer,
  p_accessories jsonb,
  p_packaging jsonb,
  p_changed_by uuid
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.products;
begin
  if p_patch is not null and p_patch <> '{}'::jsonb then
    perform public.update_product(p_product_id, p_patch, p_changed_by);
  end if;

  perform public.set_product_categories(p_product_id, p_categories, p_changed_by);
  perform public.set_product_production(
    p_product_id, p_plates, p_manual_weight_override_grams, p_manual_time_override_seconds, p_changed_by
  );
  perform public.set_product_composition(p_product_id, p_accessories, p_packaging, p_changed_by);

  select * into v_row from public.products where id = p_product_id;
  return v_row;
end;
$$;

comment on function public.update_product_full(uuid, jsonb, jsonb, jsonb, numeric, integer, jsonb, jsonb, uuid) is
  'Edição atômica completa de um Produto: campos descritivos (p_patch, whitelist de update_product — nunca default_price/product_type/category), categorias (p_categories, SEMPRE substituição completa), plates (posição+peso direto+tempo, SEM filamentos), ajuste manual e Acessórios/Embalagens (sempre substituição completa). Rollback total se qualquer etapa falhar.';

revoke execute on function public.update_product_full(uuid, jsonb, jsonb, jsonb, numeric, integer, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.update_product_full(uuid, jsonb, jsonb, jsonb, numeric, integer, jsonb, jsonb, uuid)
  to service_role;

-- =============================================================================
-- 7) order_item_plates — SNAPSHOT congelado da estrutura produtiva
--    (product_plates) do Produto no momento em que um item CATALOG é
--    criado no Pedido. Editar o Produto depois nunca muda um Pedido já
--    criado — cada linha aqui é uma cópia independente, não uma referência
--    viva a product_plates.
-- =============================================================================
create table public.order_item_plates (
  id uuid primary key default gen_random_uuid(),

  order_item_id uuid not null references public.order_items (id) on delete restrict,

  plate_number integer not null check (plate_number > 0),
  weight_grams numeric(10, 2) not null check (weight_grams >= 0),
  production_time_seconds integer not null default 0 check (production_time_seconds >= 0),

  created_at timestamptz not null default now(),

  unique (order_item_id, plate_number)
);

comment on table public.order_item_plates is
  'Snapshot congelado dos plates (posição/peso/tempo) do Produto no momento em que o item CATALOG foi criado no Pedido — cópia independente de product_plates, nunca uma referência viva; editar o Produto depois não altera este snapshot. Peso/tempo representam UMA unidade; a quantidade do item continua em order_items.quantity. Escrita só via create_order (na criação do item) e update_quote_order (ao substituir itens de um Pedido em QUOTE) — nenhuma reserva/consumo lê esta tabela.';

create index idx_order_item_plates_order_item_id on public.order_item_plates (order_item_id);

alter table public.order_item_plates enable row level security;

revoke all on public.order_item_plates from anon;
revoke all on public.order_item_plates from authenticated;
grant select on public.order_item_plates to authenticated;

create policy "Active users can view order item plates"
  on public.order_item_plates
  for select
  to authenticated
  using (public.is_active_user());

-- =============================================================================
-- 8) order_item_unit_plate_filaments — filamentos/cores escolhidos por
--    UNIDADE e por PLATE (decisão do usuário: cores são definidas no
--    Pedido, não no Produto; cada unidade pode ter cores diferentes;
--    normalmente definidas ao fechar o Pedido, mas o Pedido pode entrar na
--    Fila sem nenhuma cor — só se tornam obrigatórias antes do início
--    real da produção, ver change_order_status na Seção 14).
-- =============================================================================
create table public.order_item_unit_plate_filaments (
  id uuid primary key default gen_random_uuid(),

  order_item_id uuid not null references public.order_items (id) on delete restrict,
  order_item_plate_id uuid not null references public.order_item_plates (id) on delete restrict,

  -- 1..quantity do item — validado pela RPC de escrita (Seção 12), não por
  -- CHECK aqui: uma constraint de tabela não consegue enxergar
  -- order_items.quantity de outra tabela.
  unit_number integer not null check (unit_number > 0),

  filament_type_id uuid not null references public.filament_types (id) on delete restrict,

  -- Posição/ordem de seleção dentro da mesma unidade/plate (várias cores no
  -- mesmo plate são permitidas) — só para preservar a ordem de escolha na
  -- tela, sem nenhum significado de negócio.
  position integer not null default 1 check (position > 0),

  created_at timestamptz not null default now(),

  -- Nunca o mesmo filamento duas vezes na mesma unidade/plate — a mesma
  -- cor em unidades DIFERENTES, ou cores diferentes entre unidades, são
  -- livremente permitidas (nenhuma constraint aqui restringe isso).
  unique (order_item_plate_id, unit_number, filament_type_id)
);

comment on table public.order_item_unit_plate_filaments is
  'Filamentos/cores escolhidos por UNIDADE e por PLATE de um item CATALOG do Pedido — decisão de que cor pertence ao Pedido, não ao Produto (o Produto só define peso/tempo, snapshot em order_item_plates). Não pede peso por cor (responsabilidade futura do módulo Produção). Não implica reserva nem consumo de estoque — só registro/seleção. Um filamento inativo já selecionado permanece aqui (nunca removido automaticamente); só não conta como definição válida para iniciar a produção (ver change_order_status, Seção 14) e nunca pode ser escolhido como seleção NOVA (validado pela RPC de escrita, Seção 12, não em nível de banco).';

create index idx_order_item_unit_plate_filaments_plate on public.order_item_unit_plate_filaments (order_item_plate_id, unit_number);
create index idx_order_item_unit_plate_filaments_order_item on public.order_item_unit_plate_filaments (order_item_id);

alter table public.order_item_unit_plate_filaments enable row level security;

revoke all on public.order_item_unit_plate_filaments from anon;
revoke all on public.order_item_unit_plate_filaments from authenticated;
grant select on public.order_item_unit_plate_filaments to authenticated;

create policy "Active users can view order item unit plate filaments"
  on public.order_item_unit_plate_filaments
  for select
  to authenticated
  using (public.is_active_user());

-- =============================================================================
-- 9) validate_catalog_production_structure_for_creation — SUBSTITUI
--    validate_catalog_composition_for_creation (que fica preservada,
--    intocada, mas sem nenhum chamador a partir desta migration — nome
--    antigo falava em "composition", incompatível com a nova regra, que
--    não exige mais nenhuma composição de filamento, só estrutura
--    produtiva). Um item CATALOG passa a ser válido para nascer em
--    IN_PRODUCTION_QUEUE quando o Produto tem ao menos 1 plate — nunca
--    exige product_plate_filaments nem product_filaments. Cores do Pedido
--    são sempre opcionais na criação (gate fica só em change_order_status,
--    Seção 14).
-- =============================================================================
create function public.validate_catalog_production_structure_for_creation(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_item_type text;
  v_product_id uuid;
  v_product_name text;
  v_product_type text;
  v_has_plate boolean;
  v_missing_names text[] := '{}';
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item ->> 'item_type';
    if v_item_type <> 'CATALOG' then
      continue;
    end if;

    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    if v_product_id is null then
      raise exception 'Item CATALOG exige product_id';
    end if;

    select name, product_type into v_product_name, v_product_type
      from public.products
      where id = v_product_id;

    if not found or v_product_type <> 'CATALOG' then
      raise exception 'products.id % não encontrado ou não corresponde a um produto de Catálogo', v_product_id;
    end if;

    select exists (
      select 1 from public.product_plates where product_id = v_product_id
    ) into v_has_plate;

    if not v_has_plate and not (v_product_name = any(v_missing_names)) then
      v_missing_names := v_missing_names || v_product_name;
    end if;
  end loop;

  if array_length(v_missing_names, 1) > 0 then
    raise exception 'ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE: Não foi possível enviar o pedido para a Fila de produção. Cadastre a estrutura produtiva (plates) dos produtos: %.', array_to_string(v_missing_names, ', ');
  end if;
end;
$$;

comment on function public.validate_catalog_production_structure_for_creation(jsonb) is
  'Valida, para um Pedido novo que nasceria em IN_PRODUCTION_QUEUE (nenhum item CUSTOM), que todo item CATALOG tem product_id apontando para um Produto de Catálogo real com ao menos 1 plate (product_plates) — nunca exige filamento/composição (removida do Produto nesta migration; cores agora vivem no Pedido e são sempre opcionais na criação). Bloqueia toda a criação e lista, deduplicados por nome, todos os produtos sem estrutura produtiva na mesma mensagem (ORDER_CATALOG_MISSING_PRODUCTION_STRUCTURE:). Substitui validate_catalog_composition_for_creation (preservada, sem grants, sem chamador a partir desta migration) como a função efetivamente chamada por create_order.';

revoke execute on function public.validate_catalog_production_structure_for_creation(jsonb) from public, anon, authenticated, service_role;

-- =============================================================================
-- 10) create_order — as DUAS sobrecargas (10 e 11 parâmetros) REDEFINIDAS:
--     (a) chamam validate_catalog_production_structure_for_creation em vez
--     de validate_catalog_composition_for_creation; (b) para cada item
--     CATALOG, copiam os plates ATUAIS do Produto para order_item_plates
--     (snapshot congelado) e, se o payload trouxer "production_colors"
--     (sempre opcional — Pedido pode nascer sem nenhuma cor), inserem as
--     escolhas em order_item_unit_plate_filaments, exigindo filamento
--     ATIVO (seleção nova, nunca uma seleção antiga a preservar — é uma
--     criação). Assinaturas idênticas às versões anteriores (CREATE OR
--     REPLACE válido, nenhum DROP necessário) — nenhuma outra linha do
--     corpo alterada além do já descrito.
-- =============================================================================
create or replace function public.create_order(
  p_customer_id uuid,
  p_company_id uuid,
  p_lead_source_id uuid,
  p_expected_delivery_date date,
  p_delivery_method text,
  p_shipping_cost numeric(10, 2),
  p_discount_value numeric(10, 2),
  p_notes text,
  p_items jsonb,
  p_changed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_item_id uuid;
  v_order_number text;
  v_lead_source_id uuid;
  v_item jsonb;
  v_item_type text;
  v_custom jsonb;
  v_spot jsonb;
  v_initial_status text;
  v_quantity integer;
  v_plate jsonb;
  v_order_item_plate_id uuid;
  v_color jsonb;
  v_filament_type_id uuid;
  v_unit_number integer;
  v_is_active boolean;
begin
  perform public.assert_active_user(p_changed_by);

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order exige ao menos um item em p_items';
  end if;

  v_initial_status := public.determine_order_initial_status(p_items);
  if v_initial_status = 'IN_PRODUCTION_QUEUE' then
    perform public.validate_catalog_production_structure_for_creation(p_items);
  end if;

  v_lead_source_id := p_lead_source_id;
  if v_lead_source_id is null then
    select acquisition_source_id into v_lead_source_id
      from public.customers
      where id = p_customer_id;
  end if;

  v_order_number := public.next_order_number();

  insert into public.orders (
    order_number, customer_id, company_id, lead_source_id,
    order_status, payment_status,
    expected_delivery_date, delivery_method,
    shipping_cost, discount_value, notes
  ) values (
    v_order_number, p_customer_id, p_company_id, v_lead_source_id,
    v_initial_status, 'WAITING_PAYMENT',
    p_expected_delivery_date, p_delivery_method,
    coalesce(p_shipping_cost, 0), coalesce(p_discount_value, 0), p_notes
  )
  returning id into v_order_id;

  insert into public.order_status_history (
    order_id, from_status, to_status, changed_by, reason
  ) values (
    v_order_id, null, v_initial_status, p_changed_by,
    case when v_initial_status = 'IN_PRODUCTION_QUEUE'
      then 'Pedido criado — só itens de Catálogo/Spot, enviado direto para a Fila de produção'
      else 'Pedido criado'
    end
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item ->> 'item_type';
    v_quantity := (v_item ->> 'quantity')::integer;

    insert into public.order_items (
      order_id, item_type, product_id, item_name, description,
      quantity, unit_price, personalization_fee, discount_value,
      color_description, number_of_colors, customization_data,
      expected_delivery_date, notes
    ) values (
      v_order_id,
      v_item_type,
      nullif(v_item ->> 'product_id', '')::uuid,
      v_item ->> 'item_name',
      v_item ->> 'description',
      v_quantity,
      (v_item ->> 'unit_price')::numeric,
      coalesce((v_item ->> 'personalization_fee')::numeric, 0),
      coalesce((v_item ->> 'discount_value')::numeric, 0),
      v_item ->> 'color_description',
      nullif(v_item ->> 'number_of_colors', '')::integer,
      coalesce(v_item -> 'customization_data', '{}'::jsonb),
      nullif(v_item ->> 'expected_delivery_date', '')::date,
      v_item ->> 'notes'
    )
    returning id into v_order_item_id;

    if v_item_type = 'CUSTOM' then
      v_custom := v_item -> 'custom_details';
      if v_custom is null then
        raise exception 'Item CUSTOM exige custom_details';
      end if;

      insert into public.custom_item_details (
        order_item_id, current_version, is_exclusive,
        prototype_required, prototype_completed, development_minutes, notes
      ) values (
        v_order_item_id,
        v_custom ->> 'current_version',
        coalesce((v_custom ->> 'is_exclusive')::boolean, false),
        coalesce((v_custom ->> 'prototype_required')::boolean, false),
        false,
        nullif(v_custom ->> 'development_minutes', '')::integer,
        v_custom ->> 'notes'
      );

      insert into public.custom_versions (
        order_item_id, version_number, change_type, change_description, file_id
      ) values (
        v_order_item_id,
        v_custom ->> 'current_version',
        'INITIAL',
        'Versão inicial',
        null
      );

    elsif v_item_type = 'SPOT' then
      v_spot := v_item -> 'spot_details';
      if v_spot is null then
        raise exception 'Item SPOT exige spot_details';
      end if;

      insert into public.spot_item_details (
        order_item_id, model_source_id, source_reference, is_exclusive,
        test_print_required, test_print_completed, search_time_status,
        search_minutes, preparation_minutes,
        market_reference_price, market_reference_source, market_reference_date,
        catalog_conversion_suggested, notes
      ) values (
        v_order_item_id,
        nullif(v_spot ->> 'model_source_id', '')::uuid,
        v_spot ->> 'source_reference',
        coalesce((v_spot ->> 'is_exclusive')::boolean, false),
        coalesce((v_spot ->> 'test_print_required')::boolean, false),
        false,
        coalesce(v_spot ->> 'search_time_status', 'NOT_INFORMED'),
        nullif(v_spot ->> 'search_minutes', '')::integer,
        nullif(v_spot ->> 'preparation_minutes', '')::integer,
        nullif(v_spot ->> 'market_reference_price', '')::numeric,
        v_spot ->> 'market_reference_source',
        nullif(v_spot ->> 'market_reference_date', '')::date,
        false,
        v_spot ->> 'notes'
      );

    elsif v_item_type = 'CATALOG' then
      -- Snapshot congelado dos plates ATUAIS do Produto — cópia
      -- independente, nunca uma referência viva a product_plates.
      for v_plate in
        select jsonb_build_object(
          'plate_number', plate_number, 'weight_grams', weight_grams,
          'production_time_seconds', production_time_seconds
        )
        from public.product_plates
        where product_id = nullif(v_item ->> 'product_id', '')::uuid
        order by plate_number
      loop
        insert into public.order_item_plates (order_item_id, plate_number, weight_grams, production_time_seconds)
        values (
          v_order_item_id,
          (v_plate ->> 'plate_number')::integer,
          (v_plate ->> 'weight_grams')::numeric,
          (v_plate ->> 'production_time_seconds')::integer
        );
      end loop;

      -- Cores/filamentos por unidade+plate — SEMPRE opcionais na criação
      -- (decisão do usuário: "definidas ao fechar o Pedido" ou depois,
      -- nunca bloqueiam a entrada na Fila). Quando informadas, exigem
      -- filamento ATIVO (é uma criação — não existe seleção "antiga" a
      -- preservar aqui).
      if v_item -> 'production_colors' is not null and jsonb_typeof(v_item -> 'production_colors') = 'array' then
        for v_color in select * from jsonb_array_elements(v_item -> 'production_colors')
        loop
          v_unit_number := (v_color ->> 'unit_number')::integer;
          if v_unit_number is null or v_unit_number < 1 or v_unit_number > v_quantity then
            raise exception 'production_colors: unit_number % fora do intervalo 1..% (quantity do item)', v_unit_number, v_quantity;
          end if;

          select id into v_order_item_plate_id
            from public.order_item_plates
            where order_item_id = v_order_item_id and plate_number = (v_color ->> 'plate_number')::integer;
          if v_order_item_plate_id is null then
            raise exception 'production_colors: plate_number % não existe no snapshot deste item', v_color ->> 'plate_number';
          end if;

          for v_filament_type_id in select value::uuid from jsonb_array_elements_text(coalesce(v_color -> 'filament_type_ids', '[]'::jsonb)) as value
          loop
            select is_active into v_is_active from public.filament_types where id = v_filament_type_id;
            if not found then
              raise exception 'production_colors: filament_types.id % não encontrado', v_filament_type_id;
            end if;
            if not v_is_active then
              raise exception 'production_colors: filament_types.id % está inativo — não pode ser escolhido como seleção nova', v_filament_type_id;
            end if;

            insert into public.order_item_unit_plate_filaments (
              order_item_id, order_item_plate_id, unit_number, filament_type_id, position
            ) values (
              v_order_item_id, v_order_item_plate_id, v_unit_number, v_filament_type_id,
              coalesce(array_position(array(select value::uuid from jsonb_array_elements_text(v_color -> 'filament_type_ids') as value), v_filament_type_id), 1)
            )
            on conflict (order_item_plate_id, unit_number, filament_type_id) do nothing;
          end loop;
        end loop;
      end if;
    end if;
  end loop;

  perform public.recalculate_order_financials(
    v_order_id, p_changed_by, 'Cálculo inicial na criação do pedido'
  );

  return v_order_id;
end;
$$;

comment on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid) is
  'Cria um pedido com um ou mais itens (CUSTOM/SPOT/CATALOG) na mesma transação. Status inicial via determine_order_initial_status(); IN_PRODUCTION_QUEUE exige validate_catalog_production_structure_for_creation() (todo item CATALOG com ao menos 1 plate — nunca filamento). Item CATALOG ganha snapshot congelado dos plates do Produto (order_item_plates) e, se o payload trouxer production_colors (sempre opcional), as escolhas de filamento por unidade/plate (order_item_unit_plate_filaments, exigindo filamento ativo). Nunca reclassifica um pedido já existente.';

revoke execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid)
  to service_role;

-- Sobrecarga de 11 parâmetros (com p_payment_method) — efetivamente
-- chamada hoje pela Edge Function `orders` e por create_order_with_payment()
-- — mesmas duas mudanças da sobrecarga de 10 parâmetros acima (validação
-- de estrutura produtiva + snapshot/cores de item CATALOG), nenhuma outra
-- linha do corpo alterada.
create or replace function public.create_order(
  p_customer_id uuid,
  p_company_id uuid,
  p_lead_source_id uuid,
  p_expected_delivery_date date,
  p_delivery_method text,
  p_shipping_cost numeric(10, 2),
  p_discount_value numeric(10, 2),
  p_notes text,
  p_items jsonb,
  p_changed_by uuid,
  p_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_item_id uuid;
  v_order_number text;
  v_lead_source_id uuid;
  v_item jsonb;
  v_item_type text;
  v_custom jsonb;
  v_spot jsonb;
  v_initial_status text;
  v_quantity integer;
  v_plate jsonb;
  v_order_item_plate_id uuid;
  v_color jsonb;
  v_filament_type_id uuid;
  v_unit_number integer;
  v_is_active boolean;
begin
  perform public.assert_active_user(p_changed_by);

  if p_payment_method is not null and p_payment_method not in ('PIX', 'DINHEIRO', 'CARTAO') then
    raise exception 'p_payment_method inválido: % (permitido: null, PIX, DINHEIRO ou CARTAO)', p_payment_method;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order exige ao menos um item em p_items';
  end if;

  v_initial_status := public.determine_order_initial_status(p_items);
  if v_initial_status = 'IN_PRODUCTION_QUEUE' then
    perform public.validate_catalog_production_structure_for_creation(p_items);
  end if;

  v_lead_source_id := p_lead_source_id;
  if v_lead_source_id is null then
    select acquisition_source_id into v_lead_source_id
      from public.customers
      where id = p_customer_id;
  end if;

  v_order_number := public.next_order_number();

  insert into public.orders (
    order_number, customer_id, company_id, lead_source_id,
    order_status, payment_status, payment_method,
    expected_delivery_date, delivery_method,
    shipping_cost, discount_value, notes
  ) values (
    v_order_number, p_customer_id, p_company_id, v_lead_source_id,
    v_initial_status, 'WAITING_PAYMENT', p_payment_method,
    p_expected_delivery_date, p_delivery_method,
    coalesce(p_shipping_cost, 0), coalesce(p_discount_value, 0), p_notes
  )
  returning id into v_order_id;

  insert into public.order_status_history (
    order_id, from_status, to_status, changed_by, reason
  ) values (
    v_order_id, null, v_initial_status, p_changed_by,
    case when v_initial_status = 'IN_PRODUCTION_QUEUE'
      then 'Pedido criado — só itens de Catálogo/Spot, enviado direto para a Fila de produção'
      else 'Pedido criado'
    end
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item ->> 'item_type';
    v_quantity := (v_item ->> 'quantity')::integer;

    insert into public.order_items (
      order_id, item_type, product_id, item_name, description,
      quantity, unit_price, personalization_fee, discount_value,
      color_description, number_of_colors, customization_data,
      expected_delivery_date, notes
    ) values (
      v_order_id,
      v_item_type,
      nullif(v_item ->> 'product_id', '')::uuid,
      v_item ->> 'item_name',
      v_item ->> 'description',
      v_quantity,
      (v_item ->> 'unit_price')::numeric,
      coalesce((v_item ->> 'personalization_fee')::numeric, 0),
      coalesce((v_item ->> 'discount_value')::numeric, 0),
      v_item ->> 'color_description',
      nullif(v_item ->> 'number_of_colors', '')::integer,
      coalesce(v_item -> 'customization_data', '{}'::jsonb),
      nullif(v_item ->> 'expected_delivery_date', '')::date,
      v_item ->> 'notes'
    )
    returning id into v_order_item_id;

    if v_item_type = 'CUSTOM' then
      v_custom := v_item -> 'custom_details';
      if v_custom is null then
        raise exception 'Item CUSTOM exige custom_details';
      end if;

      insert into public.custom_item_details (
        order_item_id, current_version, is_exclusive,
        prototype_required, prototype_completed, development_minutes, notes
      ) values (
        v_order_item_id,
        v_custom ->> 'current_version',
        coalesce((v_custom ->> 'is_exclusive')::boolean, false),
        coalesce((v_custom ->> 'prototype_required')::boolean, false),
        false,
        nullif(v_custom ->> 'development_minutes', '')::integer,
        v_custom ->> 'notes'
      );

      insert into public.custom_versions (
        order_item_id, version_number, change_type, change_description, file_id
      ) values (
        v_order_item_id,
        v_custom ->> 'current_version',
        'INITIAL',
        'Versão inicial',
        null
      );

    elsif v_item_type = 'SPOT' then
      v_spot := v_item -> 'spot_details';
      if v_spot is null then
        raise exception 'Item SPOT exige spot_details';
      end if;

      insert into public.spot_item_details (
        order_item_id, model_source_id, source_reference, is_exclusive,
        test_print_required, test_print_completed, search_time_status,
        search_minutes, preparation_minutes,
        market_reference_price, market_reference_source, market_reference_date,
        catalog_conversion_suggested, notes
      ) values (
        v_order_item_id,
        nullif(v_spot ->> 'model_source_id', '')::uuid,
        v_spot ->> 'source_reference',
        coalesce((v_spot ->> 'is_exclusive')::boolean, false),
        coalesce((v_spot ->> 'test_print_required')::boolean, false),
        false,
        coalesce(v_spot ->> 'search_time_status', 'NOT_INFORMED'),
        nullif(v_spot ->> 'search_minutes', '')::integer,
        nullif(v_spot ->> 'preparation_minutes', '')::integer,
        nullif(v_spot ->> 'market_reference_price', '')::numeric,
        v_spot ->> 'market_reference_source',
        nullif(v_spot ->> 'market_reference_date', '')::date,
        false,
        v_spot ->> 'notes'
      );

    elsif v_item_type = 'CATALOG' then
      for v_plate in
        select jsonb_build_object(
          'plate_number', plate_number, 'weight_grams', weight_grams,
          'production_time_seconds', production_time_seconds
        )
        from public.product_plates
        where product_id = nullif(v_item ->> 'product_id', '')::uuid
        order by plate_number
      loop
        insert into public.order_item_plates (order_item_id, plate_number, weight_grams, production_time_seconds)
        values (
          v_order_item_id,
          (v_plate ->> 'plate_number')::integer,
          (v_plate ->> 'weight_grams')::numeric,
          (v_plate ->> 'production_time_seconds')::integer
        );
      end loop;

      if v_item -> 'production_colors' is not null and jsonb_typeof(v_item -> 'production_colors') = 'array' then
        for v_color in select * from jsonb_array_elements(v_item -> 'production_colors')
        loop
          v_unit_number := (v_color ->> 'unit_number')::integer;
          if v_unit_number is null or v_unit_number < 1 or v_unit_number > v_quantity then
            raise exception 'production_colors: unit_number % fora do intervalo 1..% (quantity do item)', v_unit_number, v_quantity;
          end if;

          select id into v_order_item_plate_id
            from public.order_item_plates
            where order_item_id = v_order_item_id and plate_number = (v_color ->> 'plate_number')::integer;
          if v_order_item_plate_id is null then
            raise exception 'production_colors: plate_number % não existe no snapshot deste item', v_color ->> 'plate_number';
          end if;

          for v_filament_type_id in select value::uuid from jsonb_array_elements_text(coalesce(v_color -> 'filament_type_ids', '[]'::jsonb)) as value
          loop
            select is_active into v_is_active from public.filament_types where id = v_filament_type_id;
            if not found then
              raise exception 'production_colors: filament_types.id % não encontrado', v_filament_type_id;
            end if;
            if not v_is_active then
              raise exception 'production_colors: filament_types.id % está inativo — não pode ser escolhido como seleção nova', v_filament_type_id;
            end if;

            insert into public.order_item_unit_plate_filaments (
              order_item_id, order_item_plate_id, unit_number, filament_type_id, position
            ) values (
              v_order_item_id, v_order_item_plate_id, v_unit_number, v_filament_type_id,
              coalesce(array_position(array(select value::uuid from jsonb_array_elements_text(v_color -> 'filament_type_ids') as value), v_filament_type_id), 1)
            )
            on conflict (order_item_plate_id, unit_number, filament_type_id) do nothing;
          end loop;
        end loop;
      end if;
    end if;
  end loop;

  perform public.recalculate_order_financials(
    v_order_id, p_changed_by, 'Cálculo inicial na criação do pedido'
  );

  return v_order_id;
end;
$$;

comment on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text) is
  'Sobrecarga de 11 parâmetros de create_order (com p_payment_method), efetivamente chamada hoje pela Edge Function `orders` (POST /orders) e por create_order_with_payment(). Status inicial via determine_order_initial_status(); IN_PRODUCTION_QUEUE exige validate_catalog_production_structure_for_creation() (todo item CATALOG com ao menos 1 plate — nunca filamento). Item CATALOG ganha snapshot congelado dos plates (order_item_plates) e, se o payload trouxer production_colors (sempre opcional), as escolhas de filamento por unidade/plate. Valida e persiste payment_method no mesmo INSERT. Nunca reclassifica um pedido já existente.';

revoke execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, uuid, date, text, numeric, numeric, text, jsonb, uuid, text)
  to service_role;

-- =============================================================================
-- 11) update_quote_order — REDEFINIDA: corpo real conferido integralmente
--     (20260821031143_add_update_quote_order.sql, nunca modificada por
--     nenhuma migration desde então) antes desta substituição. Única
--     mudança: como order_item_plates/order_item_unit_plate_filaments
--     agora referenciam order_items com ON DELETE RESTRICT, o DELETE de
--     order_items desta função passa a limpar esses dois filhos primeiro
--     (mesmo escopo, só order_id = p_order_id); cada item CATALOG
--     reinserido ganha um snapshot NOVO dos plates atuais do Produto
--     (mesma lógica de create_order) — uma edição legítima de itens
--     legitimamente re-sincroniza o snapshot, cores antigas são
--     descartadas junto com os itens antigos (mesma semântica de
--     "substitui o conjunto inteiro" já usada para o resto desta função).
--     Nenhuma outra linha do corpo é alterada.
-- =============================================================================
create or replace function public.update_quote_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_company_id uuid,
  p_lead_source_id uuid,
  p_payment_method text,
  p_expected_delivery_date date,
  p_delivery_method text,
  p_shipping_cost numeric(10, 2),
  p_discount_value numeric(10, 2),
  p_notes text,
  p_items jsonb,
  p_changed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_item jsonb;
  v_item_type text;
  v_product_id uuid;
  v_dependency_count integer;
  v_foreign_item_count integer;
  v_order_item_id uuid;
  v_plate jsonb;
begin
  perform public.assert_active_user(p_changed_by);

  if p_payment_method is not null and p_payment_method not in ('PIX', 'DINHEIRO', 'CARTAO') then
    raise exception 'p_payment_method inválido: % (permitido: null, PIX, DINHEIRO ou CARTAO)', p_payment_method;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'update_quote_order exige ao menos um item em p_items';
  end if;

  select order_status into v_order_status
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  if v_order_status <> 'QUOTE' then
    raise exception 'update_quote_order só permite pedidos em QUOTE (status atual: %)', v_order_status;
  end if;

  select count(*) into v_foreign_item_count
    from public.order_items
    where order_id = p_order_id
      and item_type <> 'CATALOG';

  if v_foreign_item_count > 0 then
    raise exception 'update_quote_order não pode ser usada em pedidos com itens CUSTOM/SPOT existentes (% encontrado(s))', v_foreign_item_count;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item ->> 'item_type';
    if v_item_type <> 'CATALOG' then
      raise exception 'update_quote_order só aceita itens CATALOG (recebido: %)', coalesce(v_item_type, 'null');
    end if;

    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    if v_product_id is null then
      raise exception 'Item CATALOG exige product_id';
    end if;
  end loop;

  select count(*) into v_dependency_count
    from public.order_items oi
    where oi.order_id = p_order_id
      and (
        exists (select 1 from public.custom_versions cv where cv.order_item_id = oi.id)
        or exists (select 1 from public.approvals a where a.order_item_id = oi.id)
      );

  if v_dependency_count > 0 then
    raise exception 'update_quote_order não pode substituir os itens: % item(ns) com histórico de versão/aprovação vinculado', v_dependency_count;
  end if;

  update public.orders
    set customer_id = p_customer_id,
        company_id = p_company_id,
        lead_source_id = p_lead_source_id,
        payment_method = p_payment_method,
        expected_delivery_date = p_expected_delivery_date,
        delivery_method = p_delivery_method,
        shipping_cost = coalesce(p_shipping_cost, 0),
        discount_value = coalesce(p_discount_value, 0),
        notes = p_notes
    where id = p_order_id;

  -- Limpa os filhos novos (cores por unidade/plate + snapshot de plates)
  -- ANTES de apagar os order_items — FK ON DELETE RESTRICT em ambos.
  delete from public.order_item_unit_plate_filaments
    where order_item_id in (select id from public.order_items where order_id = p_order_id);
  delete from public.order_item_plates
    where order_item_id in (select id from public.order_items where order_id = p_order_id);
  delete from public.order_items where order_id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, item_type, product_id, item_name, description,
      quantity, unit_price, personalization_fee, discount_value,
      color_description, number_of_colors, customization_data,
      expected_delivery_date, notes
    ) values (
      p_order_id,
      'CATALOG',
      nullif(v_item ->> 'product_id', '')::uuid,
      v_item ->> 'item_name',
      v_item ->> 'description',
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'unit_price')::numeric,
      coalesce((v_item ->> 'personalization_fee')::numeric, 0),
      coalesce((v_item ->> 'discount_value')::numeric, 0),
      v_item ->> 'color_description',
      nullif(v_item ->> 'number_of_colors', '')::integer,
      coalesce(v_item -> 'customization_data', '{}'::jsonb),
      nullif(v_item ->> 'expected_delivery_date', '')::date,
      v_item ->> 'notes'
    )
    returning id into v_order_item_id;

    -- Snapshot NOVO dos plates atuais do Produto — mesma lógica de
    -- create_order. Cores por unidade/plate NÃO são reenviadas por esta
    -- função (fora do escopo desta edição de cabeçalho+itens) — o usuário
    -- as define/reajusta depois via update_order_item_production_colors.
    for v_plate in
      select jsonb_build_object(
        'plate_number', plate_number, 'weight_grams', weight_grams,
        'production_time_seconds', production_time_seconds
      )
      from public.product_plates
      where product_id = nullif(v_item ->> 'product_id', '')::uuid
      order by plate_number
    loop
      insert into public.order_item_plates (order_item_id, plate_number, weight_grams, production_time_seconds)
      values (
        v_order_item_id,
        (v_plate ->> 'plate_number')::integer,
        (v_plate ->> 'weight_grams')::numeric,
        (v_plate ->> 'production_time_seconds')::integer
      );
    end loop;
  end loop;

  perform public.recalculate_order_financials(
    p_order_id, p_changed_by, 'Recálculo após edição completa do pedido (QUOTE, itens CATALOG)'
  );

  return p_order_id;
end;
$$;

comment on function public.update_quote_order(uuid, uuid, uuid, uuid, text, date, text, numeric, numeric, text, jsonb, uuid) is
  'Edição atômica completa (cabeçalho + itens) de um pedido em QUOTE com itens exclusivamente CATALOG. Substitui o conjunto de order_items (DELETE + INSERT) e o cabeçalho editável na mesma transação. A partir desta migration, também limpa e re-snapshota order_item_plates para os itens reinseridos (cores por unidade/plate não são reenviadas aqui — usar update_order_item_production_colors depois). Preserva order_number/order_status/payment_status/pagamentos/aprovações/históricos. Chama recalculate_order_financials() ao final.';

revoke execute on function public.update_quote_order(uuid, uuid, uuid, uuid, text, date, text, numeric, numeric, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.update_quote_order(uuid, uuid, uuid, uuid, text, date, text, numeric, numeric, text, jsonb, uuid)
  to service_role;

-- =============================================================================
-- 12) delete_order / remove_order_item — REDEFINIDAS: corpos reais
--     conferidos integralmente antes desta substituição (delete_order em
--     20260829141000_add_order_deletion_function.sql; remove_order_item em
--     20260814030351_create_order_business_functions.sql). Única mudança
--     em cada: limpar order_item_unit_plate_filaments e order_item_plates
--     (FK ON DELETE RESTRICT a order_items) antes do DELETE de order_items
--     — mesmo escopo restrito de sempre (só os itens do pedido/item em
--     questão). Nenhuma outra linha do corpo é alterada — regras de
--     bloqueio (status/pagamentos/aprovações/versões), mensagens e grants
--     preservados byte a byte.
-- =============================================================================
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
  delete from public.order_item_unit_plate_filaments
    where order_item_id in (select id from public.order_items where order_id = p_order_id);
  delete from public.order_item_plates
    where order_item_id in (select id from public.order_items where order_id = p_order_id);
  delete from public.order_items where order_id = p_order_id;
  delete from public.payment_status_history where order_id = p_order_id;
  delete from public.order_status_history where order_id = p_order_id;
  delete from public.orders where id = p_order_id;
end;
$$;

comment on function public.delete_order(uuid, uuid) is
  'Exclusão física protegida de um pedido: só permitida em QUOTE/CANCELLED, sem pagamento, sem aprovação e sem versão de item Personalizado vinculados. Apaga order_items (+ custom_item_details/spot_item_details/order_item_plates/order_item_unit_plate_filaments), order_status_history, payment_status_history e orders deste pedido — nunca customers/companies/products, nunca outro pedido. Bloqueio levanta ORDER_DELETE_INVALID_STATUS:/ORDER_DELETE_HAS_PAYMENTS:/ORDER_DELETE_HAS_APPROVALS:/ORDER_DELETE_HAS_VERSIONS:.';

revoke execute on function public.delete_order(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_order(uuid, uuid)
  to service_role;

create or replace function public.remove_order_item(
  p_order_item_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_status text;
  v_item_count integer;
begin
  perform public.assert_active_user(p_changed_by);

  select order_id into v_order_id
    from public.order_items
    where id = p_order_item_id;

  if not found then
    raise exception 'order_items.id % não encontrado', p_order_item_id;
  end if;

  select order_status into v_order_status
    from public.orders
    where id = v_order_id
    for update;

  if v_order_status in ('IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED', 'CANCELLED') then
    raise exception 'Não é possível remover item após início da produção (status atual: %)', v_order_status;
  end if;

  select count(*) into v_item_count
    from public.order_items
    where order_id = v_order_id;

  if v_item_count <= 1 then
    raise exception 'Pedido não pode ficar sem nenhum item';
  end if;

  if exists (select 1 from public.custom_versions where order_item_id = p_order_item_id)
     or exists (select 1 from public.approvals where order_item_id = p_order_item_id) then
    raise exception 'Item possui histórico de versão/aprovação e não pode ser removido — cancele o pedido se necessário';
  end if;

  delete from public.custom_item_details where order_item_id = p_order_item_id;
  delete from public.spot_item_details where order_item_id = p_order_item_id;
  delete from public.order_item_unit_plate_filaments
    where order_item_plate_id in (select id from public.order_item_plates where order_item_id = p_order_item_id);
  delete from public.order_item_plates where order_item_id = p_order_item_id;
  delete from public.order_items where id = p_order_item_id;

  perform public.recalculate_order_financials(
    v_order_id, p_changed_by, 'Recálculo após remover item'
  );
end;
$$;

comment on function public.remove_order_item(uuid, uuid) is
  'Remove um único order_item (fora de QUOTE via update_quote_order): bloqueado após início da produção, se for o único item, ou se tiver histórico de versão/aprovação. Apaga custom_item_details/spot_item_details/order_item_plates/order_item_unit_plate_filaments do item antes do próprio order_item. Recalcula financeiro ao final.';

revoke execute on function public.remove_order_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_order_item(uuid, uuid) to service_role;

-- =============================================================================
-- 13) update_order_item_production_colors — RPC pública (só service_role)
--     para completar/alterar cores DEPOIS da criação do Pedido (decisão do
--     usuário: cores normalmente fecham o Pedido, mas podem ser definidas
--     depois, até antes de iniciar a produção). Substitui TODO o conjunto
--     de cores dos itens CATALOG informados no payload (mesma semântica
--     "substitui o conjunto inteiro" já usada no resto do projeto) — nunca
--     altera order_status, nunca toca order_item_plates (snapshot
--     permanece congelado), nunca reserva/consome estoque.
--
--     CONGELAMENTO (regra revisada nesta rodada corretiva) — a edição de
--     cores só é permitida enquanto o Pedido ainda não começou a ser
--     produzido de fato: QUOTE, WAITING_APPROVAL, APPROVED,
--     IN_PRODUCTION_QUEUE (allow-list explícita, nunca uma lista de
--     bloqueio — um status novo que venha a existir no futuro fica
--     bloqueado por padrão, nunca liberado por omissão). Bloqueada em
--     IN_PRODUCTION, WAITING_DELIVERY, DELIVERED e CANCELLED — a
--     especificação de cores fica congelada assim que a produção começa,
--     nunca editável depois (marcador estável
--     ORDER_PRODUCTION_COLORS_FROZEN:, mapeado em _shared/errors.ts para
--     BusinessRuleError/409, sem detalhe interno além do status atual —
--     mesmo padrão de erro de negócio já usado no restante do projeto).
--     Falha em QUALQUER validação (status congelado, seleção inválida)
--     nunca grava nada — toda a função roda numa única transação
--     implícita, sem UPDATE/INSERT parcial.
--
--     Regra de filamento inativo: uma seleção que JÁ EXISTIA antes desta
--     chamada é preservada mesmo que o filamento tenha ficado inativo
--     entretanto (nunca removida silenciosamente); só uma seleção
--     GENUINAMENTE NOVA exige filamento ativo. O conjunto "já existia" é
--     capturado ANTES do DELETE, comparado por igualdade exata de
--     (order_item_plate_id, unit_number, filament_type_id).
-- =============================================================================
create function public.update_order_item_production_colors(
  p_order_id uuid,
  p_selections jsonb,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_old_keys text[];
  v_sel jsonb;
  v_order_item_id uuid;
  v_plate_number integer;
  v_unit_number integer;
  v_order_item_plate_id uuid;
  v_item_order_id uuid;
  v_item_type text;
  v_item_quantity integer;
  v_filament_type_id uuid;
  v_is_active boolean;
  v_tuple_key text;
begin
  perform public.assert_active_user(p_changed_by);

  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then
    raise exception 'p_selections deve ser um array';
  end if;

  select order_status into v_order_status from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;
  -- Allow-list explícita (nunca uma lista de bloqueio) — só os 4 estados
  -- anteriores ao início real da produção permitem editar cores; qualquer
  -- outro status (IN_PRODUCTION, WAITING_DELIVERY, DELIVERED, CANCELLED, ou
  -- um status futuro ainda não previsto) é bloqueado por padrão.
  if v_order_status not in ('QUOTE', 'WAITING_APPROVAL', 'APPROVED', 'IN_PRODUCTION_QUEUE') then
    raise exception 'ORDER_PRODUCTION_COLORS_FROZEN: A configuração de cores foi congelada ao iniciar a produção (status atual: %).', v_order_status;
  end if;

  select coalesce(array_agg(
    opucf.order_item_plate_id::text || ':' || opucf.unit_number::text || ':' || opucf.filament_type_id::text
  ), '{}')
    into v_old_keys
    from public.order_item_unit_plate_filaments opucf
    join public.order_items oi on oi.id = opucf.order_item_id
    where oi.order_id = p_order_id;

  delete from public.order_item_unit_plate_filaments
    where order_item_id in (select id from public.order_items where order_id = p_order_id);

  for v_sel in select * from jsonb_array_elements(p_selections)
  loop
    v_order_item_id := nullif(v_sel ->> 'order_item_id', '')::uuid;
    v_plate_number := (v_sel ->> 'plate_number')::integer;
    v_unit_number := (v_sel ->> 'unit_number')::integer;

    select order_id, item_type, quantity into v_item_order_id, v_item_type, v_item_quantity
      from public.order_items where id = v_order_item_id;

    if v_item_order_id is null or v_item_order_id <> p_order_id or v_item_type <> 'CATALOG' then
      raise exception 'order_item_id % não pertence a este pedido ou não é CATALOG', v_order_item_id;
    end if;

    if v_unit_number is null or v_unit_number < 1 or v_unit_number > v_item_quantity then
      raise exception 'unit_number % fora do intervalo 1..% (quantity do item)', v_unit_number, v_item_quantity;
    end if;

    select id into v_order_item_plate_id
      from public.order_item_plates
      where order_item_id = v_order_item_id and plate_number = v_plate_number;
    if v_order_item_plate_id is null then
      raise exception 'plate_number % não existe no snapshot do item %', v_plate_number, v_order_item_id;
    end if;

    for v_filament_type_id in select value::uuid from jsonb_array_elements_text(coalesce(v_sel -> 'filament_type_ids', '[]'::jsonb)) as value
    loop
      v_tuple_key := v_order_item_plate_id::text || ':' || v_unit_number::text || ':' || v_filament_type_id::text;

      select is_active into v_is_active from public.filament_types where id = v_filament_type_id;
      if not found then
        raise exception 'filament_types.id % não encontrado', v_filament_type_id;
      end if;
      if not v_is_active and not (v_tuple_key = any(v_old_keys)) then
        raise exception 'filament_types.id % está inativo — não pode ser escolhido como seleção nova', v_filament_type_id;
      end if;

      insert into public.order_item_unit_plate_filaments (
        order_item_id, order_item_plate_id, unit_number, filament_type_id, position
      ) values (
        v_order_item_id, v_order_item_plate_id, v_unit_number, v_filament_type_id, 1
      )
      on conflict (order_item_plate_id, unit_number, filament_type_id) do nothing;
    end loop;
  end loop;
end;
$$;

comment on function public.update_order_item_production_colors(uuid, jsonb, uuid) is
  'Substitui atomicamente TODAS as cores (order_item_unit_plate_filaments) dos itens CATALOG de um Pedido a partir do payload (unit_number 1..quantity, plate_number existente no snapshot order_item_plates, filament_type_id ativo — exceto uma seleção que já existia antes desta chamada, preservada mesmo que o filamento tenha ficado inativo entretanto). Nunca altera order_status, nunca toca order_item_plates, nunca reserva/consome estoque. Permitida só em QUOTE/WAITING_APPROVAL/APPROVED/IN_PRODUCTION_QUEUE (allow-list) — bloqueada em IN_PRODUCTION/WAITING_DELIVERY/DELIVERED/CANCELLED (ORDER_PRODUCTION_COLORS_FROZEN:), a configuração fica congelada assim que a produção começa.';

revoke execute on function public.update_order_item_production_colors(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_order_item_production_colors(uuid, jsonb, uuid) to service_role;

-- =============================================================================
-- 14) validate_order_production_readiness — função INTERNA (zero grants):
--     define "item CATALOG completo" para o gate de início real de
--     produção (Seção 15): existe snapshot de ao menos 1 plate; para
--     TODA unidade de 1 a quantity; para TODO plate do snapshot; existe ao
--     menos 1 filamento ATIVO selecionado. Bloqueia listando Produto/item,
--     unidade e plate pendentes, nunca peso por cor (fora de escopo).
-- =============================================================================
create function public.validate_order_production_readiness(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_plate record;
  v_unit integer;
  v_active_count integer;
  v_missing text[] := '{}';
begin
  for v_item in
    select oi.id as order_item_id, oi.item_name, oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id and oi.item_type = 'CATALOG'
  loop
    if not exists (select 1 from public.order_item_plates where order_item_id = v_item.order_item_id) then
      v_missing := v_missing || (v_item.item_name || ': nenhuma estrutura produtiva no snapshot');
      continue;
    end if;

    for v_plate in
      select id, plate_number from public.order_item_plates
      where order_item_id = v_item.order_item_id
      order by plate_number
    loop
      for v_unit in 1..v_item.quantity loop
        select count(*) into v_active_count
          from public.order_item_unit_plate_filaments opucf
          join public.filament_types ft on ft.id = opucf.filament_type_id
          where opucf.order_item_plate_id = v_plate.id
            and opucf.unit_number = v_unit
            and ft.is_active;

        if v_active_count = 0 then
          v_missing := v_missing || (
            v_item.item_name || ' — Unidade ' || v_unit || ', Plate ' || v_plate.plate_number || ': cor pendente'
          );
        end if;
      end loop;
    end loop;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'ORDER_PRODUCTION_COLORS_PENDING: Defina as cores antes de iniciar a produção — %.', array_to_string(v_missing, '; ');
  end if;
end;
$$;

comment on function public.validate_order_production_readiness(uuid) is
  'Função INTERNA (zero grants) — bloqueia a transição IN_PRODUCTION_QUEUE -> IN_PRODUCTION (change_order_status, Seção 15) enquanto qualquer item CATALOG tiver unidade/plate sem ao menos 1 filamento ATIVO selecionado (um filamento inativo já selecionado não conta como definição válida). Nunca exige peso por cor. Marcador estável ORDER_PRODUCTION_COLORS_PENDING:.';

revoke execute on function public.validate_order_production_readiness(uuid) from public, anon, authenticated, service_role;

-- =============================================================================
-- 15) change_order_status — REDEFINIDA: corpo real conferido integralmente
--     (20260829150000_add_order_initial_status_classification.sql, nunca
--     modificada por nenhuma migration desde então) antes desta
--     substituição. Única mudança: a transição IN_PRODUCTION_QUEUE ->
--     IN_PRODUCTION passa a chamar validate_order_production_readiness()
--     (Seção 14) antes do UPDATE — bloqueia se qualquer item CATALOG
--     estiver com cor pendente. Máquina de transições, autenticação,
--     changed_by, histórico, cancelamento, aprovações (bloco APPROVED via
--     try_auto_approve_order), auto-aprovação após WAITING_APPROVAL,
--     mensagens não relacionadas, grants, SECURITY DEFINER e
--     search_path="" preservados byte a byte. SPOT/CUSTOM sem nenhuma
--     mudança de comportamento (gate de tempo de SPOT continua removido,
--     decisão da rodada anterior).
-- =============================================================================
create or replace function public.change_order_status(
  p_order_id uuid,
  p_to_status text,
  p_changed_by uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
  v_sequence text[] := array[
    'QUOTE', 'WAITING_APPROVAL', 'APPROVED', 'IN_PRODUCTION_QUEUE',
    'IN_PRODUCTION', 'WAITING_DELIVERY', 'DELIVERED'
  ];
  v_current_pos integer;
  v_target_pos integer;
  v_status_after_approval_attempt text;
begin
  perform public.assert_active_user(p_changed_by);

  select order_status into v_current_status
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'orders.id % não encontrado', p_order_id;
  end if;

  v_current_pos := array_position(v_sequence, v_current_status);

  if p_to_status = 'CANCELLED' then
    if v_current_pos is null or v_current_pos >= array_position(v_sequence, 'IN_PRODUCTION') then
      raise exception 'Cancelamento só é permitido antes do início da produção (status atual: %)', v_current_status;
    end if;

    update public.orders set order_status = 'CANCELLED' where id = p_order_id;

    insert into public.order_status_history (
      order_id, from_status, to_status, changed_by, reason
    ) values (
      p_order_id, v_current_status, 'CANCELLED', p_changed_by,
      coalesce(p_reason, 'Pedido cancelado')
    );

    return;
  end if;

  v_target_pos := array_position(v_sequence, p_to_status);

  if v_target_pos is null then
    raise exception 'order_status de destino inválido: %', p_to_status;
  end if;

  if v_current_pos is null then
    raise exception 'Pedido está em % — nenhuma transição de status é permitida a partir daqui', v_current_status;
  end if;

  if v_target_pos <> v_current_pos + 1 then
    raise exception 'Transição de status inválida: % -> % (não é possível pular estados)', v_current_status, p_to_status;
  end if;

  if p_to_status = 'APPROVED' then
    perform public.try_auto_approve_order(p_order_id, p_changed_by, p_reason);

    select order_status into v_status_after_approval_attempt
      from public.orders
      where id = p_order_id;

    if v_status_after_approval_attempt <> 'APPROVED' then
      raise exception 'Aprovações obrigatórias pendentes — pedido permanece em WAITING_APPROVAL';
    end if;

    return;
  end if;

  -- GATE NOVO (esta migration): antes de iniciar a produção de verdade,
  -- todo item CATALOG precisa ter cor definida em toda unidade/plate do
  -- snapshot (validate_order_production_readiness, Seção 14). Só se aplica
  -- à transição IN_PRODUCTION_QUEUE -> IN_PRODUCTION — entrar na Fila
  -- continua nunca exigindo cor (Seção 9/10).
  if v_current_status = 'IN_PRODUCTION_QUEUE' and p_to_status = 'IN_PRODUCTION' then
    perform public.validate_order_production_readiness(p_order_id);
  end if;

  update public.orders set order_status = p_to_status where id = p_order_id;

  insert into public.order_status_history (
    order_id, from_status, to_status, changed_by, reason
  ) values (
    p_order_id, v_current_status, p_to_status, p_changed_by,
    coalesce(p_reason, 'Transição de status')
  );

  if p_to_status = 'WAITING_APPROVAL' then
    perform public.try_auto_approve_order(p_order_id, p_changed_by, p_reason);
  end if;
end;
$$;

comment on function public.change_order_status(uuid, text, uuid, text) is
  'Máquina de estados de orders.order_status: só permite avançar uma posição por vez na sequência QUOTE->WAITING_APPROVAL->APPROVED->IN_PRODUCTION_QUEUE->IN_PRODUCTION->WAITING_DELIVERY->DELIVERED, ou CANCELLED antes de IN_PRODUCTION. A transição IN_PRODUCTION_QUEUE->IN_PRODUCTION exige validate_order_production_readiness() (todo item CATALOG com cor ativa definida em toda unidade/plate do snapshot) a partir desta migration — entrar na Fila continua nunca exigindo cor. A transição para APPROVED delega a validação de aprovações a try_auto_approve_order(). Nunca altera payment_status. search_time_status de SPOT continua sem nenhum gate (decisão de rodada anterior).';

revoke execute on function public.change_order_status(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.change_order_status(uuid, text, uuid, text) to service_role;

-- =============================================================================
-- 16) BACKFILL — só executa quando esta migration for aplicada (não nesta
--     rodada). Duas partes independentes: categorias e peso direto por
--     plate. Nenhum Produto/Pedido existente muda de status/preço; nenhum
--     dado legado (product_filaments/product_plate_filaments) é apagado.
-- =============================================================================

-- 16.1 — Categorias: 1 categoria (position=1) por Produto com
-- products.category preenchido — nenhuma perdida, nenhuma duplicada.
-- products.category em si não é tocado por este bloco (é a própria fonte
-- da cópia — o espelho já bate por construção).
do $$
declare
  v_product record;
begin
  for v_product in select id, category from public.products where category is not null
  loop
    insert into public.product_categories (product_id, category, position)
    values (v_product.id, v_product.category, 1)
    on conflict (product_id, category) do nothing;
  end loop;
end $$;

-- 16.2 — Peso direto por plate: estratégia auditada contra o estado real
-- de product_plates/product_plate_filaments/products antes de escrever
-- este bloco (ver relatório da rodada que aplicar esta migration).
--   - plate com filamentos legados (product_plate_filaments) próprios:
--     peso direto = soma desses filamentos;
--   - Produto com um ÚNICO plate SEM filamentos: peso direto = peso
--     efetivo atual (products.default_weight_grams);
--   - Produto com MÚLTIPLOS plates onde algum não tem filamentos legados
--     próprios: ABORTA a migration inteira (distribuição ambígua — nunca
--     inventada);
--   - total efetivo sempre preservado: se não havia ajuste manual e a nova
--     soma automática diverge do efetivo anterior, grava um ajuste manual
--     com o valor antigo (mesma rede de segurança da migration anterior).
do $$
declare
  v_product record;
  v_plate record;
  v_plate_count integer;
  v_legacy_weight numeric(10, 2);
  v_single_plate_id uuid;
  v_new_auto_total numeric(10, 2);
begin
  for v_product in
    select id, default_weight_grams, production_weight_manual_override_grams from public.products
  loop
    select count(*) into v_plate_count from public.product_plates where product_id = v_product.id;
    if v_plate_count = 0 then
      continue;
    end if;

    if v_plate_count = 1 then
      select id into v_single_plate_id from public.product_plates where product_id = v_product.id;
      select coalesce(sum(weight_grams), 0) into v_legacy_weight
        from public.product_plate_filaments where plate_id = v_single_plate_id;

      if v_legacy_weight > 0 then
        update public.product_plates set weight_grams = v_legacy_weight where id = v_single_plate_id;
      else
        update public.product_plates
          set weight_grams = coalesce(v_product.default_weight_grams, 0)
          where id = v_single_plate_id;
      end if;
    else
      for v_plate in select id from public.product_plates where product_id = v_product.id
      loop
        select coalesce(sum(weight_grams), 0) into v_legacy_weight
          from public.product_plate_filaments where plate_id = v_plate.id;

        if v_legacy_weight = 0 then
          raise exception 'Abortando: Produto % tem múltiplos plates e o plate % não tem nenhum filamento legado para determinar o peso direto — distribuição ambígua, não inventada.', v_product.id, v_plate.id;
        end if;

        update public.product_plates set weight_grams = v_legacy_weight where id = v_plate.id;
      end loop;
    end if;

    if v_product.production_weight_manual_override_grams is null then
      select coalesce(sum(weight_grams), 0) into v_new_auto_total
        from public.product_plates where product_id = v_product.id;

      if v_new_auto_total is distinct from v_product.default_weight_grams then
        update public.products
          set production_weight_manual_override_grams = v_product.default_weight_grams
          where id = v_product.id;
      end if;
    end if;
  end loop;
end $$;

-- =============================================================================
-- 17) Verificações — mesmo padrão de todas as migrations anteriores deste
--     projeto: prova estruturalmente que nada além do pretendido mudou.
-- =============================================================================
do $$
declare
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
  v_orphan_count integer;
  v_products_with_category integer;
  v_products_with_category_row integer;
  v_mirror_mismatch_count integer;
  v_negative_weight_count integer;
  v_effective_mismatch_count integer;
begin
  -- 17.1 Zero grants: set_product_categories, set_product_production,
  -- validate_catalog_production_structure_for_creation,
  -- validate_order_production_readiness.
  select has_function_privilege('anon', 'public.set_product_categories(uuid,jsonb,uuid)', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.set_product_categories(uuid,jsonb,uuid)', 'EXECUTE')
      or has_function_privilege('service_role', 'public.set_product_categories(uuid,jsonb,uuid)', 'EXECUTE')
    into v_anon_can_execute;
  if v_anon_can_execute then
    raise exception 'Abortando: set_product_categories tem EXECUTE concedido a alguém — deveria ser função interna sem nenhum grant.';
  end if;

  select has_function_privilege('anon', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE')
      or has_function_privilege('service_role', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE')
    into v_anon_can_execute;
  if v_anon_can_execute then
    raise exception 'Abortando: set_product_production tem EXECUTE concedido a alguém — deveria ser função interna sem nenhum grant.';
  end if;

  select has_function_privilege('anon', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE')
      or has_function_privilege('service_role', 'public.validate_catalog_production_structure_for_creation(jsonb)', 'EXECUTE')
    into v_anon_can_execute;
  if v_anon_can_execute then
    raise exception 'Abortando: validate_catalog_production_structure_for_creation tem EXECUTE concedido a alguém — deveria ser função interna sem nenhum grant.';
  end if;

  select has_function_privilege('anon', 'public.validate_order_production_readiness(uuid)', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.validate_order_production_readiness(uuid)', 'EXECUTE')
      or has_function_privilege('service_role', 'public.validate_order_production_readiness(uuid)', 'EXECUTE')
    into v_anon_can_execute;
  if v_anon_can_execute then
    raise exception 'Abortando: validate_order_production_readiness tem EXECUTE concedido a alguém — deveria ser função interna sem nenhum grant.';
  end if;

  -- 17.2 RPCs públicas novas/alteradas: exclusivas de service_role.
  select has_function_privilege('authenticated', 'public.create_product_with_plates(text,text,jsonb,text,numeric,uuid,boolean,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.create_product_with_plates(text,text,jsonb,text,numeric,uuid,boolean,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;
  if v_authenticated_can_execute or not v_service_role_can_execute then
    raise exception 'Abortando: create_product_with_plates(nova assinatura) grants incorretos (authenticated=%, service_role=%).', v_authenticated_can_execute, v_service_role_can_execute;
  end if;

  select has_function_privilege('authenticated', 'public.update_product_full(uuid,jsonb,jsonb,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.update_product_full(uuid,jsonb,jsonb,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;
  if v_authenticated_can_execute or not v_service_role_can_execute then
    raise exception 'Abortando: update_product_full(nova assinatura) grants incorretos (authenticated=%, service_role=%).', v_authenticated_can_execute, v_service_role_can_execute;
  end if;

  select has_function_privilege('authenticated', 'public.update_order_item_production_colors(uuid,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.update_order_item_production_colors(uuid,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;
  if v_authenticated_can_execute or not v_service_role_can_execute then
    raise exception 'Abortando: update_order_item_production_colors grants incorretos (authenticated=%, service_role=%).', v_authenticated_can_execute, v_service_role_can_execute;
  end if;

  -- 17.3 As DUAS antigas assinaturas de create_product_with_plates/
  -- update_product_full (com p_category text) não existem mais — o DROP
  -- da Seção 5/6 removeu, nunca deixou as duas coexistindo.
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'create_product_with_plates'
      and pg_get_function_identity_arguments(oid) = 'text, text, text, text, numeric, uuid, boolean, jsonb, numeric, integer, jsonb, jsonb, uuid'
  ) then
    raise exception 'Abortando: a assinatura ANTIGA de create_product_with_plates (p_category text) ainda existe — o DROP da Seção 5 deveria tê-la removido.';
  end if;
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'update_product_full'
      and pg_get_function_identity_arguments(oid) = 'uuid, jsonb, jsonb, numeric, integer, jsonb, jsonb, uuid'
  ) then
    raise exception 'Abortando: a assinatura ANTIGA de update_product_full (8 parâmetros) ainda existe — o DROP da Seção 6 deveria tê-la removido.';
  end if;

  -- 17.4 Nenhum resíduo de composição legada: cada linha de
  -- product_plate_filaments continua presa a um plate existente (a FK
  -- CASCADE nunca deixa órfão por definição, mas prova estruturalmente).
  select count(*) into v_orphan_count
    from public.product_plate_filaments ppf
    left join public.product_plates pp on pp.id = ppf.plate_id
    where pp.id is null;
  if v_orphan_count > 0 then
    raise exception 'Abortando: % linha(s) órfã(s) em product_plate_filaments (sem plate correspondente).', v_orphan_count;
  end if;

  -- 17.5 Espelho products.category consistente com product_categories
  -- (position=1) para todo Produto que tem ao menos 1 categoria.
  select count(*) into v_mirror_mismatch_count
    from public.products p
    join public.product_categories pc on pc.product_id = p.id and pc.position = 1
    where p.category is distinct from pc.category;
  if v_mirror_mismatch_count > 0 then
    raise exception 'Abortando: % Produto(s) com products.category divergente da categoria position=1 em product_categories.', v_mirror_mismatch_count;
  end if;

  select count(*) into v_products_with_category from public.products where category is not null;
  select count(distinct product_id) into v_products_with_category_row from public.product_categories;
  if v_products_with_category_row < v_products_with_category then
    raise exception 'Abortando: % Produto(s) com products.category preenchido não têm nenhuma linha em product_categories — o backfill 16.1 deveria ter coberto todos.', v_products_with_category - v_products_with_category_row;
  end if;

  -- 17.6 Nenhum peso de plate negativo (defesa redundante ao CHECK, prova
  -- que o backfill 16.2 nunca gravou um valor inválido).
  select count(*) into v_negative_weight_count from public.product_plates where weight_grams < 0;
  if v_negative_weight_count > 0 then
    raise exception 'Abortando: % plate(s) com weight_grams negativo após o backfill.', v_negative_weight_count;
  end if;

  -- 17.7 Total efetivo preservado: para todo Produto com plates, o
  -- coalesce(ajuste manual, soma automática) bate exatamente com
  -- default_weight_grams atual.
  select count(*) into v_effective_mismatch_count
    from public.products p
    where exists (select 1 from public.product_plates pp where pp.product_id = p.id)
      and coalesce(
            p.production_weight_manual_override_grams,
            (select sum(weight_grams) from public.product_plates pp2 where pp2.product_id = p.id)
          ) is distinct from p.default_weight_grams;
  if v_effective_mismatch_count > 0 then
    raise exception 'Abortando: % Produto(s) com peso efetivo divergente do valor anterior após o backfill 16.2 — o ajuste manual deveria ter preservado.', v_effective_mismatch_count;
  end if;
end $$;
