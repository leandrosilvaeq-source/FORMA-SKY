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
- `category`
- `description`
- `default_price`
- `default_material_id`
- `default_print_time_minutes`
- `default_weight_grams`
- `units_per_plate`
- `default_file_id`
- `allows_personalization`
- `is_active`
- `created_at`
- `updated_at`

### Observações

O preço não deve ser recalculado automaticamente a cada pedido.

Custos devem ser monitorados separadamente.

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

## 12.1 `filament_types`

Representa a combinação comercial do filamento.

### Campos

- `id`
- `manufacturer`
- `material`
- `line`
- `commercial_color`
- `minimum_stock_grams`
- `is_active`

### Materiais

- PLA
- PETG
- TPU

### Linhas

- Cor sólida
- Silk
- Velvet
- Translúcido
- DuoColor

---

## 12.2 `spool_tares`

Cadastro da tara do carretel por fabricante.

### Campos

- `id`
- `manufacturer`
- `empty_spool_weight_grams`
- `created_at`
- `updated_at`

---

## 12.3 `filament_spools`

Representa cada rolo físico.

### Campos

- `id`
- `filament_type_id`
- `spool_tare_id`
- `nominal_weight_grams`
- `current_net_weight_grams`
- `purchase_price`
- `supplier_id` opcional
- `purchase_date`
- `status`
- `created_at`
- `updated_at`

### Status sugeridos

- fechado;
- aberto;
- em uso;
- vazio;
- descartado.

---

# 13. Grupo: Acessórios e embalagens

**Implementado (Bloco 1, Migration 18)**: cadastro mestre completo — todos os campos abaixo
existem no banco, com `created_at`/`updated_at` adicionais (não listados nas versões anteriores
deste documento). Controle de estoque real (movimentação/reserva/consumo/baixa,
`stock_movements`/`inventory_items`) **não** está implementado — ver ressalva em cada tabela.

## 13.1 `accessories`

### Campos

- `id`
- `name`
- `material`
- `size`
- `variant`
- `unit_cost` — opcional
- `minimum_stock` — opcional
- `current_stock` — `not null default 0`; sem nenhuma automação (nenhuma function/trigger
  incrementa/decrementa); `UPDATE` direto desta coluna não é concedido a `authenticated` — fica
  reservada para a função controlada que o Módulo 3 criará
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

Referenciado pela composição padrão de produtos (§9.3). Cadastro/edição pela interface fica para
uma subetapa futura — nesta etapa a leitura via frontend é só listagem (para montar a
composição); fixtures de teste são criadas via SQL controlado.

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

## 15.1 `stock_movements`

Registro imutável de movimentações.

### Campos

- `id`
- `inventory_type`
- `filament_spool_id` opcional
- `accessory_id` opcional
- `packaging_id` opcional
- `movement_type`
- `quantity`
- `unit`
- `reference_type`
- `reference_id`
- `notes`
- `created_at`
- `created_by`

### Tipos

- entrada;
- consumo;
- reserva;
- liberação de reserva;
- perda;
- ajuste;
- correção.

---

## 15.2 `stock_reservations`

### Campos

- `id`
- `production_order_id`
- `filament_spool_id`
- `reserved_grams`
- `status`
- `reserved_at`
- `released_at`

---

# 16. Grupo: Inventário

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
