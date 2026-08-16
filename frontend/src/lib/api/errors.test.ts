import { describe, expect, it } from 'vitest'
import { ApiError, mapSupabaseError } from './errors'

describe('mapSupabaseError', () => {
  it('returns the same instance when already an ApiError', () => {
    const original = new ApiError('validation', 400, 'campo inválido')
    expect(mapSupabaseError(original)).toBe(original)
  })

  it('maps not-null/check/invalid-text/foreign-key violations to validation (400)', () => {
    for (const code of ['23502', '23514', '22P02', '23503']) {
      const error = mapSupabaseError({ code, message: 'erro de banco' })
      expect(error.type).toBe('validation')
      expect(error.status).toBe(400)
    }
  })

  it('maps unique_violation to business_rule (409)', () => {
    const error = mapSupabaseError({ code: '23505', message: 'duplicado' })
    expect(error.type).toBe('business_rule')
    expect(error.status).toBe(409)
  })

  it('maps insufficient_privilege/RLS (42501) to authorization (403)', () => {
    const error = mapSupabaseError({ code: '42501', message: 'permission denied' })
    expect(error.type).toBe('authorization')
    expect(error.status).toBe(403)
  })

  it('maps PGRST116 (.single() sem linha) to not_found (404)', () => {
    const error = mapSupabaseError({ code: 'PGRST116', message: 'no rows' })
    expect(error.type).toBe('not_found')
    expect(error.status).toBe(404)
  })

  it('falls back to database (500) for an unknown error code', () => {
    const error = mapSupabaseError({ code: '99999', message: 'desconhecido' })
    expect(error.type).toBe('database')
    expect(error.status).toBe(500)
  })

  it('falls back to database for a generic Error', () => {
    const error = mapSupabaseError(new Error('boom'))
    expect(error.type).toBe('database')
    expect(error.message).toBe('boom')
  })

  it('falls back to database for a completely unknown value', () => {
    const error = mapSupabaseError('unexpected')
    expect(error.type).toBe('database')
  })
})
