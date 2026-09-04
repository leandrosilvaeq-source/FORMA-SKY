import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
const { callEdgeFunctionMock } = vi.hoisted(() => ({ callEdgeFunctionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./edgeFunctionClient', () => ({ callEdgeFunction: callEdgeFunctionMock }))

import {
  createFilamentSpool,
  deleteFilamentSpool,
  listAvailableSpoolCountsByType,
  listFilamentSpools,
  updateFilamentSpool,
} from './filamentSpools'

interface QueryResult {
  data: unknown
  error: unknown
}

function chainableResult(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.in = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.then = (onFulfilled: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(onFulfilled)
  return builder
}

// listFilamentSpools agora faz DUAS consultas em paralelo: filament_spools
// (dados dos rolos) e filament_movements (só spool_id, para calcular
// has_movement_history sem depender de texto de erro — ver comentário em
// filamentSpools.ts). Este helper roteia fromMock conforme a tabela pedida.
function mockTables(spoolsResult: QueryResult, movementsResult: QueryResult) {
  fromMock.mockImplementation((table: string) => {
    if (table === 'filament_spools') return chainableResult(spoolsResult)
    if (table === 'filament_movements') return chainableResult(movementsResult)
    throw new Error(`tabela inesperada: ${table}`)
  })
}

describe('filamentSpools api', () => {
  beforeEach(() => {
    fromMock.mockReset()
    callEdgeFunctionMock.mockReset()
  })

  it('listFilamentSpools consulta filament_spools filtrado por filament_type_id e filament_movements para o mesmo tipo', async () => {
    mockTables(
      {
        data: [
          { id: 's1', code: 'RL-26-001' },
          { id: 's2', code: 'RL-26-002' },
        ],
        error: null,
      },
      { data: [{ spool_id: 's1' }], error: null },
    )

    const result = await listFilamentSpools('t1')

    expect(fromMock).toHaveBeenCalledWith('filament_spools')
    expect(fromMock).toHaveBeenCalledWith('filament_movements')
    expect(callEdgeFunctionMock).not.toHaveBeenCalled()
    expect(result).toEqual([
      { id: 's1', code: 'RL-26-001', has_movement_history: true, purchase_item_manufacturer: null },
      {
        id: 's2',
        code: 'RL-26-002',
        has_movement_history: false,
        purchase_item_manufacturer: null,
      },
    ])
  })

  it('listFilamentSpools: Marca (purchase_item_manufacturer) vem do JOIN embutido, numa ÚNICA consulta extra em filament_spools (nunca uma consulta por rolo — N+1)', async () => {
    mockTables(
      {
        data: [
          {
            id: 's1',
            code: 'RL-26-001',
            purchase_item_id: 'pi1',
            inventory_purchase_filament_items: { manufacturer: 'Bambu Lab' },
          },
          {
            id: 's2',
            code: 'RL-26-002',
            purchase_item_id: 'pi2',
            inventory_purchase_filament_items: { manufacturer: '  Voolt  ' },
          },
          {
            id: 's3',
            code: 'RL-26-003',
            purchase_item_id: null,
            inventory_purchase_filament_items: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    )

    const result = await listFilamentSpools(['t1', 't2', 't3'])

    // Exatamente 2 chamadas no total (filament_spools + filament_movements),
    // independente de quantos rolos existam — o JOIN viaja dentro da MESMA
    // consulta de filament_spools, nunca uma consulta adicional por linha.
    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(result.find((s) => s.id === 's1')?.purchase_item_manufacturer).toBe('Bambu Lab')
    // Espaços de borda do valor bruto são aparados.
    expect(result.find((s) => s.id === 's2')?.purchase_item_manufacturer).toBe('Voolt')
    // Sem purchase_item_id (rolo do fluxo antigo) -> null, nunca undefined.
    expect(result.find((s) => s.id === 's3')?.purchase_item_manufacturer).toBeNull()
    // O objeto embutido nunca vaza para o resultado final.
    expect(result[0]).not.toHaveProperty('inventory_purchase_filament_items')
  })

  it('listFilamentSpools: rolo sem nenhuma movimentação tem has_movement_history=false, nunca undefined', async () => {
    mockTables({ data: [{ id: 's1', code: 'RL-26-001' }], error: null }, { data: [], error: null })

    const result = await listFilamentSpools('t1')

    expect(result[0].has_movement_history).toBe(false)
  })

  it('listAvailableSpoolCountsByType: uma única consulta .in em filament_spools (sem filament_movements), aplica a regra saldo > 0', async () => {
    const builder = chainableResult({
      data: [
        {
          id: 's1',
          filament_type_id: 't1',
          current_net_weight_grams: 100,
          status: 'ABERTO',
          is_active: true,
        },
        {
          id: 's2',
          filament_type_id: 't1',
          current_net_weight_grams: 1000,
          status: 'LACRADO',
          is_active: true,
        },
        {
          id: 's3',
          filament_type_id: 't1',
          current_net_weight_grams: 0,
          status: 'ABERTO',
          is_active: true,
        },
        {
          id: 's4',
          filament_type_id: 't2',
          current_net_weight_grams: 250,
          status: 'ABERTO',
          is_active: true,
        },
        {
          id: 's5',
          filament_type_id: 't2',
          current_net_weight_grams: 500,
          status: 'DESCARTADO',
          is_active: true,
        },
        {
          id: 's6',
          filament_type_id: 't2',
          current_net_weight_grams: 500,
          status: 'ABERTO',
          is_active: false,
        },
      ],
      error: null,
    })
    fromMock.mockImplementation((table: string) => {
      if (table === 'filament_spools') return builder
      throw new Error(`tabela inesperada: ${table}`)
    })

    const counts = await listAvailableSpoolCountsByType(['t1', 't2'])

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('filament_spools')
    expect(builder.in).toHaveBeenCalledWith('filament_type_id', ['t1', 't2'])
    expect(builder.select).toHaveBeenCalledWith(
      'id, filament_type_id, current_net_weight_grams, status, is_active',
    )
    expect(counts.get('t1')).toBe(2)
    expect(counts.get('t2')).toBe(1)
  })

  it('listAvailableSpoolCountsByType: lista vazia não consulta nada', async () => {
    const counts = await listAvailableSpoolCountsByType([])
    expect(counts.size).toBe(0)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('listAvailableSpoolCountsByType: erro na consulta propaga ApiError (nunca devolve contagem parcial silenciosa)', async () => {
    const { ApiError } = await import('./errors')
    fromMock.mockImplementation(() =>
      chainableResult({ data: null, error: { message: 'falhou', code: '500' } }),
    )
    await expect(listAvailableSpoolCountsByType(['t1'])).rejects.toBeInstanceOf(ApiError)
  })

  it('listFilamentSpools aceita vários filament_type_id (grupo consolidado) numa única consulta com .in', async () => {
    const spoolsBuilder = chainableResult({
      data: [
        { id: 's1', code: 'RL-26-001', filament_type_id: 't1' },
        { id: 's2', code: 'RL-26-002', filament_type_id: 't2' },
      ],
      error: null,
    })
    const movementsBuilder = chainableResult({ data: [{ spool_id: 's2' }], error: null })
    fromMock.mockImplementation((table: string) => {
      if (table === 'filament_spools') return spoolsBuilder
      if (table === 'filament_movements') return movementsBuilder
      throw new Error(`tabela inesperada: ${table}`)
    })

    const result = await listFilamentSpools(['t1', 't2'])

    expect(spoolsBuilder.in).toHaveBeenCalledWith('filament_type_id', ['t1', 't2'])
    expect(movementsBuilder.in).toHaveBeenCalledWith('filament_type_id', ['t1', 't2'])
    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(result.map((spool) => spool.id)).toEqual(['s1', 's2'])
    expect(result.find((spool) => spool.id === 's2')?.has_movement_history).toBe(true)
  })

  it('listFilamentSpools com lista vazia não consulta nada', async () => {
    const result = await listFilamentSpools([])
    expect(result).toEqual([])
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('listFilamentSpools propaga erro de qualquer uma das duas consultas', async () => {
    const { ApiError } = await import('./errors')
    fromMock.mockImplementation((table: string) => {
      if (table === 'filament_spools')
        return chainableResult({ data: null, error: { message: 'falhou', code: '500' } })
      return chainableResult({ data: [], error: null })
    })

    await expect(listFilamentSpools('t1')).rejects.toBeInstanceOf(ApiError)
  })

  it('createFilamentSpool writes through the filament-spools Edge Function, not a direct insert', async () => {
    const created = {
      id: 's1',
      code: 'RL-26-001',
      filament_type_id: 't1',
      nominal_weight_grams: 1000,
    }
    callEdgeFunctionMock.mockResolvedValue(created)

    const result = await createFilamentSpool({ filament_type_id: 't1', nominal_weight_grams: 1000 })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-spools', '', 'POST', {
      filament_type_id: 't1',
      nominal_weight_grams: 1000,
    })
    expect(fromMock).not.toHaveBeenCalled()
    // A resposta crua NUNCA inclui has_movement_history — quem preenche
    // esse campo é o hook (useFilamentSpools.create), não a API layer.
    expect(result).toEqual(created)
    expect(result).not.toHaveProperty('has_movement_history')
  })

  it('updateFilamentSpool writes through the filament-spools Edge Function with PATCH', async () => {
    const updated = { id: 's1', status: 'ABERTO' }
    callEdgeFunctionMock.mockResolvedValue(updated)

    const result = await updateFilamentSpool('s1', { status: 'ABERTO' })

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-spools', '/s1', 'PATCH', {
      status: 'ABERTO',
    })
    expect(result).toEqual(updated)
  })

  it('deleteFilamentSpool calls the filament-spools Edge Function with DELETE', async () => {
    callEdgeFunctionMock.mockResolvedValue({ success: true })

    const result = await deleteFilamentSpool('s1')

    expect(callEdgeFunctionMock).toHaveBeenCalledWith('filament-spools', '/s1', 'DELETE')
    expect(result).toEqual({ success: true })
  })

  it('deleteFilamentSpool propagates a standardized ApiError when blocked by movement history (defesa em profundidade — a interface não deveria mais chamar isto para um rolo com histórico)', async () => {
    const { ApiError } = await import('./errors')
    callEdgeFunctionMock.mockRejectedValue(
      new ApiError(
        'business_rule',
        409,
        'Este rolo possui movimentações registradas e não pode ser excluído.',
      ),
    )

    await expect(deleteFilamentSpool('s1')).rejects.toMatchObject({
      type: 'business_rule',
      status: 409,
    })
  })
})
