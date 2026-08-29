import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductForm, type ProductFormInitialValues } from './ProductForm'
import { formatCentsToBRL } from '@/lib/forms/currencyField'
import type { Accessory, FilamentTypeSummary, Packaging } from '@/types/domain'

// Estrutura produtiva por plates (2026-08-29, migration
// 20260829160000_add_product_plates_structure.sql, ainda não aplicada) —
// fixtures mínimas para os 3 tipos de dado que o novo formulário consome
// (filamentos ativos, acessórios ativos, embalagens ativas).
const filamentTypes: FilamentTypeSummary[] = [
  {
    filament_type_id: 'ft1',
    material: 'PLA',
    manufacturer: '3D Fila',
    line: 'Basic',
    commercial_color: 'Preto',
    color_code: null,
    minimum_stock_grams: null,
    is_active: true,
    total_available_grams: 1000,
    usable_spool_count: 2,
    total_spool_count: 2,
  },
  {
    filament_type_id: 'ft2',
    material: 'PETG',
    manufacturer: '3D Fila',
    line: 'Premium',
    commercial_color: 'Branco',
    color_code: null,
    minimum_stock_grams: null,
    is_active: true,
    total_available_grams: 500,
    usable_spool_count: 1,
    total_spool_count: 1,
  },
]

const accessoriesList: Accessory[] = [
  {
    id: 'a1',
    name: 'Chaveiro metálico',
    material: null,
    size: null,
    variant: null,
    unit_cost: null,
    minimum_stock: null,
    current_stock: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
]

const packagingList: Packaging[] = [
  {
    id: 'k1',
    name: 'Saco plástico',
    material: null,
    size: null,
    variant: null,
    unit_cost: null,
    minimum_stock: null,
    current_stock: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
]

function renderForm(overrides: Partial<Parameters<typeof ProductForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <ProductForm
      filamentTypes={filamentTypes}
      accessoriesList={accessoriesList}
      packagingList={packagingList}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onCancel }
}

async function fillNameAndPrice(user: ReturnType<typeof userEvent.setup>, priceDigits = '2500') {
  await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
  await user.type(screen.getByLabelText(/^preço$/i), priceDigits)
}

describe('ProductForm', () => {
  it('renderiza as 3 seções (Dados Gerais, Composição, Acessórios e Embalagem)', () => {
    renderForm()

    expect(screen.getByRole('heading', { name: 'Dados Gerais' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Composição' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Acessórios e Embalagem' })).toBeInTheDocument()
  })

  it('renderiza os campos de Dados Gerais, sem Peso/Tempo soltos (migraram para Composição)', () => {
    renderForm()

    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/categoria/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/descrição/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^preço$/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^peso total \(g\)$/i)).not.toBeInTheDocument()
  })

  it('nasce com exatamente 1 plate (Plate 1)', () => {
    renderForm()

    expect(screen.getByText('Plate 1')).toBeInTheDocument()
    expect(screen.queryByText('Plate 2')).not.toBeInTheDocument()
  })

  it('shows a validation error and does not submit when name is empty', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^preço$/i), '10')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(await screen.findByText(/informe o nome do produto/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  describe('preço — mesmo campo bancário aprovado em ProductPriceForm', () => {
    it('começa em R$ 0,00', () => {
      renderForm()
      expect(screen.getByLabelText(/^preço$/i)).toHaveValue(formatCentsToBRL(0))
    })

    it('bloqueia o envio sem preço informado', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
      await user.click(screen.getByRole('button', { name: /salvar/i }))
      expect(await screen.findByText(/informe o preço/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('Número de plates', () => {
    it('o botão "Diminuir" fica desabilitado com só 1 plate (mínimo 1, nunca 0/negativo)', () => {
      renderForm()
      expect(screen.getByRole('button', { name: /diminuir número de plates/i })).toBeDisabled()
    })

    it('"Aumentar" cria um novo plate numerado sequencialmente', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('button', { name: /aumentar número de plates/i }))
      expect(screen.getByText('Plate 2')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /aumentar número de plates/i }))
      expect(screen.getByText('Plate 3')).toBeInTheDocument()
    })

    it('remove um plate VAZIO diretamente, sem pedir confirmação', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('button', { name: /aumentar número de plates/i }))
      expect(screen.getByText('Plate 2')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /remover plate 2/i }))
      expect(screen.queryByText('Plate 2')).not.toBeInTheDocument()
      expect(screen.queryByText(/tem dados preenchidos/i)).not.toBeInTheDocument()
    })

    it('pede confirmação antes de remover um plate PREENCHIDO (com tempo informado) — nunca apaga composição preenchida silenciosamente', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('button', { name: /aumentar número de plates/i }))
      const plate2Time = screen.getAllByLabelText(/tempo de produção/i)[1]
      await user.type(plate2Time, '01:00')

      await user.click(screen.getByRole('button', { name: /remover plate 2/i }))
      expect(await screen.findByText(/tem dados preenchidos/i)).toBeInTheDocument()
      expect(screen.getByText('Plate 2')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^remover$/i }))
      expect(screen.queryByText('Plate 2')).not.toBeInTheDocument()
    })
  })

  describe('composição de filamentos por plate', () => {
    it('só oferece filamentos ativos', () => {
      renderForm()
      // Só ft1/ft2 (ambos ativos nesta fixture) — nenhum "(inativo)" no
      // rótulo de nenhuma opção oferecida por padrão.
      expect(screen.queryByText(/inativo/i)).not.toBeInTheDocument()
    })

    it('impede o mesmo filamento duas vezes NO MESMO plate, mas permite o mesmo filamento em plates diferentes', async () => {
      const user = userEvent.setup()
      renderForm()

      // Plate 1: seleciona ft1 na primeira linha, adiciona uma segunda
      // linha — ft1 não deveria mais aparecer como opção nessa segunda
      // linha (já escolhido no mesmo plate).
      const firstSelect = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[0]
      await user.click(firstSelect)
      await user.click(await screen.findByRole('option', { name: /PLA · 3D Fila · Basic · Preto/i }))

      await user.click(screen.getByRole('button', { name: /adicionar filamento/i }))
      const secondSelect = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[1]
      await user.click(secondSelect)
      expect(screen.queryByRole('option', { name: /PLA · 3D Fila · Basic · Preto/i })).not.toBeInTheDocument()
      expect(screen.getByRole('option', { name: /PETG · 3D Fila · Premium · Branco/i })).toBeInTheDocument()
    })

    it('bloqueia o envio com peso zero/negativo numa linha de filamento preenchida', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await fillNameAndPrice(user)

      const select = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[0]
      await user.click(select)
      await user.click(await screen.findByRole('option', { name: /PLA/i }))
      await user.type(screen.getAllByLabelText('Peso (g)')[0], '0')

      await user.click(screen.getByRole('button', { name: /salvar/i }))
      expect(await screen.findByText(/deve ser maior ou igual a 0.01/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('totais automáticos — exemplo de aceite (Suporte para Controle PS5)', () => {
    it('37,16 g + 97,34 g = 134,50 g; 01:17 + 02:54 = 04:11', async () => {
      const user = userEvent.setup()
      renderForm()

      // Plate 1: preto, 37,16 g, 01:17.
      const select1 = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[0]
      await user.click(select1)
      await user.click(await screen.findByRole('option', { name: /PLA · 3D Fila · Basic · Preto/i }))
      await user.type(screen.getAllByLabelText('Peso (g)')[0], '37.16')
      await user.type(screen.getAllByLabelText(/tempo de produção/i)[0], '01:17')

      // Plate 2: branco, 97,34 g, 02:54.
      await user.click(screen.getByRole('button', { name: /aumentar número de plates/i }))
      const select2 = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[1]
      await user.click(select2)
      await user.click(await screen.findByRole('option', { name: /PETG · 3D Fila · Premium · Branco/i }))
      await user.type(screen.getAllByLabelText('Peso (g)')[1], '97.34')
      await user.type(screen.getAllByLabelText(/tempo de produção/i)[1], '02:54')

      expect(screen.getByText('134,5 g')).toBeInTheDocument()
      expect(screen.getByText('04:11')).toBeInTheDocument()
    })
  })

  describe('ajuste manual de totais ("Ajustar totais" / "Usar cálculo automático")', () => {
    async function fillTwoPlates(user: ReturnType<typeof userEvent.setup>) {
      const select1 = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[0]
      await user.click(select1)
      await user.click(await screen.findByRole('option', { name: /PLA · 3D Fila · Basic · Preto/i }))
      await user.type(screen.getAllByLabelText('Peso (g)')[0], '37.16')
      await user.type(screen.getAllByLabelText(/tempo de produção/i)[0], '01:17')

      await user.click(screen.getByRole('button', { name: /aumentar número de plates/i }))
      const select2 = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[1]
      await user.click(select2)
      await user.click(await screen.findByRole('option', { name: /PETG · 3D Fila · Premium · Branco/i }))
      await user.type(screen.getAllByLabelText('Peso (g)')[1], '97.34')
      await user.type(screen.getAllByLabelText(/tempo de produção/i)[1], '02:54')
    }

    it('"Ajustar totais" permite editar o peso efetivo (134,49 g) preservando o tempo calculado (04:11) e mostra "Ajustado manualmente"', async () => {
      const user = userEvent.setup()
      renderForm()
      await fillTwoPlates(user)

      await user.click(screen.getByRole('button', { name: /ajustar totais/i }))
      const weightOverride = screen.getByLabelText(/peso efetivo/i)
      await user.clear(weightOverride)
      await user.type(weightOverride, '134.49')

      expect(screen.getByText('134,49 g')).toBeInTheDocument()
      expect(screen.getByText('04:11')).toBeInTheDocument()
      expect(screen.getByText(/ajustado manualmente/i)).toBeInTheDocument()
      // O sistema continua exibindo o valor calculado pelos plates (134,50 g).
      expect(screen.getByText(/calculado pelos plates: 134,5 g/i)).toBeInTheDocument()
    })

    it('"Usar cálculo automático" remove o ajuste e volta a mostrar a soma dos plates', async () => {
      const user = userEvent.setup()
      renderForm()
      await fillTwoPlates(user)

      await user.click(screen.getByRole('button', { name: /ajustar totais/i }))
      const weightOverride = screen.getByLabelText(/peso efetivo/i)
      await user.clear(weightOverride)
      await user.type(weightOverride, '999')

      await user.click(screen.getByRole('button', { name: /usar cálculo automático/i }))

      expect(screen.getByText('134,5 g')).toBeInTheDocument()
      expect(screen.queryByText(/ajustado manualmente/i)).not.toBeInTheDocument()
    })
  })

  it('submete com o payload correto (plates + totais + acessórios/embalagens vazios por padrão)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await fillNameAndPrice(user)

    const select = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[0]
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: /PLA/i }))
    await user.type(screen.getAllByLabelText('Peso (g)')[0], '50')
    await user.type(screen.getAllByLabelText(/tempo de produção/i)[0], '01:00')

    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chaveiro',
        product_type: 'CATALOG',
        default_price: 25,
        manual_weight_override_grams: null,
        manual_time_override_seconds: null,
        accessories: [],
        packaging: [],
        plates: [{ production_time_seconds: 3600, filaments: [{ filament_type_id: 'ft1', weight_grams: 50 }] }],
      }),
    )
  })

  describe('Acessórios e Embalagem', () => {
    it('abre o seletor, escolhe um acessório e uma embalagem, e mostra o resumo com nome/tipo/quantidade', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('button', { name: /selecionar acessórios e embalagens/i }))
      expect(screen.getByRole('dialog', { name: /selecionar acessórios e embalagens/i })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))
      const accessorySelect = screen.getByRole('combobox', { name: 'Acessório' })
      await user.click(accessorySelect)
      await user.click(await screen.findByRole('option', { name: 'Chaveiro metálico' }))
      const accessoryQty = screen.getByRole('combobox', { name: 'Quantidade do acessório' })
      await user.click(accessoryQty)
      await user.click(await screen.findByRole('option', { name: '2' }))

      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(screen.queryByRole('dialog', { name: /selecionar acessórios e embalagens/i })).not.toBeInTheDocument()
      expect(screen.getByText(/Chaveiro metálico · Acessório · Qtd\. 2/)).toBeInTheDocument()
    })

    it('"Remover" no resumo tira o item sem reabrir o seletor', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('button', { name: /selecionar acessórios e embalagens/i }))
      await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))
      await user.click(screen.getByRole('combobox', { name: 'Acessório' }))
      await user.click(await screen.findByRole('option', { name: 'Chaveiro metálico' }))
      await user.click(screen.getByRole('combobox', { name: 'Quantidade do acessório' }))
      await user.click(await screen.findByRole('option', { name: '1' }))
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(screen.getByText(/Chaveiro metálico/)).toBeInTheDocument()
      const summaryItem = screen.getByText(/Chaveiro metálico/).closest('li') as HTMLElement
      await user.click(within(summaryItem).getByRole('button', { name: /remover/i }))

      expect(screen.queryByText(/Chaveiro metálico/)).not.toBeInTheDocument()
    })
  })

  describe('modo edição', () => {
    function editInitialValues(): ProductFormInitialValues {
      return {
        name: 'Suporte PS5',
        category: 'Gamer',
        description: 'Suporte de parede',
        defaultPrice: 60,
        allowsPersonalization: false,
        productType: 'CATALOG',
        plates: [],
        manualWeightOverrideGrams: null,
        manualTimeOverrideSeconds: null,
        accessories: [],
        packaging: [],
      }
    }

    it('pré-preenche Dados Gerais e nasce com 1 plate quando o produto editado não tinha nenhum', () => {
      renderForm({ mode: 'edit', initialValues: editInitialValues() })

      expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Suporte PS5')
      expect(screen.getByLabelText(/^preço$/i)).toHaveValue(formatCentsToBRL(6000))
      expect(screen.getByText('Plate 1')).toBeInTheDocument()
    })

    it('o botão de submit mostra "Salvar alterações"', () => {
      renderForm({ mode: 'edit', initialValues: editInitialValues() })
      expect(screen.getByRole('button', { name: /salvar alterações/i })).toBeInTheDocument()
    })
  })

  it('chama onCancel ao clicar em Cancelar', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('exibe o erro real do backend (submitError) sem apagar os dados preenchidos', async () => {
    const user = userEvent.setup()
    renderForm({ submitError: 'Erro real do backend' })

    await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
    expect(screen.getByText('Erro real do backend')).toBeInTheDocument()
    expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Chaveiro')
  })

  it('duplo envio bloqueado: isSubmitting desabilita o botão de salvar', () => {
    renderForm({ isSubmitting: true })
    expect(screen.getByRole('button', { name: /salvando/i })).toBeDisabled()
  })
})
