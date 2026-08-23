-- Bloco 1 — Módulo 3 (Estoque), Incremento 3 do plano aprovado em
-- 2026-08-22 (docs/05_ROADMAP_MODULOS.md §9) — backend protegido do
-- cadastro mestre de Embalagens. Espelha integralmente
-- 20260822120000_create_accessory_write_functions.sql (Incremento 2,
-- Acessórios) — `packaging` tem exatamente a mesma estrutura de
-- `accessories` (mesmas colunas/tipos/constraints/grants originais,
-- confirmado por leitura da Migration 18), então as 3 functions abaixo
-- reproduzem create_accessory/update_accessory/delete_accessory ponto a
-- ponto, só trocando a tabela/coluna de vínculo (product_packaging.
-- packaging_id em vez de product_accessories.accessory_id).
--
-- Migration independente: não altera
-- 20260822120000_create_accessory_write_functions.sql nem nenhuma function
-- de accessories.

-- ---------------------------------------------------------------------------
-- Revogação de escrita direta em packaging
-- ---------------------------------------------------------------------------
-- Migration 18 concedeu INSERT e UPDATE(name, material, size, variant,
-- unit_cost, minimum_stock, is_active) a `authenticated` como antecipação
-- mínima — mesma decisão histórica de accessories, nunca revogada até
-- agora porque nenhuma Edge Function existia para packaging. Mantemos só
-- SELECT (necessário à listagem/ProductCompositionForm; RLS "Active users
-- can view packaging" inalterada) e revogamos INSERT/UPDATE diretos — toda
-- escrita passa a exigir create_packaging/update_packaging/delete_packaging
-- abaixo, chamadas exclusivamente pela Edge Function (service_role). DELETE
-- nunca foi concedido a `authenticated` (Migration 18) e continua sem ser
-- concedido. accessories mantém seus grants (já revogados na Migration
-- 20260822120000) intactos — fora do escopo desta migration.
revoke insert on public.packaging from authenticated;
revoke update on public.packaging from authenticated;

-- ---------------------------------------------------------------------------
-- create_packaging
-- ---------------------------------------------------------------------------
-- Enum de size (PP/P/M/G/GG ou null) validado aqui como segunda camada de
-- defesa — a Edge Function já valida antes de chamar esta function; nenhum
-- CHECK constraint foi criado na tabela (mesma decisão de accessories: não
-- travar valores legados fora do enum na própria coluna).
-- material/unit_cost/current_stock nunca são parâmetros desta função:
-- material fica null (nunca gravado por esta interface), unit_cost fica
-- null (dependerá de compras/entradas futuras, ainda não implementadas),
-- current_stock fica no default 0 da tabela (Migration 18).
--
-- Invariantes de defesa em profundidade (mesmo padrão de create_accessory):
-- esta function é SECURITY DEFINER com EXECUTE concedido a service_role —
-- precisa manter suas próprias invariantes mesmo se chamada diretamente
-- (fora da Edge Function, que já valida tudo isso antes). name não-vazio é
-- checado aqui explicitamente porque NOT NULL sozinho não barra '' (string
-- vazia não é SQL NULL). minimum_stock >= 0 NÃO precisa de checagem
-- redundante aqui: já é garantido pela CHECK da própria tabela
-- (Migration 18).
create or replace function public.create_packaging(
  p_name text,
  p_size text,
  p_variant text,
  p_minimum_stock integer,
  p_is_active boolean,
  p_changed_by uuid
)
returns public.packaging
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_row public.packaging;
begin
  perform public.assert_active_user(p_changed_by);

  v_name := btrim(p_name);
  if p_name is null or v_name = '' then
    raise exception 'packaging.name não pode ser vazio nem null';
  end if;

  if p_size is not null and p_size not in ('PP', 'P', 'M', 'G', 'GG') then
    raise exception 'packaging.size inválido: % (esperado PP, P, M, G, GG ou null)', p_size;
  end if;

  insert into public.packaging (name, size, variant, minimum_stock, is_active)
  values (v_name, p_size, p_variant, p_minimum_stock, coalesce(p_is_active, true))
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_packaging(text, text, text, integer, boolean, uuid) is
  'Cria uma embalagem do cadastro mestre (espelha create_accessory). material/unit_cost/current_stock nunca são parâmetros desta função.';

revoke execute on function public.create_packaging(text, text, text, integer, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.create_packaging(text, text, text, integer, boolean, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- update_packaging
-- ---------------------------------------------------------------------------
-- Semântica PATCH via jsonb_whitelist + CASE WHEN <chave> ? — mesmo idioma
-- de update_accessory/update_order_item: chave ausente em p_patch preserva
-- o valor atual da coluna (inclusive um `size` legado fora do enum
-- PP/P/M/G/GG, nunca revalidado quando não enviado); chave presente é
-- validada e aplicada. is_active é só mais uma chave deste mesmo patch —
-- ativar/desativar não tem contrato redundante.
--
-- Invariantes de defesa em profundidade (mesmo padrão de update_accessory):
-- chave fora da whitelist é REJEITADA aqui (não só silenciosamente
-- descartada por jsonb_whitelist, que só filtra), e p_patch nulo/vazio/
-- só-com-chaves-desconhecidas nunca vira um UPDATE "vazio" silencioso. name
-- vazio é rejeitado explicitamente pelo mesmo motivo de create_packaging
-- (NOT NULL não barra ''). is_active null explícito é rejeitado pela
-- própria constraint NOT NULL da coluna (23502, mapeado por
-- _shared/errors.ts) quando a chave é enviada com valor null — não precisa
-- de checagem redundante aqui. minimum_stock negativo é rejeitado pela
-- CHECK da tabela (Migration 18) na própria UPDATE, mesmo raciocínio.
create or replace function public.update_packaging(
  p_packaging_id uuid,
  p_patch jsonb,
  p_changed_by uuid
)
returns public.packaging
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patch jsonb;
  v_unknown_keys text[];
  v_size text;
  v_name text;
  v_row public.packaging;
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.packaging where id = p_packaging_id for update;
  if not found then
    raise exception 'packaging.id % não encontrado', p_packaging_id;
  end if;

  -- Chave fora da whitelist é REJEITADA, não só removida por
  -- jsonb_whitelist (que só filtra) — evita que um payload malformado
  -- pareça ter sido aplicado quando na verdade foi ignorado em silêncio.
  select array_agg(key) into v_unknown_keys
    from jsonb_each(coalesce(p_patch, '{}'::jsonb))
    where key <> all(array['name', 'size', 'variant', 'minimum_stock', 'is_active']);

  if v_unknown_keys is not null and array_length(v_unknown_keys, 1) > 0 then
    raise exception 'update_packaging: chave(s) não suportada(s) em p_patch: %', array_to_string(v_unknown_keys, ', ');
  end if;

  v_patch := public.jsonb_whitelist(p_patch, array['name', 'size', 'variant', 'minimum_stock', 'is_active']);

  -- p_patch nulo, '{}' ou só com chaves já rejeitadas acima nunca chega
  -- vivo até aqui como "vazio" silencioso — sempre uma exceção clara.
  if v_patch = '{}'::jsonb then
    raise exception 'update_packaging: p_patch vazio, informe ao menos um campo reconhecido';
  end if;

  if v_patch ? 'name' then
    v_name := btrim(v_patch ->> 'name');
    if v_name is null or v_name = '' then
      raise exception 'packaging.name não pode ser vazio nem null';
    end if;
  end if;

  if v_patch ? 'size' then
    v_size := v_patch ->> 'size';
    if v_size is not null and v_size not in ('PP', 'P', 'M', 'G', 'GG') then
      raise exception 'packaging.size inválido: % (esperado PP, P, M, G, GG ou null)', v_size;
    end if;
  end if;

  update public.packaging
    set name = case when v_patch ? 'name' then v_name else name end,
        size = case when v_patch ? 'size' then v_patch ->> 'size' else size end,
        variant = case when v_patch ? 'variant' then v_patch ->> 'variant' else variant end,
        minimum_stock = case when v_patch ? 'minimum_stock'
                           then nullif(v_patch ->> 'minimum_stock', '')::integer
                           else minimum_stock end,
        is_active = case when v_patch ? 'is_active' then (v_patch ->> 'is_active')::boolean else is_active end
    where id = p_packaging_id
    returning * into v_row;

  return v_row;
end;
$$;

comment on function public.update_packaging(uuid, jsonb, uuid) is
  'Edita uma embalagem do cadastro mestre e/ou ativa/desativa (is_active é só mais uma chave do mesmo patch). Chave ausente em p_patch preserva o valor atual, inclusive size legado fora de PP/P/M/G/GG.';

revoke execute on function public.update_packaging(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.update_packaging(uuid, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- delete_packaging — exclusão física protegida
-- ---------------------------------------------------------------------------
-- Exclusão física só quando a embalagem nunca foi utilizada (nenhuma linha
-- em product_packaging) — bloqueada com erro de negócio reconhecível
-- (RAISE_EXCEPTION_PATTERNS, supabase/functions/_shared/errors.ts, marcador
-- estável PACKAGING_IN_USE: — ver abaixo) quando houver vínculo; a
-- mensagem de bloqueio NUNCA remove o vínculo nem executa cascata —
-- product_packaging permanece intacta em qualquer caso. Confirmação nunca é
-- confiada como regra de segurança do lado do backend: quem decide bloquear
-- é exclusivamente esta function, independente de qualquer confirmação que
-- o frontend venha a pedir depois.
--
-- NOTA (Módulo 3, fase de estoque real, ainda não implementada): quando
-- stock_movements/stock_reservations existirem (hoje não existem — nenhuma
-- migration as criou ainda), esta function deverá também verificar vínculos
-- nessas tabelas antes de permitir a exclusão física. Não presumimos aqui
-- que essas tabelas já existem.
--
-- CONCORRÊNCIA — mesma análise já validada em delete_accessory, agora
-- confirmada para as FKs reais de Embalagens: product_packaging.packaging_id
-- referencia packaging.id (Migration 18) com a mesma semântica de
-- integridade referencial usada por product_accessories.accessory_id. Um
-- INSERT concorrente em product_packaging (via set_product_composition)
-- exige, pela própria checagem de FK do Postgres, um lock no mínimo
-- FOR KEY SHARE sobre a linha REFERENCIADA de packaging — que conflita com
-- o FOR UPDATE que esta function já segura abaixo. Logo, nas duas ordens
-- possíveis:
--   (a) esta transação chega primeiro: o FOR UPDATE é obtido antes de
--       qualquer INSERT concorrente conseguir seu FOR KEY SHARE — o INSERT
--       concorrente BLOQUEIA até este COMMIT/ROLLBACK, então o
--       `exists (...)` abaixo nunca vê um vínculo que ainda "vai" existir;
--   (b) o INSERT concorrente chega primeiro: ele já segura o FOR KEY SHARE
--       quando este `for update` tenta entrar — esta transação BLOQUEIA até
--       o INSERT concorrente commitar (ou desfazer), e só então enxerga o
--       vínculo já real antes de decidir excluir.
-- Nenhum lock de tabela inteira é necessário — o lock de linha já basta,
-- porque é exatamente o mesmo mecanismo de FK que o Postgres já aplica.
create or replace function public.delete_packaging(
  p_packaging_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_user(p_changed_by);

  perform 1 from public.packaging where id = p_packaging_id for update;
  if not found then
    raise exception 'packaging.id % não encontrado', p_packaging_id;
  end if;

  if exists (select 1 from public.product_packaging where packaging_id = p_packaging_id) then
    raise exception 'PACKAGING_IN_USE: Esta embalagem está vinculada a um produto e não pode ser excluída. Desative o item.';
  end if;

  delete from public.packaging where id = p_packaging_id;
end;
$$;

comment on function public.delete_packaging(uuid, uuid) is
  'Exclusão física protegida de uma embalagem: só permitida quando nenhuma linha de product_packaging referencia este id. Nenhuma exclusão em cascata — o vínculo nunca é removido por esta function. Bloqueio levanta PACKAGING_IN_USE: <mensagem amigável>, marcador estável reconhecido por _shared/errors.ts (mapeado para 409, mensagem exibida sem o prefixo), orientando desativação em vez de exclusão.';

revoke execute on function public.delete_packaging(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_packaging(uuid, uuid)
  to service_role;
