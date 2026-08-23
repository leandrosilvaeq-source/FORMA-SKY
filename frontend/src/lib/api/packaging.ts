// Leitura direta via supabase-js: public.packaging concede SELECT a
// authenticated, com RLS is_active_user()
// (supabase/migrations/20260816150000_create_accessories_packaging_and_composition_tables.sql).
// Escrita (criar/editar/ativar-desativar/excluir): Módulo 3, Incremento 3
// (docs/05_ROADMAP_MODULOS.md §9) — passa a exigir a Edge Function
// `packaging` (supabase/functions/packaging/index.ts). INSERT/UPDATE
// diretos de `authenticated` foram revogados por
// supabase/migrations/20260823120000_create_packaging_write_functions.sql;
// DELETE nunca foi concedido. Nenhum INSERT/UPDATE/DELETE direto acontece
// mais a partir deste arquivo.

import { mapSupabaseError } from './errors'
import { supabase } from '@/lib/supabase'
import { callEdgeFunction } from './edgeFunctionClient'
import type { Packaging } from '@/types/domain'

export async function listPackaging(): Promise<Packaging[]> {
  const { data, error } = await supabase.from('packaging').select('*').order('name', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as Packaging[]
}

// material/unit_cost/current_stock nunca fazem parte deste contrato —
// decisão aprovada em docs/03_MODELO_BANCO_DADOS.md §13.3 (material fora da
// interface; unit_cost somente leitura; current_stock sem edição direta
// nesta etapa). A Edge Function rejeita esses campos explicitamente com 400
// caso sejam enviados mesmo assim.
export interface CreatePackagingInput {
  name: string
  size?: string | null
  variant?: string | null
  minimum_stock?: number | null
  is_active?: boolean | null
}

// Todos os campos opcionais: só as chaves de fato enviadas são alteradas
// (semântica PATCH) — is_active também vive aqui (ativar/desativar não tem
// contrato redundante, ver update_packaging).
export interface UpdatePackagingInput {
  name?: string
  size?: string | null
  variant?: string | null
  minimum_stock?: number | null
  is_active?: boolean
}

// POST /packaging -> create_packaging (supabase/functions/packaging/index.ts).
export async function createPackaging(input: CreatePackagingInput): Promise<Packaging> {
  return callEdgeFunction<Packaging>('packaging', '', 'POST', input)
}

// PATCH /packaging/:id -> update_packaging.
export async function updatePackaging(id: string, input: UpdatePackagingInput): Promise<Packaging> {
  return callEdgeFunction<Packaging>('packaging', `/${id}`, 'PATCH', input)
}

// DELETE /packaging/:id -> delete_packaging (exclusão protegida — bloqueia
// com erro de negócio quando a embalagem está vinculada a um produto via
// product_packaging; nunca remove o vínculo, nunca cascateia).
export async function deletePackaging(id: string): Promise<{ success: true }> {
  return callEdgeFunction<{ success: true }>('packaging', `/${id}`, 'DELETE')
}
