// Funções puras de resolução/soma para a seção "Acessórios e embalagens" da
// Ficha Técnica do Produto (Incremento 2). Somente leitura: nenhuma delas
// grava nada — a ficha nunca edita a composição (isso continua em
// ProductCompositionForm.tsx).
//
// Regra central em todo este arquivo: custo nulo NUNCA vira 0. Uma linha só
// entra na soma quando seu unit_cost é conhecido; quando não é, ela fica de
// fora e o chamador (ProductDetailPage) precisa mostrar isso explicitamente
// ("Não informado"/"Não calculável"), nunca silenciosamente.

export type CompositionLineStatus = 'active' | 'inactive' | 'missing'

export interface ResolvedCompositionLine {
  key: string
  name: string
  status: CompositionLineStatus
  quantity: number
  unitCost: number | null
  subtotal: number | null
}

interface CatalogItem {
  id: string
  name: string
  is_active: boolean
  unit_cost: number | null
}

function resolveLine(itemId: string, quantity: number, catalog: CatalogItem[]): ResolvedCompositionLine {
  const found = catalog.find((item) => item.id === itemId)

  if (!found) {
    return {
      key: itemId,
      name: 'Item não encontrado',
      status: 'missing',
      quantity,
      unitCost: null,
      subtotal: null,
    }
  }

  return {
    key: itemId,
    name: found.name,
    status: found.is_active ? 'active' : 'inactive',
    quantity,
    unitCost: found.unit_cost,
    subtotal: found.unit_cost !== null ? quantity * found.unit_cost : null,
  }
}

export function resolveAccessoryLines(
  items: Array<{ accessory_id: string; quantity: number }>,
  accessories: CatalogItem[],
): ResolvedCompositionLine[] {
  return items.map((item) => resolveLine(item.accessory_id, item.quantity, accessories))
}

export function resolvePackagingLines(
  items: Array<{ packaging_id: string; quantity: number }>,
  packaging: CatalogItem[],
): ResolvedCompositionLine[] {
  return items.map((item) => resolveLine(item.packaging_id, item.quantity, packaging))
}

export type ComponentsSubtotalStatus = 'complete' | 'partial' | 'not_calculable' | 'empty'

export interface ComponentsSubtotal {
  status: ComponentsSubtotalStatus
  // Soma só das linhas com unitCost conhecido — nunca inclui custo ausente
  // como 0. É 0 apenas quando status é 'empty' (sem nenhuma linha) ou
  // 'not_calculable' (nenhuma linha com custo conhecido); nesses casos o
  // chamador não deve exibir `total` como um subtotal real.
  total: number
  hasIncompleteData: boolean
}

// Nunca formata moeda aqui — soma em número puro, o chamador formata só na
// exibição (evita arredondamento intermediário e mantém a função testável
// sem depender de locale).
export function calculateComponentsSubtotal(
  accessoryLines: ResolvedCompositionLine[],
  packagingLines: ResolvedCompositionLine[],
): ComponentsSubtotal {
  const allLines = [...accessoryLines, ...packagingLines]

  if (allLines.length === 0) {
    return { status: 'empty', total: 0, hasIncompleteData: false }
  }

  const linesWithCost = allLines.filter((line) => line.subtotal !== null)
  const total = linesWithCost.reduce((sum, line) => sum + (line.subtotal as number), 0)

  if (linesWithCost.length === 0) {
    return { status: 'not_calculable', total: 0, hasIncompleteData: true }
  }
  if (linesWithCost.length < allLines.length) {
    return { status: 'partial', total, hasIncompleteData: true }
  }
  return { status: 'complete', total, hasIncompleteData: false }
}
