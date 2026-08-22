import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext } from '@/context/AuthContext'
import { LoginPage } from './LoginPage'
import type { Session } from '@supabase/supabase-js'

function renderLoginPage(signIn = vi.fn().mockResolvedValue({ error: null })) {
  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ session: null, isLoading: false, signIn, signOut: vi.fn() }}>
        <LoginPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  )
  return { signIn }
}

describe('LoginPage', () => {
  it('renders email and password fields', () => {
    renderLoginPage()

    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument()
  })

  it('calls signIn with the entered credentials on submit', async () => {
    const user = userEvent.setup()
    const { signIn } = renderLoginPage()

    await user.type(screen.getByLabelText(/e-mail/i), 'operador@formasky.com')
    await user.type(screen.getByLabelText(/senha/i), 'senha-secreta')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('operador@formasky.com', 'senha-secreta')
    })
  })

  it('shows an error message when sign in fails', async () => {
    const user = userEvent.setup()
    renderLoginPage(vi.fn().mockResolvedValue({ error: 'Credenciais inválidas' }))

    await user.type(screen.getByLabelText(/e-mail/i), 'operador@formasky.com')
    await user.type(screen.getByLabelText(/senha/i), 'senha-errada')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    expect(await screen.findByText('Credenciais inválidas')).toBeInTheDocument()
  })

  it('redirects an already authenticated session from /login to /', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthContext.Provider
          value={{ session: {} as Session, isLoading: false, signIn: vi.fn(), signOut: vi.fn() }}
        >
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<p>Página inicial</p>} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getByText('Página inicial')).toBeInTheDocument()
    expect(screen.queryByLabelText(/e-mail/i)).not.toBeInTheDocument()
  })
})
