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
  category: string | null
  description: string | null
  default_price: number
  default_print_time_minutes: number | null
  default_weight_grams: number | null
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

// supabase/migrations/20260814040037_create_order_summary_views.sql (vw_order_summary)
export interface OrderSummary {
  order_id: string
  order_number: string
  customer_id: string
  company_id: string | null
  order_status: OrderStatus
  payment_status: PaymentStatus
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
