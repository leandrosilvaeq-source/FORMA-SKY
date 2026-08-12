# Plano de Implementação v0.1
## Forma 3D Studio + Assistente Virtual Sky

**Status:** Plano inicial de execução  
**Documentos de referência:**
- `01_ESPECIFICACAO_FUNCIONAL.md`
- `02_ESPECIFICACAO_TECNICA.md`
- `03_MODELO_BANCO_DADOS.md`

---

# 1. Objetivo

Este documento transforma a especificação funcional, técnica e o modelo de banco de dados em uma sequência prática de implementação.

O desenvolvimento deverá ser incremental.

O Claude Code **não deverá tentar implementar todo o sistema de uma única vez**.

Cada bloco deverá ser:

1. revisado;
2. implementado;
3. testado;
4. demonstrado;
5. corrigido;
6. validado;
7. versionado em Git;
8. somente então seguido pelo próximo bloco.

---

# 2. Regras gerais para o Claude Code

Antes de iniciar qualquer bloco:

1. Ler `01_ESPECIFICACAO_FUNCIONAL.md`.
2. Ler `02_ESPECIFICACAO_TECNICA.md`.
3. Ler `03_MODELO_BANCO_DADOS.md`.
4. Verificar se existem decisões pendentes que impactam o bloco.
5. Não alterar regras de negócio aprovadas sem sinalizar impacto.
6. Não criar funcionalidades fora do escopo do bloco sem necessidade.
7. Sempre preservar a possibilidade de evolução futura.
8. Não expor segredos no frontend.
9. Criar testes mínimos antes de considerar o bloco concluído.
10. Fazer commit ao final de cada bloco aprovado.

---

# 3. Estratégia de branches

Recomendação inicial:

- `main` — versão estável
- `develop` — integração

Branches por bloco:

- `feature/foundation`
- `feature/customers-orders`
- `feature/production`
- `feature/inventory`
- `feature/pricing`
- `feature/onboarding-alerts`
- `feature/sky-text`
- `feature/sky-voice`
- `feature/marketing`
- `feature/integrations`

---

# 4. Bloco 0 — Fundação

## Objetivo

Criar a base técnica mínima para permitir desenvolvimento seguro.

## Tarefas

- Inicializar Git.
- Criar repositório GitHub.
- Criar branch `develop`.
- Configurar React + Vite.
- Configurar TypeScript.
- Configurar ESLint.
- Configurar estrutura de pastas.
- Criar `.gitignore`.
- Criar `.env.example`.
- Criar README principal.
- Criar projeto Supabase.
- Configurar conexão com Supabase.
- Configurar Supabase Auth básico.
- Criar primeira migration.
- Configurar ambiente local.
- Configurar biblioteca de componentes base.
- Criar layout inicial responsivo.
- Criar página simples de login.
- Criar página inicial vazia autenticada.
- Validar execução local.

## Critérios de aceite

- Projeto abre no VS Code.
- `npm install` funciona.
- `npm run dev` funciona.
- Login funciona.
- Usuário autenticado acessa tela inicial.
- Chaves não aparecem no código.
- Projeto está versionado em Git.
- Primeiro commit existe.

## Testes mínimos

- build sem erro;
- lint sem erro crítico;
- autenticação;
- conexão com Supabase.

## Commit sugerido

`feat: initialize Forma Sky project foundation`

---

# 5. Bloco 1 — Clientes e Pedidos

## Objetivo

Permitir registrar a operação comercial básica da Forma.

## Escopo

- clientes;
- empresas;
- origem;
- pedidos;
- itens;
- Personalizado;
- Spot;
- Catálogo;
- status;
- pagamentos;
- meios de pagamento.

## Tarefas de banco

Criar migrations para:

- `companies`
- `customers`
- `lead_sources`
- `orders`
- `order_items`
- `custom_item_details`
- `custom_versions`
- `approvals`
- `model_sources`
- `spot_item_details`
- `products`
- `product_price_history`
- `payments`

## Seeds

Criar:

- origens;
- status;
- meios de pagamento;
- tipos de pedido;
- fontes iniciais de modelo.

## Backend

Criar funções:

- criar cliente;
- editar cliente;
- buscar cliente;
- criar empresa;
- criar pedido;
- editar pedido;
- criar item;
- alterar status;
- registrar aprovação;
- registrar pagamento;
- cancelar pedido;
- listar pedidos;
- buscar pedido por número.

## Frontend

Criar telas:

- Clientes;
- Empresas;
- Pedidos;
- Novo Pedido;
- Detalhe do Pedido;
- Novo Produto de Catálogo;
- Lista de Produtos.

## Regras importantes

- Pedido pode conter itens de tipos diferentes.
- Catálogo pode usar preço cadastrado.
- Spot exige aprovação simples.
- Personalizado exige fluxo de aprovação.
- Status financeiro é independente do status operacional.
- Pedido encerrado somente quando Entregue + Pago.

## Critérios de aceite

O usuário deve conseguir:

1. cadastrar cliente;
2. criar pedido;
3. adicionar múltiplos itens;
4. classificar tipos;
5. alterar status;
6. registrar pagamento;
7. registrar prazo;
8. registrar entrega;
9. consultar pedido salvo após recarregar o sistema.

## Testes

- pedido com item Personalizado;
- pedido com item Spot;
- pedido com item Catálogo;
- pedido misto;
- status independentes;
- cancelamento antes da produção.

## Commit sugerido

`feat: implement customers and orders core`

---

# 6. Bloco 2 — Produção

## Objetivo

Transformar pedidos aprovados em produção executável.

## Banco

Criar:

- `printers`
- `production_orders`
- `plates`
- `plate_items`
- `failure_reasons`
- `production_failures`

## Seeds

Criar impressora inicial:

- Nome: A1 Principal
- Fabricante: Bambu Lab
- Modelo: A1

## Backend

Funções:

- criar ordem de produção;
- criar plate;
- adicionar item ao plate;
- remover item do plate;
- iniciar plate;
- concluir plate;
- registrar falha;
- cancelar plate;
- gerar reimpressão;
- listar fila;
- calcular prioridade.

## Motor de prioridade v1

Usar regras determinísticas.

Critérios:

1. prazo;
2. tempo;
3. quantidade;
4. urgência;
5. prioridade manual.

Considerar também:

- disponibilidade do operador;
- escala;
- material;
- possibilidade de reduzir trocas.

## Frontend

Telas:

- Impressoras;
- Fila de produção;
- Detalhe do Plate;
- Nova ordem de produção;
- Falhas.

## Critérios de aceite

- Pedido aprovado gera produção.
- Produção pode gerar vários plates.
- Plate pode conter itens de pedidos diferentes.
- Falha pode gerar reimpressão.
- Reimpressão volta ao topo da fila.
- Sky ainda não é obrigatória nesta fase.

## Testes

- um pedido / um plate;
- um pedido / vários plates;
- vários pedidos / um plate;
- falha parcial;
- reimpressão;
- prioridade manual.

## Commit sugerido

`feat: implement production queue and plates`

---

# 7. Bloco 3 — Estoque e Inventário

## Objetivo

Controlar materiais, reservas, perdas e inventário.

## Banco

Criar:

- `suppliers`
- `filament_types`
- `spool_tares`
- `filament_spools`
- `accessories`
- `packaging`
- `stock_movements`
- `stock_reservations`
- `inventories`
- `inventory_items`

## Backend

Funções:

- cadastrar filamento;
- cadastrar rolo;
- registrar entrada;
- cadastrar tara;
- cadastrar acessório;
- cadastrar embalagem;
- reservar material;
- liberar reserva;
- registrar consumo;
- registrar perda;
- abrir inventário;
- registrar pesagem;
- registrar contagem;
- fechar inventário;
- aplicar ajuste.

## Regras

- Reserva ocorre quando produção entra em fila.
- Estoque disponível = físico - reservado.
- Inventário não apaga histórico.
- Pesagem deve descontar tara.
- Ajuste de inventário gera movimentação.

## Frontend

Telas:

- Filamentos;
- Rolos;
- Taras;
- Acessórios;
- Embalagens;
- Entradas;
- Movimentações;
- Inventário;
- Alertas de estoque.

## Critérios de aceite

- cadastrar rolo;
- registrar entrada;
- reservar filamento;
- consumir material;
- registrar perda;
- pesar rolo;
- descontar tara;
- ajustar estoque;
- preservar histórico.

## Testes

- rolo com tara conhecida;
- rolo com tara ausente;
- reserva;
- consumo;
- falha;
- inventário com diferença;
- inventário sem diferença.

## Commit sugerido

`feat: implement stock and inventory management`

---

# 8. Bloco 4 — Precificação e Rentabilidade

## Objetivo

Calcular custos e preços com histórico.

## Banco

Criar:

- `work_logs`
- `pricing_calculations`
- `parameters`
- `parameter_history`

## Backend

Funções:

- registrar MDO;
- iniciar apontamento;
- encerrar apontamento;
- calcular custo;
- calcular preço;
- sugerir preço;
- registrar preço final;
- recalcular margem;
- consultar rentabilidade;
- revisar parâmetros.

## Parâmetros iniciais

- MDO: R$ 5,90/h
- energia: R$ 0,12/h
- depreciação: R$ 0,25/h
- manutenção: R$ 0,00/h
- margem mínima: 40%
- margem máxima: 80%

## Regras

- Preservar parâmetros usados no cálculo.
- Catálogo mantém preço se custo cair.
- Se custo subir, gerar alerta.
- Spot pode registrar referência de mercado.
- Perda histórica configurável.
- Arredondamento em R$ 0,50.

## Frontend

Telas:

- Calculadora de preço;
- Histórico de cálculos;
- Parâmetros;
- Rentabilidade;
- MDO.

## Critérios de aceite

- calcular item simples;
- calcular Spot;
- calcular Personalizado;
- calcular Catálogo;
- preservar parâmetros históricos;
- mostrar custo unitário;
- mostrar custo total;
- mostrar preço sugerido;
- aceitar preço final manual.

## Testes

- mudança de MDO;
- mudança de energia;
- custo de catálogo maior;
- custo menor;
- margem 40%;
- margem 80%;
- arredondamento.

## Commit sugerido

`feat: implement pricing and profitability`

---

# 9. Bloco 5 — Onboarding, Alertas e Parâmetros

## Objetivo

Evitar que o sistema fique complexo para uso diário.

## Banco

Criar:

- `alerts`
- `notifications`

Aproveitar:

- `parameters`
- `parameter_history`

## Backend

Funções:

- verificar configuração;
- calcular progresso;
- identificar pendências;
- criar alerta;
- reconhecer alerta;
- resolver alerta;
- calcular próxima revisão;
- gerar resumo diário.

## Onboarding

Etapas iniciais:

1. usuário;
2. impressora;
3. escala;
4. parâmetros;
5. meios de pagamento;
6. filamentos;
7. taras;
8. estoque;
9. produtos;
10. integrações opcionais.

## Regras

Pendências:

- bloqueante;
- importante;
- informativa.

Alertas importantes persistem até reconhecimento.

## Frontend

Telas:

- Boas-vindas;
- Configuração inicial;
- Progresso;
- Pendências;
- Alertas;
- Parâmetros;
- Resumo do dia.

## Critérios de aceite

- usuário novo recebe onboarding;
- progresso é calculado;
- pendência faltante aparece;
- bloqueante impede ação correta;
- informativa não bloqueia;
- alerta pode ser resolvido.

## Commit sugerido

`feat: implement onboarding alerts and parameter reviews`

---

# 10. Bloco 6 — Sky em Texto

## Objetivo

Permitir operar o sistema por linguagem natural antes de implementar voz.

## Integração

OpenAI API via backend.

## Segurança

A Sky só pode chamar ferramentas autorizadas.

## Ferramentas iniciais

- criar cliente;
- buscar cliente;
- criar pedido;
- atualizar pedido;
- registrar pagamento;
- consultar pedidos;
- criar produção;
- consultar fila;
- consultar estoque;
- registrar MDO;
- calcular preço;
- consultar parâmetros;
- consultar alertas;
- gerar resumo diário.

## Regras de conversa

- respostas curtas;
- perguntar o que falta;
- não inventar;
- contexto durante a sessão;
- usar “nós”;
- tom amigável;
- humor moderado;
- precisão acima de velocidade.

## Frontend

Tela:

- Chat Sky.

## Critérios de aceite

Exemplos que devem funcionar:

> Sky, registra um pedido para o João.

> Sky, quais pedidos estão atrasados?

> Sky, o que produzimos agora?

> Sky, quanto devemos cobrar?

> Sky, estamos com PLA preto suficiente?

## Testes

- dados completos;
- dados faltantes;
- correção contextual;
- referência ao pedido anterior;
- tentativa de ação não autorizada.

## Commit sugerido

`feat: integrate Sky text assistant`

---

# 11. Bloco 7 — Sky por Voz

## Objetivo

Adicionar voz sem alterar o núcleo do sistema.

## Etapa 7.1 — Voz dentro do app

Implementar:

- speech-to-text;
- text-to-speech;
- sessão de 3 minutos;
- botão para falar;
- interrupção;
- retomada.

## Etapa 7.2 — Prova técnica iOS

Validar:

- Siri;
- App Intents;
- Shortcuts;
- botão de Ação;
- limitações de wake word;
- background.

## Regra

Não impedir o MVP caso “Hey Sky” independente não seja possível.

## Critérios de aceite

- usuário fala;
- Sky entende;
- ação é executada;
- resposta volta em voz;
- conversa continua por 3 minutos.

## Commit sugerido

`feat: add Sky voice interaction`

---

# 12. Bloco 8 — Divulgação e Marketing

## Objetivo

Transformar a Sky em assistente de marketing didático.

## Banco

Criar:

- `marketing_events`
- `marketing_plans`
- `publications`
- `publication_metrics`

## Backend

Funções:

- criar evento;
- sugerir oportunidade;
- criar planejamento;
- gerar conteúdo;
- solicitar aprovação;
- aprovar conteúdo;
- registrar publicação;
- registrar métricas;
- gerar análise 24h;
- gerar análise semanal;
- gerar análise mensal;
- sugerir candidato a Catálogo.

## Frontend

Telas:

- Calendário;
- Planejamento;
- Conteúdo;
- Aprovação;
- Publicações;
- Métricas;
- Análises.

## Regras

- 2 posts por semana inicialmente.
- Nenhuma publicação sem aprovação.
- Datas principais automáticas.
- Datas locais/esportivas manuais.
- Antecedência 45 dias.
- Explicar sempre estratégia.

## Critérios de aceite

Sky deve conseguir explicar:

- o que publicar;
- por que publicar;
- objetivo;
- conteúdo necessário.

## Commit sugerido

`feat: implement marketing planning and approval`

---

# 13. Bloco 9 — Integrações Externas

Cada integração deve possuir prova técnica própria.

---

## 13.1 Instagram

Objetivos:

- publicação;
- agendamento;
- métricas.

Critério:

nenhuma publicação sem aprovação.

---

## 13.2 Smart Life / JWCOM

Objetivo:

validar leitura de energia.

Se não funcionar:

manter cálculo estimado.

---

## 13.3 Bambu

Objetivo inicial:

validar leitura de status e dados.

Comandos somente após confirmação.

---

## 13.4 WhatsApp

Prioridade posterior.

Avaliar:

- notificações;
- leitura;
- criação de clientes;
- pedidos.

---

## 13.5 Facebook

Adicionar após Instagram estar estável.

---

## 13.6 TikTok

Adicionar após Instagram estar estável.

---

# 14. Revisão técnica após cada bloco

Antes de avançar:

- executar testes;
- corrigir erros;
- revisar interface;
- revisar banco;
- verificar logs;
- verificar segurança;
- atualizar documentação;
- realizar commit.

---

# 15. Definição de pronto por bloco

Um bloco não está pronto apenas porque “funciona na máquina do desenvolvedor”.

Deve:

- funcionar localmente;
- passar testes;
- preservar dados;
- não gerar erro no console relevante;
- possuir mensagens compreensíveis;
- estar documentado;
- estar commitado;
- ser demonstrável.

---

# 16. Revisão do MVP

Após concluir os blocos necessários ao MVP:

## Teste técnico

Validar fluxos completos.

## Uso real

Operar por aproximadamente **2 semanas**.

Registrar:

- campos desnecessários;
- campos faltantes;
- cliques excessivos;
- alertas ruins;
- falhas de lógica;
- dificuldades de uso.

## Primeira revisão

Classificar:

- Corrigir imediatamente;
- Melhorar;
- Futuro.

## Revisão de 30 dias

Usar dados reais para avaliar:

- pedidos;
- produção;
- estoque;
- perdas;
- rentabilidade;
- Sky;
- marketing.

---

# 17. Funcionalidades que não devem atrasar o MVP

Não bloquear lançamento por:

- machine learning;
- Facebook;
- TikTok;
- leitura automática do WhatsApp;
- integração bancária;
- wake word totalmente independente no iPhone;
- controle completo da Bambu;
- telemetria perfeita da tomada.

Sempre preferir alternativa manual funcional.

---

# 18. Checkpoint recomendado antes do Claude começar

Antes de pedir implementação:

- confirmar Supabase criado;
- confirmar GitHub criado;
- confirmar Node.js;
- confirmar VS Code;
- confirmar Claude Code;
- confirmar Git;
- confirmar documentos em `docs`;
- confirmar estrutura de pastas.

---

# 19. Primeiro comando recomendado ao Claude Code

Quando o ambiente estiver pronto, não pedir:

> “Construa todo o sistema.”

Pedir algo equivalente a:

> Leia os arquivos `docs/01_ESPECIFICACAO_FUNCIONAL.md`, `docs/02_ESPECIFICACAO_TECNICA.md`, `docs/03_MODELO_BANCO_DADOS.md` e `docs/04_PLANO_IMPLEMENTACAO.md`. Não implemente ainda. Faça uma análise do Bloco 0 — Fundação, liste as tarefas que pretende executar, dependências necessárias, riscos e arquivos que serão criados ou alterados. Aguarde minha aprovação antes de modificar qualquer arquivo.

---

# 20. Filosofia de execução

O objetivo não é construir rápido a qualquer custo.

O objetivo é construir de forma que cada etapa possa ser:

- entendida;
- testada;
- corrigida;
- revertida;
- evoluída.

> **Uma funcionalidade pequena e confiável vale mais do que cinco funcionalidades incompletas.**
