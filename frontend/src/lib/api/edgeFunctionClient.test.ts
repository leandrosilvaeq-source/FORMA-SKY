import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: getSessionMock } },
}))

import { callEdgeFunction } from './edgeFunctionClient'

function jsonResponse(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

describe('callEdgeFunction', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getSessionMock.mockReset()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws an authorization ApiError when there is no session, without calling fetch', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })

    await expect(callEdgeFunction('orders', '', 'POST', {})).rejects.toMatchObject({
      type: 'authorization',
      status: 401,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the user JWT and the publishable key, never a secret', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'user-jwt' } } })
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: '1' } }, 201))

    await callEdgeFunction('orders', '', 'POST', { customer_id: 'c1' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://test-project.supabase.co/functions/v1/orders')
    expect(init.method).toBe('POST')

    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer user-jwt')
    expect(headers.apikey).toBe('test-publishable-key')
    expect(headers.apikey).not.toMatch(/secret/i)
    expect(JSON.stringify(headers)).not.toMatch(/service_role/i)
    expect(init.body).toBe(JSON.stringify({ customer_id: 'c1' }))
  })

  it('builds the URL with the given path (e.g. /:id/price)', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'user-jwt' } } })
    fetchMock.mockResolvedValue(jsonResponse({ data: { price_history_id: 'ph1' } }, 200))

    await callEdgeFunction('products', '/prod-1/price', 'PATCH', { new_price: 20 })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://test-project.supabase.co/functions/v1/products/prod-1/price')
  })

  it('omits the body when none is given (e.g. DELETE)', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'user-jwt' } } })
    fetchMock.mockResolvedValue(jsonResponse({ data: { success: true } }, 200))

    await callEdgeFunction('order-items', '/item-1', 'DELETE')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBeUndefined()
  })

  it('returns data on success', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'user-jwt' } } })
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: '42' } }, 201))

    const result = await callEdgeFunction<{ id: string }>('products', '', 'POST', {})

    expect(result).toEqual({ id: '42' })
  })

  it('throws an ApiError with the type/status/message from the error envelope', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'user-jwt' } } })
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { type: 'validation', message: 'campo obrigatório' } }, 400),
    )

    await expect(callEdgeFunction('orders', '', 'POST', {})).rejects.toMatchObject({
      type: 'validation',
      status: 400,
      message: 'campo obrigatório',
    })
  })

  it('falls back to type "database" when the error envelope has an unknown type', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'user-jwt' } } })
    fetchMock.mockResolvedValue(jsonResponse({ error: { type: 'weird', message: 'x' } }, 500))

    await expect(callEdgeFunction('orders', '', 'POST', {})).rejects.toMatchObject({
      type: 'database',
      status: 500,
    })
  })

  it('throws ApiError type "database" preserving the HTTP status when response.json() fails', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'user-jwt' } } })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('Unexpected token < in JSON')),
    })

    await expect(callEdgeFunction('orders', '', 'POST', {})).rejects.toMatchObject({
      type: 'database',
      status: 502,
    })
  })
})
