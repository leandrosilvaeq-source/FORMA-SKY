-- Bloco 1 — Clientes e Pedidos
-- Migration 9/16: public.custom_item_details, public.custom_versions, public.approvals
-- docs/03_MODELO_BANCO_DADOS.md §7.1-7.3, decisão do plano final do Bloco 1
-- (approvals como fonte oficial da aprovação; approval_status/approval_date
-- removidos de custom_item_details).
--
-- Nenhuma outra tabela do Bloco 1 é criada nesta migration. Nenhuma função
-- transacional (register_approval, register_custom_version etc.) é criada
-- aqui — fica para migration futura.

-- ---------------------------------------------------------------------------
-- custom_item_details
-- ---------------------------------------------------------------------------
create table public.custom_item_details (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT: order_items não concede DELETE a authenticated: uma
  -- exclusão física só viria de operação administrativa direta no banco.
  -- RESTRICT bloqueia apagar um order_item que ainda tem detalhes de
  -- Personalizado associados, preservando o histórico do item.
  --
  -- NÃO é garantido por FK/CHECK que order_item_id referencie um item com
  -- item_type = 'CUSTOM': constraints de tabela só enxergam colunas da
  -- própria linha, e uma FK só pode exigir igualdade contra a tabela
  -- referenciada — nenhum dos dois mecanismos consegue validar uma coluna
  -- de outra tabela (order_items.item_type) no momento do INSERT. Essa
  -- validação fica marcada como regra de negócio futura: a função que
  -- inserir aqui (a ser criada em migration futura) deve confirmar
  -- item_type = 'CUSTOM' antes de gravar.
  order_item_id uuid not null unique references public.order_items (id) on delete restrict,

  -- Formato vX.Y (ex.: v1.0, v1.1, v2.0), mesmo padrão de
  -- custom_versions.version_number abaixo.
  current_version text not null check (current_version ~ '^v[0-9]+\.[0-9]+$'),

  is_exclusive boolean not null default false,
  prototype_required boolean not null default false,
  prototype_completed boolean not null default false,

  development_minutes integer check (development_minutes is null or development_minutes >= 0),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Não é possível prototype_completed = true quando prototype_required =
  -- false (não faz sentido ter concluído um protótipo que não era exigido).
  constraint custom_item_details_prototype_consistency
    check (prototype_completed = false or prototype_required = true)
);

comment on table public.custom_item_details is
  'Detalhes de item Personalizado (docs/01_ESPECIFICACAO_FUNCIONAL.md §9, docs/03_MODELO_BANCO_DADOS.md §7.1). Sem approval_status/approval_date: a fonte oficial da aprovação é public.approvals. order_item_id deve referenciar um order_item com item_type=CUSTOM — validado pela função de negócio, não pelo banco.';

-- Reaproveita a função utilitária criada no Bloco 0.
create trigger set_custom_item_details_updated_at
  before update on public.custom_item_details
  for each row
  execute function public.set_updated_at();

alter table public.custom_item_details enable row level security;

revoke all on public.custom_item_details from anon;
revoke all on public.custom_item_details from authenticated;
grant select on public.custom_item_details to authenticated;

create policy "Active users can view custom item details"
  on public.custom_item_details
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- custom_versions
-- ---------------------------------------------------------------------------
create table public.custom_versions (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT: mesmo raciocínio de custom_item_details.order_item_id
  -- acima — preserva o histórico de versões do item.
  order_item_id uuid not null references public.order_items (id) on delete restrict,

  version_number text not null check (version_number ~ '^v[0-9]+\.[0-9]+$'),

  -- Texto livre por ora: os documentos descrevem "alteração significativa"
  -- (primeiro número) vs. "pequena correção" (segundo número), mas não
  -- definem um enum fechado de change_type. Não inventei valores fixos.
  change_type text,
  change_description text,

  -- ON DELETE RESTRICT (não SET NULL): custom_versions é, por natureza, um
  -- registro histórico imutável (sem updated_at — nunca editado após
  -- criado). "Sem perder histórico" aqui significa preservar o vínculo
  -- entre a versão registrada e o arquivo que a documenta; um SET NULL
  -- apagaria essa informação silenciosamente. files já não concede DELETE a
  -- authenticated, então RESTRICT só entra em jogo em exclusão
  -- administrativa direta — e nesse caso é melhor bloquear do que perder o
  -- vínculo histórico.
  file_id uuid references public.files (id) on delete restrict,

  created_at timestamptz not null default now(),

  unique (order_item_id, version_number)
);

comment on table public.custom_versions is
  'Histórico de versões de item Personalizado (docs/01_ESPECIFICACAO_FUNCIONAL.md §9.2, docs/03_MODELO_BANCO_DADOS.md §7.2). Registro imutável: sem updated_at.';

create index idx_custom_versions_order_item_id on public.custom_versions (order_item_id);

alter table public.custom_versions enable row level security;

revoke all on public.custom_versions from anon;
revoke all on public.custom_versions from authenticated;
grant select on public.custom_versions to authenticated;

create policy "Active users can view custom versions"
  on public.custom_versions
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- approvals
-- ---------------------------------------------------------------------------
-- Fonte oficial da aprovação (decisão do plano final do Bloco 1): a
-- existência de uma linha aqui para um order_item é o que determina se ele
-- está aprovado. Nenhuma outra tabela deste bloco duplica esse estado.
create table public.approvals (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT: preserva o histórico de aprovações do item.
  order_item_id uuid not null references public.order_items (id) on delete restrict,

  -- Vincula a aprovação à versão Personalizada específica que foi aprovada.
  -- Nullable porque só se aplica a itens CUSTOM (itens SPOT usam aprovação
  -- simples, sem versionamento — doc 01 §10.3 "Spot não utilizará
  -- versões"). ON DELETE RESTRICT: a aprovação de uma versão é histórico —
  -- não pode perder esse vínculo mesmo que a versão seja referenciada por
  -- uma operação administrativa de exclusão.
  --
  -- Regra de negócio futura (NÃO aplicada aqui por CHECK/trigger, pois
  -- depende de consultar order_items/custom_versions — será validada por
  -- register_approval() em migration futura):
  --   * item CUSTOM: custom_version_id é obrigatório, e a versão
  --     referenciada deve pertencer ao mesmo order_item_id desta approval;
  --   * item SPOT: custom_version_id deve permanecer NULL.
  --
  -- Efeito pretendido: um item CUSTOM só é considerado aprovado quando
  -- existir uma linha em approvals cujo custom_version_id aponte para a
  -- versão que é hoje o custom_item_details.current_version do item — essa
  -- comparação também ficará a cargo da regra de negócio/consulta futura
  -- (ex.: view de status de aprovação), não desta migration.
  custom_version_id uuid references public.custom_versions (id) on delete restrict,

  approval_type text not null
    check (approval_type in ('WHATSAPP', 'PHOTO', 'FORMAL_DOCUMENT', 'OTHER')),

  -- Obrigatório, sem default: a data/hora em que a aprovação foi de fato
  -- obtida pode ser anterior ao momento em que é registrada no sistema —
  -- por isso não assumimos now() automaticamente; quem registrar a
  -- aprovação deve informar o valor explicitamente.
  approved_at timestamptz not null,

  -- ON DELETE SET NULL (não RESTRICT): diferente de custom_versions.file_id,
  -- aqui o requisito é "sem perder a aprovação" — a aprovação em si (o
  -- registro de que ocorreu, quando e por qual meio) deve sobreviver mesmo
  -- que a evidência anexada seja removida. SET NULL preserva a linha de
  -- approvals intacta, só perde a referência ao arquivo de evidência.
  -- RESTRICT bloquearia a exclusão do arquivo enquanto referenciado — mais
  -- rígido do que o pedido, e não é isso que protege a aprovação em si.
  approval_evidence_file_id uuid references public.files (id) on delete set null,

  notes text,

  -- ON DELETE RESTRICT: exigido explicitamente. Preserva a rastreabilidade
  -- de quem registrou a aprovação; um usuário só pode ser removido do banco
  -- via inativação (users já trata isso via trigger do Bloco 0, que marca
  -- is_active=false em vez de apagar a linha).
  created_by uuid not null references public.users (id) on delete restrict,

  created_at timestamptz not null default now()
);

comment on table public.approvals is
  'Fonte oficial da aprovação de itens Personalizado/Spot (docs/01_ESPECIFICACAO_FUNCIONAL.md §9.3/§10.4, docs/03_MODELO_BANCO_DADOS.md §7.3). A existência de uma linha para um order_item_id determina que ele está aprovado — nenhum approval_status é duplicado em outra tabela.';

create index idx_approvals_order_item_id on public.approvals (order_item_id);
create index idx_approvals_custom_version_id on public.approvals (custom_version_id);

alter table public.approvals enable row level security;

revoke all on public.approvals from anon;
revoke all on public.approvals from authenticated;
grant select on public.approvals to authenticated;

create policy "Active users can view approvals"
  on public.approvals
  for select
  to authenticated
  using (public.is_active_user());
