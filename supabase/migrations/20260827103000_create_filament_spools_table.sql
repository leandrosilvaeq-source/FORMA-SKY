-- Bloco 2 — Módulo 3 (Estoque e Inventário), Incremento 4 do plano de
-- estoque operacional (docs/05_ROADMAP_MODULOS.md §9b) — MVP de controle de
-- filamentos, segunda peça: o ROLO FÍSICO (filament_spools), sempre
-- vinculado a um filament_types (migration anterior).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto. Aplicar exige autorização explícita separada.
--
-- Regras aprovadas nesta rodada (hipóteses iniciais do MVP, sujeitas a
-- revisão após uso real):
--   - Um tipo pode ter vários rolos; cada rolo tem saldo independente
--     (current_net_weight_grams). Peso nominal é LIVRE (não fixo em 1000g —
--     a sugestão de 1000g é só uma opção de interface, nunca um default
--     imposto pelo banco: nominal_weight_grams não tem nenhum default).
--   - Peso atual nunca é negativo (CHECK). O teto "peso atual não pode
--     ultrapassar o nominal" NÃO é uma CHECK de tabela (uma CHECK só vê as
--     colunas da própria linha, não o tipo de movimentação que originou a
--     mudança) — é aplicado em register_filament_movement (próxima
--     migration) só para os tipos de ENTRADA "de rotina"
--     (INITIAL_BALANCE/PURCHASE/RETURN); os tipos de AJUSTE
--     (POSITIVE_ADJUSTMENT/NEGATIVE_ADJUSTMENT/WEIGHING_ADJUSTMENT) são
--     deliberadamente isentos desse teto — são exatamente o mecanismo
--     "ajuste explícito e documentado" citado no pedido para o caso de um
--     peso real superior ao nominal precisar ser registrado.
--   - Status mínimos exigidos: LACRADO, ABERTO, ESGOTADO, DESCARTADO.
--     Divergência deliberada frente à especificação prévia (docs/03 §12.3,
--     nunca implementada), que sugeria 5 valores em português minúsculo
--     ("fechado"/"aberto"/"em uso"/"vazio"/"descartado") — o pedido desta
--     rodada lista literalmente só 4 valores, em maiúsculas, sem o quinto
--     ("em uso"); esta migration segue o pedido atual (mais recente e mais
--     explícito), não o doc antigo. docs/03 será atualizado para refletir
--     isso.
--   - is_active é um eixo SEPARADO de status: is_active=false é
--     "desativação" (oculta o rolo das listagens padrão, sem mudar seu
--     status físico); status='DESCARTADO' é "descarte" (estado físico
--     terminal, nunca revertido automaticamente por nenhuma function desta
--     migration). "Rolos ativos e utilizáveis" (para a soma que compõe a
--     quantidade disponível do tipo, ver vw_filament_type_summary na
--     próxima migration) exige as DUAS condições: is_active = true E
--     status not in ('ESGOTADO', 'DESCARTADO').
--   - "Peso do carretel vazio, quando conhecido" é um CAMPO DO PRÓPRIO
--     ROLO (empty_spool_weight_grams, nullable) — decisão deliberada de NÃO
--     criar a tabela normalizada spool_tares por fabricante prevista em
--     docs/03 §12.2 (nunca implementada): o pedido desta rodada descreve o
--     peso do carretel como um atributo direto do rolo, não um cadastro à
--     parte, e uma tabela de tara por fabricante adicionaria complexidade
--     não solicitada. Pode ser revisitado como conveniência futura sem
--     bloquear nada implementado aqui.
--   - "Identificador interno único e legível" é gerado automaticamente
--     (filament_spools.code, formato RL-YY-NNN) por next_filament_spool_code(),
--     espelhando exatamente next_order_number()/order_number_counters
--     (20260813215856_create_order_number_counter.sql,
--     20260820233219_update_order_number_format.sql) — mesmo padrão de
--     contador atômico por ano, nunca reaproveitando a sequência de pedidos.

-- ---------------------------------------------------------------------------
-- filament_spool_number_counters + next_filament_spool_code()
-- ---------------------------------------------------------------------------
create table public.filament_spool_number_counters (
  year integer primary key,
  last_number integer not null default 0
);

comment on table public.filament_spool_number_counters is
  'Contador técnico interno para geração de filament_spools.code (RL-YY-NNN). Sem acesso de anon/authenticated — só acessível via next_filament_spool_code().';

alter table public.filament_spool_number_counters enable row level security;

revoke all on public.filament_spool_number_counters from anon;
revoke all on public.filament_spool_number_counters from authenticated;

create or replace function public.next_filament_spool_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from now() at time zone 'America/Sao_Paulo')::integer;
  v_last_number integer;
  v_last_number_text text;
begin
  insert into public.filament_spool_number_counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update
    set last_number = public.filament_spool_number_counters.last_number + 1
  returning last_number into v_last_number;

  v_last_number_text := v_last_number::text;

  return 'RL-' || lpad((v_year % 100)::text, 2, '0') || '-' ||
    lpad(v_last_number_text, greatest(3, length(v_last_number_text)), '0');
end;
$$;

comment on function public.next_filament_spool_code() is
  'Gera o próximo filament_spools.code no formato RL-XX-YYY (ano com 2 dígitos, sequência anual com no mínimo 3 dígitos, nunca truncada) de forma atômica, reiniciando a cada ano — mesmo padrão de next_order_number(). Função interna: sem GRANT EXECUTE para nenhuma role de sessão, só chamável de dentro de create_filament_spool() (mesmo owner).';

revoke execute on function public.next_filament_spool_code() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- filament_spools
-- ---------------------------------------------------------------------------
create table public.filament_spools (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,

  filament_type_id uuid not null references public.filament_types (id) on delete restrict,

  nominal_weight_grams numeric(10, 2) not null check (nominal_weight_grams > 0),

  -- Saldo materializado (mesmo padrão de accessories.current_stock/
  -- packaging.current_stock): começa em 0, a primeira movimentação real
  -- (INITIAL_BALANCE, via register_filament_movement na próxima migration)
  -- é que estabelece o peso inicial de fato — nunca presumido a partir de
  -- nominal_weight_grams no momento do cadastro.
  current_net_weight_grams numeric(10, 2) not null default 0 check (current_net_weight_grams >= 0),

  empty_spool_weight_grams numeric(10, 2) check (empty_spool_weight_grams is null or empty_spool_weight_grams >= 0),

  received_at date,
  opened_at timestamptz,

  status text not null default 'LACRADO' check (status in ('LACRADO', 'ABERTO', 'ESGOTADO', 'DESCARTADO')),

  notes text,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.filament_spools is
  'Rolo físico de filamento (Módulo 3, Incremento 4 — MVP, regras sujeitas a revisão após uso real). Cada rolo tem saldo independente (current_net_weight_grams), nunca negativo. Peso nominal é livre (sem valor fixo/obrigatório de 1000g). Exclusão física bloqueada quando há movimentação vinculada (delete_filament_spool, próxima migration) — inativação lógica (is_active) e descarte (status=DESCARTADO) são sempre permitidos, com confirmação exigida pela interface. DESCARTADO é terminal: nenhuma function deste projeto reverte automaticamente um rolo descartado de volta a outro status.';

comment on column public.filament_spools.code is
  'Identificador interno único e legível (RL-XX-YYY), gerado por next_filament_spool_code() em create_filament_spool() — nunca editável depois de criado.';

comment on column public.filament_spools.current_net_weight_grams is
  'Peso disponível materializado. Sem automação de escrita nesta migration: só register_filament_movement (próxima migration) altera este valor, sempre na mesma transação que grava a movimentação correspondente.';

comment on column public.filament_spools.empty_spool_weight_grams is
  'Peso do carretel vazio, em gramas, quando conhecido (nullable). Usado por register_filament_weighing para calcular peso disponível = peso bruto medido - peso do carretel vazio; quando null, a pesagem aceita o peso líquido disponível informado diretamente, sem inventar uma tara.';

comment on column public.filament_spools.status is
  'LACRADO (nunca aberto), ABERTO (em uso), ESGOTADO (saldo chegou a zero — pode ser aplicado automaticamente por register_filament_movement) ou DESCARTADO (estado terminal, nunca revertido automaticamente). Eixo independente de is_active — ver comentário da tabela.';

create index idx_filament_spools_filament_type_id
  on public.filament_spools (filament_type_id);

create trigger set_filament_spools_updated_at
  before update on public.filament_spools
  for each row
  execute function public.set_updated_at();

alter table public.filament_spools enable row level security;

revoke all on public.filament_spools from anon;
revoke all on public.filament_spools from authenticated;
grant select on public.filament_spools to authenticated;

create policy "Active users can view filament spools"
  on public.filament_spools
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- create_filament_spool
-- ---------------------------------------------------------------------------
create or replace function public.create_filament_spool(
  p_filament_type_id uuid,
  p_nominal_weight_grams numeric,
  p_empty_spool_weight_grams numeric,
  p_received_at date,
  p_status text,
  p_notes text,
  p_is_active boolean,
  p_changed_by uuid
)
returns public.filament_spools
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_code text;
  v_row public.filament_spools;
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.filament_types where id = p_filament_type_id and is_active for update;
  if not found then
    raise exception 'filament_types.id % não encontrado ou inativo', p_filament_type_id;
  end if;

  if p_nominal_weight_grams is null or p_nominal_weight_grams <= 0 then
    raise exception 'filament_spools.nominal_weight_grams deve ser um número positivo (recebido %)', p_nominal_weight_grams;
  end if;

  if p_empty_spool_weight_grams is not null and p_empty_spool_weight_grams < 0 then
    raise exception 'filament_spools.empty_spool_weight_grams não pode ser negativo (recebido %)', p_empty_spool_weight_grams;
  end if;

  v_status := coalesce(p_status, 'LACRADO');
  if v_status not in ('LACRADO', 'ABERTO', 'ESGOTADO', 'DESCARTADO') then
    raise exception 'filament_spools.status inválido: % (esperado LACRADO, ABERTO, ESGOTADO ou DESCARTADO)', v_status;
  end if;

  v_code := public.next_filament_spool_code();

  insert into public.filament_spools (
    code, filament_type_id, nominal_weight_grams, empty_spool_weight_grams,
    received_at, opened_at, status, notes, is_active
  ) values (
    v_code, p_filament_type_id, p_nominal_weight_grams, p_empty_spool_weight_grams,
    p_received_at, case when v_status = 'ABERTO' then now() else null end,
    v_status, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_is_active, true)
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_filament_spool(uuid, numeric, numeric, date, text, text, boolean, uuid) is
  'Cria um rolo físico de filamento vinculado a um tipo ativo. code é gerado automaticamente (next_filament_spool_code()). current_net_weight_grams sempre começa em 0 — o saldo inicial real é estabelecido pela primeira movimentação (INITIAL_BALANCE, register_filament_movement).';

revoke execute on function public.create_filament_spool(uuid, numeric, numeric, date, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.create_filament_spool(uuid, numeric, numeric, date, text, text, boolean, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- update_filament_spool — cadastro, status, ativar/desativar
-- ---------------------------------------------------------------------------
-- code e filament_type_id NUNCA fazem parte do patch: são imutáveis após a
-- criação (reatribuir o tipo de um rolo já com histórico corromperia o
-- filament_type_id denormalizado em filament_movements, próxima migration).
-- current_net_weight_grams e opened_at (fora da transição ABERTO abaixo)
-- também nunca são chaves aceitas aqui — são escritos exclusivamente por
-- register_filament_movement/register_filament_weighing.
create or replace function public.update_filament_spool(
  p_filament_spool_id uuid,
  p_patch jsonb,
  p_changed_by uuid
)
returns public.filament_spools
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patch jsonb;
  v_unknown_keys text[];
  v_current public.filament_spools;
  v_new_status text;
  v_new_nominal numeric;
  v_new_empty numeric;
  v_row public.filament_spools;
begin
  perform public.assert_active_user(p_changed_by);

  select * into v_current from public.filament_spools where id = p_filament_spool_id for update;
  if not found then
    raise exception 'filament_spools.id % não encontrado', p_filament_spool_id;
  end if;

  select array_agg(key) into v_unknown_keys
    from jsonb_each(coalesce(p_patch, '{}'::jsonb))
    where key <> all(array[
      'nominal_weight_grams', 'empty_spool_weight_grams', 'received_at',
      'status', 'notes', 'is_active'
    ]);

  if v_unknown_keys is not null and array_length(v_unknown_keys, 1) > 0 then
    raise exception 'update_filament_spool: chave(s) não suportada(s) em p_patch: %', array_to_string(v_unknown_keys, ', ');
  end if;

  v_patch := public.jsonb_whitelist(p_patch, array[
    'nominal_weight_grams', 'empty_spool_weight_grams', 'received_at',
    'status', 'notes', 'is_active'
  ]);

  if v_patch = '{}'::jsonb then
    raise exception 'update_filament_spool: p_patch vazio, informe ao menos um campo reconhecido';
  end if;

  if v_patch ? 'nominal_weight_grams' then
    v_new_nominal := nullif(v_patch ->> 'nominal_weight_grams', '')::numeric;
    if v_new_nominal is null or v_new_nominal <= 0 then
      raise exception 'filament_spools.nominal_weight_grams deve ser um número positivo (recebido %)', v_new_nominal;
    end if;
    if v_new_nominal < v_current.current_net_weight_grams then
      raise exception
        'FILAMENT_SPOOL_NOMINAL_BELOW_BALANCE: novo peso nominal (%) não pode ficar abaixo do peso disponível atual (%) — registre um ajuste por pesagem antes de reduzir o nominal.',
        v_new_nominal, v_current.current_net_weight_grams;
    end if;
  end if;

  if v_patch ? 'empty_spool_weight_grams' then
    v_new_empty := nullif(v_patch ->> 'empty_spool_weight_grams', '')::numeric;
    if v_new_empty is not null and v_new_empty < 0 then
      raise exception 'filament_spools.empty_spool_weight_grams não pode ser negativo (recebido %)', v_new_empty;
    end if;
  end if;

  if v_patch ? 'status' then
    v_new_status := v_patch ->> 'status';
    if v_new_status is null or v_new_status not in ('LACRADO', 'ABERTO', 'ESGOTADO', 'DESCARTADO') then
      raise exception 'filament_spools.status inválido: % (esperado LACRADO, ABERTO, ESGOTADO ou DESCARTADO)', v_new_status;
    end if;
    if v_current.status = 'DESCARTADO' and v_new_status <> 'DESCARTADO' then
      raise exception 'FILAMENT_SPOOL_DISCARD_IS_FINAL: Este rolo foi descartado e não pode ser reativado ou ter o status alterado.';
    end if;
  end if;

  update public.filament_spools
    set nominal_weight_grams = case when v_patch ? 'nominal_weight_grams' then v_new_nominal else nominal_weight_grams end,
        empty_spool_weight_grams = case when v_patch ? 'empty_spool_weight_grams' then v_new_empty else empty_spool_weight_grams end,
        received_at = case when v_patch ? 'received_at' then nullif(v_patch ->> 'received_at', '')::date else received_at end,
        status = case when v_patch ? 'status' then v_new_status else status end,
        opened_at = case
          when v_patch ? 'status' and v_new_status = 'ABERTO' and opened_at is null then now()
          else opened_at
        end,
        notes = case when v_patch ? 'notes' then nullif(btrim(coalesce(v_patch ->> 'notes', '')), '') else notes end,
        is_active = case when v_patch ? 'is_active' then (v_patch ->> 'is_active')::boolean else is_active end
    where id = p_filament_spool_id
    returning * into v_row;

  return v_row;
end;
$$;

comment on function public.update_filament_spool(uuid, jsonb, uuid) is
  'Edita cadastro/status/ativação de um rolo. code e filament_type_id são imutáveis (nunca aceitos no patch). status=DESCARTADO é terminal (FILAMENT_SPOOL_DISCARD_IS_FINAL: bloqueia qualquer tentativa de mudança posterior). Transição para ABERTO marca opened_at=now() automaticamente na primeira vez (nunca sobrescreve um valor já existente). current_net_weight_grams nunca é alterado por esta função.';

revoke execute on function public.update_filament_spool(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.update_filament_spool(uuid, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- delete_filament_spool — exclusão física protegida
-- ---------------------------------------------------------------------------
-- Bloqueio por histórico de movimentação é adicionado em
-- 20260827106000_create_filament_movements_table.sql via CREATE OR REPLACE
-- (filament_movements ainda não existe neste ponto) — mesmo padrão já usado
-- por delete_accessory/delete_packaging
-- (20260827093000_update_accessory_packaging_delete_guards.sql).
create or replace function public.delete_filament_spool(
  p_filament_spool_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.filament_spools where id = p_filament_spool_id for update;
  if not found then
    raise exception 'filament_spools.id % não encontrado', p_filament_spool_id;
  end if;

  delete from public.filament_spools where id = p_filament_spool_id;
end;
$$;

comment on function public.delete_filament_spool(uuid, uuid) is
  'Exclusão física de um rolo. Nesta migration ainda sem bloqueio por histórico (filament_movements não existe ainda) — CREATE OR REPLACE na próxima migration adiciona FILAMENT_SPOOL_HAS_MOVEMENTS:.';

revoke execute on function public.delete_filament_spool(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_filament_spool(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- delete_filament_type — adiciona o bloqueio por rolo vinculado, agora que
-- filament_spools existe. CREATE OR REPLACE (mesma assinatura da migration
-- anterior) — nunca uma segunda function paralela.
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

  delete from public.filament_types where id = p_filament_type_id;
end;
$$;

comment on function public.delete_filament_type(uuid, uuid) is
  'Exclusão física protegida de um tipo de filamento: bloqueada quando há rolo (filament_spools) vinculado — FILAMENT_TYPE_HAS_SPOOLS:. O bloqueio por composição de produto (product_filaments) é adicionado em 20260827109000_create_product_filaments_table.sql. Nenhuma exclusão em cascata.';

revoke execute on function public.delete_filament_type(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_filament_type(uuid, uuid)
  to service_role;
