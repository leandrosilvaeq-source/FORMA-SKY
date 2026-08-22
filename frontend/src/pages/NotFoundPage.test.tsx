import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { NotFoundPage } from './NotFoundPage'

// NotFoundPage.tsx não tem nenhuma lógica de roteamento própria — é só um
// componente-folha (AppLayout + texto + link), montado pela rota coringa
// (path="*") de App.tsx. Testar aqui, renderizando o componente
// diretamente sob MemoryRouter (mesmo padrão já usado por
// AppLayout.test.tsx para simular pathnames diferentes), cobre tudo que
// esta rodada pede sem precisar montar App.tsx inteiro — que exigiria
// mockar também @/lib/supabase (usado por AuthContext real) só para
// provar que "*" resolve para este componente, um fato estrutural já
// conferível lendo App.tsx diretamente.
function renderAt(path: string) {
  useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotFoundPage />
    </MemoryRouter>,
  )
}

describe('NotFoundPage', () => {
  it('mostra o título "Página não encontrada" e uma descrição curta', () => {
    renderAt('/rota-que-nao-existe')

    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument()
    expect(screen.getByText(/o endereço acessado não existe/i)).toBeInTheDocument()
  })

  it('permanece dentro do AppLayout (cabeçalho e navegação preservados)', () => {
    renderAt('/rota-que-nao-existe')

    expect(screen.getByRole('img', { name: 'Forma 3D Studio' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
  })

  it('a ação "Voltar ao início" aponta para "/"', () => {
    renderAt('/rota-que-nao-existe')

    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/')
  })

  it('nenhum item do menu principal recebe aria-current="page" numa URL desconhecida', () => {
    renderAt('/rota-que-nao-existe')

    for (const label of ['Clientes', 'Produtos', 'Empresas', 'Pedidos']) {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current')
    }
  })

  it('não redireciona sozinha: o conteúdo da página permanece visível, sem navegação automática', () => {
    renderAt('/rota-que-nao-existe')

    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument()
  })
})
