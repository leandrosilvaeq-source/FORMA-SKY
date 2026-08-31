import { TableHead } from '@/components/ui/table'
import { ColumnResizeHandle, type ColumnResizeHandleProps } from './ColumnResizeHandle'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export interface ResizableTableHeadProps {
  columnId: string
  // Nome acessível da alça — sempre exigido mesmo quando o cabeçalho não
  // tem texto visível (ex.: a coluna "Ações", frequentemente exibida como
  // <th> vazio) — a alça precisa de um nome de coluna reconhecível de
  // qualquer forma.
  columnLabel: string
  resize: Omit<ColumnResizeHandleProps, 'columnId' | 'columnLabel'>
  className?: string
  children?: ReactNode
}

// Para cabeçalhos SEM ordenação (a coluna "Ações", ou qualquer tabela que
// ainda não usa SortableColumnHeader, como Filamentos) que precisam da
// mesma alça de redimensionamento — evita duplicar o `relative` + a lógica
// de posicionamento da alça em cada página.
export function ResizableTableHead({ columnId, columnLabel, resize, className, children }: ResizableTableHeadProps) {
  return (
    // Sem aria-label explícito neste <th> de propósito — colidiria com
    // getByLabelText nos testes (que casa aria-label em QUALQUER elemento,
    // não só controles de formulário) sempre que o texto da coluna coincidir
    // com o rótulo de um campo em outro lugar da tela (ex.: coluna "Preço"
    // em Produtos vs. o campo "Preço" do formulário "Novo produto"). O nome
    // acessível deste cabeçalho continua computado a partir do conteúdo
    // (texto visível + nome da alça de redimensionamento) — mais verboso
    // que o ideal, mas nunca ambíguo/quebrado.
    <TableHead className={cn('relative h-auto py-2 whitespace-normal', className)}>
      {children}
      <ColumnResizeHandle columnId={columnId} columnLabel={columnLabel} {...resize} />
    </TableHead>
  )
}
