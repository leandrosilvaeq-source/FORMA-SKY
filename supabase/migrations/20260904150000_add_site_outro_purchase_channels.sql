-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- Ajustes finais da área de Filamentos (2026-09-04, rodada seguinte à da
-- janela compacta): dois novos valores de "Local da compra" — Site e Outro.
--
-- AUDITORIA (antes de alterar o CHECK): confirmado via
-- pg_get_constraintdef que `inventory_purchases_purchase_channel_check`
-- (criado em 20260904140000) só aceita os 4 valores anteriores
-- (MERCADO_LIVRE/ALIEXPRESS/SHOPEE/PRESENCIAL) — SITE e OUTRO precisam de
-- migration nova.
--
-- Migration APPEND-ONLY — não edita 20260904140000 nem nenhuma migration
-- anterior. DROP CONSTRAINT + ADD CONSTRAINT no lugar de ALTER COLUMN: troca
-- só a definição do CHECK, nunca reescreve nem apaga nenhuma linha —
-- qualquer compra já registrada com um dos 4 valores antigos continua
-- válida (o novo CHECK é um superconjunto do antigo, nunca um subconjunto).
-- register_filament_purchase ganha os 2 valores na mesma validação inline
-- (CREATE OR REPLACE, MESMA assinatura de 7 argumentos — nenhum parâmetro
-- novo, então nenhum DROP FUNCTION é necessário desta vez).
-- =============================================================================

alter table public.inventory_purchases
  drop constraint inventory_purchases_purchase_channel_check;

alter table public.inventory_purchases
  add constraint inventory_purchases_purchase_channel_check
    check (purchase_channel is null or purchase_channel in (
      'MERCADO_LIVRE', 'ALIEXPRESS', 'SHOPEE', 'PRESENCIAL', 'SITE', 'OUTRO'
    ));

comment on column public.inventory_purchases.purchase_channel is
  'Local/canal onde a compra foi feita (Mercado Livre/AliExpress/Shopee/Presencial/Site/Outro — SITE e OUTRO acrescentados em 2026-09-04, migration 20260904150000) — nullable (null para toda compra ACCESSORY/PACKAGING, para o caminho legado de FILAMENT de item único, e para toda compra registrada antes de purchase_channel existir). Preenchido e obrigatório só via register_filament_purchase (compra de filamento com um ou mais itens) — nunca gravado em notes. Nenhum campo de texto livre adicional para "Outro" nesta rodada.';

-- ---------------------------------------------------------------------------
-- register_filament_purchase — mesma assinatura de 7 argumentos (nenhum
-- parâmetro novo), só o corpo muda (validação de p_purchase_channel aceita
-- os 2 valores novos) — CREATE OR REPLACE, sem DROP FUNCTION.
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
  -- canal + itens canônicos) devolve a compra já registrada; payload
  -- diferente é rejeitado com IDEMPOTENCY_KEY_CONFLICT:.
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
  -- TOTAIS agregados (nº de rolos e subtotal, somados de todos os itens),
  -- nunca os dados de um item específico; item_id fica null (não há um
  -- único item ao qual o cabeçalho aponte quando há mais de um tipo na
  -- mesma compra). freight_value é informado uma única vez aqui — nunca
  -- dividido entre itens/rolos. purchase_channel grava o local/canal da
  -- compra escolhido na interface.
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

comment on function public.register_filament_purchase(numeric, uuid, jsonb, timestamptz, text, text, text) is
  'Registra uma compra de filamento com UM OU MAIS itens (tipos/marcas diferentes) numa única transação: cria o cabeçalho (inventory_purchases, category=FILAMENT, item_id null, quantity/item_value = totais agregados, freight_value informado uma única vez, purchase_channel obrigatório — MERCADO_LIVRE/ALIEXPRESS/SHOPEE/PRESENCIAL/SITE/OUTRO, os 2 últimos acrescentados em 2026-09-04), um inventory_purchase_filament_items por item (tipo já cadastrado e ATIVO — nunca cria nem localiza por nome — + marca da compra + peso líquido + quantidade + valor unitário) e N filament_spools por item (vinculados a filament_type_id e a purchase_item_id, sem peso bruto individual — empty_spool_weight_grams/initial_gross_weight_grams ficam null, como um rolo manual), registrando para cada rolo uma entrada PURCHASE via register_filament_movement (saldo inicial = peso líquido nominal). Atômica por construção: qualquer exceção (cabeçalho, item ou rolo) desfaz tudo que a chamada já tinha feito — nunca uma compra parcial. Idempotente quando p_idempotency_key é fornecida, checada antes de qualquer trabalho pesado (compara frete, canal e itens canônicos). Devolve o jsonb de _build_filament_purchase_summary (cabeçalho + itens + spool_ids por item).';

revoke execute on function public.register_filament_purchase(numeric, uuid, jsonb, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_filament_purchase(numeric, uuid, jsonb, timestamptz, text, text, text)
  to service_role;
