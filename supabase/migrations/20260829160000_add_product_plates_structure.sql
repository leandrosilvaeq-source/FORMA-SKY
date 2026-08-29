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
-- FONTE AUTORITATIVA (reafirmado pela auditoria da rodada corretiva de
-- 2026-08-29, que bloqueou a rodada anterior por permitir duas fontes
-- divergentes no FRONTEND): product_plates/product_plate_filaments é a
-- ÚNICA estrutura autoritativa da composição de produção a partir desta
-- migration. product_filaments (legado) é só uma PROJEÇÃO DE LEITURA de
-- compatibilidade, nunca mais escrita de forma independente por nenhuma
-- tela — o antigo diálogo "Composição de filamentos" (escrita direta e
-- isolada em product_filaments) foi removido do frontend nessa mesma
-- rodada corretiva. Nenhum trigger sincroniza as duas tabelas — não é
-- necessário, porque não existe mais nenhum caminho de escrita
-- independente em product_filaments capaz de divergir de product_plates:
-- toda escrita de composição de produção passa por set_product_production
-- (só chamada de dentro de create_product_with_plates/update_product_full),
-- que nunca toca product_filaments. product_filaments continua existindo
-- só para representar, sem perda, a composição de Produtos que ainda não
-- passaram pelo backfill desta migration (Seção 5 abaixo) — será seguro
-- remover essa dependência legada (a tabela, a RPC set_product_filaments e
-- a leitura de fallback no frontend) quando o backfill tiver rodado no
-- remoto E toda leitura (ProductDetailPage.tsx, ProductForm.tsx via
-- ProductsPage.tsx) tiver confirmado 100% dos Produtos ativos com ao menos
-- 1 linha em product_plates — não antes disso.
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
-- Substitui, para produtos que passarem a usar plates, o modelo anterior
-- "flat" de composição (public.product_filaments, Migration
-- 20260827113000 — 1 nível, sem noção de plate) como fonte de verdade da
-- Ficha Técnica de produção. A tabela flat product_filaments e sua RPC
-- (set_product_filaments) NÃO são removidas nem alteradas nesta migration
-- — permanecem exatamente como estão, preservando 100% de compatibilidade
-- com qualquer fluxo que ainda as use; a validação de composição de
-- Pedidos (Seção 4 abaixo) passa a aceitar QUALQUER uma das duas fontes.
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
-- 7) validate_catalog_composition_for_creation — CORREÇÃO DE COMPATIBILIDADE
--    (mesma assinatura de 20260829150000_add_order_initial_status_classification.sql,
--    corpo real conferido integralmente antes desta substituição): a
--    checagem de "este Produto de Catálogo tem composição de filamentos"
--    passa a aceitar QUALQUER UMA das duas fontes — product_plates (novo)
--    OU product_filaments (legado, flat) — em vez de só a segunda. Um
--    Produto migrado para plates passa a ser reconhecido pela primeira; um
--    Produto que nunca adotou plates (ou um Produto criado antes desta
--    migration, antes de qualquer backfill futuro) continua sendo
--    reconhecido pela segunda, exatamente como já funcionava. Nenhuma
--    outra linha desta função é alterada.
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
      select 1 from public.product_plates where product_id = v_product_id
      union all
      select 1 from public.product_filaments where product_id = v_product_id
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
  'Valida, para um Pedido novo que nasceria em IN_PRODUCTION_QUEUE (nenhum item CUSTOM), que todo item CATALOG tem product_id apontando para um Produto de Catálogo real com composição de filamentos em product_plates (novo, por plate) OU product_filaments (legado, flat) — qualquer uma das duas fontes é aceita. Bloqueia toda a criação e lista, deduplicados por nome, todos os produtos sem composição na mesma mensagem (ORDER_CATALOG_MISSING_COMPOSITION:). Nunca chamada para pedidos com item CUSTOM nem para editar um pedido existente.';

revoke execute on function public.validate_catalog_composition_for_creation(jsonb)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- 8) BACKFILL (parte desta migration, só executa quando ela for APLICADA —
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
-- 9) Verificações — mesmo padrão de todas as migrations anteriores deste
--    projeto: prova estruturalmente que nada além do pretendido mudou.
-- =============================================================================
do $$
declare
  v_is_security_definer boolean;
  v_search_path_raw text;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
  v_service_role_can_execute boolean;
  v_orphan_count integer;
begin
  -- 9.1 set_product_production: SECURITY DEFINER, search_path vazio, ZERO
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

  -- 9.2 create_product_with_plates / update_product_full: exclusivas de
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

  -- 9.3 validate_catalog_composition_for_creation: continua zero grants
  -- (nem service_role) — só o corpo mudou.
  select has_function_privilege('anon', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_anon_can_execute;
  select has_function_privilege('authenticated', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_authenticated_can_execute;
  select has_function_privilege('service_role', 'public.validate_catalog_composition_for_creation(jsonb)', 'EXECUTE') into v_service_role_can_execute;
  if v_anon_can_execute or v_authenticated_can_execute or v_service_role_can_execute then
    raise exception 'Abortando: validate_catalog_composition_for_creation tem EXECUTE concedido a alguém — deveria continuar sem nenhum grant.';
  end if;

  -- 9.4 Backfill: nenhum product_plate_filaments órfão (todo filament_type_id
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
end $$;
