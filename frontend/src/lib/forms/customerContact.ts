// Normalização de contato de clientes (Instagram/WhatsApp) — funções puras,
// extraídas de components/customers/CustomerForm.tsx para cá porque
// CustomersPage.tsx (listagem) também precisa das mesmas regras, só para
// APRESENTAÇÃO (nunca grava no banco). Importar direto de CustomerForm.tsx
// (um componente) ampliaria o acoplamento página↔formulário e os warnings
// de react-refresh/only-export-components; este módulo não exporta nenhum
// componente, então não gera esse warning em lugar nenhum.

// Aceita @usuario, usuario, ou um link do perfil (com/sem protocolo, com/sem
// www, com/sem barra final, com query string/hash) e devolve sempre
// "@usuario" — formato canônico escolhido para customers.instagram (coluna
// text livre, sem formato anterior imposto pelo contrato). String vazia
// entra e sai vazia (o chamador decide null/'—', igual aos demais campos).
export function normalizeInstagramHandle(raw: string): string {
  let value = raw.trim()
  if (!value) return ''

  const urlMatch = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/i.exec(value)
  if (urlMatch) {
    value = urlMatch[1]
  }

  value = value
    .replace(/^@/, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '')

  return value ? `@${value}` : ''
}

// Nomes de usuário reais do Instagram: letras, dígitos, ponto e underscore,
// 1 a 30 caracteres (regra pública da própria plataforma). Usado só pela
// listagem para decidir se um valor já salvo (possivelmente digitado à mão,
// sem nenhuma validação no momento do cadastro) é seguro o bastante para
// virar link — nunca usado por normalizeInstagramHandle nem por
// CustomerForm ao gravar, que continuam aceitando qualquer texto não vazio.
const INSTAGRAM_HANDLE_PATTERN = /^@[a-zA-Z0-9._]{1,30}$/

export function isValidInstagramHandle(normalized: string): boolean {
  return INSTAGRAM_HANDLE_PATTERN.test(normalized)
}

// Formato canônico E.164 brasileiro (+55DDDNÚMERO): só reconhece um
// resultado como "totalmente normalizado" quando bate exatamente com isso.
const WHATSAPP_E164_PATTERN = /^\+55\d{10,11}$/

export function isValidWhatsAppNumber(value: string): boolean {
  return WHATSAPP_E164_PATTERN.test(value)
}

// Aceita número puro, com parênteses/espaços/hífens, com ou sem +55/55 na
// frente, ou um link wa.me (com/sem protocolo/www) — e devolve sempre
// "+55DDDNÚMERO" (E.164 Brasil), formato canônico escolhido para
// customers.whatsapp (coluna text livre, sem formato anterior imposto pelo
// contrato). String vazia entra e sai vazia (o chamador decide null/'—',
// igual aos demais campos).
export function normalizeWhatsAppNumber(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const waMeMatch = /(?:https?:\/\/)?(?:www\.)?wa\.me\/(\+?[\d\s()-]+)/i.exec(trimmed)
  const source = waMeMatch ? waMeMatch[1] : trimmed

  const digits = source.replace(/\D/g, '')
  const withoutCountryCode = digits.startsWith('55') ? digits.slice(2) : digits
  // "55" só é tratado como código de país quando o restante tem o tamanho de
  // um número de celular (11: DDD + 9 dígitos) ou fixo (10: DDD + 8 dígitos)
  // brasileiro — evita remover um "55" que por coincidência abra um número
  // mais curto/incompleto.
  const nationalNumber =
    digits.startsWith('55') && (withoutCountryCode.length === 10 || withoutCountryCode.length === 11)
      ? withoutCountryCode
      : digits

  if (nationalNumber.length !== 10 && nationalNumber.length !== 11) {
    // Não dá pra reconhecer com segurança um DDD + número brasileiro válido
    // — não inventa/força um +55 sobre algo incompleto ou irreconhecível.
    // Preserva o texto exatamente como digitado (só com trim), igual ao
    // comportamento do campo antes desta mudança, deixando a correção para
    // o usuário (não há validação de WhatsApp no contrato atual).
    return trimmed
  }

  return `+55${nationalNumber}`
}

// Formata um E.164 BR já validado (isValidWhatsAppNumber(value) === true)
// para exibição: "+55 (DDD) 9NNNN-NNNN" (celular) ou "+55 (DDD) NNNN-NNNN"
// (fixo). Puramente apresentacional — nunca grava no banco, nunca chamada
// para um valor que não passou por isValidWhatsAppNumber antes (o chamador
// decide o fallback de texto original quando inválido).
export function formatWhatsAppForDisplay(value: string): string {
  const match = /^\+55(\d{2})(\d{8,9})$/.exec(value)
  if (!match) return value
  const [, ddd, number] = match
  const splitAt = number.length === 9 ? 5 : 4
  return `+55 (${ddd}) ${number.slice(0, splitAt)}-${number.slice(splitAt)}`
}
