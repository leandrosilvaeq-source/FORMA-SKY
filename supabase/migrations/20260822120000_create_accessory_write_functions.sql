-- Bloco 1 — Módulo 3 (Estoque), Incremento 2 do plano aprovado em
-- 2026-08-22 (docs/05_ROADMAP_MODULOS.md §9; docs/03_MODELO_BANCO_DADOS.md
-- §13.3) — backend protegido do cadastro mestre de Acessórios.
--
-- Decisão de arquitetura aprovada nesta rodada: TODAS as escritas de
-- accessories passam a exigir a Edge Function `accessories`
-- (supabase/functions/accessories/index.ts) via as 3 functions abaixo —
-- nunca mais um INSERT/UPDATE direto de `authenticated`. Mesmo padrão já
-- usado por create_product/update_product_price/set_product_composition
-- (20260814030351_create_order_business_functions.sql,
-- 20260816150500_create_product_composition_function.sql): security
-- definer, search_path = '', EXECUTE só para service_role.
--
-- packaging NÃO é alterado por esta migration — escopo desta etapa é só
-- Acessórios (Incremento 3, futuro, fará o espelho para packaging).

-- ---------------------------------------------------------------------------
-- Revogação de escrita direta em accessories
-- ---------------------------------------------------------------------------
-- Migration 18 (20260816150000_create_accessories_packaging_and_composition_tables.sql)
-- concedeu INSERT e UPDATE(name, material, size, variant, unit_cost,
-- minimum_stock, is_active) a `authenticated` como antecipação mínima — na
-- época nenhuma Edge Function existia ainda para este cadastro. Com o
-- backend protegido agora implementado, mantemos só SELECT (necessário à
-- listagem/ProductCompositionForm; RLS "Active users can view accessories"
-- inalterada) e revogamos INSERT/UPDATE diretos — toda escrita passa a
-- exigir create_accessory/update_accessory/delete_accessory abaixo,
-- chamadas exclusivamente pela Edge Function (service_role). DELETE nunca
-- foi concedido a `authenticated` (Migration 18) e continua sem ser
-- concedido. packaging mantém seus grants originais intactos (fora do
-- escopo desta migration).
revoke insert on public.accessories from authenticated;
revoke update on public.accessories from authenticated;

-- ---------------------------------------------------------------------------
-- create_accessory
-- ---------------------------------------------------------------------------
-- Enum de size (PP/P/M/G/GG ou null) validado aqui como segunda camada de
-- defesa — a Edge Function já valida antes de chamar esta function; nenhum
-- CHECK constraint foi criado na tabela (docs/03_MODELO_BANCO_DADOS.md
-- §13.3: decisão explícita de não travar valores legados fora do enum na
-- própria coluna). material/unit_cost/current_stock nunca são parâmetros
-- desta função: material fica null (nunca gravado por esta interface),
-- unit_cost fica null (dependerá de compras/entradas futuras, ainda não
-- implementadas), current_stock fica no default 0 da tabela (Migration 18).
--
-- Invariantes de defesa em profundidade (rodada corretiva): esta function é
-- SECURITY DEFINER com EXECUTE concedido a service_role — precisa manter
-- suas próprias invariantes mesmo se chamada diretamente (fora da Edge
-- Function, que já valida tudo isso antes). name não-vazio é checado aqui
-- explicitamente porque NOT NULL sozinho não barra ''  (string vazia não é
-- SQL NULL). minimum_stock >= 0 NÃO precisa de checagem redundante aqui:
-- já é garantido pela CHECK da própria tabela (Migration 18) — mesmo
-- critério já usado em create_product (Migration 15) para default_price
-- >= 0, que também confia só na CHECK da tabela.
create or replace function public.create_accessory(
  p_name text,
  p_size text,
  p_variant text,
  p_minimum_stock integer,
  p_is_active boolean,
  p_changed_by uuid
)
returns public.accessories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_row public.accessories;
begin
  perform public.assert_active_user(p_changed_by);

  v_name := btrim(p_name);
  if p_name is null or v_name = '' then
    raise exception 'accessories.name não pode ser vazio nem null';
  end if;

  if p_size is not null and p_size not in ('PP', 'P', 'M', 'G', 'GG') then
    raise exception 'accessories.size inválido: % (esperado PP, P, M, G, GG ou null)', p_size;
  end if;

  insert into public.accessories (name, size, variant, minimum_stock, is_active)
  values (v_name, p_size, p_variant, p_minimum_stock, coalesce(p_is_active, true))
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_accessory(text, text, text, integer, boolean, uuid) is
  'Cria um acessório do cadastro mestre (docs/03_MODELO_BANCO_DADOS.md §13.3). material/unit_cost/current_stock nunca são parâmetros desta função.';

revoke execute on function public.create_accessory(text, text, text, integer, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.create_accessory(text, text, text, integer, boolean, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- update_accessory
-- ---------------------------------------------------------------------------
-- Semântica PATCH via jsonb_whitelist + CASE WHEN <chave> ? — mesmo idioma
-- de update_order_item (20260814030351_create_order_business_functions.sql):
-- chave ausente em p_patch preserva o valor atual da coluna (inclusive um
-- `size` legado fora do enum PP/P/M/G/GG, nunca revalidado quando não
-- enviado); chave presente é validada e aplicada. is_active é só mais uma
-- chave deste mesmo patch — ativar/desativar não tem contrato redundante.
--
-- Invariantes de defesa em profundidade (rodada corretiva) — diferente de
-- update_order_item, que confia só na Edge Function para rejeitar chave
-- desconhecida (jsonb_whitelist ali só FILTRA, nunca rejeita), esta function
-- é nova e decide não repetir essa lacuna: chave fora da whitelist é
-- REJEITADA aqui (não só silenciosamente descartada), e p_patch nulo/vazio/
-- só-com-chaves-desconhecidas nunca vira um UPDATE "vazio" silencioso. name
-- vazio é rejeitado explicitamente pelo mesmo motivo de create_accessory
-- (NOT NULL não barra ''). is_active null explícito é rejeitado pela
-- própria constraint NOT NULL da coluna (23502, mapeado por
-- _shared/errors.ts) quando a chave é enviada com valor null — não precisa
-- de checagem redundante aqui. minimum_stock negativo é rejeitado pela
-- CHECK da tabela (Migration 18) na própria UPDATE, mesmo raciocínio.
create or replace function public.update_accessory(
  p_accessory_id uuid,
  p_patch jsonb,
  p_changed_by uuid
)
returns public.accessories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patch jsonb;
  v_unknown_keys text[];
  v_size text;
  v_name text;
  v_row public.accessories;
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.accessories where id = p_accessory_id for update;
  if not found then
    raise exception 'accessories.id % não encontrado', p_accessory_id;
  end if;

  -- Chave fora da whitelist é REJEITADA, não só removida por
  -- jsonb_whitelist (que só filtra) — evita que um payload malformado
  -- pareça ter sido aplicado quando na verdade foi ignorado em silêncio.
  select array_agg(key) into v_unknown_keys
    from jsonb_each(coalesce(p_patch, '{}'::jsonb))
    where key <> all(array['name', 'size', 'variant', 'minimum_stock', 'is_active']);

  if v_unknown_keys is not null and array_length(v_unknown_keys, 1) > 0 then
    raise exception 'update_accessory: chave(s) não suportada(s) em p_patch: %', array_to_string(v_unknown_keys, ', ');
  end if;

  v_patch := public.jsonb_whitelist(p_patch, array['name', 'size', 'variant', 'minimum_stock', 'is_active']);

  -- p_patch nulo, '{}' ou só com chaves já rejeitadas acima nunca chega
  -- vivo até aqui como "vazio" silencioso — sempre uma exceção clara.
  if v_patch = '{}'::jsonb then
    raise exception 'update_accessory: p_patch vazio, informe ao menos um campo reconhecido';
  end if;

  if v_patch ? 'name' then
    v_name := btrim(v_patch ->> 'name');
    if v_name is null or v_name = '' then
      raise exception 'accessories.name não pode ser vazio nem null';
    end if;
  end if;

  if v_patch ? 'size' then
    v_size := v_patch ->> 'size';
    if v_size is not null and v_size not in ('PP', 'P', 'M', 'G', 'GG') then
      raise exception 'accessories.size inválido: % (esperado PP, P, M, G, GG ou null)', v_size;
    end if;
  end if;

  update public.accessories
    set name = case when v_patch ? 'name' then v_name else name end,
        size = case when v_patch ? 'size' then v_patch ->> 'size' else size end,
        variant = case when v_patch ? 'variant' then v_patch ->> 'variant' else variant end,
        minimum_stock = case when v_patch ? 'minimum_stock'
                           then nullif(v_patch ->> 'minimum_stock', '')::integer
                           else minimum_stock end,
        is_active = case when v_patch ? 'is_active' then (v_patch ->> 'is_active')::boolean else is_active end
    where id = p_accessory_id
    returning * into v_row;

  return v_row;
end;
$$;

comment on function public.update_accessory(uuid, jsonb, uuid) is
  'Edita um acessório do cadastro mestre e/ou ativa/desativa (is_active é só mais uma chave do mesmo patch). Chave ausente em p_patch preserva o valor atual, inclusive size legado fora de PP/P/M/G/GG.';

revoke execute on function public.update_accessory(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.update_accessory(uuid, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- delete_accessory — exclusão física protegida
-- ---------------------------------------------------------------------------
-- Exclusão física só quando o acessório nunca foi utilizado (nenhuma linha
-- em product_accessories) — bloqueada com erro de negócio reconhecível
-- (RAISE_EXCEPTION_PATTERNS, supabase/functions/_shared/errors.ts, marcador
-- estável ACCESSORY_IN_USE: — ver abaixo) quando houver vínculo; a mensagem
-- de bloqueio NUNCA remove o vínculo nem executa cascata —
-- product_accessories permanece intacta em qualquer caso.
--
-- NOTA (Módulo 3, fase de estoque real, ainda não implementada): quando
-- stock_movements/stock_reservations existirem (hoje não existem — nenhuma
-- migration as criou ainda), esta function deverá também verificar vínculos
-- nessas tabelas antes de permitir a exclusão física. Não presumimos aqui
-- que essas tabelas já existem.
--
-- CONCORRÊNCIA — por que `for update` na linha de accessories basta, sem
-- precisar travar product_accessories nem a tabela inteira: inserir uma
-- linha em product_accessories que referencia accessory_id exige, pela
-- própria checagem de integridade referencial do Postgres, um lock no
-- mínimo FOR KEY SHARE sobre a linha REFERENCIADA de accessories (é assim
-- que o Postgres impede a linha pai de ser apagada enquanto uma FK está
-- sendo validada contra ela — não precisa travar a tabela product_accessories
-- para isso). FOR KEY SHARE conflita com FOR UPDATE (o lock que esta
-- function já segura). Logo, nas duas ordens possíveis:
--   (a) esta transação chega primeiro: o FOR UPDATE abaixo é obtido antes
--       de qualquer INSERT concorrente em product_accessories conseguir seu
--       FOR KEY SHARE — o INSERT concorrente BLOQUEIA até este COMMIT/
--       ROLLBACK, então o `exists (...)` abaixo nunca vê um vínculo que
--       ainda "vai" existir;
--   (b) o INSERT concorrente chega primeiro: ele já segura o FOR KEY SHARE
--       quando este `for update` tenta entrar — esta transação BLOQUEIA até
--       o INSERT concorrente commitar (ou desfazer), e só então enxerga o
--       vínculo já real (ou a ausência dele, se desfeito) antes de decidir
--       excluir.
-- Em nenhuma das duas ordens as duas transações avançam além do ponto de
-- decisão em paralelo sobre a mesma linha — verificação e exclusão
-- permanecem atômicas entre si sem precisar de um lock mais amplo.
create or replace function public.delete_accessory(
  p_accessory_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.accessories where id = p_accessory_id for update;
  if not found then
    raise exception 'accessories.id % não encontrado', p_accessory_id;
  end if;

  if exists (select 1 from public.product_accessories where accessory_id = p_accessory_id) then
    raise exception 'ACCESSORY_IN_USE: Este acessório está vinculado a um produto e não pode ser excluído. Desative o item.';
  end if;

  delete from public.accessories where id = p_accessory_id;
end;
$$;

comment on function public.delete_accessory(uuid, uuid) is
  'Exclusão física protegida de um acessório: só permitida quando nenhuma linha de product_accessories referencia este id. Nenhuma exclusão em cascata — o vínculo nunca é removido por esta function. Bloqueio levanta ACCESSORY_IN_USE: <mensagem amigável>, marcador estável reconhecido por _shared/errors.ts (mapeado para 409, mensagem exibida sem o prefixo), orientando desativação em vez de exclusão.';

revoke execute on function public.delete_accessory(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_accessory(uuid, uuid)
  to service_role;
