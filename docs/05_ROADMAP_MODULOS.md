# Roadmap de Módulos
## Forma 3D Studio + Assistente Virtual Sky

**Última atualização:** 2026-08-26
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
| 1 | Clientes, Produtos e Pedidos | 4×100% (F1–F4) + 1×~10% (F5) + 2×0% (F6–F7) | ~59% | 🟡 Frontend completo; Fase 5 (E2E) iniciada — 1º trecho validado manualmente em 2026-08-26, resto pendente |
| 2 | Produção | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 3 | Estoque e Inventário | 1×100% (F1) + 1×50% (F2) + 5×0% (% macro pendente de recálculo — ver §9) | ~21%* | 🟡 Cadastro mestre (Acessórios/Embalagens) operacional; inventário físico (saldos/movimentações) não iniciado |
| 4 | Precificação e Rentabilidade | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 5 | Manutenção e Equipamentos | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 6 | Onboarding, Alertas e Gestão | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 7 | Sky Assistente em Texto | 1×100% (F1) + 1×0% (F2, N/A) + 5×0% | ~14% | ❌ Não iniciado |
| 8 | Sky Assistente por Voz | 1×100% (F1) + 1×0% (F2, N/A) + 5×0% | ~14% | ❌ Não iniciado |
| 9 | Divulgação e Marketing | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 10 | Integrações Externas | 1×100% (F1) + 6×0% (F2 sem modelo definido por integração) | ~14% | ❌ Não iniciado |

> Cálculo exato do Módulo 1: 4 fases 100% + 1 fase ~10% + 2 fases 0% = 4,1/7 ≈ 58,57%.
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
| 4. Frontend | ✅ 100% | 14,29% | Clientes, Produtos (listar/criar/alterar preço/composição padrão), Empresas (listar/criar/editar/ativar-desativar) e Pedidos (listar/criar/editar via diálogo, equivalente funcional a "Novo Pedido"/"Detalhe do Pedido") **implementados e cobertos por teste automatizado** (`CustomersPage`, `CompaniesPage`, `ProductsPage`, `ProductDetailPage`, `OrdersPage` + respectivos formulários). Auditoria de 2026-08-26 confirmou por leitura de código que Empresas/Pedidos já estavam implementados antes desta rodada — a linha anterior deste documento ("Empresas e Pedidos ainda sem tela") estava desatualizada. Bug corrigido nesta rodada: `CustomerForm` listava empresas inativas no campo "Empresa" (só `OrderForm` filtrava corretamente); agora `CustomersPage.tsx` calcula a lista disponível (empresas ativas + a empresa já vinculada ao cliente em edição, mesmo se desativada depois) e repassa a `CustomerForm`, sem alterar `listCompanies()` — `frontend/src/pages/customers/CustomersPage.tsx`, testes novos em `CustomersPage.test.tsx` |
| 5. Integração E2E | 🟡 iniciada (~10%) | 1,43% | **Validação manual do usuário aprovada em 2026-08-26**, escopo estrito: correção do campo "Empresa" em `CustomerForm` — (1) empresa inativa não aparece ao criar novo cliente; (2) empresa inativa já vinculada permanece visível/selecionada ao editar o respectivo cliente; (3) o vínculo permanece intacto após salvar sem alterar o campo; (4) criação de cliente sem empresa ("Nenhuma empresa") continua funcionando; (5) nenhuma regressão observada nos demais campos/fluxos de Clientes durante o teste. Isto é só uma fatia da Fase 5 — os demais critérios de aceite do Módulo 1 (`04_PLANO_IMPLEMENTACAO.md` §6: criar pedido, adicionar múltiplos itens, classificar tipos, alterar status, registrar pagamento/prazo/entrega, consultar pedido salvo após recarregar) **ainda não foram validados manualmente pelo usuário** — fase segue iniciada, não concluída |
| 6. Piloto real | ❌ 0% | 0% | Depende da Fase 5 completa — **não iniciado, não marcado como concluído** |
| 7. Estabilização / release | ❌ 0% | 0% | Depende da Fase 6 — **não iniciado, não marcado como concluído** |

**Percentual macro: (100+100+100+100+10+0+0) / 7 = 410/7 ≈ 58,57%.**

**Status OPERACIONAL: PARCIAL** — backend pronto e testado via API, incluindo a composição padrão
de produtos (Migrations 18–19 aplicadas no remoto, Edge Function `products` deployada, rota
`PATCH /products/:id/composition` validada por smoke test real ponta a ponta); frontend de
Clientes, Empresas, Produtos e Pedidos funciona localmente (1005/1005 testes automatizados
passando), incluindo a correção do bug de empresas inativas em Clientes, **já validada
manualmente pelo usuário na tela** (escopo acima). Integração E2E do restante do módulo (Pedidos
ponta a ponta, status, pagamentos) segue sem validação manual; hospedagem pública ainda inativa
(Vercel configurada em código desde `ecfc510`, mas publicação **deliberadamente adiada** até a
conclusão desta roadmap — ver §9). Piloto real e estabilização/release **não iniciados**.

## Próximo marco

Fase 4 (Frontend) do Módulo 1 concluída; correção do bug de empresas inativas em `CustomerForm`
validada manualmente pelo usuário em 2026-08-26 (escopo estrito acima), iniciando a Fase 5
(integração E2E manual). Próximo passo: estender a validação manual aos demais critérios de
aceite do Módulo 1 (fluxo completo de Pedidos: criar, itens múltiplos, tipos, status, pagamento,
prazo, entrega, persistência) antes de considerar a Fase 5 concluída e iniciar a Fase 6 (piloto
real). Publicação no Vercel continua fora de escopo até a conclusão da roadmap (ver §9).

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
| Cadastro oficial de acessórios/embalagens mestres e composição de produtos (incl. Petlink) | Módulo 3 — Estoque e Inventário possuir uma **interface funcional e validada** para cadastrar acessórios e embalagens mestres (hoje o cadastro mestre existe só no banco — tabelas `accessories`/`packaging`, Migration 18 — sem nenhuma tela; `products`/`product_accessories`/`product_packaging` já suportam composição via `set_product_composition`, mas dependem de acessórios/embalagens cadastrados) | Avisar o usuário de que a interface de Estoque está disponível, para que ele faça os cadastros oficiais de acessórios/embalagens e complete a composição dos produtos existentes — incluindo o cadastro oficial da Petlink já presente no ambiente, hoje sem composição associada | ⏳ Pendente — não disparado (interface de Estoque ainda não existe; plano de cadastro mestre aprovado em 2026-08-22 e dividido em 8 incrementos — ver §9 —, implementação ainda não iniciada) |
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
