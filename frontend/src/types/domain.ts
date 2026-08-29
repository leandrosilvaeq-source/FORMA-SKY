// Tipos compartilhados do Módulo 1 (Clientes, Produtos e Pedidos).
//
// Cada interface espelha exatamente as colunas da migration/view indicada no
// comentário acima dela — nenhum campo é inventado. Consulte
// docs/03_MODELO_BANCO_DADOS.md para a descrição funcional de cada tabela.

export type OrderStatus =
  | 'QUOTE'
  | 'WAITING_APPROVAL'
  | 'APPROVED'
  | 'IN_PRODUCTION_QUEUE'
  | 'IN_PRODUCTION'
  | 'WAITING_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'

export type PaymentStatus = 'WAITING_PAYMENT' | 'DEPOSIT_RECEIVED' | 'PAID'

export type PaymentMethod = 'PIX' | 'DINHEIRO' | 'CARTAO'

export type ItemType = 'CATALOG' | 'CUSTOM' | 'SPOT'

// products.product_type — mesmos 3 valores técnicos de ItemType (reutilizados
// de propósito, nunca reinventados), mas um tipo próprio: classifica o
// PRODUTO no Catálogo, não o item de um pedido específico. Migration
// 20260821090000_add_product_type.sql (ainda não aplicada).
export type ProductType = 'CATALOG' | 'CUSTOM' | 'SPOT'

export type SearchTimeStatus = 'NOT_INFORMED' | 'IN_PROGRESS' | 'RECORDED'

export type PaymentType = 'SINAL' | 'FINAL' | 'INTEGRAL' | 'AJUSTE'

export type ApprovalType = 'WHATSAPP' | 'PHOTO' | 'FORMAL_DOCUMENT' | 'OTHER'

// supabase/migrations/20260813204515_create_customers_table.sql
export interface Customer {
  id: string
  name: string
  whatsapp: string | null
  instagram: string | null
  company_id: string | null
  acquisition_source_id: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// supabase/migrations/20260813201248_create_companies_table.sql
export interface Company {
  id: string
  name: string
  trade_name: string | null
  document_number: string | null
  whatsapp: string | null
  instagram: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// supabase/migrations/20260813194021_create_lookup_tables.sql
export interface LeadSource {
  id: string
  name: string
  is_active: boolean
}

export interface ModelSource {
  id: string
  name: string
  is_active: boolean
}

// supabase/migrations/20260813205942_create_products_table.sql
export interface Product {
  id: string
  name: string
  // Classificação do produto no Catálogo — migration 20260821090000_add_product_type.sql
  // (ainda não aplicada), NOT NULL DEFAULT 'CATALOG'. Só CATALOG está
  // habilitado nos fluxos de Pedidos por enquanto.
  product_type: ProductType
  category: string | null
  description: string | null
  default_price: number
  // Segundos inteiros — renomeada de default_print_time_minutes (integer,
  // minutos) pela migration que converte os valores legados (*60). Nunca
  // formatado como Date/duração de calendário; ver
  // frontend/src/lib/forms/durationField.ts.
  default_print_time_seconds: number | null
  default_weight_grams: number | null
  // Legado: coluna preservada no banco (não é mais exibida/editável em
  // nenhuma tela — removida de "Novo produto" e da Ficha Técnica), nunca
  // preenchida por produtos novos (sempre null a partir desta rodada).
  units_per_plate: number | null
  default_file_id: string | null
  allows_personalization: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

// supabase/migrations/20260813221340_create_orders_table.sql
export interface Order {
  id: string
  order_number: string
  customer_id: string
  company_id: string | null
  lead_source_id: string | null
  order_status: OrderStatus
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  order_date: string
  approval_date: string | null
  expected_delivery_date: string | null
  actual_delivery_date: string | null
  delivery_method: string | null
  shipping_cost: number
  discount_value: number
  subtotal: number
  total_value: number
  notes: string | null
  created_at: string
  updated_at: string
}

// supabase/migrations/20260814040037_create_order_summary_views.sql (vw_order_summary),
// estendida por
// supabase/migrations/20260821014342_extend_order_summary_and_payment_method.sql
// com payment_method/delivery_method (colunas de orders, antes ausentes da
// view) e item_types/item_names (agregados de order_items via LEFT JOIN
// LATERAL — nunca persistidos em orders).
export interface OrderSummary {
  order_id: string
  order_number: string
  customer_id: string
  company_id: string | null
  order_status: OrderStatus
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  delivery_method: string | null
  order_date: string
  expected_delivery_date: string | null
  actual_delivery_date: string | null
  subtotal: number
  discount_value: number
  total_value: number
  shipping_cost: number
  total_receivable: number
  total_paid: number
  balance_due: number
  has_overpayment: boolean
  overpayment_amount: number
  approval_required: boolean
  is_fully_approved: boolean
  pending_approval_items: number
  // Tipos distintos de order_items.item_type presentes no pedido, em ordem
  // alfabética determinística (array_agg(distinct ... order by ...) na
  // view) — nunca duplicado, mesmo com vários itens do mesmo tipo.
  item_types: ItemType[]
  // Nome de TODOS os itens (order_items.item_name), na ordem de criação
  // (array_agg(... order by created_at) na view) — inclui CATALOG, CUSTOM
  // e SPOT igualmente, sem tentar resolver nome via product_id.
  item_names: string[]
}

// supabase/migrations/20260814005328_create_order_items_table.sql
export interface OrderItem {
  id: string
  order_id: string
  item_type: ItemType
  product_id: string | null
  item_name: string
  description: string | null
  quantity: number
  unit_price: number
  personalization_fee: number
  discount_value: number
  total_price: number
  color_description: string | null
  number_of_colors: number | null
  customization_data: Record<string, unknown>
  expected_delivery_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// supabase/migrations/20260814040037_create_order_summary_views.sql (vw_order_item_approval_status)
export interface OrderItemApprovalStatus {
  order_item_id: string
  order_id: string
  item_type: ItemType
  requires_approval: boolean
  is_approved: boolean
  current_version: string | null
  approved_version: string | null
  approval_count: number
  latest_approved_at: string | null
}

// supabase/migrations/20260814010323_create_custom_item_tables.sql
export interface CustomItemDetails {
  id: string
  order_item_id: string
  current_version: string
  is_exclusive: boolean
  prototype_required: boolean
  prototype_completed: boolean
  development_minutes: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CustomVersion {
  id: string
  order_item_id: string
  version_number: string
  change_type: string | null
  change_description: string | null
  file_id: string | null
  created_at: string
}

export interface Approval {
  id: string
  order_item_id: string
  custom_version_id: string | null
  approval_type: ApprovalType
  approved_at: string
  approval_evidence_file_id: string | null
  notes: string | null
  created_by: string
  created_at: string
}

// supabase/migrations/20260814013200_create_spot_item_details_table.sql
export interface SpotItemDetails {
  id: string
  order_item_id: string
  model_source_id: string | null
  source_reference: string | null
  is_exclusive: boolean
  test_print_required: boolean
  test_print_completed: boolean
  search_time_status: SearchTimeStatus
  search_minutes: number | null
  preparation_minutes: number | null
  market_reference_price: number | null
  market_reference_source: string | null
  market_reference_date: string | null
  catalog_conversion_suggested: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

// supabase/migrations/20260816150000_create_accessories_packaging_and_composition_tables.sql
export interface Accessory {
  id: string
  name: string
  material: string | null
  size: string | null
  variant: string | null
  unit_cost: number | null
  minimum_stock: number | null
  current_stock: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Packaging {
  id: string
  name: string
  material: string | null
  size: string | null
  variant: string | null
  unit_cost: number | null
  minimum_stock: number | null
  current_stock: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// Módulo 3, Incremento 1 (supabase/migrations/20260827090000_create_stock_movements_table.sql).
// Extensível a 'FILAMENT_SPOOL' no futuro (Incremento 5) — nunca inventado
// aqui antes de existir no banco.
export type StockItemType = 'ACCESSORY' | 'PACKAGING'

// Entradas: INITIAL_BALANCE/PURCHASE/RETURN/POSITIVE_ADJUSTMENT (delta
// positivo). Saídas: LOSS/SAMPLE_DONATION/INTERNAL_USE/NEGATIVE_ADJUSTMENT
// (delta negativo). Extensível a RESERVATION/RELEASE/CONSUMPTION/WEIGHING
// no futuro (Incrementos 5/7/8) — nenhum dos 4 é aceito por
// register_stock_movement() nesta etapa.
export type StockMovementType =
  | 'INITIAL_BALANCE'
  | 'PURCHASE'
  | 'RETURN'
  | 'POSITIVE_ADJUSTMENT'
  | 'LOSS'
  | 'SAMPLE_DONATION'
  | 'INTERNAL_USE'
  | 'NEGATIVE_ADJUSTMENT'

// Ledger imutável — nunca editado nem excluído pelo frontend (nenhuma rota
// de UPDATE/DELETE existe para esta tabela). balance_after já é o novo
// saldo do item após esta movimentação.
export interface StockMovement {
  id: string
  item_type: StockItemType
  item_id: string
  movement_type: StockMovementType
  quantity_delta: number
  balance_before: number
  balance_after: number
  reason: string | null
  reference_type: string | null
  reference_id: string | null
  idempotency_key: string | null
  occurred_at: string
  created_by: string
  created_at: string
}

// Módulo 3, Incremento 4 (filamentos) — MVP local, regras sujeitas a
// revisão após uso real (docs/05_ROADMAP_MODULOS.md §9b).
// supabase/migrations/20260827100000_create_filament_types_table.sql —
// ABS explicitamente fora do MVP aprovado.
export type FilamentMaterial = 'PLA' | 'PETG' | 'TPU'

export interface FilamentType {
  id: string
  material: FilamentMaterial
  manufacturer: string
  // Texto livre — nunca um enum travado (as 5 linhas sugeridas na interface
  // são só sugestão, ver FILAMENT_LINE_SUGGESTIONS em FilamentTypeForm.tsx).
  line: string
  commercial_color: string
  color_code: string | null
  minimum_stock_grams: number | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

// supabase/migrations/20260827103000_create_filament_spools_table.sql —
// LACRADO/ABERTO/ESGOTADO/DESCARTADO (4 valores, sem "em uso" — divergência
// deliberada frente à especificação antiga do doc 03 §12.3, ver comentário
// da migration). DESCARTADO é terminal.
export type FilamentSpoolStatus = 'LACRADO' | 'ABERTO' | 'ESGOTADO' | 'DESCARTADO'

export interface FilamentSpool {
  id: string
  code: string
  filament_type_id: string
  nominal_weight_grams: number
  current_net_weight_grams: number
  empty_spool_weight_grams: number | null
  received_at: string | null
  opened_at: string | null
  status: FilamentSpoolStatus
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  // supabase/migrations/20260828121000_create_register_inventory_purchase_function.sql —
  // preenchidos só quando o rolo nasce de uma compra (register_inventory_purchase);
  // null para todo rolo criado manualmente ("Novo rolo" no drawer, fluxo
  // inalterado por esse incremento).
  initial_gross_weight_grams: number | null
  purchase_id: string | null
  // Campo DERIVADO, não uma coluna de filament_spools — calculado por
  // listFilamentSpools() a partir de uma segunda consulta de leitura
  // (filament_movements.spool_id para o tipo). Único indicador confiável de
  // "excluir vai falhar" (delete_filament_spool bloqueia exclusivamente por
  // FILAMENT_SPOOL_HAS_MOVEMENTS: — nenhum outro vínculo impeditivo existe
  // para rolos individuais nesta etapa) — usado para decidir Excluir vs.
  // Arquivar ANTES de mostrar a confirmação, nunca a partir do texto de um
  // erro. Respostas de create/update (Edge Function) não trazem este campo;
  // os hooks (useFilamentSpools) o preenchem localmente: false para um rolo
  // recém-criado (nunca teve movimentação), preservado do estado anterior
  // em edições/ativação/descarte, e forçado para true assim que uma
  // movimentação/pesagem é registrada.
  has_movement_history: boolean
}

// supabase/migrations/20260827110000_create_filament_movements_table.sql —
// tabela dedicada, independente de stock_movements (grama é fracionário;
// cada linha referencia tipo E rolo). WEIGHING_ADJUSTMENT só é gravado por
// register_filament_weighing (rota /filament-movements/weighing), nunca
// pela rota de movimentação manual.
export type FilamentMovementType =
  | 'INITIAL_BALANCE'
  | 'PURCHASE'
  | 'RETURN'
  | 'POSITIVE_ADJUSTMENT'
  | 'MANUAL_CONSUMPTION'
  | 'LOSS'
  | 'SAMPLE_TEST'
  | 'NEGATIVE_ADJUSTMENT'
  | 'WEIGHING_ADJUSTMENT'

// Ledger imutável — nunca editado nem excluído pelo frontend.
export interface FilamentMovement {
  id: string
  filament_type_id: string
  spool_id: string
  movement_type: FilamentMovementType
  quantity_delta: number
  balance_before: number
  balance_after: number
  reason: string | null
  reference_type: string | null
  reference_id: string | null
  idempotency_key: string | null
  occurred_at: string
  created_by: string
  created_at: string
}

// public.vw_filament_type_summary (mesma migration de filament_movements) —
// total_available_grams = soma do peso disponível dos rolos ativos e
// utilizáveis (is_active=true, status not in ESGOTADO/DESCARTADO). O nível
// de estoque (normal/baixo/sem estoque) é derivado no frontend com a mesma
// getStockLevel já usada por Acessórios/Embalagens — não vem pronto da view.
export interface FilamentTypeSummary {
  filament_type_id: string
  material: FilamentMaterial
  manufacturer: string
  line: string
  commercial_color: string
  color_code: string | null
  minimum_stock_grams: number | null
  is_active: boolean
  total_available_grams: number
  usable_spool_count: number
  total_spool_count: number
}

// supabase/migrations/20260827113000_create_product_filaments_table.sql —
// preparação de composição (requisito 9), nunca consumida automaticamente
// nesta rodada.
export interface ProductFilament {
  id: string
  product_id: string
  filament_type_id: string
  theoretical_weight_grams: number
  created_at: string
}

export interface ProductAccessory {
  id: string
  product_id: string
  accessory_id: string
  quantity: number
  created_at: string
}

export interface ProductPackaging {
  id: string
  product_id: string
  packaging_id: string
  quantity: number
  created_at: string
}

// supabase/migrations/20260814021751_create_payments_table.sql
export interface Payment {
  id: string
  order_id: string
  payment_method: PaymentMethod
  amount: number
  payment_type: PaymentType
  paid_at: string
  notes: string | null
  created_by: string
  created_at: string
}

// supabase/migrations/20260814023012_create_status_history_tables.sql
export interface OrderStatusHistory {
  id: string
  order_id: string
  // Nullable só no primeiro registro de um pedido (nasce direto em QUOTE,
  // sem "de onde veio").
  from_status: OrderStatus | null
  to_status: OrderStatus
  changed_at: string
  changed_by: string
  reason: string | null
}

export interface PaymentStatusHistory {
  id: string
  order_id: string
  from_status: PaymentStatus | null
  to_status: PaymentStatus
  changed_at: string
  changed_by: string
  reason: string | null
}

// Módulo 3, Incremento 5 (Compras) —
// supabase/migrations/20260828120000_create_inventory_purchases_table.sql.
// category é o discriminador polimórfico de item_id (FILAMENT ->
// filament_types.id; ACCESSORY -> accessories.id; PACKAGING -> packaging.id)
// — mesmo padrão sem FK já usado por StockMovement.item_type/item_id.
export type InventoryPurchaseCategory = 'FILAMENT' | 'ACCESSORY' | 'PACKAGING'

// Ledger financeiro imutável — nunca editado nem excluído pelo frontend.
// total_value é sempre item_value + freight_value (coluna gerada no banco).
export interface InventoryPurchase {
  id: string
  category: InventoryPurchaseCategory
  item_id: string
  quantity: number
  item_value: number
  freight_value: number
  total_value: number
  occurred_at: string
  notes: string | null
  idempotency_key: string | null
  created_by: string
  created_at: string
}
