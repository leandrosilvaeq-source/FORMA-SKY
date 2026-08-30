import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductForm, type ProductFormInitialValues } from './ProductForm'
import { formatCentsToBRL } from '@/lib/forms/currencyField'
import type { Accessory, Packaging } from '@/types/domain'

// Migration 20260829180000_add_categories_plate_weight_and_order_colors.sql
// (ainda não aplicada) retirou toda composição de filamento do cadastro do
// Produto (peso do plate agora é um campo direto) e substituiu a categoria
// única por múltiplas categorias (chips) — este arquivo cobre o NOVO
// contrato. a2/k2 são deliberadamente INATIVOS — usados pelos testes de
// "item vinculado que ficou inativo" em Acessórios/Embalagens (inalterado
// por esta rodada).
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
  {
    id: 'a2',
    name: 'Ímã de geladeira',
    material: null,
    size: null,
    variant: null,
    unit_cost: null,
    minimum_stock: null,
    current_stock: 0,
    is_active: false,
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
  {
    id: 'k2',
    name: 'Caixa de papelão',
    material: null,
    size: null,
    variant: null,
    unit_cost: null,
    minimum_stock: null,
    current_stock: 0,
    is_active: false,
    created_at: '',
    updated_at: '',
  },
]

function renderForm(overrides: Partial<Parameters<typeof ProductForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const utils = render(
    <ProductForm
      accessoriesList={accessoriesList}
      packagingList={packagingList}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onCancel, unmount: utils.unmount }
}

async function fillNameAndPrice(user: ReturnType<typeof userEvent.setup>, priceDigits = '2500') {
  await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
  await user.type(screen.getByLabelText(/^preço$/i), priceDigits)
}

// Clica numa opção de um grupo de seleção exclusiva (role=radiogroup) —
// só Tipo do produto continua exclusivo; Categorias virou um grupo de
// checkboxes (toggle, múltiplas seleções), ver clickCategoryChip abaixo.
async function clickRadio(
  user: ReturnType<typeof userEvent.setup>,
  groupName: string,
  optionName: string,
): Promise<void> {
  const group = screen.getByRole('radiogroup', { name: groupName })
  await user.click(within(group).getByRole('radio', { name: optionName }))
}

async function clickCategoryChip(user: ReturnType<typeof userEvent.setup>, optionName: string): Promise<void> {
  const group = screen.getByRole('group', { name: 'Categorias' })
  await user.click(within(group).getByRole('checkbox', { name: optionName }))
}

function baseEditInitialValues(overrides: Partial<ProductFormInitialValues> = {}): ProductFormInitialValues {
  return {
    name: 'Suporte PS5',
    categories: ['Gamer'],
    description: 'Suporte de parede',
    defaultPrice: 60,
    allowsPersonalization: false,
    productType: 'CATALOG',
    plates: [],
    manualWeightOverrideGrams: null,
    manualTimeOverrideSeconds: null,
    accessories: [],
    packaging: [],
    ...overrides,
  }
}

async function fillPlateWeight(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  weight: string,
): Promise<void> {
  await user.type(screen.getAllByLabelText(/^peso \(g\)$/i)[index], weight)
}

async function fillTwoPlates(user: ReturnType<typeof userEvent.setup>) {
  await fillPlateWeight(user, 0, '37.16')
  await user.type(screen.getAllByLabelText(/tempo de produção/i)[0], '01:17')

  await user.click(screen.getByRole('button', { name: /aumentar número de plates/i }))
  await fillPlateWeight(user, 1, '97.34')
  await user.type(screen.getAllByLabelText(/tempo de produção/i)[1], '02:54')
}

describe('ProductForm', () => {
  it('renderiza as 3 seções (Dados Gerais, Composição, Acessórios e Embalagem)', () => {
    renderForm()

    expect(screen.getByRole('heading', { name: 'Dados Gerais' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Composição' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Acessórios e Embalagem' })).toBeInTheDocument()
  })

  it('renderiza os campos de Dados Gerais, sem Peso/Tempo soltos (migraram para Composição) e sem nenhum campo de filamento', () => {
    renderForm()

    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/descrição/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^preço$/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^peso total \(g\)$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Tipo de filamento' })).not.toBeInTheDocument()
  })

  it('a ordem visual dos campos de Dados Gerais segue Nome, Tipo do produto, Categorias, Descrição, Preço', () => {
    renderForm()

    const labels = screen.getAllByText(/^(Nome|Tipo do produto|Categorias|Descrição|Preço)$/)
    expect(labels.map((label) => label.textContent)).toEqual([
      'Nome',
      'Tipo do produto',
      'Categorias',
      'Descrição',
      'Preço',
    ])
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

    it('digitar 2500 produz R$ 25,00 (dígitos entram pela direita, como centavos)', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.type(screen.getByLabelText(/^preço$/i), '2500')

      expect(screen.getByLabelText(/^preço$/i)).toHaveValue(formatCentsToBRL(2500))
    })

    it('Backspace remove o último dígito (centavo)', async () => {
      const user = userEvent.setup()
      renderForm()

      const priceInput = screen.getByLabelText(/^preço$/i)
      await user.type(priceInput, '2500')
      await user.type(priceInput, '{Backspace}')

      expect(priceInput).toHaveValue(formatCentsToBRL(250))
    })

    it('Delete também remove o último dígito', async () => {
      const user = userEvent.setup()
      renderForm()

      const priceInput = screen.getByLabelText(/^preço$/i)
      await user.type(priceInput, '2500')
      await user.type(priceInput, '{Delete}')

      expect(priceInput).toHaveValue(formatCentsToBRL(250))
    })

    it('cursor sempre reposicionado ao final após digitar', async () => {
      const user = userEvent.setup()
      renderForm()

      const priceInput = screen.getByLabelText(/^preço$/i) as HTMLInputElement
      await user.type(priceInput, '2500')

      expect(priceInput.selectionStart).toBe(priceInput.value.length)
      expect(priceInput.selectionEnd).toBe(priceInput.value.length)
    })

    it('colar "25,90" preenche R$ 25,90', async () => {
      const user = userEvent.setup()
      renderForm()

      const priceInput = screen.getByLabelText(/^preço$/i)
      await user.click(priceInput)
      await user.paste('25,90')

      expect(priceInput).toHaveValue(formatCentsToBRL(2590))
    })

    it('teto MAX_CENTS: excedente mostra erro e não altera o valor', async () => {
      const user = userEvent.setup()
      renderForm()

      const priceInput = screen.getByLabelText(/^preço$/i)
      await user.type(priceInput, '9999999999')
      await user.type(priceInput, '9')

      expect(await screen.findByText(/não pode ultrapassar/i)).toBeInTheDocument()
    })

    it('bloqueia o envio sem preço informado', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
      await user.click(screen.getByRole('button', { name: /salvar/i }))
      expect(await screen.findByText(/informe o preço/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('preço explicitamente digitado como 0 é válido e envia default_price: 0', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
      const priceInput = screen.getByLabelText(/^preço$/i)
      await user.type(priceInput, '0')
      await user.type(priceInput, '{Backspace}')
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, '10')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_price: 0 }))
    })

    it('converte corretamente para o número enviado ao backend (centavos -> reais)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user, '123456')
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, '1')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_price: 1234.56 }))
    })

    it('possui uma mensagem de erro associada por aria-describedby quando inválido', async () => {
      const user = userEvent.setup()
      renderForm()

      const priceInput = screen.getByLabelText(/^preço$/i)
      await user.type(priceInput, '9999999999')
      await user.type(priceInput, '9')

      const describedBy = priceInput.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      const errorText = await screen.findByText(/não pode ultrapassar/i)
      expect(describedBy).toContain(errorText.id)
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

    it('pede confirmação antes de remover um plate PREENCHIDO (com peso informado)', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('button', { name: /aumentar número de plates/i }))
      await fillPlateWeight(user, 1, '10')

      await user.click(screen.getByRole('button', { name: /remover plate 2/i }))
      expect(await screen.findByText(/tem dados preenchidos/i)).toBeInTheDocument()
    })
  })

  describe('tempo de produção por plate — valida no salvar (nunca no blur individual, mesmo padrão já usado por peso)', () => {
    it('em branco não bloqueia o envio — vira production_time_seconds: 0 (tempo do plate é opcional)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, '10')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ plates: [expect.objectContaining({ production_time_seconds: 0 })] }),
      )
    })

    it('texto inválido bloqueia o envio, sem apagar o que foi digitado', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      const timeInput = screen.getAllByLabelText(/tempo de produção/i)[0]
      await user.type(timeInput, 'abacaxi')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText(/duração inválida/i)).toBeInTheDocument()
      expect(timeInput).toHaveValue('abacaxi')
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('envia production_time_seconds em segundos inteiros, preservando segundos exatos', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, '10')
      await user.type(screen.getAllByLabelText(/tempo de produção/i)[0], '30m45s')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ plates: [expect.objectContaining({ production_time_seconds: 1845 })] }),
      )
    })
  })

  describe('peso do plate — informado diretamente (filamentos/cores saíram do Produto)', () => {
    it('bloqueia o envio sem peso informado no plate', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await fillNameAndPrice(user)
      await clickCategoryChip(user, 'Chaveiro')

      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText(/informe o peso do plate/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('bloqueia o envio com peso zero/negativo', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await fillNameAndPrice(user)
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, '0')

      await user.click(screen.getByRole('button', { name: /salvar/i }))
      expect(await screen.findByText(/deve ser maior ou igual a 0.01/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('aceita decimal com vírgula', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await fillNameAndPrice(user)
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, '45,5')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          plates: [{ production_time_seconds: 0, weight_grams: 45.5 }],
        }),
      )
    })

    it('rejeita texto inválido', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await fillNameAndPrice(user)
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, 'abc')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText(/deve ser um número válido/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('totais automáticos — exemplo de aceite (Suporte para Controle PS5)', () => {
    it('37,16 g + 97,34 g = 134,50 g; 01:17 + 02:54 = 04:11', async () => {
      const user = userEvent.setup()
      renderForm()
      await fillTwoPlates(user)

      expect(screen.getByText('134,5 g')).toBeInTheDocument()
      expect(screen.getByText('04:11')).toBeInTheDocument()
    })
  })

  describe('ajuste manual de totais ("Ajustar totais" / "Usar cálculo automático")', () => {
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

    it('peso efetivo deixado em branco bloqueia o envio', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await fillNameAndPrice(user)
      await fillTwoPlates(user)

      await user.click(screen.getByRole('button', { name: /ajustar totais/i }))
      const weightOverride = screen.getByLabelText(/peso efetivo/i)
      await user.clear(weightOverride)

      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(await screen.findByText(/informe o peso efetivo/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('peso efetivo negativo é rejeitado', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await fillNameAndPrice(user)
      await fillTwoPlates(user)

      await user.click(screen.getByRole('button', { name: /ajustar totais/i }))
      const weightOverride = screen.getByLabelText(/peso efetivo/i)
      await user.clear(weightOverride)
      await user.type(weightOverride, '-5')

      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(await screen.findByText(/deve ser maior ou igual a 0/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  it('submete com o payload correto (plates + totais + acessórios/embalagens vazios por padrão)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    await fillNameAndPrice(user)
    await clickCategoryChip(user, 'Chaveiro')
    await fillPlateWeight(user, 0, '50')
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
        plates: [{ production_time_seconds: 3600, weight_grams: 50 }],
      }),
    )
  })

  it('payload completo por igualdade exata: todos os campos preenchidos, sem units_per_plate/filamentos', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro Gatinho')
    await clickCategoryChip(user, 'Decoração')
    await user.type(screen.getByLabelText(/descrição/i), 'Chaveiro em formato de gato')
    await user.type(screen.getByLabelText(/^preço$/i), '2550')
    await user.type(screen.getAllByLabelText(/tempo de produção/i)[0], '1h30min')
    await fillPlateWeight(user, 0, '45')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Chaveiro Gatinho',
      product_type: 'CATALOG',
      categories: ['Decoração'],
      description: 'Chaveiro em formato de gato',
      default_price: 25.5,
      allows_personalization: true,
      plates: [{ production_time_seconds: 5400, weight_grams: 45 }],
      manual_weight_override_grams: null,
      manual_time_override_seconds: null,
      accessories: [],
      packaging: [],
    })
    const submittedValue = onSubmit.mock.calls[0][0]
    expect('units_per_plate' in submittedValue).toBe(false)
    expect('default_print_time_seconds' in submittedValue).toBe(false)
    expect('default_weight_grams' in submittedValue).toBe(false)
    expect('category' in submittedValue).toBe(false)
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

      await user.click(screen.getByRole('button', { name: /adicionar embalagem/i }))
      const packagingSelect = screen.getByRole('combobox', { name: 'Embalagem' })
      await user.click(packagingSelect)
      await user.click(await screen.findByRole('option', { name: 'Saco plástico' }))
      const packagingQty = screen.getByRole('combobox', { name: 'Quantidade da embalagem' })
      await user.click(packagingQty)
      await user.click(await screen.findByRole('option', { name: '1' }))

      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(screen.queryByRole('dialog', { name: /selecionar acessórios e embalagens/i })).not.toBeInTheDocument()
      expect(screen.getByText(/Chaveiro metálico · Acessório · Qtd\. 2/)).toBeInTheDocument()
      expect(screen.getByText(/Saco plástico · Embalagem · Qtd\. 1/)).toBeInTheDocument()
    })

    it('seleciona só um acessório (sem nenhuma embalagem)', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('button', { name: /selecionar acessórios e embalagens/i }))
      await user.click(screen.getByRole('button', { name: /adicionar acessório/i }))
      await user.click(screen.getByRole('combobox', { name: 'Acessório' }))
      await user.click(await screen.findByRole('option', { name: 'Chaveiro metálico' }))
      await user.click(screen.getByRole('combobox', { name: 'Quantidade do acessório' }))
      await user.click(await screen.findByRole('option', { name: '1' }))
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(screen.getByText(/Chaveiro metálico · Acessório · Qtd\. 1/)).toBeInTheDocument()
      expect(screen.queryByText(/Embalagem · Qtd\./)).not.toBeInTheDocument()
    })

    it('"Remover" no resumo tira um acessório sem reabrir o seletor', async () => {
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
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('modo edição: carrega acessórios e embalagens já vinculados, pré-preenchidos no resumo', () => {
      renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          accessories: [{ id: 'a1', quantity: 2 }],
          packaging: [{ id: 'k1', quantity: 3 }],
        }),
      })

      expect(screen.getByText(/Chaveiro metálico · Acessório · Qtd\. 2/)).toBeInTheDocument()
      expect(screen.getByText(/Saco plástico · Embalagem · Qtd\. 3/)).toBeInTheDocument()
    })

    it('modo edição: um acessório inativo já vinculado permanece visível no resumo, marcado como inativo', () => {
      renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({ accessories: [{ id: 'a2', quantity: 1 }] }),
      })

      expect(screen.getByText(/Ímã de geladeira \(inativo\) · Acessório · Qtd\. 1/)).toBeInTheDocument()
    })
  })

  describe('Permite personalização', () => {
    it('criação: Switch inicia ativado por padrão', () => {
      renderForm()
      expect(screen.getByRole('switch', { name: /permite personalização/i })).toBeChecked()
    })

    it('criação: sem interação no Switch, salvar envia allows_personalization: true', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, '10')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ allows_personalization: true }))
    })

    it('criação: usuário pode desativar o Switch manualmente e salvar allows_personalization: false', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      const toggle = screen.getByRole('switch', { name: /permite personalização/i })
      await user.click(toggle)
      expect(toggle).not.toBeChecked()

      await fillNameAndPrice(user)
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, '10')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ allows_personalization: false }))
    })

    it('modo edição: preserva allowsPersonalization: true do produto existente (não força nenhum padrão)', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues({ allowsPersonalization: true }) })
      expect(screen.getByRole('switch', { name: /permite personalização/i })).toBeChecked()
    })

    it('modo edição: preserva allowsPersonalization: false do produto existente (não força ativado)', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues({ allowsPersonalization: false }) })
      expect(screen.getByRole('switch', { name: /permite personalização/i })).not.toBeChecked()
    })
  })

  describe('Categorias (múltiplas, migration 20260829180000, ainda não aplicada)', () => {
    it('mostra as 9 categorias pré-definidas como checkboxes, nenhuma selecionada por padrão', () => {
      renderForm()

      const group = screen.getByRole('group', { name: 'Categorias' })
      const options = within(group).getAllByRole('checkbox')
      expect(options.map((option) => option.textContent)).toEqual([
        'Chaveiro',
        'Suporte',
        'Brinquedo Sensorial',
        'Decoração',
        'Pet',
        'Gamer',
        'Geek',
        'Beauty',
        'Office',
      ])
      expect(options.every((option) => option.getAttribute('aria-checked') === 'false')).toBe(true)
    })

    it('permite selecionar MAIS de uma categoria ao mesmo tempo (nunca exclusivo)', async () => {
      const user = userEvent.setup()
      renderForm()

      await clickCategoryChip(user, 'Beauty')
      await clickCategoryChip(user, 'Office')

      expect(screen.getByRole('checkbox', { name: 'Beauty' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('checkbox', { name: 'Office' })).toHaveAttribute('aria-checked', 'true')
    })

    it('clicar de novo numa categoria já selecionada a desmarca', async () => {
      const user = userEvent.setup()
      renderForm()

      await clickCategoryChip(user, 'Chaveiro')
      expect(screen.getByRole('checkbox', { name: 'Chaveiro' })).toHaveAttribute('aria-checked', 'true')

      await clickCategoryChip(user, 'Chaveiro')
      expect(screen.getByRole('checkbox', { name: 'Chaveiro' })).toHaveAttribute('aria-checked', 'false')
    })

    it('categorias selecionadas aparecem na lista de chips removíveis, e "Remover" tira só aquela', async () => {
      const user = userEvent.setup()
      renderForm()

      await clickCategoryChip(user, 'Pet')
      await clickCategoryChip(user, 'Gamer')

      const chipList = screen.getByRole('list', { name: 'Categorias selecionadas' })
      expect(within(chipList).getByText('Pet')).toBeInTheDocument()
      expect(within(chipList).getByText('Gamer')).toBeInTheDocument()

      await user.click(within(chipList).getByRole('button', { name: 'Remover categoria Pet' }))

      expect(within(chipList).queryByText('Pet')).not.toBeInTheDocument()
      expect(within(chipList).getByText('Gamer')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Pet' })).toHaveAttribute('aria-checked', 'false')
    })

    it('"Outra categoria" adiciona texto livre à lista, sem substituir as já selecionadas', async () => {
      const user = userEvent.setup()
      renderForm()

      await clickCategoryChip(user, 'Pet')
      await user.type(screen.getByLabelText('Outra categoria'), 'Colecionáveis')
      await user.click(screen.getByRole('button', { name: /^adicionar$/i }))

      const chipList = screen.getByRole('list', { name: 'Categorias selecionadas' })
      expect(within(chipList).getByText('Pet')).toBeInTheDocument()
      expect(within(chipList).getByText('Colecionáveis')).toBeInTheDocument()
    })

    it('"Outra categoria" pode ser adicionada com Enter, sem submeter o formulário', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.type(screen.getByLabelText('Outra categoria'), 'Colecionáveis{Enter}')

      const chipList = screen.getByRole('list', { name: 'Categorias selecionadas' })
      expect(within(chipList).getByText('Colecionáveis')).toBeInTheDocument()
      expect(screen.getByLabelText('Outra categoria')).toHaveValue('')
    })

    it('não permite duas categorias custom idênticas (mesmo texto)', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.type(screen.getByLabelText('Outra categoria'), 'Colecionáveis{Enter}')
      await user.type(screen.getByLabelText('Outra categoria'), 'Colecionáveis{Enter}')

      const chipList = screen.getByRole('list', { name: 'Categorias selecionadas' })
      expect(within(chipList).getAllByText('Colecionáveis')).toHaveLength(1)
    })

    it('bloqueia o envio sem nenhuma categoria selecionada', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await fillPlateWeight(user, 0, '10')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText(/selecione ao menos uma categoria/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('envia todas as categorias selecionadas, na ordem em que foram adicionadas', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickCategoryChip(user, 'Decoração')
      await clickCategoryChip(user, 'Pet')
      await user.type(screen.getByLabelText('Outra categoria'), 'Colecionáveis{Enter}')
      await fillPlateWeight(user, 0, '10')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ categories: ['Decoração', 'Pet', 'Colecionáveis'] }),
      )
    })

    it('mostra o texto explicativo das categorias', () => {
      renderForm()

      expect(
        screen.getByText(
          'Um produto pode ter mais de uma categoria — selecione todas as que se aplicam ou adicione uma nova abaixo.',
        ),
      ).toBeInTheDocument()
    })

    it('modo edição: pré-preenche os checkboxes e os chips a partir de initialValues.categories', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues({ categories: ['Gamer', 'Geek'] }) })

      expect(screen.getByRole('checkbox', { name: 'Gamer' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('checkbox', { name: 'Geek' })).toHaveAttribute('aria-checked', 'true')
      const chipList = screen.getByRole('list', { name: 'Categorias selecionadas' })
      expect(within(chipList).getByText('Gamer')).toBeInTheDocument()
      expect(within(chipList).queryByText('Colecionáveis')).not.toBeInTheDocument()
    })

    it('modo edição: categoria legada fora da lista pré-definida aparece só como chip removível', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues({ categories: ['Miniaturas Colecionáveis'] }) })

      const chipList = screen.getByRole('list', { name: 'Categorias selecionadas' })
      expect(within(chipList).getByText('Miniaturas Colecionáveis')).toBeInTheDocument()
    })

    it('sem nenhuma categoria em initialValues, nenhum checkbox nasce marcado', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues({ categories: [] }) })

      const group = screen.getByRole('group', { name: 'Categorias' })
      const options = within(group).getAllByRole('checkbox')
      expect(options.every((option) => option.getAttribute('aria-checked') === 'false')).toBe(true)
      expect(screen.queryByRole('list', { name: 'Categorias selecionadas' })).not.toBeInTheDocument()
    })
  })

  describe('Tipo do produto', () => {
    it('Catálogo é a opção selecionada por padrão na criação', () => {
      renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Tipo do produto' })
      expect(within(group).getByRole('radio', { name: 'Catálogo' })).toHaveAttribute('aria-checked', 'true')
      expect(within(group).getByRole('radio', { name: 'Personalizado' })).toHaveAttribute('aria-checked', 'false')
      expect(within(group).getByRole('radio', { name: 'SPOT' })).toHaveAttribute('aria-checked', 'false')
    })

    it('seleção exclusiva: escolher Personalizado desmarca Catálogo, escolher SPOT desmarca Personalizado', async () => {
      const user = userEvent.setup()
      renderForm()

      await clickRadio(user, 'Tipo do produto', 'Personalizado')
      expect(screen.getByRole('radio', { name: 'Personalizado' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Catálogo' })).toHaveAttribute('aria-checked', 'false')

      await clickRadio(user, 'Tipo do produto', 'SPOT')
      expect(screen.getByRole('radio', { name: 'SPOT' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Personalizado' })).toHaveAttribute('aria-checked', 'false')
    })

    it('payload usa os valores técnicos já adotados (CATALOG/CUSTOM/SPOT)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickRadio(user, 'Tipo do produto', 'Personalizado')
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, '10')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ product_type: 'CUSTOM' }))
    })

    it('produtos novos sem alterar a seleção enviam product_type: CATALOG', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickCategoryChip(user, 'Chaveiro')
      await fillPlateWeight(user, 0, '10')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ product_type: 'CATALOG' }))
    })

    it('modo edição: Tipo do produto é exibido como texto fixo, não como radiogroup editável', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues({ productType: 'CUSTOM' }) })

      expect(screen.queryByRole('radiogroup', { name: 'Tipo do produto' })).not.toBeInTheDocument()
      expect(screen.getByText('Personalizado')).toBeInTheDocument()
    })
  })

  describe('modo edição', () => {
    it('pré-preenche Dados Gerais e nasce com 1 plate quando o produto editado não tinha nenhum', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues() })

      expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Suporte PS5')
      expect(screen.getByText('Plate 1')).toBeInTheDocument()
    })

    it('o botão de submit mostra "Salvar alterações"', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues() })
      expect(screen.getByRole('button', { name: /salvar alterações/i })).toBeInTheDocument()
    })

    it('não exibe mais o campo de Preço editável — só uma nota informativa apontando para a seção "Preço"', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues() })

      expect(screen.queryByLabelText(/^preço$/i)).not.toBeInTheDocument()
      expect(screen.getByText(/o preço é alterado só pela ação "preço"/i)).toBeInTheDocument()
    })

    it('preenche todos os campos a partir de initialValues (nome, categorias, descrição, personalização, plates, acessórios, embalagens)', () => {
      renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          name: 'Chaveiro Gatinho',
          categories: ['Decoração'],
          description: 'Chaveiro em formato de gato',
          allowsPersonalization: true,
          plates: [{ key: 'plate-1', timeInput: '01:30', weightInput: '45' }],
          accessories: [{ id: 'a1', quantity: 1 }],
          packaging: [{ id: 'k1', quantity: 1 }],
        }),
      })

      expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Chaveiro Gatinho')
      expect(screen.getByRole('checkbox', { name: 'Decoração' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText(/descrição/i)).toHaveValue('Chaveiro em formato de gato')
      expect(screen.getByRole('switch', { name: /permite personalização/i })).toBeChecked()
      expect(screen.getByText('Plate 1')).toBeInTheDocument()
      expect(screen.getAllByLabelText(/^peso \(g\)$/i)[0]).toHaveValue('45')
      expect(screen.getByText(/Chaveiro metálico · Acessório · Qtd\. 1/)).toBeInTheDocument()
      expect(screen.getByText(/Saco plástico · Embalagem · Qtd\. 1/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeInTheDocument()
    })

    it('modo edição: carrega múltiplos plates, cada um com seu peso/tempo próprios', () => {
      renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          plates: [
            { key: 'plate-1', timeInput: '01:17', weightInput: '37.16' },
            { key: 'plate-2', timeInput: '02:54', weightInput: '97.34' },
          ],
        }),
      })

      expect(screen.getByText('Plate 1')).toBeInTheDocument()
      expect(screen.getByText('Plate 2')).toBeInTheDocument()
      expect(screen.getAllByLabelText(/^peso \(g\)$/i)).toHaveLength(2)
    })

    it('modo edição: carrega ajustes manuais pré-existentes já habilitados, com os valores efetivos corretos', () => {
      renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          plates: [{ key: 'plate-1', timeInput: '01:17', weightInput: '37.16' }],
          manualWeightOverrideGrams: 40,
          manualTimeOverrideSeconds: null,
        }),
      })

      expect(screen.getByText('40 g')).toBeInTheDocument()
      expect(screen.getByText(/ajustado manualmente/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/peso efetivo/i)).toHaveValue('40')
    })

    it('salvar sem alterar nada não é bloqueado por nenhuma validação de preço (preço não faz mais parte desta edição)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          plates: [{ key: 'plate-1', timeInput: '01:00', weightInput: '10' }],
        }),
      })

      await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

      expect(onSubmit).toHaveBeenCalled()
      expect(screen.queryByText(/informe o preço/i)).not.toBeInTheDocument()
    })

    it('modo edição: submete o payload completo via updateFull, incluindo categorias/plates/acessórios/embalagens/ajustes atuais', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          name: 'Suporte PS5',
          categories: ['Gamer'],
          plates: [{ key: 'plate-1', timeInput: '01:17', weightInput: '37.16' }],
          accessories: [{ id: 'a1', quantity: 1 }],
          packaging: [{ id: 'k1', quantity: 1 }],
        }),
      })

      await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Suporte PS5',
          categories: ['Gamer'],
          plates: [{ production_time_seconds: 4620, weight_grams: 37.16 }],
          accessories: [{ id: 'a1', quantity: 1 }],
          packaging: [{ id: 'k1', quantity: 1 }],
        }),
      )
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

  it('duplo envio bloqueado: isSubmitting desabilita Cancelar e Salvar, mostrando "Salvando..."', () => {
    renderForm({ isSubmitting: true })
    expect(screen.getByRole('button', { name: /^cancelar$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Salvando...' })).toBeDisabled()
  })
})
