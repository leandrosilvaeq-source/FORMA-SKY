import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildStorageKey,
  clampWidth,
  clearStoredWidths,
  normalizeColumnWidths,
  readStoredWidths,
  totalWidth,
  writeStoredWidths,
  type ColumnWidthSpec,
} from './columnWidths'

const specs: ColumnWidthSpec[] = [
  { id: 'name', defaultWidth: 200, minWidth: 100, maxWidth: 500 },
  { id: 'status', defaultWidth: 120, minWidth: 80, maxWidth: 300 },
]

beforeEach(() => {
  window.localStorage.clear()
})

describe('clampWidth', () => {
  it('mantém o valor quando está dentro dos limites', () => {
    expect(clampWidth(250, specs[0])).toBe(250)
  })

  it('limite mínimo: valor abaixo do mínimo vira o mínimo', () => {
    expect(clampWidth(10, specs[0])).toBe(100)
  })

  it('limite máximo: valor acima do máximo vira o máximo', () => {
    expect(clampWidth(9999, specs[0])).toBe(500)
  })

  it('NaN/Infinity caem no default da spec, nunca propagam', () => {
    expect(clampWidth(Number.NaN, specs[0])).toBe(200)
    expect(clampWidth(Number.POSITIVE_INFINITY, specs[0])).toBe(200)
  })

  it('arredonda para inteiro', () => {
    expect(clampWidth(150.7, specs[0])).toBe(151)
  })
})

describe('normalizeColumnWidths', () => {
  it('raw nulo/ausente usa o default de cada coluna', () => {
    expect(normalizeColumnWidths(specs, null)).toEqual({ name: 200, status: 120 })
    expect(normalizeColumnWidths(specs, undefined)).toEqual({ name: 200, status: 120 })
  })

  it('coluna nova (sem entrada no raw) usa o default — nunca quebra', () => {
    expect(normalizeColumnWidths(specs, { name: 300 })).toEqual({ name: 300, status: 120 })
  })

  it('coluna removida (existe no raw, não existe mais nas specs) é descartada', () => {
    const result = normalizeColumnWidths([specs[0]], { name: 300, status: 999, legacy: 50 })
    expect(result).toEqual({ name: 300 })
  })

  it('valor fora dos limites é normalizado (clamp)', () => {
    expect(normalizeColumnWidths(specs, { name: 10, status: 9999 })).toEqual({ name: 100, status: 300 })
  })

  it('valor que não é number (string, null, objeto) cai no default', () => {
    const result = normalizeColumnWidths(specs, { name: '300' as unknown as number, status: null as unknown as number })
    expect(result).toEqual({ name: 200, status: 120 })
  })
})

describe('totalWidth', () => {
  it('soma as larguras de todas as colunas', () => {
    expect(totalWidth(specs, { name: 250, status: 150 })).toBe(400)
  })

  it('coluna ausente no mapa usa o default da spec na soma', () => {
    expect(totalWidth(specs, { name: 250 })).toBe(250 + 120)
  })
})

describe('buildStorageKey', () => {
  it('isola por versão do esquema, usuário e tabela', () => {
    expect(buildStorageKey('orders', 'user-1')).toBe('forma-sky:table-column-widths:v1:user-1:orders')
  })

  it('usuário nulo (sessão ainda não resolvida) usa "anon", nunca lança', () => {
    expect(buildStorageKey('orders', null)).toBe('forma-sky:table-column-widths:v1:anon:orders')
  })

  it('tabelas diferentes produzem chaves diferentes para o mesmo usuário', () => {
    expect(buildStorageKey('orders', 'user-1')).not.toBe(buildStorageKey('customers', 'user-1'))
  })

  it('usuários diferentes produzem chaves diferentes para a mesma tabela', () => {
    expect(buildStorageKey('orders', 'user-1')).not.toBe(buildStorageKey('orders', 'user-2'))
  })
})

describe('readStoredWidths / writeStoredWidths / clearStoredWidths — round-trip', () => {
  it('sem nada gravado ainda, lê os defaults', () => {
    expect(readStoredWidths(specs, 'orders', 'user-1')).toEqual({ name: 200, status: 120 })
  })

  it('grava e lê de volta os mesmos valores (round-trip)', () => {
    writeStoredWidths('orders', 'user-1', { name: 260, status: 140 })
    expect(readStoredWidths(specs, 'orders', 'user-1')).toEqual({ name: 260, status: 140 })
  })

  it('isolamento entre tabelas: gravar em "orders" não afeta "customers"', () => {
    writeStoredWidths('orders', 'user-1', { name: 260, status: 140 })
    expect(readStoredWidths(specs, 'customers', 'user-1')).toEqual({ name: 200, status: 120 })
  })

  it('isolamento entre usuários: gravar para user-1 não afeta user-2 na mesma tabela', () => {
    writeStoredWidths('orders', 'user-1', { name: 260, status: 140 })
    expect(readStoredWidths(specs, 'orders', 'user-2')).toEqual({ name: 200, status: 120 })
  })

  it('JSON corrompido (texto inválido) usa os defaults com segurança, nunca lança', () => {
    window.localStorage.setItem(buildStorageKey('orders', 'user-1'), '{not valid json')
    expect(() => readStoredWidths(specs, 'orders', 'user-1')).not.toThrow()
    expect(readStoredWidths(specs, 'orders', 'user-1')).toEqual({ name: 200, status: 120 })
  })

  it('JSON válido mas de formato inesperado (array, número, string) usa os defaults', () => {
    const key = buildStorageKey('orders', 'user-1')
    window.localStorage.setItem(key, JSON.stringify([1, 2, 3]))
    expect(readStoredWidths(specs, 'orders', 'user-1')).toEqual({ name: 200, status: 120 })

    window.localStorage.setItem(key, JSON.stringify(42))
    expect(readStoredWidths(specs, 'orders', 'user-1')).toEqual({ name: 200, status: 120 })

    window.localStorage.setItem(key, JSON.stringify('oops'))
    expect(readStoredWidths(specs, 'orders', 'user-1')).toEqual({ name: 200, status: 120 })
  })

  it('valores gravados fora dos limites atuais são normalizados na leitura', () => {
    window.localStorage.setItem(buildStorageKey('orders', 'user-1'), JSON.stringify({ name: 5, status: 99999 }))
    expect(readStoredWidths(specs, 'orders', 'user-1')).toEqual({ name: 100, status: 300 })
  })

  it('"Restaurar larguras" (clearStoredWidths) apaga só a preferência daquela tabela', () => {
    writeStoredWidths('orders', 'user-1', { name: 260, status: 140 })
    writeStoredWidths('customers', 'user-1', { name: 280 })

    clearStoredWidths('orders', 'user-1')

    expect(readStoredWidths(specs, 'orders', 'user-1')).toEqual({ name: 200, status: 120 })
    expect(readStoredWidths([specs[0]], 'customers', 'user-1')).toEqual({ name: 280 })
  })
})
