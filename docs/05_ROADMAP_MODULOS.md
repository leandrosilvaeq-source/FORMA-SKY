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
| 3 — Estoque e Inventário | ✅ 100% (doc 01 §15–21) | 🟡 50% — `accessories`/`packaging` (doc 03 §13) **implementados** (Migration 18, antecipados pelo Módulo 1 só como cadastro mestre); `filament_types`, `spool_tares`, `filament_spools`, `suppliers`, `stock_movements`, `stock_reservations`, `inventories`, `inventory_items` (doc 03 §12, §14–16) continuam apenas especificados, sem migration; nenhuma regra de negócio de estoque (saldo/reserva/consumo) implementada | ❌ 0% |
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
| Cadastro oficial de acessórios/embalagens mestres e composição de produtos (incl. Petlink) | Módulo 3 — Estoque e Inventário possuir uma **interface funcional e validada** para cadastrar acessórios e embalagens mestres (hoje o cadastro mestre existe só no banco — tabelas `accessories`/`packaging`, Migration 18 — sem nenhuma tela; `products`/`product_accessories`/`product_packaging` já suportam composição via `set_product_composition`, mas dependem de acessórios/embalagens cadastrados) | Avisar o usuário de que a interface de Estoque está disponível, para que ele faça os cadastros oficiais de acessórios/embalagens e complete a composição dos produtos existentes — incluindo o cadastro oficial da Petlink já presente no ambiente, hoje sem composição associada | ⏳ Pendente — não disparado (interface de Estoque ainda não existe) |

---

# 7. Histórico de atualizações deste roadmap

| Data | Alteração |
| --- | --- |
| 2026-08-16 | Criação do roadmap. Auditoria confirma Módulo 0 quase operacional (~86%) e Módulo 1 com backend 100% pronto porém não operacional (~43%, frontend 0%). Módulos 2–10 recalculados distinguindo "especificado" de "implementado" (Fase 2 parcial = 50% quando só há especificação em doc `03` sem migrations); nenhum está operacional. |
| 2026-08-16 | Módulo 1 Fase 4: telas de Clientes e Produtos (listar/criar/alterar preço) implementadas. Composição padrão de produtos adicionada: Migrations 18–19 antecipam `accessories`/`packaging` (cadastro mestre completo, sem automação de estoque) e criam `product_accessories`/`product_packaging` + `set_product_composition`; `PATCH /products/:id/composition` implementado em `products`, **deployado e validado por smoke test real** (frontend → Edge Function → RPC → banco → leitura de volta). Módulo 1 macro sobe para ~50% (Fase 4 parcial). Módulo 3 Fase 2 ganha nota: 2 de suas tabelas já existem, mas nenhuma regra de estoque foi implementada. |
| 2026-08-20 | Módulo 1 Fase 4: Ficha Técnica do Produto — Incrementos 1 e 2 concluídos. Incremento 1: rota `/produtos/:productId`, busca individual de produto, Identificação e Produção (peso/tempo do plate + estimativa por unidade). Incremento 2: seções Acessórios e Embalagens (nome, situação, quantidade, custo unitário, subtotal por linha, com itens inativos/indisponíveis preservados) e card Subtotal de componentes (estados completo/parcial/não calculável/vazio, custo ausente nunca tratado como zero) — ainda sem custo de material, energia, máquina, perdas, MDO, custo total ou margem. Adicionada seção 6 "Gatilhos de retorno pendentes" registrando a pausa condicionada do roadmap para retomar a Ficha Técnica com custo total/margem quando a estrutura oficial de custos (doc `03` §18.1 `pricing_calculations`) for implementada — nenhum percentual macro alterado por esta entrada. |
| 2026-08-22 | Módulo 1: ajuste visual no formulário de Produto (criação e edição, mesmo componente `ProductForm.tsx`) — campo "Peso total (g)" passa a aparecer antes de "Tempo de Produção" (antes: Tempo de impressão antes do Peso); títulos das colunas correspondentes na listagem (`ProductsPage.tsx`) atualizados para os mesmos textos. Nenhuma lógica de validação, conversão de duração ou contrato de API/banco alterada. Adicionado à seção 6 novo gatilho pendente: quando o Módulo 3 — Estoque tiver interface funcional e validada para cadastrar acessórios/embalagens mestres, avisar o usuário para fazer os cadastros oficiais e completar a composição dos produtos, incluindo o cadastro oficial da Petlink já existente no ambiente — não implementado agora, só registrado como pendência; nenhum percentual macro alterado por esta entrada. |
