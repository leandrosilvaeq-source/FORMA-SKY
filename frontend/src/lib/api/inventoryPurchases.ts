// Escrita: Edge Function `inventory-purchases` (publicada e operacional) ->
// RPC register_inventory_purchase
// (supabase/migrations/20260828121000_create_register_inventory_purchase_function.sql,
// 20260904120000_add_filament_type_id_to_purchase.sql). Sem leitura própria
// nesta rodada — nenhuma tela de histórico de compras ainda; a listagem de
// destino (Filamentos/Acessórios/Embalagens) é atualizada via o refetch de
// cada área depois de uma compra concluída.

import { callEdgeFunction } from './edgeFunctionClient'
import type { InventoryPurchase, InventoryPurchaseCategory } from '@/types/domain'

interface RegisterAccessoryOrPackagingPurchaseInput {
  category: Extract<InventoryPurchaseCategory, 'ACCESSORY' | 'PACKAGING'>
  quantity: number
  item_value: number
  freight_value?: number
  occurred_at?: string
  notes?: string | null
  idempotency_key?: string
  item_id: string
}

// Compra de filamento (2026-09-04): a interface escolhe um filament_type_id
// já cadastrado em Estoque -> Filamentos (fluxo "Cadastrar tipo -> Registrar
// compra -> Rolos atualizados") — nunca cria nem localiza tipo por
// material/fabricante/linha/cor. O caminho legado (find-or-create por nome)
// continua existindo na RPC/Edge Function para compatibilidade com
// registros antigos, mas este cliente nunca mais o utiliza.
interface RegisterFilamentPurchaseInput {
  category: Extract<InventoryPurchaseCategory, 'FILAMENT'>
  quantity: number
  item_value: number
  freight_value?: number
  occurred_at?: string
  notes?: string | null
  idempotency_key?: string
  filament_type_id: string
  nominal_weight_grams: number
  // Um peso bruto por rolo, na mesma ordem — comprimento deve ser
  // exatamente `quantity`.
  gross_weights_grams: number[]
}

export type RegisterInventoryPurchaseInput =
  RegisterAccessoryOrPackagingPurchaseInput | RegisterFilamentPurchaseInput

// POST /inventory-purchases -> register_inventory_purchase. Operação única
// e transacional: para FILAMENT, localiza/cria o tipo e cria N rolos +
// movimentos de entrada; para ACCESSORY/PACKAGING, registra o movimento de
// entrada no item já cadastrado. O chamador decide o que refazer/exibir a
// partir da resposta (a compra registrada) — nenhum dado de rolo/tipo
// individual é devolvido aqui; a tela chamadora reaproveita o refetch já
// existente de cada área (useFilamentTypes/useAccessories/usePackaging).
export async function registerInventoryPurchase(
  input: RegisterInventoryPurchaseInput,
): Promise<InventoryPurchase> {
  return callEdgeFunction<InventoryPurchase>('inventory-purchases', '', 'POST', input)
}
