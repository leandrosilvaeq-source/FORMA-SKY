import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductionColorsPicker, colorKey, type ProductionColorItem, type ProductionColorsValue } from './ProductionColorsPicker'
import type { FilamentTypeSummary } from '@/types/domain'

// "Cores e filamentos" (migration 20260829180000_add_categories_plate_weight_and_order_colors.sql,
// ainda não aplicada) — a escolha de filamento/cor saiu do cadastro do
// Produto e passou a acontecer aqui, no Pedido, por unidade e por plate.

function filamentFixture(overrides: Partial<FilamentTypeSummary> = {}): FilamentTypeSummary {
  return {
    filament_type_id: 'ft1',
    material: 'PLA',
    manufacturer: 'Voolt3D',
    line: 'Sólida',
    commercial_color: 'Preto',
    color_code: null,
    minimum_stock_grams: null,
    is_active: true,
    total_available_grams: 1000,
    usable_spool_count: 1,
    total_spool_count: 1,
    ...overrides,
  }
}

const ftBlack = filamentFixture({ filament_type_id: 'ft1', commercial_color: 'Preto' })
const ftWhite = filamentFixture({ filament_type_id: 'ft2', commercial_color: 'Branco' })
const ftInactive = filamentFixture({ filament_type_id: 'ft3', commercial_color: 'Cinza', is_active: false })

// Wrapper controlado — o próprio componente é controlled (value/onChange),
// então os testes precisam de um estado real para observar o efeito de
// cliques sucessivos.
function ControlledPicker({
  items,
  filamentTypes,
  initialValue = {},
  disabled,
  frozenMessage,
}: {
  items: ProductionColorItem[]
  filamentTypes: FilamentTypeSummary[]
  initialValue?: ProductionColorsValue
  disabled?: boolean
  frozenMessage?: string
}) {
  const [value, setValue] = useState<ProductionColorsValue>(initialValue)
  return (
    <ProductionColorsPicker
      items={items}
      filamentTypes={filamentTypes}
      value={value}
      onChange={setValue}
      disabled={disabled}
      frozenMessage={frozenMessage}
    />
  )
}

async function openSection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /cores e filamentos/i }))
}

describe('ProductionColorsPicker', () => {
  it('não renderiza nada quando não há nenhum item com plates', () => {
    const { container } = render(<ControlledPicker items={[]} filamentTypes={[ftBlack]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('nasce recolhido; expande ao clicar no cabeçalho, mostrando o aviso informativo', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 1, plateCount: 1 }]
    render(<ControlledPicker items={items} filamentTypes={[ftBlack]} />)

    expect(screen.queryByText(/as cores podem ser definidas agora/i)).not.toBeInTheDocument()

    await openSection(user)

    expect(screen.getByText(/as cores podem ser definidas agora ou antes de iniciar a produção/i)).toBeInTheDocument()
  })

  it('só oferece filamentos ativos para uma seleção nova; um já selecionado que ficou inativo permanece visível e marcado', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 1, plateCount: 1 }]
    render(
      <ControlledPicker
        items={items}
        filamentTypes={[ftBlack, ftWhite, ftInactive]}
        initialValue={{ [colorKey('row-1', 1, 1)]: ['ft3'] }}
      />,
    )
    await openSection(user)

    expect(screen.queryByRole('checkbox', { name: /cinza \(inativo\)/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /cinza \(inativo\)/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('marca/desmarca um filamento ao clicar, atualizando o indicador Completo/Pendente', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 1, plateCount: 1 }]
    render(<ControlledPicker items={items} filamentTypes={[ftBlack]} />)
    await openSection(user)

    expect(screen.getByText('Pendente')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /preto/i }))

    expect(screen.getByRole('checkbox', { name: /preto/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Completo')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /preto/i }))
    expect(screen.getByText('Pendente')).toBeInTheDocument()
  })

  it('permite mais de uma cor no mesmo plate', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 1, plateCount: 1 }]
    render(<ControlledPicker items={items} filamentTypes={[ftBlack, ftWhite]} />)
    await openSection(user)

    await user.click(screen.getByRole('checkbox', { name: /preto/i }))
    await user.click(screen.getByRole('checkbox', { name: /branco/i }))

    expect(screen.getByRole('checkbox', { name: /preto/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: /branco/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('só é "Completo" quando TODA unidade e TODO plate têm ao menos 1 cor', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 2, plateCount: 2 }]
    render(<ControlledPicker items={items} filamentTypes={[ftBlack]} />)
    await openSection(user)

    const groups = screen.getAllByRole('group')
    // 4 grupos (2 unidades x 2 plates) — marca só o primeiro, ainda Pendente.
    await user.click(within(groups[0]).getByRole('checkbox', { name: /preto/i }))
    expect(screen.getByText('Pendente')).toBeInTheDocument()

    for (const group of groups.slice(1)) {
      await user.click(within(group).getByRole('checkbox', { name: /preto/i }))
    }
    expect(screen.getByText('Completo')).toBeInTheDocument()
  })

  it('permite cores diferentes por unidade (Unidade 1 e Unidade 2 independentes)', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 2, plateCount: 1 }]
    render(<ControlledPicker items={items} filamentTypes={[ftBlack, ftWhite]} />)
    await openSection(user)

    const groups = screen.getAllByRole('group')
    await user.click(within(groups[0]).getByRole('checkbox', { name: /preto/i }))
    await user.click(within(groups[1]).getByRole('checkbox', { name: /branco/i }))

    expect(within(groups[0]).getByRole('checkbox', { name: /preto/i })).toHaveAttribute('aria-checked', 'true')
    expect(within(groups[0]).getByRole('checkbox', { name: /branco/i })).toHaveAttribute('aria-checked', 'false')
    expect(within(groups[1]).getByRole('checkbox', { name: /branco/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('"Aplicar cores da Unidade 1 a todas" copia sem confirmação quando as outras unidades estão vazias', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 2, plateCount: 1 }]
    render(<ControlledPicker items={items} filamentTypes={[ftBlack]} />)
    await openSection(user)

    const groups = screen.getAllByRole('group')
    await user.click(within(groups[0]).getByRole('checkbox', { name: /preto/i }))
    await user.click(screen.getByRole('button', { name: /aplicar cores da unidade 1 a todas/i }))

    const groupsAfter = screen.getAllByRole('group')
    expect(within(groupsAfter[1]).getByRole('checkbox', { name: /preto/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('"Aplicar cores da Unidade 1 a todas" pede confirmação quando outra unidade já tem cor, e só sobrescreve após confirmar', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 2, plateCount: 1 }]
    render(
      <ControlledPicker
        items={items}
        filamentTypes={[ftBlack, ftWhite]}
        initialValue={{
          [colorKey('row-1', 1, 1)]: ['ft1'],
          [colorKey('row-1', 2, 1)]: ['ft2'],
        }}
      />,
    )
    await openSection(user)

    await user.click(screen.getByRole('button', { name: /aplicar cores da unidade 1 a todas/i }))
    expect(screen.getByText(/já têm cores selecionadas/i)).toBeInTheDocument()

    const groupsBefore = screen.getAllByRole('group')
    expect(within(groupsBefore[1]).getByRole('checkbox', { name: /branco/i })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: /^sobrescrever$/i }))

    const groupsAfter = screen.getAllByRole('group')
    expect(within(groupsAfter[1]).getByRole('checkbox', { name: /preto/i })).toHaveAttribute('aria-checked', 'true')
    expect(within(groupsAfter[1]).getByRole('checkbox', { name: /branco/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('"Cancelar" na confirmação de sobrescrita não altera nada', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 2, plateCount: 1 }]
    render(
      <ControlledPicker
        items={items}
        filamentTypes={[ftBlack, ftWhite]}
        initialValue={{
          [colorKey('row-1', 1, 1)]: ['ft1'],
          [colorKey('row-1', 2, 1)]: ['ft2'],
        }}
      />,
    )
    await openSection(user)

    await user.click(screen.getByRole('button', { name: /aplicar cores da unidade 1 a todas/i }))
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))

    expect(screen.queryByText(/já têm cores selecionadas/i)).not.toBeInTheDocument()
    const groups = screen.getAllByRole('group')
    expect(within(groups[1]).getByRole('checkbox', { name: /branco/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('"Aplicar a todas" não aparece quando a quantidade é 1 (nada para replicar)', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 1, plateCount: 1 }]
    render(<ControlledPicker items={items} filamentTypes={[ftBlack]} />)
    await openSection(user)

    expect(screen.queryByRole('button', { name: /aplicar cores da unidade 1 a todas/i })).not.toBeInTheDocument()
  })

  it('mostra Completo/Pendente e o rótulo de cada item independentemente, para múltiplos itens', async () => {
    const user = userEvent.setup()
    const items: ProductionColorItem[] = [
      { key: 'row-1', label: 'Chaveiro', quantity: 1, plateCount: 1 },
      { key: 'row-2', label: 'Suporte', quantity: 1, plateCount: 1 },
    ]
    render(
      <ControlledPicker items={items} filamentTypes={[ftBlack]} initialValue={{ [colorKey('row-1', 1, 1)]: ['ft1'] }} />,
    )
    await openSection(user)

    expect(screen.getByText('Chaveiro · 1 unidade')).toBeInTheDocument()
    expect(screen.getByText('Suporte · 1 unidade')).toBeInTheDocument()
    expect(screen.getAllByText('Completo')).toHaveLength(1)
    expect(screen.getAllByText('Pendente')).toHaveLength(1)
  })

  // ---------------------------------------------------------------------
  // Congelamento (rodada corretiva) — frozenMessage/disabled: usado pelo
  // OrderManagementPanel.tsx quando o Pedido já passou do início real da
  // produção (IN_PRODUCTION e além). O componente nunca decide sozinho
  // quando congelar — só reflete o que o chamador manda via props.
  // ---------------------------------------------------------------------
  describe('congelamento (frozenMessage/disabled)', () => {
    it('sem frozenMessage, nasce recolhido e mostra o aviso padrão', () => {
      const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 1, plateCount: 1 }]
      render(<ControlledPicker items={items} filamentTypes={[ftBlack]} />)

      expect(screen.queryByText(/as cores podem ser definidas agora/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('com frozenMessage, nasce ABERTO automaticamente (mostra os dados congelados sem exigir clique extra) e troca o aviso', () => {
      const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 1, plateCount: 1 }]
      render(
        <ControlledPicker
          items={items}
          filamentTypes={[ftBlack]}
          initialValue={{ [colorKey('row-1', 1, 1)]: ['ft1'] }}
          disabled
          frozenMessage="Configuração congelada — só para consulta."
        />,
      )

      expect(screen.queryByText(/as cores podem ser definidas agora/i)).not.toBeInTheDocument()
      expect(screen.getByText('Configuração congelada — só para consulta.')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: /preto/i })).toHaveAttribute('aria-checked', 'true')
    })

    it('disabled=true desabilita todos os checkboxes de filamento, mesmo já selecionados', () => {
      const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 1, plateCount: 1 }]
      render(
        <ControlledPicker
          items={items}
          filamentTypes={[ftBlack, ftWhite]}
          initialValue={{ [colorKey('row-1', 1, 1)]: ['ft1'] }}
          disabled
          frozenMessage="Congelado."
        />,
      )

      expect(screen.getByRole('checkbox', { name: /preto/i })).toBeDisabled()
      expect(screen.getByRole('checkbox', { name: /branco/i })).toBeDisabled()
    })

    it('disabled=true desabilita "Aplicar cores da Unidade 1 a todas"', () => {
      const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 2, plateCount: 1 }]
      render(
        <ControlledPicker
          items={items}
          filamentTypes={[ftBlack]}
          initialValue={{ [colorKey('row-1', 1, 1)]: ['ft1'] }}
          disabled
          frozenMessage="Congelado."
        />,
      )

      expect(screen.getByRole('button', { name: /aplicar cores da unidade 1 a todas/i })).toBeDisabled()
    })

    it('clicar num checkbox desabilitado não altera a seleção (o estado congelado nunca muda por interação do usuário)', async () => {
      const user = userEvent.setup()
      const items: ProductionColorItem[] = [{ key: 'row-1', label: 'Chaveiro', quantity: 1, plateCount: 1 }]
      render(
        <ControlledPicker
          items={items}
          filamentTypes={[ftBlack]}
          initialValue={{ [colorKey('row-1', 1, 1)]: ['ft1'] }}
          disabled
          frozenMessage="Congelado."
        />,
      )

      await user.click(screen.getByRole('checkbox', { name: /preto/i }))

      expect(screen.getByRole('checkbox', { name: /preto/i })).toHaveAttribute('aria-checked', 'true')
    })
  })
})
