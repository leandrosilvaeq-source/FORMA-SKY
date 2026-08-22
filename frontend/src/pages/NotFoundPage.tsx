import { Link } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { buttonVariants } from '@/components/ui/button'

// Rota coringa (path="*" em App.tsx) para qualquer URL que não bate com
// nenhuma rota registrada — sem essa página, o React Router simplesmente
// não renderiza nada (tela em branco) para um caminho desconhecido.
// Dentro de AppLayout (cabeçalho/nav preservados) para o usuário nunca
// perder a navegação principal, mesmo numa URL errada. Nenhum item do nav
// fica marcado como ativo aqui (nenhum prefixo de NAV_ITEMS bate com
// pathname arbitrário) — comportamento correto por construção, não
// precisa de tratamento especial. Sem redirecionamento automático: o
// usuário decide clicar em "Voltar ao início".
export function NotFoundPage() {
  return (
    <AppLayout>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-medium">Página não encontrada</h1>
        <p className="text-muted-foreground text-sm">O endereço acessado não existe ou foi movido.</p>
        <Link
          to="/"
          className={buttonVariants({
            className: 'bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark mt-2 w-fit',
          })}
        >
          Voltar ao início
        </Link>
      </div>
    </AppLayout>
  )
}
