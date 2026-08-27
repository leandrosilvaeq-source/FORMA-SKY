-- Bloco 2 — Módulo 3 (Estoque e Inventário), Incremento 4 do plano de
-- estoque operacional (docs/05_ROADMAP_MODULOS.md §9b) — MVP de controle de
-- filamentos, terceira peça: o ledger de movimentações e a pesagem física.
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto. Aplicar exige autorização explícita separada.
--
-- DECISÃO DE ARQUITETURA DESTA RODADA (diagnóstico técnico pedido
-- explicitamente pelo requisito 5): filamentos NÃO reaproveitam
-- public.stock_movements (20260827090000_create_stock_movements_table.sql).
-- Dois motivos concretos, ambos citados no próprio comentário daquela
-- migration como risco a evitar:
--   1) UNIDADE DE MEDIDA — stock_movements.quantity_delta/balance_before/
--      balance_after são `integer` (adequado para contagem de unidades
--      discretas de acessórios/embalagens). Peso de filamento é
--      genuinamente fracionário (uma pesagem pode revelar 487.5g) — alterar
--      o tipo dessas colunas numa tabela já aplicada em produção e já
--      validada manualmente pelo usuário (Acessórios/Embalagens) seria uma
--      migração de risco desnecessário sobre uma tabela que não precisa
--      mudar para este incremento.
--   2) RASTREABILIDADE POR ROLO — cada movimentação de filamento precisa
--      registrar TANTO o tipo quanto o rolo físico (ver requisito 5:
--      "tipo do filamento; rolo; ..."). stock_movements só tem um único
--      item_id polimórfico (aponta para accessories OU packaging conforme
--      item_type) — accessories/packaging não têm essa distinção
--      tipo-vs-instância-física. Forçar dois FKs (tipo E rolo) dentro da
--      mesma tabela polimórfica misturaria dois desenhos incompatíveis.
-- Por isso: public.filament_movements é uma tabela NOVA e independente,
-- nunca uma alteração de stock_movements — a tabela antiga permanece
-- intocada por esta migration.
--
-- Regras aprovadas nesta rodada (hipóteses iniciais do MVP, sujeitas a
-- revisão após uso real):
--   - filament_type_id é gravado em CADA linha, embora seja derivável via
--     spool_id -> filament_spools.filament_type_id — denormalização
--     DELIBERADA (nunca aceita como parâmetro do chamador, sempre lida da
--     linha travada de filament_spools dentro da própria function) para
--     permitir histórico consolidado por tipo sem join
--     (vw_filament_type_summary abaixo; requisito 8: "histórico
--     consolidado por tipo, se viável sem duplicação").
--   - 9 movement_type: 4 de entrada (INITIAL_BALANCE/PURCHASE/RETURN/
--     POSITIVE_ADJUSTMENT), 4 de saída (MANUAL_CONSUMPTION/LOSS/
--     SAMPLE_TEST/NEGATIVE_ADJUSTMENT) e 1 de pesagem
--     (WEIGHING_ADJUSTMENT, sinal resolvido pela diferença medida, pode ser
--     positivo ou negativo) — mapeamento direto de "entradas: saldo
--     inicial, compra, devolução, ajuste positivo; saídas: consumo manual,
--     perda/avaria, amostra/teste, ajuste negativo; pesagem: ajuste por
--     pesagem física" do requisito 5. WEIGHING_ADJUSTMENT só é gravado por
--     register_filament_weighing (abaixo) — register_filament_movement
--     rejeita esse valor explicitamente, para nunca permitir um "ajuste de
--     pesagem" arbitrário sem passar pelo cálculo peso bruto/tara real.
--   - Motivo obrigatório para tudo exceto INITIAL_BALANCE/PURCHASE/RETURN —
--     extensão direta da frase literal do requisito 5 ("perdas, avarias,
--     descartes e ajustes devem exigir motivo"), aplicando o mesmo critério
--     já usado para accessories/packaging (INTERNAL_USE/SAMPLE_DONATION
--     também exigem motivo lá) a MANUAL_CONSUMPTION/SAMPLE_TEST aqui —
--     decisão de julgamento documentada, revisável.
--   - Teto de peso nominal (peso atual não pode ultrapassar o nominal) só é
--     aplicado às entradas de rotina (INITIAL_BALANCE/PURCHASE/RETURN); a
--     família de ajuste (POSITIVE_ADJUSTMENT/NEGATIVE_ADJUSTMENT/
--     WEIGHING_ADJUSTMENT) é isenta — é exatamente o mecanismo de "ajuste
--     explícito e documentado" citado no requisito 4 para quando um peso
--     real acima do nominal precisar ser registrado.
--   - status ESGOTADO é aplicado automaticamente quando o saldo chega a
--     zero por qualquer movimentação (nunca revertido automaticamente
--     quando o saldo volta a ficar positivo — decisão de simplicidade
--     documentada, revisável). Nenhuma movimentação é aceita contra um
--     rolo DESCARTADO (estado terminal).
--   - Nenhuma tolerância percentual fixa é inventada para a pesagem
--     (requisito 6: "se não houver tolerância aprovada, não invente um
--     percentual fixo") — motivo é sempre obrigatório para
--     WEIGHING_ADJUSTMENT, sem lógica diferencial por tamanho da diferença.
--   - Consumo automático por pedido/produção CONTINUA FORA DE ESCOPO nesta
--     migration: reference_type/reference_id existem só como campos
--     reservados (mesmo padrão de stock_movements), nenhuma function desta
--     migration os popula, nenhum trigger em orders/order_items é criado ou
--     alterado.

-- ---------------------------------------------------------------------------
-- filament_movements
-- ---------------------------------------------------------------------------
create table public.filament_movements (
  id uuid primary key default gen_random_uuid(),

  filament_type_id uuid not null references public.filament_types (id) on delete restrict,
  spool_id uuid not null references public.filament_spools (id) on delete restrict,

  movement_type text not null check (movement_type in (
    'INITIAL_BALANCE', 'PURCHASE', 'RETURN', 'POSITIVE_ADJUSTMENT',
    'MANUAL_CONSUMPTION', 'LOSS', 'SAMPLE_TEST', 'NEGATIVE_ADJUSTMENT',
    'WEIGHING_ADJUSTMENT'
  )),

  -- Gramas, fracionável (numeric, não integer) — sinal já resolvido no
  -- momento da gravação. Para os 8 tipos "normais" o sinal é function do
  -- movement_type (entrada soma, saída subtrai); para WEIGHING_ADJUSTMENT o
  -- sinal é a diferença real medida (pode ser positivo ou negativo) — por
  -- isso o CHECK aqui é só <> 0, nunca um sinal fixo por tipo (a mesma regra
  -- do sinal-por-tipo continua sendo aplicada nas RPCs, nunca confiando num
  -- delta já assinado vindo de fora do banco).
  quantity_delta numeric(10, 2) not null check (quantity_delta <> 0),

  balance_before numeric(10, 2) not null check (balance_before >= 0),
  balance_after numeric(10, 2) not null check (balance_after >= 0),

  reason text,
  constraint filament_movements_reason_required_by_type check (
    movement_type not in (
      'POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT', 'LOSS', 'SAMPLE_TEST',
      'MANUAL_CONSUMPTION', 'WEIGHING_ADJUSTMENT'
    )
    or (reason is not null and btrim(reason) <> '')
  ),

  -- Vínculo polimórfico futuro (pedido/produção) — reservado, nunca
  -- populado por esta migration. Mesma ressalva de stock_movements.
  reference_type text,
  reference_id uuid,

  idempotency_key text,

  occurred_at timestamptz not null default now(),

  created_by uuid not null references public.users (id) on delete restrict,

  created_at timestamptz not null default now()

  -- Sem updated_at: histórico imutável, nunca editado — mesmo padrão de
  -- stock_movements.
);

comment on table public.filament_movements is
  'Ledger imutável de movimentações de filamento (Módulo 3, Incremento 4 — MVP, regras sujeitas a revisão após uso real). Tabela dedicada, independente de public.stock_movements (ver decisão de arquitetura no cabeçalho desta migration): grama é fracionário (numeric) e cada linha referencia tipo E rolo, não só um item polimórfico único. filament_spools.current_net_weight_grams é o saldo materializado; esta tabela é auditoria/reconciliação. Escrita exclusiva via register_filament_movement/register_filament_weighing (abaixo) — nenhum UPDATE/DELETE é permitido.';

comment on column public.filament_movements.filament_type_id is
  'Denormalização deliberada de spool_id -> filament_spools.filament_type_id, sempre lida da linha travada do rolo (nunca aceita como parâmetro do chamador) — permite histórico consolidado por tipo sem join.';

create index idx_filament_movements_spool
  on public.filament_movements (spool_id, occurred_at desc);

create index idx_filament_movements_type
  on public.filament_movements (filament_type_id, occurred_at desc);

create index idx_filament_movements_reference
  on public.filament_movements (reference_type, reference_id)
  where reference_type is not null;

create unique index ux_filament_movements_idempotency_key
  on public.filament_movements (idempotency_key)
  where idempotency_key is not null;

alter table public.filament_movements enable row level security;

revoke all on public.filament_movements from anon;
revoke all on public.filament_movements from authenticated;
grant select on public.filament_movements to authenticated;

create policy "Active users can view filament movements"
  on public.filament_movements
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- register_filament_movement — 8 tipos manuais "normais" (nunca
-- WEIGHING_ADJUSTMENT, ver register_filament_weighing abaixo)
-- ---------------------------------------------------------------------------
-- Mesmo padrão de lock/concorrência/idempotência já estabelecido por
-- register_stock_movement (20260827090000): FOR UPDATE na linha do rolo
-- ANTES de qualquer leitura/gravação dependente do estado atual; checagem
-- de idempotência depois do lock; bloco aninhado BEGIN/EXCEPTION em volta
-- do INSERT capturando unique_violation especificamente na constraint de
-- idempotency_key (caso residual de duas chamadas concorrentes com a MESMA
-- chave para ROLOS diferentes).
create or replace function public.register_filament_movement(
  p_spool_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_changed_by uuid,
  p_reason text default null,
  p_occurred_at timestamptz default now(),
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_idempotency_key text default null
)
returns public.filament_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filament_type_id uuid;
  v_nominal numeric;
  v_status text;
  v_balance_before numeric;
  v_balance_after numeric;
  v_quantity_delta numeric;
  v_new_status text;
  v_existing public.filament_movements;
  v_row public.filament_movements;
  v_normalized_reason text;
  v_normalized_reference_type text;
  v_conflict_constraint text;
begin
  perform public.assert_active_user(p_changed_by);

  if p_movement_type = 'WEIGHING_ADJUSTMENT' then
    raise exception 'register_filament_movement: movement_type WEIGHING_ADJUSTMENT só pode ser gravado por register_filament_weighing';
  end if;

  if p_movement_type not in (
    'INITIAL_BALANCE', 'PURCHASE', 'RETURN', 'POSITIVE_ADJUSTMENT',
    'MANUAL_CONSUMPTION', 'LOSS', 'SAMPLE_TEST', 'NEGATIVE_ADJUSTMENT'
  ) then
    raise exception 'filament_movements.movement_type inválido: %', p_movement_type;
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'register_filament_movement: p_quantity deve ser um número positivo (recebido %)', p_quantity;
  end if;

  v_normalized_reason := nullif(btrim(coalesce(p_reason, '')), '');
  v_normalized_reference_type := nullif(btrim(coalesce(p_reference_type, '')), '');

  if p_movement_type in ('POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT', 'LOSS', 'SAMPLE_TEST', 'MANUAL_CONSUMPTION')
     and v_normalized_reason is null then
    raise exception 'register_filament_movement: motivo obrigatório para movement_type %', p_movement_type;
  end if;

  -- Lock na linha do rolo — serializa concorrência e confirma existência,
  -- mesmo raciocínio de register_stock_movement.
  select filament_type_id, nominal_weight_grams, status, current_net_weight_grams
    into v_filament_type_id, v_nominal, v_status, v_balance_before
    from public.filament_spools where id = p_spool_id for update;

  if not found then
    raise exception 'filament_spools.id % não encontrado', p_spool_id;
  end if;

  -- Idempotência — ver nota de concorrência no comentário de
  -- register_stock_movement (mesmo raciocínio, replicado aqui).
  if p_idempotency_key is not null then
    select * into v_existing from public.filament_movements where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.spool_id = p_spool_id
         and v_existing.movement_type = p_movement_type
         and v_existing.quantity_delta = (case
              when p_movement_type in ('INITIAL_BALANCE', 'PURCHASE', 'RETURN', 'POSITIVE_ADJUSTMENT') then p_quantity
              else -p_quantity
            end)
         and coalesce(v_existing.reason, '') = coalesce(v_normalized_reason, '')
         and coalesce(v_existing.reference_type, '') = coalesce(v_normalized_reference_type, '')
         and v_existing.reference_id is not distinct from p_reference_id
      then
        return v_existing;
      else
        raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
      end if;
    end if;
  end if;

  if v_status = 'DESCARTADO' then
    raise exception 'FILAMENT_SPOOL_DISCARDED: Este rolo foi descartado e não aceita novas movimentações.';
  end if;

  if p_movement_type = 'INITIAL_BALANCE' then
    if exists (select 1 from public.filament_movements where spool_id = p_spool_id) then
      raise exception 'INITIAL_BALANCE_ALREADY_EXISTS: INITIAL_BALANCE só pode ser a primeira movimentação do rolo — já existe(m) movimentação(ões) para o rolo %', p_spool_id;
    end if;
    if v_balance_before <> 0 then
      raise exception 'INITIAL_BALANCE_REQUIRES_ZERO: INITIAL_BALANCE exige peso atual igual a zero (peso atual: %)', v_balance_before;
    end if;
  end if;

  v_quantity_delta := case
    when p_movement_type in ('INITIAL_BALANCE', 'PURCHASE', 'RETURN', 'POSITIVE_ADJUSTMENT') then p_quantity
    else -p_quantity
  end;

  v_balance_after := v_balance_before + v_quantity_delta;

  if v_balance_after < 0 then
    raise exception
      'FILAMENT_INSUFFICIENT_BALANCE: peso insuficiente para % no rolo % — peso atual: %g, quantidade solicitada: %g',
      p_movement_type, p_spool_id, v_balance_before, p_quantity;
  end if;

  if p_movement_type in ('INITIAL_BALANCE', 'PURCHASE', 'RETURN') and v_balance_after > v_nominal then
    raise exception
      'FILAMENT_EXCEEDS_NOMINAL: resultado (%g) ultrapassaria o peso nominal do rolo (%g) — para registrar um peso real superior ao nominal, use um ajuste explícito (POSITIVE_ADJUSTMENT) com motivo documentado.',
      v_balance_after, v_nominal;
  end if;

  begin
    insert into public.filament_movements (
      filament_type_id, spool_id, movement_type, quantity_delta, balance_before, balance_after,
      reason, reference_type, reference_id, idempotency_key, occurred_at, created_by
    ) values (
      v_filament_type_id, p_spool_id, p_movement_type, v_quantity_delta, v_balance_before, v_balance_after,
      v_normalized_reason, v_normalized_reference_type, p_reference_id, p_idempotency_key,
      coalesce(p_occurred_at, now()), p_changed_by
    )
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_conflict_constraint = constraint_name;

    if v_conflict_constraint <> 'ux_filament_movements_idempotency_key' or p_idempotency_key is null then
      raise;
    end if;

    select * into v_existing from public.filament_movements where idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;

    if v_existing.spool_id = p_spool_id
       and v_existing.movement_type = p_movement_type
       and v_existing.quantity_delta = v_quantity_delta
       and coalesce(v_existing.reason, '') = coalesce(v_normalized_reason, '')
       and coalesce(v_existing.reference_type, '') = coalesce(v_normalized_reference_type, '')
       and v_existing.reference_id is not distinct from p_reference_id
    then
      return v_existing;
    else
      raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
    end if;
  end;

  -- ESGOTADO é aplicado automaticamente quando o saldo chega a zero (nunca
  -- revertido automaticamente aqui quando volta a ficar positivo — ver nota
  -- de arquitetura no cabeçalho da migration).
  v_new_status := case when v_balance_after = 0 then 'ESGOTADO' else v_status end;

  update public.filament_spools
    set current_net_weight_grams = v_balance_after,
        status = v_new_status
    where id = p_spool_id;

  return v_row;
end;
$$;

comment on function public.register_filament_movement(uuid, text, numeric, uuid, text, timestamptz, text, uuid, text) is
  'Única função (junto com register_filament_weighing) que escreve em filament_movements e em filament_spools.current_net_weight_grams/status. p_quantity é sempre positivo — o sinal é resolvido a partir de movement_type. Rejeita WEIGHING_ADJUSTMENT (exclusivo de register_filament_weighing). Bloqueia peso negativo, bloqueia ultrapassar o nominal para entradas de rotina (isento para ajustes), bloqueia movimentação contra rolo DESCARTADO, aplica ESGOTADO automaticamente ao chegar a zero, valida INITIAL_BALANCE (primeira movimentação, saldo zero) e é idempotente sob concorrência real (mesmo padrão de register_stock_movement).';

revoke execute on function public.register_filament_movement(uuid, text, numeric, uuid, text, timestamptz, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_filament_movement(uuid, text, numeric, uuid, text, timestamptz, text, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- register_filament_weighing — "Registrar pesagem" (requisito 6)
-- ---------------------------------------------------------------------------
-- Exatamente UM dos dois pesos deve ser informado:
--   p_measured_gross_weight_grams — peso bruto medido na balança (rolo +
--     carretel). Exige filament_spools.empty_spool_weight_grams conhecido
--     (not null); peso líquido = peso bruto - tara.
--   p_measured_net_weight_grams — peso líquido disponível informado
--     diretamente (usado quando a tara do carretel não é conhecida — nunca
--     inventamos uma tara para permitir o cálculo).
-- Delta = peso líquido calculado - saldo atual (pode ser positivo ou
-- negativo). Delta zero não grava movimentação nenhuma (nada mudou) — a
-- function devolve null nesse caso, sem erro; o chamador deve tratar
-- null como "nenhuma diferença encontrada". Nenhuma tolerância percentual é
-- aplicada (requisito 6: não inventar tolerância sem regra aprovada) —
-- motivo é sempre obrigatório (ver filament_movements_reason_required_by_type),
-- qualquer que seja o tamanho da diferença.
create or replace function public.register_filament_weighing(
  p_spool_id uuid,
  p_measured_gross_weight_grams numeric,
  p_measured_net_weight_grams numeric,
  p_reason text,
  p_changed_by uuid,
  p_occurred_at timestamptz default now(),
  p_idempotency_key text default null
)
returns public.filament_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filament_type_id uuid;
  v_nominal numeric;
  v_tare numeric;
  v_status text;
  v_balance_before numeric;
  v_computed_net numeric;
  v_quantity_delta numeric;
  v_balance_after numeric;
  v_new_status text;
  v_normalized_reason text;
  v_existing public.filament_movements;
  v_row public.filament_movements;
  v_conflict_constraint text;
begin
  perform public.assert_active_user(p_changed_by);

  if (p_measured_gross_weight_grams is null) = (p_measured_net_weight_grams is null) then
    raise exception 'register_filament_weighing: informe exatamente um dos dois pesos (peso bruto medido OU peso líquido disponível), nunca os dois nem nenhum';
  end if;

  v_normalized_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_normalized_reason is null then
    raise exception 'register_filament_weighing: motivo obrigatório para registrar uma pesagem';
  end if;

  select filament_type_id, nominal_weight_grams, empty_spool_weight_grams, status, current_net_weight_grams
    into v_filament_type_id, v_nominal, v_tare, v_status, v_balance_before
    from public.filament_spools where id = p_spool_id for update;

  if not found then
    raise exception 'filament_spools.id % não encontrado', p_spool_id;
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.filament_movements where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.spool_id = p_spool_id
         and v_existing.movement_type = 'WEIGHING_ADJUSTMENT'
         and coalesce(v_existing.reason, '') = coalesce(v_normalized_reason, '')
      then
        return v_existing;
      else
        raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
      end if;
    end if;
  end if;

  if v_status = 'DESCARTADO' then
    raise exception 'FILAMENT_SPOOL_DISCARDED: Este rolo foi descartado e não aceita novas movimentações.';
  end if;

  if p_measured_gross_weight_grams is not null then
    if v_tare is null then
      raise exception 'FILAMENT_TARE_UNKNOWN: Peso do carretel vazio deste rolo não é conhecido — informe o peso líquido disponível diretamente em vez do peso bruto.';
    end if;
    if p_measured_gross_weight_grams < v_tare then
      raise exception 'register_filament_weighing: peso bruto medido (%g) não pode ser menor que a tara do carretel (%g)', p_measured_gross_weight_grams, v_tare;
    end if;
    v_computed_net := p_measured_gross_weight_grams - v_tare;
  else
    v_computed_net := p_measured_net_weight_grams;
  end if;

  if v_computed_net < 0 then
    raise exception 'register_filament_weighing: peso líquido resultante não pode ser negativo (calculado: %g)', v_computed_net;
  end if;

  v_quantity_delta := v_computed_net - v_balance_before;

  if v_quantity_delta = 0 then
    return null;
  end if;

  v_balance_after := v_computed_net;

  begin
    insert into public.filament_movements (
      filament_type_id, spool_id, movement_type, quantity_delta, balance_before, balance_after,
      reason, idempotency_key, occurred_at, created_by
    ) values (
      v_filament_type_id, p_spool_id, 'WEIGHING_ADJUSTMENT', v_quantity_delta, v_balance_before, v_balance_after,
      v_normalized_reason, p_idempotency_key, coalesce(p_occurred_at, now()), p_changed_by
    )
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_conflict_constraint = constraint_name;

    if v_conflict_constraint <> 'ux_filament_movements_idempotency_key' or p_idempotency_key is null then
      raise;
    end if;

    select * into v_existing from public.filament_movements where idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;

    if v_existing.spool_id = p_spool_id
       and v_existing.movement_type = 'WEIGHING_ADJUSTMENT'
       and coalesce(v_existing.reason, '') = coalesce(v_normalized_reason, '')
    then
      return v_existing;
    else
      raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
    end if;
  end;

  v_new_status := case when v_balance_after = 0 then 'ESGOTADO' else v_status end;

  update public.filament_spools
    set current_net_weight_grams = v_balance_after,
        status = v_new_status
    where id = p_spool_id;

  return v_row;
end;
$$;

comment on function public.register_filament_weighing(uuid, numeric, numeric, text, uuid, timestamptz, text) is
  'Registra uma pesagem física: peso disponível = peso bruto medido - tara (quando a tara do rolo é conhecida) OU o peso líquido informado diretamente (quando não é). Delta zero não grava movimentação (devolve null). Bloqueia resultado líquido negativo. Motivo sempre obrigatório — nenhuma tolerância percentual é aplicada (não inventada sem regra aprovada). Único caminho de escrita para movement_type=WEIGHING_ADJUSTMENT.';

revoke execute on function public.register_filament_weighing(uuid, numeric, numeric, text, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.register_filament_weighing(uuid, numeric, numeric, text, uuid, timestamptz, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- vw_filament_type_summary — quantidade disponível por tipo (requisito 3:
-- "quantidade disponível do tipo será a soma do peso disponível dos seus
-- rolos ativos e utilizáveis"; requisito 7: listagem de tipos)
-- ---------------------------------------------------------------------------
-- "Rolo ativo e utilizável" = is_active = true E status not in ('ESGOTADO',
-- 'DESCARTADO'). O nível de estoque (normal/baixo/sem estoque) NÃO é
-- calculado aqui — mesma decisão já em vigor para accessories/packaging
-- (getStockLevel é lógica de frontend, StockMovementPanel.tsx) —, esta view
-- só expõe os números brutos (total_available_grams, minimum_stock_grams)
-- para o frontend derivar o nível com a mesma função já existente.
create view public.vw_filament_type_summary
with (security_invoker = true) as
select
  ft.id as filament_type_id,
  ft.material,
  ft.manufacturer,
  ft.line,
  ft.commercial_color,
  ft.color_code,
  ft.minimum_stock_grams,
  ft.is_active,
  coalesce(sum(fs.current_net_weight_grams) filter (
    where fs.is_active and fs.status not in ('ESGOTADO', 'DESCARTADO')
  ), 0) as total_available_grams,
  count(fs.id) filter (
    where fs.is_active and fs.status not in ('ESGOTADO', 'DESCARTADO')
  ) as usable_spool_count,
  count(fs.id) as total_spool_count
from public.filament_types ft
left join public.filament_spools fs on fs.filament_type_id = ft.id
group by ft.id, ft.material, ft.manufacturer, ft.line, ft.commercial_color, ft.color_code, ft.minimum_stock_grams, ft.is_active;

comment on view public.vw_filament_type_summary is
  'Uma linha por filament_type, com total_available_grams = soma do peso disponível dos rolos ativos e utilizáveis (is_active=true, status not in (ESGOTADO, DESCARTADO)). Nível de estoque (normal/baixo/sem estoque) é derivado no frontend a partir de total_available_grams/minimum_stock_grams, mesma função getStockLevel já usada por Acessórios/Embalagens — não recalculado aqui. Somente leitura; security_invoker=true.';

grant select on public.vw_filament_type_summary to authenticated;

-- ---------------------------------------------------------------------------
-- delete_filament_spool — adiciona o bloqueio por histórico de movimentação,
-- agora que filament_movements existe. CREATE OR REPLACE (mesma assinatura).
-- ---------------------------------------------------------------------------
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

  if exists (select 1 from public.filament_movements where spool_id = p_filament_spool_id) then
    raise exception 'FILAMENT_SPOOL_HAS_MOVEMENTS: Este rolo possui movimentações registradas e não pode ser excluído. Desative ou descarte o rolo.';
  end if;

  delete from public.filament_spools where id = p_filament_spool_id;
end;
$$;

comment on function public.delete_filament_spool(uuid, uuid) is
  'Exclusão física protegida de um rolo: bloqueada quando há movimentação (filament_movements) vinculada — FILAMENT_SPOOL_HAS_MOVEMENTS:. Nenhuma exclusão em cascata.';

revoke execute on function public.delete_filament_spool(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_filament_spool(uuid, uuid)
  to service_role;
