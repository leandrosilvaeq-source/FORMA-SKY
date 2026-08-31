// Infraestrutura PURA (sem React) para larguras de coluna redimensionáveis
// e persistidas — usada por usePersistentColumnWidths.ts. Não conhece
// nenhuma regra de Clientes/Empresas/Produtos/Pedidos/Estoque: só recebe
// specs (id/defaultWidth/minWidth/maxWidth) e um tableId+userId para
// isolar a chave de armazenamento.

export interface ColumnWidthSpec {
  id: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
}

export type ColumnWidthMap = Record<string, number>

// Nunca uma largura fora dos limites da spec, nunca NaN/Infinity — qualquer
// valor inválido cai no default da própria spec (mesma disciplina de
// "JSON inválido ou corrompido usa os padrões com segurança").
export function clampWidth(width: number, spec: ColumnWidthSpec): number {
  if (!Number.isFinite(width)) return spec.defaultWidth
  return Math.min(spec.maxWidth, Math.max(spec.minWidth, Math.round(width)))
}

// Reconstrói um mapa de larguras a partir de um valor bruto (ex.: vindo do
// localStorage) contra as specs ATUAIS: coluna nova (sem entrada no bruto)
// usa defaultWidth; coluna removida (existe no bruto, não existe mais nas
// specs) é descartada; valor fora dos limites é normalizado; qualquer
// entrada que não seja um número finito também cai no default.
export function normalizeColumnWidths(
  specs: ColumnWidthSpec[],
  raw: Partial<Record<string, unknown>> | null | undefined,
): ColumnWidthMap {
  const result: ColumnWidthMap = {}
  for (const spec of specs) {
    const rawValue = raw?.[spec.id]
    result[spec.id] = typeof rawValue === 'number' ? clampWidth(rawValue, spec) : spec.defaultWidth
  }
  return result
}

export function totalWidth(specs: ColumnWidthSpec[], widths: ColumnWidthMap): number {
  return specs.reduce((sum, spec) => sum + (widths[spec.id] ?? spec.defaultWidth), 0)
}

// Chave isolada por versão do esquema + usuário + tabela — nunca uma
// preferência de uma tabela vaza para outra, nem de um usuário para outro
// no mesmo navegador. userId ausente (sessão ainda carregando/deslogado)
// usa 'anon' — nunca lança, nunca depende de um usuário já resolvido para
// funcionar (a tabela renderiza normalmente enquanto isso, só sem
// persistência cross-sessão até o usuário ser conhecido).
const SCHEMA_VERSION = 'v1'
const STORAGE_PREFIX = 'forma-sky:table-column-widths'

export function buildStorageKey(tableId: string, userId: string | null): string {
  return `${STORAGE_PREFIX}:${SCHEMA_VERSION}:${userId ?? 'anon'}:${tableId}`
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

// localStorage indisponível, JSON corrompido ou de formato inesperado
// nunca impede a renderização — sempre cai nos defaults, silenciosamente.
export function readStoredWidths(specs: ColumnWidthSpec[], tableId: string, userId: string | null): ColumnWidthMap {
  const defaults = normalizeColumnWidths(specs, null)
  if (!isBrowserStorageAvailable()) return defaults
  try {
    const raw = window.localStorage.getItem(buildStorageKey(tableId, userId))
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaults
    return normalizeColumnWidths(specs, parsed as Partial<Record<string, unknown>>)
  } catch {
    return defaults
  }
}

// Nunca persiste a cada pixel — chamado só ao soltar o arraste (commit) ou
// num passo discreto de teclado. Falha de escrita (quota excedida,
// navegador privado) nunca propaga: a tabela continua funcional só com o
// estado em memória daquela sessão.
export function writeStoredWidths(tableId: string, userId: string | null, widths: ColumnWidthMap): void {
  if (!isBrowserStorageAvailable()) return
  try {
    window.localStorage.setItem(buildStorageKey(tableId, userId), JSON.stringify(widths))
  } catch {
    // intencionalmente silencioso — ver comentário acima.
  }
}

// "Restaurar larguras": apaga só a preferência desta tabela — nunca as
// demais chaves do localStorage (filtros/ordenação de outras telas nunca
// usam este prefixo, então nunca são afetadas).
export function clearStoredWidths(tableId: string, userId: string | null): void {
  if (!isBrowserStorageAvailable()) return
  try {
    window.localStorage.removeItem(buildStorageKey(tableId, userId))
  } catch {
    // intencionalmente silencioso.
  }
}
