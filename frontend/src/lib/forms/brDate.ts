// Data brasileira COMPLETA dd/mm/aaaa (ano com 4 dígitos) — usada na janela
// "Registrar compra" (compra mista, PurchaseDialog.tsx, 2026-09-06). Feita
// para ser um helper PURO e testável (sem React), no mesmo espírito de
// brShortDate.ts (dd/mm/aa), que continua existindo INTACTO para qualquer
// consumidor do formato curto de 2 dígitos.
//
// - a máscara insere as barras sozinha enquanto o usuário digita só números;
// - `parseBrDate` monta o Date pelos COMPONENTES (nunca faz parse de string
//   localizada), então não há deslocamento de fuso: a data informada é
//   convertida para YYYY-MM-DD exatamente como foi digitada;
// - o backend recebe `occurred_on` como YYYY-MM-DD (uma DATA de negócio, sem
//   hora nem fuso) — a RPC register_mixed_inventory_purchase ancora o
//   meio-dia America/Sao_Paulo ao gravar occurred_at;
// - o HISTÓRICO continua sendo exibido no formato curto dd/mm/aa
//   (formatIsoToBrShort abaixo) — só a ENTRADA passou a ser dd/mm/aaaa.

// Máscara automática: 8 algarismos -> "dd/mm/aaaa" (10 caracteres). Ignora
// qualquer caractere não numérico (inclusive as próprias barras de uma
// colagem "05/09/2026"). Barra inserida só ENTRE grupos já iniciados —
// nunca "solta" no fim —, então Backspace no fim apaga sem a barra "grudar".
export function maskBrDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8)
  const groups = [digits.slice(0, 2)]
  if (digits.length > 2) groups.push(digits.slice(2, 4))
  if (digits.length > 4) groups.push(digits.slice(4, 8))
  return groups.join('/')
}

// Preenchimento inicial: uma Date -> "dd/mm/aaaa".
export function formatDateToBrDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = String(date.getFullYear()).padStart(4, '0')
  return `${dd}/${mm}/${yyyy}`
}

// Converte dd/mm/aaaa -> YYYY-MM-DD validando a EXISTÊNCIA REAL da data
// (rejeita 31/02/2026, 29/02/2027, etc.), não só o formato: monta um Date
// pelos componentes e confere se dia/mês/ano voltaram exatamente como
// informados. Data incompleta (menos de 8 dígitos / sem as duas barras) é
// rejeitada com mensagem de formato. O ano precisa ter 4 dígitos e ficar
// num intervalo plausível (2000–2099) para não aceitar "05/09/26" aqui.
export function parseBrDate(raw: string): { value: string | null; error: string | null } {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim())
  if (!match) {
    return { value: null, error: 'Informe a data no formato dd/mm/aaaa (ex.: 06/09/2026).' }
  }
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (year < 2000 || year > 2099) {
    return { value: null, error: 'Ano fora do intervalo suportado (2000–2099).' }
  }
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { value: null, error: 'Data inválida.' }
  }
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { value: iso, error: null }
}

// Exibição no histórico/resumo: YYYY-MM-DD -> dd/mm/aa (ano com 2 dígitos).
// Não faz parse de string localizada — separa os componentes do ISO. Uma
// entrada malformada volta como está (nunca lança).
export function formatIsoToBrShort(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!match) return iso
  return `${match[3]}/${match[2]}/${match[1].slice(2)}`
}
