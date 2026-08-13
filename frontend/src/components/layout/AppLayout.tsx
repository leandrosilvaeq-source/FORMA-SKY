import type { ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'

export function AppLayout({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <span className="font-heading text-lg font-medium">Forma Sky</span>
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
