import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))

import { listPackaging } from './packaging'

interface QueryResult {
  data: unknown
  error: unknown
}

function chainableResult(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled)
  return builder
}

describe('packaging api', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('listPackaging reads directly from supabase-js', async () => {
    const rows = [{ id: '1', name: 'Caixa M' }]
    fromMock.mockReturnValue(chainableResult({ data: rows, error: null }))

    const result = await listPackaging()

    expect(fromMock).toHaveBeenCalledWith('packaging')
    expect(result).toEqual(rows)
  })
})
