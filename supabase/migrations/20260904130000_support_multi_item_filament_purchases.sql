-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- Compra de Filamentos com VÁRIOS itens na mesma compra (2026-09-04). Pedido
-- do usuário: uma única compra pode conter vários tipos/marcas de filamento
-- diferentes de uma vez (ex.: 2 rolos de PLA Matte Preto da Bambu Lab + 1
-- rolo de PLA Silk Dourado da Voolt, com um único frete total) — sem criar
-- uma compra separada por item apenas para simular a interface.
--
-- Migration APPEND-ONLY — nenhuma migration anterior é editada.
-- register_inventory_purchase (20260828121000/20260904120000) e o fluxo de
-- compra de item único (ACCESSORY/PACKAGING e o antigo FILAMENT de item
-- único) permanecem INTOCADOS nesta migration: nenhuma linha de código, CHECK
-- ou GRANT dessa função é alterada. Todo dado/rolo/compra histórico
-- permanece exatamente como está, sempre legível.
--
-- MODELAGEM ADOTADA: cabeçalho -> itens -> rolos.
--   - CABEÇALHO: reaproveita a própria public.inventory_purchases já
--     existente (nenhuma tabela de cabeçalho nova) — category='FILAMENT',
--     freight_value = frete total da compra (informado uma única vez, nunca
--     dividido/distribuído entre itens ou rolos aqui), quantity/item_value
--     passam a guardar os TOTAIS agregados (nº de rolos e subtotal, somados
--     de todos os itens) quando o cabeçalho é de uma compra multi-item —
--     nunca os dados de um item específico. total_value continua sendo a
--     coluna gerada item_value+freight_value (nenhuma mudança nela): o
--     "Total da compra" pedido pela interface (subtotal + frete) continua
--     garantido pelo próprio Postgres.
--   - item_id (antes NOT NULL, apontava sempre para o único item da compra)
--     passa a ser NULLABLE: uma compra com mais de um tipo de filamento não
--     tem um único item ao qual apontar. NULL identifica exclusivamente um
--     cabeçalho multi-item novo (register_filament_purchase); toda linha
--     ACCESSORY/PACKAGING e toda linha FILAMENT de item único (histórica ou
--     nova, via register_inventory_purchase) continua com item_id
--     preenchido normalmente — leitura 100% compatível com compras antigas.
--   - ITENS: nova tabela public.inventory_purchase_filament_items — um item
--     por (tipo de filamento + marca comprada + peso líquido + quantidade +
--     valor unitário), sempre vinculado a um cabeçalho. filament_type_id é a
--     ÚNICA identidade do tipo (nunca fabricante/marca — "não usar
--     fabricante como parte da identidade do tipo", requisito explícito);
--     manufacturer aqui é a MARCA DA COMPRA (ex.: "Bambu Lab", "Voolt", "3D
--     Fila") — um atributo do item comprado, DISTINTO do
--     filament_types.manufacturer interno (que continua sempre "Não
--     informado", nunca alterado por uma compra — requisito preservado da
--     rodada anterior). item_value é GENERATED (quantity*unit_value), mesmo
--     princípio de total_value em inventory_purchases: a invariante "valor
--     do item = quantidade × valor unitário" fica garantida pelo próprio
--     Postgres.
--   - ROLOS: filament_spools ganha purchase_item_id (nullable), vínculo
--     INEQUÍVOCO entre rolo e item da compra — é dele que se deriva de forma
--     confiável a marca (manufacturer) e o valor unitário pagos por aquele
--     rolo específico, mesmo quando a compra cobre vários tipos/marcas ao
--     mesmo tempo ("a marca deve permanecer vinculada à compra e ser
--     identificável no rolo criado" — satisfeito por derivação via FK, sem
--     duplicar uma coluna de marca em filament_spools). purchase_id (coluna
--     já existente, 20260828121000) continua preenchido também, apontando
--     sempre para o cabeçalho — nenhuma coluna antiga é removida ou
--     reaproveitada com um sentido diferente.
--
-- register_filament_purchase (nova RPC, dedicada): recebe o frete total +
-- uma lista JSON de itens; cria o cabeçalho, cada item e todos os rolos
-- correspondentes numa ÚNICA transação Postgres — qualquer falha (no
-- cabeçalho, em qualquer item, ou em qualquer rolo) desfaz TUDO que a
-- chamada já tinha feito até aquele ponto (mesmo princípio de atomicidade
-- por construção já usado em register_inventory_purchase, nunca por
-- controle manual de transação). Nunca cria nem localiza tipo por
-- Material+Cor+Acabamento — cada item exige um filament_type_id já
-- cadastrado e ATIVO. O peso bruto individual do rolo NÃO é pedido nesta
-- nova janela (requisito explícito) — cada rolo nasce com
-- empty_spool_weight_grams/initial_gross_weight_grams em null, exatamente
-- como um rolo criado manualmente ("Novo rolo"), nunca inventando uma tara.
--
-- Reaproveita, sem duplicar lógica: next_filament_spool_code() (mesmo
-- gerador de código RL-YY-NNN) e register_filament_movement (mesmo
-- lançamento PURCHASE por rolo, saldo inicial = peso líquido nominal).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- inventory_purchases.item_id passa a aceitar NULL — só para o cabeçalho de
-- uma compra de filamento com múltiplos itens (ver nota de modelagem acima).
-- Nenhuma linha existente é alterada (DROP NOT NULL não reescreve dados).
-- ---------------------------------------------------------------------------
alter table public.inventory_purchases alter column item_id drop not null;

comment on column public.inventory_purchases.item_id is
  'Sem foreign key (campo polimórfico, resolvido conforme category) — register_inventory_purchase confirma a existência real do item (ou cria o filament_type, para FILAMENT de item único, a partir de material+fabricante+acabamento+cor) antes de gravar esta linha. NULL (2026-09-04): exclusivo do cabeçalho de uma compra de FILAMENTO com múltiplos itens (register_filament_purchase) — quando a compra cobre mais de um tipo de filamento, não há um único item ao qual item_id possa apontar; o detalhe por item vive em inventory_purchase_filament_items. Toda linha ACCESSORY/PACKAGING e toda linha FILAMENT de item único (histórica ou nova) continua com item_id preenchido normalmente.';

-- ---------------------------------------------------------------------------
-- inventory_purchase_filament_items — um item (tipo + marca + peso líquido +
-- quantidade + valor unitário) por linha, sempre vinculado a um cabeçalho de
-- public.inventory_purchases. Ledger imutável, mesmo padrão de
-- inventory_purchases: sem updated_at, sem UPDATE/DELETE concedido a
-- nenhuma role de sessão — escrita exclusiva via register_filament_purchase
-- (security definer, service_role).
-- ---------------------------------------------------------------------------
create table public.inventory_purchase_filament_items (
  id uuid primary key default gen_random_uuid(),

  purchase_id uuid not null references public.inventory_purchases (id) on delete restrict,

  -- Única identidade do tipo comprado — nunca fabricante/marca (ver nota de
  -- modelagem acima). O tipo precisa existir e estar ATIVO no momento da
  -- compra (checado por register_filament_purchase); nenhuma FK garante
  -- "estava ativo no momento", só "existe" — a checagem de ativo é regra de
  -- negócio, não de schema, mesmo critério já usado em toda referência a
  -- filament_types.id neste projeto.
  filament_type_id uuid not null references public.filament_types (id) on delete restrict,

  -- Marca DA COMPRA (ex.: "Bambu Lab", "Voolt", "3D Fila") — atributo do
  -- item comprado, DISTINTO de filament_types.manufacturer (que continua
  -- sempre "Não informado" internamente, nunca alterado por uma compra).
  manufacturer text not null check (btrim(manufacturer) <> ''),

  nominal_weight_grams numeric(10, 2) not null check (nominal_weight_grams > 0),

  -- Número de rolos deste item específico — sempre inteiro positivo.
  quantity integer not null check (quantity > 0),

  -- Preço de UM rolo deste item (nunca o total do item).
  unit_value numeric(10, 2) not null check (unit_value >= 0),

  item_value numeric(10, 2) generated always as (quantity * unit_value) stored,

  created_at timestamptz not null default now()

  -- Sem updated_at: ledger imutável, mesmo padrão de inventory_purchases.
);

comment on table public.inventory_purchase_filament_items is
  'Item de uma compra de filamento (Módulo 3, Incremento 5, revisão de 2026-09-04 — suporte a múltiplos tipos na mesma compra): um tipo + marca da compra + peso líquido + quantidade + valor unitário por linha, sempre vinculado a um cabeçalho em inventory_purchases (category=''FILAMENT'', item_id null quando multi-item). item_value é gerado (quantity*unit_value). Ledger imutável — nenhum UPDATE/DELETE concedido a nenhuma role de sessão; escrita exclusiva via register_filament_purchase (security definer, service_role).';

comment on column public.inventory_purchase_filament_items.manufacturer is
  'Marca comprada deste item (ex.: "Bambu Lab", "Voolt", "3D Fila") — DISTINTA de filament_types.manufacturer (sempre "Não informado" internamente, nunca alterado por uma compra). Cada item da mesma compra pode ter uma marca diferente.';

comment on column public.inventory_purchase_filament_items.item_value is
  'Gerado pelo próprio Postgres como quantity*unit_value — nunca aceita um valor explícito no INSERT.';

create index idx_inventory_purchase_filament_items_purchase_id
  on public.inventory_purchase_filament_items (purchase_id);

create index idx_inventory_purchase_filament_items_filament_type_id
  on public.inventory_purchase_filament_items (filament_type_id);

alter table public.inventory_purchase_filament_items enable row level security;

revoke all on public.inventory_purchase_filament_items from anon;
revoke all on public.inventory_purchase_filament_items from authenticated;
grant select on public.inventory_purchase_filament_items to authenticated;

create policy "Active users can view filament purchase items"
  on public.inventory_purchase_filament_items
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- filament_spools.purchase_item_id — vínculo INEQUÍVOCO entre rolo e item da
-- compra (permite derivar marca/valor unitário do rolo, sem duplicar coluna
-- de marca em filament_spools). Nullable: null para todo rolo criado
-- manualmente ou por register_inventory_purchase (fluxo de item único,
-- preservado, nenhuma mudança nele) — purchase_id (já existente) continua
-- preenchido nos dois casos.
-- ---------------------------------------------------------------------------
alter table public.filament_spools
  add column purchase_item_id uuid references public.inventory_purchase_filament_items (id) on delete restrict;

comment on column public.filament_spools.purchase_item_id is
  'Vincula o rolo ao ITEM específico da compra que o originou (inventory_purchase_filament_items.id), quando criado por register_filament_purchase (2026-09-04, compra de filamento com múltiplos itens) — permite identificar de forma inequívoca a marca (manufacturer do item) e o valor unitário pagos por este rolo, mesmo quando a compra cobre vários tipos/marcas ao mesmo tempo. NULL para todo rolo criado manualmente ou por register_inventory_purchase (fluxo de item único, preservado) — purchase_id (coluna já existente) continua preenchido nos dois casos, sempre apontando para o cabeçalho da compra.';

create index idx_filament_spools_purchase_item_id
  on public.filament_spools (purchase_item_id)
  where purchase_item_id is not null;

-- ---------------------------------------------------------------------------
-- _build_filament_purchase_summary — função INTERNA (zero grants). Monta o
-- jsonb de retorno de register_filament_purchase (cabeçalho + itens + rolos
-- criados por item) a partir de um purchase_id já gravado — reaproveitada
-- tanto no caminho normal quanto no retorno idempotente (mesma chave, mesmo
-- payload), garantindo um único formato de resposta.
-- ---------------------------------------------------------------------------
create or replace function public._build_filament_purchase_summary(p_purchase_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'purchase_id', p.id,
    'occurred_at', p.occurred_at,
    'notes', p.notes,
    'freight_value', p.freight_value,
    'subtotal_value', p.item_value,
    'total_value', p.total_value,
    'created_at', p.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', it.id,
        'filament_type_id', it.filament_type_id,
        'manufacturer', it.manufacturer,
        'nominal_weight_grams', it.nominal_weight_grams,
        'quantity', it.quantity,
        'unit_value', it.unit_value,
        'item_value', it.item_value,
        'spool_ids', (
          select coalesce(jsonb_agg(s.id order by s.code), '[]'::jsonb)
          from public.filament_spools s
          where s.purchase_item_id = it.id
        )
      ) order by it.created_at)
      from public.inventory_purchase_filament_items it
      where it.purchase_id = p.id
    ), '[]'::jsonb)
  )
  from public.inventory_purchases p
  where p.id = p_purchase_id;
$$;

comment on function public._build_filament_purchase_summary(uuid) is
  'INTERNA (zero grants). Monta o jsonb de retorno de register_filament_purchase (cabeçalho + itens + spool_ids por item) a partir de um purchase_id já gravado. Somente leitura.';

revoke execute on function public._build_filament_purchase_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- register_filament_purchase — RPC dedicada à compra de filamento com
-- múltiplos itens (ver nota de modelagem no cabeçalho da migration).
-- ---------------------------------------------------------------------------
create or replace function public.register_filament_purchase(
  p_freight_value numeric,
  p_changed_by uuid,
  p_items jsonb,
  p_occurred_at timestamptz default now(),
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_freight numeric;
  v_existing public.inventory_purchases;
  v_existing_items jsonb;
  v_incoming_items jsonb;
  v_purchase public.inventory_purchases;
  v_item jsonb;
  v_filament_type_id uuid;
  v_manufacturer text;
  v_nominal numeric;
  v_quantity integer;
  v_unit_value numeric;
  v_total_quantity integer := 0;
  v_subtotal numeric := 0;
  v_item_index integer := 0;
  v_purchase_item_id uuid;
  v_code text;
  v_spool_id uuid;
  v_nested_key text;
  i integer;
begin
  perform public.assert_active_user(p_changed_by);

  v_freight := coalesce(p_freight_value, 0);
  if v_freight < 0 then
    raise exception 'register_filament_purchase: p_freight_value não pode ser negativo (recebido %)', p_freight_value;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'register_filament_purchase: informe ao menos um item em p_items (lista JSON não vazia)';
  end if;

  -- Primeira passagem: só validação estrutural + acumulação dos totais do
  -- cabeçalho (nenhuma escrita ainda) — payload inválido em qualquer item
  -- nunca cria nada, nem o cabeçalho.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_index := v_item_index + 1;

    v_filament_type_id := nullif(v_item ->> 'filament_type_id', '')::uuid;
    if v_filament_type_id is null then
      raise exception 'register_filament_purchase: item % — filament_type_id é obrigatório', v_item_index;
    end if;

    v_manufacturer := btrim(coalesce(v_item ->> 'manufacturer', ''));
    if v_manufacturer = '' then
      raise exception 'register_filament_purchase: item % — manufacturer (marca) não pode ser vazio', v_item_index;
    end if;

    v_nominal := nullif(v_item ->> 'nominal_weight_grams', '')::numeric;
    if v_nominal is null or v_nominal <= 0 then
      raise exception 'register_filament_purchase: item % — nominal_weight_grams deve ser um número positivo (recebido %)', v_item_index, v_item ->> 'nominal_weight_grams';
    end if;

    v_quantity := nullif(v_item ->> 'quantity', '')::integer;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'register_filament_purchase: item % — quantity deve ser um inteiro positivo (recebido %)', v_item_index, v_item ->> 'quantity';
    end if;

    v_unit_value := nullif(v_item ->> 'unit_value', '')::numeric;
    if v_unit_value is null or v_unit_value < 0 then
      raise exception 'register_filament_purchase: item % — unit_value não pode ser negativo (recebido %)', v_item_index, v_item ->> 'unit_value';
    end if;

    v_total_quantity := v_total_quantity + v_quantity;
    v_subtotal := v_subtotal + (v_quantity * v_unit_value);
  end loop;

  -- Idempotência checada ANTES de qualquer trabalho pesado (mesmo critério
  -- de register_inventory_purchase): mesma chave + mesmo payload (frete +
  -- itens canônicos) devolve a compra já registrada; payload diferente é
  -- rejeitado com IDEMPOTENCY_KEY_CONFLICT:.
  if p_idempotency_key is not null then
    select * into v_existing from public.inventory_purchases where idempotency_key = p_idempotency_key;
    if found then
      select jsonb_agg(jsonb_build_object(
               'filament_type_id', it.filament_type_id,
               'manufacturer', it.manufacturer,
               'nominal_weight_grams', it.nominal_weight_grams,
               'quantity', it.quantity,
               'unit_value', it.unit_value
             ) order by it.created_at)
        into v_existing_items
        from public.inventory_purchase_filament_items it
        where it.purchase_id = v_existing.id;

      select jsonb_agg(jsonb_build_object(
               'filament_type_id', (elem ->> 'filament_type_id')::uuid,
               'manufacturer', btrim(elem ->> 'manufacturer'),
               'nominal_weight_grams', (elem ->> 'nominal_weight_grams')::numeric,
               'quantity', (elem ->> 'quantity')::integer,
               'unit_value', (elem ->> 'unit_value')::numeric
             ))
        into v_incoming_items
        from jsonb_array_elements(p_items) as elem;

      if v_existing.category = 'FILAMENT'
         and v_existing.freight_value = v_freight
         and coalesce(v_existing_items, '[]'::jsonb) = coalesce(v_incoming_items, '[]'::jsonb)
      then
        return public._build_filament_purchase_summary(v_existing.id);
      else
        raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
      end if;
    end if;
  end if;

  -- Cabeçalho único da compra (reaproveita inventory_purchases já existente
  -- — nenhuma tabela de cabeçalho nova): quantity/item_value guardam os
  -- TOTAIS agregados (nº de rolos e subtotal, somados de todos os itens),
  -- nunca os dados de um item específico; item_id fica null (não há um
  -- único item ao qual o cabeçalho aponte quando há mais de um tipo na
  -- mesma compra). freight_value é informado uma única vez aqui — nunca
  -- dividido entre itens/rolos.
  insert into public.inventory_purchases (
    category, item_id, quantity, item_value, freight_value, occurred_at, notes, idempotency_key, created_by
  ) values (
    'FILAMENT', null, v_total_quantity, v_subtotal, v_freight, coalesce(p_occurred_at, now()),
    nullif(btrim(coalesce(p_notes, '')), ''), p_idempotency_key, p_changed_by
  )
  returning * into v_purchase;

  -- Segunda passagem: com o cabeçalho já criado, materializa cada item + os
  -- N rolos correspondentes. Reparse determinístico do mesmo p_items (os
  -- mesmos valores já validados na primeira passagem, nenhuma escrita
  -- aconteceu entre as duas).
  v_item_index := 0;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_index := v_item_index + 1;

    v_filament_type_id := (v_item ->> 'filament_type_id')::uuid;
    v_manufacturer := btrim(v_item ->> 'manufacturer');
    v_nominal := (v_item ->> 'nominal_weight_grams')::numeric;
    v_quantity := (v_item ->> 'quantity')::integer;
    v_unit_value := (v_item ->> 'unit_value')::numeric;

    -- Trava e confirma que o tipo continua ATIVO — mesma serialização já
    -- usada por create_filament_spool/register_inventory_purchase (FOR
    -- UPDATE na linha do tipo). Nunca cria nem localiza tipo por
    -- Material+Cor+Acabamento.
    perform 1 from public.filament_types where id = v_filament_type_id and is_active for update;
    if not found then
      raise exception 'filament_types.id % não encontrado ou inativo', v_filament_type_id;
    end if;

    insert into public.inventory_purchase_filament_items (
      purchase_id, filament_type_id, manufacturer, nominal_weight_grams, quantity, unit_value
    ) values (
      v_purchase.id, v_filament_type_id, v_manufacturer, v_nominal, v_quantity, v_unit_value
    )
    returning id into v_purchase_item_id;

    -- Peso bruto individual NÃO é pedido nesta janela (requisito explícito):
    -- cada rolo nasce com empty_spool_weight_grams/initial_gross_weight_grams
    -- em null, exatamente como um rolo criado manualmente — nenhuma tara
    -- inventada.
    for i in 1..v_quantity loop
      v_code := public.next_filament_spool_code();

      insert into public.filament_spools (
        code, filament_type_id, nominal_weight_grams, purchase_id, purchase_item_id, received_at, status, is_active
      ) values (
        v_code, v_filament_type_id, v_nominal, v_purchase.id, v_purchase_item_id,
        coalesce(p_occurred_at, now())::date, 'LACRADO', true
      )
      returning id into v_spool_id;

      v_nested_key := case when p_idempotency_key is not null
        then p_idempotency_key || ':item:' || v_item_index::text || ':spool:' || i::text
        else null
      end;

      -- Reaproveita register_filament_movement integralmente (já valida
      -- rolo/teto nominal, já trava a linha, já atualiza
      -- current_net_weight_grams/status na mesma transação) — saldo
      -- disponível inicial = peso líquido nominal, nunca escrito diretamente.
      perform public.register_filament_movement(
        v_spool_id, 'PURCHASE', v_nominal, p_changed_by,
        null, p_occurred_at, 'PURCHASE', v_purchase.id, v_nested_key
      );
    end loop;
  end loop;

  return public._build_filament_purchase_summary(v_purchase.id);
end;
$$;

comment on function public.register_filament_purchase(numeric, uuid, jsonb, timestamptz, text, text) is
  'Registra uma compra de filamento com UM OU MAIS itens (tipos/marcas diferentes) numa única transação: cria o cabeçalho (inventory_purchases, category=FILAMENT, item_id null, quantity/item_value = totais agregados, freight_value informado uma única vez), um inventory_purchase_filament_items por item (tipo já cadastrado e ATIVO — nunca cria nem localiza por nome — + marca da compra + peso líquido + quantidade + valor unitário) e N filament_spools por item (vinculados a filament_type_id e a purchase_item_id, sem peso bruto individual — empty_spool_weight_grams/initial_gross_weight_grams ficam null, como um rolo manual), registrando para cada rolo uma entrada PURCHASE via register_filament_movement (saldo inicial = peso líquido nominal). Atômica por construção: qualquer exceção (cabeçalho, item ou rolo) desfaz tudo que a chamada já tinha feito — nunca uma compra parcial. Idempotente quando p_idempotency_key é fornecida, checada antes de qualquer trabalho pesado. Devolve o jsonb de _build_filament_purchase_summary (cabeçalho + itens + spool_ids por item).';

revoke execute on function public.register_filament_purchase(numeric, uuid, jsonb, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.register_filament_purchase(numeric, uuid, jsonb, timestamptz, text, text)
  to service_role;
