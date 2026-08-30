import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))

import { listProductFilaments } from './productFilaments'

interface QueryResult {
  data: unknown
  error: unknown
}

function chainableResult(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled)
  return builder
}

// Somente leitura desde a limpeza de código órfão de 2026-08-29 —
// updateProductFilaments (escrita via PATCH /products/:id/filaments) foi
// removida junto com o diálogo que era seu único consumidor
// (FilamentCompositionForm.tsx, já removido numa rodada anterior); a RPC
// que ela chamava também perde o EXECUTE de service_role na migration
// pendente. Nenhuma cobertura de comportamento operacional foi perdida —
// o teste removido só provava uma chamada de rota que não tinha mais
// nenhum chamador real.
describe('productFilaments api', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('listProductFilaments reads product_filaments filtered by product_id', async () => {
    const rows = [{ id: '1', product_id: 'p1', filament_type_id: 'ft1', theoretical_weight_grams: 12.5, created_at: '' }]
    const builder = chainableResult({ data: rows, error: null })
    fromMock.mockReturnValue(builder)

    const result = await listProductFilaments('p1')

    expect(fromMock).toHaveBeenCalledWith('product_filaments')
    expect(builder.eq).toHaveBeenCalledWith('product_id', 'p1')
    expect(result).toEqual(rows)
  })
})
