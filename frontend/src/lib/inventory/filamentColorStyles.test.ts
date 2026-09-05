import { describe, expect, it } from 'vitest'
import { resolveFilamentColorClassName } from './filamentColorStyles'

describe('resolveFilamentColorClassName', () => {
  it('Preto recebe um estilo escuro próprio (badge sólida, nunca a mesma classe de outra cor)', () => {
    const className = resolveFilamentColorClassName('Preto')
    expect(className).toContain('neutral-800')
    expect(className).not.toBe(resolveFilamentColorClassName('Branco'))
  })

  it('"Azul claro" recebe um estilo azul (variante clara), distinto do "Azul" simples', () => {
    const claro = resolveFilamentColorClassName('Azul claro')
    const simples = resolveFilamentColorClassName('Azul')
    expect(claro).toContain('sky')
    expect(simples).toContain('blue')
    expect(claro).not.toBe(simples)
  })

  it('"Azul escuro" e "Cinza escuro" (variações compostas pedidas) também são reconhecidos', () => {
    expect(resolveFilamentColorClassName('Azul escuro')).toContain('blue')
    expect(resolveFilamentColorClassName('Cinza escuro')).toContain('gray')
    expect(resolveFilamentColorClassName('Cinza escuro')).not.toBe(
      resolveFilamentColorClassName('Cinza'),
    )
  })

  it('Dourado usa um tom de texto mais escuro (text-*-900) para permanecer legível sobre fundo claro', () => {
    expect(resolveFilamentColorClassName('Dourado')).toContain('text-yellow-900')
  })

  it('Amarelo também usa um tom de texto mais escuro (text-*-900), mesmo pedido de legibilidade', () => {
    expect(resolveFilamentColorClassName('Amarelo')).toContain('text-yellow-900')
  })

  it('Branco nunca fica com fundo branco puro sobre o fundo branco da página — usa fundo/borda visíveis', () => {
    const className = resolveFilamentColorClassName('Branco')
    expect(className).not.toContain('bg-white')
    expect(className).toMatch(/bg-slate-50/)
    expect(className).toMatch(/border-slate-400/)
  })

  it('busca a cor ignorando maiúsculas/minúsculas, acentos e espaços extras', () => {
    const reference = resolveFilamentColorClassName('Preto')
    expect(resolveFilamentColorClassName('preto')).toBe(reference)
    expect(resolveFilamentColorClassName('PRETO')).toBe(reference)
    expect(resolveFilamentColorClassName('  Preto  ')).toBe(reference)
    const rosaClaroReference = resolveFilamentColorClassName('Rosa claro')
    expect(resolveFilamentColorClassName('  ROSA   CLARO  ')).toBe(rosaClaroReference)
  })

  it('nome composto usa a cor principal reconhecida no texto (ex.: "Azul Bambu Lab" -> estilo azul)', () => {
    expect(resolveFilamentColorClassName('Azul Bambu Lab')).toContain('blue')
  })

  it('cor desconhecida usa o mesmo estilo neutro dos badges "Inativo"/"Arquivado" desta área', () => {
    expect(resolveFilamentColorClassName('Holográfico Arco-íris')).toBe(
      'border-input text-muted-foreground',
    )
  })

  it('todas as 17 cores do mapeamento inicial pedido resolvem para um estilo próprio (nunca caem no neutro)', () => {
    const initialColors = [
      'Preto',
      'Branco',
      'Cinza',
      'Vermelho',
      'Azul',
      'Verde',
      'Amarelo',
      'Laranja',
      'Roxo',
      'Rosa',
      'Marrom',
      'Bege',
      'Dourado',
      'Prateado',
      'Bronze',
      'Transparente',
      'Natural',
    ]
    const unknownClassName = resolveFilamentColorClassName('Holográfico Arco-íris')
    for (const color of initialColors) {
      expect(resolveFilamentColorClassName(color)).not.toBe(unknownClassName)
    }
  })
})
