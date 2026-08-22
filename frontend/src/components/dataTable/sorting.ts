// Ordenação genérica de listagem no frontend (Clientes/Produtos): extraída
// de CustomersPage.tsx para ser reutilizada sem duplicar a lógica em
// ProductsPage.tsx. Nenhuma consulta/API envolvida — opera só sobre
// registros já carregados, nunca muta o array de entrada (todo passo aqui
// usa filter/sort com spread, produzindo cópias novas).
export type SortDirection = 'asc' | 'desc'

export interface SortState<TColumn extends string> {
  column: TColumn
  direction: SortDirection
}

// Um valor de ordenação nunca é o dado bruto do banco quando existe uma
// forma normalizada/exibida (ex.: WhatsApp/Instagram formatados) — cada
// chamador decide, no próprio getValue, qual representação usar.
export type SortValue = string | number | boolean | null

// pt-BR, ignorando maiúsculas/minúsculas e acentos (sensitivity: 'base') —
// "joao"/"João"/"JOÃO" comparam como iguais, na ordem alfabética esperada
// em português. numeric:true evita comparação lexicográfica errada entre
// strings com dígitos (ex.: sequências de pedido).
export const PT_BR_COLLATOR = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })

export function isEmptySortValue(value: SortValue): boolean {
  if (value === null) return true
  return typeof value === 'string' && value.trim() === ''
}

function compareSortValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    // false antes de true na ordem crescente.
    return a === b ? 0 : a ? 1 : -1
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }
  return PT_BR_COLLATOR.compare(String(a ?? ''), String(b ?? ''))
}

// Linhas sem valor (null/undefined/vazio) sempre no final, tanto crescente
// quanto decrescente — nunca participam da comparação direcional, só são
// concatenadas depois. Array.prototype.sort é estável (garantido pela spec
// desde ES2019), então valores iguais preservam a ordem original sem
// nenhum desempate manual.
export function sortByColumn<TRow, TColumn extends string>(
  rows: TRow[],
  sort: SortState<TColumn> | null,
  getValue: (row: TRow, column: TColumn) => SortValue,
): TRow[] {
  if (!sort) return rows

  const { column, direction } = sort
  const withValue = rows.filter((row) => !isEmptySortValue(getValue(row, column)))
  const withoutValue = rows.filter((row) => isEmptySortValue(getValue(row, column)))

  const sortedWithValue = [...withValue].sort((a, b) => {
    const cmp = compareSortValues(getValue(a, column), getValue(b, column))
    return direction === 'asc' ? cmp : -cmp
  })

  return [...sortedWithValue, ...withoutValue]
}

export function getAriaSort<TColumn extends string>(
  sort: SortState<TColumn> | null,
  column: TColumn,
): 'ascending' | 'descending' | 'none' {
  if (!sort || sort.column !== column) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}
