import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FilamentColorBadge } from './FilamentColorBadge'

// O mapeamento de cor -> estilo (resolveFilamentColorClassName) tem sua
// própria suíte em lib/inventory/filamentColorStyles.test.ts — aqui só o
// COMPONENTE: renderiza o texto completo cadastrado (nunca um
// círculo/swatch sem texto) e aplica a classe resolvida.
describe('FilamentColorBadge', () => {
  it('renderiza o nome completo da cor como texto, mesmo para um nome composto', () => {
    render(<FilamentColorBadge label="Azul Bambu Lab" />)
    const badge = screen.getByText('Azul Bambu Lab')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('blue')
  })

  it('preserva o texto original exatamente como cadastrado (grafia, espaços internos e tudo)', () => {
    // getByText normaliza espaços internos por padrão — comparação direta
    // do textContent confirma que o DOM real preserva os espaços duplos.
    const { container } = render(<FilamentColorBadge label="Verde  Militar" />)
    expect(container.querySelector('span')?.textContent).toBe('Verde  Militar')
  })

  it('uma cor não reconhecida renderiza com o estilo neutro, nunca com texto invisível', () => {
    render(<FilamentColorBadge label="Holográfico Arco-íris" />)
    const badge = screen.getByText('Holográfico Arco-íris')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('border-input')
    expect(badge.className).toContain('text-muted-foreground')
  })

  it('expõe o nome completo também via atributo title, para tooltip quando a coluna truncar visualmente', () => {
    render(<FilamentColorBadge label="Preto" />)
    expect(screen.getByText('Preto')).toHaveAttribute('title', 'Preto')
  })
})
