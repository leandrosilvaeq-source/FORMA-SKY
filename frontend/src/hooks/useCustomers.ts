import { useCallback, useEffect, useState } from 'react'
import {
  createCustomer,
  deleteCustomer,
  listCustomers,
  updateCustomer,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from '@/lib/api/customers'
import { ApiError } from '@/lib/api/errors'
import type { Customer } from '@/types/domain'

interface UseCustomersResult {
  customers: Customer[]
  isLoading: boolean
  error: ApiError | null
  refetch: () => void
  create: (input: CreateCustomerInput) => Promise<Customer>
  update: (id: string, input: UpdateCustomerInput) => Promise<Customer>
  remove: (id: string) => Promise<void>
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

function byName(a: Customer, b: Customer): number {
  return a.name.localeCompare(b.name)
}

export function useCustomers(): UseCustomersResult {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId, setRequestId] = useState(0)
  const [resolvedRequestId, setResolvedRequestId] = useState(-1)

  // isLoading é derivado da comparação entre a requisição em andamento e a
  // última resolvida — nenhum setState síncrono no corpo do efeito (todos
  // os setState abaixo rodam dentro de callbacks de then/catch/finally).
  const isLoading = resolvedRequestId !== requestId

  useEffect(() => {
    let cancelled = false

    listCustomers()
      .then((data) => {
        if (cancelled) return
        setCustomers(data)
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

  const create = useCallback(async (input: CreateCustomerInput) => {
    const created = await createCustomer(input)
    setCustomers((current) => [...current, created].sort(byName))
    return created
  }, [])

  const update = useCallback(async (id: string, input: UpdateCustomerInput) => {
    const updated = await updateCustomer(id, input)
    setCustomers((current) => current.map((customer) => (customer.id === id ? updated : customer)).sort(byName))
    return updated
  }, [])

  // Exclusão física (2026-08-29) — remove do estado local em vez de refazer
  // a listagem inteira (delete_customer não devolve nenhuma linha; a
  // ausência do id já é toda a informação necessária).
  const remove = useCallback(async (id: string) => {
    await deleteCustomer(id)
    setCustomers((current) => current.filter((customer) => customer.id !== id))
  }, [])

  return { customers, isLoading, error, refetch, create, update, remove }
}
