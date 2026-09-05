// Data curta brasileira dd/mm/aa (ano com 2 dígitos) — usada na janela
// "Compra de filamentos" (PurchaseDialog.tsx). "aa" é SEMPRE lido como 20aa
// (2000–2099), mesma convenção do gerador RL-YY-NNN de filament_spools.code,
// coerente com o período real de uso do sistema. O backend continua
// recebendo occurred_at no formato ISO YYYY-MM-DD — a conversão acontece só
// na submissão (parseBrShortDate), o contrato da API não muda.
//
// Extraído de PurchaseDialog.tsx em 2026-09-05 (junto com a nova máscara
// automática) para: (1) manter o componente só com exports de componente
// (sem disparar react-refresh/only-export-components) e (2) permitir teste
// unitário direto de cada regra da máscara/conversão.

// Preenchimento inicial: hoje, já no formato dd/mm/aa.
export function formatDateToBrShort(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yy = String(date.getFullYear() % 100).padStart(2, '0')
  return `${dd}/${mm}/${yy}`
}

// Máscara automática: o usuário digita SÓ números e as barras aparecem
// sozinhas. Ignora qualquer caractere não numérico — inclusive as próprias
// barras de uma colagem "05/09/26", que viram os mesmos 6 dígitos —, limita
// a 6 algarismos (8 caracteres exibidos: "dd/mm/aa"). A barra é inserida só
// ENTRE grupos, quando o grupo seguinte já começou — nunca uma barra "solta"
// no fim —, então Backspace/Delete no fim do campo apaga normalmente sem a
// barra "grudar". Não valida a data (papel de parseBrShortDate) — só formata
// o que já foi digitado.
export function maskBrShortDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 6)
  const groups = [digits.slice(0, 2)]
  if (digits.length > 2) groups.push(digits.slice(2, 4))
  if (digits.length > 4) groups.push(digits.slice(4, 6))
  return groups.join('/')
}

// Converte dd/mm/aa -> YYYY-MM-DD, validando a EXISTÊNCIA REAL da data
// (rejeita 31/02/26, 30/02/26, 29/02/27 — ano não bissexto — etc.), não só o
// formato: monta um Date pelos COMPONENTES (nunca faz parse de string, então
// não há problema de fuso horário) e confere se dia/mês/ano voltaram
// exatamente como informados (o construtor de Date nunca lança erro para uma
// data inválida — ele "rola" para o mês seguinte em silêncio, então essa
// comparação é a única forma confiável de detectar o problema). Data
// incompleta (menos de 6 dígitos / sem as duas barras) não casa o regex e é
// rejeitada com mensagem de formato.
export function parseBrShortDate(raw: string): { value: string | null; error: string | null } {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(raw.trim())
  if (!match) {
    return { value: null, error: 'Informe a data no formato dd/mm/aa (ex.: 04/09/26).' }
  }
  const day = Number(match[1])
  const month = Number(match[2])
  const year = 2000 + Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { value: null, error: 'Data inválida.' }
  }
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { value: iso, error: null }
}
