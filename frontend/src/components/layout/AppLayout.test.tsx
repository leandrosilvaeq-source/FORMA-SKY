import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { AppLayout } from './AppLayout'

function renderAt(path: string) {
  const signOut = vi.fn()
  useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut })
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>conteúdo</AppLayout>
    </MemoryRouter>,
  )
  return { signOut }
}

describe('AppLayout', () => {
  it('mostra o logotipo oficial com nome acessível "Forma 3D Studio" e não mostra mais o texto "Forma Sky"', () => {
    renderAt('/produtos')

    const logo = screen.getByRole('img', { name: 'Forma 3D Studio' })
    expect(logo).toHaveAttribute('src', '/brand/logo-symbol.svg')
    expect(screen.queryByText('Forma Sky')).not.toBeInTheDocument()
  })

  it('marca "Produtos" como módulo ativo na rota /produtos', () => {
    renderAt('/produtos')

    expect(screen.getByRole('link', { name: 'Produtos' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Clientes' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Empresas' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Pedidos' })).not.toHaveAttribute('aria-current')
  })

  it('marca "Clientes" como módulo ativo na rota /clientes', () => {
    renderAt('/clientes')

    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Produtos' })).not.toHaveAttribute('aria-current')
  })

  it('marca "Empresas" como módulo ativo na rota /empresas', () => {
    renderAt('/empresas')

    expect(screen.getByRole('link', { name: 'Empresas' })).toHaveAttribute('aria-current', 'page')
  })

  it('marca "Pedidos" como módulo ativo na rota /pedidos', () => {
    renderAt('/pedidos')

    expect(screen.getByRole('link', { name: 'Pedidos' })).toHaveAttribute('aria-current', 'page')
  })

  it('marca "Estoque" como módulo ativo na rota /estoque', () => {
    renderAt('/estoque')

    expect(screen.getByRole('link', { name: 'Estoque' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Pedidos' })).not.toHaveAttribute('aria-current')
  })

  it('marca "Produtos" como ativo numa sub-rota interna (/produtos/novo)', () => {
    renderAt('/produtos/novo')

    expect(screen.getByRole('link', { name: 'Produtos' })).toHaveAttribute('aria-current', 'page')
  })

  it('marca "Pedidos" como ativo numa sub-rota interna (/pedidos/123)', () => {
    renderAt('/pedidos/123')

    expect(screen.getByRole('link', { name: 'Pedidos' })).toHaveAttribute('aria-current', 'page')
  })

  it('marca "Estoque" como ativo na sub-rota /estoque/acessorios', () => {
    renderAt('/estoque/acessorios')

    expect(screen.getByRole('link', { name: 'Estoque' })).toHaveAttribute('aria-current', 'page')
  })

  it('marca "Estoque" como ativo na sub-rota /estoque/embalagens', () => {
    renderAt('/estoque/embalagens')

    expect(screen.getByRole('link', { name: 'Estoque' })).toHaveAttribute('aria-current', 'page')
  })

  it('não marca "Produtos" como ativo numa rota parecida mas de outro módulo (/produtos-antigos)', () => {
    renderAt('/produtos-antigos')

    expect(screen.getByRole('link', { name: 'Produtos' })).not.toHaveAttribute('aria-current')
  })

  it('não marca "Estoque" como ativo numa rota parecida mas de outro módulo (/estoque-antigo)', () => {
    renderAt('/estoque-antigo')

    expect(screen.getByRole('link', { name: 'Estoque' })).not.toHaveAttribute('aria-current')
  })

  it('nenhum módulo fica marcado como ativo fora das rotas de módulo (ex.: home)', () => {
    renderAt('/')

    for (const label of ['Clientes', 'Produtos', 'Empresas', 'Pedidos', 'Estoque']) {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current')
    }
  })

  it('ordem oficial dos módulos: Clientes, Empresas, Produtos, Pedidos, Estoque', () => {
    renderAt('/produtos')

    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Clientes', 'Empresas', 'Produtos', 'Pedidos', 'Estoque'])
  })

  it('renderiza o conteúdo filho e o e-mail da sessão', () => {
    renderAt('/produtos')

    expect(screen.getByText('conteúdo')).toBeInTheDocument()
    expect(screen.getByText('op@formasky.com')).toBeInTheDocument()
  })

  it('a navegação principal tem nome acessível "Navegação principal"', () => {
    renderAt('/produtos')

    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument()
  })

  it('o botão "Sair" tem nome acessível "Sair" e chama signOut() exatamente uma vez ao clicar', async () => {
    const user = userEvent.setup()
    const { signOut } = renderAt('/produtos')

    const logoutButton = screen.getByRole('button', { name: 'Sair' })
    await user.click(logoutButton)

    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('o botão "Sair" também é ativável pelo teclado (Enter)', async () => {
    const user = userEvent.setup()
    const { signOut } = renderAt('/produtos')

    screen.getByRole('button', { name: 'Sair' }).focus()
    await user.keyboard('{Enter}')

    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
