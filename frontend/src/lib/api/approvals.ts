// Leitura direta via supabase-js: public.approvals e public.custom_versions
// concedem só SELECT a authenticated
// (supabase/migrations/20260814010323_create_custom_item_tables.sql).
// Escrita via Edge Function `order-approvals` (register_approval/
// register_custom_version) — todas as regras cruzadas (CATALOG não aprova,
// SPOT sem versão, autoaprovação etc.) continuam exclusivas das RPCs.

import { supabase } from '@/lib/supabase'
import { mapSupabaseError } from './errors'
import { callEdgeFunction } from './edgeFunctionClient'
import type { Approval, ApprovalType, CustomVersion } from '@/types/domain'

export async function listApprovals(orderItemId: string): Promise<Approval[]> {
  const { data, error } = await supabase
    .from('approvals')
    .select('*')
    .eq('order_item_id', orderItemId)
    .order('approved_at', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as Approval[]
}

export async function listCustomVersions(orderItemId: string): Promise<CustomVersion[]> {
  const { data, error } = await supabase
    .from('custom_versions')
    .select('*')
    .eq('order_item_id', orderItemId)
    .order('created_at', { ascending: true })

  if (error) throw mapSupabaseError(error)
  return data as CustomVersion[]
}

export interface RegisterApprovalInput {
  order_item_id: string
  approval_type: ApprovalType
  approved_at: string
  custom_version_id?: string | null
  approval_evidence_file_id?: string | null
  notes?: string | null
}

// POST /order-approvals/approvals -> register_approval.
export async function registerApproval(input: RegisterApprovalInput): Promise<{ id: string }> {
  return callEdgeFunction<{ id: string }>('order-approvals', '/approvals', 'POST', input)
}

export interface RegisterCustomVersionInput {
  order_item_id: string
  version_number: string
  change_type?: string | null
  change_description?: string | null
  file_id?: string | null
}

// POST /order-approvals/versions -> register_custom_version.
export async function registerCustomVersion(input: RegisterCustomVersionInput): Promise<{ id: string }> {
  return callEdgeFunction<{ id: string }>('order-approvals', '/versions', 'POST', input)
}
