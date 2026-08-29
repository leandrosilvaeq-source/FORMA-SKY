-- Bloco 1 — Clientes
-- Migration: public.customers.is_protected + public.delete_customer —
-- exclusão física protegida de cliente (ajuste solicitado pelo usuário em
-- 2026-08-29, ver docs/05_ROADMAP_MODULOS.md).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada). Aplicar exige autorização
-- explícita separada, fora do escopo desta entrada.
--
-- CORREÇÃO (auditoria desta mesma rodada, antes de qualquer aplicação): a
-- versão anterior desta migration argumentava que "um cliente oficial em
-- uso sempre terá pedido e/ou empresa vinculados", então a Petlink (cliente
-- oficial real, citado em toda a documentação do projeto como dado que
-- nunca deve ser alterado durante testes) estaria protegida só
-- estruturalmente pelas checagens de vínculo. O usuário apontou,
-- corretamente, que essa proteção é CONDICIONAL: deixaria de existir se
-- esses vínculos fossem removidos no futuro (ex.: um pedido da Petlink
-- sendo excluído por engano). Auditoria somente leitura (2026-08-29, antes
-- desta correção) confirmou que a Petlink AINDA NÃO existe como registro em
-- public.customers nem public.companies neste banco — nenhum UUID real
-- para hardcodar. Por isso a proteção agora é ESTRUTURAL e INCONDICIONAL —
-- uma coluna dedicada, nunca dependente de nome (nenhum
-- `lower(name) = 'petlink'` em lugar nenhum) nem de vínculo algum — pronta
-- para proteger a Petlink assim que ela for oficialmente cadastrada (ação
-- futura separada, continua bloqueada como em todas as rodadas anteriores;
-- esta migration NÃO cria nenhuma linha de cliente).
--
-- ---------------------------------------------------------------------------
-- 1) customers.is_protected — marca permanente e incondicional
-- ---------------------------------------------------------------------------
-- DEFAULT false: nenhum cliente existente (nem nenhum cliente novo, criado
-- pelo INSERT direto já concedido a authenticated) nasce protegido — marcar
-- um cliente como protegido é sempre um ato administrativo separado,
-- deliberadamente fora do alcance desta migration (que não teria como
-- saber qual UUID é "a Petlink", já que ela ainda não existe).
alter table public.customers
  add column is_protected boolean not null default false;

comment on column public.customers.is_protected is
  'Proteção permanente e incondicional contra exclusão física (delete_customer) — independente de nome, pedidos ou empresa vinculados. Nunca editável por authenticated (fora da whitelist de UPDATE concedida abaixo); só alterável por operação administrativa direta no banco. Usada para registros oficiais reais (ex.: Petlink) que nunca podem ser excluídos, mesmo que percam todos os vínculos no futuro.';

-- ---------------------------------------------------------------------------
-- 2) Restringe o UPDATE direto de authenticated: is_protected NUNCA pode ser
-- lido/gravado por essa via — sem isso, o GRANT UPDATE já concedido em
-- 20260813204515_create_customers_table.sql ("grant ... update on
-- public.customers to authenticated", sem lista de colunas) cobriria
-- automaticamente a coluna nova também, permitindo que qualquer usuário
-- autenticado desprotegesse um cliente por uma chamada direta ao
-- PostgREST, contornando completamente esta proteção. Mesmo padrão já
-- usado para products.default_price (20260813205942_create_products_table.sql):
-- REVOKE do grant amplo + GRANT explícito só das colunas que já eram
-- editáveis por esta via antes desta migration.
revoke update on public.customers from authenticated;
grant update (name, whatsapp, instagram, company_id, acquisition_source_id, notes, is_active)
  on public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- 3) delete_customer — exclusão física protegida
-- ---------------------------------------------------------------------------
-- public.customers nunca concedeu DELETE a authenticated (só is_active=false
-- é possível pela aplicação) — este continua sendo o único caminho de
-- inativação lógica; esta function adiciona um segundo caminho, de exclusão
-- física, só quando o cliente não é protegido e nunca teve nenhum vínculo.
--
-- ORDEM DAS CHECAGENS (deliberada): is_protected é verificado PRIMEIRO,
-- antes de qualquer checagem de vínculo — um cliente protegido é rejeitado
-- mesmo que não tenha nenhum pedido nem empresa vinculados nesse instante
-- (a checagem de vínculo nunca "salva" um cliente protegido). Marcador
-- estável próprio (PROTECTED_CUSTOMER:, mesmo padrão de
-- ACCESSORY_IN_USE:/PACKAGING_IN_USE:), nunca reaproveita
-- CUSTOMER_HAS_ORDERS:/CUSTOMER_HAS_COMPANY: (mensagem diferente,
-- orientando só que o registro é protegido — nunca menciona pedido/empresa,
-- que podem nem existir no caso protegido).
--
-- Regra de bloqueio por vínculo (interpretação do pedido "bloquear se
-- houver Empresa, Pedido ou outro histórico dependente"): duas categorias,
-- cada uma com seu próprio marcador estável de erro:
--   - CUSTOMER_HAS_ORDERS: o cliente tem ao menos um pedido (orders.customer_id
--     RESTRICT já impediria o DELETE de qualquer forma — esta checagem
--     antecipa o erro com uma mensagem amigável em vez de deixar o Postgres
--     estourar um erro de FK genérico);
--   - CUSTOMER_HAS_COMPANY: o cliente tem customers.company_id preenchido
--     (vínculo com Empresa) — bloqueio conservador mesmo sem constraint FK
--     bloqueando fisicamente a exclusão nesse sentido (a FK é
--     customers -> companies, não o contrário), tratando esse vínculo como
--     dado relevante demais para perder silenciosamente;
--   - nenhuma outra tabela referencia customers.id hoje (única FK existente
--     é orders.customer_id, já coberta acima — confirmado por auditoria
--     antes desta migration).
--
-- Nenhuma exclusão em cascata: o vínculo nunca é removido por esta function,
-- e nenhum Pedido/Empresa é apagado.
create or replace function public.delete_customer(
  p_customer_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_protected boolean;
  v_has_company boolean;
begin
  perform public.assert_active_user(p_changed_by);

  select is_protected, company_id is not null into v_is_protected, v_has_company
    from public.customers
    where id = p_customer_id
    for update;

  if not found then
    raise exception 'customers.id % não encontrado', p_customer_id;
  end if;

  if v_is_protected then
    raise exception 'PROTECTED_CUSTOMER: Este cliente é protegido e não pode ser excluído.';
  end if;

  if exists (select 1 from public.orders where customer_id = p_customer_id) then
    raise exception 'CUSTOMER_HAS_ORDERS: Este cliente possui pedido(s) vinculado(s) e não pode ser excluído. Desative o cliente.';
  end if;

  if v_has_company then
    raise exception 'CUSTOMER_HAS_COMPANY: Este cliente está vinculado a uma empresa e não pode ser excluído. Desative o cliente.';
  end if;

  delete from public.customers where id = p_customer_id;
end;
$$;

comment on function public.delete_customer(uuid, uuid) is
  'Exclusão física protegida de um cliente: rejeitada incondicionalmente (PROTECTED_CUSTOMER:) quando is_protected=true, independente de vínculos; senão, só permitida quando não há pedido vinculado (orders.customer_id) nem empresa vinculada (customers.company_id). Nenhuma exclusão em cascata. Bloqueio levanta PROTECTED_CUSTOMER:/CUSTOMER_HAS_ORDERS:/CUSTOMER_HAS_COMPANY: <mensagem amigável>, marcadores estáveis reconhecidos por _shared/errors.ts (mapeados para 409).';

revoke execute on function public.delete_customer(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_customer(uuid, uuid)
  to service_role;
