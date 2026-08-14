-- Bloco 1 — Clientes e Pedidos
-- Migration 6/16: public.order_number_counters + public.next_order_number()
-- Suporte técnico à decisão do plano final do Bloco 1: order_number no
-- formato FS-YYYY-NNNN, gerado de forma atômica no banco.
--
-- Nenhuma outra tabela do Bloco 1 é criada nesta migration.

-- ---------------------------------------------------------------------------
-- order_number_counters
-- ---------------------------------------------------------------------------
-- Tabela técnica puramente interna: um contador por ano. Nunca acessada
-- diretamente pelo frontend nem por nenhuma outra função além de
-- next_order_number() (e, futuramente, create_order()).
create table public.order_number_counters (
  year integer primary key,
  last_number integer not null default 0 check (last_number >= 0)
);

comment on table public.order_number_counters is
  'Contador técnico interno para geração de orders.order_number (FS-YYYY-NNNN). Sem acesso de anon/authenticated — só acessível via next_order_number().';

alter table public.order_number_counters enable row level security;

-- Nenhuma policy é criada: com RLS habilitado e nenhuma policy permissiva,
-- o acesso é negado por padrão para qualquer role sujeita a RLS. Os revokes
-- abaixo são explícitos por defesa em profundidade, mesmo já não havendo
-- nenhum grant padrão a remover.
revoke all on public.order_number_counters from anon;
revoke all on public.order_number_counters from authenticated;
-- Sem nenhum grant (select/insert/update/delete) para anon ou authenticated.
-- A única via de leitura/escrita é o corpo de next_order_number(), que roda
-- como o owner da função (security definer), imune a estes revokes.

-- ---------------------------------------------------------------------------
-- next_order_number()
-- ---------------------------------------------------------------------------
create or replace function public.next_order_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Timezone fixado explicitamente em America/Sao_Paulo: o ano usado no
  -- order_number deve virar à meia-noite local (horário da operação da
  -- Forma), não à meia-noite UTC (padrão de sessão do Postgres/Supabase).
  v_year integer := extract(year from now() at time zone 'America/Sao_Paulo')::integer;
  v_last_number integer;
begin
  -- INSERT ... ON CONFLICT DO UPDATE ... RETURNING é uma única operação
  -- atômica no Postgres: o índice único de `year` (chave primária) serve de
  -- ponto de arbitragem. Duas chamadas concorrentes para o mesmo ano nunca
  -- geram o mesmo número — uma delas insere a linha (last_number = 1) e a
  -- outra, ao colidir, é automaticamente serializada pelo lock de linha do
  -- próprio INSERT/ON CONFLICT e aplica o incremento sobre o valor já
  -- gravado pela primeira. Não há janela entre "ler o valor atual" e
  -- "gravar o próximo valor" como haveria em um SELECT seguido de UPDATE.
  insert into public.order_number_counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update
    set last_number = public.order_number_counters.last_number + 1
  returning last_number into v_last_number;

  -- Reinício automático da sequência a cada ano: v_year muda em 1º de
  -- janeiro, então a próxima chamada não encontra linha para o novo ano
  -- (ON CONFLICT não dispara) e o INSERT recomeça a contagem em 1 para
  -- aquele ano — sem necessidade de job agendado ou intervenção manual.
  return 'FS-' || v_year || '-' || lpad(v_last_number::text, 4, '0');
end;
$$;

comment on function public.next_order_number() is
  'Gera o próximo order_number no formato FS-YYYY-NNNN de forma atômica, reiniciando a sequência a cada ano. Função interna: sem GRANT EXECUTE para nenhuma role de sessão (anon/authenticated) — só chamável de dentro de outra função security definer do mesmo owner (ex.: create_order(), Migration 15).';

-- Função interna e privilegiada: nunca deve ser chamada diretamente por
-- sessão de frontend/Sky. search_path travado (public, pg_temp) e todas as
-- referências já totalmente qualificadas (public.order_number_counters).
revoke execute on function public.next_order_number() from public, anon, authenticated;
-- Nenhum GRANT EXECUTE é concedido — nem para service_role. Esta função só
-- é chamada internamente por outra função security definer (create_order,
-- Migration 15): como ambas rodam sob o mesmo owner, a chamada interna
-- ocorre com o papel efetivo do owner, que nunca é afetado pelos revokes
-- acima (revoke atinge public/anon/authenticated, não o dono da função).
-- Se algum dia for necessário chamar next_order_number() diretamente via
-- RPC a partir de uma Edge Function, um grant explícito a service_role
-- deverá ser adicionado nessa ocasião — não hoje.
