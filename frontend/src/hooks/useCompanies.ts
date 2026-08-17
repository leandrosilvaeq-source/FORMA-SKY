import { useCallback, useEffect, useState } from 'react'
import {
  createCompany,
  listCompanies,
  updateCompany,
  type CreateCompanyInput,
  type UpdateCompanyInput,
} from '@/lib/api/companies'
import { ApiError } from '@/lib/api/errors'
import type { Company } from '@/types/domain'

interface UseCompaniesResult {
  companies: Company[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: CreateCompanyInput) => Promise<Company>
  update: (id: string, input: UpdateCompanyInput) => Promise<Company>
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

function byName(a: Company, b: Company): number {
  return a.name.localeCompare(b.name)
}

export function useCompanies(): UseCompaniesResult {
  const [companies, setCompanies] = useState<Company[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  // isLoading é derivado da comparação entre a requisição em andamento e a
  // última resolvida — nenhum setState síncrono no corpo do efeito (todos
  // os setState abaixo rodam dentro de callbacks de then/catch/finally).
  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listCompanies()
      .then((data) => {
        if (cancelled) return
        setCompanies(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(toApiError(err))
      })
      .finally(() => {
        if (!cancelled) setResolvedRequestId(requestId)
      })

    return () => {
      cancelled = true
    }
  }, [requestId])

  const refetch = useCallback(() => setRequestId((id) => id + 1), [])

  const create = useCallback(async (input: CreateCompanyInput) => {
    const created = await createCompany(input)
    setCompanies((current) => [...current, created].sort(byName))
    return created
  }, [])

  const update = useCallback(async (id: string, input: UpdateCompanyInput) => {
    const updated = await updateCompany(id, input)
    setCompanies((current) => current.map((company) => (company.id === id ? updated : company)).sort(byName))
    return updated
  }, [])

  return { companies, isLoading, error, refetch, create, update }
}
