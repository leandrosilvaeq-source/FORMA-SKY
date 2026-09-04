// Escrita: Edge Function `inventory-purchases` (publicada e operacional) ->
// RPC register_inventory_purchase (ACCESSORY/PACKAGING) OU
// register_filament_purchase (FILAMENT, rota /filament — ver abaixo)
// (supabase/migrations/20260828121000_create_register_inventory_purchase_function.sql,
// 20260904120000_add_filament_type_id_to_purchase.sql,
// 20260904130000_support_multi_item_filament_purchases.sql,
// 20260904140000_add_purchase_channel_to_filament_purchases.sql). Sem
// leitura própria nesta rodada — nenhuma tela de histórico de compras ainda;
// a listagem de destino (Filamentos/Acessórios/Embalagens) é atualizada via
// o refetch de cada área depois de uma compra concluída.

import { callEdgeFunction } from './edgeFunctionClient'
import type { InventoryPurchase, InventoryPurchaseCategory } from '@/types/domain'

// registerInventoryPurchase cobre só ACCESSORY/PACKAGING a partir desta
// rodada (2026-09-04) — a janela "Compra de filamentos" nunca mais chama
// esta função (ver registerFilamentPurchase abaixo). O caminho de item único
// de FILAMENT continua existindo na RPC/Edge Function (register_inventory_purchase,
// rota base) só para compatibilidade com qualquer chamador antigo — este
// cliente não o expõe mais.
export interface RegisterInventoryPurchaseInput {
  category: Extract<InventoryPurchaseCategory, 'ACCESSORY' | 'PACKAGING'>
  quantity: number
  item_value: number
  freight_value?: number
  occurred_at?: string
  notes?: string | null
  idempotency_key?: string
  item_id: string
}

// POST /inventory-purchases -> register_inventory_purchase. Operação única e
// transacional: registra o movimento de entrada no item (Acessório/
// Embalagem) já cadastrado. O chamador decide o que refazer/exibir a partir
// da resposta (a compra registrada) — a tela chamadora reaproveita o refetch
// já existente de cada área (useAccessories/usePackaging).
export async function registerInventoryPurchase(
  input: RegisterInventoryPurchaseInput,
): Promise<InventoryPurchase> {
  return callEdgeFunction<InventoryPurchase>('inventory-purchases', '', 'POST', input)
}

// Local/canal onde a compra foi feita (2026-09-04, "Local da compra" — janela
// compacta) — obrigatório, fechado aos 6 valores oficiais (validado de novo
// no backend, register_filament_purchase, migrations
// 20260904140000_add_purchase_channel_to_filament_purchases.sql e
// 20260904150000_add_site_outro_purchase_channels.sql, que acrescentou
// SITE/OUTRO). Gravado no cabeçalho (inventory_purchases.purchase_channel),
// nunca em notes. Sem campo de texto livre adicional para "Outro".
export type PurchaseChannel =
  'MERCADO_LIVRE' | 'ALIEXPRESS' | 'SHOPEE' | 'PRESENCIAL' | 'SITE' | 'OUTRO'

// Compra de filamento com UM OU MAIS itens na mesma compra (2026-09-04,
// janela "Compra de filamentos" reestruturada) — cada item escolhe um
// filament_type_id já cadastrado em Estoque -> Filamentos (nunca cria nem
// localiza tipo por material/fabricante/linha/cor), a marca (manufacturer)
// comprada NESTE item (distinta do fabricante interno do tipo, que
// permanece sempre "Não informado"), o peso líquido de cada rolo, a
// quantidade de rolos e o valor unitário. O frete é único por compra
// (freight_value), nunca dividido entre itens/rolos. Sem peso bruto
// individual por rolo nesta janela.
export interface RegisterFilamentPurchaseItemInput {
  filament_type_id: string
  manufacturer: string
  nominal_weight_grams: number
  quantity: number
  unit_value: number
}

export interface RegisterFilamentPurchaseInput {
  freight_value?: number
  occurred_at?: string
  notes?: string | null
  idempotency_key?: string
  items: RegisterFilamentPurchaseItemInput[]
  // Obrigatório (2026-09-04) — a interface sempre envia um dos 6 valores
  // oficiais.
  purchase_channel: PurchaseChannel
}

export interface FilamentPurchaseResultItem {
  item_id: string
  filament_type_id: string
  manufacturer: string
  nominal_weight_grams: number
  quantity: number
  unit_value: number
  item_value: number
  spool_ids: string[]
}

// Resposta de register_filament_purchase: um único cabeçalho (purchase_id) +
// os itens realmente gravados, cada um com os rolos que criou — permite, no
// futuro, uma tela de histórico/detalhe de compra mostrar frete/subtotal/
// total/itens/rolos sem precisar de uma segunda leitura. Nenhuma tela deste
// tipo existe ainda nesta rodada (mesma ausência já registrada para
// inventory_purchases desde o Incremento 5); o chamador atual só usa esta
// resposta para confirmar sucesso, o refetch de useFilamentTypes cobre a
// atualização da interface.
export interface FilamentPurchaseResult {
  purchase_id: string
  occurred_at: string
  notes: string | null
  purchase_channel: PurchaseChannel | null
  freight_value: number
  subtotal_value: number
  total_value: number
  created_at: string
  items: FilamentPurchaseResultItem[]
}

// POST /inventory-purchases/filament -> register_filament_purchase. Uma
// única transação: cria o cabeçalho, cada item e todos os rolos
// correspondentes — falha em qualquer ponto reverte tudo (nunca uma compra
// parcial).
export async function registerFilamentPurchase(
  input: RegisterFilamentPurchaseInput,
): Promise<FilamentPurchaseResult> {
  return callEdgeFunction<FilamentPurchaseResult>('inventory-purchases', '/filament', 'POST', input)
}
