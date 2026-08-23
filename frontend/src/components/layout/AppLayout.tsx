import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/clientes', label: 'Clientes' },
  { to: '/produtos', label: 'Produtos' },
  { to: '/empresas', label: 'Empresas' },
  { to: '/pedidos', label: 'Pedidos' },
  { to: '/estoque', label: 'Estoque' },
]

export function AppLayout({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const location = useLocation()

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          {/* Logotipo oficial (frontend/public/brand/logo-symbol.svg) —
              vetor colorido. viewBox reenquadrado (35 160 1590 282, ~16-17px
              de margem de segurança ao redor da bounding box real da arte,
              calculada excluindo o retângulo de fundo) rente ao conteúdo
              visível — sem alterar nenhum path/cor/fill, só a "janela" de
              visualização. Proporção agora ~5.64:1. Usado como ativo externo
              via <img> (nunca inline) para preservar integralmente
              cores/transparência/traçado originais. Altura fixa (h-6 = 24px,
              dentro dos 22-28px pedidos) com w-auto: a largura segue a
              proporção intrínseca do próprio arquivo (~135px, dentro dos
              120-150px pedidos), sem distorcer; centralizado verticalmente
              pelo items-center do header, sem aumentar seu padding. */}
          <img src="/brand/logo-symbol.svg" alt="Forma 3D Studio" className="h-6 w-auto" />
          <nav aria-label="Navegação principal" className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              // Rota exata OU sub-rota interna do módulo (ex.: /produtos/novo,
              // /pedidos/123) — sempre com a barra depois do prefixo, para
              // /produtos-antigos nunca "vazar" como se fosse /produtos.
              const isActive = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  // Estado ativo nunca depende só de cor: soma fundo
                  // (bg-brand-primary-soft) + peso tipográfico (font-medium)
                  // + aria-current, para continuar legível mesmo sem
                  // percepção de cor. Paleta é a mesma --brand-primary já
                  // aprovada em Clientes/Pedidos — nenhum token novo.
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'focus-visible:ring-brand-accent rounded-md px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-2',
                    isActive
                      ? 'bg-brand-primary-soft text-brand-primary-dark font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground font-normal',
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground hidden text-sm sm:inline">
            {session?.user.email}
          </span>
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            Sair
          </Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col p-4 sm:p-6">{children}</main>
    </div>
  )
}
