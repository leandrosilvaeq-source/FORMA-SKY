import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'

// Integração real: monta App.tsx inteiro (AuthProvider real + Routes reais
// de App.tsx, incluindo a rota coringa path="*") — só @/lib/supabase é
// mockado (a única dependência externa de fato, usada por AuthContext.tsx
// para getSession()/onAuthStateChange()). Diferente de NotFoundPage.test.tsx
// (que monta só o componente-folha sob @/context/AuthContext mockado, para
// testar a PÁGINA em isolamento), este arquivo prova que a configuração
// real de rotas em App.tsx de fato resolve "*" para NotFoundPage dentro de
// ProtectedRoute, e "/rota-que-nao-existe" sem sessão cai em /login — um
// fato de integração que NotFoundPage.test.tsx, sozinho, não consegue
// provar (ele nunca toca App.tsx).
const { getSessionMock, onAuthStateChangeMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}))

// App.tsx renderiza <Toaster/> de verdade (nenhum outro teste de página
// monta isso — todos mockam só a função `toast`). O componente real da
// sonner usa window.matchMedia (não implementado por padrão no jsdom deste
// projeto), então precisa de um stub aqui — mesmo mock de `toast` já usado
// em todas as outras suítes de página, só com Toaster substituído por um
// no-op puramente de ambiente de teste (nenhuma mudança em App.tsx).
vi.mock('sonner', () => ({ Toaster: () => null, toast: { success: vi.fn(), error: vi.fn() } }))

import App from './App'

function renderAppAt(path: string, session: Session | null) {
  getSessionMock.mockResolvedValue({ data: { session } })
  onAuthStateChangeMock.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })

  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App — rota coringa (integração real de roteamento)', () => {
  it('sessão autenticada em /rota-que-nao-existe mostra "Página não encontrada" dentro do AppLayout', async () => {
    renderAppAt('/rota-que-nao-existe', { user: { email: 'op@formasky.com' } } as Session)

    expect(await screen.findByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument()
    // AppLayout continua presente: logotipo e navegação principal visíveis.
    expect(screen.getByRole('img', { name: 'Forma 3D Studio' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument()
  })

  it('nenhum item do menu recebe aria-current="page" em /rota-que-nao-existe', async () => {
    renderAppAt('/rota-que-nao-existe', { user: { email: 'op@formasky.com' } } as Session)

    await screen.findByRole('heading', { name: 'Página não encontrada' })

    for (const label of ['Clientes', 'Produtos', 'Empresas', 'Pedidos']) {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current')
    }
  })

  it('o link "Voltar ao início" aponta para "/"', async () => {
    renderAppAt('/rota-que-nao-existe', { user: { email: 'op@formasky.com' } } as Session)

    const backLink = await screen.findByRole('link', { name: 'Voltar ao início' })
    expect(backLink).toHaveAttribute('href', '/')
  })

  it('sessão ausente em URL desconhecida é redirecionada para /login (nunca mostra a página protegida)', async () => {
    renderAppAt('/rota-que-nao-existe', null)

    expect(await screen.findByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.getByText('Forma Sky')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Página não encontrada' })).not.toBeInTheDocument()
  })
})
