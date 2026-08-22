// Normalização de texto para busca local (Clientes/Produtos): minúsculas +
// remoção de acentos (NFD + descarte dos diacríticos combinantes) + espaços
// de borda removidos. Usada tanto no termo digitado quanto no valor
// comparado (ex.: nome do cliente/produto) — nunca grava nada, só decide se
// um registro aparece numa lista filtrada ou numa sugestão de autocomplete.
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
