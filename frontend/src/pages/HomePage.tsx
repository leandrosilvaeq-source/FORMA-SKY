import { AppLayout } from '@/components/layout/AppLayout'

export function HomePage() {
  return (
    <AppLayout>
      <h1 className="font-heading text-2xl font-medium">Bem-vindo à Forma Sky</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Fundação do sistema configurada. Os módulos de clientes, pedidos, produção e Sky serão
        adicionados nos próximos blocos.
      </p>
    </AppLayout>
  )
}
