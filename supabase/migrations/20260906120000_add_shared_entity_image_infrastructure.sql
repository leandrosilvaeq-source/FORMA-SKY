-- =============================================================================
-- Forma Sky — Infraestrutura compartilhada de "uma foto principal por cadastro"
-- (2026-09-06). Prepara banco + Storage + vínculo controlado para Acessórios,
-- Embalagens, Tipos de filamento e Produtos. Nesta rodada só a interface de
-- Acessórios consome a infraestrutura; as outras três tabelas ganham as
-- colunas e a RPC as aceita, mas nenhuma tela nova é adicionada a elas.
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada, na branch
-- feature/inventory-operations). Aplicar exige autorização explícita
-- separada, fora do escopo desta entrada.
--
-- Migration APPEND-ONLY — nenhuma migration anterior é editada. Nenhuma linha
-- existente é apagada nem alterada em valor; todo registro já cadastrado
-- permanece válido, com as duas colunas novas em NULL (nenhuma foto).
--
-- CONTEÚDO:
--   1. accessories / packaging / filament_types / products ganham
--      image_path text e image_thumb_path text — ambas NULLABLE, sem default,
--      sem CHECK de formato (o caminho é montado e validado pelo backend, ver
--      a Edge Function `entity-images` e a RPC set_entity_image abaixo).
--      Guardam SOMENTE o caminho interno do objeto no bucket privado
--      `entity-images` — NUNCA uma URL pública. A URL de exibição é sempre
--      assinada e temporária, gerada sob demanda pela Edge Function.
--   2. vw_filament_type_summary é recriada (CREATE OR REPLACE) expondo as duas
--      colunas novas do tipo — mesma definição, segurança (security_invoker),
--      grants, ordenação e demais colunas de antes, só com image_path/
--      image_thumb_path acrescentadas ao final.
--   3. Bucket de Storage `entity-images` — PRIVADO (public = false), limite de
--      5 MB por objeto, MIME de entrada restrito a JPEG/PNG/WebP. Nenhuma
--      policy de storage.objects é criada para ele: sem policy, anon e
--      authenticated não conseguem listar/ler/gravar/excluir nada nesse
--      bucket; toda operação real é feita pela Edge Function com a
--      service_role (que ignora RLS por definição). URLs de leitura são
--      sempre assinadas e expiram em 3600s.
--   4. RPC public.set_entity_image(p_entity, p_id, p_path, p_thumb_path,
--      p_changed_by) — genérica na interface, ESTÁTICA na implementação
--      (IF/ELSIF com 4 UPDATEs fixos, ZERO SQL dinâmico, nenhuma escolha de
--      tabela ou SQL vindo do chamador). SECURITY DEFINER, search_path fixo,
--      EXECUTE revogado de PUBLIC/anon/authenticated e concedido só a
--      service_role. Atualiza exclusivamente image_path/image_thumb_path;
--      aceita NULL/NULL para remoção; devolve os caminhos ANTERIORES (para
--      a Edge Function limpar os objetos órfãos com segurança) e os novos.
--
-- NÃO TOCADO: products.default_file_id (arquivo 3D padrão do produto —
-- conceito distinto), public.files (tabela de arquivos do Módulo 1 — não é
-- reaproveitada nem alterada), qualquer bucket já existente, qualquer regra
-- de exclusão de acessório/embalagem/tipo/produto.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas novas — nullable, sem default, compatíveis com todo registro
--    já existente (que fica com as duas em NULL = "sem foto").
-- ---------------------------------------------------------------------------
alter table public.accessories
  add column image_path text,
  add column image_thumb_path text;

alter table public.packaging
  add column image_path text,
  add column image_thumb_path text;

alter table public.filament_types
  add column image_path text,
  add column image_thumb_path text;

alter table public.products
  add column image_path text,
  add column image_thumb_path text;

comment on column public.accessories.image_path is
  'Caminho INTERNO do objeto "foto principal" (original WebP) no bucket privado entity-images — NUNCA uma URL pública. Formato accessories/{id}/{uuid}-original.webp, montado e validado só pelo backend (Edge Function entity-images / RPC set_entity_image). NULL = sem foto. A URL de exibição é assinada e temporária (3600s), gerada sob demanda.';
comment on column public.accessories.image_thumb_path is
  'Caminho INTERNO da miniatura (thumbnail WebP, lado máx. 320px) no bucket privado entity-images. Formato accessories/{id}/{uuid}-thumb.webp. NULL = sem foto. Ver image_path.';
comment on column public.packaging.image_path is
  'Ver public.accessories.image_path — mesma semântica, prefixo packaging/{id}/. Nenhuma tela consome este campo ainda (infraestrutura reservada, 2026-09-06).';
comment on column public.packaging.image_thumb_path is
  'Ver public.accessories.image_thumb_path — prefixo packaging/{id}/. Infraestrutura reservada (2026-09-06).';
comment on column public.filament_types.image_path is
  'Ver public.accessories.image_path — mesma semântica, prefixo filament-types/{id}/. Exposto por vw_filament_type_summary. Nenhuma tela consome este campo ainda (infraestrutura reservada, 2026-09-06).';
comment on column public.filament_types.image_thumb_path is
  'Ver public.accessories.image_thumb_path — prefixo filament-types/{id}/. Infraestrutura reservada (2026-09-06).';
comment on column public.products.image_path is
  'Ver public.accessories.image_path — mesma semântica, prefixo products/{id}/. DISTINTO de products.default_file_id (arquivo 3D padrão do produto), que NÃO é alterado nem reaproveitado. Nenhuma tela consome este campo ainda (infraestrutura reservada, 2026-09-06).';
comment on column public.products.image_thumb_path is
  'Ver public.accessories.image_thumb_path — prefixo products/{id}/. Infraestrutura reservada (2026-09-06).';

-- ---------------------------------------------------------------------------
-- 2. vw_filament_type_summary — mesma definição de
--    20260827110000_create_filament_movements_table.sql, só com image_path e
--    image_thumb_path do tipo acrescentadas ao final do SELECT (e ao GROUP BY,
--    no mesmo estilo explícito já usado). CREATE OR REPLACE preserva
--    security_invoker, o grant SELECT a authenticated e todas as demais
--    colunas/ordem. Postgres exige que as colunas novas sejam adicionadas ao
--    FINAL da lista — é exatamente o caso aqui.
-- ---------------------------------------------------------------------------
create or replace view public.vw_filament_type_summary
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
  count(fs.id) as total_spool_count,
  ft.image_path,
  ft.image_thumb_path
from public.filament_types ft
left join public.filament_spools fs on fs.filament_type_id = ft.id
group by ft.id, ft.material, ft.manufacturer, ft.line, ft.commercial_color, ft.color_code, ft.minimum_stock_grams, ft.is_active, ft.image_path, ft.image_thumb_path;

comment on view public.vw_filament_type_summary is
  'Uma linha por filament_type, com total_available_grams = soma do peso disponível dos rolos ativos e utilizáveis (is_active=true, status not in (ESGOTADO, DESCARTADO)). Nível de estoque (normal/baixo/sem estoque) é derivado no frontend a partir de total_available_grams/minimum_stock_grams, mesma função getStockLevel já usada por Acessórios/Embalagens — não recalculado aqui. image_path/image_thumb_path (2026-09-06) expõem o caminho interno da foto principal do tipo no bucket privado entity-images (NULL = sem foto). Somente leitura; security_invoker=true.';

grant select on public.vw_filament_type_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Bucket privado `entity-images`.
--
-- - public = false: nenhum acesso anônimo, nenhuma URL pública funciona.
-- - file_size_limit = 5 MiB (5 * 1024 * 1024 = 5242880 bytes) — coerente com
--   o limite de 5 MB pedido para o arquivo de entrada; o backend converte
--   para WebP antes de enviar, então os objetos gravados são bem menores,
--   mas o teto do bucket é uma segunda barreira independente da validação
--   da Edge Function.
-- - allowed_mime_types: só as três entradas aceitas. O backend envia sempre
--   image/webp (original e thumb já convertidos), que está na lista; JPEG e
--   PNG constam porque são formatos de ENTRADA válidos e uma futura variação
--   do fluxo poderia gravar o original sem reconverter — nunca um vetor de
--   upload arbitrário, já que só a service_role escreve aqui.
--
-- on conflict (id) do nothing: reaplicar a migration (ou aplicá-la sobre um
-- ambiente onde o bucket já foi criado manualmente) é inócuo — nunca
-- sobrescreve as regras de um bucket já existente nem toca em outro bucket.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'entity-images',
  'entity-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- NENHUMA policy de storage.objects é criada para o bucket entity-images.
-- storage.objects tem RLS habilitada por padrão no Supabase e, sem policy,
-- nega qualquer SELECT/INSERT/UPDATE/DELETE para os papéis anon e
-- authenticated nesse bucket. A service_role (usada exclusivamente pela Edge
-- Function entity-images, cuja chave só existe no ambiente da função) ignora
-- RLS e é o ÚNICO caminho de escrita/leitura/remoção de objetos aqui. Isso
-- satisfaz: (a) usuários não autenticados não listam/leem/gravam/excluem;
-- (b) o frontend não tem escrita direta irrestrita; (c) toda leitura é por
-- URL assinada temporária emitida pelo backend.

-- ---------------------------------------------------------------------------
-- 4. RPC public.set_entity_image — vínculo controlado do par de caminhos.
--
-- Genérica na ASSINATURA (um p_entity text), ESTÁTICA na implementação:
-- p_entity é validado contra a lista fechada das quatro entidades e um
-- IF/ELSIF escolhe entre quatro UPDATEs FIXOS, cada um contra uma tabela
-- literal. Nenhum EXECUTE/format/SQL dinâmico; o chamador nunca influencia
-- qual tabela é tocada além de escolher um dos quatro rótulos permitidos.
--
-- Só image_path e image_thumb_path são escritos. p_path/p_thumb_path podem
-- ser ambos NULL (remoção) ou ambos não-NULL (definir/substituir) — nunca um
-- só. Quando não-NULL, cada caminho é conferido contra o prefixo
-- "{p_entity}/{p_id}/" e o sufixo esperado (-original.webp / -thumb.webp):
-- defesa em profundidade para o banco NUNCA passar a apontar para um objeto
-- de outra entidade/registro, mesmo se a RPC for chamada diretamente.
--
-- Devolve jsonb com os caminhos ANTERIORES (previous_image_path/
-- previous_image_thumb_path) e os novos — a Edge Function usa os anteriores
-- para remover os objetos órfãos SÓ DEPOIS de o vínculo novo estar gravado.
-- ---------------------------------------------------------------------------
create or replace function public.set_entity_image(
  p_entity text,
  p_id uuid,
  p_path text,
  p_thumb_path text,
  p_changed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_prev_path text;
  v_prev_thumb text;
  v_found boolean;
begin
  perform public.assert_active_user(p_changed_by);

  if p_entity is null or p_entity not in ('accessories', 'packaging', 'filament-types', 'products') then
    raise exception 'set_entity_image: entidade inválida % (esperado accessories, packaging, filament-types ou products)', p_entity;
  end if;

  if p_id is null then
    raise exception 'set_entity_image: p_id é obrigatório';
  end if;

  -- Ambos NULL (remoção) ou ambos preenchidos (definir). Nunca um só.
  if (p_path is null) <> (p_thumb_path is null) then
    raise exception 'set_entity_image: informe os dois caminhos (original e thumb) ou nenhum — recebido original=%, thumb=%', p_path, p_thumb_path;
  end if;

  -- Conferência de prefixo/sufixo quando há caminho (defesa em profundidade —
  -- a Edge Function já monta o caminho, isto impede um vínculo cruzado mesmo
  -- numa chamada direta da RPC).
  if p_path is not null then
    v_prefix := p_entity || '/' || p_id::text || '/';
    if position(v_prefix in p_path) <> 1 or p_path not like '%-original.webp' then
      raise exception 'set_entity_image: p_path fora do padrão %{uuid}-original.webp (recebido %)', v_prefix, p_path;
    end if;
    if position(v_prefix in p_thumb_path) <> 1 or p_thumb_path not like '%-thumb.webp' then
      raise exception 'set_entity_image: p_thumb_path fora do padrão %{uuid}-thumb.webp (recebido %)', v_prefix, p_thumb_path;
    end if;
  end if;

  -- Quatro UPDATEs FIXOS. Cada ramo tranca a linha alvo (FOR UPDATE), lê os
  -- caminhos anteriores, confirma existência e grava só as duas colunas.
  if p_entity = 'accessories' then
    select image_path, image_thumb_path into v_prev_path, v_prev_thumb
      from public.accessories where id = p_id for update;
    v_found := found;
    if v_found then
      update public.accessories
        set image_path = p_path, image_thumb_path = p_thumb_path
        where id = p_id;
    end if;
  elsif p_entity = 'packaging' then
    select image_path, image_thumb_path into v_prev_path, v_prev_thumb
      from public.packaging where id = p_id for update;
    v_found := found;
    if v_found then
      update public.packaging
        set image_path = p_path, image_thumb_path = p_thumb_path
        where id = p_id;
    end if;
  elsif p_entity = 'filament-types' then
    select image_path, image_thumb_path into v_prev_path, v_prev_thumb
      from public.filament_types where id = p_id for update;
    v_found := found;
    if v_found then
      update public.filament_types
        set image_path = p_path, image_thumb_path = p_thumb_path
        where id = p_id;
    end if;
  else -- 'products'
    select image_path, image_thumb_path into v_prev_path, v_prev_thumb
      from public.products where id = p_id for update;
    v_found := found;
    if v_found then
      update public.products
        set image_path = p_path, image_thumb_path = p_thumb_path
        where id = p_id;
    end if;
  end if;

  if not v_found then
    raise exception 'set_entity_image: % id % não encontrado', p_entity, p_id;
  end if;

  return jsonb_build_object(
    'entity', p_entity,
    'id', p_id,
    'image_path', p_path,
    'image_thumb_path', p_thumb_path,
    'previous_image_path', v_prev_path,
    'previous_image_thumb_path', v_prev_thumb
  );
end;
$$;

comment on function public.set_entity_image(text, uuid, text, text, uuid) is
  'Vincula (ou remove, com NULL/NULL) o par image_path/image_thumb_path de UM registro de accessories/packaging/filament-types/products. Genérica na assinatura, estática na implementação: p_entity é validado contra a lista fechada e um IF/ELSIF seleciona um dos quatro UPDATEs fixos — nenhum SQL dinâmico, nenhuma escolha de tabela/SQL vinda do chamador. Escreve SOMENTE as duas colunas de imagem. Confere prefixo {entity}/{id}/ e sufixo -original.webp / -thumb.webp quando há caminho. Trava a linha alvo (FOR UPDATE), exige que o registro exista e devolve os caminhos ANTERIORES + os novos em jsonb (a Edge Function entity-images usa os anteriores para remover objetos órfãos só depois do vínculo novo gravado). SECURITY DEFINER, search_path fixo; EXECUTE só para service_role.';

revoke execute on function public.set_entity_image(text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.set_entity_image(text, uuid, text, text, uuid) to service_role;
