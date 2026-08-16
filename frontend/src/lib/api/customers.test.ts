import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './errors'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock },
}))

import { createCustomer, listCustomers, updateCustomer } from './customers'

interface QueryResult {
  data: unknown
  error: unknown
}

// Mock mínimo do query builder encadeável do supabase-js: cada método
// filtra/transforma e retorna `this`; `single()` e `then()` resolvem para o
// resultado configurado (representa o `await` no fim da chain real).
function chainableResult(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.insert = vi.fn(chain)
  builder.update = vi.fn(chain)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled)
  return builder
}

describe('customers api', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('listCustomers reads directly from supabase-js, ordered by name', async () => {
    const rows = [{ id: '1', name: 'Ana' }]
    fromMock.mockReturnValue(chainableResult({ data: rows, error: null }))

    const result = await listCustomers()

    expect(fromMock).toHaveBeenCalledWith('customers')
    expect(result).toEqual(rows)
  })

  it('listCustomers throws an ApiError on failure', async () => {
    fromMock.mockReturnValue(
      chainableResult({ data: null, error: { code: '42501', message: 'permission denied' } }),
    )

    await expect(listCustomers()).rejects.toBeInstanceOf(ApiError)
  })

  it('createCustomer inserts and returns the created row', async () => {
    const created = { id: '2', name: 'Novo Cliente' }
    const builder = chainableResult({ data: created, error: null })
    fromMock.mockReturnValue(builder)

    const result = await createCustomer({ name: 'Novo Cliente' })

    expect(builder.insert).toHaveBeenCalledWith({ name: 'Novo Cliente' })
    expect(result).toEqual(created)
  })

  it('updateCustomer updates the row by id', async () => {
    const updated = { id: '3', name: 'Atualizado' }
    const builder = chainableResult({ data: updated, error: null })
    fromMock.mockReturnValue(builder)

    const result = await updateCustomer('3', { name: 'Atualizado' })

    expect(builder.update).toHaveBeenCalledWith({ name: 'Atualizado' })
    expect(builder.eq).toHaveBeenCalledWith('id', '3')
    expect(result).toEqual(updated)
  })
})
