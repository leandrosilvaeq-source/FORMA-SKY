// Formatação de datas para LISTAGENS (dd/mm/aa) — extraída de
// OrdersPage.formatDateOnly (que produzia dd/mm/aaaa) para ser
// compartilhada por qualquer listagem futura com coluna de data, nunca
// duplicada. Usada SOMENTE na apresentação em tabelas/listagens — nunca em
// formulários, payloads, contratos de API ou nos diálogos/históricos já
// aprovados (que continuam com seu próprio formato).
//
// Puramente textual: nunca instancia Date a partir de uma string sem
// horário. new Date('YYYY-MM-DD') é interpretado pelo motor JS como meia-
// noite UTC; formatar esse objeto de volta no fuso local (America/
// Sao_Paulo, UTC-3) mostraria o dia ANTERIOR — o mesmo risco de
// deslocamento já documentado/evitado em OrdersPage.tsx. O regex abaixo lê
// só os 10 primeiros caracteres (YYYY-MM-DD), funcionando igualmente para
// uma coluna DATE pura e para o prefixo de um TIMESTAMP
// (YYYY-MM-DDTHH:mm:ss...) — nunca usa o restante da string, então nunca
// há conversão de fuso horário envolvida em nenhum dos dois casos.
const DATE_PREFIX_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/

export interface TableDateFormatResult {
  // dd/mm/aa — ou '—' quando o valor é ausente/nulo/vazio; o texto original
  // (nunca reescrito às cegas) quando o valor não bate com o padrão
  // esperado, para nunca esconder um dado inesperado do usuário.
  short: string
  // dd/mm/aaaa — para exibir em title/tooltip mantendo o ano completo
  // disponível; null quando não há data válida para formatar.
  full: string | null
}

export function formatTableDate(value: string | null | undefined): TableDateFormatResult {
  if (!value) return { short: '—', full: null }
  const match = DATE_PREFIX_PATTERN.exec(value)
  if (!match) return { short: value, full: null }
  const [, year, month, day] = match
  const shortYear = year.slice(2)
  return { short: `${day}/${month}/${shortYear}`, full: `${day}/${month}/${year}` }
}

// Valor numérico real da data (AAAAMMDD) para ORDENAR cronologicamente —
// nunca pelo texto já formatado dd/mm/aa (que ordenaria como texto,
// misturando dia/mês/ano incorretamente, e pior ainda com ano de 2
// dígitos). Mesmo padrão já usado em OrdersPage.dateSortValue.
export function tableDateSortValue(value: string | null | undefined): number | null {
  if (!value) return null
  const match = DATE_PREFIX_PATTERN.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  return Number(`${year}${month}${day}`)
}
