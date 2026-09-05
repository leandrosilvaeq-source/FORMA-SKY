import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
const { getSessionMock, onAuthStateChangeMock, fromMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: fromMock,
  },
}))

// Estoque (Incremento 4) lê accessories/packaging via supabase-js direto
// (useAccessories/usePackaging, sem Edge Function) — precisa de um mock
// mínimo de `from` para as rotas /estoque/* não quebrarem ao montar
// App.tsx real. Sempre resolve vazio: o suficiente para provar que a rota
// e o roteamento funcionam, sem testar o conteúdo da listagem em si (já
// coberto por InventoryPage.test.tsx com os hooks mockados diretamente).
// `builder.order` PRECISA ser encadeável (retornar o próprio builder) — a
// consulta de Filamentos (listFilamentTypeSummaries) chama .order() DUAS
// vezes seguidas (.order('manufacturer', ...).order('commercial_color',
// ...)), diferente de Acessórios/Embalagens (uma única .order()). O builder
// é "thenable" (tem .then) para que `await` resolva vazio não importa
// quantos .select()/.order() encadeados vieram antes.
function mockEmptySupabaseFrom() {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null })
  fromMock.mockReturnValue(builder)
}

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
  mockEmptySupabaseFrom()

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

// Módulo 3 — Estoque (Incremento 4): prova de integração real de roteamento
// que InventoryPage.test.tsx (hooks mockados diretamente) não consegue
// provar sozinho — que /estoque de fato redireciona via App.tsx real, e que
// as duas sub-rotas resolvem para a área correta a partir da URL.
describe('App — rotas de Estoque (integração real de roteamento)', () => {
  it('sessão autenticada em /estoque redireciona para /estoque/filamentos (área Filamentos ativa, primeira aba — 2026-09-05)', async () => {
    renderAppAt('/estoque', { user: { email: 'op@formasky.com' } } as Session)

    expect(await screen.findByRole('heading', { name: 'Estoque' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Filamentos' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Acessórios' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Embalagens' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Estoque' })).toHaveAttribute('aria-current', 'page')
  })

  it('a aba Filamentos aparece antes de Acessórios e Embalagens na navegação de Estoque', async () => {
    renderAppAt('/estoque', { user: { email: 'op@formasky.com' } } as Session)
    await screen.findByRole('heading', { name: 'Estoque' })

    const nav = screen.getByRole('navigation', { name: 'Áreas do Estoque' })
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(labels).toEqual(['Filamentos', 'Acessórios', 'Embalagens'])
  })

  it('acesso direto a /estoque/filamentos abre a área Filamentos', async () => {
    renderAppAt('/estoque/filamentos', { user: { email: 'op@formasky.com' } } as Session)

    expect(await screen.findByRole('heading', { name: 'Estoque' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Filamentos' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText('Nenhum tipo de filamento cadastrado.')).toBeInTheDocument()
  })

  it('acesso direto a /estoque/acessorios abre a área Acessórios', async () => {
    renderAppAt('/estoque/acessorios', { user: { email: 'op@formasky.com' } } as Session)

    expect(await screen.findByRole('heading', { name: 'Estoque' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Acessórios' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText('Nenhum acessório cadastrado.')).toBeInTheDocument()
  })

  it('acesso direto a /estoque/embalagens abre a área Embalagens', async () => {
    renderAppAt('/estoque/embalagens', { user: { email: 'op@formasky.com' } } as Session)

    expect(await screen.findByRole('heading', { name: 'Estoque' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Embalagens' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Acessórios' })).not.toHaveAttribute('aria-current')
    expect(await screen.findByText('Nenhuma embalagem cadastrada.')).toBeInTheDocument()
  })

  it('sessão ausente em /estoque é redirecionada para /login', async () => {
    renderAppAt('/estoque', null)

    expect(await screen.findByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Estoque' })).not.toBeInTheDocument()
  })

  it('sessão ausente em /estoque/acessorios é redirecionada para /login', async () => {
    renderAppAt('/estoque/acessorios', null)

    expect(await screen.findByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Estoque' })).not.toBeInTheDocument()
  })
})
