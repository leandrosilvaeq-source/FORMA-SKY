# Modelo de Banco de Dados v0.1
## Forma 3D Studio + Assistente Virtual Sky

**Status:** Modelo conceitual inicial para implementação  
**Documentos de referência:**  
- `01_ESPECIFICACAO_FUNCIONAL.md`  
- `02_ESPECIFICACAO_TECNICA.md`

---

# 1. Objetivo

Este documento descreve a estrutura conceitual do banco de dados da Forma 3D Studio.

O objetivo é organizar as informações do sistema de maneira que:

- pedidos possam conter itens de tipos diferentes;
- produção seja separada de pedido;
- um plate possa conter itens de pedidos diferentes;
- estoque preserve histórico;
- custos e parâmetros sejam auditáveis;
- a Sky consulte dados confiáveis;
- o sistema aceite várias impressoras físicas;
- novas integrações possam ser adicionadas sem reconstruir o banco.

O banco será implementado em **PostgreSQL via Supabase**.

---

# 2. Princípios de modelagem

1. O banco é a fonte oficial da verdade.
2. Dados históricos importantes não devem ser simplesmente sobrescritos.
3. Cada entidade deve ter identificador único.
4. Campos de data/hora devem usar padrão consistente.
5. Exclusões relevantes devem preferir inativação quando o histórico precisar ser preservado.
6. Relacionamentos devem usar chaves estrangeiras.
7. Campos configuráveis não devem ficar presos no código.
8. Arquivos pesados ficam no Google Drive; o banco armazena referências.
9. A Sky não acessa SQL diretamente.
10. O modelo deve suportar múltiplas impressoras físicas, inclusive do mesmo modelo.

---

# 3. Convenções sugeridas

Nomes de tabelas e campos em inglês para facilitar desenvolvimento.

Exemplos:

- `customers`
- `orders`
- `order_items`
- `printers`
- `filament_spools`

Chave primária padrão:

`id`

Campos de auditoria recomendados:

- `created_at`
- `updated_at`
- `created_by`
- `updated_by`

Quando necessário:

- `is_active`
- `deleted_at`

---

# 4. Grupo: Usuários e acesso

## 4.1 `users`

Representa usuários autorizados do sistema.

### Campos principais

- `id`
- `auth_user_id`
- `name`
- `email`
- `role`
- `is_active`
- `created_at`
- `updated_at`

### Observações

Inicialmente haverá um único operador principal, mas o sistema deverá aceitar múltiplos usuários no futuro.

---

# 5. Grupo: Clientes e empresas

## 5.1 `customers`

Representa clientes pessoa física ou contatos principais.

### Campos

- `id`
- `name`
- `whatsapp`
- `instagram`
- `company_id`
- `notes`
- `is_active`
- `created_at`
- `updated_at`

### Relacionamentos

- pode pertencer a uma empresa;
- pode possuir vários pedidos;
- pode possuir arquivos associados.

---

## 5.2 `companies`

Representa empresas clientes.

### Campos

- `id`
- `name`
- `trade_name`
- `document_number` opcional
- `whatsapp` opcional
- `instagram` opcional
- `notes`
- `is_active`
- `created_at`
- `updated_at`

---

## 5.3 `lead_sources`

Cadastro das origens de clientes/pedidos.

### Valores iniciais

- Indicação / boca a boca
- WhatsApp
- Instagram
- Facebook
- TikTok
- Outros

### Campos

- `id`
- `name`
- `is_active`

---

# 6. Grupo: Pedidos

## 6.1 `orders`

Representa o pedido como um todo.

### Campos principais

- `id`
- `order_number`
- `customer_id`
- `company_id` opcional
- `lead_source_id`
- `order_status`
- `payment_status`
- `payment_method`
- `order_date`
- `approval_date`
- `expected_delivery_date`
- `actual_delivery_date`
- `delivery_method`
- `shipping_cost`
- `discount_value`
- `subtotal`
- `total_value`
- `notes`
- `created_at`
- `updated_at`

### Formato de `order_number`

`FS-XX-YYY`, gerado atomicamente por `next_order_number()`:

- `FS` — prefixo fixo;
- `XX` — dois últimos dígitos do ano (fuso `America/Sao_Paulo`);
- `YYY` — sequência anual, com no mínimo três dígitos e reinício em `001` a cada novo ano; sem teto artificial — acima de `999` a sequência continua por extenso (`1000`, `1001`, ...), nunca truncada;
- exemplo: `FS-26-001`, `FS-26-999`, `FS-26-1000`.

### Status do pedido

- `QUOTE`
- `WAITING_APPROVAL`
- `APPROVED`
- `IN_PRODUCTION_QUEUE`
- `IN_PRODUCTION`
- `WAITING_DELIVERY`
- `DELIVERED`
- `CANCELLED`

Na interface:

- Orçamento
- Ag. Aprovação
- Aprovado
- Em fila de produção
- Em produção
- Ag. Entrega
- Entregue
- Cancelado

### Status de pagamento

- `WAITING_PAYMENT`
- `DEPOSIT_RECEIVED`
- `PAID`

Na interface:

- Ag. Pagamento
- Sinal recebido
- Pago

### Meio de pagamento

- PIX
- Dinheiro
- Cartão

---

## 6.2 `order_items`

Representa cada item dentro de um pedido.

### Campos

- `id`
- `order_id`
- `item_type`
- `product_id` opcional
- `item_name`
- `description`
- `quantity`
- `unit_price`
- `personalization_fee`
- `discount_value`
- `total_price`
- `material_id` opcional
- `color_description`
- `number_of_colors`
- `expected_delivery_date` opcional
- `notes`
- `created_at`
- `updated_at`

### Tipos

- `CUSTOM`
- `SPOT`
- `CATALOG`

Na interface:

- Personalizado
- Spot
- Catálogo

---

# 7. Grupo: Personalizados

## 7.1 `custom_item_details`

Detalhes exclusivos de item Personalizado.

### Campos

- `id`
- `order_item_id`
- `current_version`
- `approval_status`
- `approval_date`
- `is_exclusive`
- `prototype_required`
- `prototype_completed`
- `development_minutes`
- `notes`
- `created_at`
- `updated_at`

---

## 7.2 `custom_versions`

Histórico das versões.

### Campos

- `id`
- `order_item_id`
- `version_number`
- `change_type`
- `change_description`
- `file_id`
- `created_at`

### Exemplo

- v1.0
- v1.1
- v2.0

---

## 7.3 `approvals`

Registro de aprovações.

### Campos

- `id`
- `order_item_id`
- `approval_type`
- `approved_at`
- `approval_evidence_file_id` opcional
- `notes`

### Tipos possíveis

- WhatsApp
- Foto
- Documento formal
- Outro

---

# 8. Grupo: Spot

## 8.1 `spot_item_details`

Detalhes exclusivos do Spot.

### Campos

- `id`
- `order_item_id`
- `model_source_id`
- `source_reference`
- `is_exclusive`
- `test_print_required`
- `test_print_completed`
- `search_time_status`
- `search_minutes`
- `preparation_minutes`
- `market_reference_price`
- `market_reference_source`
- `market_reference_date`
- `catalog_conversion_suggested`
- `notes`
- `created_at`
- `updated_at`

### Status de tempo

- `NOT_INFORMED`
- `IN_PROGRESS`
- `RECORDED`

---

## 8.2 `model_sources`

Origem dos modelos.

### Campos

- `id`
- `name`
- `is_active`

### Valores iniciais

- MakerWorld / Bambu Studio
- Arquivo do cliente
- Outra plataforma
- Outra fonte

---

# 9. Grupo: Catálogo

## 9.1 `products`

Produtos permanentes do Catálogo.

### Campos

- `id`
- `name`
- `product_type` (`text`, `NOT NULL DEFAULT 'CATALOG'`) — classificação do produto no Catálogo: `CATALOG`, `CUSTOM` (Personalizado) ou `SPOT` — mesmos 3 valores técnicos de `order_items.item_type`, reutilizados de propósito (migration `20260821090000_add_product_type.sql`, ainda não aplicada). Todo produto existente antes desta migration foi classificado como `CATALOG` automaticamente (o `DEFAULT` é aplicado retroativamente pelo `ADD COLUMN`). **Só `CATALOG` está habilitado nos fluxos de criação de pedido (`create_order`/`update_quote_order`) por enquanto** — esta coluna classifica o produto no Catálogo, mas não habilita nenhum fluxo novo de pedido para `CUSTOM`/`SPOT`.
- `category` — texto livre. A interface oferece uma seleção pré-definida (Chaveiro, Suporte, Brinquedo Sensorial, Decoração, Pet, Gamer, Geek, Beauty, Office) mais "Outro" (texto livre); o valor gravado é sempre o texto exato (da opção selecionada ou digitado em "Outro") — nunca um código separado do valor exibido. Categorias gravadas antes desta mudança que não batem com nenhuma opção pré-definida (incluindo "Beauty Office", opção antiga substituída por "Beauty"/"Office" separados) continuam válidas e abrem como "Outro" ao editar, com o texto preenchido — nunca convertidas ou apagadas automaticamente.
- `description`
- `default_price`
- `default_material_id`
- `default_print_time_seconds` (`integer`) — tempo total de impressão do produto, armazenado em **segundos** (renomeada de `default_print_time_minutes`, que armazenava minutos e não suportava precisão de segundos; migration `20260821070000_rename_default_print_time_to_seconds.sql`, ainda não aplicada). `NULL` = não informado. A interface sempre exibe/aceita o valor formatado como `HH:MM:SS` (ver `frontend/src/lib/forms/durationField.ts`); a coluna nunca é representada via `Date`/duração de calendário.
- `default_weight_grams`
- `units_per_plate` — **campo legado**: preservado no banco (não sofre `DROP` nesta migration), mas sem uso na interface atual — removido do formulário "Novo produto" e da Ficha Técnica do Produto (decisão aprovada). `create_product()` sempre recebe `null` para este parâmetro a partir da Edge Function.
- `default_file_id`
- `allows_personalization` — **não confundir com `product_type = 'CUSTOM'`**: são regras distintas e documentadas separadamente (docs/01_ESPECIFICACAO_FUNCIONAL.md §11.1/§11.2/§11.4). `allows_personalization` marca um produto de **Catálogo** que aceita personalizações leves (nome, texto, logo, troca de cor — cobradas via taxa de personalização, R$5,90/h, em `order_items.personalization_fee`), permanecendo `product_type = 'CATALOG'`. Já `product_type = 'CUSTOM'` classifica o próprio produto como inteiramente Personalizado (sob encomenda). Um produto pode ter `product_type = 'CATALOG'` e `allows_personalization = true` ao mesmo tempo — não são mutuamente exclusivos nem se substituem.
- `is_active`
- `created_at`
- `updated_at`

### Observações

O preço não deve ser recalculado automaticamente a cada pedido.

Custos devem ser monitorados separadamente.

#### SPOT reutilizável — regra confirmada, sem campo adicional

O modelo já distingue um SPOT reutilizável de um SPOT exclusivo de um pedido, sem nenhuma coluna
extra (`is_reusable` **não existe e não é necessária**):

- **Produto registrado em `public.products`** (qualquer `product_type`, incluindo `SPOT`) **=
  produto reutilizável** — tem cadastro permanente, aparece na listagem de Produtos e pode ser
  referenciado por `order_items.product_id` em pedidos futuros.
- **SPOT exclusivo de um pedido** = uma linha em `order_items` com `item_type = 'SPOT'` e
  `product_id IS NULL` (constraint `order_items_product_id_matches_item_type`, migration
  `20260814005328_create_order_items_table.sql`) — existe só naquele pedido, nunca tem
  contrapartida em `products`, e por isso nunca aparece na listagem de Produtos.

Não há necessidade atual de um campo adicional para marcar "reutilizável": a própria existência
(ou ausência) da linha em `products` já é o sinal.

`default_packaging_id` (1 embalagem, sem quantidade), citado em versões anteriores deste
documento, **nunca foi criado** em nenhuma migration e foi superado por `product_packaging`
(§9.3) — composição padrão permite N embalagens, cada uma com quantidade, o que cobre e amplia o
caso de uso original.

---

## 9.2 `product_price_history`

Histórico de preços de Catálogo.

### Campos

- `id`
- `product_id`
- `price`
- `effective_from`
- `effective_to`
- `reason`
- `created_at`

---

## 9.3 `product_accessories` e `product_packaging` — composição padrão

Implementado em `supabase/migrations/20260816150000_create_accessories_packaging_and_composition_tables.sql`
e `20260816150500_create_product_composition_function.sql` (Bloco 1, Migrations 18–19).

Registra a **composição padrão** de um produto de Catálogo: quais acessórios e embalagens
acompanham o produto, e em que quantidade (ex.: 2 ímãs, 4 parafusos, 1 caixa, 1 saco plástico).
Estrutura nova — sem equivalente em versão anterior deste documento; substitui e amplia o antigo
`products.default_packaging_id` (§9.1).

### `product_accessories` — Campos

- `id`
- `product_id`
- `accessory_id`
- `quantity` — inteiro, sempre > 0
- `created_at`

`unique(product_id, accessory_id)`: no máximo 1 linha por combinação produto+acessório —
quantidade maior é a mesma linha com um número maior, nunca duas linhas.

### `product_packaging` — Campos

Mesma forma de `product_accessories`, trocando `accessory_id` por `packaging_id`.

### Escrita

Só através da função `set_product_composition(product_id, accessories, packaging, changed_by)` —
substitui **atomicamente** o conjunto inteiro da composição (apaga as linhas atuais das duas
tabelas e insere o novo conjunto na mesma transação). Não existe edição incremental linha a
linha; salvar a composição sempre envia a lista completa desejada.

### Relação com estoque (Módulo 3)

`product_accessories`/`product_packaging` são puramente definicionais — "o que acompanha esse
produto por padrão" — e **nunca** um ledger de estoque. Quando o Módulo 3 implementar
reserva/consumo, ele vai **ler** esta composição como template para gerar `stock_movements`
(multiplicando quantidade da composição × quantidade do pedido), sem duplicar o cadastro.
Nenhuma automação de estoque é implementada nesta etapa (ver §13).

---

# 10. Grupo: Impressoras

## 10.1 `printers`

Representa cada impressora física individual.

Duas máquinas iguais devem possuir dois registros distintos.

### Campos

- `id`
- `name`
- `manufacturer`
- `model`
- `serial_number` opcional
- `purchase_date` opcional
- `purchase_value` opcional
- `status`
- `total_usage_hours`
- `external_identifier` opcional
- `last_maintenance_date` opcional
- `notes`
- `is_active`
- `created_at`
- `updated_at`

### Status sugeridos

- `AVAILABLE`
- `PRINTING`
- `MAINTENANCE`
- `UNAVAILABLE`
- `INACTIVE`

### Exemplo

Impressora 1:
- Nome: A1 Principal
- Fabricante: Bambu Lab
- Modelo: A1

Impressora 2:
- Nome: A1 02
- Fabricante: Bambu Lab
- Modelo: A1

---

# 11. Grupo: Produção

## 11.1 `production_orders`

Representa a necessidade de produção associada a um item.

### Campos

- `id`
- `order_item_id`
- `printer_id` opcional
- `required_quantity`
- `completed_quantity`
- `pending_quantity`
- `material_id`
- `color_description`
- `priority_override`
- `production_status`
- `expected_total_minutes`
- `created_at`
- `updated_at`

---

## 11.2 `plates`

Representa cada plate físico.

### Campos

- `id`
- `plate_number`
- `printer_id`
- `status`
- `planned_start_at`
- `actual_start_at`
- `planned_end_at`
- `actual_end_at`
- `estimated_minutes`
- `actual_minutes`
- `estimated_weight_grams`
- `actual_weight_grams`
- `has_loss`
- `notes`
- `created_at`
- `updated_at`

### Status

- `QUEUE`
- `PRINTING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

---

## 11.3 `plate_items`

Relaciona um plate com os itens produzidos.

### Campos

- `id`
- `plate_id`
- `production_order_id`
- `order_item_id`
- `planned_quantity`
- `produced_quantity`
- `lost_quantity`
- `created_at`

### Regra

Um plate pode conter itens de vários pedidos.

---

## 11.4 `production_failures`

Registra falhas.

### Campos

- `id`
- `plate_id`
- `failure_reason_id`
- `lost_quantity`
- `lost_filament_grams`
- `lost_time_minutes`
- `notes`
- `created_at`

---

## 11.5 `failure_reasons`

Cadastro dos motivos de falha.

### Campos

- `id`
- `name`
- `is_active`

### Valores iniciais possíveis

- aderência;
- filamento;
- suporte;
- configuração;
- falha da máquina;
- acabamento;
- peça solta;
- outro.

---

# 12. Grupo: Filamentos

**Aplicado ao Supabase remoto `tjhacqreupfqefntjevf` (Módulo 3, Incremento 4, 2026-08-27 —
migrations `20260827100000`/`103000`/`110000`/`113000`, branch `feature/inventory-operations`;
`110000`/`113000` renomeadas de `106000`/`109000` antes da aplicação — os identificadores
originais decodificavam minuto 60/90, inválidos, nunca aplicados com esses nomes). Edge
Functions `filament-types`/`filament-spools`/`filament-movements` publicadas e ativas. Teste de
integração SQL executado contra o remoto (51 PASS/0 FAIL/0 SKIP, dentro de
`BEGIN...ROLLBACK`, zero resíduo).** **Correção de 2026-09-01: o MVP de Filamentos (tipos,
rolos, movimentações, pesagem, arquivamento) foi validado manualmente pelo usuário em
2026-08-28, após três rodadas de reteste de layout — a frase original "Ainda NÃO validado
manualmente" está superada.** Regras
operacionais do MVP — versão inicial para validação, sujeitas a revisão após o teste
prático (ver `01_ESPECIFICACAO_FUNCIONAL.md` §16/§17/§20). As subseções 12.1-12.4 abaixo
descrevem o schema **realmente implementado**, que diverge em três pontos deliberados da
especificação original desta seção (histórico preservado ao final, §12.5):
não há tabela `spool_tares` (tara virou campo do próprio rolo); `filament_types` ganhou
`color_code`/`notes`; os status do rolo mudaram de 5 valores minúsculos para 4 valores
maiúsculos, sem "em uso".

## 12.1 `filament_types`

Representa a combinação comercial do filamento — material + fabricante + linha + cor.
Nunca controla saldo diretamente: a quantidade disponível de um tipo é a soma do peso
disponível dos seus rolos ativos e utilizáveis (ver `vw_filament_type_summary`, §12.3).

### Campos

- `id`
- `material` — fechado, `check` no banco: `PLA` | `PETG` | `TPU` (**ABS explicitamente
  fora do MVP aprovado**, nunca um valor aceito)
- `manufacturer`
- `line` — texto **livre**, sem `check`/enum no banco (decisão deliberada: nunca travar
  o cadastro de uma linha nova ainda não prevista); as 5 linhas abaixo são só sugestão de
  interface
- `commercial_color`
- `color_code` — opcional (código/identificação da cor do fabricante); **não existia na
  especificação original desta seção**, acrescentado por exigência explícita do pedido
  desta rodada
- `minimum_stock_grams` — opcional, `numeric(10,2)` (fracionável, ao contrário de
  `accessories.minimum_stock`/`packaging.minimum_stock`, que são `integer`)
- `is_active`
- `notes` — opcional; **não existia na especificação original**, mesmo motivo de
  `color_code`
- `created_at`, `updated_at`

`unique (material, manufacturer, line, commercial_color)` — a mesma combinação não pode
ser cadastrada duas vezes (`color_code` fica fora da chave).

### Linhas sugeridas (interface, nunca um enum de banco)

- Cor sólida (rotulada "Sólida" na interface)
- Silk
- Velvet
- Translúcido
- DuoColor

### Escrita

`create_filament_type`/`update_filament_type`/`delete_filament_type` (`security
definer`, `EXECUTE` só para `service_role`) — mesmo padrão de
`create_accessory`/`update_accessory`/`delete_accessory` (§13). `delete_filament_type`
bloqueia exclusão física quando há rolo (`FILAMENT_TYPE_HAS_SPOOLS:`) ou composição de
produto vinculados (`FILAMENT_TYPE_HAS_COMPOSITION:`, ver §12.4) — nunca cascateia.

---

## 12.2 `filament_spools`

Representa cada rolo físico, sempre vinculado a um `filament_types`. Cada rolo tem saldo
independente — o peso nunca é controlado só no nível do tipo.

### Campos

- `id`
- `code` — identificador interno único e legível, gerado automaticamente no formato
  `RL-XX-YYY` (ano com 2 dígitos + sequência anual, mesmo padrão de
  `orders.order_number`/`next_order_number()`) — imutável após a criação
- `filament_type_id`
- `nominal_weight_grams` — **livre, sem valor fixo obrigatório** (1.000 g é só sugestão
  de interface, junto de 250/500/750 g)
- `current_net_weight_grams` — saldo materializado, sempre `>= 0`; começa em `0` na
  criação, o peso inicial real é estabelecido pela primeira movimentação (`INITIAL_BALANCE`)
- `empty_spool_weight_grams` — opcional; peso do carretel vazio, quando conhecido (ver
  nota de divergência no §12.5: substitui a tabela `spool_tares` da especificação
  original)
- `received_at` — data (não timestamp), opcional
- `opened_at` — timestamp, opcional; marcado automaticamente na primeira transição para
  `ABERTO`, nunca sobrescrito depois
- `status` — `LACRADO` | `ABERTO` | `ESGOTADO` | `DESCARTADO` (ver §12.5 para a
  divergência frente à especificação original)
- `notes` — opcional
- `is_active` — eixo **independente** de `status`: desativação (visibilidade/soft-hide)
  nunca é o mesmo que descarte (estado físico terminal)
- `created_at`, `updated_at`

### Status

- **LACRADO** — nunca aberto.
- **ABERTO** — em uso.
- **ESGOTADO** — aplicado automaticamente por `register_filament_movement`/
  `register_filament_weighing` sempre que uma movimentação leva o saldo a zero (nunca
  revertido automaticamente se o saldo voltar a ficar positivo).
- **DESCARTADO** — estado terminal: nenhuma function deste projeto reverte
  automaticamente um rolo descartado, e nenhuma movimentação nova é aceita contra ele.

"Rolo ativo e utilizável" (para a soma que compõe a quantidade disponível do tipo) exige
`is_active = true` **e** `status not in ('ESGOTADO', 'DESCARTADO')` — ver
`vw_filament_type_summary`.

### Escrita

`create_filament_spool`/`update_filament_spool`/`delete_filament_spool` — mesmo padrão
de segurança de `filament_types`. `update_filament_spool` bloqueia qualquer tentativa de
sair de `DESCARTADO` (`FILAMENT_SPOOL_DISCARD_IS_FINAL:`) e de reduzir
`nominal_weight_grams` abaixo do saldo atual (`FILAMENT_SPOOL_NOMINAL_BELOW_BALANCE:`).
`delete_filament_spool` bloqueia exclusão física quando há movimentação vinculada
(`FILAMENT_SPOOL_HAS_MOVEMENTS:`).

`vw_filament_type_summary` (view, `security_invoker=true`) — uma linha por tipo, com
`total_available_grams` (soma do peso disponível dos rolos ativos e utilizáveis),
`usable_spool_count` e `total_spool_count`.

---

## 12.3 `filament_movements`

Ledger imutável de movimentações de filamento — **tabela dedicada, independente de
`stock_movements`** (§15.1). Decisão de arquitetura desta rodada: grama é uma grandeza
fracionária (`stock_movements.quantity_delta` é `integer`, desenhado para unidades
discretas de acessórios/embalagens) e cada movimentação de filamento precisa referenciar
tanto o **tipo** quanto o **rolo** (`stock_movements` só tem um item polimórfico único) —
forçar filamento nessa tabela exigiria alterar o tipo de colunas já em produção e
validadas manualmente, sem necessidade real.

### Campos

- `id`
- `filament_type_id` — denormalizado a partir de `spool_id` (sempre lido da linha
  travada do rolo, nunca aceito como parâmetro do chamador) — permite histórico
  consolidado por tipo sem `join`
- `spool_id`
- `movement_type` — 9 valores: `INITIAL_BALANCE`, `PURCHASE`, `RETURN`,
  `POSITIVE_ADJUSTMENT` (entradas); `MANUAL_CONSUMPTION`, `LOSS`, `SAMPLE_TEST`,
  `NEGATIVE_ADJUSTMENT` (saídas); `WEIGHING_ADJUSTMENT` (pesagem — só gravado por
  `register_filament_weighing`, nunca pela rota manual)
- `quantity_delta` — `numeric(10,2)`, fracionário, sinal já resolvido
- `balance_before`, `balance_after` — `numeric(10,2)`, nunca negativos
- `reason` — obrigatório para tudo exceto `INITIAL_BALANCE`/`PURCHASE`/`RETURN`
- `reference_type`, `reference_id` — reservados para vínculo futuro com pedido/produção;
  nenhuma function desta rodada os popula
- `idempotency_key` — opcional, único quando fornecida
- `occurred_at`, `created_by`, `created_at`

### Regras de escrita

- `register_filament_movement` (8 tipos manuais) — mesmo padrão de lock/idempotência de
  `register_stock_movement` (§15.1): `select ... for update` no rolo, checagem de
  idempotência pós-lock, bloco `BEGIN/EXCEPTION` para concorrência real na chave.
  Teto do peso nominal aplicado só às entradas de rotina (`INITIAL_BALANCE`/`PURCHASE`/
  `RETURN`) — a família de ajuste é isenta. Bloqueia movimentação contra rolo
  `DESCARTADO`.
- `register_filament_weighing` — calcula `peso disponível = peso bruto medido − tara`
  quando `empty_spool_weight_grams` é conhecido, ou aceita o peso líquido informado
  diretamente quando não é. Delta zero não grava nada (devolve `null`). Motivo sempre
  obrigatório — nenhuma tolerância percentual foi definida ou inventada.

---

## 12.4 `product_filaments`

> **LEGADA desde a migration `20260829180000` (2026-08-29, aplicada ao remoto).** A
> composição de filamento/cor **saiu do Produto** e passou a ser escolhida **no Pedido**,
> por unidade e por plate (`order_item_unit_plate_filaments`, ver §11 e
> `05_ROADMAP_MODULOS.md` §9c). `product_filaments` e `product_plate_filaments` continuam
> no schema como histórico, mas **nenhuma tela, RPC de Produto ou fluxo lê/escreve nelas**;
> `set_product_filaments` não é chamada por nada. O texto abaixo descreve o modelo como foi
> criado e é mantido só para referência.

**Preparação do modelo de composição de produto por filamento** (não um ledger de
estoque) — "quais tipos de filamento e quanto peso teórico por unidade produzida" um
produto usa. Paralelo a `product_accessories`/`product_packaging` (§13), mas com
`theoretical_weight_grams numeric` (fracionário) em vez de `quantity integer`.

### Campos

- `id`
- `product_id`
- `filament_type_id`
- `theoretical_weight_grams` — `numeric(10,2)`, sempre `> 0`
- `created_at`

`unique (product_id, filament_type_id)`. Escrita via `set_product_filaments` (substitui
o conjunto inteiro atomicamente, mesmo idioma de `set_product_composition`). **Nenhuma
automação lê esta tabela nesta rodada** — consumo automático por pedido é incremento
futuro, ainda não implementado. Sem interface de edição nesta rodada (preparação de
modelo, backend apenas).

---

## 12.5 Divergências frente à especificação original (histórico)

A especificação original desta seção (nunca implementada antes do Incremento 4) previa:

- uma tabela `spool_tares` (tara do carretel por **fabricante**, cadastro à parte) — a
  implementação real usa `empty_spool_weight_grams` como **campo direto do rolo**: o
  pedido desta rodada descreveu a tara como atributo do próprio rolo, e uma tabela de
  lookup por fabricante adicionaria complexidade não solicitada; pode ser revisitada como
  conveniência futura sem exigir remodelagem;
- 5 status de rolo em português minúsculo (`fechado`/`aberto`/`em uso`/`vazio`/
  `descartado`) — a implementação real usa 4 valores maiúsculos
  (`LACRADO`/`ABERTO`/`ESGOTADO`/`DESCARTADO`, sem "em uso"), seguindo literalmente o
  pedido mais recente e mais explícito desta rodada;
- `filament_types` sem `color_code`/`notes` e `filament_spools` com `purchase_price`/
  `supplier_id`/`purchase_date` — a implementação real acrescenta os dois primeiros
  (exigidos pelo pedido) e **não** inclui os três últimos (fora do escopo pedido nesta
  rodada, mesmo espírito de "sem custo/fornecedor ainda" já aplicado a
  Acessórios/Embalagens no Bloco 1).

---

# 13. Grupo: Acessórios e embalagens

**Implementado (Bloco 1, Migration 18)**: cadastro mestre completo — todos os campos abaixo
existem no banco, com `created_at`/`updated_at` adicionais (não listados nas versões anteriores
deste documento).

**Atualização (2026-08-27) — corrige texto desatualizado das seções abaixo**: a interface completa
de cadastro mestre (criar/editar/ativar-desativar/excluir com proteção) está **implementada,
publicada no Supabase remoto e validada manualmente pelo usuário** desde 2026-08-24 (ver
`05_ROADMAP_MODULOS.md` §9/§10) — as menções abaixo a "implementação ainda não iniciada"
referem-se ao estado em 2026-08-22 (momento em que o planejamento foi aprovado) e estão
desatualizadas. Cadastro **oficial** (incluindo a composição da Petlink) continua bloqueado até
autorização explícita separada — isso não mudou.

**Módulo 3, Incremento 1 (2026-08-27, implementado localmente nesta rodada — ver §15.1)**: o
motor de saldo/movimentação de estoque (`stock_movements`/`register_stock_movement()`) agora
existe para estas duas tabelas — `current_stock` deixa de ser uma coluna sem automação e passa a
ser o saldo materializado, atualizado exclusivamente por essa função. A migration correspondente
**ainda não foi aplicada ao Supabase remoto** — só `unit_cost`/`minimum_stock`/`material`
continuam sem nenhuma automação (fora do escopo do Incremento 1).

## 13.1 `accessories`

### Campos

- `id`
- `name`
- `material`
- `size`
- `variant`
- `unit_cost` — opcional
- `minimum_stock` — opcional
- `current_stock` — `not null default 0`; saldo materializado, atualizado exclusivamente por
  `register_stock_movement()` desde o Módulo 3 Incremento 1 (2026-08-27, implementado localmente
  — ver §15.1); `UPDATE` direto desta coluna não é concedido a `authenticated`
- `is_active`
- `created_at`
- `updated_at`

Exemplos:

- ímã 6x2;
- ímã 6x3;
- tag NFC;
- chaveiro de argola;
- chaveiro de corrente;
- LED;
- cola.

Referenciado pela composição padrão de produtos (§9.3). Interface de cadastro mestre completa
(criar/editar/ativar-desativar/excluir com proteção) **implementada, publicada e validada** desde
2026-08-24 — ver §13.3.

---

## 13.2 `packaging`

### Campos

- `id`
- `name`
- `material`
- `size`
- `variant`
- `unit_cost` — opcional
- `minimum_stock` — opcional
- `current_stock` — mesmas ressalvas de `accessories.current_stock`
- `is_active`
- `created_at`
- `updated_at`

Exemplos:

- plástico PP;
- plástico M;
- caixa M;
- Ziplock PP;
- sacola Kraft.

Mesma atualização de §13.1: interface de cadastro mestre completa **implementada, publicada e
validada** desde 2026-08-24 — ver §13.3.

---

## 13.3 Interface de cadastro mestre — decisões aprovadas (planejamento, 2026-08-22)

Decisão de escopo do Módulo 3 (Estoque e Inventário) para a interface de cadastro mestre de
`accessories`/`packaging`, aprovada em 2026-08-22. **Implementada, publicada no Supabase remoto e
validada manualmente pelo usuário desde 2026-08-24** (plano de 8 incrementos concluído — ver
`05_ROADMAP_MODULOS.md` §9/§10). As decisões abaixo permanecem vigentes; onde o texto original
dizia "ainda não implementada" isso se referia ao momento do planejamento (2026-08-22), corrigido
nesta entrada.

### Campos expostos na interface

- Nome (`name`);
- Tamanho (`size`) — opcional;
- Variante (`variant`);
- Estoque mínimo (`minimum_stock`);
- Ativo (`is_active`);
- Custo unitário (`unit_cost`) — **somente leitura**.

`material` **não aparece** na interface de cadastro mestre — a coluna permanece preservada no
banco, intacta, nunca lida/editada por esta interface. Não haverá campo de Fornecedor (a tabela
`suppliers`, §14, continua fora de escopo, só especificada). `current_stock` não será editado
diretamente nesta etapa — nenhuma mudança de grant é necessária para manter essa restrição (o
`UPDATE` desta coluna já não é concedido a `authenticated` desde a Migration 18).

### Tamanho — opções oficiais e valores legados

Opções oficiais da interface: PP, P, M, G, GG. Vazio significa "Não se aplica". **Nenhuma CHECK
constraint será criada nesta etapa** — `size` continua texto livre no banco. Valores legados fora
de PP/P/M/G/GG são preservados integralmente e aparecem na listagem exatamente como estão
gravados; ao editar um registro assim, a interface nunca apaga nem converte o valor
silenciosamente — o usuário decide manter o valor legado ou substituí-lo por uma das 5 opções
oficiais. Não será possível criar, a partir da interface, um tamanho novo fora das 5 opções
oficiais (só valores legados pré-existentes podem estar fora do enum).

### Custo unitário

`unit_cost` é **somente leitura** na interface de cadastro mestre — não há digitação manual de
custo neste cadastro. Quando `unit_cost is null`, a interface exibe "Não informado"; um custo
ausente nunca é tratado como zero em nenhum cálculo. Valores legados existentes (ex.: gravados via
SQL controlado para fixtures) são preservados e exibidos normalmente.

**Cálculo automático a partir das compras de Acessórios (2026-09-06, migration
`20260906140000`, ainda NÃO aplicada):** `accessories.unit_cost` passa a ser atualizado
automaticamente pela RPC `register_accessory_purchase` (compra multi-item de acessórios),
por **média ponderada móvel**, na mesma transação e sob `FOR UPDATE` da linha do acessório —
nunca calculado no frontend. Para cada linha da compra, seja `valor da entrada = total_value +
freight_allocated` (frete rateado proporcionalmente ao `total_value` de cada linha, em centavos
inteiros pelo método do maior resto):

- se `current_stock = 0` **ou** `unit_cost IS NULL` →
  `unit_cost = round(valor da entrada / quantidade comprada, 2)` — a **primeira compra define o
  custo inicial**, sem diluição pelo saldo anterior (decisão do usuário: um `unit_cost` NULL com
  saldo anterior conhecido é substituído pelo custo da entrada, nunca combinado com um custo
  anterior desconhecido);
- caso contrário →
  `unit_cost = round((current_stock × unit_cost + total_value + freight_allocated) /
  (current_stock + quantidade comprada), 2)`.

`numeric` (decimal exato) em todo o caminho; **só o resultado final é arredondado a 2 casas**. O
**total efetivamente pago permanece exato** — `inventory_purchases.item_value` (soma exata dos
`total_value` das linhas), `inventory_purchases.total_value` (gerada = itens + frete) e
`inventory_purchase_accessory_items.total_value` (autoritativo, nunca reconstruído por
`quantidade × unit_cost`); só o `unit_cost` derivado sofre arredondamento (ex.: 3 un por
R$ 10,00 → ledger mantém R$ 10,00, `unit_cost` = R$ 3,33). **Ficha Técnica de Produtos**: passa a
consumir naturalmente o `unit_cost` atualizado nos subtotais por linha e no "Subtotal de
componentes" — efeito esperado, nenhuma mudança de código na Ficha Técnica.

**Embalagens permanecem inalteradas nesta rodada** — `packaging.unit_cost` continua sem cálculo
automático; a compra de Embalagem segue pelo fluxo de item único de `register_inventory_purchase`,
que não toca `unit_cost`.

### Exclusão

A interface tem um botão "Excluir" com confirmação explícita. Exclusão física só é permitida para
um item nunca utilizado — implementada e publicada desde 2026-08-24 via `delete_accessory()`/
`delete_packaging()` (`security definer`, Edge Functions `accessories`/`packaging`, mesmo padrão de
`set_product_composition`, §9.3): um item vinculado a `product_accessories`/`product_packaging`
(§9.3) não pode ser excluído (bloqueio `ACCESSORY_IN_USE:`/`PACKAGING_IN_USE:`). **Atualização
(2026-08-27, Módulo 3 Incremento 1, implementada localmente — ver §15.1)**: as duas funções agora
também bloqueiam a exclusão quando o item tem qualquer movimentação em `stock_movements`
(`ACCESSORY_HAS_STOCK_HISTORY:`/`PACKAGING_HAS_STOCK_HISTORY:`) — cumprindo o que esta seção já
prometia desde a versão anterior deste documento. Um item bloqueado por qualquer um dos dois
motivos deve ser desativado (`is_active = false`) em vez de excluído. Nenhuma exclusão em cascata
é permitida em nenhum dos dois casos. O frontend nunca recebe `GRANT DELETE` direto sobre
`accessories`/`packaging` (confirmado por leitura: nenhuma tabela do projeto concede DELETE a
`authenticated`). Dados oficiais (incluindo a Petlink) nunca são usados como massa de teste para
esta funcionalidade.

---

# 14. Grupo: Fornecedores

## 14.1 `suppliers`

### Campos

- `id`
- `name`
- `website`
- `contact`
- `notes`
- `is_active`

---

# 15. Grupo: Estoque

> **Estado em 2026-09-01:** `stock_movements` + `register_stock_movement`,
> `filament_movements` + `register_filament_movement`/`register_filament_weighing`,
> `inventory_purchases` + `register_inventory_purchase` estão **aplicados ao Supabase remoto**
> (45/45 migrations sincronizadas) e as Edge Functions correspondentes estão publicadas
> (`stock-movements`, `filament-movements`, `inventory-purchases`, v1). O inventário manual
> (saldo/entrada/saída/ajuste/histórico/pesagem/compras) foi validado manualmente pelo
> usuário. As frases "migration ainda NÃO aplicada" / "Implementado localmente" nas
> subseções abaixo são históricas (data de redação). O **motor de reserva/consumo/liberação
> por Pedido** continua sem nenhuma linha de código — seu contrato arquitetural está
> congelado em `05_ROADMAP_MODULOS.md` §9c (8 regras aprovadas, requisito de snapshot de
> Acessórios/Embalagens por Pedido, gramas por filamento por unidade/plate, alocação entre
> rolos e 3 arquiteturas de reserva comparadas com recomendação — opção C).

## 15.1 `stock_movements`

**Implementado localmente em 2026-08-27 (Módulo 3, Incremento 1 — ver
`05_ROADMAP_MODULOS.md` para o estado corrente; migration ainda NÃO aplicada ao Supabase
remoto)**: o schema abaixo é o **real** (implementado), e diverge deliberadamente do
esboço original desta seção (preservado em itálico ao final, para referência histórica).

As regras de negócio que motivam este schema são **regras operacionais do MVP — versão
inicial para validação, sujeitas a revisão após o teste prático do usuário** (disclaimer
completo em `01_ESPECIFICACAO_FUNCIONAL.md` §20). O Incremento 1 implementa **somente o
núcleo seguro de saldo e movimentações manuais** — os 8 `movement_type` abaixo, saldo
nunca negativo, motivo obrigatório por tipo. Reserva, consumo, cancelamento, pesagem,
escolha de rolo e perdas por reimpressão **não têm nenhuma linha de código ainda** —
continuam só a intenção aprovada, aguardando validação prática antes de virarem
implementação. O ledger definido aqui é imutável desde já e **permanece imutável mesmo
quando essas regras futuras forem revisadas** — qualquer correção futura acontece via
novas movimentações e novas migrations, nunca reescrevendo uma linha já gravada.

Registro imutável de movimentações — nunca editado, nunca excluído fisicamente
(`UPDATE`/`DELETE` não são concedidos a nenhuma role de sessão; a única escrita é via
`register_stock_movement()`).

### Campos (reais, implementados)

- `id`
- `item_type` — `ACCESSORY` ou `PACKAGING`; **não** será estendido a `FILAMENT_SPOOL` —
  decisão revisitada no Incremento 4, ver nota abaixo (filamentos têm ledger próprio,
  `filament_movements`, §12.3)
- `item_id` — **sem foreign key** (campo polimórfico: aponta para `accessories.id` ou
  `packaging.id` conforme `item_type`, uma FK condicional não é representável);
  `register_stock_movement()` valida a existência real do item antes de gravar, via
  `SELECT ... FOR UPDATE`
- `movement_type` — ver "Tipos" abaixo
- `quantity_delta` — inteiro, nunca zero; sinal já resolvido (entradas positivas, saídas
  negativas) — o chamador informa sempre uma quantidade positiva, o `movement_type`
  decide a direção
- `balance_before` / `balance_after` — saldo materializado antes/depois desta
  movimentação, nunca negativo
- `reason` — obrigatório para `POSITIVE_ADJUSTMENT`/`NEGATIVE_ADJUSTMENT`/`LOSS`/
  `SAMPLE_DONATION`/`INTERNAL_USE`; opcional para `PURCHASE`/`RETURN`/`INITIAL_BALANCE`
- `reference_type` / `reference_id` — vínculo polimórfico futuro (pedido, inventário,
  compra, produção); sempre `NULL` nesta etapa (só movimentações manuais existem)
- `idempotency_key` — opcional; quando fornecida, é única e protege contra dupla
  gravação (reuso com o mesmo payload é idempotente; reuso com payload diferente é
  rejeitado)
- `occurred_at` — data/hora de negócio do evento (pode ser retroativa)
- `created_by` — referência a `users`, `ON DELETE RESTRICT`
- `created_at`

Nota de divergência do esboço original: em vez de três colunas de FK opcionais
(`filament_spool_id`/`accessory_id`/`packaging_id`, uma preenchida por vez) e uma coluna
`unit` separada, a implementação real usa um único par polimórfico `item_type`/`item_id`
(validado pela RPC, não por FK). `notes` foi renomeado para `reason` (mais preciso: nem
toda movimentação tem uma "nota" livre, mas as que exigem justificativa exigem um
"motivo").

**Decisão revisitada no Incremento 4 (2026-08-27, filamentos):** a ideia original de
"`FILAMENT_SPOOL` no futuro só amplia o `CHECK`" (registrada nas primeiras versões deste
comentário) **não foi seguida** — o diagnóstico técnico do Incremento 4 concluiu que
`quantity_delta`/`balance_before`/`balance_after` sendo `integer` (adequado só para
unidades discretas) e `item_id` sendo um único FK polimórfico (sem espaço para tipo E
rolo ao mesmo tempo) tornariam essa extensão arriscada sobre uma tabela já em produção e
validada manualmente. Filamentos passaram a ter um ledger **próprio**
(`filament_movements`, §12.3) — `stock_movements` permanece intocada, só para
`ACCESSORY`/`PACKAGING`.

### Tipos implementados nesta etapa (`movement_type`)

Entradas: `INITIAL_BALANCE`, `PURCHASE`, `RETURN`, `POSITIVE_ADJUSTMENT`.
Saídas: `LOSS`, `SAMPLE_DONATION`, `INTERNAL_USE`, `NEGATIVE_ADJUSTMENT`.

`RESERVATION`/`RELEASE`/`CONSUMPTION` (reserva/liberação/consumo automático pelo
pedido) **não são aceitos ainda** por `register_stock_movement()` — ficam para um
incremento futuro, quando o `CHECK` de `movement_type` for ampliado. `WEIGHING`
(pesagem) não se aplica a esta tabela — filamentos têm sua própria pesagem
(`register_filament_weighing`, §12.3), Acessórios/Embalagens não têm pesagem física
prevista.

### Função `register_stock_movement()`

Única função que escreve em `stock_movements` e em
`accessories.current_stock`/`packaging.current_stock`, na mesma transação: trava a linha
do item (`FOR UPDATE`), calcula `balance_before`, valida a movimentação (tipo de item,
tipo de movimentação, quantidade inteira positiva, motivo obrigatório por tipo, regras
de `INITIAL_BALANCE`, saldo nunca negativo, idempotência), insere a movimentação e
atualiza o saldo materializado. `accessories.current_stock`/`packaging.current_stock`
são o saldo físico **materializado** (leitura rápida); `stock_movements` é o ledger de
auditoria/reconciliação — o saldo nunca é calculado por `sum(stock_movements)` em tempo
real.

### Esboço original desta seção (histórico, substituído pelo schema acima)

*Campos: `id`, `inventory_type`, `filament_spool_id` opcional, `accessory_id` opcional,
`packaging_id` opcional, `movement_type`, `quantity`, `unit`, `reference_type`,
`reference_id`, `notes`, `created_at`, `created_by`. Tipos: entrada; consumo; reserva;
liberação de reserva; perda; ajuste; correção.*

---

## 15.2 `stock_reservations`

**Não implementada** — continua só especificada. Fica para o incremento do **motor de
reserva/consumo/liberação por Pedido** (contrato congelado em `05_ROADMAP_MODULOS.md`
§9c). **Atenção:** a forma final da reserva ainda é decisão do usuário (§9c.7/§9c.10) — a
recomendação técnica registrada (opção C) prevê uma coluna materializada `reserved` (por
item, para Acessórios/Embalagens; por `filament_type`, para Filamentos) **mais** um ledger
de reservas auditável; pode ou não se chamar `stock_reservations` e pode ser mais de uma
tabela. O rascunho de campos abaixo é da especificação original e **não** deve ser tratado
como o modelo aprovado.

### Campos

- `id`
- `production_order_id`
- `filament_spool_id`
- `reserved_grams`
- `status`
- `reserved_at`
- `released_at`

---

## 15.3 Compras — `inventory_purchases` e itens

**Aplicadas ao Supabase remoto:** `inventory_purchases` (cabeçalho/ledger financeiro imutável,
migration `20260828120000`), `inventory_purchase_filament_items` (itens de compra de filamento,
`20260904130000` + `total_value` autoritativo em `20260905160000`).

**Migration `20260906140000` — ainda NÃO aplicada** (compra de acessórios multi-item):

- `inventory_purchases` ganha **`supplier_name text NULL`** — fornecedor como **texto livre
  opcional**. `NULL` permitido; quando presente, sem texto vazio após `trim` e ≤ 200 caracteres
  (CHECK `inventory_purchases_supplier_name_not_blank`). **Nunca** reutiliza `notes` nem
  `purchase_channel` para fornecedor. A tabela `suppliers` (§14) continua fora de escopo.
- Nova tabela **`inventory_purchase_accessory_items`** — um item por linha de uma compra de
  acessórios, sempre vinculado a um cabeçalho `inventory_purchases` (`category = 'ACCESSORY'`,
  `item_id NULL` no cabeçalho multi-item; `quantity`/`item_value` = totais agregados,
  `item_value` = soma exata dos `total_value` das linhas). Campos: `id`, `purchase_id` (FK
  `inventory_purchases`), `accessory_id` (FK `accessories`, `ON DELETE RESTRICT`), `line_number`
  (> 0), `quantity` (> 0), `total_value numeric(12,2)` (> 0, **fonte autoritativa** do valor
  pago pela linha — nunca `quantidade × unit_cost`), `freight_allocated numeric(12,2)` (≥ 0,
  parcela do frete único rateada proporcionalmente a `total_value`, centavos inteiros, maior
  resto, Σ = `freight_value`), `landed_total_value` (**gerada** = `total_value +
  freight_allocated`), `balance_before`/`balance_after` (≥ 0, `balance_after = balance_before +
  quantity`), `unit_cost_before numeric(10,2) NULL`, `unit_cost_after numeric(10,2)` (≥ 0,
  média ponderada móvel — ver §13.3), `created_at`. `UNIQUE (purchase_id, accessory_id)` (um
  acessório nunca se repete na mesma compra) e `UNIQUE (purchase_id, line_number)`. Ledger
  **imutável**: `SELECT` só a `authenticated` ativo (RLS `is_active_user()`), **nenhum**
  `INSERT`/`UPDATE`/`DELETE` a nenhuma role de sessão — escrita exclusiva via
  `register_accessory_purchase` (`security definer`, `search_path` fixo, `EXECUTE` só
  `service_role`).
- **`register_accessory_purchase(p_items jsonb, p_freight_value, p_supplier_name, p_notes,
  p_occurred_at, p_changed_by, p_idempotency_key)`** — RPC dedicada. Numa **única transação**:
  valida 1..50 itens; rateia o frete (determinístico, maior resto); trava os acessórios em
  ordem ascendente por `id` (`FOR UPDATE` — serializa compras concorrentes, evita deadlock;
  bloqueia inexistente/inativo); cria o cabeçalho e os itens; chama `register_stock_movement`
  (`PURCHASE`, `reference_type='PURCHASE'`, `reference_id` = cabeçalho, `occurred_at` = data
  informada, `reason` = fornecedor/observação legível) por acessório; atualiza
  `accessories.unit_cost`. Idempotente por `p_idempotency_key` (compara
  `category`/`freight`/`supplier`/`notes`/itens canônicos por `accessory_id`; `occurred_at`
  fica de fora, mesma convenção das outras RPCs). Qualquer exceção desfaz cabeçalho, itens,
  movimentos, saldo **e** custos. Devolve um `jsonb` com o cabeçalho e os itens ordenados por
  `line_number` (`unit_cost_before`/`unit_cost_after`, `balance_before`/`balance_after`,
  `freight_allocated`, `landed_total_value`).
- Edge Function `inventory-purchases`: rota nova **`POST /inventory-purchases/accessory`**
  (`inventory-purchases` **não republicada** nesta rodada). O frontend **nunca** envia
  `unit_cost`, `freight_allocated` nem saldos — o handler rejeita chave desconhecida. As rotas
  base (Embalagem/legado) e `/filament` permanecem **inalteradas**.

---

# 16. Grupo: Inventário

> **Estado em 2026-09-01: NÃO INICIADO.** `inventories` e `inventory_items` (inventário
> físico/periódico) continuam **só especificados** — nenhuma migration, nenhuma RPC, nenhuma
> tela. É um incremento próprio do Módulo 3, independente e posterior ao motor de
> reserva/consumo por Pedido (ver `05_ROADMAP_MODULOS.md` §9c).

## 16.1 `inventories`

Cabeçalho do inventário.

### Campos

- `id`
- `inventory_date`
- `status`
- `started_at`
- `finished_at`
- `notes`
- `created_by`

### Status

- aberto;
- em andamento;
- concluído;
- cancelado.

---

## 16.2 `inventory_items`

### Campos

- `id`
- `inventory_id`
- `item_type`
- `filament_spool_id` opcional
- `accessory_id` opcional
- `packaging_id` opcional
- `theoretical_quantity`
- `measured_gross_weight` opcional
- `spool_tare_weight` opcional
- `measured_net_weight` opcional
- `counted_quantity` opcional
- `difference`
- `adjustment_applied`
- `notes`

---

# 17. Grupo: MDO e tempo humano

## 17.1 `work_logs`

Registra tempo humano associado ao trabalho.

### Campos

- `id`
- `order_id` opcional
- `order_item_id` opcional
- `work_category`
- `start_at` opcional
- `end_at` opcional
- `minutes`
- `hourly_rate`
- `calculated_cost`
- `status`
- `notes`
- `created_at`

### Categorias

- pesquisa de modelo;
- adaptação/preparação;
- montagem;
- acabamento;
- embalagem;
- outro.

### Regra

A categoria é opcional para o usuário, mas o tempo total deve ser preservado quando exigido pela regra do processo.

---

# 18. Grupo: Precificação

## 18.1 `pricing_calculations`

Cada cálculo deve preservar os parâmetros usados.

### Campos

- `id`
- `order_item_id` opcional
- `product_id` opcional
- `material_cost`
- `energy_cost`
- `depreciation_cost`
- `maintenance_cost`
- `labor_cost`
- `personalization_cost`
- `accessory_cost`
- `packaging_cost`
- `historical_loss_percentage`
- `historical_loss_cost`
- `base_cost`
- `margin_percentage`
- `suggested_price`
- `final_price`
- `hourly_labor_rate_used`
- `energy_hour_rate_used`
- `depreciation_hour_rate_used`
- `maintenance_hour_rate_used`
- `created_at`

---

# 19. Grupo: Pagamentos

## 19.1 `payments`

Permite registrar pagamentos parciais e completos.

### Campos

- `id`
- `order_id`
- `payment_method`
- `amount`
- `payment_type`
- `paid_at`
- `notes`
- `created_at`

### Tipos

- sinal;
- pagamento final;
- pagamento integral;
- ajuste.

---

# 20. Grupo: Arquivos

## 20.1 `files`

Metadados dos arquivos presentes no Google Drive.

### Campos

- `id`
- `drive_file_id`
- `file_name`
- `mime_type`
- `file_category`
- `entity_type`
- `entity_id`
- `drive_url`
- `created_at`

### Categorias

- 3MF;
- SVG;
- JPG;
- foto;
- vídeo;
- aprovação;
- marketing;
- outro.

---

# 21. Grupo: Marketing

## 21.1 `marketing_events`

### Campos

- `id`
- `name`
- `event_type`
- `event_date`
- `is_recurring`
- `lead_days`
- `source`
- `notes`
- `is_active`

### Tipos

- comercial;
- municipal;
- religioso;
- escolar;
- empresarial;
- esportivo;
- outro.

---

## 21.2 `marketing_plans`

### Campos

- `id`
- `event_id` opcional
- `product_id` opcional
- `order_item_id` opcional
- `objective`
- `content_type`
- `strategy_explanation`
- `planned_date`
- `status`
- `created_by_sky`
- `created_at`

---

## 21.3 `publications`

### Campos

- `id`
- `marketing_plan_id`
- `channel`
- `caption`
- `call_to_action`
- `hashtags`
- `scheduled_at`
- `published_at`
- `approval_status`
- `approved_at`
- `external_post_id`
- `status`

---

## 21.4 `publication_metrics`

### Campos

- `id`
- `publication_id`
- `measurement_type`
- `measured_at`
- `views`
- `reach`
- `likes`
- `comments`
- `shares`
- `saves`
- `messages_received`
- `orders_generated`
- `notes`

### Tipos de medição

- 24h;
- semanal;
- mensal.

---

# 22. Grupo: Alertas e notificações

## 22.1 `alerts`

### Campos

- `id`
- `alert_type`
- `priority`
- `entity_type`
- `entity_id`
- `title`
- `message`
- `status`
- `first_triggered_at`
- `last_triggered_at`
- `acknowledged_at`
- `resolved_at`

### Prioridades

- bloqueante;
- importante;
- informativa.

---

## 22.2 `notifications`

### Campos

- `id`
- `alert_id` opcional
- `channel`
- `sent_at`
- `delivery_status`
- `read_at`
- `notes`

### Canais

- app;
- push;
- WhatsApp.

---

# 23. Grupo: Parâmetros

## 23.1 `parameters`

### Campos

- `id`
- `key`
- `display_name`
- `value`
- `value_type`
- `unit`
- `category`
- `effective_from`
- `last_reviewed_at`
- `next_review_at`
- `is_active`

### Exemplos

- MDO = 5,90/h;
- estoque mínimo preto = 500 g;
- estoque mínimo branco = 500 g;
- estoque mínimo colorido = 300 g;
- margem mínima = 40%;
- margem máxima = 80%;
- energia = 0,12/h;
- depreciação = 0,25/h;
- manutenção = 0,00/h;
- Spot → Catálogo = 3 pedidos;
- publicação = 2 vezes/semana;
- conversa Sky = 3 minutos.

---

## 23.2 `parameter_history`

### Campos

- `id`
- `parameter_id`
- `old_value`
- `new_value`
- `changed_at`
- `changed_by`
- `reason`

---

# 24. Grupo: Manutenção

## 24.1 `maintenance_records`

### Campos

- `id`
- `printer_id`
- `maintenance_type`
- `component`
- `performed_at`
- `printer_usage_hours`
- `notes`
- `next_due_at`
- `created_at`

### Itens iniciais

- lubrificação eixo X;
- lubrificação eixo Y;
- lubrificação eixo Z;
- limpeza;
- troca de componente;
- outro.

---

## 24.2 `maintenance_rules`

### Campos

- `id`
- `printer_model`
- `maintenance_type`
- `component`
- `interval_days` opcional
- `interval_usage_hours` opcional
- `source`
- `notes`
- `is_active`

---

# 25. Grupo: Escala

## 25.1 `work_shift_cycles`

### Campos

- `id`
- `name`
- `cycle_order`
- `start_time`
- `end_time`
- `work_days`
- `off_days`
- `is_active`

---

## 25.2 `work_schedule`

Tabela gerada para datas específicas.

### Campos

- `id`
- `date`
- `shift_type`
- `start_at`
- `end_at`
- `is_work_day`
- `source`
- `notes`

A escala poderá ser gerada automaticamente com base no ciclo 6x2.

---

# 26. Relações centrais

## Pedido

```text
customers
   ↓
orders
   ↓
order_items
   ├── custom_item_details
   ├── spot_item_details
   └── products
```

## Produção

```text
order_items
   ↓
production_orders
   ↓
plate_items
   ↓
plates
   ↓
printers
```

## Estoque

```text
filament_types
   ↓
filament_spools
   ↓
stock_movements
   ↓
inventories
```

## Precificação

```text
order_items / products
       ↓
pricing_calculations
       ↓
work_logs + production data + stock data
```

---

# 27. Regras de integridade importantes

1. Um `order_item` deve pertencer a um `order`.
2. Item Catálogo pode referenciar `product_id`.
3. Item Personalizado deve possuir `custom_item_details`.
4. Item Spot deve possuir `spot_item_details`.
5. Um plate precisa estar vinculado a uma impressora.
6. Um plate pode possuir vários `plate_items`.
7. `plate_items` podem pertencer a pedidos diferentes.
8. O estoque físico não pode ser reduzido sem movimentação correspondente.
9. Ajustes de inventário devem gerar movimentação.
10. Alteração de parâmetro deve gerar histórico.
11. Alteração relevante de preço deve gerar histórico.
12. Publicação externa só pode ocorrer após aprovação.
13. Comando físico na impressora deve possuir confirmação registrada quando aplicável.
14. Reimpressão por falha deve preservar vínculo com a falha original.
15. O histórico de produção não deve ser apagado ao inativar uma impressora.

---

# 28. Views e cálculos recomendados

No PostgreSQL, criar views para facilitar consultas.

Exemplos:

## `vw_order_summary`

Resumo de:

- pedido;
- cliente;
- status;
- pagamento;
- valor;
- prazo.

## `vw_production_queue`

Fila ordenada segundo regras de prioridade.

## `vw_available_filament_stock`

Mostrar:

- estoque físico;
- estoque reservado;
- estoque disponível.

## `vw_product_margin`

Mostrar:

- preço cadastrado;
- custo atual;
- margem atual;
- última revisão.

## `vw_inventory_differences`

Diferenças encontradas no inventário.

## `vw_daily_summary`

Base para o resumo diário da Sky.

---

# 29. Índices recomendados

Criar índices inicialmente para:

- `orders.customer_id`
- `orders.order_status`
- `orders.expected_delivery_date`
- `order_items.order_id`
- `production_orders.order_item_id`
- `plates.printer_id`
- `plates.status`
- `stock_movements.created_at`
- `filament_spools.filament_type_id`
- `alerts.status`
- `parameters.key`
- `publications.published_at`

Outros índices deverão ser adicionados somente conforme uso real.

---

# 30. Exclusão e inativação

Preferir `is_active = false` para:

- clientes;
- produtos;
- impressoras;
- filamentos;
- acessórios;
- embalagens;
- fornecedores.

Não permitir exclusão física de registros que possuam histórico operacional relevante.

---

# 31. Dados da Sky

Não criar inicialmente uma tabela de memória solta da Sky como fonte operacional.

A Sky deverá recuperar contexto do banco.

Histórico de conversa poderá ser adicionado futuramente apenas como recurso complementar.

---

# 32. Migrações

Toda alteração estrutural deve ser registrada em:

`database/migrations/`

Nunca alterar manualmente produção sem uma migration rastreável.

---

# 33. Seeds

Criar dados iniciais em:

`database/seeds/`

Entre eles:

- status;
- canais de origem;
- meios de pagamento;
- materiais;
- linhas de filamento;
- parâmetros iniciais;
- categorias de MDO;
- tipos de manutenção.

---

# 34. Ordem sugerida de criação das tabelas

1. users
2. companies
3. customers
4. lead_sources
5. suppliers
6. files
7. products
8. printers
9. filament_types
10. spool_tares
11. filament_spools
12. accessories
13. packaging
14. orders
15. order_items
16. custom_item_details
17. custom_versions
18. approvals
19. model_sources
20. spot_item_details
21. production_orders
22. plates
23. plate_items
24. failure_reasons
25. production_failures
26. stock_movements
27. stock_reservations
28. inventories
29. inventory_items
30. work_logs
31. pricing_calculations
32. payments
33. product_price_history
34. parameters
35. parameter_history
36. maintenance_rules
37. maintenance_records
38. marketing_events
39. marketing_plans
40. publications
41. publication_metrics
42. alerts
43. notifications
44. work_shift_cycles
45. work_schedule

---

# 35. Regra para implementação

O Claude Code deverá converter este modelo em migrations PostgreSQL somente depois de revisar:

- `01_ESPECIFICACAO_FUNCIONAL.md`
- `02_ESPECIFICACAO_TECNICA.md`
- este documento.

Caso encontre conflito entre os três documentos, deverá interromper aquela decisão específica e solicitar revisão antes de implementar.

---

# 36. Próximo passo

Após aprovação deste modelo, criar:

`04_PLANO_IMPLEMENTACAO.md`

Esse documento deverá transformar a arquitetura e o banco em tarefas pequenas, testáveis e ordenadas.

> **O banco deve sustentar a operação da Forma sem obrigar o usuário a pensar como um administrador de banco de dados.**
