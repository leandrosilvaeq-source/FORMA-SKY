import { describe, expect, it } from 'vitest'
import { supabase } from './supabase'

describe('supabase client', () => {
  it('is created from the configured environment variables', () => {
    expect(supabase).toBeDefined()
    expect(supabase.auth).toBeDefined()
  })
})
