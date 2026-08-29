-- Bloco 1 — Clientes
-- Migration: public.delete_customer — exclusão física protegida de cliente
-- (ajuste solicitado pelo usuário em 2026-08-29, ver docs/05_ROADMAP_MODULOS.md).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada). Aplicar exige autorização
-- explícita separada, fora do escopo desta entrada.
--
-- Nenhuma tabela é alterada. public.customers nunca concedeu DELETE a
-- authenticated (só is_active=false é possível pela aplicação,
-- 20260813204515_create_customers_table.sql) — este continua sendo o único
-- caminho de inativação lógica; esta function adiciona um segundo caminho,
-- de exclusão física, só quando o cliente nunca teve nenhum vínculo.
--
-- Regra de bloqueio (interpretação do pedido "bloquear se houver Empresa,
-- Pedido ou outro histórico dependente"): três categorias de vínculo, cada
-- uma com seu próprio marcador estável de erro (mesmo padrão de
-- ACCESSORY_IN_USE:/PACKAGING_IN_USE:, supabase/functions/_shared/errors.ts):
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
-- e nenhum Pedido/Empresa é apagado. Petlink (cliente oficial real) nunca é
-- protegida por um caso especial hardcoded aqui — a proteção vem
-- estruturalmente das duas checagens acima (um cliente oficial em uso
-- sempre terá pedido e/ou empresa vinculados).
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
  v_has_company boolean;
begin
  perform public.assert_active_user(p_changed_by);

  select company_id is not null into v_has_company
    from public.customers
    where id = p_customer_id
    for update;

  if not found then
    raise exception 'customers.id % não encontrado', p_customer_id;
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
  'Exclusão física protegida de um cliente: só permitida quando não há pedido vinculado (orders.customer_id) nem empresa vinculada (customers.company_id). Nenhuma exclusão em cascata. Bloqueio levanta CUSTOMER_HAS_ORDERS:/CUSTOMER_HAS_COMPANY: <mensagem amigável>, marcadores estáveis reconhecidos por _shared/errors.ts (mapeados para 409), orientando desativação em vez de exclusão.';

revoke execute on function public.delete_customer(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_customer(uuid, uuid)
  to service_role;
