import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext } from '@/context/AuthContext'
import { ProtectedRoute } from './ProtectedRoute'
import type { Session } from '@supabase/supabase-js'

function renderProtectedRoute(session: Session | null, isLoading = false) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthContext.Provider value={{ session, isLoading, signIn: vi.fn(), signOut: vi.fn() }}>
        <Routes>
          <Route path="/login" element={<p>Tela de login</p>} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <p>Conteúdo protegido</p>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  it('renders children when there is an active session', () => {
    renderProtectedRoute({} as Session)

    expect(screen.getByText('Conteúdo protegido')).toBeInTheDocument()
  })

  it('redirects to /login when there is no session', () => {
    renderProtectedRoute(null)

    expect(screen.getByText('Tela de login')).toBeInTheDocument()
  })

  it('shows a loading state while the session is being resolved', () => {
    renderProtectedRoute(null, true)

    expect(screen.getByText(/carregando/i)).toBeInTheDocument()
  })
})
