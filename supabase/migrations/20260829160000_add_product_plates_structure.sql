-- Bloco 1 — Produtos
-- Migration: estrutura produtiva por PLATES (regra aprovada pelo usuário,
-- 2026-08-29, ver docs/05_ROADMAP_MODULOS.md). Alguns Produtos precisam ser
-- produzidos em mais de um plate de impressão; cada plate pode ter
-- composição própria de filamentos/cores, peso e tempo de produção
-- independentes. Também formaliza o vínculo de Acessórios/Embalagens na
-- CRIAÇÃO de um Produto (antes só possível editando um produto já criado,
-- via PATCH /products/:id/composition).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada). Aplicar exige autorização
-- explícita separada, fora do escopo desta entrada.
--
-- FONTE AUTORITATIVA (definição CONCLUÍDA nesta rodada corretiva de
-- 2026-08-29 — uma rodada anterior só tinha corrigido o lado FRONTEND,
-- deixando a validação de Pedidos e a RPC legada ainda aceitarem/
-- permitirem escrita por product_filaments; auditoria bloqueou até isso
-- ser fechado também no banco): a partir de quando esta migration for
-- aplicada, product_plates/product_plate_filaments passam a ser a ÚNICA
-- estrutura autoritativa da composição de produção, em TODOS os níveis:
--   - escrita: só set_product_production (Seção 4), chamada só de dentro
--     de create_product_with_plates/update_product_full (Seções 5-6);
--   - validação de Pedidos: validate_catalog_composition_for_creation
--     (Seção 9) passa a exigir composição real em product_plate_filaments
--     — product_filaments deixa de ser aceita como alternativa;
--   - RPC/rota legada: set_product_filaments perde o grant de EXECUTE de
--     service_role (Seção 10) — PATCH /products/:id/filaments passa a
--     responder com um erro de negócio, sem chegar a chamar a RPC.
-- product_filaments (tabela) e set_product_filaments (função) NÃO são
-- removidas nem têm nenhuma linha apagada — preservadas apenas como DADO
-- LEGADO/histórico e como fonte do próprio backfill (Seção 7). Nenhum
-- trigger sincroniza as duas tabelas — não é necessário, porque depois
-- desta migration não sobra nenhum caminho de escrita operacional em
-- product_filaments capaz de divergir de product_plates. A remoção FÍSICA
-- dessa dependência legada (dropar a tabela/função, remover o fallback de
-- leitura do frontend) continua sendo um passo FUTURO, separado, só depois
-- que 100% dos Produtos ativos tiverem confirmadamente ao menos 1 linha em
-- product_plates — não antes disso, e não parte desta migration.
--
-- NOMENCLATURA — ATENÇÃO: "plate" aqui é um conceito NOVO ("um dos N
-- trabalhos de impressão separados que compõem uma unidade do Produto",
-- cada um com sua própria composição/peso/tempo) e é INTEIRAMENTE
-- DIFERENTE de products.units_per_plate (coluna legada, já removida de
-- "Novo produto" e da Ficha Técnica desde 20260821090000 — "quantas
-- unidades cabem numa mesma bandeja de impressão", nunca editável em
-- nenhuma tela desde então). Esta migration NÃO toca units_per_plate —
-- continua exatamente como estava, coluna presente mas não usada por
-- nenhum fluxo. Os dois conceitos só compartilham a palavra "plate" por
-- coincidência de domínio (impressão 3D); nenhuma relação entre eles.
--
-- MODELO ADOTADO (normalizado, duas tabelas novas):
--   product_plates          — um plate de um Produto (número/posição +
--                              tempo de produção do plate, em segundos).
--   product_plate_filaments — uma linha de filamento/cor DENTRO de um
--                              plate (peso em gramas), N por plate.
-- Substitui por completo, como fonte de verdade da Ficha Técnica de
-- produção e da validação de composição de Pedidos, o modelo anterior
-- "flat" (public.product_filaments, Migration 20260827113000 — 1 nível,
-- sem noção de plate). A tabela product_filaments e a função
-- set_product_filaments NÃO são removidas nem têm nenhuma linha apagada
-- por esta migration — permanecem intactas, só como registro histórico e
-- fonte de dados do próprio backfill (Seção 7 abaixo); deixam de ser um
-- caminho de ESCRITA operacional (Seção 10) e deixam de ser aceitas pela
-- validação de composição de Pedidos (Seção 9) assim que esta migration
-- for aplicada — ver "FONTE AUTORITATIVA" acima para a decisão completa.
--
-- TOTAIS EFETIVOS — decisão de design: em vez de criar colunas novas
-- "peso efetivo"/"tempo efetivo" que os contratos existentes precisariam
-- aprender a ler, os totais efetivos continuam gravados nas MESMAS colunas
-- já existentes e já lidas por todo o sistema — products.default_weight_grams
-- e products.default_print_time_seconds. Nenhum consumidor atual desses
-- dois campos (Ficha Técnica, update_product, validate_catalog_composition_for_creation
-- indiretamente via criação de Pedido, o que quer que leia esses campos
-- hoje) precisa de NENHUMA alteração — eles continuam recebendo o mesmo
-- tipo de valor de sempre (numeric/integer, nullable), só que agora
-- calculado por set_product_production() em vez de digitado direto pelo
-- usuário. O cálculo AUTOMÁTICO (soma dos plates) nunca é persistido à
-- parte — é sempre recalculável a partir de product_plates/
-- product_plate_filaments (o próprio frontend, que já carrega os plates
-- para exibir, soma localmente para mostrar "peso calculado: X g" mesmo
-- quando um ajuste manual está em vigor, sem precisar de uma nova
-- consulta). Só o AJUSTE MANUAL (quando presente) é persistido, em duas
-- colunas novas nullable — null = "sem ajuste, use o cálculo automático"
-- nesse campo especificamente (peso e tempo são ajustáveis de forma
-- INDEPENDENTE um do outro, nunca exigidos juntos):
--   products.production_weight_manual_override_grams
--   products.production_time_manual_override_seconds
-- valor efetivo de cada campo = coalesce(ajuste manual daquele campo, soma
-- automática dos plates) — nunca arredondamento oculto, nunca um terceiro
-- valor inventado.
--
-- CONTRATO CENTRALIZADO — set_product_production() (função interna, ZERO
-- grants, mesmo padrão de assert_active_user/jsonb_whitelist/
-- validate_catalog_composition_for_creation) substitui atomicamente o
-- conjunto inteiro de plates+filamentos de um Produto e recalcula/grava os
-- totais efetivos — chamada de dentro das duas RPCs públicas novas abaixo
-- (create_product_with_plates para criação, update_product_full para
-- edição), nunca duplicada.
--
-- SALVAMENTO ATÔMICO (Produto + plates + filamentos + totais + ajuste +
-- acessórios + embalagens, criação E edição): create_product_with_plates()
-- reaproveita create_product() (Migration 20260821090000, sem duplicar seu
-- corpo) + set_product_production() (nova) + set_product_composition()
-- (Migration 20260816150500, sem duplicar seu corpo) — as três chamadas
-- dentro de UMA ÚNICA função/transação, mesmo padrão já usado por
-- create_order_with_payment (Migration 20260829142000). update_product_full()
-- espelha o mesmo desenho para edição, reaproveitando update_product()
-- (Migration 20260829143000) em vez de create_product(). Se qualquer parte
-- falhar, a transação inteira desfaz — nenhuma alteração parcial.
--
-- Nenhuma reserva ou consumo de filamento é implementado por esta
-- migration — product_plate_filaments é só modelo/composição teórica,
-- igual a product_filaments antes dela; nenhuma automação lê estas tabelas
-- para movimentar estoque.

-- =============================================================================
-- 1) products — 2 colunas novas de ajuste manual (nullable, independentes
--    entre si — nunca "os dois juntos ou nenhum").
-- =============================================================================
alter table public.products
  add column production_weight_manual_override_grams numeric(10, 2)
    check (production_weight_manual_override_grams is null or production_weight_manual_override_grams >= 0),
  add column production_time_manual_override_seconds integer
    check (production_time_manual_override_seconds is null or production_time_manual_override_seconds >= 0);

comment on column public.products.production_weight_manual_override_grams is
  'Ajuste manual do peso total de produção ("Ajustar totais"). NULL = sem ajuste, o peso efetivo (default_weight_grams) é o cálculo automático (soma dos plates). Não NULL = valor efetivo. Independente de production_time_manual_override_seconds — cada campo pode ser ajustado sozinho. Nunca editável direto por authenticated — só via set_product_production() (dentro de create_product_with_plates/update_product_full).';

comment on column public.products.production_time_manual_override_seconds is
  'Ajuste manual do tempo total de produção, em segundos ("Ajustar totais"). NULL = sem ajuste, o tempo efetivo (default_print_time_seconds) é o cálculo automático (soma dos plates). Mesmas regras de production_weight_manual_override_grams, campo independente.';

-- =============================================================================
-- 2) product_plates — um plate (posição/ordem + tempo de produção) de um
--    Produto.
-- =============================================================================
create table public.product_plates (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT: mesmo padrão de 100% das FKs deste projeto —
  -- products não concede DELETE físico a authenticated (só is_active),
  -- RESTRICT é puramente defensivo.
  product_id uuid not null references public.products (id) on delete restrict,

  -- Posição/ordem do plate dentro do Produto ("Plate 1", "Plate 2", ...) —
  -- sempre 1..N sem buraco, atribuída por set_product_production() a
  -- partir da posição do plate no array recebido (nunca informada
  -- livremente pelo cliente, para nunca haver buraco/duplicata/ordem
  -- inconsistente).
  plate_number integer not null check (plate_number > 0),

  -- Tempo de produção deste plate, em segundos (mesma unidade de
  -- products.default_print_time_seconds) — informado diretamente pelo
  -- usuário (não somado de nenhuma outra tabela). >= 0: um plate pode
  -- legitimamente não ter tempo informado ainda (0), mas nunca negativo.
  production_time_seconds integer not null default 0 check (production_time_seconds >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Nunca duas linhas com o mesmo número de plate no mesmo Produto.
  unique (product_id, plate_number)
);

comment on table public.product_plates is
  'Um plate (trabalho de impressão separado) de um Produto — "Plate 1", "Plate 2" etc. Peso do plate é a soma de product_plate_filaments (não uma coluna própria — sempre recalculável a partir das linhas de filamento). Escrita só via set_product_production() (substitui o conjunto inteiro de plates de um Produto atomicamente, chamada de dentro de create_product_with_plates/update_product_full). NUNCA confundir com products.units_per_plate (coluna legada e não relacionada — ver cabeçalho da migration).';

create index idx_product_plates_product_id on public.product_plates (product_id);

create trigger set_product_plates_updated_at
  before update on public.product_plates
  for each row
  execute function public.set_updated_at();

alter table public.product_plates enable row level security;

revoke all on public.product_plates from anon;
revoke all on public.product_plates from authenticated;
-- Só leitura direta: escrita exclusivamente via set_product_production
-- (security definer, chamada só de dentro das 2 RPCs públicas novas) —
-- mesmo padrão de product_filaments/product_accessories/product_packaging.
grant select on public.product_plates to authenticated;

create policy "Active users can view product plates"
  on public.product_plates
  for select
  to authenticated
  using (public.is_active_user());

-- =============================================================================
-- 3) product_plate_filaments — uma linha de filamento/cor dentro de um
--    plate (peso em gramas). Várias por plate; o mesmo filament_type_id
--    nunca se repete no mesmo plate (unicidade abaixo).
-- =============================================================================
create table public.product_plate_filaments (
  id uuid primary key default gen_random_uuid(),

  plate_id uuid not null references public.product_plates (id) on delete restrict,
  filament_type_id uuid not null references public.filament_types (id) on delete restrict,

  -- Peso, em gramas, deste filamento/cor neste plate — fracionário
  -- (numeric), mesmo padrão de product_filaments.theoretical_weight_grams.
  -- > 0: uma linha de composição sem peso não representa nada real (mesma
  -- regra já aplicada a product_filaments).
  weight_grams numeric(10, 2) not null check (weight_grams > 0),

  created_at timestamptz not null default now(),

  -- Impede duas linhas do mesmo filamento no mesmo plate — múltiplas
  -- CORES/filamentos no mesmo plate continuam permitidos (são
  -- filament_type_id diferentes); quantidade maior do MESMO filamento é
  -- só um peso maior na mesma linha, nunca duas linhas.
  unique (plate_id, filament_type_id)
);

comment on table public.product_plate_filaments is
  'Composição de filamentos/cores de um plate específico (public.product_plates) — peso em gramas por tipo de filamento. Substitui, para Produtos com plates, o papel antes cumprido por product_filaments (que continua existindo intocada, para compatibilidade). Escrita só via set_product_production(). Nenhuma automação de reserva/consumo lê esta tabela.';

create index idx_product_plate_filaments_plate_id on public.product_plate_filaments (plate_id);

alter table public.product_plate_filaments enable row level security;

revoke all on public.product_plate_filaments from anon;
revoke all on public.product_plate_filaments from authenticated;
grant select on public.product_plate_filaments to authenticated;

create policy "Active users can view product plate filaments"
  on public.product_plate_filaments
  for select
  to authenticated
  using (public.is_active_user());

-- =============================================================================
-- 4) set_product_production — função INTERNA (zero grants, mesmo padrão de
--    assert_active_user/jsonb_whitelist/validate_catalog_composition_for_creation):
--    substitui atomicamente TODO o conjunto de plates+filamentos de um
--    Produto e recalcula/grava os totais efetivos (default_weight_grams/
--    default_print_time_seconds) + os 2 ajustes manuais. Chamada só de
--    dentro de create_product_with_plates/update_product_full (Seção 5/6).
--
--    p_plates: array jsonb, um objeto por plate, na ORDEM desejada (a
--    posição no array define plate_number = índice+1, nunca um campo
--    separado no payload — impossível haver buraco/duplicata):
--      {
--        "production_time_seconds": <inteiro >= 0>,
--        "filaments": [
--          {"filament_type_id": <uuid>, "weight_grams": <número > 0>},
--          ...
--        ]
--      }
--    Um plate pode ter ZERO linhas de filamento (produto ainda sendo
--    montado/só o tempo já definido) — decisão deliberada de não bloquear
--    nesse caso: a UI normal sempre sugere ao menos uma linha, mas a RPC
--    não IMPÕE isso, para nunca travar a compatibilidade com dados
--    parciais (inclusive o próprio backfill futuro desta migration, que
--    cria uma Plate 1 mesmo para Produtos sem nenhuma linha em
--    product_filaments, só com tempo/peso legados).
--
--    p_plates nulo/vazio (nenhum plate): Produto sem produção cadastrada —
--    mesmo estado "não informado" de antes desta migration (nunca 0
--    disfarçado de valor real); o efetivo vira só o ajuste manual, se
--    houver algum, senão NULL.
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
  v_filament jsonb;
  v_plate_id uuid;
  v_plate_number integer := 0;
  v_plate_time integer;
  v_filament_type_id uuid;
  v_weight numeric;
  v_seen_filament_ids uuid[] := '{}';
  v_auto_weight_total numeric(10, 2) := 0;
  v_auto_time_total integer := 0;
  v_effective_weight numeric(10, 2);
  v_effective_time integer;
begin
  perform public.assert_active_user(p_changed_by);

  -- Trava products (não as tabelas de plates): serializa duas chamadas
  -- concorrentes para o mesmo produto, mesmo padrão de
  -- update_product_price/set_product_composition/set_product_filaments.
  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'products.id % não encontrado', p_product_id;
  end if;

  if p_plates is not null and jsonb_typeof(p_plates) <> 'array' then
    raise exception 'set_product_production: p_plates deve ser um array';
  end if;

  if p_manual_weight_override_grams is not null and p_manual_weight_override_grams < 0 then
    raise exception 'set_product_production: p_manual_weight_override_grams não pode ser negativo';
  end if;
  if p_manual_time_override_seconds is not null and p_manual_time_override_seconds < 0 then
    raise exception 'set_product_production: p_manual_time_override_seconds não pode ser negativo';
  end if;

  -- Substituição completa: apaga filamentos de cada plate ANTES dos
  -- plates (FK RESTRICT), depois insere o conjunto novo inteiro — mesmo
  -- idioma de set_product_filaments/set_product_composition/
  -- update_quote_order (delete + insert na mesma transação, nunca um
  -- PATCH incremental linha a linha).
  delete from public.product_plate_filaments
    where plate_id in (select id from public.product_plates where product_id = p_product_id);
  delete from public.product_plates where product_id = p_product_id;

  for v_plate in select * from jsonb_array_elements(coalesce(p_plates, '[]'::jsonb))
  loop
    v_plate_number := v_plate_number + 1;

    v_plate_time := (v_plate ->> 'production_time_seconds')::integer;
    if v_plate_time is null or v_plate_time < 0 then
      raise exception 'Plate %: production_time_seconds deve ser um número inteiro maior ou igual a zero', v_plate_number;
    end if;

    insert into public.product_plates (product_id, plate_number, production_time_seconds)
    values (p_product_id, v_plate_number, v_plate_time)
    returning id into v_plate_id;

    v_auto_time_total := v_auto_time_total + v_plate_time;
    v_seen_filament_ids := '{}';

    for v_filament in select * from jsonb_array_elements(coalesce(v_plate -> 'filaments', '[]'::jsonb))
    loop
      v_filament_type_id := (v_filament ->> 'filament_type_id')::uuid;
      v_weight := (v_filament ->> 'weight_grams')::numeric;

      if v_filament_type_id is null then
        raise exception 'Plate %: filamento sem filament_type_id', v_plate_number;
      end if;
      if v_weight is null or v_weight <= 0 then
        raise exception 'Plate %: weight_grams deve ser um número positivo', v_plate_number;
      end if;
      if v_filament_type_id = any(v_seen_filament_ids) then
        raise exception 'Plate %: o mesmo filamento não pode aparecer duas vezes no mesmo plate', v_plate_number;
      end if;
      if not exists (
        select 1 from public.filament_types where id = v_filament_type_id and is_active
      ) then
        raise exception 'filament_types.id % não encontrado ou inativo', v_filament_type_id;
      end if;

      insert into public.product_plate_filaments (plate_id, filament_type_id, weight_grams)
      values (v_plate_id, v_filament_type_id, v_weight);

      v_seen_filament_ids := v_seen_filament_ids || v_filament_type_id;
      v_auto_weight_total := v_auto_weight_total + v_weight;
    end loop;
  end loop;

  if v_plate_number = 0 then
    -- Nenhum plate: sem cálculo automático possível — o efetivo é só o
    -- ajuste manual, se houver, senão NULL (nunca 0 disfarçado).
    v_effective_weight := p_manual_weight_override_grams;
    v_effective_time := p_manual_time_override_seconds;
  else
    v_effective_weight := coalesce(p_manual_weight_override_grams, v_auto_weight_total);
    v_effective_time := coalesce(p_manual_time_override_seconds, v_auto_time_total);
  end if;

  -- Grava o efetivo nas MESMAS colunas já lidas por todo o sistema (ver
  -- nota "TOTAIS EFETIVOS" no cabeçalho) + os 2 ajustes manuais
  -- (persistidos tal como recebidos, nunca arredondados).
  update public.products
    set default_weight_grams = v_effective_weight,
        default_print_time_seconds = v_effective_time,
        production_weight_manual_override_grams = p_manual_weight_override_grams,
        production_time_manual_override_seconds = p_manual_time_override_seconds
    where id = p_product_id;
end;
$$;

comment on function public.set_product_production(uuid, jsonb, numeric, integer, uuid) is
  'Substitui atomicamente TODO o conjunto de plates+filamentos de um Produto (product_plates/product_plate_filaments) e recalcula/grava os totais efetivos (products.default_weight_grams/default_print_time_seconds = ajuste manual, se houver, senão soma automática dos plates) + os 2 ajustes manuais independentes. Função interna: nenhum EXECUTE concedido a ninguém (nem service_role) — só chamável de dentro de create_product_with_plates/update_product_full, que já executam como o owner (mesmo padrão de assert_active_user/jsonb_whitelist).';

revoke execute on function public.set_product_production(uuid, jsonb, numeric, integer, uuid)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- 5) create_product_with_plates — criação atômica: Produto + plates +
--    filamentos + totais/ajuste + Acessórios + Embalagens, tudo numa única
--    transação. Reaproveita create_product()/set_product_production()/
--    set_product_composition() — nenhum dos três corpos é duplicado.
-- =============================================================================
create or replace function public.create_product_with_plates(
  p_name text,
  p_product_type text,
  p_category text,
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
  -- p_default_print_time_seconds/p_default_weight_grams/p_units_per_plate
  -- (os 3 últimos null abaixo, na chamada a create_product): o peso/tempo
  -- reais são gravados logo em seguida por set_product_production(), na
  -- MESMA transação — nunca ficam "quase certos" entre as duas chamadas,
  -- porque nenhuma outra transação enxerga o produto antes do commit
  -- desta função inteira. p_units_per_plate é a coluna LEGADA (ver
  -- cabeçalho da migration) — sempre null aqui, mesmo comportamento já
  -- usado por POST /products hoje.
  v_product_id := public.create_product(
    p_name, p_product_type, p_category, p_description, p_default_price,
    null, null, null, p_default_file_id, p_allows_personalization, p_changed_by
  );

  perform public.set_product_production(
    v_product_id, p_plates, p_manual_weight_override_grams, p_manual_time_override_seconds, p_changed_by
  );

  perform public.set_product_composition(v_product_id, p_accessories, p_packaging, p_changed_by);

  return v_product_id;
end;
$$;

comment on function public.create_product_with_plates(text, text, text, text, numeric, uuid, boolean, jsonb, numeric, integer, jsonb, jsonb, uuid) is
  'Cria um Produto e, na MESMA transação, sua estrutura de plates/filamentos (set_product_production) e sua composição de Acessórios/Embalagens (set_product_composition) — se qualquer parte falhar, nada é criado. Reaproveita create_product/set_product_production/set_product_composition, nenhum corpo duplicado. p_plates/p_accessories/p_packaging vazios ou nulos são válidos (Produto sem produção/composição cadastrada ainda, mesmo estado de antes desta migration).';

revoke execute on function public.create_product_with_plates(text, text, text, text, numeric, uuid, boolean, jsonb, numeric, integer, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_product_with_plates(text, text, text, text, numeric, uuid, boolean, jsonb, numeric, integer, jsonb, jsonb, uuid)
  to service_role;

-- =============================================================================
-- 6) update_product_full — edição atômica: campos descritivos (whitelist
--    de update_product) + plates/filamentos/totais + Acessórios/
--    Embalagens, tudo numa única transação. Reaproveita update_product()/
--    set_product_production()/set_product_composition().
-- =============================================================================
create or replace function public.update_product_full(
  p_product_id uuid,
  p_patch jsonb,
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
  -- update_product() rejeita p_patch vazio (exige ao menos um campo
  -- reconhecido) — aqui o patch de campos descritivos é OPCIONAL: a seção
  -- "Dados Gerais" pode não ter mudado numa edição que só mexeu em
  -- Composição/Acessórios, então só chamamos update_product() quando há
  -- de fato algo para aplicar.
  if p_patch is not null and p_patch <> '{}'::jsonb then
    perform public.update_product(p_product_id, p_patch, p_changed_by);
  end if;

  -- set_product_production/set_product_composition continuam substituição
  -- COMPLETA sempre (mesmo idioma de update_quote_order/
  -- set_product_filaments) — o formulário novo sempre envia o estado
  -- inteiro atual de Composição e de Acessórios/Embalagens a cada salvar,
  -- nunca um patch incremental dessas duas seções.
  perform public.set_product_production(
    p_product_id, p_plates, p_manual_weight_override_grams, p_manual_time_override_seconds, p_changed_by
  );

  perform public.set_product_composition(p_product_id, p_accessories, p_packaging, p_changed_by);

  select * into v_row from public.products where id = p_product_id;
  if not found then
    raise exception 'products.id % não encontrado', p_product_id;
  end if;

  return v_row;
end;
$$;

comment on function public.update_product_full(uuid, jsonb, jsonb, numeric, integer, jsonb, jsonb, uuid) is
  'Edita um Produto existente de forma atômica: campos descritivos (patch opcional, whitelist de update_product), plates/filamentos/totais (substituição completa, set_product_production) e Acessórios/Embalagens (substituição completa, set_product_composition) — se qualquer parte falhar, nada é alterado. Reaproveita update_product/set_product_production/set_product_composition, nenhum corpo duplicado.';

revoke execute on function public.update_product_full(uuid, jsonb, jsonb, numeric, integer, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.update_product_full(uuid, jsonb, jsonb, numeric, integer, jsonb, jsonb, uuid)
  to service_role;

-- =============================================================================
-- 7) BACKFILL (parte desta migration, só executa quando ela for APLICADA —
--    não nesta rodada) — representa a composição/peso/tempo JÁ EXISTENTES
--    de cada Produto como "Plate 1", preservando os valores efetivos
--    EXATAMENTE como estavam, byte a byte, nunca recalculados.
--
--    Estratégia (auditada contra o estado real de products/product_filaments
--    antes de escrever este bloco): para cada Produto que hoje tem ALGUMA
--    composição/peso/tempo (ao menos 1 linha em product_filaments, OU
--    default_weight_grams não nulo, OU default_print_time_seconds não
--    nulo) — "quando tecnicamente possível", conforme pedido:
--      1. cria 1 linha em product_plates (plate_number=1,
--         production_time_seconds = default_print_time_seconds atual, ou 0
--         se nulo — a coluna é NOT NULL, mas o EFETIVO gravado no passo 3
--         preserva o null original via o ajuste manual, nunca via esta
--         coluna);
--      2. copia cada linha de product_filaments (se houver) para
--         product_plate_filaments da Plate 1 — mesmo filament_type_id,
--         mesmo peso, sem duplicar nem perder nenhuma;
--      3. copia default_weight_grams/default_print_time_seconds ATUAIS
--         (incluindo null, se for o caso) VERBATIM para os 2 ajustes
--         manuais novos — o valor EFETIVO (que passa a ser
--         coalesce(ajuste manual, soma automática da Plate 1)) fica
--         IDÊNTICO ao valor anterior em 100% dos casos, mesmo quando a
--         soma automática da Plate 1 (derivada de product_filaments, que
--         nunca alimentou esses 2 campos antes desta migration) diverge
--         do valor antigo — o ajuste manual sempre prevalece sobre o
--         automático, garantindo "preservar peso e tempo existentes"
--         sem exceção.
--    Produtos SEM nenhuma das três condições (nunca tiveram composição nem
--    peso/tempo informados) NÃO recebem Plate 1 — permanecem exatamente
--    como estão, "sem produção cadastrada", 0 plates.
--    Nenhum Produto tem status/preço/Pedido alterado por este bloco.
--    Não duplica filamento nenhum (cada product_filaments vira exatamente
--    1 product_plate_filaments, respeitando a mesma unicidade
--    (product_id, filament_type_id) que já existia — Plate 1 é o único
--    plate criado, então (plate_id, filament_type_id) nunca colide).
--    Toda a migration (schema + backfill) roda dentro de UMA transação
--    (convenção padrão do Supabase CLI para cada arquivo de migration) —
--    qualquer falha em qualquer parte desfaz TUDO, inclusive o backfill.
-- =============================================================================
do $$
declare
  v_product record;
  v_plate_id uuid;
begin
  for v_product in
    select p.id, p.default_print_time_seconds, p.default_weight_grams
    from public.products p
    where exists (select 1 from public.product_filaments pf where pf.product_id = p.id)
       or p.default_print_time_seconds is not null
       or p.default_weight_grams is not null
  loop
    insert into public.product_plates (product_id, plate_number, production_time_seconds)
    values (v_product.id, 1, coalesce(v_product.default_print_time_seconds, 0))
    returning id into v_plate_id;

    insert into public.product_plate_filaments (plate_id, filament_type_id, weight_grams)
    select v_plate_id, pf.filament_type_id, pf.theoretical_weight_grams
    from public.product_filaments pf
    where pf.product_id = v_product.id;

    update public.products
      set production_weight_manual_override_grams = v_product.default_weight_grams,
          production_time_manual_override_seconds = v_product.default_print_time_seconds
      where id = v_product.id;
  end loop;
end $$;

-- =============================================================================
-- 8) Verificações do backfill — mesmo padrão de todas as migrations
--    anteriores deste projeto: prova estruturalmente que nada além do
--    pretendido mudou. Roda ANTES da Seção 9 (redefinição de
--    validate_catalog_composition_for_creation para aceitar exclusivamente
--    product_plate_filaments) — se o backfill deixou qualquer Produto
--    legado sem a composição correspondente em product_plate_filaments,
--    este bloco aborta a migration inteira (schema + backfill + a nova
--    validação, tudo na mesma transação) ANTES que a validação mais
--    estrita chegue a se tornar operacional.
-- =============================================================================
do $$
declare
  v_is_security_definer boolean;
  v_search_path_raw text;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
  v_orphan_count integer;
  v_missing_count integer;
  v_mismatch_count integer;
  v_eligible_product_count integer;
  v_plate_count integer;
  v_override_mismatch_count integer;
begin
  -- 8.1 set_product_production: SECURITY DEFINER, search_path vazio, ZERO
  -- grants (nem service_role).
  select prosecdef into v_is_security_definer
    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_product_production';
  if not v_is_security_definer then
    raise exception 'Abortando: set_product_production não é SECURITY DEFINER.';
  end if;

  select setting into v_search_path_raw
    from pg_proc, unnest(proconfig) as setting
    where pronamespace = 'public'::regnamespace and proname = 'set_product_production'
      and setting like 'search_path=%';
  if v_search_path_raw is null or trim(both '"' from substring(v_search_path_raw from 13)) <> '' then
    raise exception 'Abortando: search_path de set_product_production deveria ser vazio, veio: %.', v_search_path_raw;
  end if;

  select has_function_privilege('anon', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.set_product_production(uuid,jsonb,numeric,integer,uuid)', 'EXECUTE') into v_service_role_can_execute;
  if v_anon_can_execute or v_authenticated_can_execute or v_service_role_can_execute then
    raise exception 'Abortando: set_product_production tem EXECUTE concedido a alguém (anon=%, authenticated=%, service_role=%) — deveria ser função interna sem nenhum grant.',
      v_anon_can_execute, v_authenticated_can_execute, v_service_role_can_execute;
  end if;

  -- 8.2 create_product_with_plates / update_product_full: exclusivas de
  -- service_role.
  select has_function_privilege('authenticated', 'public.create_product_with_plates(text,text,text,text,numeric,uuid,boolean,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  if v_authenticated_can_execute then
    raise exception 'Abortando: authenticated tem EXECUTE em create_product_with_plates — não deveria.';
  end if;
  select has_function_privilege('service_role', 'public.create_product_with_plates(text,text,text,text,numeric,uuid,boolean,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;
  if not v_service_role_can_execute then
    raise exception 'Abortando: service_role deveria ter EXECUTE em create_product_with_plates.';
  end if;

  select has_function_privilege('authenticated', 'public.update_product_full(uuid,jsonb,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  if v_authenticated_can_execute then
    raise exception 'Abortando: authenticated tem EXECUTE em update_product_full — não deveria.';
  end if;
  select has_function_privilege('service_role', 'public.update_product_full(uuid,jsonb,jsonb,numeric,integer,jsonb,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;
  if not v_service_role_can_execute then
    raise exception 'Abortando: service_role deveria ter EXECUTE em update_product_full.';
  end if;

  -- 8.3 validate_catalog_composition_for_creation: continua zero grants
  -- (nem service_role) — só o corpo mudou.
  select has_function_privilege('anon', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_service_role_can_execute;
  if v_anon_can_execute or v_authenticated_can_execute or v_service_role_can_execute then
    raise exception 'Abortando: validate_catalog_composition_for_creation tem EXECUTE concedido a alguém — deveria continuar sem nenhum grant.';
  end if;

  -- 8.4 Backfill: nenhum product_plate_filaments órfão (todo filament_type_id
  -- copiado do product_filaments original continua existindo e ativo não é
  -- exigido aqui — a checagem de ativo é só na escrita, não retroativa a
  -- dados legados) e toda linha de product_plates tem plate_number = 1
  -- (único plate criado pelo backfill).
  select count(*) into v_orphan_count
    from public.product_plates
    where plate_number <> 1;
  if v_orphan_count > 0 then
    raise exception 'Abortando: o backfill deveria criar só Plate 1 para cada Produto, encontrada(s) % linha(s) com plate_number <> 1.', v_orphan_count;
  end if;

  select count(*) into v_orphan_count
    from public.product_plate_filaments ppf
    left join public.product_filaments pf
      on pf.filament_type_id = ppf.filament_type_id
     and pf.product_id = (select product_id from public.product_plates where id = ppf.plate_id)
    where pf.id is null;
  if v_orphan_count > 0 then
    raise exception 'Abortando: encontrada(s) % linha(s) em product_plate_filaments sem correspondência em product_filaments — o backfill não deveria inventar nenhuma linha nova.', v_orphan_count;
  end if;

  -- 8.5 Nenhum Produto com composição em product_filaments ficou SEM a
  -- correspondente em product_plate_filaments — a checagem inversa da 8.4
  -- acima (que só provava "nada foi inventado"; esta prova "nada foi
  -- esquecido"). Aborta a migration inteira se encontrar qualquer um —
  -- é exatamente o cenário "Produto legado com composição, mas plates sem
  -- ela" que tornaria a nova validação (Seção 9) uma regressão real.
  select count(*) into v_missing_count
    from public.product_filaments pf
    where not exists (
      select 1
      from public.product_plate_filaments ppf
      join public.product_plates pp on pp.id = ppf.plate_id
      where pp.product_id = pf.product_id
        and ppf.filament_type_id = pf.filament_type_id
    );
  if v_missing_count > 0 then
    raise exception 'Abortando: encontrada(s) % linha(s) em product_filaments sem a linha correspondente copiada para product_plate_filaments — o backfill teria deixado um Produto legado sem a composição autoritativa nova.', v_missing_count;
  end if;

  -- 8.6 Nenhuma divergência de peso entre a linha legada e a linha copiada
  -- (mesmo filamento, mesmo produto, peso diferente) — o backfill deveria
  -- ser uma cópia byte a byte, nunca um recálculo.
  select count(*) into v_mismatch_count
    from public.product_filaments pf
    join public.product_plates pp on pp.product_id = pf.product_id
    join public.product_plate_filaments ppf
      on ppf.plate_id = pp.id and ppf.filament_type_id = pf.filament_type_id
    where ppf.weight_grams <> pf.theoretical_weight_grams;
  if v_mismatch_count > 0 then
    raise exception 'Abortando: encontrada(s) % linha(s) copiada(s) para product_plate_filaments com peso diferente do original em product_filaments — o backfill deveria preservar o peso exatamente.', v_mismatch_count;
  end if;

  -- 8.7 Nenhum "plate órfão": a quantidade de Plates 1 criados pelo
  -- backfill bate exatamente com a quantidade de Produtos elegíveis (mesmo
  -- critério do WHERE da Seção 7) — nem plate a mais (criado sem
  -- justificativa) nem a menos (Produto elegível esquecido).
  select count(*) into v_eligible_product_count
    from public.products p
    where exists (select 1 from public.product_filaments pf where pf.product_id = p.id)
       or p.default_print_time_seconds is not null
       or p.default_weight_grams is not null;
  select count(*) into v_plate_count from public.product_plates where plate_number = 1;
  if v_plate_count <> v_eligible_product_count then
    raise exception 'Abortando: % Produto(s) elegível(is) para backfill, mas % Plate(s) 1 criado(s) — deveriam ser exatamente iguais (nenhum plate órfão, nenhum Produto esquecido).', v_eligible_product_count, v_plate_count;
  end if;

  -- 8.8 Ajustes manuais copiados preservam EXATAMENTE o peso/tempo efetivo
  -- anterior (products.default_weight_grams/default_print_time_seconds,
  -- colunas não tocadas pelo backfill, continuam com o valor original para
  -- comparar) — garante que "preserva ajustes" vale para 100% dos Produtos
  -- backfilled, não só os que tinham product_filaments.
  select count(*) into v_override_mismatch_count
    from public.products p
    join public.product_plates pp on pp.product_id = p.id and pp.plate_number = 1
    where p.production_weight_manual_override_grams is distinct from p.default_weight_grams
       or p.production_time_manual_override_seconds is distinct from p.default_print_time_seconds;
  if v_override_mismatch_count > 0 then
    raise exception 'Abortando: % Produto(s) com Plate 1 cujo ajuste manual não bate byte a byte com o peso/tempo efetivo anterior — o backfill deveria preservá-lo exatamente.', v_override_mismatch_count;
  end if;
end $$;

-- =============================================================================
-- 9) validate_catalog_composition_for_creation — REDEFINIDA para exigir
--    EXCLUSIVAMENTE product_plate_filaments (rodada corretiva 2026-08-29,
--    ver "FONTE AUTORITATIVA" no cabeçalho). A versão anterior desta mesma
--    migration aceitava product_plates OU product_filaments como
--    alternativas — uma auditoria posterior apontou que isso permitia um
--    Produto cuja composição real nos plates havia sido esvaziada (todos os
--    filamentos removidos pelo usuário via update_product_full) continuar
--    "aprovado" só porque a linha antiga em product_filaments nunca foi
--    tocada por nenhuma escrita nova. Corrigido: a checagem de composição
--    passa a olhar SÓ product_plate_filaments (via product_plates do
--    Produto) — nunca mais product_filaments. Só roda depois da Seção 8
--    (verificações do backfill) ter confirmado, sem exceção, que todo
--    Produto com composição legada válida já tem a cópia correspondente em
--    product_plate_filaments — nenhum Produto antes válido perde
--    validade por causa desta troca. Assinatura, `SECURITY DEFINER`,
--    `search_path=''` e o restante do corpo (classificação
--    CATALOG/SPOT/CUSTOM feita por determine_order_initial_status, nunca
--    tocada aqui; mensagem ORDER_CATALOG_MISSING_COMPOSITION: com os nomes
--    reais dos produtos incompletos; formas de pagamento, idempotência,
--    rollback, histórico, autenticação, grants de create_order — nenhum
--    tocado) preservados byte a byte em relação à versão anterior desta
--    própria migration, só a fonte da checagem de composição muda.
-- =============================================================================
create or replace function public.validate_catalog_composition_for_creation(p_items jsonb)
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
  v_has_composition boolean;
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
      select 1
      from public.product_plate_filaments ppf
      join public.product_plates pp on pp.id = ppf.plate_id
      where pp.product_id = v_product_id
    ) into v_has_composition;

    if not v_has_composition and not (v_product_name = any(v_missing_names)) then
      v_missing_names := v_missing_names || v_product_name;
    end if;
  end loop;

  if array_length(v_missing_names, 1) > 0 then
    raise exception 'ORDER_CATALOG_MISSING_COMPOSITION: Não foi possível enviar o pedido para a Fila de produção. Cadastre a composição de filamentos dos produtos: %.', array_to_string(v_missing_names, ', ');
  end if;
end;
$$;

comment on function public.validate_catalog_composition_for_creation(jsonb) is
  'Valida, para um Pedido novo que nasceria em IN_PRODUCTION_QUEUE (nenhum item CUSTOM), que todo item CATALOG tem product_id apontando para um Produto de Catálogo real com composição de filamentos real em product_plate_filaments (via product_plates do Produto) — a ÚNICA fonte aceita a partir desta migration; product_filaments (legado) NÃO é mais considerada, mesmo que ainda tenha linhas. Bloqueia toda a criação e lista, deduplicados por nome, todos os produtos sem composição na mesma mensagem (ORDER_CATALOG_MISSING_COMPOSITION:). Nunca chamada para pedidos com item CUSTOM nem para editar um pedido existente.';

revoke execute on function public.validate_catalog_composition_for_creation(jsonb)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- 10) Desativação da RPC/rota legada para escrita operacional —
--     set_product_filaments (Migration 20260827113000, já aplicada) perde
--     o EXECUTE de service_role: depois desta migration, nenhum papel
--     operacional (nem authenticated/anon, que nunca tiveram, nem
--     service_role, que é como a Edge Function `products` a chamava) pode
--     mais executá-la. A função e a tabela product_filaments continuam
--     existindo, com todos os dados intactos — só a CAPACIDADE de
--     ESCREVER de forma independente nelas é removida; nenhum DROP, nenhum
--     DELETE. `supabase/functions/products/handler.ts` (mesma rodada,
--     arquivo local ainda não publicado) já para de chamar esta RPC na
--     rota `PATCH /products/:id/filaments`, respondendo com um erro de
--     negócio claro (marcador `PRODUCT_FILAMENTS_ROUTE_RETIRED:`) antes de
--     sequer tentar — esta revogação de grant é a segunda camada de defesa
--     (nível banco), para que a RPC também falhe mesmo se algo além da
--     Edge Function tentasse chamá-la diretamente. `PATCH /products/:id/full`
--     (update_product_full, Seção 6) continua sendo o único caminho
--     autorizado para alterar a composição de produção de um Produto —
--     substitui integralmente set_product_filaments, inclusive para
--     Produtos com múltiplos plates (que a RPC legada nunca soube
--     representar, já que só conhecia uma composição "flat" por Produto).
-- =============================================================================
revoke execute on function public.set_product_filaments(uuid, jsonb, uuid)
  from service_role;

comment on function public.set_product_filaments(uuid, jsonb, uuid) is
  'DESCONTINUADA para escrita operacional a partir de 20260829160000 (estrutura produtiva por plates) — sem EXECUTE concedido a nenhum papel. Preservada só por compatibilidade histórica/rollback: a tabela product_filaments e os dados gravados por esta função antes da descontinuação NÃO são apagados. A composição de produção de um Produto (incl. múltiplos plates) é alterada exclusivamente por update_product_full/create_product_with_plates (via set_product_production).';

-- =============================================================================
-- 11) Verificações finais — confirma que a Seção 9 (nova validação) e a
--     Seção 10 (RPC legada desativada) ficaram exatamente como descrito
--     acima, sem efeito colateral em nenhuma outra função/grant.
-- =============================================================================
do $$
declare
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
  v_function_body text;
begin
  -- 11.1 validate_catalog_composition_for_creation: continua zero grants
  -- (nem service_role) depois da redefinição da Seção 9.
  select has_function_privilege('anon', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_service_role_can_execute;
  if v_anon_can_execute or v_authenticated_can_execute or v_service_role_can_execute then
    raise exception 'Abortando: validate_catalog_composition_for_creation (versão nova, Seção 9) tem EXECUTE concedido a alguém — deveria continuar sem nenhum grant.';
  end if;

  -- 11.2 O corpo real da função (via pg_get_functiondef, não uma busca de
  -- texto genérica que geraria falso positivo contra este próprio
  -- comentário) não contém mais nenhuma referência a product_filaments —
  -- prova estrutural de que a fonte antiga foi removida da validação, não
  -- só documentada como removida.
  select pg_get_functiondef('public.validate_catalog_composition_for_creation(jsonb)'::regprocedure) into v_function_body;
  if v_function_body ilike '%product_filaments%' then
    raise exception 'Abortando: o corpo de validate_catalog_composition_for_creation ainda referencia product_filaments — a fonte legada não deveria mais ser aceita.';
  end if;
  if v_function_body not ilike '%product_plate_filaments%' then
    raise exception 'Abortando: o corpo de validate_catalog_composition_for_creation não referencia product_plate_filaments — a checagem de composição parece ter sido perdida.';
  end if;

  -- 11.3 set_product_filaments: zero EXECUTE para qualquer papel (a função
  -- continua existindo — só sem grants; se não existisse mais,
  -- has_function_privilege abaixo já levantaria erro de "function does not
  -- exist", provando por si só que não foi apagada).
  select has_function_privilege('anon', 'public.set_product_filaments(uuid,jsonb,uuid)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.set_product_filaments(uuid,jsonb,uuid)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.set_product_filaments(uuid,jsonb,uuid)', 'EXECUTE') into v_service_role_can_execute;
  if v_anon_can_execute or v_authenticated_can_execute or v_service_role_can_execute then
    raise exception 'Abortando: set_product_filaments ainda tem EXECUTE concedido a alguém (anon=%, authenticated=%, service_role=%) — deveria estar completamente desativada para escrita operacional.',
      v_anon_can_execute, v_authenticated_can_execute, v_service_role_can_execute;
  end if;

  -- 11.4 A tabela product_filaments continua existindo (não foi dropada) —
  -- to_regclass devolve NULL se a tabela não existisse mais.
  if to_regclass('public.product_filaments') is null then
    raise exception 'Abortando: a tabela product_filaments não deveria ter sido removida (só a capacidade de escrita operacional, nunca os dados).';
  end if;
end $$;
