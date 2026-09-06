// Leitura direta via supabase-js: public.accessories concede SELECT a
// authenticated, com RLS is_active_user()
// (supabase/migrations/20260816150000_create_accessories_packaging_and_composition_tables.sql).
// Escrita (criar/editar/ativar-desativar/excluir): Módulo 3, Incremento 2
// (docs/05_ROADMAP_MODULOS.md §9) — passa a exigir a Edge Function
// `accessories` (supabase/functions/accessories/index.ts). INSERT/UPDATE
// diretos de `authenticated` foram revogados por
// supabase/migrations/20260822120000_create_accessory_write_functions.sql;
// DELETE nunca foi concedido. Nenhum INSERT/UPDATE/DELETE direto acontece
// mais a partir deste arquivo.

import { mapSupabaseError } from './errors'
import { supabase } from '@/lib/supabase'
import { callEdgeFunction } from './edgeFunctionClient'
import type { Accessory } from '@/types/domain'

export async function listAccessories(): Promise<Accessory[]> {
  const { data, error } = await supabase.from('accessories').select('*').order('name', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as Accessory[]
}

// Releitura pontual só do saldo materializado de UM acessório — usada pelo
// ajuste por quantidade absoluta (AccessoryStockAdjustDialog) logo antes de
// enviar a movimentação, para recalcular a diferença sobre o valor mais
// recente e estreitar a janela de corrida com uma alteração concorrente de
// outro usuário. Leitura direta (SELECT já concedido a authenticated, RLS
// is_active_user()), nunca uma escrita.
export async function getAccessoryCurrentStock(id: string): Promise<number> {
  const { data, error } = await supabase
    .from('accessories')
    .select('current_stock')
    .eq('id', id)
    .single()

  if (error) throw mapSupabaseError(error)
  return (data as { current_stock: number }).current_stock
}

// material/unit_cost/current_stock nunca fazem parte deste contrato —
// decisão aprovada em docs/03_MODELO_BANCO_DADOS.md §13.3 (material fora da
// interface; unit_cost somente leitura; current_stock sem edição direta
// nesta etapa). A Edge Function rejeita esses campos explicitamente com 400
// caso sejam enviados mesmo assim.
export interface CreateAccessoryInput {
  name: string
  size?: string | null
  variant?: string | null
  minimum_stock?: number | null
  is_active?: boolean | null
}

// Todos os campos opcionais: só as chaves de fato enviadas são alteradas
// (semântica PATCH) — is_active também vive aqui (ativar/desativar não tem
// contrato redundante, ver update_accessory).
export interface UpdateAccessoryInput {
  name?: string
  size?: string | null
  variant?: string | null
  minimum_stock?: number | null
  is_active?: boolean
}

// POST /accessories -> create_accessory (supabase/functions/accessories/index.ts).
export async function createAccessory(input: CreateAccessoryInput): Promise<Accessory> {
  return callEdgeFunction<Accessory>('accessories', '', 'POST', input)
}

// PATCH /accessories/:id -> update_accessory.
export async function updateAccessory(id: string, input: UpdateAccessoryInput): Promise<Accessory> {
  return callEdgeFunction<Accessory>('accessories', `/${id}`, 'PATCH', input)
}

// DELETE /accessories/:id -> delete_accessory (exclusão protegida — bloqueia
// com erro de negócio quando o acessório está vinculado a um produto via
// product_accessories; nunca remove o vínculo, nunca cascateia).
export async function deleteAccessory(id: string): Promise<{ success: true }> {
  return callEdgeFunction<{ success: true }>('accessories', `/${id}`, 'DELETE')
}
