# Roadmap de Módulos
## Forma 3D Studio + Assistente Virtual Sky

**Última atualização:** 2026-08-16
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
| 1 | Clientes, Produtos e Pedidos | 3×100% (F1–F3) + 1×50% (F4) + 3×0% (F5–F7) | ~50% | ❌ Não operacional |
| 2 | Produção | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 3 | Estoque e Inventário | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 4 | Precificação e Rentabilidade | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 5 | Manutenção e Equipamentos | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 6 | Onboarding, Alertas e Gestão | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 7 | Sky Assistente em Texto | 1×100% (F1) + 1×0% (F2, N/A) + 5×0% | ~14% | ❌ Não iniciado |
| 8 | Sky Assistente por Voz | 1×100% (F1) + 1×0% (F2, N/A) + 5×0% | ~14% | ❌ Não iniciado |
| 9 | Divulgação e Marketing | 1×100% (F1) + 1×50% (F2) + 5×0% | ~21% | ❌ Não iniciado |
| 10 | Integrações Externas | 1×100% (F1) + 6×0% (F2 sem modelo definido por integração) | ~14% | ❌ Não iniciado |

> Cálculo exato do Módulo 1: 3 fases 100% + 1 fase 50% + 3 fases 0% = 3,5/7 = 50%.
> A referência confiável continua sendo o detalhamento por fase (seção 3, para o módulo em
> desenvolvimento; seção 5, macro para os demais) — a tabela acima é só leitura rápida.

---

# 3. Módulo em desenvolvimento atual: Módulo 1 — Clientes, Produtos e Pedidos

| Fase | Status | Peso | Observação |
| --- | --- | --- | --- |
| 1. Definição funcional | ✅ 100% | 14,29% | Doc `01` §5–11, §68 |
| 2. Modelo e regras | ✅ 100% | 14,29% | 19 migrations **aplicadas**: `companies`, `customers`, `lead_sources`, `orders`, `order_items`, `custom_item_details`, `custom_versions`, `approvals`, `model_sources`, `spot_item_details`, `products`, `product_price_history`, `payments`, `order_status_history`, `payment_status_history`, `accessories`, `packaging`, `product_accessories`, `product_packaging` + funções de negócio (incl. `set_product_composition`) + views |
| 3. Backend | ✅ 100% | 14,29% | 6 Edge Functions **deployadas e validadas em runtime**: `products`, `orders`, `order-items`, `order-status`, `payments`, `order-approvals`. Nova rota `PATCH /products/:id/composition` **deployada e validada em runtime** — smoke test real ponta a ponta (frontend → Edge Function → RPC `set_product_composition` → banco → leitura de volta) concluído com sucesso em 2026-08-16 |
| 4. Frontend | 🟡 ~50% | 7,14% | Clientes e Produtos (listar/criar/alterar preço/composição padrão) implementados; Empresas e Pedidos ainda sem tela |
| 5. Integração E2E | ❌ 0% | 0% | Depende da Fase 4 completa |
| 6. Piloto real | ❌ 0% | 0% | Depende da Fase 5 |
| 7. Estabilização / release | ❌ 0% | 0% | Depende da Fase 6 |

**Percentual macro: (100+100+100+50+0+0+0) / 7 = 350/7 = 50%.**

**Status OPERACIONAL: NÃO** — backend pronto e testado via API, incluindo a composição padrão de
produtos (Migrations 18–19 aplicadas no remoto, Edge Function `products` deployada, rota
`PATCH /products/:id/composition` validada por smoke test real ponta a ponta), frontend de
Clientes/Produtos já funciona, mas o usuário ainda não consegue operar Empresas/Pedidos pelo
frontend.

## Próximo marco

Migrations 18–19 e o deploy da Edge Function `products` (rota de composição) já foram aplicados
e validados por smoke test real. Próximo passo: completar a Fase 4 (Frontend) do Módulo 1 com as
telas de Empresas e Pedidos (lista/novo/detalhe), conforme escopo em
`04_PLANO_IMPLEMENTACAO.md` §6. Ao concluir, seguir para Fase 5 (integração E2E manual) antes de
iniciar Fase 6 (piloto real).

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
no modelo de banco de dados (`03`), mas nenhuma Edge Function ou tela **destes módulos** foi
criada. A especificação conta como progresso real (ver §1), mas não deve ser lida como
implementação. Exceção pontual: o Módulo 1 antecipou 2 das tabelas do Módulo 3
(`accessories`/`packaging`, cadastro mestre sem estoque) — ver nota na linha do Módulo 3.

| Módulo | Fase 1 — Definição funcional | Fase 2 — Modelo e regras | Fases 3–7 |
| --- | --- | --- | --- |
| 2 — Produção | ✅ 100% (doc 01 §12–14) | 🟡 50% — especificado (doc 03 §10–11), sem migrations | ❌ 0% |
| 3 — Estoque e Inventário | ✅ 100% (doc 01 §15–21) | 🟡 50% — `accessories`/`packaging` (doc 03 §13) **implementados** (Migration 18, antecipados pelo Módulo 1 só como cadastro mestre); `filament_types`, `spool_tares`, `filament_spools`, `suppliers`, `stock_movements`, `stock_reservations`, `inventories`, `inventory_items` (doc 03 §12, §14–16) continuam apenas especificados, sem migration; nenhuma regra de negócio de estoque (saldo/reserva/consumo) implementada; plano de interface para cadastro mestre de acessórios/embalagens **aprovado** em 2026-08-22, implementação ainda não iniciada — ver §9 | ❌ 0% |
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
Backend protegido (Acessórios e Embalagens, Incrementos 2–3): ✅ implementado e testado
localmente, ⏳ não deployado. Listagem no frontend (Incremento 4): ✅ implementada, testada e
validada manualmente para `/estoque/acessorios`; Embalagens usa o mesmo componente (mesma
cobertura de teste), validação manual dedicada ainda não registrada. Criação/edição/ativação/
desativação/exclusão pela interface: ❌ não iniciadas. Cadastro oficial: 🔒 ainda não liberado.
Plano: 8 incrementos definidos, 4 com trabalho local concluído. Nenhum percentual macro (seções
2/5) é alterado por esta entrada — implementação local/testada ainda não é "deployado e validado
em produção", critério exigido pela regra de §1 para a Fase 3/4 receberem peso cheio.

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
