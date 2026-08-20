import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { AppLayout } from './AppLayout'

function renderAt(path: string) {
  useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>conteúdo</AppLayout>
    </MemoryRouter>,
  )
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

  it('marca "Produtos" como ativo numa sub-rota interna (/produtos/novo)', () => {
    renderAt('/produtos/novo')

    expect(screen.getByRole('link', { name: 'Produtos' })).toHaveAttribute('aria-current', 'page')
  })

  it('marca "Pedidos" como ativo numa sub-rota interna (/pedidos/123)', () => {
    renderAt('/pedidos/123')

    expect(screen.getByRole('link', { name: 'Pedidos' })).toHaveAttribute('aria-current', 'page')
  })

  it('não marca "Produtos" como ativo numa rota parecida mas de outro módulo (/produtos-antigos)', () => {
    renderAt('/produtos-antigos')

    expect(screen.getByRole('link', { name: 'Produtos' })).not.toHaveAttribute('aria-current')
  })

  it('nenhum módulo fica marcado como ativo fora das rotas de módulo (ex.: home)', () => {
    renderAt('/')

    for (const label of ['Clientes', 'Produtos', 'Empresas', 'Pedidos']) {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current')
    }
  })

  it('renderiza o conteúdo filho e o e-mail da sessão', () => {
    renderAt('/produtos')

    expect(screen.getByText('conteúdo')).toBeInTheDocument()
    expect(screen.getByText('op@formasky.com')).toBeInTheDocument()
  })
})
