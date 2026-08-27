-- Bloco 1 — Módulo 3 (Estoque e Inventário), Incremento 1 do novo plano de
-- estoque operacional aprovado em 2026-08-27 (docs/05_ROADMAP_MODULOS.md;
-- as 22 regras aprovadas pelo usuário estão documentadas em
-- docs/03_MODELO_BANCO_DADOS.md §15.1 e docs/01_ESPECIFICACAO_FUNCIONAL.md
-- §18/§20) — NÃO confundir com o "plano de 8 incrementos" já concluído em
-- docs/05 §9 (esse era só sobre a interface de cadastro mestre de
-- accessories/packaging; este é sobre o motor de saldo/movimentação real).
--
-- IMPORTANTE — esta migration ainda NÃO foi aplicada no projeto Supabase
-- remoto (só criada localmente, nesta rodada, na branch
-- feature/inventory-operations). Aplicar exige autorização explícita
-- separada (supabase db push ou equivalente), fora do escopo desta entrada.
--
-- ESCOPO DESTA MIGRATION (Incremento 1, só isto):
--   - public.stock_movements: ledger imutável de movimentações de estoque,
--     genérico para ACCESSORY/PACKAGING nesta etapa, desenhado para aceitar
--     FILAMENT_SPOOL no futuro só ampliando os dois CHECK de enum abaixo
--     (item_type e movement_type) — nunca remodelagem completa da tabela.
--   - public.register_stock_movement(...): única forma de escrita em
--     stock_movements E de accessories.current_stock/packaging.current_stock
--     — nenhuma outra function, trigger ou acesso direto altera essas
--     colunas a partir desta migration em diante.
--
-- FORA DE ESCOPO (fica para incrementos futuros, não implementado aqui):
--   interface de movimentações, histórico no frontend, filamentos, rolos,
--   pesagens, RESERVATION/RELEASE/CONSUMPTION, integração com
--   change_order_status, produção. Nenhum desses é tocado por esta
--   migration.
--
-- FONTE DO SALDO (decisão de arquitetura desta rodada, respondendo
-- explicitamente ao requisito 6 do pedido): stock_movements é o
-- ledger/auditoria imutável (nunca editado nem apagado); accessories.
-- current_stock/packaging.current_stock são o saldo FÍSICO MATERIALIZADO —
-- a "foto atual", mantida em sincronia com o ledger só pela RPC abaixo, na
-- MESMA transação que insere a movimentação. Uma consulta de saldo em
-- produção sempre lê current_stock (rápido, sem agregação); o ledger existe
-- para auditoria/reconciliação, não como fonte primária de leitura de
-- saldo — daí current_stock nunca ser calculado via "sum(stock_movements)"
-- em tempo real (isso seria correto mas lento e não protegeria sozinho
-- contra concorrência sem o mesmo lock de linha que a RPC já usa).

-- ---------------------------------------------------------------------------
-- stock_movements
-- ---------------------------------------------------------------------------
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),

  -- Campo polimórfico SEM foreign key (não é possível uma FK apontar
  -- condicionalmente para accessories OU packaging conforme item_type) —
  -- mesmo padrão já usado por public.files.entity_type/entity_id (Migration
  -- 4), que os comentários de create_accessory/create_packaging já citavam
  -- como referência para esta futura tabela. A ausência de FK NÃO significa
  -- ausência de validação: register_stock_movement() abaixo confirma que
  -- item_id existe de fato na tabela correspondente a item_type antes de
  -- prosseguir (via `select ... for update`, que também serve de lock).
  --
  -- Extensível a FILAMENT_SPOOL no futuro (Incremento 5 do plano de
  -- estoque) só ampliando este CHECK — nunca uma migração destrutiva.
  item_type text not null check (item_type in ('ACCESSORY', 'PACKAGING')),
  item_id uuid not null,

  -- Extensível a RESERVATION/RELEASE/CONSUMPTION/WEIGHING no futuro
  -- (Incrementos 5/7/8) só ampliando este CHECK — nenhum desses 4 valores é
  -- aceito por register_stock_movement() nesta etapa (ver função abaixo).
  movement_type text not null check (movement_type in (
    'INITIAL_BALANCE', 'PURCHASE', 'RETURN', 'POSITIVE_ADJUSTMENT',
    'LOSS', 'SAMPLE_DONATION', 'INTERNAL_USE', 'NEGATIVE_ADJUSTMENT'
  )),

  -- Sinal já resolvido no momento da gravação (entradas: positivo; saídas:
  -- negativo) — quem grava é sempre register_stock_movement(), que recebe
  -- do chamador só uma quantidade positiva (p_quantity) e decide o sinal a
  -- partir de movement_type, nunca confia num delta já assinado vindo de
  -- fora. <> 0 é redundante com "p_quantity > 0" da function, mas mantido
  -- aqui como defesa em profundidade contra qualquer INSERT futuro que não
  -- passe pela function (não deveria existir nenhum, dados os grants
  -- abaixo, mas o CHECK não custa nada).
  quantity_delta integer not null check (quantity_delta <> 0),

  -- Saldo materializado antes/depois desta movimentação — nunca negativo,
  -- calculado e gravado pela mesma transação que grava a movimentação.
  balance_before integer not null check (balance_before >= 0),
  balance_after integer not null check (balance_after >= 0),

  -- Motivo obrigatório para os tipos que alteram saldo por decisão humana
  -- discricionária (ajustes, perda, amostra/doação, uso interno) — mesma
  -- ideia já usada em payments_negative_adjustment_requires_notes
  -- (Migration 12), agora generalizada por tipo em vez de só por sinal.
  -- PURCHASE/RETURN aceitam observação opcional (não exigida);
  -- INITIAL_BALANCE também não exige motivo.
  reason text,
  constraint stock_movements_reason_required_by_type check (
    movement_type not in (
      'POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT', 'LOSS', 'SAMPLE_DONATION', 'INTERNAL_USE'
    )
    or (reason is not null and btrim(reason) <> '')
  ),

  -- Vínculo polimórfico futuro (pedido, inventário físico, compra,
  -- produção) — nenhum valor é gravado nesta etapa (todas as 8
  -- movement_type desta rodada são manuais, sem origem em pedido);
  -- reservado para Incrementos 7/8. Sem CHECK de enum ainda: os valores
  -- concretos (ex.: 'ORDER_ITEM') só serão decididos quando a integração
  -- com Pedidos for implementada, para não travar um enum especulativo
  -- agora.
  reference_type text,
  reference_id uuid,

  -- Proteção contra duplicidade (requisito 18 das regras aprovadas:
  -- "movimentações automáticas terão proteção contra duplicidade por
  -- pedido, item e evento"). Nesta etapa (só movimentações manuais) o
  -- chamador pode omitir — cada chamada sem chave é sempre uma nova
  -- movimentação. Quando fornecida, é única (ver índice parcial abaixo) e
  -- reutilizá-la com o MESMO payload é idempotente (register_stock_movement
  -- devolve a movimentação já existente, sem gravar de novo); reutilizá-la
  -- com um payload DIFERENTE é rejeitado com erro (nunca sucesso
  -- silencioso) — ver função abaixo.
  idempotency_key text,

  -- Data/hora "de negócio" do evento (quando a movimentação realmente
  -- ocorreu) — mesma distinção já usada em payments.paid_at vs created_at
  -- (Migration 12): pode ser retroativa (ex.: lançar uma compra recebida
  -- ontem), created_at é sempre o instante real do INSERT.
  occurred_at timestamptz not null default now(),

  -- ON DELETE RESTRICT: preserva a autoria mesmo que o usuário seja
  -- inativado depois (usuários só são inativados, nunca apagados — mesmo
  -- padrão de created_by/changed_by em toda tabela do Bloco 1).
  created_by uuid not null references public.users (id) on delete restrict,

  created_at timestamptz not null default now()

  -- Sem updated_at: histórico imutável, nunca editado após criado (mesmo
  -- padrão de order_status_history/payment_status_history/
  -- product_price_history/payments). Nenhum trigger set_updated_at é
  -- criado para esta tabela.
);

comment on table public.stock_movements is
  'Ledger imutável de movimentações de estoque (Módulo 3, Incremento 1). Nesta etapa suporta item_type ACCESSORY/PACKAGING e as 8 movement_type manuais (INITIAL_BALANCE/PURCHASE/RETURN/POSITIVE_ADJUSTMENT/LOSS/SAMPLE_DONATION/INTERNAL_USE/NEGATIVE_ADJUSTMENT). Extensível a FILAMENT_SPOOL e a RESERVATION/RELEASE/CONSUMPTION/WEIGHING em migrations futuras, só ampliando os dois CHECK de enum — nunca remodelagem completa. accessories.current_stock/packaging.current_stock são o saldo materializado; esta tabela é auditoria/reconciliação, nunca a fonte de leitura de saldo em tempo real. Escrita exclusiva via register_stock_movement() (abaixo) — nenhum UPDATE/DELETE é permitido, nem para authenticated nem para service_role.';

comment on column public.stock_movements.item_id is
  'Sem foreign key (campo polimórfico: aponta para accessories.id ou packaging.id conforme item_type — uma FK condicional não é representável). register_stock_movement() valida a existência real do item na tabela correspondente antes de gravar qualquer movimentação, via SELECT ... FOR UPDATE.';

comment on column public.stock_movements.idempotency_key is
  'Opcional nesta etapa (só movimentações manuais). Quando fornecida, é única (índice parcial abaixo): reuso com o mesmo payload é idempotente (devolve a movimentação já gravada, sem duplicar); reuso com payload diferente é rejeitado com erro IDEMPOTENCY_KEY_CONFLICT:, nunca sucesso silencioso.';

-- Consulta por item (listagem de movimentações de um acessório/embalagem
-- específico, mais recente primeiro) — uso previsto já no Incremento 3
-- (histórico no frontend), criado desde já por ser barato e óbvio.
create index idx_stock_movements_item
  on public.stock_movements (item_type, item_id, occurred_at desc);

-- Consulta por referência futura (ex.: "todas as movimentações geradas por
-- este pedido") — índice parcial porque reference_type é NULL em 100% das
-- movimentações desta etapa (só populado a partir do Incremento 7).
create index idx_stock_movements_reference
  on public.stock_movements (reference_type, reference_id)
  where reference_type is not null;

-- Unicidade de idempotency_key quando fornecida — índice parcial (não
-- unique constraint simples) porque múltiplas linhas com idempotency_key
-- NULL são esperadas e válidas (a maioria das movimentações manuais desta
-- etapa não fornece chave nenhuma); Postgres já trata NULL <> NULL para
-- fins de unicidade, mas o WHERE explícito documenta a intenção e evita
-- qualquer dúvida futura.
create unique index ux_stock_movements_idempotency_key
  on public.stock_movements (idempotency_key)
  where idempotency_key is not null;

alter table public.stock_movements enable row level security;

revoke all on public.stock_movements from anon;
revoke all on public.stock_movements from authenticated;
-- Somente leitura para authenticated, mesmo padrão de
-- order_status_history/payment_status_history (Migration 13): nenhum
-- INSERT/UPDATE/DELETE é concedido a nenhuma role de sessão — a única
-- escrita possível é via register_stock_movement() (security definer,
-- service_role, abaixo), que roda com os privilégios do owner da function,
-- não da role chamadora.
grant select on public.stock_movements to authenticated;

create policy "Active users can view stock movements"
  on public.stock_movements
  for select
  to authenticated
  using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- register_stock_movement — única função que escreve em stock_movements e
-- em accessories.current_stock/packaging.current_stock
-- ---------------------------------------------------------------------------
-- Contrato: o chamador informa uma QUANTIDADE SEMPRE POSITIVA (p_quantity)
-- — nunca um delta já assinado — e o movement_type decide a direção
-- (entrada: soma; saída: subtrai). Isso elimina uma classe inteira de erro
-- de chamador (ex.: um formulário de "saída" nunca precisa lembrar de
-- enviar um número negativo).
--
-- ATOMICIDADE / CONCORRÊNCIA — mesmo padrão de lock já estabelecido em
-- todo o Bloco 1 (orders, accessories, packaging): um único
-- `select ... for update` na linha do item (accessories OU packaging,
-- conforme item_type) é obtido ANTES de qualquer leitura/gravação
-- dependente do estado atual, e serve simultaneamente para:
--   (a) confirmar que o item existe (requisito explícito do pedido: "não
--       use um campo polimórfico sem validação");
--   (b) ler balance_before de forma consistente;
--   (c) servir de único ponto de serialização entre duas movimentações
--       concorrentes do MESMO item — a segunda chamada só obtém o lock
--       depois que a primeira transação commitar ou desfizer, e nesse
--       momento já enxerga o current_stock atualizado pela primeira,
--       tornando impossível duas saídas concorrentes lerem o mesmo
--       balance_before e ambas decidirem "há saldo suficiente" quando na
--       verdade só uma tem.
-- Esta é a mesma razão pela qual delete_accessory/delete_packaging
-- (atualizados na próxima migration) também continuam seguras mesmo sem
-- FK em stock_movements.item_id: todo escritor que toca o estado de
-- estoque de um item (esta function E as duas de delete) trava a MESMA
-- linha do item antes de agir — é essa convenção compartilhada, não uma FK,
-- que serializa as operações entre si.
--
-- IDEMPOTÊNCIA — a checagem de idempotency_key acontece DEPOIS do lock
-- acima, nunca antes: duas chamadas concorrentes para o MESMO item com a
-- MESMA chave ficam automaticamente serializadas pelo FOR UPDATE, e a
-- segunda só enxerga a movimentação já gravada pela primeira depois do
-- commit dela — sem nenhuma janela de corrida. O índice único parcial
-- (ux_stock_movements_idempotency_key) permanece como última linha de
-- defesa contra o caso residual de duas chamadas concorrentes reusando a
-- mesma chave para itens DIFERENTES (uso indevido do chamador, não um
-- cenário legítimo de retry) — nesse caso a segunda simplesmente falha com
-- violação de unicidade (23505), nunca grava um estado inconsistente.
create or replace function public.register_stock_movement(
  p_item_type text,
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_changed_by uuid,
  p_reason text default null,
  p_occurred_at timestamptz default now(),
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_idempotency_key text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity integer;
  v_quantity_delta integer;
  v_balance_before integer;
  v_balance_after integer;
  v_existing public.stock_movements;
  v_row public.stock_movements;
  v_normalized_reason text;
begin
  perform public.assert_active_user(p_changed_by);

  if p_item_type not in ('ACCESSORY', 'PACKAGING') then
    raise exception 'stock_movements.item_type inválido: % (esperado ACCESSORY ou PACKAGING)', p_item_type;
  end if;

  if p_movement_type not in (
    'INITIAL_BALANCE', 'PURCHASE', 'RETURN', 'POSITIVE_ADJUSTMENT',
    'LOSS', 'SAMPLE_DONATION', 'INTERNAL_USE', 'NEGATIVE_ADJUSTMENT'
  ) then
    raise exception 'stock_movements.movement_type inválido: %', p_movement_type;
  end if;

  -- p_quantity é numeric (não integer) DE PROPÓSITO: se o parâmetro fosse
  -- integer, Postgres faria coerção implícita de um numeric fracionário
  -- (ex.: 1.5) por ARREDONDAMENTO silencioso em vez de erro — o oposto do
  -- requisito "acessórios e embalagens aceitam somente quantidades
  -- inteiras". Com numeric, a fração é detectada e rejeitada explicitamente
  -- abaixo, e só então convertida para integer (sempre seguro nesse ponto,
  -- pois já garantimos ausência de parte fracionária).
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'register_stock_movement: p_quantity deve ser um inteiro positivo (recebido %)', p_quantity;
  end if;

  if p_quantity <> trunc(p_quantity) then
    raise exception 'register_stock_movement: p_quantity deve ser um número inteiro, sem casas decimais (recebido %)', p_quantity;
  end if;

  v_quantity := p_quantity::integer;

  v_normalized_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if p_movement_type in ('POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT', 'LOSS', 'SAMPLE_DONATION', 'INTERNAL_USE')
     and v_normalized_reason is null then
    raise exception 'register_stock_movement: motivo obrigatório para movement_type %', p_movement_type;
  end if;

  v_quantity_delta := case
    when p_movement_type in ('INITIAL_BALANCE', 'PURCHASE', 'RETURN', 'POSITIVE_ADJUSTMENT') then v_quantity
    else -v_quantity
  end;

  -- Lock + validação de existência do item na tabela correspondente a
  -- item_type — nunca confia que item_id é válido só porque é um uuid
  -- bem-formado.
  if p_item_type = 'ACCESSORY' then
    select current_stock into v_balance_before from public.accessories where id = p_item_id for update;
  else
    select current_stock into v_balance_before from public.packaging where id = p_item_id for update;
  end if;

  if not found then
    raise exception '% de id % não encontrado', p_item_type, p_item_id;
  end if;

  -- Idempotência — ver nota de concorrência no comentário da function.
  -- occurred_at é DELIBERADAMENTE excluído da comparação de payload: como
  -- p_occurred_at tem default now(), um retry legítimo sem esse argumento
  -- explícito teria um valor diferente a cada chamada, o que produziria
  -- falsos "payload diferente" se occurred_at entrasse na comparação —
  -- occurred_at é metadado de quando o evento foi informado, não parte da
  -- identidade lógica da operação sendo deduplicada.
  if p_idempotency_key is not null then
    select * into v_existing from public.stock_movements where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.item_type = p_item_type
         and v_existing.item_id = p_item_id
         and v_existing.movement_type = p_movement_type
         and v_existing.quantity_delta = v_quantity_delta
         and coalesce(v_existing.reason, '') = coalesce(v_normalized_reason, '')
         and coalesce(v_existing.reference_type, '') = coalesce(p_reference_type, '')
         and v_existing.reference_id is not distinct from p_reference_id
      then
        return v_existing;
      else
        raise exception 'IDEMPOTENCY_KEY_CONFLICT: idempotency_key % já foi usada com um payload diferente', p_idempotency_key;
      end if;
    end if;
  end if;

  if p_movement_type = 'INITIAL_BALANCE' then
    if exists (
      select 1 from public.stock_movements
      where item_type = p_item_type and item_id = p_item_id
    ) then
      raise exception 'INITIAL_BALANCE_ALREADY_EXISTS: INITIAL_BALANCE só pode ser a primeira movimentação do item — já existe(m) movimentação(ões) para % %', p_item_type, p_item_id;
    end if;

    if v_balance_before <> 0 then
      raise exception 'INITIAL_BALANCE_REQUIRES_ZERO: INITIAL_BALANCE exige saldo atual igual a zero (saldo atual: %)', v_balance_before;
    end if;
  end if;

  v_balance_after := v_balance_before + v_quantity_delta;

  if v_balance_after < 0 then
    raise exception
      'STOCK_INSUFFICIENT_BALANCE: saldo insuficiente para % em % % — saldo atual: %, quantidade solicitada: %',
      p_movement_type, p_item_type, p_item_id, v_balance_before, p_quantity;
  end if;

  insert into public.stock_movements (
    item_type, item_id, movement_type, quantity_delta, balance_before, balance_after,
    reason, reference_type, reference_id, idempotency_key, occurred_at, created_by
  ) values (
    p_item_type, p_item_id, p_movement_type, v_quantity_delta, v_balance_before, v_balance_after,
    v_normalized_reason, p_reference_type, p_reference_id, p_idempotency_key,
    coalesce(p_occurred_at, now()), p_changed_by
  )
  returning * into v_row;

  if p_item_type = 'ACCESSORY' then
    update public.accessories set current_stock = v_balance_after where id = p_item_id;
  else
    update public.packaging set current_stock = v_balance_after where id = p_item_id;
  end if;

  return v_row;
end;
$$;

comment on function public.register_stock_movement(text, uuid, text, numeric, uuid, text, timestamptz, text, uuid, text) is
  'Única função que escreve em stock_movements e em accessories.current_stock/packaging.current_stock, na mesma transação (FOR UPDATE no item, calcula balance_before/after, insere a movimentação, atualiza o saldo materializado). p_quantity é sempre positivo — o sinal é resolvido a partir de movement_type. Bloqueia saldo negativo, valida motivo obrigatório por tipo, valida regras de INITIAL_BALANCE (primeira movimentação, saldo zero, não repetível) e é idempotente quando p_idempotency_key é fornecida.';

revoke execute on function public.register_stock_movement(text, uuid, text, numeric, uuid, text, timestamptz, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_stock_movement(text, uuid, text, numeric, uuid, text, timestamptz, text, uuid, text)
  to service_role;
