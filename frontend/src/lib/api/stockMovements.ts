// Leitura direta via supabase-js: public.stock_movements concede só SELECT
// a authenticated, com RLS is_active_user()
// (supabase/migrations/20260827090000_create_stock_movements_table.sql) —
// mesmo padrão de order_status_history/payment_status_history
// (frontend/src/lib/api/orderHistory.ts). Escrita: Módulo 3, Incremento 2
// — via Edge Function `stock-movements` (register_stock_movement). Nenhum
// INSERT/UPDATE/DELETE direto acontece a partir deste arquivo — a tabela é
// um ledger imutável, e não há rota de escrita concedida a `authenticated`
// para ela em nenhuma migration.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import { callEdgeFunction } from './edgeFunctionClient'
import type { StockItemType, StockMovement, StockMovementType } from '@/types/domain'

// Limite inicial de registros por item para o histórico "recente" exibido
// no painel de movimentação — o MVP (Incremento 2/3) não implementa
// paginação real. Documentado como pendência futura em
// docs/05_ROADMAP_MODULOS.md: se um item acumular mais movimentações do que
// isso, as mais antigas deixam de aparecer aqui (nunca são apagadas do
// banco — o ledger continua completo, só esta consulta é limitada).
const HISTORY_PAGE_SIZE = 50

// Mais recente primeiro: occurred_at é a chave primária de ordenação (data
// "de negócio" do evento, pode ser retroativa); created_at desempata quando
// duas movimentações têm o mesmo occurred_at — mesmo raciocínio de desempate
// determinístico já usado em OrderManagementPanel.tsx (buildHistoryRows).
// Não recalcula nenhum saldo aqui — balance_before/balance_after já vêm
// prontos de cada linha, exatamente como a RPC os gravou.
export async function listStockMovements(itemType: StockItemType, itemId: string): Promise<StockMovement[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('item_type', itemType)
    .eq('item_id', itemId)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(HISTORY_PAGE_SIZE)

  if (error) throw mapSupabaseError(error)
  return data as StockMovement[]
}

export interface RegisterStockMovementInput {
  item_type: StockItemType
  item_id: string
  movement_type: StockMovementType
  // Sempre uma quantidade positiva — o sinal é resolvido pelo backend a
  // partir de movement_type (mesmo contrato de register_stock_movement()).
  quantity: number
  reason?: string | null
  reference_type?: string | null
  reference_id?: string | null
  occurred_at?: string | null
  idempotency_key?: string | null
}

// POST /stock-movements -> register_stock_movement. O retorno já é a
// movimentação completa gravada — balance_after é o novo saldo do item, não
// é preciso nenhuma consulta adicional só para descobri-lo.
export async function registerStockMovement(input: RegisterStockMovementInput): Promise<StockMovement> {
  return callEdgeFunction<StockMovement>('stock-movements', '', 'POST', input)
}
