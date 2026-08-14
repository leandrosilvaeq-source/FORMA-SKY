-- Bloco 1 — Clientes e Pedidos
-- Migration 3/16: public.files
-- docs/03_MODELO_BANCO_DADOS.md §20.1
--
-- Metadados/referências de arquivos (3MF, SVG, JPG, fotos, vídeos, documentos
-- de aprovação etc.). O arquivo físico continua no Google Drive; nenhuma
-- integração automática com o Drive é criada nesta migration — drive_file_id
-- e drive_url são preenchidos manualmente por enquanto.
-- Nenhuma outra tabela do Bloco 1 é criada nesta migration.

create table public.files (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text,
  file_name text not null,
  mime_type text,
  file_category text not null
    check (file_category in (
      '3MF', 'SVG', 'JPG', 'FOTO', 'VIDEO', 'APROVACAO', 'MARKETING', 'OUTRO'
    )),
  -- Vínculo polimórfico (mesmo padrão de stock_movements/alerts no doc 03):
  -- entity_type identifica a tabela de origem (ex.: 'order_item',
  -- 'custom_version', 'approval', 'product') e entity_id a linha específica.
  -- Sem FK, pois pode apontar para tabelas diferentes. Nullable de propósito:
  -- um arquivo pode existir temporariamente sem vínculo definitivo.
  entity_type text,
  entity_id uuid,
  drive_url text,
  created_at timestamptz not null default now()
);

comment on table public.files is
  'Metadados de arquivos armazenados no Google Drive (docs/02_ESPECIFICACAO_TECNICA.md §2.6, docs/03_MODELO_BANCO_DADOS.md §20.1). entity_type/entity_id formam um vínculo polimórfico sem FK.';

-- Sem updated_at/is_active: o modelo aprovado (doc 03 §20.1) define apenas
-- os campos acima para esta tabela.

alter table public.files enable row level security;

revoke all on public.files from anon;
revoke all on public.files from authenticated;
-- Sem DELETE: nenhuma exclusão física prevista para esta tabela no Bloco 1.
grant select, insert, update on public.files to authenticated;

create policy "Active users can view files"
  on public.files
  for select
  to authenticated
  using (public.is_active_user());

create policy "Active users can create files"
  on public.files
  for insert
  to authenticated
  with check (public.is_active_user());

create policy "Active users can update files"
  on public.files
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());
