# Especificação Funcional Consolidada v0.4
## Forma 3D Studio + Assistente Virtual Sky

**Status:** Consolidada para aprovação final  
**Próxima etapa:** Especificação técnica para desenvolvimento no Claude Code

---

# 1. Visão do sistema

O sistema será a plataforma operacional da **Forma 3D Studio**, centralizando:

- clientes;
- pedidos;
- produtos;
- produção;
- estoque;
- inventário;
- precificação;
- rentabilidade;
- divulgação e marketing;
- arquivos;
- manutenção;
- alertas;
- parâmetros;
- integrações;
- Assistente Virtual Sky.

A **Sky** será a principal interface inteligente do sistema.

O usuário poderá utilizar tanto as telas tradicionais do aplicativo quanto conversar com a Sky por voz.

## Princípio central

> **Complexidade no sistema, simplicidade para o usuário.**

O usuário não deverá precisar conhecer a estrutura do banco, decorar campos ou compreender a lógica interna para operar a Forma.

---

# 2. Objetivos do MVP

O MVP deverá resolver prioritariamente:

1. organização dos pedidos;
2. organização da fila de produção;
3. definição da sequência de produção;
4. controle de estoque;
5. inventário;
6. apoio à precificação;
7. acompanhamento de custos e perdas;
8. organização da divulgação;
9. desenvolvimento progressivo do Catálogo;
10. interação natural através da Sky.

O MVP deverá priorizar **utilização real diária**, e não quantidade de funcionalidades.

---

# 3. Onboarding e simplicidade

Na primeira utilização, a Sky conduzirá uma **configuração inicial guiada**.

Os cadastros serão classificados como:

- **Essenciais:** necessários para determinada operação.
- **Importantes:** devem ser completados, mas não necessariamente bloqueiam o sistema.
- **Complementares:** podem ser preenchidos posteriormente.

O sistema exibirá um indicador de progresso da configuração.

As pendências serão classificadas como:

- Bloqueante;
- Importante;
- Informativa.

O sistema somente deverá bloquear uma operação quando o dado ausente for realmente necessário.

---

# 4. Armazenamento

## 4.1 Banco de dados

Arquitetura proposta: **PostgreSQL hospedado no Supabase**.

O banco armazenará dados estruturados como clientes, pedidos, produtos, produção, estoque, inventários, custos, preços, pagamentos, publicações, parâmetros, alertas e históricos.

Inicialmente deverá ser avaliado o plano gratuito do Supabase.

## 4.2 Google Drive

Será utilizado para arquivos como:

- 3MF;
- SVG;
- JPG;
- fotos;
- vídeos;
- documentos de aprovação;
- materiais de divulgação.

O banco guardará referências e metadados desses arquivos.

---

# 5. Clientes e origem

Cadastro básico:

- nome;
- WhatsApp;
- Instagram;
- empresa, quando aplicável;
- histórico;
- arquivos;
- observações.

A origem deverá possuir opções separadas:

- Indicação / boca a boca;
- WhatsApp;
- Instagram;
- Facebook;
- TikTok;
- Outros.

---

# 6. Tipos de pedido

Existirão três classificações:

- **Personalizado:** demanda com adaptação/desenvolvimento significativo.
- **Spot:** demanda pontual, normalmente baseada em modelo existente e com alterações menores.
- **Catálogo:** produto padronizado e previamente cadastrado.

Um mesmo pedido poderá possuir vários itens e diferentes tipos de item.

---

# 7. Status

## Pedido

**Orçamento → Ag. Aprovação → Aprovado → Em fila de produção → Em produção → Ag. Entrega → Entregue → Cancelado**

`Ag.` será a abreviação padrão para **Aguardando**.

## Pagamento

**Ag. Pagamento → Sinal recebido → Pago**

Status operacional e financeiro serão independentes.

Pedido encerrado: **Entregue + Pago**.

Cancelamento poderá ocorrer depois da aprovação desde que a produção ainda não tenha começado.

Não haverá política financeira automática de cancelamento.

---

# 8. Dados do pedido

Registrar:

- cliente;
- itens;
- quantidades;
- prazo;
- data real/final da entrega;
- valores;
- descontos;
- frete;
- meio de pagamento;
- status do pagamento;
- origem;
- observações.

Meios de pagamento:

- PIX;
- Dinheiro;
- Cartão.

O frete será registrado separadamente e não fará parte da formação do preço do produto.

Entrega:

- pessoalmente;
- Correios.

---

# 9. Personalizado

A Forma atualmente não realiza modelagem 3D do zero. Os projetos Personalizados utilizam modelos existentes que são adaptados.

## 9.1 Informações

Poderão incluir nome, texto, logo, tamanho, medidas, cores, quantidade de cores, acabamento, encaixe, acessórios e referências.

## 9.2 Versionamento

Formato: `v1.0`.

Primeiro número = alteração significativa.  
Segundo número = pequena correção.

## 9.3 Aprovação

Todo Personalizado terá aprovação formal por mensagem, foto ou documento visual.

Para o documento visual:

1. usuário abre o projeto;
2. insere a foto do modelo;
3. solicita geração;
4. sistema aplica automaticamente o template da Forma;
5. documento é gerado em formato de imagem;
6. imagem fica disponível para download.

O template deverá utilizar a identidade visual da Forma.

## 9.4 Protótipo

Poderá existir impressão teste principalmente para validação técnica.

## 9.5 Arquivos

Preservar 3MF, SVG, JPG, logos, referências e documentos.

## 9.6 Desenvolvimento

Registrar o tempo gasto para posterior análise de custo e rentabilidade.

---

# 10. Spot

Spot é uma demanda pontual fora do Catálogo, normalmente baseada em um modelo existente.

## 10.1 Origem do modelo

Registrar MakerWorld/Bambu Studio, outras plataformas, arquivo do cliente ou outras fontes.

Não haverá controle de licença comercial nesta versão.

## 10.2 Alterações permitidas

- tamanho;
- cor;
- quantidade de cores;
- texto;
- logo;
- adicionar parte;
- remover parte.

## 10.3 Conversão para Personalizado

Quando for necessário utilizar arquivos adicionais para formar o produto final, a Sky deverá sugerir reclassificação como Personalizado.

Necessidade de versionamento também deverá indicar possível Personalizado.

Spot não utilizará versões.

## 10.4 Aprovação

Aprovação simples obrigatória. Um “de acordo” será suficiente.

## 10.5 Impressão teste

Normalmente poderá existir impressão teste.

## 10.6 Pesquisa e preparação

Todo Spot deverá possuir registro de tempo de pesquisa/preparação.

Estados: **Não informado → Em andamento → Registrado**.

A Sky poderá iniciar e encerrar o apontamento por comandos naturais. Caso o tempo não seja informado antes da entrada na fila, deverá perguntar. Em urgências, poderá seguir como **MDO pendente**, mantendo alerta até regularização.

## 10.7 Precificação

Considerar:

**Material + Máquina + MDO + Personalização + Componentes + Embalagem**

Depois: margem, pesquisa de mercado e decisão do preço comercial.

## 10.8 Reutilização

Em nova solicitação semelhante, recuperar arquivos, configurações, custos, preço e histórico.

## 10.9 Conversão para Catálogo

Após inicialmente **3 pedidos**, a Sky deverá sugerir avaliação para Catálogo.

Parâmetro revisado trimestralmente.

## 10.10 Nome

Padrão sugerido: `ITEM_CLIENTE_FINALIDADE`.

---

# 11. Catálogo

Produtos de Catálogo terão cadastro permanente, preço, arquivo, consumo, tempo de produção e parâmetros conhecidos.

## 11.1 Personalizações permitidas

Nome, texto, logo, troca de cor, combinação de cores e eventualmente tamanho.

## 11.2 Personalizações diferentes no mesmo lote

Caso diferentes unidades necessitem personalizações distintas, tratar como Spot.

## 11.3 Aprovação

Não será obrigatória.

## 11.4 Taxa de personalização

Será calculada inicialmente utilizando **R$ 5,90/h**, registrando o tempo efetivamente utilizado.

## 11.5 Histórico

A Sky poderá reconhecer personalizações anteriormente feitas para um cliente e oferecer reutilização.

---

# 12. Produção e Plates

Equipamento inicial: **1 Bambu Lab A1**.

Um pedido poderá gerar vários plates e um plate poderá possuir itens de pedidos diferentes.

## 12.1 Status

**Em fila → Imprimindo → Concluída → Falhou → Cancelada**

## 12.2 Execução

Registrar início, término, tempo, quantidade prevista, quantidade produzida, perdas, filamento desperdiçado, tempo perdido e motivo da falha.

## 12.3 Falhas

Reimpressões decorrentes de falha deverão retornar automaticamente ao topo da fila.

---

# 13. Priorização da produção

Prioridades:

1. prazo;
2. tempo de impressão;
3. quantidade;
4. urgência.

A Sky deverá explicar resumidamente a decisão. O usuário poderá alterar a prioridade.

---

# 14. Escala 6x2

Ciclo: **23h–07h → 07h–15h → 15h–23h → repetição**.

O sistema utilizará as referências fornecidas de agosto de 2026 para projetar automaticamente a escala.

A programação deverá buscar aproveitar períodos de trabalho, sono, academia e outras indisponibilidades.

---

# 15. Estoque

Categorias:

- Filamentos;
- Acessórios;
- Embalagens.

---

# 16. Filamentos

Controle por rolo e peso.

Materiais:

- PLA;
- PETG;
- TPU.

Linhas:

- Cor sólida;
- Silk;
- Velvet;
- Translúcido;
- DuoColor.

Registrar material, fabricante, linha, cor comercial, peso, custo, fornecedor e entrada.

Estoque mínimo inicial:

- Preto e branco: **500 g**;
- Demais cores: **300 g**.

**Regras operacionais do MVP — versão inicial para validação, sujeitas a revisão após o
teste prático do usuário.** Aprovadas em 2026-08-27, contexto para a continuação do
Módulo 3 — implementação de filamentos ainda **não** iniciada (nenhum código,
Incremento 1 cobriu só Acessórios/Embalagens), ver `05_ROADMAP_MODULOS.md` §9b:

- Um **tipo de filamento** é definido pela combinação **material + fabricante + linha +
  cor** — não existe "tipo" sem essas quatro dimensões.
- Podem existir **vários rolos físicos do mesmo tipo** (mesmo material/fabricante/
  linha/cor), controlados individualmente.
- **Peso nominal do rolo é livre** (não há um valor fixo obrigatório) — 1.000 g pode ser
  sugerido como valor inicial pela interface, mas o operador pode informar qualquer
  outro peso. Corrige uma suposição anterior desta rodada de que "rolos normalmente com
  1 kg" seria uma regra fixa de schema — não é; é só uma sugestão de preenchimento.
- A ficha do produto deverá **futuramente** aceitar **múltiplos filamentos/cores**, cada
  um com seu próprio peso — não um único peso agregado por produto (ver
  `03_MODELO_BANCO_DADOS.md` §9.1, nota sobre `default_weight_grams`).

---

# 17. Tara de carretéis

Cadastro:

- fabricante;
- peso vazio em gramas.

**Peso líquido = peso medido − tara**.

Caso a tara não esteja cadastrada, a Sky deverá solicitar o dado ou gerar pendência.

---

# 18. Acessórios

Controle por unidade, permitindo variantes.

Exemplos: ímã, NFC, chaveiro, cola e LED.

**Unidade de controle (regra operacional do MVP, aprovada em 2026-08-27 — ver
disclaimer completo em §20):** acessórios são controlados em **unidades inteiras** —
nenhuma fração é aceita em nenhuma movimentação de estoque. Já implementada no
Incremento 1 (`register_stock_movement()` rejeita quantidade fracionada) — código
revisado, ainda não executado contra um banco real (ver `05_ROADMAP_MODULOS.md` §9b).

---

# 19. Embalagens

Exemplos iniciais: plástico PP, plástico M, caixa M, Ziplock PP e sacola Kraft.

Permitir item, material, tamanho e variante.

**Unidade de controle (regra operacional do MVP, aprovada em 2026-08-27 — ver
disclaimer completo em §20):** mesma regra de Acessórios — controle em **unidades
inteiras**, sem fração.

---

# 20. Movimentações

Preservar histórico de compra, consumo, reserva, perda, ajuste e correção.

Filamento deverá ser reservado quando a produção entrar **Em fila de produção**.

**Regras operacionais do MVP — versão inicial para validação, sujeitas a revisão após o
teste prático do usuário.** Aprovadas em 2026-08-27 (Módulo 3, continuação). Esta
aprovação **autoriza construir o MVP** com as regras abaixo — **não as torna
definitivas**: tipos de movimentação, momento de reserva/consumo, cancelamento,
pesagem, escolha de rolo e tratamento de perdas continuam sujeitos a revisão prática
depois que o usuário operar o sistema de verdade. **Nenhuma regra desta lista deve ser
lida como validada** — só como o ponto de partida aprovado para implementação.
Correções futuras, quando necessárias, serão feitas por **novas movimentações e
migrations** — o ledger e o histórico já gravados **nunca são reescritos**. O Incremento
1 (único implementado até agora, ver `05_ROADMAP_MODULOS.md` §9b) cobre **somente o
núcleo seguro de saldo e movimentações manuais** de Acessórios/Embalagens; reserva,
consumo, cancelamento, pesagem, escolha de rolo e perdas por reimpressão descritos
abaixo **ainda não têm nenhuma linha de código** — são só a intenção aprovada. O Módulo
3 só avança para validação operacional real quando existir **interface utilizável**
(Incremento 2 em diante) — não antes. Ver `03_MODELO_BANCO_DADOS.md` §15.1 e
`05_ROADMAP_MODULOS.md` para o estado técnico atual:

- **Estoque inicial**: registrado pela interface como movimentação "Saldo inicial",
  preservando histórico (nunca um `UPDATE` direto de saldo).
- **Entradas permitidas**: Saldo inicial, Compra, Devolução, Ajuste positivo.
- **Saídas manuais permitidas**: Perda/Avaria, Amostra/Doação, Uso interno, Ajuste
  negativo.
- **Saldo negativo é proibido** — toda saída que excederia o saldo físico disponível é
  bloqueada.
- **Reserva**: ocorrerá quando o pedido entrar na **Fila de produção** (ainda não
  implementado — ver gatilho pendente em `05_ROADMAP_MODULOS.md` §6).
- **Consumo de acessórios**: ao **iniciar a produção** (ainda não implementado).
- **Consumo de filamento**: pelo **peso teórico**, ao **iniciar a produção** (ainda não
  implementado — depende do cadastro de filamentos, fora do escopo desta rodada).
- **Consumo de embalagens**: quando o pedido passar para **Aguardando entrega** (ainda
  não implementado).
- **Cancelamento antes do consumo**: libera a reserva automaticamente (ainda não
  implementado).
- **Cancelamento depois do consumo**: **não** devolve estoque automaticamente — eventual
  devolução é sempre manual (decisão deliberada, evita estorno automático incorreto).
- **Falha/reimpressão**: perda e consumo adicional são lançados **manualmente** até
  existir o Módulo de Produção — nenhuma automação é assumida antes disso.
- **Escolha de rolo de filamento** (quando implementado): primeiro o rolo já aberto;
  depois o mais antigo. O consumo pode ser dividido entre vários rolos do mesmo tipo.
- **Pesagem** (quando implementada): registra o peso físico e gera um ajuste pela
  diferença — nunca substitui o saldo silenciosamente.
- **Perdas exigem motivo** em todos os casos, sem exceção.
- **Movimentações automáticas** (reserva/consumo, ainda não implementadas) terão
  proteção contra duplicidade por pedido, item e evento — nenhuma pode ser registrada
  duas vezes para o mesmo evento.

---

# 21. Inventário

Periodicidade: **mensal**.

Inclui pesagem dos filamentos e conferência de acessórios e embalagens.

Cada inventário deverá preservar seu histórico.

---

# 22. Precificação

**Material + Máquina + MDO + Personalização + Componentes + Embalagem**

Frete permanece separado.

---

# 23. Material

Utilizar o peso total informado pelo Bambu Studio, incluindo os consumos considerados pelo slicer.

---

# 24. Perdas

Manter margem histórica. O usuário poderá utilizar, ignorar ou substituir manualmente.

Revisão inicialmente mensal.

---

# 25. Custos de máquina

## Energia
Inicial: **R$ 0,12/h**.

## Depreciação
**R$ 0,25/h**, considerando R$ 5.000 e 20.000 horas.

## Manutenção
Inicialmente: **R$ 0,00/h**, refinado com histórico real.

---

# 26. MDO

Inicial: **R$ 5,90/h**.

Revisão: **trimestral**.

O valor vigente em cada cálculo deverá ser preservado historicamente.

---

# 27. Margem comercial

Referência: **40% a 80%**.

Decisão final sempre do usuário.

---

# 28. Arredondamento

Incrementos de **R$ 0,50**.

Exemplo: R$ 47,36 → R$ 47,50.

---

# 29. Preços de Catálogo

Redução de custo: manter preço e informar aumento da margem.

Aumento de custo: alertar redução da margem e perguntar sobre revisão.

Nunca alterar automaticamente sem decisão do usuário.

---

# 30. Rentabilidade

Comparar custo previsto, custo real, receita, lucro e margem real.

---

# 31. Divulgação e Marketing

A Sky deverá atuar como assistente de marketing, considerando que o usuário não possui domínio de redes sociais.

---

# 32. Canais

Inicial: **Instagram**.

Futuros: Facebook e TikTok.

Os três serão tratados também como potenciais canais de venda.

---

# 33. Frequência

Inicial: **2 publicações por semana**.

Revisão trimestral.

---

# 34. Estratégia comercial de conteúdo

A estratégia deverá refletir o estágio atual da Forma. Spot e Personalizados possuem maior importância no momento.

A Sky também deverá ajudar ativamente a Forma a **construir uma linha própria de Catálogo**.

Deverá identificar candidatos considerando Spots recorrentes, Personalizados repetíveis, margem, facilidade de produção, interesse nas redes, demanda e potencial de personalização.

Meta inicial configurável:

**avaliar/desenvolver 1 candidato a produto de Catálogo por mês**.

O resultado poderá ser aprovado para Catálogo, necessitar ajustes ou ser rejeitado.

---

# 35. Tipos de conteúdo

- Produto;
- Bastidores;
- Personalização;
- Projetos realizados.

---

# 36. Explicação didática

Cada planejamento deverá explicar:

- O que vamos fazer?
- Por que vamos fazer?
- Qual resultado buscamos?

---

# 37. Conteúdo gerado pela Sky

Preparar produto, objetivo, formato, roteiro, fotos/vídeos, textos, legenda, chamada, hashtags, data, horário e justificativa.

---

# 38. Publicação

**Planejamento → Aprovação → Publicação**

Nenhuma publicação poderá ocorrer sem aprovação explícita.

---

# 39. Biblioteca de mídia

Associar fotos e vídeos a produtos, pedidos e publicações.

---

# 40. Recorrência de divulgação

Produto de Catálogo candidato a nova divulgação após inicialmente **30 dias**.

Revisão trimestral.

---

# 41. Calendário de Marketing e Oportunidades

Datas comerciais principais deverão ser cadastradas automaticamente.

Permitir eventos manuais, como aniversário da cidade, feriados locais/religiosos, eventos escolares, feiras, eventos empresariais e especialmente eventos esportivos.

Antecedência inicial: **45 dias**.

---

# 42. Análise das publicações

- Após **24 horas**: análise resumida e didática;
- Semanal: comparação das publicações;
- Mensal: análise consolidada e recomendações.

---

# 43. Origem das vendas

Relacionar pedidos, quando possível, com publicação, campanha, rede social, indicação e outros canais.

---

# 44. Integrações prioritárias

1. Instagram;
2. voz;
3. tomada inteligente;
4. Bambu Studio/Bambu Lab;
5. WhatsApp.

Google Drive será estrutural.

---

# 45. Redes sociais

Instagram primeiro. Posteriormente Facebook e TikTok.

As três poderão funcionar como divulgação, canal de venda, origem de cliente e origem de pedido.

---

# 46. WhatsApp

Leitura automática não será prioridade imediata.

Notificações pelo WhatsApp são desejadas.

---

# 47. Google Drive

Repositório dos arquivos. A operação normal não deverá exigir navegação manual frequente pelo Drive.

---

# 48. Bambu

Inicialmente aceitar tempo e peso manualmente.

Evolução desejada: status, término, falha, produção, dados automáticos e comandos.

Comandos físicos exigirão confirmação.

---

# 49. Tomada inteligente

Atual: **JWCOM SA-026N-G16 / Smart Life**.

Realizar prova técnica para potência, energia, consumo e histórico.

Objetivo: calcular consumo real por plate.

---

# 50. Agenda

A escala será conhecida automaticamente.

Integração futura com agenda poderá melhorar o planejamento.

---

# 51. Notificações

- Push;
- WhatsApp.

---

# 52. Sky

Personalidade:

- feminina;
- amigável;
- objetiva;
- parceira;
- didática;
- paciente;
- bem-humorada moderada.

Utilizar naturalmente: **nós / nosso / precisamos / vamos**.

---

# 53. Comunicação

Respostas curtas por padrão.

Detalhamento quando solicitado.

Prioridade: **precisão**.

Na dúvida: **perguntar, não adivinhar**.

---

# 54. Ativação

Desejada: **“Sky”** ou **“Hey Sky”**.

Objetivo: iniciar interação sem navegar manualmente pelo celular.

Solução definitiva dependerá da prova técnica no iOS.

---

# 55. Conversa contínua

Após ativação: **3 minutos**, configurável.

---

# 56. Entrada natural

A Sky deverá receber informações livres, interpretá-las e perguntar apenas o que ficou faltando.

---

# 57. Correções contextuais

Comandos como “Muda o prazo para sexta” deverão alterar corretamente o contexto atual.

---

# 58. Memória

Manter contexto da conversa e recuperar informações persistentes do sistema entre sessões.

---

# 59. Resumo diário

Apresentar:

- Metas do dia;
- Entregas realizadas no dia;
- Pendências relevantes.

---

# 60. Proatividade

Alertar sobre prazo, atraso, estoque, manutenção, divulgação, pagamento, inventário, parâmetros, MDO e cadastros incompletos.

Alertas importantes permanecem até confirmação de que foram vistos.

---

# 61. Segurança

Sem confirmação adicional: consultas, cadastros simples e operações internas reversíveis.

Com confirmação: exclusões, publicações, ações externas relevantes, comandos físicos e operações irreversíveis.

---

# 62. Modo discreto

Configurável futuramente.

---

# 63. Revisões periódicas

## Mensais

- inventário;
- pesagem dos filamentos;
- margem histórica de perdas;
- análise consolidada de marketing.

## Trimestrais

- MDO;
- conversão Spot → Catálogo;
- estoque mínimo;
- manutenção/hora;
- energia estimada;
- margem comercial;
- frequência de publicação;
- regra dos 30 dias de divulgação.

## Anuais/eventuais

- depreciação;
- vida útil;
- investimento de referência;
- escala, quando alterada.

---

# 64. Configurações e parâmetros

Mostrar valor atual, unidade, última revisão, próxima revisão, histórico, responsável e motivo da alteração.

---

# 65. Manutenção

Permitir cadastrar manutenções realizadas.

Registrar impressora, data, manutenção, componente, observação, horas de uso quando disponíveis e próxima manutenção.

Itens específicos:

- Lubrificação eixo X;
- Lubrificação eixo Y;
- Lubrificação eixo Z.

A Sky deverá gerar lembretes preventivos.

---

# 66. Modelo conceitual de dados

Entidades preliminares:

Clientes, Empresas, Pedidos, Itens, Produtos, Personalizados, Spots, Produções, Plates, Impressoras, Filamentos, Rolos, Taras, Acessórios, Embalagens, Movimentações, Reservas, Inventários, Perdas, Custos, Preços, MDO, Pagamentos, Arquivos, Publicações, Mídias, Métricas, Eventos, Alertas, Notificações, Parâmetros, Manutenções e Escala.

A especificação técnica definirá a normalização correta.

---

# 67. Histórico

Preservar sempre que relevante preços, custos, MDO, inventários, estoque, parâmetros, status, produção, perdas e marketing.

---

# 68. Escopo do MVP

Priorizar onboarding, clientes, pedidos, Personalizado, Spot, Catálogo, produção, plates, fila, estoque, inventário, precificação, parâmetros, alertas, Sky, Google Drive e divulgação.

Integrações deverão possuir alternativas manuais sempre que possível.

---

# 69. Provas técnicas

- iPhone: validar ativação da Sky por voz;
- Smart Life: validar telemetria da tomada;
- Bambu A1: validar dados e comandos;
- Instagram: validar publicação, agendamento e métricas;
- WhatsApp: avaliar integração, limitações e custos.

---

# 70. Pontos a evoluir

Ainda serão refinados manutenção/hora, estoque mínimo ideal, estratégia de marketing baseada em dados, horários de postagem, descontos, integração bancária, tabela de manutenção, integração Bambu, ativação de voz, tomada e métricas sociais.

Machine learning próprio **não faz parte do MVP**. A arquitetura deverá permitir evolução futura para modelos preditivos quando houver histórico de dados suficiente.

---

# 71. Autonomia

Princípio da Sky:

**Observar → Analisar → Recomendar → Explicar → Executar quando autorizado**

---

# 72. Objetivo comercial

O sistema deverá ajudar a Forma a conquistar clientes, construir Catálogo, entender rentabilidade, aumentar produtividade, reduzir perdas, organizar produção, gerar recorrência, melhorar divulgação e aprender com os próprios dados.

---

# 73. Experiência desejada

O usuário não deverá sentir que está administrando um ERP.

Exemplos:

> “Sky, o que produzimos agora?”

> “Sky, registra esse pedido.”

> “Sky, temos filamento suficiente?”

> “Sky, quanto devemos cobrar?”

> “Sky, o que vamos postar esta semana?”

> “Sky, o que está pendente hoje?”

> **A complexidade pertence ao sistema. A interação deve permanecer simples.**

---

# 74. Validação do MVP

## Fase 1 — Teste técnico

Validar cadastros, gravação, cálculos, status, relacionamentos, fluxos e erros bloqueantes.

## Fase 2 — Uso real

Utilizar com pedidos reais por aproximadamente **2 semanas**.

## Fase 3 — Primeira revisão funcional

Classificar achados como:

- Corrigir imediatamente;
- Melhorar;
- Futuro.

## Fase 4 — Revisão de 30 dias

Avaliar dados reais de pedidos, produção, perdas, estoque, rentabilidade, Sky, alertas, divulgação e utilização das funcionalidades.

## Ciclo

**Especificação → Desenvolvimento → Teste técnico → 2 semanas de uso → Revisão → Ajustes → 30 dias de uso → Nova revisão**

Somente depois disso deverá ocorrer expansão significativa de escopo.
