// Funções puras que REPRODUZEM, no frontend, o rateio de frete e a média
// ponderada móvel de Custo unitário implementados na RPC
// register_accessory_purchase (migration 20260906140000). Servem SÓ para a
// PREVISÃO exibida na janela "Compra de acessórios" — o valor autoritativo
// é sempre o que o backend devolve (unit_cost_after de cada item). Toda a
// aritmética é feita em CENTAVOS INTEIROS (BigInt no rateio), nunca em reais
// de ponto flutuante acumulado — mesmo princípio de currencyField.ts e da
// própria RPC (numeric decimal exato).

// Rateio do frete único proporcionalmente ao total de cada linha, em
// centavos, pelo método do MAIOR RESTO — idêntico à RPC:
//   1. parcela bruta proporcional = freightCents * lineTotalCents_i / subtotal;
//   2. atribui o piso (floor) de cada parcela;
//   3. os centavos que sobraram (freightCents - Σ pisos, sempre em [0, n-1])
//      vão, um a um, para as linhas de MAIOR resto;
//   4. desempate determinístico pela ordem da linha (índice ascendente).
// Garantias: nenhuma parcela negativa; Σ parcelas = freightCents exatamente;
// frete zero -> tudo zero; independente de ponto flutuante; determinístico.
export function allocateFreightCents(lineTotalsCents: number[], freightCents: number): number[] {
  const n = lineTotalsCents.length
  if (n === 0) return []

  const subtotal = lineTotalsCents.reduce((sum, c) => sum + c, 0)
  if (freightCents <= 0 || subtotal <= 0) return lineTotalsCents.map(() => 0)

  const freight = BigInt(freightCents)
  const sub = BigInt(subtotal)

  const floors: bigint[] = []
  const remainders: bigint[] = []
  let assigned = 0n
  for (let i = 0; i < n; i++) {
    const raw = freight * BigInt(lineTotalsCents[i])
    const floor = raw / sub
    floors.push(floor)
    remainders.push(raw % sub)
    assigned += floor
  }

  const leftover = Number(freight - assigned) // sempre em [0, n-1]

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    if (remainders[a] !== remainders[b]) return remainders[a] > remainders[b] ? -1 : 1
    return a - b
  })
  const bump = new Set<number>()
  for (let k = 0; k < leftover; k++) bump.add(order[k])

  return floors.map((floor, i) => Number(floor) + (bump.has(i) ? 1 : 0))
}

export interface PredictUnitCostParams {
  // Saldo atual do acessório (accessories.current_stock).
  balanceBefore: number
  // Custo unitário atual em reais (accessories.unit_cost); null = "Não
  // informado".
  unitCostBefore: number | null
  // Quantidade comprada nesta linha.
  quantity: number
  // Valor total pago pela linha, em centavos.
  lineTotalCents: number
  // Parcela do frete atribuída a esta linha, em centavos (de
  // allocateFreightCents).
  freightAllocatedCents: number
}

// Média ponderada móvel — idêntica à RPC:
//   - se balanceBefore = 0 OU unitCostBefore = null:
//       round((lineTotal + freteRateado) / quantidade, 2)   [primeira compra
//       define o custo, sem diluir pelo saldo anterior]
//   - senão:
//       round((saldo × custoAnterior + lineTotal + freteRateado)
//             / (saldo + quantidade), 2)
// Retorna reais (número com 2 casas). round(x, 2) == round(centavos)/100.
export function predictUnitCostAfter(params: PredictUnitCostParams): number {
  const { balanceBefore, unitCostBefore, quantity, lineTotalCents, freightAllocatedCents } = params
  if (quantity <= 0) return 0

  const entryCents = lineTotalCents + freightAllocatedCents

  if (balanceBefore === 0 || unitCostBefore === null || unitCostBefore === undefined) {
    return Math.round(entryCents / quantity) / 100
  }

  const unitCostBeforeCents = Math.round(unitCostBefore * 100)
  const numeratorCents = balanceBefore * unitCostBeforeCents + entryCents
  const denominator = balanceBefore + quantity
  return Math.round(numeratorCents / denominator) / 100
}
