-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- Correção do arredondamento na Compra de filamentos multi-item (2026-09-05):
-- a rodada anterior ("Valor total" por item no frontend, checkpoint
-- ab5ba1a) já exibia o total exato no formulário, mas ainda convertia para
-- unit_value ANTES do envio — para quantidade 3 e total informado R$ 100,00,
-- o banco persistia unit_value=33.33 e, por causa disso,
-- item_value = quantity*unit_value = 99,99 (um centavo a menos do que o
-- usuário realmente pagou). Autorizado pelo usuário: registrar exatamente o
-- valor total informado, derivando unit_value internamente (nunca o
-- contrário).
--
-- Migration APPEND-ONLY — nenhuma migration anterior é editada. Nenhuma
-- linha existente é apagada; toda compra já registrada permanece legível.
--
-- MODELAGEM:
--   - inventory_purchase_filament_items ganha total_value numeric(12,2) —
--     o valor pago por TODOS os rolos daquela linha, exatamente como
--     informado (nunca recalculado a partir de unit_value*quantity). A
--     partir desta migration, total_value é a fonte AUTORITATIVA para o
--     subtotal/total da compra (ver register_filament_purchase abaixo).
--   - Backfill: toda linha já existente recebe total_value = item_value (o
--     total que o contrato anterior já considerava correto para aquele
--     item — quantity*unit_value, reconstrução exata do que foi cobrado sob
--     o contrato antigo, já que o valor unitário ERA o dado de entrada
--     naquela época). Só depois do backfill a coluna vira NOT NULL — nunca
--     antes, para não quebrar em cima de linhas que ainda não a têm.
--   - unit_value e item_value CONTINUAM EXISTINDO, sem nenhuma alteração de
--     schema (mesmos tipos/CHECKs/coluna gerada de sempre) — só passam a
--     ser LEGADOS: item_value continua gerado como quantity*unit_value
--     (pode divergir de total_value em até poucos centavos quando
--     total_value não é múltiplo exato de quantity — arredondamento
--     inerente a qualquer contrato de preço por unidade, nunca eliminado
--     por completo, só deixado de ser a fonte de verdade). unit_value deixa
--     de ser aceito como entrada do chamador: register_filament_purchase
--     (abaixo) passa a CALCULÁ-LO internamente como
--     round(total_value / quantity, 2) e gravá-lo já pronto — nunca lido de
--     p_items a partir de agora.
--   - register_filament_purchase (mesma assinatura de 7 argumentos, só o
--     corpo muda): cada item de p_items passa a exigir total_value (não
--     mais unit_value); o subtotal do cabeçalho (inventory_purchases.
--     item_value, campo já existente, nunca gerado nessa tabela) agora
--     soma total_value de cada item DIRETAMENTE — nunca quantity*unit_value
--     — então o subtotal do cabeçalho fica sempre exato, mesmo quando um
--     item individual sofre arredondamento de centavo. O frete continua
--     somado uma única vez (freight_value do cabeçalho, inalterado);
--     total_value do CABEÇALHO (inventory_purchases.total_value, coluna
--     gerada já existente = item_value + freight_value) automaticamente
--     reflete subtotal exato + frete, sem nenhuma mudança nela.
--   - _build_filament_purchase_summary passa a incluir total_value de cada
--     item na resposta (além de unit_value/item_value, mantidos por
--     compatibilidade).
--   - Criação dos rolos, saldo inicial, vínculo purchase_item_id,
--     idempotência (agora comparando total_value em vez de unit_value) e
--     todas as demais regras já existentes permanecem inalteradas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Nova coluna, nullable a princípio (backfill primeiro, NOT NULL depois).
-- ---------------------------------------------------------------------------
alter table public.inventory_purchase_filament_items
  add column total_value numeric(12, 2);

-- ---------------------------------------------------------------------------
-- 2. Backfill: toda linha já existente recebe o total que o contrato
-- anterior já considerava correto para aquele item (item_value =
-- quantity*unit_value, coluna gerada já existente) — nenhuma compra antiga
-- é alterada em seu valor, só a nova coluna passa a existir preenchida.
-- ---------------------------------------------------------------------------
update public.inventory_purchase_filament_items
  set total_value = item_value
  where total_value is null;

-- ---------------------------------------------------------------------------
-- 3. Regras (maior que zero, obrigatória) só DEPOIS do backfill — nunca
-- antes, para não rejeitar linhas que ainda não tinham o valor.
-- ---------------------------------------------------------------------------
alter table public.inventory_purchase_filament_items
  add constraint inventory_purchase_filament_items_total_value_positive
    check (total_value > 0);

alter table public.inventory_purchase_filament_items
  alter column total_value set not null;

comment on column public.inventory_purchase_filament_items.total_value is
  'FONTE AUTORITATIVA (2026-09-05) do valor pago por TODOS os rolos desta linha — exatamente o valor informado pelo usuário, nunca recalculado a partir de unit_value*quantity. Usado por register_filament_purchase para somar o subtotal do cabeçalho (inventory_purchases.item_value) diretamente, sem o arredondamento de unit_value no caminho. Backfill desta migration: linhas anteriores a 2026-09-05 receberam total_value = item_value (quantity*unit_value sob o contrato antigo, onde unit_value era o dado de entrada).';

comment on column public.inventory_purchase_filament_items.unit_value is
  'LEGADO a partir de 2026-09-05 — deixou de ser aceito como entrada do chamador; register_filament_purchase agora o CALCULA internamente como round(total_value / quantity, 2) e grava o resultado já pronto. Pode divergir do "valor unitário exato" quando total_value não é múltiplo exato de quantity (ex.: R$ 100,00 ÷ 3 -> unit_value = 33.33) — arredondamento inerente a qualquer contrato de preço por unidade, nunca eliminado por completo. Mantido só por compatibilidade de leitura; nenhum consumidor novo deve gravar ou ler unit_value como fonte de verdade — use total_value.';

comment on column public.inventory_purchase_filament_items.item_value is
  'LEGADO a partir de 2026-09-05 — continua gerado como quantity*unit_value (nenhuma mudança de definição), mas unit_value agora é ele próprio derivado de total_value (ver comentário da coluna), então item_value herda o mesmo arredondamento de centavo em uma divisão não exata (ex.: quantity=3, total_value=100.00 -> unit_value=33.33 -> item_value=99.99, um centavo abaixo do total realmente pago). total_value é a fonte AUTORITATIVA a partir desta migration; nenhum consumidor novo deve somar/exibir item_value como o valor pago pela linha.';

-- ---------------------------------------------------------------------------
-- _build_filament_purchase_summary — mesma assinatura (uuid) — só o jsonb de
-- cada item ganha total_value (além de unit_value/item_value, preservados).
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
        'total_value', it.total_value,
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
  'INTERNA (zero grants). Monta o jsonb de retorno de register_filament_purchase (cabeçalho + itens + spool_ids por item) a partir de um purchase_id já gravado. subtotal_value (cabeçalho) é sempre a soma de total_value dos itens (2026-09-05, ver register_filament_purchase) — nunca quantity*unit_value. Cada item traz total_value (autoritativo) e unit_value/item_value (legado, preservados por compatibilidade). Somente leitura.';

revoke execute on function public._build_filament_purchase_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- register_filament_purchase — mesma assinatura de 7 argumentos (nenhum
-- parâmetro novo). Cada item de p_items agora exige total_value (não mais
-- unit_value); unit_value é calculado aqui dentro. O subtotal do cabeçalho
-- soma total_value diretamente (exato — numeric é aritmética decimal exata
-- em Postgres, nunca ponto flutuante), nunca quantity*unit_value.
-- ---------------------------------------------------------------------------
create or replace function public.register_filament_purchase(
  p_freight_value numeric,
  p_changed_by uuid,
  p_items jsonb,
  p_occurred_at timestamptz default now(),
  p_notes text default null,
  p_idempotency_key text default null,
  p_purchase_channel text default null
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
  v_total_value numeric;
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

  if p_purchase_channel is null or p_purchase_channel not in ('MERCADO_LIVRE', 'ALIEXPRESS', 'SHOPEE', 'PRESENCIAL', 'SITE', 'OUTRO') then
    raise exception 'register_filament_purchase: purchase_channel é obrigatório e deve ser um de MERCADO_LIVRE, ALIEXPRESS, SHOPEE, PRESENCIAL, SITE ou OUTRO (recebido %)', p_purchase_channel;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'register_filament_purchase: informe ao menos um item em p_items (lista JSON não vazia)';
  end if;

  -- Primeira passagem: só validação estrutural + acumulação dos totais do
  -- cabeçalho (nenhuma escrita ainda) — payload inválido em qualquer item
  -- nunca cria nada, nem o cabeçalho. v_subtotal soma total_value de cada
  -- item DIRETAMENTE (2026-09-05) — nunca quantity*unit_value: numeric é
  -- aritmética decimal exata, então R$ 100,00 (quantity=3) contribui
  -- exatamente R$ 100,00 aqui, mesmo sabendo que 100,00 não divide em 3
  -- partes exatas de centavo.
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

    v_total_value := nullif(v_item ->> 'total_value', '')::numeric;
    if v_total_value is null or v_total_value <= 0 then
      raise exception 'register_filament_purchase: item % — total_value deve ser um número maior que zero (recebido %)', v_item_index, v_item ->> 'total_value';
    end if;

    v_total_quantity := v_total_quantity + v_quantity;
    v_subtotal := v_subtotal + v_total_value;
  end loop;

  -- Idempotência checada ANTES de qualquer trabalho pesado (mesmo critério
  -- de register_inventory_purchase): mesma chave + mesmo payload (frete +
  -- canal + itens canônicos, agora comparando total_value em vez de
  -- unit_value) devolve a compra já registrada; payload diferente é
  -- rejeitado com IDEMPOTENCY_KEY_CONFLICT:.
  if p_idempotency_key is not null then
    select * into v_existing from public.inventory_purchases where idempotency_key = p_idempotency_key;
    if found then
      select jsonb_agg(jsonb_build_object(
               'filament_type_id', it.filament_type_id,
               'manufacturer', it.manufacturer,
               'nominal_weight_grams', it.nominal_weight_grams,
               'quantity', it.quantity,
               'total_value', it.total_value
             ) order by it.created_at)
        into v_existing_items
        from public.inventory_purchase_filament_items it
        where it.purchase_id = v_existing.id;

      select jsonb_agg(jsonb_build_object(
               'filament_type_id', (elem ->> 'filament_type_id')::uuid,
               'manufacturer', btrim(elem ->> 'manufacturer'),
               'nominal_weight_grams', (elem ->> 'nominal_weight_grams')::numeric,
               'quantity', (elem ->> 'quantity')::integer,
               'total_value', (elem ->> 'total_value')::numeric
             ))
        into v_incoming_items
        from jsonb_array_elements(p_items) as elem;

      if v_existing.category = 'FILAMENT'
         and v_existing.freight_value = v_freight
         and v_existing.purchase_channel is not distinct from p_purchase_channel
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
  -- TOTAIS agregados (nº de rolos e SUBTOTAL EXATO, soma de total_value de
  -- todos os itens — 2026-09-05), nunca os dados de um item específico;
  -- item_id fica null (não há um único item ao qual o cabeçalho aponte
  -- quando há mais de um tipo na mesma compra). freight_value é informado
  -- uma única vez aqui — nunca dividido entre itens/rolos. purchase_channel
  -- grava o local/canal da compra escolhido na interface.
  insert into public.inventory_purchases (
    category, item_id, quantity, item_value, freight_value, occurred_at, notes, idempotency_key, created_by, purchase_channel
  ) values (
    'FILAMENT', null, v_total_quantity, v_subtotal, v_freight, coalesce(p_occurred_at, now()),
    nullif(btrim(coalesce(p_notes, '')), ''), p_idempotency_key, p_changed_by, p_purchase_channel
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
    v_total_value := (v_item ->> 'total_value')::numeric;
    -- unit_value é sempre DERIVADO de total_value ÷ quantity, arredondado
    -- ao centavo mais próximo (round(numeric, 2), nunca ponto flutuante) —
    -- nunca mais aceito como entrada do chamador (2026-09-05). total_value
    -- é a fonte autoritativa, gravada exatamente como recebida.
    v_unit_value := round(v_total_value / v_quantity, 2);

    -- Trava e confirma que o tipo continua ATIVO — mesma serialização já
    -- usada por create_filament_spool/register_inventory_purchase (FOR
    -- UPDATE na linha do tipo). Nunca cria nem localiza tipo por
    -- Material+Cor+Acabamento.
    perform 1 from public.filament_types where id = v_filament_type_id and is_active for update;
    if not found then
      raise exception 'filament_types.id % não encontrado ou inativo', v_filament_type_id;
    end if;

    insert into public.inventory_purchase_filament_items (
      purchase_id, filament_type_id, manufacturer, nominal_weight_grams, quantity, unit_value, total_value
    ) values (
      v_purchase.id, v_filament_type_id, v_manufacturer, v_nominal, v_quantity, v_unit_value, v_total_value
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

comment on function public.register_filament_purchase(numeric, uuid, jsonb, timestamptz, text, text, text) is
  'Registra uma compra de filamento com UM OU MAIS itens (tipos/marcas diferentes) numa única transação: cria o cabeçalho (inventory_purchases, category=FILAMENT, item_id null, quantity/item_value = totais agregados — item_value = SOMA de total_value dos itens, exata, 2026-09-05 —, freight_value informado uma única vez, purchase_channel obrigatório), um inventory_purchase_filament_items por item (tipo já cadastrado e ATIVO — nunca cria nem localiza por nome — + marca da compra + peso líquido + quantidade + total_value AUTORITATIVO — unit_value é calculado internamente como round(total_value/quantity, 2), nunca aceito do chamador) e N filament_spools por item (vinculados a filament_type_id e a purchase_item_id, sem peso bruto individual — empty_spool_weight_grams/initial_gross_weight_grams ficam null, como um rolo manual), registrando para cada rolo uma entrada PURCHASE via register_filament_movement (saldo inicial = peso líquido nominal). Atômica por construção: qualquer exceção (cabeçalho, item ou rolo) desfaz tudo que a chamada já tinha feito — nunca uma compra parcial. Idempotente quando p_idempotency_key é fornecida, checada antes de qualquer trabalho pesado (compara frete, canal e itens canônicos por total_value). Devolve o jsonb de _build_filament_purchase_summary (cabeçalho + itens + spool_ids por item).';

revoke execute on function public.register_filament_purchase(numeric, uuid, jsonb, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_filament_purchase(numeric, uuid, jsonb, timestamptz, text, text, text)
  to service_role;
