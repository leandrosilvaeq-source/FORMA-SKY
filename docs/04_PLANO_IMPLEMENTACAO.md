# Plano de Implementação v0.2
## Forma 3D Studio + Assistente Virtual Sky

**Status:** Plano reorganizado por Módulos Funcionais × Fases Técnicas
**Documentos de referência:**
- `01_ESPECIFICACAO_FUNCIONAL.md`
- `02_ESPECIFICACAO_TECNICA.md`
- `03_MODELO_BANCO_DADOS.md`
- `05_ROADMAP_MODULOS.md` — estado vivo de progresso (atualizado a cada sessão)

> Este documento define **o que** cada módulo precisa entregar (escopo, tarefas, critérios de
> aceite). O estado atual de progresso — o que já foi feito, percentuais e próximos marcos —
> vive em `05_ROADMAP_MODULOS.md`, para não exigir reescrever este plano a cada sessão.

---

# 1. Objetivo

Este documento transforma a especificação funcional, técnica e o modelo de banco de dados em
uma sequência prática de implementação, organizada por **Módulos Funcionais**, cada um dividido
em **7 Fases Técnicas**.

O desenvolvimento deverá ser incremental.

O Claude Code **não deverá tentar implementar todo o sistema de uma única vez**.

---

# 2. Regras gerais para o Claude Code

Antes de iniciar qualquer módulo:

1. Ler `01_ESPECIFICACAO_FUNCIONAL.md`.
2. Ler `02_ESPECIFICACAO_TECNICA.md`.
3. Ler `03_MODELO_BANCO_DADOS.md`.
4. Consultar `05_ROADMAP_MODULOS.md` para saber o estado atual e o próximo marco.
5. Verificar se existem decisões pendentes que impactam o módulo.
6. Não alterar regras de negócio aprovadas sem sinalizar impacto.
7. Não criar funcionalidades fora do escopo do módulo/fase sem necessidade.
8. Sempre preservar a possibilidade de evolução futura.
9. Não expor segredos no frontend.
10. Criar testes mínimos antes de considerar uma fase concluída.
11. Fazer commit ao final de cada fase aprovada.
12. Atualizar `05_ROADMAP_MODULOS.md` ao final da sessão.

---

# 3. Padrão de organização: Módulos × Fases × Status OPERACIONAL

## 3.1 Módulos Funcionais

| Nº | Módulo |
| --- | --- |
| 0 | Fundação e Segurança |
| 1 | Clientes, Produtos e Pedidos |
| 2 | Produção |
| 3 | Estoque e Inventário |
| 4 | Precificação e Rentabilidade |
| 5 | Manutenção e Equipamentos |
| 6 | Onboarding, Alertas e Gestão |
| 7 | Sky Assistente em Texto |
| 8 | Sky Assistente por Voz |
| 9 | Divulgação e Marketing |
| 10 | Integrações Externas |

## 3.2 Fases Técnicas (aplicadas a cada módulo)

1. Definição funcional
2. Modelo e regras (banco de dados)
3. Backend (Edge Functions / regras de negócio)
4. Frontend
5. Integração E2E
6. Piloto real
7. Estabilização / release

## 3.3 Definição de status OPERACIONAL

> Um módulo só pode ser considerado **OPERACIONAL** quando puder ser usado normalmente pelo
> frontend, **sem depender de PowerShell ou chamadas manuais de API**.

Backend completo e testado via API não é suficiente para OPERACIONAL — é necessário que a Fase 4
(Frontend) e a Fase 5 (Integração E2E) estejam concluídas e utilizáveis por uma pessoa comum.

## 3.4 Estratégia de execução

Terminar um módulo, colocá-lo em uso real (Fase 6 — Piloto) e **só então** desenvolver
pesadamente o próximo módulo, mantendo os módulos anteriores em operação. Evitar avançar
backend de vários módulos em paralelo sem fechar o frontend/E2E do módulo corrente.

---

# 4. Estratégia de branches

- `main` — versão estável
- `develop` — integração

Branches por módulo:

| Branch | Módulo |
| --- | --- |
| `feature/foundation` | 0 — Fundação e Segurança |
| `feature/customers-orders` | 1 — Clientes, Produtos e Pedidos |
| `feature/production` | 2 — Produção |
| `feature/inventory` | 3 — Estoque e Inventário |
| `feature/pricing` | 4 — Precificação e Rentabilidade |
| `feature/maintenance` | 5 — Manutenção e Equipamentos |
| `feature/onboarding-alerts` | 6 — Onboarding, Alertas e Gestão |
| `feature/sky-text` | 7 — Sky Assistente em Texto |
| `feature/sky-voice` | 8 — Sky Assistente por Voz |
| `feature/marketing` | 9 — Divulgação e Marketing |
| `feature/integrations` | 10 — Integrações Externas |

---

# 5. Módulo 0 — Fundação e Segurança

## Objetivo

Criar a base técnica mínima para permitir desenvolvimento seguro (autenticação, estrutura de
projeto, ambiente).

## Escopo por fase

1. **Definição funcional** — concluída: usuário único inicial, necessidade de login seguro,
   estrutura de pastas do projeto.
2. **Modelo e regras** — concluída: tabela `users`, triggers de sincronização com Supabase Auth
   (`handle_new_auth_user`, `handle_auth_user_deleted`), função `is_active_user()`.
3. **Backend** — concluída: Supabase Auth configurado (e-mail/senha), políticas mínimas de
   acesso.
4. **Frontend** — concluída para autenticação: página de login, contexto de autenticação, rota
   protegida, layout inicial.
5. **Integração E2E** — funcional: login real end-to-end validado (usuário autenticado acessa a
   tela inicial pelo navegador).
6. **Piloto real** — parcial.
7. **Estabilização / release** — parcial: falta validação formal de segurança/RLS em condições
   de uso contínuo.

## Tarefas originais (referência histórica)

- Inicializar Git; criar repositório GitHub; criar branch `develop`.
- Configurar React + Vite + TypeScript + ESLint.
- Configurar estrutura de pastas, `.gitignore`, `.env.example`, README.
- Criar projeto Supabase; configurar conexão e Auth básico.
- Criar primeira migration (`users`).
- Configurar biblioteca de componentes base (shadcn/ui).
- Criar layout inicial responsivo, página de login, página inicial autenticada.

## Critérios de aceite

- Projeto abre no VS Code; `npm install` e `npm run dev` funcionam.
- Login funciona; usuário autenticado acessa tela inicial.
- Chaves não aparecem no código; projeto versionado em Git.

## Testes mínimos

- build sem erro; lint sem erro crítico; autenticação; conexão com Supabase.

## Commit já realizado

`feat: initialize Forma Sky project foundation`

## Status geral

**Quase operacional / validar formalmente** — falta apenas fechar Fases 6 e 7 (piloto e
estabilização/segurança) para marcar como OPERACIONAL.

---

# 6. Módulo 1 — Clientes, Produtos e Pedidos

## Objetivo

Permitir registrar a operação comercial básica da Forma.

## Escopo por fase

1. **Definição funcional** — 100% (docs `01` §5–11, §68): clientes, empresas, origem, pedidos,
   itens, Personalizado, Spot, Catálogo, status, pagamentos.
2. **Modelo e regras** — 100%: migrations para `companies`, `customers`, `lead_sources`,
   `orders`, `order_items`, `custom_item_details`, `custom_versions`, `approvals`,
   `model_sources`, `spot_item_details`, `products`, `product_price_history`, `payments`,
   `order_status_history`, `payment_status_history`, além das funções de negócio
   (`create_order`, `update_order`, `add_order_item`, `change_order_status`,
   `register_approval`, `register_payment`, `register_custom_version`, `create_product`,
   `update_product_price`, `recalculate_order_financials`, `try_auto_approve_order`) e views de
   resumo de pedido.
3. **Backend** — 100%: 6 Edge Functions deployadas e validadas em runtime (`products`, `orders`,
   `order-items`, `order-status`, `payments`, `order-approvals`).
4. **Frontend** — 0%. Nenhuma tela de clientes/produtos/pedidos existe ainda.
5. **Integração E2E** — 0% (depende da Fase 4).
6. **Piloto real** — 0%.
7. **Estabilização / release** — 0%.

## Seeds

- origens; status; meios de pagamento; tipos de pedido; fontes iniciais de modelo.

## Frontend a construir (Fase 4)

- Clientes; Empresas; Pedidos; Novo Pedido; Detalhe do Pedido; Novo Produto de Catálogo; Lista
  de Produtos.

## Regras importantes

- Pedido pode conter itens de tipos diferentes.
- Catálogo pode usar preço cadastrado.
- Spot exige aprovação simples.
- Personalizado exige fluxo de aprovação.
- Status financeiro é independente do status operacional.
- Pedido encerrado somente quando Entregue + Pago.

## Critérios de aceite

O usuário deve conseguir, **pelo frontend**:

1. cadastrar cliente; 2. criar pedido; 3. adicionar múltiplos itens; 4. classificar tipos;
5. alterar status; 6. registrar pagamento; 7. registrar prazo; 8. registrar entrega;
9. consultar pedido salvo após recarregar o sistema.

## Testes

- pedido com item Personalizado; pedido com item Spot; pedido com item Catálogo; pedido misto;
  status independentes; cancelamento antes da produção.

## Commit já realizado

`feat: implement customers and orders core`, `feat: add Bloco 1 edge functions and auth fixes`

## Status geral

**NÃO OPERACIONAL** — backend 100% pronto e validado via API, mas sem frontend/E2E não pode ser
usado normalmente. Próximo marco em `05_ROADMAP_MODULOS.md`.

---

# 7. Módulo 2 — Produção

## Objetivo

Transformar pedidos aprovados em produção executável.

## Escopo por fase

1. **Definição funcional** — concluída (doc `01` §12–14).
2. **Modelo e regras** — especificada em doc `03` (§10–11: `printers`, `production_orders`,
   `plates`, `plate_items`, `failure_reasons`, `production_failures`); **migrations não
   criadas**.
3. **Backend** — não iniciado.
4. **Frontend** — não iniciado.
5. **Integração E2E** — não iniciada.
6. **Piloto real** — não iniciado.
7. **Estabilização / release** — não iniciada.

## Seeds planejados

Impressora inicial: Nome "A1 Principal", Fabricante "Bambu Lab", Modelo "A1".

## Backend planejado

- criar ordem de produção; criar plate; adicionar/remover item do plate; iniciar/concluir plate;
  registrar falha; cancelar plate; gerar reimpressão; listar fila; calcular prioridade.

## Motor de prioridade v1 (regras determinísticas)

1. prazo; 2. tempo de impressão; 3. quantidade; 4. urgência; 5. prioridade manual.

Considerar também disponibilidade do operador, escala, material e redução de trocas.

## Frontend planejado

Impressoras; Fila de produção; Detalhe do Plate; Nova ordem de produção; Falhas.

## Critérios de aceite (quando implementado)

- Pedido aprovado gera produção.
- Produção pode gerar vários plates; plate pode conter itens de pedidos diferentes.
- Falha pode gerar reimpressão; reimpressão volta ao topo da fila.
- Sky ainda não é obrigatória nesta fase.

## Testes planejados

um pedido/um plate; um pedido/vários plates; vários pedidos/um plate; falha parcial;
reimpressão; prioridade manual.

## Commit sugerido (quando iniciado)

`feat: implement production queue and plates`

## Status geral

**NÃO INICIADO.**

---

# 8. Módulo 3 — Estoque e Inventário

## Objetivo

Controlar materiais, reservas, perdas e inventário.

## Escopo por fase

1. **Definição funcional** — concluída (doc `01` §15–21).
2. **Modelo e regras** — especificada em doc `03` (§12–16: `filament_types`, `spool_tares`,
   `filament_spools`, `accessories`, `packaging`, `suppliers`, `stock_movements`,
   `stock_reservations`, `inventories`, `inventory_items`); **migrations não criadas**.
3. **Backend** — não iniciado.
4. **Frontend** — não iniciado.
5. **Integração E2E** — não iniciada.
6. **Piloto real** — não iniciado.
7. **Estabilização / release** — não iniciada.

## Backend planejado

- cadastrar filamento/rolo/tara/acessório/embalagem; registrar entrada; reservar/liberar
  material; registrar consumo/perda; abrir inventário; registrar pesagem/contagem; fechar
  inventário; aplicar ajuste.

## Regras

- Reserva ocorre quando produção entra em fila.
- Estoque disponível = físico − reservado.
- Inventário não apaga histórico; pesagem deve descontar tara; ajuste gera movimentação.

## Frontend planejado

Filamentos; Rolos; Taras; Acessórios; Embalagens; Entradas; Movimentações; Inventário; Alertas
de estoque.

## Critérios de aceite (quando implementado)

cadastrar rolo; registrar entrada; reservar filamento; consumir material; registrar perda; pesar
rolo descontando tara; ajustar estoque; preservar histórico.

## Testes planejados

rolo com tara conhecida; rolo com tara ausente; reserva; consumo; falha; inventário com/sem
diferença.

## Commit sugerido (quando iniciado)

`feat: implement stock and inventory management`

## Status geral

**NÃO INICIADO.**

---

# 9. Módulo 4 — Precificação e Rentabilidade

## Objetivo

Calcular custos e preços com histórico.

## Escopo por fase

1. **Definição funcional** — concluída (doc `01` §22–30).
2. **Modelo e regras** — especificada em doc `03` (§17–18: `work_logs`, `pricing_calculations`,
   `parameters`, `parameter_history`); **migrations não criadas**.
3. **Backend** — não iniciado.
4. **Frontend** — não iniciado.
5. **Integração E2E** — não iniciada.
6. **Piloto real** — não iniciado.
7. **Estabilização / release** — não iniciada.

## Parâmetros iniciais

MDO: R$ 5,90/h; energia: R$ 0,12/h; depreciação: R$ 0,25/h; manutenção: R$ 0,00/h; margem
mínima 40%; margem máxima 80%.

## Backend planejado

- registrar MDO; iniciar/encerrar apontamento; calcular custo; calcular/sugerir preço; registrar
  preço final; recalcular margem; consultar rentabilidade; revisar parâmetros.

## Regras

- Preservar parâmetros usados no cálculo.
- Catálogo mantém preço se custo cair; se custo subir, gerar alerta.
- Spot pode registrar referência de mercado; perda histórica configurável; arredondamento em
  R$ 0,50.

## Frontend planejado

Calculadora de preço; Histórico de cálculos; Parâmetros; Rentabilidade; MDO.

## Critérios de aceite (quando implementado)

calcular item simples/Spot/Personalizado/Catálogo; preservar parâmetros históricos; mostrar
custo unitário/total; mostrar preço sugerido; aceitar preço final manual.

## Testes planejados

mudança de MDO; mudança de energia; custo de catálogo maior/menor; margem 40%/80%;
arredondamento.

## Commit sugerido (quando iniciado)

`feat: implement pricing and profitability`

## Status geral

**NÃO INICIADO.**

---

# 10. Módulo 5 — Manutenção e Equipamentos

## Objetivo

Registrar manutenções realizadas e gerar lembretes preventivos para os equipamentos de
impressão.

## Escopo por fase

1. **Definição funcional** — concluída (doc `01` §65: manutenção, lubrificação de eixos X/Y/Z,
   próxima manutenção, lembretes preventivos).
2. **Modelo e regras** — especificada em doc `03` (§24: `maintenance_records`,
   `maintenance_rules`); **migrations não criadas**.
3. **Backend** — não iniciado.
4. **Frontend** — não iniciado.
5. **Integração E2E** — não iniciada.
6. **Piloto real** — não iniciado.
7. **Estabilização / release** — não iniciada.

## Itens iniciais de manutenção

- lubrificação eixo X; lubrificação eixo Y; lubrificação eixo Z; limpeza; troca de componente;
  outro.

## Backend planejado

- registrar manutenção realizada (impressora, data, tipo, componente, horas de uso, observação);
  cadastrar regra de manutenção preventiva (intervalo em dias ou horas de uso); calcular próxima
  manutenção; gerar alerta preventivo.

## Frontend planejado

Manutenções; Nova manutenção; Regras de manutenção; Alertas de manutenção.

## Critérios de aceite (quando implementado)

registrar manutenção realizada; calcular e exibir próxima manutenção prevista; gerar alerta
quando a manutenção estiver vencida ou próxima.

## Status geral

**NÃO INICIADO.** Este módulo não possuía um Bloco próprio no plano anterior (v0.1); passa a
existir como módulo independente nesta reorganização, aproveitando a especificação já existente
nos docs `01` e `03`.

---

# 11. Módulo 6 — Onboarding, Alertas e Gestão

## Objetivo

Evitar que o sistema fique complexo para uso diário; guiar a configuração inicial e manter o
usuário informado sobre pendências.

## Escopo por fase

1. **Definição funcional** — concluída (doc `01` §3, §59–64, §66).
2. **Modelo e regras** — parcialmente especificada em doc `03`: `alerts`, `notifications`
   (§22), reaproveita `parameters`/`parameter_history` (§23, criados no Módulo 4); a escala de
   trabalho (`work_shift_cycles`, `work_schedule` — doc `03` §25) também está especificada e
   pertence ao onboarding, mas ainda não possui migrations.
3. **Backend** — não iniciado.
4. **Frontend** — não iniciado.
5. **Integração E2E** — não iniciada.
6. **Piloto real** — não iniciado.
7. **Estabilização / release** — não iniciada.

## Onboarding — etapas iniciais

1. usuário; 2. impressora; 3. escala; 4. parâmetros; 5. meios de pagamento; 6. filamentos;
7. taras; 8. estoque; 9. produtos; 10. integrações opcionais.

## Backend planejado

- verificar configuração; calcular progresso; identificar pendências; criar/reconhecer/resolver
  alerta; calcular próxima revisão; gerar resumo diário.

## Regras

- Pendências: bloqueante, importante, informativa.
- Alertas importantes persistem até reconhecimento.

## Frontend planejado

Boas-vindas; Configuração inicial; Progresso; Pendências; Alertas; Parâmetros; Resumo do dia.

## Critérios de aceite (quando implementado)

usuário novo recebe onboarding; progresso é calculado; pendência faltante aparece; bloqueante
impede ação correta; informativa não bloqueia; alerta pode ser resolvido.

## Commit sugerido (quando iniciado)

`feat: implement onboarding alerts and parameter reviews`

## Status geral

**NÃO INICIADO.**

---

# 12. Módulo 7 — Sky Assistente em Texto

## Objetivo

Permitir operar o sistema por linguagem natural, em texto, antes de implementar voz.

## Escopo por fase

1. **Definição funcional** — concluída (doc `01` §52–60, §73).
2. **Modelo e regras** — não especifica tabelas próprias; depende dos módulos já modelados
   (chamará funções de negócio existentes via ferramentas autorizadas).
3. **Backend** — não iniciado (integração OpenAI, camada de ferramentas autorizadas).
4. **Frontend** — não iniciado (tela de chat).
5. **Integração E2E** — não iniciada.
6. **Piloto real** — não iniciado.
7. **Estabilização / release** — não iniciada.

## Integração

OpenAI API via backend. A Sky só pode chamar ferramentas autorizadas (nunca SQL livre).

## Ferramentas iniciais

criar cliente; buscar cliente; criar pedido; atualizar pedido; registrar pagamento; consultar
pedidos; criar produção; consultar fila; consultar estoque; registrar MDO; calcular preço;
consultar parâmetros; consultar alertas; gerar resumo diário.

## Regras de conversa

respostas curtas; perguntar o que falta; não inventar; contexto durante a sessão; usar "nós";
tom amigável; humor moderado; precisão acima de velocidade.

## Frontend planejado

Chat Sky.

## Critérios de aceite (quando implementado)

Exemplos que devem funcionar: "Sky, registra um pedido para o João.", "Sky, quais pedidos estão
atrasados?", "Sky, o que produzimos agora?", "Sky, quanto devemos cobrar?", "Sky, estamos com
PLA preto suficiente?"

## Testes planejados

dados completos; dados faltantes; correção contextual; referência ao pedido anterior; tentativa
de ação não autorizada.

## Commit sugerido (quando iniciado)

`feat: integrate Sky text assistant`

## Status geral

**NÃO INICIADO.** Depende dos Módulos 1–6 estarem operacionais para ter ferramentas reais a
chamar.

---

# 13. Módulo 8 — Sky Assistente por Voz

## Objetivo

Adicionar voz sem alterar o núcleo do sistema.

## Escopo por fase

1. **Definição funcional** — concluída (doc `01` §54–55, §69).
2. **Modelo e regras** — não aplicável (reaproveita módulo 7).
3. **Backend** — não iniciado.
4. **Frontend** — não iniciado.
5. **Integração E2E** — não iniciada.
6. **Piloto real** — não iniciado.
7. **Estabilização / release** — não iniciada.

## Etapa 8.1 — Voz dentro do app

speech-to-text; text-to-speech; sessão de 3 minutos; botão para falar; interrupção; retomada.

## Etapa 8.2 — Prova técnica iOS

Siri; App Intents; Shortcuts; botão de Ação; limitações de wake word; background.

## Regra

Não impedir o MVP caso "Hey Sky" independente não seja possível no iOS.

## Critérios de aceite (quando implementado)

usuário fala; Sky entende; ação é executada; resposta volta em voz; conversa continua por
3 minutos.

## Commit sugerido (quando iniciado)

`feat: add Sky voice interaction`

## Status geral

**NÃO INICIADO.** Depende do Módulo 7 estar operacional.

---

# 14. Módulo 9 — Divulgação e Marketing

## Objetivo

Transformar a Sky em assistente de marketing didático.

## Escopo por fase

1. **Definição funcional** — concluída (doc `01` §31–43).
2. **Modelo e regras** — especificada em doc `03` (§21: `marketing_events`, `marketing_plans`,
   `publications`, `publication_metrics`); **migrations não criadas**.
3. **Backend** — não iniciado.
4. **Frontend** — não iniciado.
5. **Integração E2E** — não iniciada.
6. **Piloto real** — não iniciado.
7. **Estabilização / release** — não iniciada.

## Backend planejado

- criar evento; sugerir oportunidade; criar planejamento; gerar conteúdo; solicitar/aprovar
  conteúdo; registrar publicação/métricas; gerar análise 24h/semanal/mensal; sugerir candidato a
  Catálogo.

## Frontend planejado

Calendário; Planejamento; Conteúdo; Aprovação; Publicações; Métricas; Análises.

## Regras

- 2 posts por semana inicialmente; nenhuma publicação sem aprovação; datas principais
  automáticas; datas locais/esportivas manuais; antecedência 45 dias; explicar sempre a
  estratégia.

## Critérios de aceite (quando implementado)

Sky deve conseguir explicar o que publicar, por que publicar, objetivo e conteúdo necessário.

## Commit sugerido (quando iniciado)

`feat: implement marketing planning and approval`

## Status geral

**NÃO INICIADO.**

---

# 15. Módulo 10 — Integrações Externas

Cada integração deve possuir prova técnica própria.

## Escopo por fase (aplicado a cada subintegração)

1. **Definição funcional** — concluída (doc `01` §44–51, §69).
2. **Modelo e regras** — não especificada em detalhe por integração; dependerá da prova técnica.
3–7. **Backend / Frontend / E2E / Piloto / Estabilização** — não iniciados.

## 15.1 Instagram

Objetivos: publicação; agendamento; métricas. Critério: nenhuma publicação sem aprovação.

## 15.2 Smart Life / JWCOM

Objetivo: validar leitura de energia. Se não funcionar: manter cálculo estimado.

## 15.3 Bambu

Objetivo inicial: validar leitura de status e dados. Comandos somente após confirmação.

## 15.4 WhatsApp

Prioridade posterior. Avaliar notificações, leitura, criação de clientes, pedidos.

## 15.5 Facebook

Adicionar após Instagram estar estável.

## 15.6 TikTok

Adicionar após Instagram estar estável.

## Status geral

**NÃO INICIADO.**

---

# 16. Revisão técnica após cada módulo

Antes de avançar para o próximo módulo:

- executar testes;
- corrigir erros;
- revisar interface;
- revisar banco;
- verificar logs;
- verificar segurança;
- atualizar documentação (incluindo `05_ROADMAP_MODULOS.md`);
- realizar commit.

---

# 17. Definição de pronto por módulo

Um módulo não está pronto apenas porque "funciona na máquina do desenvolvedor", nem apenas
porque o backend responde via API/PowerShell. Deve:

- funcionar localmente pelo **frontend**, sem chamadas manuais de API;
- passar testes;
- preservar dados;
- não gerar erro no console relevante;
- possuir mensagens compreensíveis;
- estar documentado;
- estar commitado;
- ser demonstrável.

Somente quando essas condições forem atendidas o módulo recebe status **OPERACIONAL** (ver
§3.3).

---

# 18. Revisão do MVP

Após concluir os módulos necessários ao MVP:

## Teste técnico

Validar fluxos completos.

## Uso real

Operar por aproximadamente **2 semanas**.

Registrar: campos desnecessários; campos faltantes; cliques excessivos; alertas ruins; falhas de
lógica; dificuldades de uso.

## Primeira revisão

Classificar: Corrigir imediatamente; Melhorar; Futuro.

## Revisão de 30 dias

Usar dados reais para avaliar: pedidos; produção; estoque; perdas; rentabilidade; Sky;
marketing.

---

# 19. Funcionalidades que não devem atrasar o MVP

Não bloquear lançamento por: machine learning; Facebook; TikTok; leitura automática do
WhatsApp; integração bancária; wake word totalmente independente no iPhone; controle completo da
Bambu; telemetria perfeita da tomada.

Sempre preferir alternativa manual funcional.

---

# 20. Checkpoint recomendado antes do Claude começar um módulo

Antes de pedir implementação:

- confirmar Supabase criado; confirmar GitHub criado; confirmar Node.js; confirmar VS Code;
  confirmar Claude Code; confirmar Git;
- confirmar documentos em `docs`, incluindo `05_ROADMAP_MODULOS.md` atualizado;
- confirmar estrutura de pastas.

---

# 21. Primeiro comando recomendado ao Claude Code (por módulo)

Quando o ambiente estiver pronto, não pedir:

> "Construa todo o sistema."

Pedir algo equivalente a:

> Leia os arquivos `docs/01_ESPECIFICACAO_FUNCIONAL.md`, `docs/02_ESPECIFICACAO_TECNICA.md`,
> `docs/03_MODELO_BANCO_DADOS.md`, `docs/04_PLANO_IMPLEMENTACAO.md` e
> `docs/05_ROADMAP_MODULOS.md`. Não implemente ainda. Faça uma análise do Módulo [N] — [nome],
> Fase [X], liste as tarefas que pretende executar, dependências necessárias, riscos e arquivos
> que serão criados ou alterados. Aguarde minha aprovação antes de modificar qualquer arquivo.

---

# 22. Filosofia de execução

O objetivo não é construir rápido a qualquer custo.

O objetivo é construir de forma que cada etapa possa ser: entendida; testada; corrigida;
revertida; evoluída.

> **Uma funcionalidade pequena e confiável vale mais do que cinco funcionalidades incompletas.**

> **Terminar um módulo e colocá-lo em uso real vale mais do que iniciar o próximo módulo com o
> anterior pela metade.**
