# Especificação Técnica v0.1
## Forma 3D Studio + Assistente Virtual Sky

**Status:** Base técnica inicial aprovada para desenvolvimento  
**Documento funcional de referência:** `01_ESPECIFICACAO_FUNCIONAL.md`  
**Objetivo:** Traduzir a especificação funcional da Forma 3D Studio em uma arquitetura técnica clara, modular, testável e apropriada para desenvolvimento assistido com Claude Code no VS Code.

---

# 1. Princípios técnicos do projeto

O projeto deve seguir os princípios abaixo:

1. **Complexidade no sistema, simplicidade para o usuário.**
2. **Banco de dados como fonte oficial da verdade.**
3. **A Sky não grava diretamente no banco.**
4. **Toda alteração de dados deve passar por regras de negócio controladas.**
5. **Integrações externas devem ficar isoladas do núcleo do sistema.**
6. **O sistema deve possuir alternativas manuais quando uma integração não estiver disponível.**
7. **O desenvolvimento deverá ser incremental e testável.**
8. **O frontend não deve conter regras críticas de negócio.**
9. **Nenhuma integração externa deve ser considerada obrigatória para o núcleo funcionar.**
10. **Mudanças relevantes devem ser versionadas em Git desde o início.**
11. **Machine learning próprio não faz parte do MVP.**
12. **O sistema deve preservar histórico sempre que uma alteração possa impactar análise futura.**

---

# 2. Stack técnica aprovada

## 2.1 IDE e desenvolvimento

**IDE principal:** Visual Studio Code

**Desenvolvimento assistido:** Claude Code integrado ao VS Code

O Claude Code deverá trabalhar diretamente sobre a pasta/repositório oficial do projeto.

Ele deverá sempre consultar os arquivos presentes em `/docs` antes de implementar funcionalidades relevantes.

---

## 2.2 Versionamento

**Git** será usado desde o início.

**GitHub** será o repositório remoto recomendado.

Nenhuma alteração estrutural relevante deverá ser feita sem commit.

Convenção recomendada:

- `main` — versão estável;
- `develop` — integração das funcionalidades;
- branches temporárias por funcionalidade, quando necessário.

Exemplos:

- `feature/pedidos`
- `feature/producao`
- `feature/estoque`
- `feature/sky`
- `fix/inventario`

---

## 2.3 Frontend

**React + Vite**

Responsabilidades:

- telas;
- formulários;
- dashboards;
- componentes de interface;
- experiência mobile;
- onboarding;
- interação com a Sky;
- visualização de alertas;
- visualização de parâmetros;
- consumo das APIs/funções do backend.

O frontend não deverá acessar dados sensíveis ou regras críticas de negócio diretamente.

---

## 2.4 Backend

Backend principal baseado em:

**Supabase Edge Functions**, complementadas pelas capacidades nativas do Supabase.

Responsabilidades:

- regras de negócio;
- validações;
- ações da Sky;
- integrações externas;
- cálculos;
- automações;
- segurança;
- autorização;
- persistência de operações críticas;
- geração de alertas;
- lógica de fila;
- precificação;
- histórico.

Caso futuramente as Edge Functions deixem de ser suficientes, o projeto deverá permitir migração gradual para um backend dedicado sem reconstrução do frontend ou banco.

---

## 2.5 Banco de dados

**PostgreSQL via Supabase**

O banco será a fonte oficial para:

- clientes;
- pedidos;
- itens;
- produtos;
- produção;
- plates;
- estoque;
- inventário;
- custos;
- preços;
- pagamentos;
- manutenção;
- parâmetros;
- alertas;
- marketing;
- históricos;
- integrações;
- metadados dos arquivos.

---

## 2.6 Arquivos

**Google Drive**

Usado para:

- 3MF;
- SVG;
- JPG;
- fotos;
- vídeos;
- documentos de aprovação;
- peças gráficas;
- arquivos auxiliares.

O banco deverá armazenar:

- ID/referência do arquivo;
- nome;
- tipo;
- entidade vinculada;
- data de criação;
- origem;
- link ou identificador necessário para recuperação.

O sistema não deverá depender de navegação manual pelo Drive em operações comuns.

---

## 2.7 Inteligência Artificial

**OpenAI API**

A Sky será implementada como camada inteligente do sistema.

Responsabilidades:

- interpretar linguagem natural;
- compreender contexto;
- identificar intenção;
- extrair dados da fala;
- consultar informações;
- selecionar funções disponíveis;
- sugerir ações;
- explicar decisões;
- produzir respostas curtas;
- gerar textos e conteúdo;
- apoiar marketing;
- operar o sistema por voz/texto.

A IA não será considerada fonte oficial dos dados operacionais.

---

# 3. Arquitetura de alto nível

Fluxo principal:

```text
Usuário
   ↓
Frontend React / Interface de Voz
   ↓
Sky / OpenAI
   ↓
Camada de ferramentas autorizadas
   ↓
Supabase Edge Functions
   ↓
PostgreSQL / Google Drive / Integrações
```

Para operações sem IA:

```text
Usuário
   ↓
Frontend
   ↓
Edge Function / API
   ↓
PostgreSQL
```

---

# 4. Regra de acesso da Sky

A Sky nunca deverá executar comandos SQL livremente.

Ela deverá chamar apenas funções previamente disponibilizadas.

Exemplos:

- `criar_cliente`
- `buscar_cliente`
- `criar_pedido`
- `atualizar_pedido`
- `registrar_pagamento`
- `criar_item_pedido`
- `consultar_fila_producao`
- `registrar_plate`
- `iniciar_plate`
- `finalizar_plate`
- `registrar_falha_plate`
- `consultar_estoque`
- `registrar_inventario`
- `registrar_mdo`
- `calcular_preco`
- `registrar_manutencao`
- `criar_planejamento_marketing`
- `aprovar_publicacao`

Cada função deverá:

1. validar entrada;
2. verificar permissões;
3. aplicar regra de negócio;
4. atualizar banco;
5. gerar histórico quando necessário;
6. retornar uma resposta estruturada.

---

# 5. Estrutura de pastas

Estrutura inicial:

```text
FORMA-SKY/
│
├── docs/
│   ├── 01_ESPECIFICACAO_FUNCIONAL.md
│   ├── 02_ESPECIFICACAO_TECNICA.md
│   ├── 03_MODELO_BANCO_DADOS.md
│   └── 04_PLANO_IMPLEMENTACAO.md
│
├── frontend/
│   ├── src/
│   ├── public/
│   └── ...
│
├── backend/
│   ├── functions/
│   ├── services/
│   ├── validators/
│   ├── business-rules/
│   └── ...
│
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── scripts/
│
├── integrations/
│   ├── openai/
│   ├── google-drive/
│   ├── instagram/
│   ├── smartlife/
│   ├── bambu/
│   └── whatsapp/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── .env.example
├── .gitignore
├── README.md
└── package.json
```

A estrutura poderá ser ajustada pelo Claude Code quando houver justificativa técnica.

---

# 6. Módulos técnicos

## 6.1 Módulo de usuários e autenticação

Inicialmente voltado a um único operador principal.

Mesmo assim, o banco deverá estar preparado para autenticação.

Responsabilidades:

- login;
- sessão;
- permissões;
- identificação de quem fez alterações;
- suporte futuro a novos usuários.

Supabase Auth poderá ser utilizado.

---

## 6.2 Módulo de clientes

Responsabilidades:

- cadastro;
- busca;
- atualização;
- empresas;
- canais de origem;
- histórico de pedidos;
- associação de arquivos;
- logos;
- redes sociais.

---

## 6.3 Módulo de pedidos

Responsabilidades:

- criação;
- edição;
- itens;
- tipo do item;
- prazo;
- preço;
- desconto;
- frete;
- meio de pagamento;
- status operacional;
- status financeiro;
- histórico;
- cancelamento.

Tipos:

- Personalizado;
- Spot;
- Catálogo.

---

## 6.4 Módulo de Personalizados

Responsabilidades:

- dados de adaptação;
- versionamento;
- aprovação;
- arquivos;
- documento formal;
- protótipo;
- tempo de desenvolvimento;
- exclusividade;
- eventual conversão para Catálogo.

---

## 6.5 Módulo Spot

Responsabilidades:

- referência;
- origem do modelo;
- pesquisa;
- tempo de busca/preparação;
- aprovação simples;
- impressão teste;
- arquivo final;
- reutilização;
- comparação de mercado;
- sugestão de conversão para Catálogo.

A entrada na fila deverá validar o registro da MDO de pesquisa/preparação.

---

## 6.6 Módulo de Catálogo

Responsabilidades:

- produto padrão;
- preço;
- parâmetros de produção;
- arquivo;
- consumo;
- personalização simples;
- taxa de personalização;
- histórico;
- margem;
- monitoramento de custos.

---

## 6.7 Módulo de produção

Responsabilidades:

- ordens de produção;
- plates;
- itens por plate;
- status;
- quantidades;
- início;
- término;
- falhas;
- perdas;
- reimpressões;
- fila.

Um plate poderá conter itens de vários pedidos.

---

## 6.8 Motor de priorização

Entradas principais:

- prazo;
- tempo de impressão;
- quantidade;
- urgência;
- prioridade manual;
- escala de trabalho;
- disponibilidade do operador;
- material disponível;
- redução de trocas de filamento.

Saída:

- ordem recomendada dos plates;
- justificativa curta.

A primeira versão deverá usar regras determinísticas.

Machine learning não será usado.

---

## 6.9 Módulo de estoque

Categorias:

- filamentos;
- acessórios;
- embalagens.

Responsabilidades:

- entradas;
- saídas;
- reservas;
- perdas;
- ajustes;
- saldo;
- estoque mínimo;
- histórico.

O saldo disponível deverá considerar:

```text
estoque disponível = estoque físico - estoque reservado
```

---

## 6.10 Módulo de filamentos

Cada rolo deverá ser tratado individualmente.

Dados:

- fabricante;
- material;
- linha;
- cor;
- peso nominal;
- peso atual;
- custo;
- fornecedor;
- data de compra;
- status.

---

## 6.11 Módulo de tara

Dados:

- fabricante;
- peso do carretel vazio.

Durante o inventário:

```text
peso líquido = peso medido - tara
```

---

## 6.12 Módulo de inventário

Responsabilidades:

- abertura de inventário;
- pesagem;
- conferência;
- comparação teórico x físico;
- ajuste;
- fechamento;
- histórico.

Periodicidade inicial:

**mensal**

---

## 6.13 Módulo de precificação

Componentes:

- material;
- energia;
- depreciação;
- manutenção;
- MDO;
- personalização;
- acessórios;
- embalagem;
- perdas;
- margem.

Valores iniciais:

- MDO: R$ 5,90/h;
- energia: R$ 0,12/h;
- depreciação: R$ 0,25/h;
- manutenção: R$ 0,00/h;
- margem de referência: 40% a 80%.

O cálculo deverá preservar os parâmetros usados naquele momento.

---

## 6.14 Módulo de rentabilidade

Calcular:

- custo previsto;
- custo real;
- preço vendido;
- receita;
- lucro;
- margem real;
- perdas.

---

## 6.15 Módulo de manutenção

Responsabilidades:

- registrar manutenção;
- lubrificação X;
- lubrificação Y;
- lubrificação Z;
- data;
- horas de uso;
- observações;
- próxima manutenção;
- alertas.

---

## 6.16 Módulo de marketing

Responsabilidades:

- calendário;
- planejamento;
- conteúdo;
- mídia;
- aprovação;
- publicação;
- métricas;
- análises;
- origem da venda;
- construção do Catálogo.

A Sky deverá explicar:

- o que fazer;
- por que fazer;
- objetivo comercial.

---

## 6.17 Módulo de calendário de oportunidades

Eventos automáticos:

- principais datas comerciais.

Eventos manuais:

- feriados locais;
- aniversário da cidade;
- eventos religiosos;
- eventos escolares;
- eventos esportivos;
- campeonatos;
- feiras;
- eventos empresariais.

Antecedência inicial:

**45 dias**

---

## 6.18 Módulo de parâmetros

Nenhum parâmetro relevante deverá ficar fixo no código se houver chance razoável de mudança.

Exemplos:

- MDO;
- estoques mínimos;
- margem;
- energia/hora;
- depreciação;
- manutenção/hora;
- frequência de publicação;
- tempo de conversa da Sky;
- quantidade para Spot → Catálogo;
- dias sem divulgação.

Cada parâmetro deverá possuir:

- chave;
- valor;
- unidade;
- data de vigência;
- última revisão;
- próxima revisão;
- histórico.

---

## 6.19 Módulo de alertas

Tipos:

- bloqueante;
- importante;
- informativo.

Alertas persistentes deverão permanecer ativos até:

- resolução;
- confirmação explícita;
- ação correspondente.

---

# 7. Sky — arquitetura funcional

## 7.1 Entrada

Canais:

- texto;
- voz.

## 7.2 Saída

Por padrão:

- curta;
- amigável;
- natural;
- precisa.

## 7.3 Personalidade

- feminina;
- amigável;
- parceira operacional;
- didática;
- paciente;
- bem-humorada moderada.

## 7.4 Linguagem

Preferir:

- nós;
- nosso;
- vamos;
- precisamos.

## 7.5 Contexto

A Sky deverá manter contexto temporário durante a conversa.

Para contexto persistente, deverá consultar o banco.

---

# 8. Sessão de voz

Objetivo:

- ativação por “Sky” ou “Hey Sky” quando tecnicamente possível;
- não exigir navegação manual até a tela principal;
- manter conversa contínua por 3 minutos.

A implementação deverá ser desacoplada do restante do sistema.

O núcleo deverá funcionar mesmo que a ativação por wake word não seja possível no iOS.

---

# 9. Confirmações

## Sem confirmação adicional

- consultas;
- cadastros simples;
- atualizações reversíveis;
- registros internos.

## Com confirmação

- exclusões;
- publicação externa;
- comandos físicos;
- ações irreversíveis;
- operações externas relevantes.

---

# 10. Onboarding técnico

Na primeira execução, verificar progressivamente:

- usuário;
- impressora;
- escala;
- parâmetros;
- meios de pagamento;
- filamentos;
- taras;
- estoque;
- produtos;
- integrações.

O sistema deverá permitir avanço parcial.

---

# 11. Integrações

Todas as integrações deverão possuir uma interface/serviço isolado.

Nunca misturar regras de Instagram, Bambu ou Smart Life diretamente às regras principais do domínio.

---

## 11.1 OpenAI

Usado para:

- interpretação;
- voz;
- ferramentas;
- contexto;
- geração de conteúdo;
- respostas da Sky.

Chaves devem ficar no backend.

Nunca expor chave no frontend.

---

## 11.2 Google Drive

Responsável por arquivos.

O backend deverá controlar:

- criação;
- upload;
- associação;
- recuperação de referências.

---

## 11.3 Instagram

Primeira rede social.

Objetivos futuros:

- preparar;
- agendar;
- publicar;
- coletar métricas.

Toda publicação exige aprovação.

---

## 11.4 Facebook e TikTok

Não fazem parte da primeira integração.

A arquitetura de marketing deverá permitir adicioná-los posteriormente.

---

## 11.5 WhatsApp

Inicialmente:

- notificações desejadas;
- leitura de conversas não prioritária.

A integração deverá ser desacoplada.

---

## 11.6 Smart Life / JWCOM

Dispositivo atual:

**JWCOM SA-026N-G16**

Prova técnica necessária para verificar:

- potência;
- energia acumulada;
- consumo;
- histórico.

Caso não seja possível, o sistema continua usando custo estimado.

---

## 11.7 Bambu Studio / Bambu Lab

Entrada manual inicial:

- tempo;
- consumo de filamento.

Integração futura poderá incluir:

- status;
- término;
- falha;
- telemetria;
- comandos.

Comandos físicos exigem confirmação.

---

# 12. Segurança

Princípios:

1. Chaves e segredos somente em ambiente seguro.
2. Nunca colocar segredo em código versionado.
3. Utilizar `.env`.
4. Criar `.env.example` sem valores reais.
5. Aplicar Row Level Security quando apropriado.
6. Registrar operações críticas.
7. Validar entradas no backend.
8. Não confiar em validação apenas no frontend.
9. Toda função chamada pela Sky deverá ter schema de entrada.
10. Ações destrutivas deverão exigir confirmação.

---

# 13. Auditoria e histórico

Deverão ser auditáveis:

- mudança de preço;
- mudança de parâmetro;
- status de pedido;
- status financeiro;
- inventário;
- ajuste de estoque;
- perdas;
- produção;
- MDO;
- manutenção;
- publicação;
- aprovação.

---

# 14. Tratamento de erros

Erros deverão ser classificados como:

- validação;
- autorização;
- integração;
- banco;
- indisponibilidade externa;
- regra de negócio.

A interface deverá apresentar mensagens compreensíveis.

A Sky deverá evitar mensagens técnicas quando estiver falando com o usuário.

---

# 15. Logs

Manter logs técnicos para:

- Edge Functions;
- integrações;
- falhas;
- chamadas externas;
- erros;
- ações críticas.

Não armazenar segredos nos logs.

---

# 16. Estratégia de testes

## Unitários

Para:

- cálculos;
- regras;
- priorização;
- precificação;
- estoque;
- status.

## Integração

Para:

- banco;
- Edge Functions;
- Google Drive;
- OpenAI;
- demais integrações.

## End-to-end

Fluxos principais:

1. criar cliente;
2. criar pedido;
3. aprovar;
4. gerar produção;
5. colocar em fila;
6. concluir plate;
7. atualizar pedido;
8. atualizar estoque;
9. finalizar entrega;
10. registrar pagamento.

---

# 17. Ordem de implementação do MVP

A implementação é organizada por **Módulos Funcionais**, cada um dividido em **7 Fases
Técnicas** (Definição funcional, Modelo e regras, Backend, Frontend, Integração E2E, Piloto
real, Estabilização/release). Detalhamento completo de escopo em
`04_PLANO_IMPLEMENTACAO.md`; estado atual de progresso em `05_ROADMAP_MODULOS.md`.

## Módulo 0 — Fundação e Segurança

- Git;
- estrutura de pastas;
- README;
- Vite;
- Supabase;
- variáveis de ambiente;
- autenticação básica.

## Módulo 1 — Clientes, Produtos e Pedidos

- clientes;
- empresas;
- pedidos;
- itens;
- Personalizado;
- Spot;
- Catálogo;
- status;
- pagamento.

## Módulo 2 — Produção

- impressora;
- plates;
- itens de plate;
- fila;
- status;
- falhas;
- perdas.

## Módulo 3 — Estoque e Inventário

- filamentos;
- rolos;
- taras;
- acessórios;
- embalagens;
- movimentações;
- reservas;
- inventário.

## Módulo 4 — Precificação e Rentabilidade

- parâmetros;
- custos;
- MDO;
- margem;
- histórico;
- rentabilidade.

## Módulo 5 — Manutenção e Equipamentos

- manutenções realizadas;
- regras de manutenção preventiva;
- lubrificação de eixos X/Y/Z;
- próxima manutenção;
- alertas.

## Módulo 6 — Onboarding, Alertas e Gestão

- checklist;
- escala;
- pendências;
- revisões;
- alertas;
- resumo diário.

## Módulo 7 — Sky Assistente em Texto

- OpenAI;
- ferramentas;
- contexto;
- comandos;
- consultas;
- cadastros.

## Módulo 8 — Sky Assistente por Voz

- speech-to-text;
- text-to-speech;
- sessão contínua;
- prova técnica iOS.

## Módulo 9 — Divulgação e Marketing

- planejamento;
- calendário;
- conteúdo;
- aprovação;
- mídia;
- Instagram.

## Módulo 10 — Integrações Externas

- Smart Life;
- Bambu;
- WhatsApp;
- Facebook;
- TikTok.

---

# 18. Regra de desenvolvimento incremental

O Claude Code não deverá tentar implementar todo o projeto de uma única vez.

Para cada módulo:

1. revisar documentos (incluindo `05_ROADMAP_MODULOS.md`);
2. definir escopo da fase corrente;
3. implementar;
4. testar;
5. corrigir;
6. demonstrar resultado;
7. fazer commit;
8. atualizar `05_ROADMAP_MODULOS.md`;
9. somente então avançar.

Um módulo só recebe status **OPERACIONAL** quando puder ser usado normalmente pelo frontend,
sem depender de PowerShell ou chamadas manuais de API (ver `04_PLANO_IMPLEMENTACAO.md` §3.3).

---

# 19. Lovable

Lovable poderá ser usado para:

- protótipos;
- ideias de UI;
- geração inicial de telas;
- referência visual.

Não deverá ser considerado proprietário da arquitetura.

Qualquer código aproveitado deverá ser incorporado ao repositório oficial e revisado no VS Code.

---

# 20. PWA e iPhone

A primeira interface poderá ser entregue como aplicação web responsiva/PWA.

A necessidade de recursos nativos deverá ser avaliada separadamente.

Especialmente:

- ativação de voz;
- execução em segundo plano;
- notificações;
- botão de ação;
- integração com Siri/App Intents.

Não criar dependência nativa antes da prova técnica.

---

# 21. Performance

O MVP deverá priorizar simplicidade.

Evitar:

- microserviços desnecessários;
- filas complexas sem necessidade;
- cache prematuro;
- infraestrutura excessiva.

O projeto deverá começar como aplicação modular simples.

---

# 22. Portabilidade

A arquitetura deverá minimizar dependência irreversível de um fornecedor.

Regras de negócio devem permanecer no código do projeto.

O banco PostgreSQL facilita eventual migração futura.

---

# 23. Machine Learning

Machine learning próprio não será utilizado no MVP.

Primeiro serão coletados dados estruturados.

Futuramente poderá ser avaliado para:

- previsão de demanda;
- risco de atraso;
- previsão de consumo;
- recomendação de produtos;
- desempenho de marketing;
- previsão de rentabilidade.

---

# 24. Provas técnicas obrigatórias

Antes de depender de cada integração:

## iOS / Voz
Validar melhor mecanismo para acionar a Sky sem navegação manual.

## Smart Life
Validar telemetria da tomada JWCOM.

## Bambu
Validar dados e comandos disponíveis.

## Instagram
Validar publicação, agendamento e métricas.

## WhatsApp
Validar custos, limitações e recursos.

---

# 25. Critério técnico de aceite do MVP

O MVP deverá ser considerado tecnicamente utilizável quando for possível:

1. cadastrar cliente;
2. criar pedido;
3. criar item;
4. classificar como Personalizado, Spot ou Catálogo;
5. controlar status;
6. criar produção;
7. montar fila;
8. registrar plates;
9. controlar estoque;
10. fazer inventário;
11. calcular preço;
12. registrar pagamento;
13. registrar entrega;
14. consultar tudo por interface;
15. executar os principais comandos internos através da Sky;
16. receber alertas básicos;
17. manter histórico;
18. operar mesmo quando integrações externas estiverem indisponíveis.

---

# 26. Regra para o Claude Code

Antes de alterar arquitetura, banco ou regras de domínio, o Claude Code deverá:

1. ler `01_ESPECIFICACAO_FUNCIONAL.md`;
2. ler `02_ESPECIFICACAO_TECNICA.md`;
3. consultar documentos específicos adicionais;
4. apresentar impacto da mudança;
5. evitar decisões irreversíveis sem necessidade.

Em caso de conflito:

**Especificação Funcional aprovada → Regra de negócio**

**Especificação Técnica → implementação**

Se houver contradição entre os dois documentos, interromper a implementação daquela regra até revisão.

---

# 27. Próximos documentos

Após aprovação deste documento deverão ser criados:

## `03_MODELO_BANCO_DADOS.md`

Definirá:

- tabelas;
- campos;
- tipos;
- relacionamentos;
- chaves;
- enums;
- índices;
- históricos;
- regras de integridade.

## `04_PLANO_IMPLEMENTACAO.md`

Definirá:

- etapas;
- tarefas;
- critérios de aceite;
- sequência;
- testes;
- checkpoints;
- commits sugeridos.

---

# 28. Diretriz final

A arquitetura deve tornar simples a evolução do sistema sem obrigar reconstruções constantes.

O objetivo não é criar a solução tecnicamente mais sofisticada.

O objetivo é criar uma solução:

- confiável;
- compreensível;
- modular;
- testável;
- barata para iniciar;
- fácil de evoluir;
- adequada à operação real da Forma 3D Studio.

> **Primeiro fazer o núcleo funcionar. Depois integrar. Depois automatizar. Depois otimizar.**
