import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { HomePage } from './HomePage'

function renderHome() {
  useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
  return render(
    <MemoryRouter initialEntries={['/']}>
      <HomePage />
    </MemoryRouter>,
  )
}

// A Página Inicial reaproveita AppLayout (mesma navegação principal do
// restante do sistema) — a ordem oficial dos módulos (decisão aprovada
// 2026-08-29: Clientes, Empresas, Produtos, Pedidos, Estoque) já é coberta
// em profundidade por AppLayout.test.tsx; este arquivo confirma que a
// Página Inicial especificamente também exibe essa mesma ordem, sem
// nenhuma lista/menu próprio divergente.
describe('HomePage', () => {
  it('mostra a mensagem de boas-vindas', () => {
    renderHome()

    expect(screen.getByRole('heading', { name: /bem-vindo à forma sky/i })).toBeInTheDocument()
  })

  it('exibe a navegação principal na ordem oficial: Clientes, Empresas, Produtos, Pedidos, Estoque', () => {
    renderHome()

    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Clientes', 'Empresas', 'Produtos', 'Pedidos', 'Estoque'])
  })

  it('nenhum módulo aparece marcado como ativo na Página Inicial', () => {
    renderHome()

    for (const label of ['Clientes', 'Empresas', 'Produtos', 'Pedidos', 'Estoque']) {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current')
    }
  })
})
