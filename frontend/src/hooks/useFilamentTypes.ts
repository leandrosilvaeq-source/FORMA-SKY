import { useCallback, useEffect, useState } from 'react'
import { PT_BR_COLLATOR } from '@/components/dataTable/sorting'
import {
  createFilamentType,
  deleteFilamentType,
  listFilamentTypeSummaries,
  updateFilamentType,
  type CreateFilamentTypeInput,
  type UpdateFilamentTypeInput,
} from '@/lib/api/filamentTypes'
import { ApiError } from '@/lib/api/errors'
import type { FilamentTypeSummary } from '@/types/domain'

interface UseFilamentTypesResult {
  types: FilamentTypeSummary[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: CreateFilamentTypeInput) => Promise<FilamentTypeSummary>
  update: (id: string, input: UpdateFilamentTypeInput) => Promise<FilamentTypeSummary>
  delete: (id: string) => Promise<void>
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

function sortSummaries(items: FilamentTypeSummary[]): FilamentTypeSummary[] {
  return [...items].sort(
    (a, b) =>
      PT_BR_COLLATOR.compare(a.manufacturer, b.manufacturer) || PT_BR_COLLATOR.compare(a.commercial_color, b.commercial_color),
  )
}

// A listagem principal usa vw_filament_type_summary (material/fabricante/
// linha/cor JÁ acompanhados de total_available_grams/usable_spool_count) em
// vez da tabela filament_types crua — a view é um superconjunto do que a
// interface de listagem precisa (requisito 7), sem exigir um segundo
// fetch/merge para os totais.
export function useFilamentTypes(): UseFilamentTypesResult {
  const [types, setTypes] = useState<FilamentTypeSummary[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listFilamentTypeSummaries()
      .then((data) => {
        if (cancelled) return
        setTypes(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toApiError(err))
      })
      .finally(() => {
        if (!cancelled) setResolvedRequestId(requestId)
      })

    return () => {
      cancelled = true
    }
  }, [requestId])

  const refetch = useCallback(() => setRequestId((id) => id + 1), [])

  // create_filament_type devolve a linha crua (FilamentType, sem os
  // agregados) — um tipo recém-criado nunca tem rolo ainda, então os
  // totais são sinteticamente zero (nunca uma suposição arriscada: é
  // exatamente o estado real de um tipo sem nenhum rolo vinculado).
  const create = useCallback(async (input: CreateFilamentTypeInput) => {
    const created = await createFilamentType(input)
    const summary: FilamentTypeSummary = {
      filament_type_id: created.id,
      material: created.material,
      manufacturer: created.manufacturer,
      line: created.line,
      commercial_color: created.commercial_color,
      color_code: created.color_code,
      minimum_stock_grams: created.minimum_stock_grams,
      is_active: created.is_active,
      total_available_grams: 0,
      usable_spool_count: 0,
      total_spool_count: 0,
    }
    setTypes((current) => sortSummaries([...current, summary]))
    return summary
  }, [])

  // update_filament_type só altera campos de cadastro do tipo — nunca
  // total_available_grams/usable_spool_count/total_spool_count (que
  // dependem só dos rolos, não tocados por esta função) — por isso o merge
  // preserva os totais já carregados, sem refetch.
  const update = useCallback(async (id: string, input: UpdateFilamentTypeInput) => {
    const updated = await updateFilamentType(id, input)
    let mergedSummary: FilamentTypeSummary | undefined
    setTypes((current) =>
      sortSummaries(
        current.map((item) => {
          if (item.filament_type_id !== id) return item
          mergedSummary = {
            ...item,
            material: updated.material,
            manufacturer: updated.manufacturer,
            line: updated.line,
            commercial_color: updated.commercial_color,
            color_code: updated.color_code,
            minimum_stock_grams: updated.minimum_stock_grams,
            is_active: updated.is_active,
          }
          return mergedSummary
        }),
      ),
    )
    return mergedSummary as FilamentTypeSummary
  }, [])

  const deleteItem = useCallback(async (id: string) => {
    await deleteFilamentType(id)
    setTypes((current) => current.filter((item) => item.filament_type_id !== id))
  }, [])

  return { types, isLoading, error, refetch, create, update, delete: deleteItem }
}
