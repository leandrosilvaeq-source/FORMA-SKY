# Roadmap de Módulos
## Forma 3D Studio + Assistente Virtual Sky

**Última atualização:** 2026-08-27
**Como usar este documento:** atualizar a tabela macro e o detalhamento do módulo em
desenvolvimento ao final de cada sessão de trabalho. Não é necessário reescrever
`04_PLANO_IMPLEMENTACAO.md` — ele contém o escopo fixo de cada módulo; este arquivo contém
apenas o **estado atual**.

Fases técnicas (iguais para todos os módulos): **1** Definição funcional · **2** Modelo e regras
· **3** Backend · **4** Frontend · **5** Integração E2E · **6** Piloto real · **7** Estabilização
/ release.

**Status OPERACIONAL** = o módulo pode ser usado normalmente pelo frontend, sem PowerShell nem
chamadas manuais de API.

---

# 1. Regra de cálculo do percentual macro

Cada módulo tem 7 fases de peso igual: **1/7 ≈ 14,29% cada**.

- **Percentual macro do módulo = média simples do peso das 7 fases.**
- Fase concluída (100%) recebe seu peso integral (≈14,29%).
- Fase parcialmente concluída recebe proporcionalmente seu percentual (ex.: fase 50% concluída
  contribui com ≈7,14%).
- Fase não iniciada contribui com 0%.

**"Especificado/documentado" não é o mesmo que "implementado/validado".** Isso vale sobretudo
para a Fase 2 (Modelo e regras):

- Fase 2 só recebe **100%** quando o modelo estiver **implementado** (migrations aplicadas) **e**
  as regras de negócio associadas **validadas** (funções/constraints funcionando).
- Se o modelo existir **apenas como especificação** em `03_MODELO_BANCO_DADOS.md`, sem
  migrations criadas, a Fase 2 é considerada **parcial (50%)** — o trabalho de modelagem foi
  feito e conta como progresso real, mas não como implementação.
- Fase marcada **"não aplicável"** (ex.: módulos de Sky, que não modelam tabelas próprias)
  contribui com **0%** no cálculo macro, por padrão conservador — é sinalizada separadamente
  como N/A para não ser confundida com uma pendência esquecida.
- A Fase 1 (Definição funcional) é sobre **definir**, não implementar: por isso ela recebe 100%
  quando a especificação funcional do módulo está completa em `01_ESPECIFICACAO_FUNCIONAL.md`,
  mesmo sem nenhuma linha de código.

Essa mesma regra vale para as Fases 3 a 7: só recebem 100% quando existir artefato real
(Edge Function deployada e testada, tela funcionando, teste E2E executado, piloto em uso,
release estabilizado). Documentação de escopo/planejamento nessas fases não conta como
progresso — só como intenção registrada em `04_PLANO_IMPLEMENTACAO.md`.

---

# 2. Visão macro

| Nº | Módulo | Fases com peso (100% / parcial) | % macro | Status OPERACIONAL |
| --- | --- | --- | --- | --- |
| 0 | Fundação e Segurança | 5×100% (F1–F5) + 2×50% (F6–F7) | ~86% | 🟡 Quase operacional — validar formalmente (Fases 6–7 pendentes) |
| 1 | Clientes, Produtos e Pedidos | 5×100% (F1–F5) + 2×0% (F6–F7) | ~71% | 🟡 Fluxo E2E completo do MVP (Clientes/Empresas/Produtos/Pedidos, incl. bloqueio de pagamento excedente) validado manualmente em 2026-08-26, com a proteção de backend aplicada e confirmada no Supabase remoto — Fase 6 (Piloto real) ainda não iniciada |
| 2 | Produção | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 3 | Estoque e Inventário | 1×100% (F1) + 1×50% (F2) + 5×0% (% macro pendente de recálculo — ver §9) | ~21%* | 🟡 Cadastro mestre (Acessórios/Embalagens) operacional; Incremento 1 do motor de saldo/movimentação implementado **localmente** em 2026-08-27, não aplicado ao remoto (ver §9b); inventário físico completo (movimentações validadas, filamentos, consumo automático) não concluído |
| 4 | Precificação e Rentabilidade | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 5 | Manutenção e Equipamentos | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 6 | Onboarding, Alertas e Gestão | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 7 | Sky Assistente em Texto | 1×100% (F1) + 1×0% (F2, N/A) + 5×0% | ~14% | ❌ Não iniciado |
| 8 | Sky Assistente por Voz | 1×100% (F1) + 1×0% (F2, N/A) + 5×0% | ~14% | ❌ Não iniciado |
| 9 | Divulgação e Marketing | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 10 | Integrações Externas | 1×100% (F1) + 6×0% (F2 sem modelo definido por integração) | ~14% | ❌ Não iniciado |

> Cálculo exato do Módulo 1: 5 fases 100% + 2 fases 0% = 5/7 ≈ 71%.
> \* Módulo 3: percentual macro ainda não recalculado formalmente após a conclusão do cadastro
> mestre (Acessórios/Embalagens) — ver detalhamento e justificativa em §9. O número "~21%" acima
> é herdado da entrada anterior e **não reflete** o estado atual (cadastro mestre já implementado,
> testado e validado); só a descrição em texto desta linha foi atualizada nesta rodada.
> A referência confiável continua sendo o detalhamento por fase (seção 3, para o módulo em
> desenvolvimento; seção 5, macro para os demais) — a tabela acima é só leitura rápida.

---

# 3. Módulo em desenvolvimento atual: Módulo 1 — Clientes, Produtos e Pedidos

| Fase | Status | Peso | Observação |
| --- | --- | --- | --- |
| 1. Definição funcional | ✅ 100% | 14,29% | Doc `01` §5–11, §68 |
| 2. Modelo e regras | ✅ 100% | 14,29% | 19 migrations **aplicadas**: `companies`, `customers`, `lead_sources`, `orders`, `order_items`, `custom_item_details`, `custom_versions`, `approvals`, `model_sources`, `spot_item_details`, `products`, `product_price_history`, `payments`, `order_status_history`, `payment_status_history`, `accessories`, `packaging`, `product_accessories`, `product_packaging` + funções de negócio (incl. `set_product_composition`) + views |
| 3. Backend | ✅ 100% | 14,29% | 6 Edge Functions **deployadas e validadas em runtime**: `products`, `orders`, `order-items`, `order-status`, `payments`, `order-approvals`. Nova rota `PATCH /products/:id/composition` **deployada e validada em runtime** — smoke test real ponta a ponta (frontend → Edge Function → RPC `set_product_composition` → banco → leitura de volta) concluído com sucesso em 2026-08-16 |
| 4. Frontend | ✅ 100% | 14,29% | Clientes, Produtos (listar/criar/alterar preço/composição padrão), Empresas (listar/criar/editar/ativar-desativar) e Pedidos (listar/criar/editar via diálogo, equivalente funcional a "Novo Pedido"/"Detalhe do Pedido") **implementados e cobertos por teste automatizado** (`CustomersPage`, `CompaniesPage`, `ProductsPage`, `ProductDetailPage`, `OrdersPage` + respectivos formulários). Auditoria de 2026-08-26 confirmou por leitura de código que Empresas/Pedidos já estavam implementados antes desta rodada — a linha anterior deste documento ("Empresas e Pedidos ainda sem tela") estava desatualizada. Bug corrigido nesta rodada: `CustomerForm` listava empresas inativas no campo "Empresa" (só `OrderForm` filtrava corretamente); agora `CustomersPage.tsx` calcula a lista disponível (empresas ativas + a empresa já vinculada ao cliente em edição, mesmo se desativada depois) e repassa a `CustomerForm`, sem alterar `listCompanies()` — `frontend/src/pages/customers/CustomersPage.tsx`, testes novos em `CustomersPage.test.tsx`. **Extensão substancial em 2026-08-26 (mesmo dia, rodada separada)**: fluxo de gerenciamento de Pedidos implementado — diálogo "Gerenciar pedido" (`OrderManagementPanel.tsx`) com resumo (total, saldo devedor, situação financeira), avanço de status (`change_order_status`, respeitando a máquina de estados linear QUOTE→WAITING_APPROVAL→APPROVED→IN_PRODUCTION_QUEUE→IN_PRODUCTION→WAITING_DELIVERY→DELIVERED, sem pular etapas), cancelamento (`CANCELLED`, só antes de IN_PRODUCTION, com confirmação explícita), registro de pagamento (`register_payment` — Sinal/Final/Integral/Ajuste, validação de valor/soma-nunca-negativa espelhando o backend, `RegisterPaymentForm.tsx`), e histórico combinado (`order_status_history` + `payment_status_history` + `payments`, `frontend/src/lib/api/orderHistory.ts`) — tudo via `useOrderManagement.ts` reaproveitando só Edge Functions/RPCs já existentes, nenhuma nova migration/Edge Function criada. **Aprovação manual (`register_approval`) NÃO tem botão na interface** — decisão deliberada, não lacuna: a RPC rejeita itens CATALOG ("Item CATALOG não exige aprovação") e só CATALOG é criável pelo frontend hoje (Personalizado/Spot seguem "Em breve"), então nenhum item hoje jamais precisaria dessa chamada; avançar para "Aguardando aprovação" já auto-promove a "Aprovado" via `try_auto_approve_order()` para qualquer pedido só-CATALOG, dentro da própria chamada. Filtros rápidos por status adicionados à listagem (`Todos`/8 status, com contagem, locais, combináveis com a busca). Vínculos desativados corrigidos em `OrderForm.tsx`: cliente/empresa já vinculados a um pedido continuam visíveis/selecionados na edição mesmo se desativados depois (mesmo padrão de `CustomerForm`); produto de um item existente, se desativado, aparece rotulado "(inativo)" e continua bloqueando o salvamento, agora com mensagem explicando reativar/substituir (antes: "Produto inválido ou inativo — selecione outro."). Novos arquivos: `OrderManagementPanel.tsx`/`.test.tsx`, `RegisterPaymentForm.tsx`/`.test.tsx`, `useOrderManagement.ts`/`.test.ts`, `lib/api/orderHistory.ts`, `lib/orders/orderStatusMachine.ts`/`.test.ts`; alterados: `OrdersPage.tsx`/`.test.tsx`, `OrderForm.tsx`/`.test.tsx`, `types/domain.ts` (`OrderStatusHistory`/`PaymentStatusHistory`). Suíte completa 1005 → 1092 testes, lint e build sem erros. **Tudo isto é implementação nova, coberta só por teste automatizado (mocks) — nenhuma validação manual do usuário ainda ocorreu**, por isso não altera a Fase 5 nesta entrada (ver validação registrada na entrada seguinte). **Refinamento visual em 2026-08-26 (rodada seguinte, mesmo dia)**: `RegisterPaymentForm.tsx` — "Tipo de pagamento" e "Método de pagamento" passam de `Select` para action buttons/cards com ícone (mesmo padrão de `OrderForm.tsx`: radiogroup, ícone `size-8`, borda/fundo por estado; `PAYMENT_METHOD_ITEMS`/`IconComponent` agora exportados de `OrderForm.tsx` e reaproveitados, não duplicados); campo "Valor" passa a usar o mesmo campo monetário "bancário" de `ProductPriceForm.tsx` (`lib/forms/currencyField.ts`, formatação R$ em tempo real, duas casas, conversão para `number` antes do envio) — `currencyField.ts` **não foi alterado** (zero risco para `ProductPriceForm`), o sinal negativo do Ajuste é um `Switch` adicional só visível quando Tipo = Ajuste; resumo financeiro (Total/Já pago/Saldo devedor) destacado no topo do formulário. `OrderForm.tsx` reorganizado em 3 seções visuais (`FormSection`, mesmo padrão de borda/raio do bloco de Itens já existente) — Seção 1 "Dados do cliente" (Tipo de venda, Empresa se B2B, Cliente/Contato, Entrou em contato por), Seção 2 "Dados do pedido" (Tipo de item, Itens, **Método de pagamento passa a morar aqui**, antes ficava em Entrega), Seção 3 "Entrega" (Forma de entrega, Frete se aplicável, Prazo de entrega, Observações) — numeração de campo reinicia em 1 por seção; nenhum payload, validação, regra de negócio, vínculo inativo corrigido ou modo somente-leitura foi alterado, só a organização visual. Status agora também alterável direto da listagem de Pedidos (`OrderStatusControl.tsx`, coluna Status vira badge clicável exceto em DELIVERED/CANCELLED, que continuam só texto) — reaproveita só `orderStatusMachine.ts` + `changeOrderStatus()` (a mesma função já usada por `useOrderManagement`), nunca uma segunda máquina de estados; exige confirmação, bloqueia duplo clique, mostra erro real do backend, atualiza listagem/contagens via o mesmo `refetch()`; botão "Gerenciar pedido" preservado ao lado para pagamentos/histórico/detalhes. Novo arquivo: `OrderStatusControl.tsx`/`.test.tsx`. Suíte completa 1092 → 1130 testes, lint e build sem erros. **Estes ajustes visuais ainda não foram validados manualmente pelo usuário nesta forma nova** (só teste automatizado) — ver ressalva na Fase 5. **As seis alterações deste refinamento visual (commit `8ea17c0`) foram validadas manualmente pelo usuário em 2026-08-26** — ver Fase 5. **Nova extensão em 2026-08-26 (mesma data, rodada seguinte)**: status financeiro também alterável direto da listagem (`OrderPaymentStatusControl.tsx`) — a coluna "Status financeiro" vira um badge clicável (mesmo padrão visual/acessível de `OrderStatusControl.tsx`, nome acessível `"Registrar pagamento — status financeiro: <label atual>"`, `title` de dica) que abre o mesmíssimo `RegisterPaymentForm.tsx` já usado em "Gerenciar pedido", com Total do pedido/Já pago/Saldo devedor vindos diretamente de `OrderSummary` (`vw_order_summary`, já carregado por `useOrders` — nenhuma nova busca). Reaproveita só `registerPayment()` (a mesma função de `useOrderManagement`), nunca uma segunda lógica de pagamento; `orders.payment_status` continua **exclusivamente derivado** por `recalculate_order_financials()` no backend — este controle nunca escreve nem estima esse campo, só reabre o formulário que já provoca o recálculo real. Auditado no código de `register_payment()`: a função **não verifica `orders.order_status` em nenhum momento** (só existência do pedido via lock e a soma dos pagamentos nunca ficar negativa) — logo não há regra real de backend que bloqueie um pagamento em pedido `CANCELLED`, `PAID` ou com excedente; por isso o controle nunca vira badge sem ação, em nenhum desses casos (comportamento confirmado pelo contrato, não inventado). Novos arquivos: `OrderPaymentStatusControl.tsx`/`.test.tsx`. Suíte completa 1130 → 1155 testes, lint e build sem erros. **Esta extensão ainda não foi validada manualmente pelo usuário** — ver ressalva na Fase 5. **REGRA DE NEGÓCIO REVERTIDA em 2026-08-26 (rodada seguinte, mesmo dia) — bloqueio de pagamento excedente**: até esta entrada, `register_payment()` permitia deliberadamente pagamento acima do saldo devedor ("nenhum estorno automático: pagamento excedente é permitido", rastreado por `vw_order_summary.has_overpayment`/`overpayment_amount`). O usuário confirmou explicitamente a regra oposta: **o total acumulado dos pagamentos nunca pode ultrapassar o total do pedido** (`total_receivable` = `total_value + shipping_cost`, a mesma fórmula/valor já exibido como "Total do pedido"). Backend: nova migration `supabase/migrations/20260826120000_add_payment_overpayment_guard.sql`, `create or replace function public.register_payment(uuid, text, numeric, text, timestamptz, uuid, text)` — mesma assinatura de tipos da função original (Migration `20260814030351`), portanto substitui a mesma entrada de catálogo/OID em vez de criar uma sobrecarga nova; adiciona `raise exception` quando `v_new_total > v_total_receivable`, reaproveitando o mesmo lock `for update` sobre `orders` já usado pela checagem de soma-nunca-negativa (nenhuma nova estratégia de concorrência: a mesma linha travada agora também é lida para `total_value`/`shipping_cost`, serializando pagamentos concorrentes do mesmo pedido contra os dois limites). **Esta migration existe só localmente — NÃO foi aplicada ao projeto Supabase remoto nesta rodada** (restrição explícita do usuário; aplicar requer autorização separada). Frontend: `RegisterPaymentForm.tsx` ganha validação-espelho (bloqueia localmente com "O valor não pode ultrapassar o saldo devedor. Valor máximo permitido: R$ X,XX." antes mesmo de chamar o backend) e um novo estado "totalmente pago" (`balanceDue <= 0`) que substitui o formulário por um aviso e desabilita o registro de novo pagamento — aplicado sem exceção para AJUSTE/estorno negativo também, decisão conservadora por a instrução do usuário não abrir exceção; resumo financeiro (Total/Já pago/Saldo devedor) continua visível mesmo nesse estado. `OrderPaymentStatusControl.tsx` (badge "Status financeiro" da listagem) e `OrderManagementPanel.tsx` herdam o mesmo bloqueio automaticamente, por reaproveitarem o mesmíssimo `RegisterPaymentForm.tsx` — nenhuma lógica duplicada; o badge da listagem continua mostrando o texto "Pago" normalmente, só o formulário de registro fica bloqueado. `vw_order_summary.has_overpayment`/`overpayment_amount` permanecem no schema sem alteração, agora só como proteção histórica para dados legados anteriores a esta regra (nunca deveriam ficar diferentes de `false`/`0` para pagamentos novos). Testes novos cobrindo os 8 cenários exigidos (inferior ao saldo, exatamente igual, um centavo acima, pedido já totalmente pago, valores zero/negativos — já cobertos pela regra pré-existente de soma-nunca-negativa, duas parcelas somando exatamente o total, tentativa que ultrapassa o total, tratamento da mensagem de erro real do backend no frontend) em `RegisterPaymentForm.test.tsx` (31 testes) e `OrderPaymentStatusControl.test.tsx` (18 testes, incluindo reescrita do teste que antes validava o excedente sendo permitido — invalidado pela reversão da regra). Suíte completa 1155 → 1167 testes, lint 0 erros, build sem erros. Ambiente desta sessão não tem Deno/Supabase CLI/Docker instalados — a migration não pôde ser executada/validada contra um Postgres local, só revisada por leitura. **Migration aplicada ao Supabase remoto em 2026-08-26 (rodada seguinte)**: `npx supabase db push --linked` no projeto `tjhacqreupfqefntjevf`, confirmando 29/29 migrations sincronizadas local/remoto (antes 28/29, só `20260826120000` pendente); verificação somente leitura via `db query --linked` confirmou a definição ao vivo de `register_payment()` idêntica ao arquivo local, sem sobrecarga duplicada; nenhuma Edge Function, seed ou dado alterado. **Validação manual do usuário aprovada em seguida, com registros de teste**, cobrindo os 10 cenários do bloqueio de excedente pela listagem — ver detalhamento na Fase 5 |
| 5. Integração E2E | ✅ 100% | 14,29% | **Cinco blocos de validação manual do usuário aprovados em 2026-08-26** (Blocos 1–4 já registrados nas entradas anteriores: Clientes/Empresas, Produtos, fluxo completo de Pedidos, refinamento visual do commit `8ea17c0`). **Bloco 5 (nesta entrada, com registros de teste)** — bloqueio de pagamento excedente validado ponta a ponta: (1) abertura do pagamento pelo status financeiro da listagem; (2) exibição correta de Total/Já pago/Saldo; (3) registro de pagamento parcial; (4) atualização do status financeiro e saldo; (5) bloqueio de pagamento um centavo acima do saldo; (6) mensagem com o valor máximo permitido; (7) confirmação de que nenhum pagamento excedente foi registrado; (8) pagamento exatamente igual ao saldo aceito; (9) atualização para situação "Pago"; (10) bloqueio de novo pagamento com saldo zerado. A proteção de backend (`register_payment()`, migration `20260826120000_add_payment_overpayment_guard.sql`) está **aplicada e confirmada no Supabase remoto** (`tjhacqreupfqefntjevf`, 29/29 migrations sincronizadas) — a validação manual exercitou a proteção real de produção, não só o espelho client-side. Isso completa os critérios de aceite de Pedidos do Módulo 1 (`04_PLANO_IMPLEMENTACAO.md` §6) alcançáveis no escopo MVP atual (CATALOG-only; "classificar tipos" permanece N/A enquanto Personalizado/Spot não forem implementados). **Fase 5 concluída para o escopo atualmente implementado** — Piloto real (Fase 6) pode avançar |
| 6. Piloto real | ❌ 0% | 0% | Depende da Fase 5 completa — **não iniciado, não marcado como concluído**. **Decisão do usuário em 2026-08-27**: antes de finalizar as Fases 6 e 7 do Módulo 1, será concluída a continuação do Módulo 3 (Estoque e Inventário — saldo, movimentações, filamentos, consumo automático pelo pedido, integração completa com Pedidos/Produtos). Módulo 1 permanece tecnicamente pronto para o Piloto real no escopo atual (MVP CATALOG-only), mas aguarda essa integração antes de avançar — ver §9b abaixo |
| 7. Estabilização / release | ❌ 0% | 0% | Depende da Fase 6 — **não iniciado, não marcado como concluído**. Mesma decisão acima: aguarda a conclusão da integração de Estoque |

**Percentual macro: (100+100+100+100+100+0+0) / 7 = 500/7 ≈ 71%.**

**Status OPERACIONAL: PARCIAL** — backend pronto e testado via API, incluindo a composição padrão
de produtos (Migrations 18–19 aplicadas no remoto, Edge Function `products` deployada, rota
`PATCH /products/:id/composition` validada por smoke test real ponta a ponta); frontend de
Clientes, Empresas, Produtos e Pedidos funciona localmente contra o Supabase remoto real
(1167/1167 testes automatizados passando, lint e build sem erros). **Cinco blocos de validação
manual do usuário aprovados em 2026-08-26**: (1) correção do bug de empresas inativas em Clientes;
(2) composição de produto com acessório/embalagem sem custo; (3) **fluxo completo de Pedidos**
(criar pedido, avançar status, registrar pagamento, avançar até entrega, cancelar, filtrar por
status); (4) **as seis alterações visuais do commit `8ea17c0`** (action buttons de Tipo/Método de
pagamento, campo de valor no padrão bancário, `OrderForm.tsx` em 3 seções, status do pedido
alterável direto da listagem); (5) **bloqueio de pagamento excedente**, com registros de teste —
status financeiro pela listagem, pagamento parcial, pagamento integral/exato, bloqueio de valor
acima do saldo com mensagem do máximo permitido, e pedido totalmente pago bloqueando novo
pagamento. A proteção de backend correspondente (migration
`20260826120000_add_payment_overpayment_guard.sql`) está **aplicada e confirmada no projeto
Supabase remoto `tjhacqreupfqefntjevf`** (29/29 migrations sincronizadas) — a validação exercitou a
proteção real de produção. **Fluxo E2E do Módulo 1 concluído para o escopo MVP atualmente
implementado** (CATALOG-only; Personalizado/Spot seguem fora de escopo). Hospedagem pública ainda
inativa (Vercel configurada em código desde `ecfc510`, mas publicação **deliberadamente adiada**
até o início da Fase 6 — ver §9). **Piloto real (Fase 6) e Estabilização/release (Fase 7)
permanecem não iniciados** — próxima etapa recomendada é a Fase 6. **Módulo 1 permanece não
concluído** (Fases 6–7 pendentes).

## Próximo marco

Fase 4 (Frontend) do Módulo 1 concluída, incluindo o fluxo completo de gerenciamento de Pedidos
(status/cancelamento/pagamento/filtros/histórico), o refinamento visual dessas mesmas telas
(`RegisterPaymentForm.tsx` com action buttons e campo monetário bancário; `OrderForm.tsx` em 3
seções; status do pedido alterável direto da listagem via `OrderStatusControl.tsx`) e, na
sequência da mesma data, o status financeiro também alterável direto da listagem
(`OrderPaymentStatusControl.tsx`, reaproveitando `RegisterPaymentForm.tsx`/`registerPayment()`).
O fluxo funcional principal de Pedidos e as seis alterações visuais do commit `8ea17c0` já foram
**validados manualmente pelo usuário em 2026-08-26**, elevando a Fase 5 para ~60% — mas essa
validação **não cobre** a extensão mais recente (status financeiro na listagem), implementada
depois. Próximo passo: validação manual do usuário especificamente do checklist desta rodada
(badge de status financeiro clicável, abertura do `RegisterPaymentForm` com os totais corretos,
registro de pagamento parcial/integral/excedente/ajuste a partir da listagem) antes de considerar
a Fase 5 concluída e iniciar a Fase 6 (piloto real). Publicação no Vercel continua fora de escopo
até a conclusão da roadmap (ver §9).

---

# 4. Módulo 0 — Fundação e Segurança (referência — já avançado)

| Fase | Status | Peso | Observação |
| --- | --- | --- | --- |
| 1. Definição funcional | ✅ 100% | 14,29% | |
| 2. Modelo e regras | ✅ 100% | 14,29% | Tabela `users` + triggers de sincronização com Auth **implementados** |
| 3. Backend | ✅ 100% | 14,29% | Supabase Auth (e-mail/senha) **configurado e em uso** |
| 4. Frontend | ✅ 100% | 14,29% | Concluído para autenticação: login, contexto de auth, rota protegida |
| 5. Integração E2E | ✅ 100% | 14,29% | Login validado ponta a ponta pelo navegador |
| 6. Piloto real | 🟡 ~50% | 7,14% | Em uso no dia a dia de desenvolvimento, mas sem validação formal |
| 7. Estabilização / release | 🟡 ~50% | 7,14% | Falta validação formal de segurança/RLS |

**Percentual macro: (100+100+100+100+100+50+50) / 7 = 600/7 = 85,71% ≈ 86%.**

**Status OPERACIONAL: Quase operacional / validar formalmente.**

---

# 5. Módulos 2–10 — visão macro (não iniciados na prática; parte já especificada)

Todos têm a Fase 1 concluída (documentada nos docs `01`/`03`) e parte da Fase 2 já especificada
no modelo de banco de dados (`03`). A especificação conta como progresso real (ver §1), mas não
deve ser lida como implementação. Exceção: o Módulo 3 (Estoque) já tem Edge Functions e tela
próprias — mas só para o cadastro mestre de `accessories`/`packaging`, antecipado pelo Módulo 1
(Migration 18); nenhum outro módulo desta seção (2, 4–10) tem Edge Function ou tela criada; e o
próprio Módulo 3 segue sem nenhuma implementação de inventário físico — ver nota na linha do
Módulo 3.

| Módulo | Fase 1 — Definição funcional | Fase 2 — Modelo e regras | Fases 3–7 |
| --- | --- | --- | --- |
| 2 — Produção | ✅ 100% (doc 01 §12–14) | 🟡 50% — especificado (doc 03 §10–11), sem migrations | ❌ 0% |
| 3 — Estoque e Inventário | ✅ 100% (doc 01 §15–21) | 🟡 50% — `accessories`/`packaging` (doc 03 §13) **implementados** (Migration 18, antecipados pelo Módulo 1 só como cadastro mestre); `filament_types`, `spool_tares`, `filament_spools`, `suppliers`, `stock_movements`, `stock_reservations`, `inventories`, `inventory_items` (doc 03 §12, §14–16) continuam apenas especificados, sem migration; nenhuma regra de negócio de estoque físico (saldo/entrada/saída/ajuste/reserva/consumo) implementada | 🟡 Cadastro mestre de Acessórios/Embalagens **concluído**: backend (Edge Functions `accessories`/`packaging`, CRUD completo) deployado e frontend (`/estoque`, `/estoque/acessorios`, `/estoque/embalagens`) implementado, testado e validado manualmente pelo usuário contra o backend remoto — ver §9. **Isto é só o cadastro mestre (nome/tamanho/variante/estoque mínimo/custo unitário/ativo) — não é inventário físico**: não existe saldo, quantidade em mão, entrada, saída nem ajuste de estoque em nenhuma tabela ou tela do projeto (confirmado por leitura de todas as 27 migrations em `supabase/migrations/`). Cadastro oficial (incl. Petlink) segue bloqueado por autorização — ver §6 |
| 4 — Precificação e Rentabilidade | ✅ 100% (doc 01 §22–30) | 🟡 50% — especificado (doc 03 §17–18), sem migrations | ❌ 0% |
| 5 — Manutenção e Equipamentos | ✅ 100% (doc 01 §65) | 🟡 50% — especificado (doc 03 §24), sem migrations | ❌ 0% |
| 6 — Onboarding, Alertas e Gestão | ✅ 100% (doc 01 §3, §59–66) | 🟡 50% — `alerts`/`notifications` especificados (doc 03 §22); escala (§25) especificada; reaproveita `parameters` do Módulo 4 (também não implementado) | ❌ 0% |
| 7 — Sky Assistente em Texto | ✅ 100% (doc 01 §52–60, §73) | ⚪ N/A (0% no cálculo) — não modela tabelas próprias, reaproveita módulos já modelados | ❌ 0% |
| 8 — Sky Assistente por Voz | ✅ 100% (doc 01 §54–55, §69) | ⚪ N/A (0% no cálculo) — reaproveita Módulo 7 | ❌ 0% |
| 9 — Divulgação e Marketing | ✅ 100% (doc 01 §31–43) | 🟡 50% — especificado (doc 03 §21), sem migrations | ❌ 0% |
| 10 — Integrações Externas | ✅ 100% (doc 01 §44–51, §69) | 🔴 0% — sem modelo de dados definido por integração; depende de prova técnica | ❌ 0% |

---

# 6. Gatilhos de retorno pendentes

Pendências que devem **pausar o roadmap corrente** quando sua condição de disparo for
satisfeita, para retomar um trabalho já entregue parcialmente em outro módulo. Nenhum item
desta seção conta como concluído nem altera os percentuais das seções 2/3/5 — é só um lembrete
formal de retomada.

| Gatilho | Condição de disparo | Ação ao disparar | Status |
| --- | --- | --- | --- |
| Ficha Técnica do Produto — detalhamento completo de custos | Estrutura oficial de custos de material, energia, máquina, perdas, MDO e margem estiver implementada no banco (Módulo 4 — Precificação e Rentabilidade, Fase 2/3 — hoje só especificada em `03_MODELO_BANCO_DADOS.md` §18.1 `pricing_calculations` e §10.1 `printers`/§12.1 `filament_types`, sem nenhuma migration) | Pausar o roadmap corrente e retornar à Ficha Técnica do Produto (Módulo 1, `frontend/src/pages/products/ProductDetailPage.tsx`) para implementar o detalhamento completo de custos, custo total e margem — hoje a ficha já cobre Identificação, Produção, Acessórios, Embalagens e Subtotal de componentes (Incrementos 1–2); seguem pendentes material, energia, máquina, perdas, MDO, custo total e margem | ⏳ Pendente — não disparado |
| Cadastro oficial de acessórios/embalagens mestres e composição de produtos (incl. Petlink) | Módulo 3 — Estoque e Inventário possuir uma **interface funcional e validada** para cadastrar acessórios e embalagens mestres | Avisar o usuário de que a interface de Estoque está disponível, para que ele faça os cadastros oficiais de acessórios/embalagens e complete a composição dos produtos existentes — incluindo o cadastro oficial da Petlink já presente no ambiente, hoje sem composição associada | ✅ **Condição satisfeita desde 2026-08-24** (corrige texto anterior desatualizado, que ainda afirmava "interface de Estoque ainda não existe" — a interface de cadastro mestre foi implementada, publicada no Supabase remoto e validada manualmente pelo usuário nessa data, ver §9/§10). **A ação ainda NÃO foi executada**: o cadastro oficial (incl. Petlink) continua bloqueado até autorização explícita separada do usuário para tocar dados oficiais — a existência da interface não libera isso automaticamente. Aguardando essa autorização. |
| Filtros rápidos por status na listagem de Pedidos | Os fluxos de status operacional (`order_status`) e status financeiro (`payment_status`) de Pedidos estarem **funcionais e validados de ponta a ponta** (hoje esses campos existem só como dados exibidos/traduzidos na listagem — `OrdersPage.tsx` — e podem ser ordenados/pesquisados por texto exibido, mas não há nenhuma transição de status operacional/financeiro implementada nem validada nesta rodada) | Retornar à listagem de Pedidos e criar botões de filtro rápido por status operacional e financeiro, incluindo "Aguardando pagamento" e os demais estados disponíveis (`ORDER_STATUS_LABELS`/`PAYMENT_STATUS_LABELS` já existentes em `OrdersPage.tsx`) | ⏳ Pendente — não disparado (fluxos de status ainda não são funcionais/validados) |

---

# 8. Regra permanente — padrão de novas listagens e módulos

Regra permanente do Forma Sky, registrada em 2026-08-22 durante o planejamento do Módulo 3
(Estoque): **"Toda nova listagem ou módulo deverá nascer seguindo o padrão visual e funcional
consolidado em Clientes, Produtos, Empresas e Pedidos."**

O padrão inclui, no mínimo:

- `AppLayout` e navegação global existentes;
- identidade visual e tokens oficiais da Forma 3D Studio;
- margens, espaçamentos e densidade já aprovados nas páginas existentes;
- tabela no padrão existente (`table-fixed`, distribuição de colunas consistente);
- linhas ímpares em roxo suave, linhas pares em branco;
- hover no padrão Forma;
- truncamento de textos longos com `title`;
- coluna de ações compacta;
- `Switch` de Ativo padronizado;
- busca rápida;
- filtros pertinentes ao módulo;
- ordenação por coluna;
- estado de carregamento (loading);
- estado de erro;
- estado de lista vazia;
- estado específico de busca/filtro sem resultado;
- acessibilidade, foco visível e operação por teclado;
- responsividade;
- testes correspondentes.

Nenhum módulo novo deve criar uma identidade visual paralela; componentes, utilitários e tokens já
aprovados (`AppLayout`, `SearchAutocomplete`, `SortableColumnHeader`, `sorting.ts`,
`textSearch.ts`) devem ser reutilizados quando tecnicamente adequados, sem refatoração ampla dos
módulos já existentes.

---

# 9. Módulo 3 — Estoque e Inventário: plano de cadastro mestre (em implementação)

Planejamento aprovado em 2026-08-22 para a interface de cadastro mestre de `accessories`/
`packaging` (Bloco 1, Migration 18) — cobre definição funcional e regras de negócio do cadastro
mestre. Plano dividido em 8 incrementos (Incremento 1 = esta documentação). Cadastro oficial
(incluindo a composição da Petlink) segue não liberado até a interface estar completa (leitura +
escrita) e validada em produção — ver gatilho pendente em §6.

**Progresso registrado em 2026-08-23** (implementado e testado localmente, nada deployado/liberado
ainda):

- **Incremento 2** — backend protegido de Acessórios (`create_accessory`/`update_accessory`/
  `delete_accessory`, Edge Function `accessories`) implementado e testado localmente (Deno +
  Vitest); migration criada, **não aplicada remotamente**.
- **Incremento 3** — mesmo backend espelhado para Embalagens (`create_packaging`/
  `update_packaging`/`delete_packaging`, Edge Function `packaging`); mesma situação (local,
  testado, não aplicado remotamente).
- **Incremento 4** — listagem de Estoque no frontend (`/estoque`, `/estoque/acessorios`,
  `/estoque/embalagens`, `InventoryPage.tsx`): consulta, busca, filtro por status e ordenação para
  as duas áreas (Acessórios e Embalagens), reaproveitando o padrão visual já aprovado em
  Clientes/Produtos/Empresas/Pedidos. **Somente leitura nesta etapa** — nenhuma criação, edição,
  exclusão ou ativação/desativação está disponível na tela. A coluna "Ativo" desta listagem é
  **só um indicador informativo** (badge de texto "Ativo"/"Inativo"), não um controle interativo;
  não existe coluna de ações (editar/excluir) nesta etapa. Validação manual da área
  `/estoque/acessorios` aprovada pelo usuário em 2026-08-23.
- Criação/edição/ativação/desativação/exclusão pela interface (conectando as RPCs dos Incrementos
  2/3 às telas) continuam **pendentes** — cadastro oficial de acessórios/embalagens (e a
  composição da Petlink) segue bloqueado até essas operações existirem, serem testadas e o backend
  ser deployado com autorização explícita.

**Progresso registrado em 2026-08-24** (backend publicado e sincronizado; criação, edição,
ativação/desativação e exclusão segura completas na interface, validadas manualmente contra o
backend remoto):

- **Incrementos 2/3** — migrations `20260822120000`/`20260823120000` (RPCs `create_accessory`/
  `update_accessory`/`delete_accessory` e equivalentes de `packaging`) **aplicadas no projeto
  Supabase remoto** (`tjhacqreupfqefntjevf`); Edge Functions `accessories`/`packaging`
  **publicadas e ativas** (`supabase functions deploy`). 28/28 migrations do projeto sincronizadas,
  nenhuma pendente.
- **Incremento 4 e seguintes** — a interface de Estoque deixou de ser somente leitura: criação,
  edição, ativação/desativação (com confirmação explícita) e exclusão física segura (bloqueada
  quando há vínculo em `product_accessories`/`product_packaging`, orientando desativação em vez de
  excluir) estão implementadas para Acessórios e Embalagens, com testes automatizados (frontend +
  Deno) e **validação manual no navegador aprovada pelo usuário contra o backend remoto**.
- Cadastro oficial (incluindo a composição da Petlink) **continua bloqueado** — a interface estar
  completa e validada não libera automaticamente o cadastro oficial; isso depende de autorização
  explícita separada, conforme §6.

Regras de campos/tamanho/custo/exclusão aprovadas: ver `03_MODELO_BANCO_DADOS.md` §13.3.

### Padrão visual e funcional

Segue a regra permanente registrada em §8 (Clientes/Produtos/Empresas/Pedidos como referência) —
nenhuma identidade paralela.

### Busca, filtros e ordenação

Acessórios e Embalagens terão estados de busca/filtro/ordenação **independentes** entre si (nunca
compartilhados).

- Busca por: Nome, Tamanho, Variante.
- Filtros: Status (Todos/Ativos/Inativos); Tamanho (Todos/Não se aplica/PP/P/M/G/GG); Custo
  (Todos/Custo disponível/Custo não informado); ação "Limpar filtros"; indicação visual de filtros
  ativos.
- Ordenação: Nome, Tamanho (ordem semântica PP < P < M < G < GG, não alfabética), Variante, Custo,
  Estoque mínimo, Ativo — valores vazios sempre em posição previsível (ao final, independente da
  direção).
- Busca e filtros serão **locais** (sobre a lista já carregada), conforme o padrão já usado em
  Clientes/Produtos/Empresas/Pedidos, e **não serão persistidos na URL** nesta etapa.

### Rotas planejadas (decisão técnica, não implementada)

`/estoque`, `/estoque/acessorios`, `/estoque/embalagens` — a entrada "Estoque" da navegação deverá
permanecer marcada como ativa nas duas sub-rotas. Esta é só uma decisão registrada; `App.tsx` e
`AppLayout.tsx` não foram alterados por esta entrada.

### Contratos de escrita — decisão pendente antes do Incremento 2

Ainda **não está decidido definitivamente** se criação/edição/ativação/desativação usarão acesso
autenticado direto ao Supabase ou uma Edge Function dedicada. Requisitos já fixados,
independentemente de qual opção for escolhida:

- toda escrita exige autenticação, validação e tratamento padronizado de erro;
- exclusão obrigatoriamente passa por function/RPC protegida via Edge Function (nunca acesso
  direto) — ver `03_MODELO_BANCO_DADOS.md` §13.3;
- a decisão entre acesso direto e Edge Function para criar/editar/ativar/desativar será tomada
  explicitamente antes do Incremento 2 — a recomendação preferencial registrada é Edge Function,
  por consistência, validação centralizada e auditoria futura;
- nenhuma operação remota (migration, deploy, escrita em produção) será executada sem autorização
  explícita separada.

### Status

Definição funcional: ✅ aprovada. Regras do cadastro mestre: ✅ aprovadas (ver doc `03` §13.3).
Backend protegido (Acessórios e Embalagens, Incrementos 2–3): ✅ implementado, testado e
**publicado no projeto Supabase remoto** (Edge Functions `accessories`/`packaging` ativas,
migrations aplicadas). Interface de Estoque (listagem, busca, filtros, ordenação, criação, edição,
ativação/desativação, exclusão segura): ✅ implementada, testada e **validada manualmente pelo
usuário contra o backend remoto** para Acessórios e Embalagens. Hospedagem pública do frontend:
⏳ configurada no código (Vercel, `frontend/vercel.json` — procedimento completo no `README.md`
da raiz), mas a **publicação foi deliberadamente adiada até a conclusão desta roadmap** — decisão
confirmada em 2026-08-26, não um bloqueio técnico; nenhum deploy foi executado, URL não existe.
Cadastro oficial: 🔒 ainda não liberado — depende de autorização
explícita separada (§6), independente do estado técnico acima. Plano: 8 incrementos definidos,
backend e interface tecnicamente completos e publicados. O percentual macro (seções 2/5) deste
roadmap não foi recalculado nesta entrada — fica registrado como pendência para uma próxima
atualização dedicada do documento.

---

# 9b. Módulo 3 — Estoque e Inventário: plano de operações de estoque (novo, 2026-08-27)

**Não confundir com o plano de 8 incrementos de §9** (esse era só sobre a interface de cadastro
mestre de `accessories`/`packaging`, já concluído). Este é um plano **novo e separado**, aprovado
pelo usuário em 2026-08-27, para o motor real de saldo/movimentação/consumo de estoque — 9
incrementos, dos quais só o primeiro foi implementado nesta rodada.

## Regras operacionais aprovadas (22 regras, 2026-08-27)

**Regras operacionais do MVP — versão inicial para validação, sujeitas a revisão após o teste
prático do usuário.** A aprovação do usuário em 2026-08-27 autoriza **construir o MVP** com estas
22 regras — **não as torna definitivas**. Tipos de movimentação poderão ser ampliados ou
revisados; reserva, consumo, cancelamento, pesagem, escolha de rolo e perdas continuam **só
intenção aprovada**, aguardando validação prática antes de qualquer implementação. O Incremento 1
(único implementado até agora) cobre **somente o núcleo seguro de saldo e movimentações manuais**
de Acessórios/Embalagens — nenhuma das regras futuras abaixo tem código ainda, e nenhuma delas
deve ser lida como validada. O ledger e o histórico de `stock_movements` são imutáveis desde já e
permanecem imutáveis mesmo quando essas regras forem revisadas: correções futuras acontecem por
**novas movimentações e novas migrations**, nunca reescrevendo uma linha já gravada. O Módulo 3 só
avançará para validação operacional real quando existir **interface utilizável** (Incremento 2 em
diante, ainda não iniciado).

Documentadas com detalhe funcional em `01_ESPECIFICACAO_FUNCIONAL.md` §16/§18/§19/§20 e com
detalhe de schema em `03_MODELO_BANCO_DADOS.md` §15.1. Resumo: acessórios/embalagens controlados
em unidades inteiras; estoque inicial registrado como movimentação "Saldo inicial" (nunca
`UPDATE` direto); entradas (Saldo inicial/Compra/Devolução/Ajuste positivo) e saídas manuais
(Perda-Avaria/Amostra-Doação/Uso interno/Ajuste negativo) definidas; saldo negativo proibido;
reserva na Fila de produção, consumo de acessórios/filamento ao iniciar produção, consumo de
embalagens em Aguardando entrega (todos ainda não implementados); cancelamento antes do consumo
libera reserva automaticamente, depois do consumo não devolve automaticamente (devolução sempre
manual); falha/reimpressão lançada manualmente até existir o Módulo de Produção; escolha de rolo
de filamento (aberto primeiro, depois mais antigo, consumo divisível entre rolos), pesagem gera
ajuste pela diferença, perdas sempre exigem motivo, tipo de filamento = material+fabricante+
linha+cor, peso nominal livre por rolo (1.000 g só sugestão), múltiplos rolos por tipo, ficha do
produto deverá futuramente aceitar múltiplos filamentos/cores — tudo isto **especificado**;
proteção contra duplicidade por pedido/item/evento em movimentações automáticas — **implementada**
já neste Incremento 1 (via `idempotency_key`), mesmo sem nenhuma movimentação automática existir
ainda.

## Incremento 1 — saldo e motor de movimentações (Acessórios/Embalagens) — IMPLEMENTADO LOCALMENTE

Implementado em 2026-08-27, na branch `feature/inventory-operations` (partindo de `45dac99`):

- `public.stock_movements` — ledger imutável (migration
  `20260827090000_create_stock_movements_table.sql`), suporta `item_type`
  `ACCESSORY`/`PACKAGING` (extensível a `FILAMENT_SPOOL` sem remodelagem completa) e 8
  `movement_type` manuais (`INITIAL_BALANCE`/`PURCHASE`/`RETURN`/`POSITIVE_ADJUSTMENT`/`LOSS`/
  `SAMPLE_DONATION`/`INTERNAL_USE`/`NEGATIVE_ADJUSTMENT`). RLS habilitada, `SELECT` para
  `authenticated`, nenhum `INSERT`/`UPDATE`/`DELETE` concedido a nenhuma role de sessão.
- `public.register_stock_movement(...)` — única função que escreve em `stock_movements` e em
  `accessories.current_stock`/`packaging.current_stock`, na mesma transação (`FOR UPDATE` no item,
  bloqueio de saldo negativo, motivo obrigatório por tipo, regras de `INITIAL_BALANCE`,
  idempotência via `idempotency_key`). `security definer`, `EXECUTE` só para `service_role`.
- `delete_accessory()`/`delete_packaging()` atualizadas (migration
  `20260827093000_update_accessory_packaging_delete_guards.sql`, mesma assinatura, sem sobrecarga
  nova) — agora também bloqueiam exclusão física quando o item tem qualquer movimentação
  registrada (`ACCESSORY_HAS_STOCK_HISTORY:`/`PACKAGING_HAS_STOCK_HISTORY:`), além do bloqueio já
  existente por vínculo em `product_accessories`/`product_packaging`.
- Teste de integração SQL completo (`supabase/tests/inventory_movements_test.sql`, mesmo padrão de
  `bloco1_integration_test.sql`) cobrindo saldo inicial, entradas, saídas com motivo obrigatório,
  bloqueio de saldo negativo, saldo exatamente zerado, item/tipo inválido, quantidade fracionada
  rejeitada, idempotência (mesmo payload vs. payload diferente), imutabilidade (UPDATE/DELETE
  bloqueados para `authenticated`), exclusão segura com histórico, item desativado preservando
  saldo/histórico, usuário inválido/inexistente, grants.

**Fora de escopo desta rodada** (Incrementos 2–9, todos pendentes): interface de movimentações,
histórico no frontend, filamentos, rolos, pesagens, `RESERVATION`/`RELEASE`/`CONSUMPTION`,
integração com `change_order_status`, produção.

**Correção adicional em 2026-08-27 (mesmo dia, rodada seguinte, antes da aplicação remota)**:
revisão corretiva do Incremento 1 encontrou e corrigiu uma lacuna real de idempotência
concorrente em `register_stock_movement()` — duas chamadas com a mesma `idempotency_key` para
itens DIFERENTES, sob concorrência real (duas conexões), podiam terminar com um `unique_violation`
bruto em vez da mensagem estável `IDEMPOTENCY_KEY_CONFLICT:`; corrigido com um bloco
`BEGIN/EXCEPTION WHEN unique_violation` em volta do `INSERT`, mais normalização de
`reference_type` consistente com `reason`. As 22 regras aprovadas foram também explicitamente
rotuladas nos 4 documentos como **"Regras operacionais do MVP — versão inicial para validação,
sujeitas a revisão após o teste prático do usuário"** — aprovação autoriza construir o MVP, não
torna as regras definitivas; nenhuma regra futura (reserva/consumo/cancelamento/pesagem/escolha de
rolo/perdas) aparece como validada. Checkpoint local: commit `fix: harden inventory ledger
validation`, sem push, sem migration aplicada.

**Aplicação e validação remota em 2026-08-27 (mesmo dia, rodada seguinte)**: as duas migrations
foram **aplicadas ao projeto Supabase remoto `tjhacqreupfqefntjevf`** via `npx supabase db push
--linked` — 31/31 migrations agora sincronizadas local/remoto (antes 29/31). Verificação somente
leitura confirmou que a definição ao vivo de `stock_movements` (colunas, constraints, índices,
incl. o índice único parcial de `idempotency_key`), RLS/policies/grants e as três funções
(`register_stock_movement`, `delete_accessory`, `delete_packaging`, cada uma com assinatura única,
sem sobrecarga duplicada) correspondem exatamente aos arquivos locais. Em seguida, o teste de
integração SQL (`supabase/tests/inventory_movements_test.sql`) foi executado contra o remoto
dentro de uma transação `BEGIN...ROLLBACK` — **40 PASS, 1 SKIP (ambiente sem usuário inativo
disponível, não é falha), 0 FAIL**; consultas somente leitura pós-teste confirmaram **zero
resíduo** (nenhum acessório/embalagem/movimentação de teste persistido, `stock_movements` com 0
linhas, nenhum `current_stock` oficial alterado, nenhum usuário oficial alterado). Smoke test do
CRUD existente: testes frontend de `InventoryPage`/`InventoryItemForm` (108/108, sem regressão);
testes Deno de `accessories`/`packaging` **não executados** — ambiente sem Deno, mesma limitação já
registrada em rodadas anteriores. **Backend do Incremento 1 está agora aplicado e validado por
teste automatizado real contra o banco remoto** — mas isso ainda não substitui a validação manual
do usuário nem a existência de uma interface (Incremento 2, ainda não implementado). Checkpoint
local: commit `docs: record inventory ledger deployment`, sem push.

## Incrementos 2/3 — interface de movimentações e histórico (MVP) — IMPLEMENTADOS LOCALMENTE

Implementados em 2026-08-27, na branch `feature/inventory-operations`, reunindo os dois
incrementos numa só rodada (interface de saldo/entrada/saída/ajuste + histórico/rastreabilidade —
o pedido do usuário explicitamente os agrupou, por serem uma única superfície de UI coesa). As 22
regras aprovadas continuam **provisórias do MVP** (disclaimer completo em
`01_ESPECIFICACAO_FUNCIONAL.md` §20) — esta interface existe para o usuário **validar** as regras
na prática, não para confirmá-las como definitivas.

**Backend (nenhuma migration nova — só código de aplicação, conforme o escopo desta rodada)**:

- `supabase/functions/stock-movements/` — nova Edge Function (`index.ts`/`handler.ts`/
  `handler.test.ts`), única rota `POST /stock-movements`, chamando exclusivamente
  `register_stock_movement()` (RPC já aplicada e testada na rodada anterior). Validação estrutural
  do payload (item_type/movement_type/quantity inteiro positivo/motivo obrigatório por tipo) vive
  na Edge Function; regras que dependem do banco (saldo insuficiente, INITIAL_BALANCE repetido/
  exige saldo zero, item existe, idempotência) continuam exclusivas da RPC — mesmo critério já
  usado por `accessories`/`packaging`. Nenhuma escrita direta em `stock_movements` nem em
  `current_stock` a partir desta função. **Ainda NÃO publicada** — só criada localmente.
- `supabase/functions/_shared/errors.ts` — 8 novos padrões estáveis mapeados
  (`STOCK_INSUFFICIENT_BALANCE:`, `INITIAL_BALANCE_ALREADY_EXISTS:`, `INITIAL_BALANCE_REQUIRES_ZERO:`,
  `IDEMPOTENCY_KEY_CONFLICT:`, `ACCESSORY_HAS_STOCK_HISTORY:`, `PACKAGING_HAS_STOCK_HISTORY:`, mais
  as mensagens de validação estrutural de `register_stock_movement`), preparando o mapeamento de
  erro compreensível pedido para quando a Edge Function for publicada.
- `supabase/config.toml` — `[functions.stock-movements]` registrada (`verify_jwt = false`, mesmo
  padrão das demais — a Edge Function resolve o operador via `resolveOperator()`, não pelo gateway).

**Frontend**:

- Tipos novos em `types/domain.ts`: `StockItemType`, `StockMovementType` (8 valores manuais desta
  etapa), `StockMovement` (ledger completo, incl. `balance_before`/`balance_after`).
  `Accessory`/`Packaging.current_stock` já existiam no tipo desde antes — só passam a ser
  exibidos/usados agora.
- `lib/api/stockMovements.ts` — `listStockMovements` (leitura direta via supabase-js, RLS já
  aplicada, `authenticated` só SELECT) e `registerStockMovement` (via Edge Function). Histórico
  limitado a 50 registros mais recentes por item (`occurred_at`/`created_at` decrescente) — **sem
  paginação real neste MVP**, documentado aqui como pendência futura caso um item acumule mais
  movimentações do que isso (nenhuma é apagada do banco, só não aparece nesta consulta).
- `hooks/useStockMovements.ts` — histórico + registro por item, sem refetch após `register`
  (a RPC já devolve a movimentação completa, incl. `balance_after`).
- `hooks/useAccessories.ts`/`usePackaging.ts` — novo `setLocalStock(id, currentStock)`: atualização
  local pura (sem rede), usada pelo painel depois de uma movimentação bem-sucedida.
- `components/inventory/StockMovementForm.tsx` — action buttons com ícones Lucide (padrão de
  `RegisterPaymentForm.tsx`/`OrderForm.tsx`): 1º nível Entrada/Saída/Ajuste, 2º nível conforme a
  categoria (Saldo inicial/Compra/Devolução; Ajuste positivo/negativo; Perda-Avaria/
  Amostra-Doação/Uso interno). Quantidade inteira positiva, projeção "Saldo após movimentação",
  bloqueio de saída acima do saldo também no cliente (backend continua a proteção definitiva),
  motivo obrigatório por tipo, idempotência (ver abaixo).
- `components/inventory/StockMovementHistory.tsx` — histórico imutável (sem editar/excluir),
  estados de carregando/vazio/erro-com-retry, fallback legível para `movement_type` desconhecido
  (nunca quebra a tela), nenhum UUID exibido.
- `components/inventory/StockMovementPanel.tsx` — painel único (nome/categoria/saldo/estoque
  mínimo/situação + formulário + histórico), com `getStockLevel()`/`StockLevelBadge`
  (Sem estoque/Estoque baixo/Estoque normal — baixo só quando `minimum_stock > 0` e
  `current_stock <= minimum_stock`).
- `pages/InventoryPage.tsx` — nova coluna "Saldo atual" (ordenável), badge de situação, botão único
  "Movimentar estoque" por linha (Editar/Movimentar estoque/Excluir — sem poluição visual), abrindo
  o painel num `Dialog`. `delete_accessory`/`delete_packaging` (já bloqueados por histórico desde a
  rodada anterior) mapeados no frontend com a mesma mensagem real do backend.

**Decisões de UX sem regra documentada explícita (sinalizadas conforme pedido)**:

- Item inativo: Saldo inicial e Compra ficam indisponíveis; **Devolução permanece disponível**
  (decisão desta rodada) — `register_stock_movement()` não verifica `is_active` em nenhum
  `movement_type`, então bloquear Devolução na interface seria uma restrição só de UI sem
  correspondência no contrato real do backend.
- O painel fecha automaticamente após uma movimentação bem-sucedida (mesmo padrão de
  `RegisterPaymentForm`/`InventoryItemForm` — nenhum diálogo deste projeto permanece aberto após
  sucesso); para registrar uma segunda movimentação em seguida, o usuário reabre "Movimentar
  estoque" (a coluna "Saldo atual" já reflete o novo valor imediatamente, sem precisar reabrir).

**Idempotência no frontend**: `idempotency_key` gerada com `crypto.randomUUID()` só dentro de
`handleSubmit`, nunca a cada render; a mesma chave é reenviada enquanto
movement_type/quantidade/motivo/data não mudam (retry seguro de duplo clique/falha de rede);
qualquer mudança nesses campos gera uma chave nova; descartada implicitamente no sucesso (o painel
fecha, desmontando o formulário — a próxima abertura sempre começa do zero).

**Testes**: Deno (`stock-movements/handler.test.ts`, `_shared/errors.test.ts`) escritos mas **não
executados nesta sessão** — ambiente sem Deno instalado, mesma limitação já registrada em todas as
rodadas anteriores; revisados por leitura, seguindo a mesma disciplina de `accessories`/
`packaging`. Frontend: suíte completa 1167 → **1261 testes, todos passando**; lint 0 erros (1 aviso
novo, mesma categoria já tolerada em outros arquivos do projeto — export de `getStockLevel`/
`StockLevelBadge` junto do componente); build sem erros; `git diff --check` limpo; scan de segredos
sem ocorrências reais.

**Publicação em 2026-08-27 (mesmo dia, rodada seguinte)**: revisão estática integral do handler,
dos módulos `_shared` reaproveitados e da RPC (nenhuma inconsistência encontrada — payload
corresponde exatamente à assinatura de `register_stock_movement`, `quantity` sempre número,
`occurred_at` em formato ISO 8601 compatível com `timestamptz`, `idempotency_key` preservada sem
transformação, nenhuma escrita direta em `stock_movements`/`current_stock`, nenhuma service role
exposta, CORS/`verify_jwt=false` no mesmo padrão das demais funções). Deno continua indisponível
nesta sessão — os testes Deno já escritos não puderam ser executados, cobertura complementar via
suíte de frontend/API já aprovada (1261/1261). Edge Function `stock-movements` **publicada e
ativa** no projeto `tjhacqreupfqefntjevf` (`npx supabase functions deploy stock-movements`,
exclusivamente essa função — as 8 já existentes permaneceram com a mesma versão/`updated_at`,
confirmado por leitura antes/depois). Verificação HTTP real pós-publicação: `OPTIONS` sem
autenticação → **204**; `POST` sem autenticação (payload fictício, `item_id`
`00000000-0000-0000-0000-000000000000`, não real) → **401** (`Header Authorization ausente.`) —
rejeitado antes de qualquer acesso ao banco. Consultas somente leitura pós-teste confirmaram
**zero movimentação criada**: `stock_movements` continua com 0 linhas, nenhum `current_stock`
alterado em `accessories`/`packaging`. Frontend local confirmado (sem deploy): `.env.local` aponta
para o projeto correto e continua ignorado pelo git; `edgeFunctionClient.ts` monta a URL da função
dinamicamente a partir do nome `'stock-movements'`, nenhuma URL hardcoded. **Nenhum dado oficial ou
Petlink foi cadastrado ou alterado.**

**Percentual macro**: **não alterado por esta entrada**, deliberadamente — mesmo critério já
aplicado a Módulo 3 em rodadas anteriores. O backend do Incremento 1 e a Edge Function dos
Incrementos 2/3 agora estão **ambos deployados e testados automaticamente/via HTTP real**, mas
**nenhuma validação manual do usuário ainda ocorreu** — o padrão já estabelecido neste módulo só
reconhece uma fase como completa quando backend **e** interface **e** validação manual do usuário
existem juntos. A fórmula oficial (`# 1`) só concede peso de fase quando há artefato real
*deployado e validado*, não só deployado — recalcular o percentual fica para quando a validação
manual do usuário ocorrer.

**Validação manual do usuário em 2026-08-27 (mesmo dia, rodada seguinte)**: quantidade
disponível, entradas, saídas e histórico de Acessórios e Embalagens foram **validados
manualmente pelo usuário** — todos os 15 passos de um checklist manual foram aprovados. Nenhuma
alteração em Petlink ou dados oficiais durante a validação. Esta é a primeira parte do Módulo 3
(Incrementos 1-3, Acessórios/Embalagens) a reunir backend deployado **e** interface **e**
validação manual do usuário ao mesmo tempo — os três juntos, critério já estabelecido acima.
**Módulo 3 como um todo continua NÃO concluído**: falta a validação manual de Filamentos
(Incremento 4 abaixo, implementado só localmente) e todos os incrementos futuros (5 em diante —
consumo automático por pedido, reserva, inventário periódico). Percentual macro **ainda não
recalculado** — fica para quando o Módulo 3 estiver concluído por inteiro ou quando houver
critério explícito de recálculo parcial por incremento (não decidido nesta rodada).

## Incremento 4 — filamentos (tipos, rolos, movimentações, pesagem) — MVP IMPLEMENTADO LOCALMENTE

Implementado em 2026-08-27, na branch `feature/inventory-operations` (partindo de `41ab62c`,
depois da validação manual de Acessórios/Embalagens acima). Cobre os requisitos 1-8 do pedido
desta rodada (tipo de filamento, rolo físico, movimentações, pesagem, interface, histórico) e
parcialmente o requisito 9 (preparação de composição de produto, sem ativar consumo automático).
**Regras operacionais do MVP — versão inicial para validação, sujeitas a revisão após o teste
prático do usuário** (mesmo disclaimer das 22 regras de Acessórios/Embalagens — ver
`01_ESPECIFICACAO_FUNCIONAL.md` §16/§17/§20). **Nada desta seção foi aplicado ao Supabase remoto
nem publicado nem validado manualmente pelo usuário** — só criado e testado localmente.

**Decisão de arquitetura (diagnóstico técnico pedido explicitamente pelo requisito 5)**:
filamentos **não** reaproveitam `public.stock_movements` — ganharam um ledger dedicado,
`public.filament_movements`. Dois motivos concretos: (1) unidade de medida — peso de filamento é
fracionário (gramas), enquanto `stock_movements.quantity_delta` é `integer` (adequado só para
unidades discretas de acessórios/embalagens, uma tabela já em produção e validada manualmente,
que esta rodada não altera); (2) rastreabilidade por rolo — cada movimentação de filamento
precisa referenciar tanto o **tipo** quanto o **rolo físico**, e `stock_movements` só tem um
único item polimórfico. Detalhe completo em `03_MODELO_BANCO_DADOS.md` §12.3.

**Backend (4 migrations novas, nenhuma aplicada ao remoto)**:

- `20260827100000_create_filament_types_table.sql` — `public.filament_types` (material fechado
  `PLA`/`PETG`/`TPU`, **ABS explicitamente fora do MVP**; `line` livre, sem enum de banco;
  `color_code`/`notes` acrescentados frente à especificação original) +
  `create_filament_type`/`update_filament_type`/`delete_filament_type` (`security definer`,
  `service_role`, mesmo padrão de `accessories`/`packaging`).
- `20260827103000_create_filament_spools_table.sql` — `filament_spool_number_counters` +
  `next_filament_spool_code()` (gera `RL-XX-YYY`, mesmo padrão de `next_order_number()`) +
  `public.filament_spools` (peso nominal livre, sem valor fixo obrigatório; tara como campo do
  próprio rolo — `empty_spool_weight_grams` — em vez da tabela `spool_tares` da especificação
  original; status `LACRADO`/`ABERTO`/`ESGOTADO`/`DESCARTADO`, 4 valores, sem "em uso"; `is_active`
  como eixo independente de `status`) + `create_filament_spool`/`update_filament_spool`
  (bloqueia sair de `DESCARTADO` e reduzir o nominal abaixo do saldo atual)/`delete_filament_spool`.
- `20260827110000_create_filament_movements_table.sql` — `public.filament_movements` (9
  `movement_type`: `INITIAL_BALANCE`/`PURCHASE`/`RETURN`/`POSITIVE_ADJUSTMENT` entradas;
  `MANUAL_CONSUMPTION`/`LOSS`/`SAMPLE_TEST`/`NEGATIVE_ADJUSTMENT` saídas; `WEIGHING_ADJUSTMENT`
  pesagem, só via `register_filament_weighing`) + `register_filament_movement()` (mesmo padrão de
  lock/idempotência/concorrência de `register_stock_movement`; teto do peso nominal só para
  entradas de rotina, isento para a família de ajuste; bloqueia rolo `DESCARTADO`; aplica
  `ESGOTADO` automaticamente ao saldo chegar a zero) + `register_filament_weighing()` (peso
  disponível = peso bruto medido − tara quando conhecida, ou peso líquido direto quando não é;
  delta zero não grava nada; motivo sempre obrigatório, nenhuma tolerância percentual inventada) +
  `vw_filament_type_summary` (soma do peso disponível dos rolos ativos e utilizáveis por tipo,
  `security_invoker=true`).
- `20260827113000_create_product_filaments_table.sql` — `public.product_filaments` (peso teórico
  fracionário por tipo/produto, requisito 9) + `set_product_filaments()` (substitui a composição
  atomicamente, mesmo idioma de `set_product_composition`). **Preparação de modelo apenas**:
  nenhuma automação lê esta tabela, nenhum trigger em `orders`/`order_items` foi criado ou
  alterado, sem interface de edição nesta rodada (fora do escopo pedido — "prepare o modelo",
  não "ative o consumo").
- `supabase/functions/filament-types/`, `filament-spools/`, `filament-movements/` — 3 novas Edge
  Functions (`index.ts`/`handler.ts`/`handler.test.ts` cada), mesmo padrão de
  `accessories`/`stock-movements`: validação estrutural na função, regras dependentes do banco
  exclusivas das RPCs. `filament-movements` tem uma segunda rota, `POST
  /filament-movements/weighing`, para a pesagem. **Nenhuma das 3 foi publicada.**
- `supabase/functions/_shared/errors.ts` — ~30 novos padrões estáveis mapeados (validação
  estrutural das 6 novas RPCs + marcadores de regra de negócio:
  `FILAMENT_TYPE_HAS_SPOOLS:`/`FILAMENT_TYPE_HAS_COMPOSITION:`/`FILAMENT_SPOOL_HAS_MOVEMENTS:`/
  `FILAMENT_SPOOL_DISCARD_IS_FINAL:`/`FILAMENT_SPOOL_NOMINAL_BELOW_BALANCE:`/
  `FILAMENT_SPOOL_DISCARDED:`/`FILAMENT_INSUFFICIENT_BALANCE:`/`FILAMENT_EXCEEDS_NOMINAL:`/
  `FILAMENT_TARE_UNKNOWN:`).
- `supabase/config.toml` — `[functions.filament-types/filament-spools/filament-movements]`
  registradas (`verify_jwt = false`, mesmo padrão das demais).
- `supabase/tests/filament_inventory_test.sql` — teste de integração SQL (mesmo padrão de
  `inventory_movements_test.sql`), cobrindo: criação de tipo (aceita, rejeita ABS, rejeita
  duplicata, aceita linha livre não sugerida); múltiplos rolos com pesos nominais diferentes,
  saldo independente começando em zero; saldo inicial (único, exige zero), compra bloqueada acima
  do nominal, ajuste positivo isento do teto, consumo manual exige motivo, saldo negativo
  bloqueado, idempotência (mesmo payload e payload diferente), rejeição de `WEIGHING_ADJUSTMENT`
  pela rota errada; `ESGOTADO` automático ao zerar (e continua aceitando movimentação depois);
  descarte e sua natureza terminal (bloqueia movimentação e bloqueia reverter status); exclusão
  física bloqueada por histórico (rolo) e por rolo vinculado (tipo), permitida sem vínculo;
  desativação seguindo eixo independente de status; `vw_filament_type_summary` somando só rolos
  ativos e utilizáveis; pesagem com tara conhecida, sem tara conhecida, peso bruto abaixo da tara
  rejeitado, peso líquido negativo rejeitado, os dois pesos informados rejeitado, diferença zero
  não grava, motivo sempre obrigatório; `product_filaments`/`set_product_filaments` (grava,
  substitui atomicamente, rejeita tipo inexistente/inativo, rejeita peso não positivo, bloqueia
  exclusão do tipo por composição vinculada); privilégios (SELECT sim, INSERT/UPDATE/DELETE não,
  para `authenticated`; nada para `anon`).

**Frontend**:

- Tipos novos em `types/domain.ts`: `FilamentMaterial`, `FilamentType`, `FilamentSpoolStatus`,
  `FilamentSpool`, `FilamentMovementType`, `FilamentMovement`, `FilamentTypeSummary`,
  `ProductFilament`.
- `lib/api/filamentTypes.ts`/`filamentSpools.ts`/`filamentMovements.ts` — leitura direta via
  supabase-js (RLS já aplicada), escrita via as 3 Edge Functions. Listagem principal de tipos usa
  `vw_filament_type_summary` (já traz os totais agregados, sem exigir um segundo fetch/merge).
- `hooks/useFilamentTypes.ts`/`useFilamentSpools.ts`/`useFilamentMovements.ts` — mesmo idioma de
  `useAccessories`/`useStockMovements` (CRUD local sem refetch, `setLocalSpoolState` depois de uma
  movimentação/pesagem bem-sucedida, `register`/`weigh` separados — `weigh` pode devolver `null`
  quando a diferença calculada é zero).
- `components/inventory/FilamentTypeForm.tsx`/`FilamentSpoolForm.tsx` — cadastro/edição, mesmo
  padrão visual de `InventoryItemForm.tsx`; linha com 5 sugestões clicáveis (texto livre, nunca
  travado); peso nominal com 4 sugestões (250/500/750/1000 g, texto livre).
- `components/inventory/FilamentMovementForm.tsx` — adaptado de `StockMovementForm.tsx` para
  gramas fracionárias e os 8 tipos manuais de filamento (nomes próprios: Consumo manual,
  Amostra/Teste); bloqueia no cliente saída acima do saldo e entrada de rotina acima do nominal
  (backend permanece a proteção definitiva).
- `components/inventory/FilamentWeighingForm.tsx` — novo: alterna entre peso bruto medido (exige
  tara conhecida) e peso líquido direto (quando não é); mostra o peso líquido calculado e a
  diferença em relação ao saldo atual antes de enviar; motivo sempre obrigatório.
- `components/inventory/FilamentMovementHistory.tsx` — adaptado de `StockMovementHistory.tsx`
  para os 9 tipos e gramas.
- `components/inventory/FilamentSpoolPanel.tsx` — painel único por rolo (resumo + alternância
  Movimentar/Registrar pesagem + histórico); ao contrário de `StockMovementPanel`, **não fecha
  sozinho** após uma ação bem-sucedida (o usuário pode encadear mais de uma ação antes de fechar).
- `components/inventory/FilamentTypeDrawer.tsx` — drill-down de um tipo: lista de rolos com
  identificador/pesos/% restante/status/abertura/ações (Editar, Movimentar/Pesar, Ativar-desativar,
  Descartar, Excluir, Novo rolo).
- `components/inventory/InventoryPageShell.tsx` — extraído de `InventoryPage.tsx` (shell + nav de
  3 abas) para permitir a terceira área (Filamentos) sem import circular entre
  `InventoryPage.tsx` e `FilamentsInventoryPage.tsx`.
- `pages/FilamentsInventoryPage.tsx` — nova página (listagem de tipos via `vw_filament_type_summary`
  + badge de situação de estoque reaproveitando `getStockLevel`/`StockLevelBadge` + drill-down para
  rolos), roteada em `/estoque/filamentos` (`App.tsx`), terceira aba ao lado de Acessórios/
  Embalagens.

**Testes**: Deno (3 `handler.test.ts` novos) escritos mas **não executados nesta sessão** —
ambiente sem Deno, mesma limitação de todas as rodadas anteriores; revisados por leitura, seguindo
a mesma disciplina de `accessories`/`stock-movements`. SQL (`filament_inventory_test.sql`) escrito
mas **não executado** — ambiente sem Docker/Postgres local nem migrations aplicadas no remoto;
revisado linha a linha contra as 4 migrations. Frontend: suíte completa 1261 → **1332 testes,
todos passando** (71 novos: API layer, hooks, `FilamentMovementForm`, `FilamentWeighingForm`,
`FilamentsInventoryPage`; mais 1 asserção existente de `InventoryPage.test.tsx` ajustada ao novo
texto "acessórios, embalagens e filamentos"); lint 0 erros (mesmos 6 avisos pré-existentes, nenhum
novo); `tsc -b` sem erros; `vite build` sem erros; `git diff --check` limpo (só avisos de
LF→CRLF do Git no Windows); scan de segredos sem ocorrências reais (só o texto literal
`service_role`, nome de role do Postgres, em comentários/`GRANT`); `.env.local` confirmado
ignorado pelo git.

**Fora de escopo desta rodada** (incrementos futuros, nenhum com código): consumo automático de
filamento por pedido/produção, reserva, inventário periódico (pesagem em lote), tolerância
percentual de pesagem (nenhuma foi definida nem inventada), interface de edição de composição de
filamento por produto, publicação das 3 novas Edge Functions, aplicação das 4 migrations ao
Supabase remoto, qualquer validação manual do usuário sobre filamentos.

**Percentual macro**: **não alterado por esta entrada** — mesmo critério já aplicado. Backend e
interface de Filamentos existem agora **só localmente** (nem deployados, nem validados
manualmente) — dois dos três critérios (backend **e** interface **e** validação manual) ainda
faltam por completo para esta parte do Módulo 3.

## Incremento 4 — aplicação remota e publicação (2026-08-27, rodada seguinte)

Antes de aplicar qualquer coisa, **auditoria pré-deploy** confirmou um problema técnico real:
duas das quatro migrations desta rodada (`20260827106000_create_filament_movements_table.sql` e
`20260827109000_create_product_filaments_table.sql`) tinham identificadores de versão
`YYYYMMDDHHMMSS` **inválidos** — `106000` decodifica como `10:60:00` (minuto 60, fora do intervalo
0–59) e `109000` como `10:90:00` (minuto 90) — confirmado tanto por decodificação manual quanto
pela própria saída de `npx supabase migration list --linked`, que exibia o campo `time` cru
(`"20260827106000"`) em vez de uma data formatada para essas duas entradas, ao contrário das
outras 33. **Renomeadas antes de qualquer aplicação** (nunca uma migration já aplicada foi
editada — nenhuma das quatro tinha sido aplicada ainda neste ponto):
`20260827106000_create_filament_movements_table.sql` →
`20260827110000_create_filament_movements_table.sql` (11:00:00, válido) e
`20260827109000_create_product_filaments_table.sql` →
`20260827113000_create_product_filaments_table.sql` (11:30:00, válido), preservando a ordem
cronológica relativa às outras duas (100000/103000). Todas as referências cruzadas às duas
migrations renomeadas foram atualizadas em 9 arquivos (as próprias migrations
100000/103000, a Edge Function `filament-movements`, `_shared/errors.ts`,
`supabase/tests/filament_inventory_test.sql`, e 5 arquivos de frontend — `domain.ts`,
`FilamentMovementForm.tsx`, `FilamentMovementHistory.tsx`, `FilamentWeighingForm.tsx`,
`filamentMovements.ts`, `filamentTypes.ts`) — confirmado por busca exaustiva sem nenhuma
ocorrência residual dos identificadores inválidos em todo o repositório. Resto da auditoria
(ordem de dependência entre as 4 migrations, RLS, políticas, `SECURITY DEFINER`/`search_path`
seguro, `EXECUTE` restrito a `service_role`, ausência de permissão para `anon`, geração
concorrente/única de código de rolo, idempotência, bloqueio de saldo negativo, imutabilidade do
histórico, vínculo tipo+rolo correto, imutabilidade de `filament_type_id` do rolo, bloqueio de
exclusão com vínculo, cálculo de pesagem, `vw_filament_type_summary`, `ESGOTADO` automático,
`DESCARTADO` terminal, `product_filaments` sem consumo automático, ausência de gatilho em
pedidos/produção) **aprovada sem outra ressalva** — ver detalhamento completo em cada migration.

**Dry run** (`npx supabase db push --linked --dry-run`) apresentou exclusivamente as 4 migrations
de filamentos (agora com os nomes corrigidos), na ordem correta, nenhuma outra alteração.
**Aplicação real** (`npx supabase db push --linked`) bem-sucedida — as 4 migrations foram
aplicadas ao projeto remoto `tjhacqreupfqefntjevf`. `npx supabase migration list --linked`
confirmou **35/35 migrations sincronizadas local/remoto** (31 anteriores + as 4 novas), zero
pendências.

**Teste de integração SQL executado contra o remoto** (`supabase/tests/filament_inventory_test.sql`,
dentro de `BEGIN...ROLLBACK`, sem nenhum registro oficial) — resultado da primeira execução: **50
PASS, 1 FAIL** (Seção 6.1, `vw_filament_type_summary`). Investigação confirmou que o FAIL era um
**bug da própria asserção do teste**, não do banco: a Seção 6 original reutilizava
`spool_250_id`/`spool_1000_id` já mutados pelas Seções 4/5 (um ficou `ESGOTADO` — status que
nunca reverte automaticamente ao saldo voltar a ficar positivo, comportamento documentado e
correto de `register_filament_movement` — e o outro foi desativado em 5.4), então o resultado real
(`total=0`/`usable_count=0`) já estava correto; a asserção esperava `total=50`/`usable_count=1`,
um valor que nunca poderia ocorrer dado o estado real dos fixtures naquele ponto. Corrigida a
Seção 6 com um tipo e dois rolos dedicados, nunca mutados por seções anteriores (um ativo com
saldo, um desativado), testando de forma inequívoca tanto a inclusão quanto a exclusão na mesma
consulta — **nenhuma migration foi alterada**, só o arquivo de teste. Reexecutado: **51 PASS, 0
FAIL, 0 SKIP**. Consultas somente leitura pós-teste (após o `ROLLBACK` automático do próprio
script) confirmaram **zero resíduo**: `filament_types`/`filament_spools`/`filament_movements`/
`product_filaments`/`filament_spool_number_counters` com 0 linhas cada, nenhum produto
`TESTE%` persistido.

**Publicação individual das 3 novas Edge Functions** (`npx supabase functions deploy
<nome>`, uma chamada por função, nenhuma outra tocada) — `filament-types`, `filament-spools` e
`filament-movements` agora **ACTIVE, versão 1**, no projeto `tjhacqreupfqefntjevf`.
`npx supabase functions list` confirmou as 3 novas ativas e as 9 já existentes preservadas com o
mesmo `updated_at` de antes (nenhuma redeployada). Smoke tests HTTP reais: `OPTIONS` nas 3 rotas
→ **204**, cabeçalhos CORS corretos (`Access-Control-Allow-Origin` ecoando a origem permitida,
`Access-Control-Allow-Methods`/`Access-Control-Allow-Headers` no padrão do projeto); `POST` sem
`Authorization` nas 3 rotas → **401** (`Header Authorization ausente.`), rejeitado antes de tocar
o banco — confirmado por consulta pós-teste (0 linhas em todas as 4 tabelas novas). Teste CRUD
autenticado **não realizado nesta rodada** (sem sessão de usuário de teste disponível neste
ambiente de terminal) — fica para a validação manual pela interface.

**Frontend**: nenhuma alteração funcional — só os comentários que citavam os dois nomes de
migration renomeados. Suíte completa reexecutada por precaução: **1332/1332 passando**, lint 0
erros (mesmos 6 avisos pré-existentes), `tsc -b` sem erros, `vite build` sem erros, `git diff
--check` limpo.

**Nenhum push, nenhum deploy de frontend, nenhuma alteração em Petlink ou dado oficial, nenhum
`migration repair`, nenhum `db reset`, nenhuma migration já aplicada foi editada.** Interface de
`/estoque/filamentos` continua **aguardando validação manual do usuário** — backend e Edge
Functions agora deployados e testados automaticamente contra produção, mas isso ainda não
substitui essa validação. Regras operacionais do MVP continuam **sujeitas a revisão**; consumo
automático de filamento por pedido continua **pendente** (nenhum código). **Percentual macro não
alterado** — mesmo critério já aplicado: falta a validação manual para este trecho do Módulo 3
reunir os três critérios (backend + interface + validação manual) juntos.

---

# 10. Histórico de atualizações deste roadmap

| Data | Alteração |
| --- | --- |
| 2026-08-16 | Criação do roadmap. Auditoria confirma Módulo 0 quase operacional (~86%) e Módulo 1 com backend 100% pronto porém não operacional (~43%, frontend 0%). Módulos 2–10 recalculados distinguindo "especificado" de "implementado" (Fase 2 parcial = 50% quando só há especificação em doc `03` sem migrations); nenhum está operacional. |
| 2026-08-16 | Módulo 1 Fase 4: telas de Clientes e Produtos (listar/criar/alterar preço) implementadas. Composição padrão de produtos adicionada: Migrations 18–19 antecipam `accessories`/`packaging` (cadastro mestre completo, sem automação de estoque) e criam `product_accessories`/`product_packaging` + `set_product_composition`; `PATCH /products/:id/composition` implementado em `products`, **deployado e validado por smoke test real** (frontend → Edge Function → RPC → banco → leitura de volta). Módulo 1 macro sobe para ~50% (Fase 4 parcial). Módulo 3 Fase 2 ganha nota: 2 de suas tabelas já existem, mas nenhuma regra de estoque foi implementada. |
| 2026-08-20 | Módulo 1 Fase 4: Ficha Técnica do Produto — Incrementos 1 e 2 concluídos. Incremento 1: rota `/produtos/:productId`, busca individual de produto, Identificação e Produção (peso/tempo do plate + estimativa por unidade). Incremento 2: seções Acessórios e Embalagens (nome, situação, quantidade, custo unitário, subtotal por linha, com itens inativos/indisponíveis preservados) e card Subtotal de componentes (estados completo/parcial/não calculável/vazio, custo ausente nunca tratado como zero) — ainda sem custo de material, energia, máquina, perdas, MDO, custo total ou margem. Adicionada seção 6 "Gatilhos de retorno pendentes" registrando a pausa condicionada do roadmap para retomar a Ficha Técnica com custo total/margem quando a estrutura oficial de custos (doc `03` §18.1 `pricing_calculations`) for implementada — nenhum percentual macro alterado por esta entrada. |
| 2026-08-22 | Módulo 1: ajuste visual no formulário de Produto (criação e edição, mesmo componente `ProductForm.tsx`) — campo "Peso total (g)" passa a aparecer antes de "Tempo de Produção" (antes: Tempo de impressão antes do Peso); títulos das colunas correspondentes na listagem (`ProductsPage.tsx`) atualizados para os mesmos textos. Nenhuma lógica de validação, conversão de duração ou contrato de API/banco alterada. Adicionado à seção 6 novo gatilho pendente: quando o Módulo 3 — Estoque tiver interface funcional e validada para cadastrar acessórios/embalagens mestres, avisar o usuário para fazer os cadastros oficiais e completar a composição dos produtos, incluindo o cadastro oficial da Petlink já existente no ambiente — não implementado agora, só registrado como pendência; nenhum percentual macro alterado por esta entrada. |
| 2026-08-22 | Módulo 1: padrão de busca rápida + autocomplete/typeahead + ordenação por coluna (menu estilo filtro de tabela), já validado em Clientes/Produtos/Empresas, estendido para a listagem de Pedidos (`OrdersPage.tsx`) — busca por número do pedido, cliente/empresa exibido ou nome de qualquer produto do pedido; ordenação em todas as 11 colunas de dados (Nº pedido com comparação numérica natural, Total/Saldo devedor numéricos, Prazo pela data real). Componente compartilhado `SearchAutocomplete.tsx` ganhou um campo opcional `description` (badge de tipo — "Pedido"/"Cliente"/"Produto") para diferenciar sugestões heterogêneas; Clientes/Produtos/Empresas não passam esse campo e continuam com a mesma renderização de antes (suítes de teste dos 3 módulos reexecutadas, sem regressão). Nenhuma alteração na criação/edição de pedidos, nos fluxos de status operacional/financeiro, nem no contrato de `vw_order_summary`. Adicionado à seção 6 novo gatilho pendente: quando os fluxos de status operacional e financeiro de Pedidos estiverem funcionais e validados de ponta a ponta, retornar à listagem para criar botões de filtro rápido por status (incluindo "Aguardando pagamento") — não implementado nesta rodada, só registrado como pendência; nenhum percentual macro alterado por esta entrada. |
| 2026-08-22 | Módulo 3 (Estoque): auditoria somente leitura seguida de planejamento aprovado para a interface de cadastro mestre de acessórios/embalagens (Incremento 1 do plano de 8 incrementos) — nenhum código, migration, Edge Function ou dado remoto alterado por esta entrada, só documentação. Registradas em `03_MODELO_BANCO_DADOS.md` §13.3: campos da interface (Nome/Tamanho/Variante/Estoque mínimo/Ativo/Custo somente leitura), remoção de Material e Fornecedor da UI (colunas preservadas/inexistentes no banco), Tamanho opcional com 5 opções oficiais (PP/P/M/G/GG) sem CHECK constraint e sem conversão automática de valores legados, `unit_cost` somente leitura com lembrete de retomada quando compras/entradas de estoque existirem, e regras de exclusão física guardada (exigirá migration própria, ainda não criada). Adicionadas a este roadmap: §8 (regra permanente de padrão visual/funcional para novos módulos) e §9 (plano de Módulo 3 — busca/filtros/ordenação independentes por aba, rotas planejadas `/estoque/*` não implementadas, contrato de escrita ainda em aberto entre acesso direto e Edge Function, recomendação por Edge Function). Nenhum percentual macro alterado por esta entrada — plano aprovado não é implementação. |
| 2026-08-22/23 | Módulo 3 (Estoque), Incrementos 2–4 implementados e testados localmente (nada deployado/liberado): Incremento 2 — backend protegido de Acessórios (`create_accessory`/`update_accessory`/`delete_accessory`, Edge Function `accessories`, migration local). Incremento 3 — mesmo backend espelhado para Embalagens (`create_packaging`/`update_packaging`/`delete_packaging`, Edge Function `packaging`). Incremento 4 — listagem de Estoque no frontend (`/estoque`, `/estoque/acessorios`, `/estoque/embalagens`, `InventoryPage.tsx`): busca, filtro por status e ordenação para as duas áreas, reaproveitando o padrão visual já aprovado nos demais módulos; somente leitura nesta etapa (sem criação/edição/exclusão/ativação — a coluna "Ativo" é um indicador informativo, não um controle, e não há coluna de ações). Validação manual da área `/estoque/acessorios` aprovada pelo usuário em 2026-08-23. Cadastro oficial (incl. composição da Petlink) segue bloqueado até as operações de escrita existirem na interface e o backend ser deployado com autorização explícita. Nenhum percentual macro alterado — trabalho local/testado ainda não atende ao critério "deployado e validado em produção" exigido pela regra de §1. |
| 2026-08-24 | Módulo 3 (Estoque): criação, edição, ativação/desativação (com confirmação explícita) e exclusão física segura completas na interface para Acessórios e Embalagens, com testes automatizados (frontend + Deno) e validação manual no navegador aprovada pelo usuário. Backend publicado no projeto Supabase remoto: migrations `20260822120000`/`20260823120000` aplicadas (28/28 sincronizadas, nenhuma pendente), Edge Functions `accessories`/`packaging` deployadas e ativas — corrige a informação desatualizada das entradas anteriores de que este backend seguia "não deployado". Uma falha de conexão nas escritas (Edge Functions/migrations ainda não publicadas no momento da primeira validação manual) foi diagnosticada e corrigida na mesma janela de trabalho. Preparado (não executado) o deploy do frontend: `frontend/vercel.json` (Root Directory `frontend`, build `npm run build`, output `dist`, rewrite de SPA para `index.html`) e `"engines"` em `frontend/package.json`; hospedagem pública ainda **sem URL verificada**. Cadastro oficial (incl. composição da Petlink) continua bloqueado — depende de autorização explícita separada (§6), não alterada por esta entrada. Nenhum percentual macro recalculado. |
| 2026-08-26 | Auditoria de código (somente leitura) seguida de correção funcional. **Auditoria**: confirmou que Empresas (`CompaniesPage.tsx`) e Pedidos (`OrdersPage.tsx`/`OrderForm.tsx`/`OrderEditForm.tsx`) já tinham frontend completo (CRUD/listar+criar+editar), contradizendo a Fase 4 do Módulo 1 que este documento ainda registrava como "sem tela" — corrigido nesta entrada (Fase 4 do Módulo 1 passa a 100%, macro do módulo para ~57,14%). Confirmado também, por leitura de todas as 27 migrations, que o cadastro mestre de Acessórios/Embalagens (Módulo 3) está implementado/testado/validado, mas **nenhuma tabela ou tela de inventário físico existe** (sem saldo, entrada, saída ou ajuste de estoque) — distinção agora explícita em §5. **Bug corrigido**: `CustomerForm` listava empresas inativas no campo "Empresa" ao cadastrar/editar cliente (só `OrderForm` já filtrava corretamente empresas inativas nesse mesmo cenário). Correção em `frontend/src/pages/customers/CustomersPage.tsx`: nova lista `availableCompanies` (empresas ativas + a empresa já vinculada ao cliente em edição, mesmo se desativada depois, para nunca apagar/substituir automaticamente um vínculo existente) repassada a `CustomerForm`; `listCompanies()` **não foi alterada** (a tela de Empresas continua exibindo ativas e inativas). 6 testes novos adicionados em `CustomersPage.test.tsx` cobrindo os cenários de empresa ativa/inativa/vinculada-desativada na criação e edição. Suíte completa (999 → 1005 testes) e lint/build/`tsc` verificados sem regressão. `frontend/package-lock.json` mantém alteração local pré-existente (só sincroniza o campo `engines` já presente em `package.json` desde `ecfc510` — nenhuma dependência/versão alterada), preservada sem commit nesta rodada. Hospedagem pública (Vercel) permanece configurada em código, mas **publicação segue deliberadamente adiada até a conclusão desta roadmap** — nenhum deploy executado. Nenhuma Fase 5/6/7 marcada como concluída — depende de validação manual do usuário (checklist entregue ao final desta rodada), ainda não realizada. |
| 2026-08-26 | **Validação manual do usuário aprovada**, exatamente no escopo do checklist entregue na entrada anterior: (1) empresa inativa não aparece ao criar novo cliente; (2) empresa inativa já vinculada permanece visível/selecionada ao editar o respectivo cliente; (3) o vínculo permanece após salvar sem alterar o campo; (4) criação de cliente sem empresa continua funcionando; (5) nenhuma regressão observada. Isso inicia a Fase 5 (Integração E2E) do Módulo 1, marcada como 🟡 ~10% — só este trecho estrito de Clientes/Empresas foi validado ponta a ponta pelo usuário; os demais critérios de aceite do módulo (fluxo completo de Pedidos: criar, itens, tipos, status, pagamento, prazo, entrega, persistência — `04_PLANO_IMPLEMENTACAO.md` §6) **continuam sem validação manual**. Macro do Módulo 1 recalculado para ~58,57%. Fases 6 (Piloto real) e 7 (Estabilização/release) **permanecem em 0%, não iniciadas, não marcadas como concluídas**. Checkpoint local criado nesta mesma entrada: commit `fix: filter inactive companies in customer form`, sem push, sem deploy, sem alteração de banco/migrations. |
| 2026-08-26 | Auditoria somente leitura das inconsistências levantadas no teste E2E anterior (cliente aparentemente sem vínculo; ausência de campo de custo em Acessórios/Embalagens), seguida de **segundo bloco de validação manual do usuário aprovado** no mesmo dia, com a ordem de operações corrigida: (1) empresa de teste criada e mantida **ativa** para estabelecer o vínculo; (2) cliente de teste vinculado corretamente à empresa enquanto ela ainda estava ativa; (3) empresa desativada **depois** de o vínculo já existir; (4) empresa inativa vinculada permaneceu visível ao editar o cliente; (5) vínculo permaneceu preservado após salvar; (6) acessório e embalagem **sem custo cadastrado** puderam ser usados normalmente na composição do produto; (7) composição foi salva e a Ficha Técnica apresentou corretamente custo "não informado" e subtotal "não calculável"/"parcial". A auditoria confirmou, por leitura de migrations/RPCs/Edge Functions/frontend (nenhum dado remoto consultado ou alterado), que a causa do "vínculo ausente" observado na rodada anterior era o próprio fix já corrigido funcionando como esperado (empresa inativa não fica mais selecionável ao **criar** um cliente novo — só permanece visível ao **editar** um vínculo pré-existente) combinado com uma ordem de operações do roteiro anterior que tentava vincular a uma empresa já inativa; e que a ausência de campo editável de custo unitário em `InventoryItemForm.tsx` é **comportamento intencional e documentado em todas as camadas** (`accessories`/`packaging.unit_cost` é somente leitura no cadastro mestre desde a Migration 18; `create_accessory`/`update_accessory`/`create_packaging`/`update_packaging` e as Edge Functions correspondentes rejeitam esse campo na escrita; `03_MODELO_BANCO_DADOS.md` §13.3 documenta isso explicitamente) — o custo virá futuramente do fluxo de compras/entradas de estoque (Módulo 3 físico, ainda não implementado), e a composição de produtos (`ProductCompositionForm.tsx`) nunca exige nem bloqueia por custo ausente, por design (`lib/products/productCosts.ts`). Fase 5 (Integração E2E) do Módulo 1 avança de ~10% para 🟡 **~20%** — Clientes/Empresas e a composição de Produtos (com item sem custo) validados ponta a ponta; **Pedidos continua sem nenhuma validação E2E manual**. Macro do Módulo 1 recalculado para 60%. Fases 6 (Piloto real) e 7 (Estabilização/release) **seguem em 0%, não iniciadas**. **Módulo 1 não está concluído.** Nenhum arquivo de código alterado por esta entrada — só documentação; checkpoint local: commit `docs: record module 1 e2e validation`, sem push, sem deploy, sem alteração de banco/migrations. |
| 2026-08-26 | Auditoria somente leitura dos contratos de status/pagamento/aprovação de Pedidos (`change_order_status`, `register_payment`, `register_approval`, migrations `20260814030351`/`20260814023834`, Edge Functions `order-status`/`payments`/`order-approvals`), seguida de **implementação completa do fluxo de gerenciamento de Pedidos no frontend** — ver detalhamento em Fase 4 acima. Achado central da auditoria, confirmado no código da RPC: `register_approval` **rejeita item CATALOG** ("Item CATALOG não exige aprovação") e o frontend só cria itens CATALOG (Personalizado/Spot seguem desabilitados como "Em breve") — logo nenhum botão de "registrar aprovação" manual foi construído (seria morto/sempre-rejeitado); a transição QUOTE→WAITING_APPROVAL já auto-promove a APPROVED via `try_auto_approve_order()` para qualquer pedido só-CATALOG, dentro da mesma chamada — decisão deliberada, documentada no código e aqui, não uma lacuna esquecida. Implementado: diálogo "Gerenciar pedido" (resumo financeiro, avanço de status respeitando a máquina de estados linear sem pular etapas, cancelamento só antes de IN_PRODUCTION, registro de pagamento com validação espelhando as CHECK constraints de `payments`, histórico combinado de status/financeiro/pagamentos); filtros rápidos por status na listagem (`Todos` + 8 status, com contagem, locais, combináveis com a busca); correção de vínculos desativados em `OrderForm.tsx` (cliente/empresa já vinculados continuam visíveis/selecionados na edição mesmo desativados depois, mesmo padrão de `CustomerForm`; produto de item existente inativo aparece rotulado "(inativo)" e continua bloqueando o salvamento, agora com mensagem específica orientando reativar/substituir). Nenhuma migration, Edge Function ou dado remoto alterado — reaproveita só contratos já deployados. Suíte completa 1005 → 1092 testes (87 novos, incluindo 6 arquivos de teste novos), lint 0 erros, build sem erros. Um erro de lint real foi corrigido durante a rodada (`useOrderManagement.ts` chamava `setState` síncrono dentro de `useEffect` — refeito para o padrão de `isLoading` derivado já usado em `useOrders`/`useCustomers`/`useCompanies`, sem nenhuma chamada de `setState` síncrona no corpo do efeito). **Nenhuma validação manual do usuário ainda ocorreu para nada desta rodada** — Fase 5 permanece em ~20%, não alterada; Fases 6/7 seguem em 0%; **Módulo 1 não está concluído**. Checkpoint local: commit `feat: complete order management workflow`, sem push, sem deploy, sem alteração de banco/migrations/dados oficiais. |
| 2026-08-26 | **Validação manual do usuário aprovada** para o fluxo completo de Pedidos (criação, avanço de status, registro de pagamento, avanço até entrega, cancelamento e filtros rápidos por status), na interface como implementada na entrada anterior. Fase 5 (Integração E2E) do Módulo 1 avança de ~20% para 🟡 **~55%** — junto com os blocos de Clientes/Empresas e Produtos já validados, isso completa os critérios de aceite de Pedidos alcançáveis no escopo atual (`04_PLANO_IMPLEMENTACAO.md` §6; "classificar tipos" permanece N/A, Personalizado/Spot ainda não implementados). Macro do Módulo 1 recalculado para ~65%. Em seguida, **na mesma rodada**, refinamento visual aplicado às telas recém-validadas — `RegisterPaymentForm.tsx`: "Tipo de pagamento"/"Método de pagamento" viram action buttons com ícone (reaproveitando `PAYMENT_METHOD_ITEMS`/`IconComponent`, agora exportados de `OrderForm.tsx`, em vez de duplicar); campo "Valor" passa a usar o mesmo campo monetário bancário de `ProductPriceForm.tsx` (`lib/forms/currencyField.ts`, **não alterado** — zero risco de regressão ali), com um `Switch` adicional só para o sinal negativo de Ajuste; resumo financeiro destacado no topo. `OrderForm.tsx` reorganizado em 3 seções visuais ("Dados do cliente"/"Dados do pedido"/"Entrega", numeração reiniciando por seção) — Empresa passa a ficar logo após Tipo de venda, Método de pagamento passa a ficar em "Dados do pedido" (antes ficava em Entrega); nenhum payload, validação, vínculo inativo corrigido ou modo somente-leitura foi alterado, só a organização visual. `OrdersPage.tsx`: a coluna Status agora é um controle clicável (`OrderStatusControl.tsx`) que abre confirmação com a única transição válida — DELIVERED/CANCELLED continuam só texto — reaproveitando só `orderStatusMachine.ts` e `changeOrderStatus()` (a mesma função de `useOrderManagement`), nunca uma segunda máquina de estados; botão "Gerenciar pedido" preservado ao lado. Durante a rodada, um bug real de UI foi encontrado e corrigido: recalcular as opções do seletor de Produto a partir do valor corrente da linha (em vez de um valor estável capturado na montagem) revertia a seleção para vazio no exato momento da troca — mesmo problema já documentado em `ProductCompositionForm.tsx`, corrigido com a mesma técnica (`stableInactiveProductIdByKey`). Suíte completa 1092 → 1130 testes, lint 0 erros (2 erros reais de `no-useless-assignment` corrigidos durante a rodada), build sem erros. **Esta superfície visual nova ainda não foi validada manualmente pelo usuário** — Fase 5 permanece em ~55%, não avança mais até essa validação específica ocorrer; Fases 6/7 seguem em 0%; **Módulo 1 não está concluído**. Checkpoint local: commit `feat: refine order forms and status controls`, sem push, sem deploy, sem alteração de banco/migrations/dados oficiais. |
| 2026-08-26 | **Validação manual do usuário aprovada** para as seis alterações visuais do commit `8ea17c0` (action buttons de Tipo/Método de pagamento, campo de valor no padrão bancário, resumo financeiro destacado, `OrderForm.tsx` em 3 seções, status do pedido alterável direto da listagem). Isso resolve a ressalva registrada na entrada anterior — Fase 5 (Integração E2E) do Módulo 1 avança de ~55% para 🟡 **~60%**; macro do Módulo 1 recalculado para ~66%. Em seguida, **na mesma rodada**, nova extensão implementada: status financeiro também alterável direto da listagem (`OrderPaymentStatusControl.tsx`) — auditoria confirmou que `orders.payment_status` é **sempre derivado** por `recalculate_order_financials()` (nunca editável diretamente), então o novo controle nunca escreve esse campo: clicar no badge "Status financeiro" abre o mesmíssimo `RegisterPaymentForm.tsx` já usado em "Gerenciar pedido" (mesma função `registerPayment()`, nenhuma lógica de pagamento duplicada), com Total do pedido/Já pago/Saldo devedor vindos direto de `OrderSummary` (`vw_order_summary`, já carregado por `useOrders`, sem nova busca). Auditoria do código de `register_payment()` confirmou que a função **não verifica `orders.order_status`** em nenhum momento (só existência do pedido e soma dos pagamentos nunca negativa) — por isso o novo controle nunca vira badge sem ação: permanece clicável em pedidos `CANCELLED`, `PAID` ou com pagamento excedente, comportamento auditado no contrato, não inventado. Botão "Gerenciar pedido" e o controle de Status do pedido (`OrderStatusControl.tsx`) preservados e testados sem regressão; filtros/busca continuam funcionando. Novo arquivo: `OrderPaymentStatusControl.tsx`/`.test.tsx`. Suíte completa 1130 → 1155 testes, lint 0 erros, build sem erros. Nenhuma migration, Edge Function ou dado oficial/Petlink alterado. **Esta extensão ainda não foi validada manualmente pelo usuário** — Fase 5 permanece em ~60%, não avança mais até essa validação específica ocorrer; Fases 6/7 seguem em 0%; **Módulo 1 não está concluído**. Checkpoint local: commit `feat: add financial status payment control`, sem push, sem deploy, sem alteração de banco/migrations/dados oficiais. |
| 2026-08-26 | Regra de negócio **revertida deliberadamente** pelo usuário: **bloqueio de pagamento excedente** — o total acumulado dos pagamentos de um pedido nunca pode ultrapassar `total_receivable` (`total_value + shipping_cost`); a decisão anterior desta mesma função ("nenhum estorno automático: pagamento excedente é permitido") deixa de valer para pagamentos novos. Detalhamento completo em Fase 4 acima. Resumo: nova migration local `supabase/migrations/20260826120000_add_payment_overpayment_guard.sql` substitui `register_payment()` (mesma assinatura de tipos da Migration `20260814030351`, mesmo OID/grants) adicionando o teto, reaproveitando o `for update` já existente sobre `orders` para serializar pagamentos concorrentes do mesmo pedido contra os dois limites (soma nunca negativa e agora também nunca acima do total); `RegisterPaymentForm.tsx` ganha validação-espelho no cliente (mensagem com o valor máximo permitido) e um estado "pedido totalmente pago" que desabilita o registro de novo pagamento (herdado automaticamente por `OrderPaymentStatusControl.tsx` e `OrderManagementPanel.tsx`, que reaproveitam o mesmo formulário); a listagem continua mostrando o badge "Pago" normalmente. Testes novos cobrindo os 8 cenários pedidos pelo usuário (inferior/igual/um-centavo-acima do saldo, pedido já pago, zero/negativo, duas parcelas somando exatamente o total, tentativa que ultrapassa, mensagem de erro no frontend) — suíte completa 1155 → 1167 testes, lint 0 erros, build sem erros, `git diff --check` limpo. **Etapa pendente explícita**: a migration **não foi aplicada ao Supabase remoto** nesta rodada (restrição do usuário) — a proteção de backend só existe localmente até uma aplicação futura com autorização explícita separada; o ambiente desta sessão também não tem Deno/Supabase CLI/Docker, então a migration só foi revisada por leitura, nunca executada contra um Postgres real. Nenhum dado oficial/Petlink alterado. **Nenhuma validação manual do usuário ainda ocorreu para esta regra** — Fase 5 permanece em ~60%, não alterada; Fases 6/7 seguem em 0%; **Módulo 1 não está concluído**. Checkpoint local: commit `feat: block excess payments beyond order total`, sem push, sem deploy, sem alteração de banco/migrations remotas/dados oficiais. |
| 2026-08-26 | Migration `20260826120000_add_payment_overpayment_guard.sql` **aplicada ao projeto Supabase remoto `tjhacqreupfqefntjevf`** via `npx supabase db push --linked` (só essa migration, sem seed, sem alteração de role) — 29/29 migrations agora sincronizadas local/remoto (antes 28/29). Verificação somente leitura via `db query --linked` confirmou a definição ao vivo de `register_payment()` idêntica ao arquivo local, função única (sem sobrecarga duplicada). Nenhuma Edge Function alterada, nenhum dado criado/editado/excluído. Em seguida, **validação manual do usuário aprovada com registros de teste**, cobrindo os 10 cenários do bloqueio de pagamento excedente pela listagem: abertura do pagamento pelo status financeiro, exibição de Total/Já pago/Saldo, pagamento parcial, atualização de status/saldo, bloqueio de um centavo acima do saldo com mensagem do valor máximo permitido, confirmação de que nenhum excedente foi registrado, pagamento exatamente igual ao saldo, atualização para "Pago", e bloqueio de novo pagamento com saldo zerado — exercitando a proteção real de produção, não só o espelho client-side. Fase 5 (Integração E2E) do Módulo 1 avança de ~60% para ✅ **100%** — completa o fluxo E2E do MVP atualmente implementado (Clientes/Empresas/Produtos/Pedidos, incl. bloqueio de excedente). Macro do Módulo 1 recalculado para ~71% (5 fases 100% + 2 fases 0%). Fases 6 (Piloto real) e 7 (Estabilização/release) **seguem em 0%, não iniciadas** — próxima etapa recomendada é a Fase 6. **Módulo 1 permanece não concluído.** Checkpoint documental: commit `docs: record order workflow validation`, seguido de push para `origin/feature/customers-orders` (autorizado nesta rodada) — sem deploy de frontend, sem nova alteração ao Supabase, sem dado oficial/Petlink alterado. |
| 2026-08-27 | **Decisão do usuário**: antes de finalizar as Fases 6 (Piloto real) e 7 (Estabilização/release) do Módulo 1, será concluída a continuação do Módulo 3 (Estoque e Inventário) — quantidade disponível, entradas/saídas, histórico de movimentações, filamentos por rolo/peso, consumo automático de estoque pelo pedido, integração completa entre Pedidos/Produtos/Estoque, nessa ordem. Nova branch `feature/inventory-operations` criada a partir de `45dac99` (tip de `feature/customers-orders`, que continua a base — `main` só tem o commit inicial de documentação). Auditoria completa (documentação, banco, backend, frontend) executada antes da implementação, seguida da aprovação de 22 regras operacionais de estoque pelo usuário — ver detalhamento completo em §9b. **Incremento 1 do novo plano (saldo e motor de movimentações para Acessórios/Embalagens) implementado localmente nesta rodada**: `public.stock_movements` (ledger imutável, extensível a filamentos) + `public.register_stock_movement()` (única função que atualiza saldo, com lock/atomicidade, bloqueio de saldo negativo, motivo obrigatório por tipo, idempotência) — migrations `20260827090000_create_stock_movements_table.sql` e `20260827093000_update_accessory_packaging_delete_guards.sql` (esta última atualiza `delete_accessory`/`delete_packaging` para também bloquear exclusão quando há histórico de movimentação). Teste de integração SQL completo criado (`supabase/tests/inventory_movements_test.sql`), mas **não executado nesta sessão** — sem Docker/Postgres local e migration não aplicada ao remoto (restrição desta rodada); revisado por leitura linha a linha. Suíte completa do frontend reexecutada (1167/1167, sem regressão — nenhum arquivo TypeScript alterado), lint 0 erros, build sem erros, `git diff --check` limpo. Documentação atualizada em `01_ESPECIFICACAO_FUNCIONAL.md` §16/§18/§19/§20, `02_ESPECIFICACAO_TECNICA.md` §6.9 e `03_MODELO_BANCO_DADOS.md` §13/§15.1 — incluindo correção de informações desatualizadas: cadastro mestre de Acessórios/Embalagens confirmado implementado/publicado/validado (não mais "ainda não iniciado"), gatilho de §6 corrigido (a interface de Estoque existe desde 2026-08-24; só a autorização para cadastro oficial, incl. Petlink, continua pendente), e o schema real de `stock_movements` documentado em substituição ao esboço especulativo anterior. **Percentual do Módulo 3 não foi elevado por esta entrada** — a fórmula oficial (§1) só concede peso quando há artefato deployado e validado, e a migration deste Incremento 1 continua só local, mesmo critério já aplicado a este módulo em rodadas anteriores. **Nenhuma migration aplicada ao Supabase remoto, nenhuma Edge Function publicada, nenhum deploy, nenhum dado oficial/Petlink alterado.** Checkpoint local: commit `feat: add inventory movement ledger`, sem push. |
| 2026-08-27 | Revisão corretiva do Incremento 1 (Módulo 3), antes de qualquer aplicação remota. Corrigida uma lacuna real de idempotência concorrente em `register_stock_movement()`: duas chamadas com a mesma `idempotency_key` para itens DIFERENTES, sob concorrência real (duas conexões), podiam terminar com `unique_violation` bruto em vez da mensagem estável `IDEMPOTENCY_KEY_CONFLICT:` — corrigido com bloco `BEGIN/EXCEPTION WHEN unique_violation` em volta do `INSERT` (usando `CONSTRAINT_NAME` via `GET STACKED DIAGNOSTICS` para confirmar a causa exata), mais normalização de `reference_type` consistente com `reason`. Novo teste 5.3 adicionado ao script SQL cobrindo o caminho antecipado dessa checagem (a corrida real entre duas conexões continua não-testável num script de transação única, documentado como tal). As 22 regras aprovadas foram explicitamente rotuladas nos 4 documentos (`01`/`02`/`03`/`05`) como **"Regras operacionais do MVP — versão inicial para validação, sujeitas a revisão após o teste prático do usuário"** — aprovação autoriza construir o MVP, não torna as regras definitivas; tipos de movimentação poderão ser ampliados/revisados; reserva/consumo/cancelamento/pesagem/escolha de rolo/perdas continuam só intenção aprovada (zero código); ledger permanece imutável mesmo sob revisão futura; correções futuras via novas movimentações/migrations, nunca reescrevendo histórico; Módulo 3 só avança para validação operacional com interface utilizável. Auditoria confirmou ausência de menções incorretas de contagem de migrations em qualquer arquivo. Suíte completa do frontend reexecutada (1167/1167), lint 0 erros, build sem erros, `git diff --check` limpo. Checkpoint local: commit `fix: harden inventory ledger validation`, sem push, sem migration aplicada. |
| 2026-08-27 | **Migrations `20260827090000_create_stock_movements_table.sql` e `20260827093000_update_accessory_packaging_delete_guards.sql` aplicadas ao projeto Supabase remoto `tjhacqreupfqefntjevf`** via `npx supabase db push --linked` — 31/31 migrations agora sincronizadas local/remoto (antes 29/31), sem seed, sem alteração de role. Verificação somente leitura confirmou que tabela `stock_movements` (colunas/constraints/índices, incl. índice único parcial de `idempotency_key`), RLS/policies/grants e as três funções (`register_stock_movement`, `delete_accessory`, `delete_packaging`, cada uma com assinatura única) correspondem exatamente aos arquivos locais — nenhuma sobrecarga duplicada. Teste de integração SQL (`inventory_movements_test.sql`) executado contra o remoto dentro de `BEGIN...ROLLBACK` — **40 PASS, 1 SKIP, 0 FAIL**; consultas pós-teste confirmaram **zero resíduo** (nenhum dado de teste persistido, `stock_movements` com 0 linhas, nenhum `current_stock` oficial alterado, nenhum usuário oficial alterado). Smoke test do CRUD existente: `InventoryPage`/`InventoryItemForm` (108/108, sem regressão); testes Deno de `accessories`/`packaging` não executados (ambiente sem Deno). **Backend do Incremento 1 (Módulo 3) está agora aplicado e validado por teste automatizado real contra produção** — regras operacionais continuam provisórias do MVP (ver entrada anterior); interface (Incremento 2) e validação manual do usuário continuam pendentes; Incrementos 2–9 continuam pendentes. Módulo 1 continua aguardando a conclusão da integração de Estoque antes das Fases 6/7 (decisão registrada em 2026-08-27, entrada anterior). Percentual macro do Módulo 3 **não alterado** — critério já estabelecido exige backend + interface + validação manual juntos, não só backend. Nenhuma Edge Function publicada, nenhum deploy de frontend, nenhum dado oficial/Petlink alterado, nenhum push Git. Checkpoint local: commit `docs: record inventory ledger deployment`, sem push. |
| 2026-08-27 | **Incrementos 2/3 do Módulo 3 (interface de saldo/entrada/saída/ajuste + histórico) implementados localmente**: nova Edge Function `stock-movements` (não publicada) chamando exclusivamente `register_stock_movement()`; 8 novos padrões estáveis mapeados em `_shared/errors.ts`; `StockMovementForm.tsx`/`StockMovementHistory.tsx`/`StockMovementPanel.tsx` (ação "Movimentar estoque" por linha na listagem, action buttons com ícones, projeção de saldo, motivo obrigatório por tipo, idempotência via `crypto.randomUUID()` estável entre retries do mesmo payload); coluna "Saldo atual" ordenável e badge de situação (Sem estoque/Estoque baixo/Estoque normal) na listagem. As 22 regras aprovadas permanecem **provisórias do MVP** — esta interface existe para o usuário validar as regras na prática, não para confirmá-las. Decisões de UX sem regra documentada explícita, sinalizadas: Devolução permanece disponível em item inativo (backend não verifica `is_active`); painel fecha automaticamente após sucesso. Suíte completa 1167 → 1261 testes, lint 0 erros, build sem erros, `git diff --check` limpo. Testes Deno (`stock-movements/handler.test.ts`, `_shared/errors.test.ts`) escritos, **não executados** — ambiente sem Deno, mesma limitação já registrada. **Edge Function ainda não publicada, nenhuma validação manual do usuário ainda ocorreu, nenhum dado oficial/Petlink cadastrado ou alterado.** Fase 5/6/7 do Módulo 1 e percentual macro do Módulo 3 **não alterados** por esta entrada — Incrementos 4–9 do plano de estoque continuam pendentes (filamentos, rolos, pesagens, reservas, consumo automático, produção, integração com `change_order_status`). Checkpoint local: commit `feat: add inventory movement interface`, sem push, sem migration criada/aplicada, sem Edge Function publicada, sem deploy. |
| 2026-08-27 | **Edge Function `stock-movements` publicada e ativa** no projeto Supabase remoto `tjhacqreupfqefntjevf` (versão 1) — revisão estática integral antes da publicação não encontrou inconsistências (payload/RPC/CORS/auth/logs todos conferidos); Deno seguiu indisponível nesta sessão, testes Deno já escritos não executados, cobertura complementar via suíte de frontend/API (1261/1261). Publicação exclusiva de `stock-movements` via `npx supabase functions deploy` — as 8 Edge Functions já existentes permaneceram com a mesma versão/`updated_at`. Verificação HTTP real: `OPTIONS` sem autenticação → 204; `POST` sem autenticação (payload fictício, item não real) → 401 (`Header Authorization ausente.`), rejeitado antes de tocar o banco. Consultas pós-teste confirmaram zero movimentação criada e nenhum `current_stock` alterado. Frontend local confirmado apontando para o projeto correto, `.env.local` continua ignorado, nenhuma URL hardcoded — **nenhum deploy de frontend realizado**. **A interface completa (backend + Edge Function publicada) está tecnicamente pronta, mas nenhuma validação manual do usuário ainda ocorreu** — as 22 regras aprovadas continuam provisórias do MVP; Fase 5/6/7 do Módulo 1 e percentual macro do Módulo 3 **não alterados** por esta entrada. Incrementos 4–9 do plano de estoque continuam pendentes. Nenhum dado oficial/Petlink alterado, nenhuma outra migration/Edge Function tocada. Checkpoint local: commit `docs: record stock movement function deployment`, sem push. |
| 2026-08-27 | **Validação manual do usuário aprovada** para quantidade disponível, entradas, saídas e histórico de Acessórios e Embalagens — 15/15 passos de um checklist manual aprovados; nenhuma alteração em Petlink/dados oficiais durante a validação. Reconciliação confirmou HEAD `41ab62c`, árvore limpa, 31/31 migrations sincronizadas, 5 commits à frente de `feature/customers-orders`. Em seguida, **Incremento 4 do plano de estoque (filamentos — tipos, rolos, movimentações, pesagem) implementado localmente**, cobrindo os requisitos 1-8 do pedido e parcialmente o 9 (preparação de composição, sem ativar consumo automático) — ver detalhamento técnico completo em §9b. Resumo: 4 migrations novas (`filament_types`/`filament_spools`/`filament_movements`+`vw_filament_type_summary`/`product_filaments`), decisão de arquitetura de **não** reaproveitar `stock_movements` (ledger próprio, `filament_movements`, por unidade de medida fracionária e necessidade de referenciar tipo+rolo); 3 Edge Functions novas (`filament-types`/`filament-spools`/`filament-movements`, nenhuma publicada); ~30 novos padrões de erro estáveis; página `/estoque/filamentos` (terceira aba, listagem de tipos com drill-down para rolos, ações de cadastro/ativação/descarte/exclusão/movimentar/pesar/histórico). Materiais fechados em PLA/PETG/TPU (**ABS explicitamente fora do MVP**); status do rolo `LACRADO`/`ABERTO`/`ESGOTADO`/`DESCARTADO` (4 valores, corrigindo a proposta de 5 valores nunca implementada de `03_MODELO_BANCO_DADOS.md` §12); tara como campo do próprio rolo, não mais um cadastro `spool_tares` separado. Teste de integração SQL (`filament_inventory_test.sql`) e 3 `handler.test.ts` Deno escritos, **não executados** (mesma limitação de ambiente de todas as rodadas anteriores — sem Docker/Postgres local/Deon, migrations não aplicadas ao remoto). Suíte completa do frontend 1261 → **1332 testes, todos passando**; lint 0 erros; `tsc -b`/`vite build` sem erros; `git diff --check` limpo; scan de segredos sem ocorrências reais; `.env.local` confirmado ignorado. **Nada desta entrada foi aplicado ao Supabase remoto, publicado ou validado manualmente pelo usuário** — regras operacionais do MVP, versão inicial para validação, sujeitas a revisão. **Módulo 3 continua NÃO concluído** (falta validação manual de Filamentos e todos os incrementos 5+ — consumo automático, reserva, inventário periódico); **integração Pedidos↔Estoque continua NÃO concluída**. Percentual macro **não alterado**. Checkpoint local: commit `feat: add filament roll inventory`, sem push. |
| 2026-08-27 | Auditoria pré-deploy do backend de filamentos encontrou um problema técnico real antes de qualquer aplicação: 2 das 4 migrations (`...106000`/`...109000`) tinham identificadores `YYYYMMDDHHMMSS` inválidos (minuto 60 e minuto 90, fora de 0–59) — confirmado por decodificação manual e pela própria saída de `migration list` (campo `time` não formatado para essas duas). Renomeadas para `...110000`/`...113000` (válidas, ordem cronológica preservada) antes de qualquer aplicação remota — nenhuma migration já aplicada foi editada; todas as referências cruzadas atualizadas em 9 arquivos. Resto da auditoria (RLS, políticas, `SECURITY DEFINER`/`search_path`, `EXECUTE` restrito, ausência de permissão a `anon`, idempotência, saldo negativo, imutabilidade, vínculos, `vw_filament_type_summary`, `ESGOTADO`/`DESCARTADO`, `product_filaments` sem consumo automático) aprovada sem ressalva. **As 4 migrations aplicadas ao projeto Supabase remoto `tjhacqreupfqefntjevf`** via `npx supabase db push --linked` (dry run prévio mostrou exclusivamente as 4 migrations) — 35/35 migrations agora sincronizadas local/remoto. Teste de integração SQL executado contra o remoto dentro de `BEGIN...ROLLBACK`: primeira execução **50 PASS/1 FAIL** — o FAIL era um bug da própria asserção do teste (Seção 6.1 reutilizava rolos já mutados por seções anteriores, um `ESGOTADO` que nunca reverte automaticamente ao saldo voltar a ficar positivo, comportamento correto e documentado — não um bug de banco); corrigida a asserção com fixtures dedicados, reexecutado: **51 PASS, 0 FAIL, 0 SKIP**. Consultas pós-teste confirmaram **zero resíduo** (todas as 4 tabelas novas com 0 linhas, nenhum produto `TESTE%`). **As 3 novas Edge Functions publicadas individualmente** (`filament-types`/`filament-spools`/`filament-movements`, todas ACTIVE versão 1) — as 9 já existentes preservaram `updated_at`, nenhuma redeployada. Smoke tests HTTP reais: `OPTIONS` → 204 com CORS correto; `POST` sem autenticação → 401 (`Header Authorization ausente.`) nas 3 rotas, confirmado sem tocar o banco. Teste CRUD autenticado não realizado (sem sessão de teste disponível neste ambiente) — fica para a validação manual pela interface. Frontend: nenhuma alteração funcional (só comentários citando os nomes de migration renomeados); suíte completa reexecutada por precaução, **1332/1332 passando**, lint 0 erros, `tsc -b`/`vite build` sem erros, `git diff --check` limpo. **Nenhum push, nenhum deploy de frontend, nenhuma alteração em Petlink/dado oficial, nenhum `migration repair`, nenhum `db reset`, nenhuma migration já aplicada foi editada.** Interface de Filamentos continua aguardando validação manual do usuário; regras do MVP continuam sujeitas a revisão; consumo automático por pedido continua pendente. Percentual macro **não alterado** — falta a validação manual para reunir os três critérios. Checkpoint local: commit `fix: harden filament inventory operations`, sem push. |
