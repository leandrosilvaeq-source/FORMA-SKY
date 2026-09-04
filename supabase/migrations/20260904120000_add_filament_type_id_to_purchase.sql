-- =============================================================================
-- Forma Sky — Módulo 3 (Estoque e Inventário)
-- Revisão do fluxo de Filamentos (2026-09-04): "Cadastrar tipo -> Registrar
-- compra -> Rolos atualizados". A janela de Compras deixa de pedir
-- Material/Marca/Cor/Acabamento separados e passa a exigir um tipo de
-- filamento JÁ CADASTRADO (filament_type_id) — a compra nunca mais cria nem
-- localiza um tipo por comparação textual.
--
-- Migration APPEND-ONLY — não altera nenhuma migration anterior.
-- register_inventory_purchase ganha um novo parâmetro OPCIONAL
-- p_filament_type_id (default null), acrescentado ao FINAL da lista de
-- parâmetros. O caminho antigo (find-or-create por
-- material+fabricante+linha+cor normalizados) é PRESERVADO integralmente
-- para compatibilidade com qualquer chamador que ainda não informe
-- p_filament_type_id — nenhum registro histórico é afetado, nenhuma regra
-- de negócio anterior foi enfraquecida.
--
-- Como adicionar um parâmetro muda a lista de tipos da função (mesmo com
-- default), CREATE OR REPLACE por si só criaria uma SEGUNDA sobrecarga
-- (15 args) ao lado da nova (16 args) em vez de substituí-la — ambígua para
-- chamadas com um subconjunto de argumentos nomeados que caiba nas duas
-- (ex.: uma compra de ACESSÓRIO/EMBALAGEM, que nunca usa os campos de
-- filamento). Por isso a assinatura antiga é DROPADA explicitamente antes
-- de recriar a função com a assinatura nova — mesmo padrão já usado para
-- remove_filament_type (migration 20260903130000).
-- =============================================================================

drop function if exists public.register_inventory_purchase(
  text, integer, numeric, numeric, uuid, timestamptz, text, text, uuid, text, text, text, text, numeric, numeric[]
);

create or replace function public.register_inventory_purchase(
  p_category text,
  p_quantity integer,
  p_item_value numeric,
  p_freight_value numeric,
  p_changed_by uuid,
  p_occurred_at timestamptz default now(),
  p_notes text default null,
  p_idempotency_key text default null,
  -- ACCESSORY/PACKAGING: item já cadastrado e ativo.
  p_item_id uuid default null,
  -- FILAMENT (caminho LEGADO, preservado): dados para localizar/criar o
  -- filament_type + criar os rolos. Só usado quando p_filament_type_id é
  -- null.
  p_material text default null,
  p_manufacturer text default null,
  p_line text default null,
  p_commercial_color text default null,
  p_nominal_weight_grams numeric default null,
  -- Um peso bruto por rolo, na mesma ordem — comprimento deve ser
  -- exatamente p_quantity.
  p_gross_weights_grams numeric[] default null,
  -- FILAMENT (caminho NOVO, 2026-09-04): identifica diretamente um tipo já
  -- cadastrado em Estoque -> Filamentos. Quando informado, os 4 campos
  -- legados acima devem ficar todos null — a compra NUNCA cria nem localiza
  -- tipo por nome quando um ID já foi escolhido pela interface.
  p_filament_type_id uuid default null
)
returns public.inventory_purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_freight numeric;
  v_manufacturer text;
  v_line text;
  v_commercial_color text;
  v_filament_type public.filament_types;
  v_item_id uuid;
  v_purchase public.inventory_purchases;
  v_existing public.inventory_purchases;
  v_spool_id uuid;
  v_gross numeric;
  v_tare numeric;
  v_code text;
  v_nested_key text;
  i integer;
begin
  perform public.assert_active_user(p_changed_by);

  if p_category not in ('FILAMENT', 'ACCESSORY', 'PACKAGING') then
    raise exception 'inventory_purchases.category inválido: % (esperado FILAMENT, ACCESSORY ou PACKAGING)', p_category;
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'register_inventory_purchase: p_quantity deve ser um inteiro positivo (recebido %)', p_quantity;
  end if;

  if p_item_value is null or p_item_value < 0 then
    raise exception 'register_inventory_purchase: p_item_value não pode ser negativo (recebido %)', p_item_value;
  end if;

  v_freight := coalesce(p_freight_value, 0);
  if v_freight < 0 then
    raise exception 'register_inventory_purchase: p_freight_value não pode ser negativo (recebido %)', p_freight_value;
  end if;

  -- Idempotência checada primeiro — ver nota de concorrência no cabeçalho
  -- da migration 20260828121000. p_item_id só é comparado para ACCESSORY/
  -- PACKAGING (para FILAMENT o item ainda não foi resolvido neste ponto);
  -- category+quantity+item_value+freight_value já são um payload
  -- suficientemente específico para o caso real de retry (duplo clique/
  -- timeout), mesmo critério pragmático de "occurred_at fica de fora" já
  -- usado em register_stock_movement/register_filament_movement.
  if p_idempotency_key is not null then
    select * into v_existing from public.inventory_purchases where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.category = p_category
         and v_existing.quantity = p_quantity
         and v_existing.item_value = p_item_value
         and v_existing.freight_value = v_freight
         and (p_category = 'FILAMENT' or v_existing.item_id = p_item_id)
      then
        return v_existing;
      else
        raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
      end if;
    end if;
  end if;

  -- ACCESSORY / PACKAGING ---------------------------------------------------
  if p_category in ('ACCESSORY', 'PACKAGING') then
    if p_item_id is null then
      raise exception 'register_inventory_purchase: p_item_id é obrigatório para categoria %', p_category;
    end if;

    if p_category = 'ACCESSORY' then
      perform 1 from public.accessories where id = p_item_id and is_active for update;
    else
      perform 1 from public.packaging where id = p_item_id and is_active for update;
    end if;

    if not found then
      raise exception 'INVENTORY_PURCHASE_ITEM_INACTIVE: item de id % não encontrado ou inativo para categoria % — cadastre-o ou reative-o na aba correspondente antes de comprar.', p_item_id, p_category;
    end if;

    insert into public.inventory_purchases (
      category, item_id, quantity, item_value, freight_value, occurred_at, notes, idempotency_key, created_by
    ) values (
      p_category, p_item_id, p_quantity, p_item_value, v_freight, coalesce(p_occurred_at, now()),
      nullif(btrim(coalesce(p_notes, '')), ''), p_idempotency_key, p_changed_by
    )
    returning * into v_purchase;

    -- Reaproveita register_stock_movement integralmente (já valida item
    -- ativo de novo, já trava a linha, já atualiza current_stock na mesma
    -- transação) — nenhuma lógica de saldo duplicada aqui.
    perform public.register_stock_movement(
      p_category, p_item_id, 'PURCHASE', p_quantity::numeric, p_changed_by,
      null, p_occurred_at, 'PURCHASE', v_purchase.id,
      case when p_idempotency_key is not null then p_idempotency_key || ':movement' else null end
    );

    return v_purchase;
  end if;

  -- FILAMENT -----------------------------------------------------------------
  -- Identidade do tipo: OU um filament_type_id já cadastrado (caminho novo,
  -- "Cadastrar tipo -> Registrar compra"), OU os 4 campos legados
  -- (material/fabricante/linha/cor) para find-or-create por nome — nunca os
  -- dois ao mesmo tempo (defesa em profundidade; a Edge Function já valida
  -- isso antes de chamar a RPC).
  if p_filament_type_id is not null then
    if p_material is not null or p_manufacturer is not null or p_line is not null or p_commercial_color is not null then
      raise exception 'register_inventory_purchase: informe p_filament_type_id OU material/manufacturer/line/commercial_color, nunca os dois';
    end if;
  else
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
  end if;

  if p_nominal_weight_grams is null or p_nominal_weight_grams <= 0 then
    raise exception 'filament_spools.nominal_weight_grams deve ser um número positivo (recebido %)', p_nominal_weight_grams;
  end if;

  if p_gross_weights_grams is null or array_length(p_gross_weights_grams, 1) is distinct from p_quantity then
    raise exception 'register_inventory_purchase: informe exatamente % peso(s) bruto(s) (um por rolo) — recebido %', p_quantity, coalesce(array_length(p_gross_weights_grams, 1), 0);
  end if;

  for i in 1..p_quantity loop
    if p_gross_weights_grams[i] is null or p_gross_weights_grams[i] <= p_nominal_weight_grams then
      raise exception 'register_inventory_purchase: peso bruto do rolo % deve ser maior que o peso líquido nominal (%) — recebido %', i, p_nominal_weight_grams, p_gross_weights_grams[i];
    end if;
  end loop;

  if p_filament_type_id is not null then
    -- Caminho novo: identidade já resolvida pela interface — só valida que
    -- o tipo existe e está ATIVO (nunca reativa nem cria nada aqui).
    select * into v_filament_type
      from public.filament_types
      where id = p_filament_type_id and is_active
      for update;

    if not found then
      raise exception 'filament_types.id % não encontrado ou inativo', p_filament_type_id;
    end if;

    v_item_id := v_filament_type.id;
  else
    -- Caminho legado: find-or-create normalizado (case-insensitive, trim) —
    -- nunca cria duplicata só por diferença de maiúsculas/espaços. order by
    -- created_at + limit 1: se algum dia existir mais de uma correspondência
    -- normalizada (duplicata legada, criada manualmente antes deste
    -- incremento), a mais antiga é reaproveitada de forma determinística,
    -- sem erro de "múltiplas linhas" — mesclar duplicatas legadas fica fora
    -- de escopo aqui.
    select * into v_filament_type
      from public.filament_types
      where material = p_material
        and lower(btrim(manufacturer)) = lower(v_manufacturer)
        and lower(btrim(line)) = lower(v_line)
        and lower(btrim(commercial_color)) = lower(v_commercial_color)
      order by created_at
      limit 1
      for update;

    if found then
      if not v_filament_type.is_active then
        raise exception 'FILAMENT_TYPE_INACTIVE_MATCH: já existe um tipo de filamento inativo com % / % / % / % — reative-o na listagem de Filamentos ou ajuste marca/acabamento/cor antes de comprar.',
          p_material, v_manufacturer, v_line, v_commercial_color;
      end if;
      v_item_id := v_filament_type.id;
    else
      -- color_code sempre null: uma compra nunca exige nem inventa um
      -- código de cor (requisito 2 do pedido do Incremento 5).
      v_filament_type := public.create_filament_type(
        p_material, v_manufacturer, v_line, v_commercial_color, null, null, true, null, p_changed_by
      );
      v_item_id := v_filament_type.id;
    end if;
  end if;

  insert into public.inventory_purchases (
    category, item_id, quantity, item_value, freight_value, occurred_at, notes, idempotency_key, created_by
  ) values (
    'FILAMENT', v_item_id, p_quantity, p_item_value, v_freight, coalesce(p_occurred_at, now()),
    nullif(btrim(coalesce(p_notes, '')), ''), p_idempotency_key, p_changed_by
  )
  returning * into v_purchase;

  for i in 1..p_quantity loop
    v_gross := p_gross_weights_grams[i];
    v_tare := v_gross - p_nominal_weight_grams;
    v_code := public.next_filament_spool_code();

    insert into public.filament_spools (
      code, filament_type_id, nominal_weight_grams, empty_spool_weight_grams,
      initial_gross_weight_grams, purchase_id, received_at, status, is_active
    ) values (
      v_code, v_item_id, p_nominal_weight_grams, v_tare,
      v_gross, v_purchase.id, coalesce(p_occurred_at, now())::date, 'LACRADO', true
    )
    returning id into v_spool_id;

    v_nested_key := case when p_idempotency_key is not null then p_idempotency_key || ':spool:' || i::text else null end;

    -- Reaproveita register_filament_movement integralmente (já valida rolo/
    -- teto nominal, já trava a linha, já atualiza current_net_weight_grams/
    -- status na mesma transação) — saldo disponível inicial = peso líquido
    -- nominal, nunca escrito diretamente.
    perform public.register_filament_movement(
      v_spool_id, 'PURCHASE', p_nominal_weight_grams, p_changed_by,
      null, p_occurred_at, 'PURCHASE', v_purchase.id, v_nested_key
    );
  end loop;

  return v_purchase;
end;
$$;

comment on function public.register_inventory_purchase(
  text, integer, numeric, numeric, uuid, timestamptz, text, text, uuid, text, text, text, text, numeric, numeric[], uuid
) is
  'Única função que grava public.inventory_purchases. Para ACCESSORY/PACKAGING: valida item ativo e reaproveita register_stock_movement (PURCHASE) para o movimento/saldo. Para FILAMENT: identifica o filament_type por p_filament_type_id (caminho novo, 2026-09-04 — exige tipo já cadastrado e ATIVO, nunca cria nem localiza por nome) OU, quando p_filament_type_id é null, pelo caminho legado de find-or-create por material+fabricante+linha+cor normalizados (nunca reativa um tipo inativo em silêncio — FILAMENT_TYPE_INACTIVE_MATCH:); cria N filament_spools (status LACRADO, is_active=true, empty_spool_weight_grams=tara estimada, initial_gross_weight_grams=peso bruto informado, purchase_id vinculado) e registra, para cada rolo, uma entrada PURCHASE via register_filament_movement (saldo inicial = peso líquido nominal). Toda a operação é uma única transação Postgres: qualquer exceção desfaz tudo — se um rolo falhar, a compra e todos os rolos já criados nesta chamada são revertidos, nunca uma compra parcial. Idempotente quando p_idempotency_key é fornecida, checada antes de qualquer trabalho pesado.';

revoke execute on function public.register_inventory_purchase(
  text, integer, numeric, numeric, uuid, timestamptz, text, text, uuid, text, text, text, text, numeric, numeric[], uuid
) from public, anon, authenticated;
grant execute on function public.register_inventory_purchase(
  text, integer, numeric, numeric, uuid, timestamptz, text, text, uuid, text, text, text, text, numeric, numeric[], uuid
) to service_role;
