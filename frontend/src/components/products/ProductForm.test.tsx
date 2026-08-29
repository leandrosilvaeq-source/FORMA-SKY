import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductForm, type ProductFormInitialValues } from './ProductForm'
import { formatCentsToBRL } from '@/lib/forms/currencyField'
import type { Accessory, FilamentTypeSummary, Packaging } from '@/types/domain'

// Estrutura produtiva por plates (2026-08-29, migration
// 20260829160000_add_product_plates_structure.sql, ainda não aplicada) —
// fixtures para os 3 tipos de dado que o formulário consome (filamentos,
// acessórios, embalagens). ft3/a2/k2 são deliberadamente INATIVOS — usados
// pelos testes de "item vinculado que ficou inativo" (rodada corretiva
// 2026-08-29: edição real, fonte autoritativa da composição).
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
  {
    filament_type_id: 'ft3',
    material: 'TPU',
    manufacturer: 'Voolt3D',
    line: 'Industrial',
    commercial_color: 'Cinza',
    color_code: null,
    minimum_stock_grams: null,
    is_active: false,
    total_available_grams: 0,
    usable_spool_count: 0,
    total_spool_count: 0,
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
  return { onSubmit, onCancel, unmount: utils.unmount }
}

async function fillNameAndPrice(user: ReturnType<typeof userEvent.setup>, priceDigits = '2500') {
  await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
  await user.type(screen.getByLabelText(/^preço$/i), priceDigits)
}

// Clica numa opção de um grupo de seleção exclusiva (role=radiogroup) —
// Tipo do produto ou Categoria — mesmo padrão já aprovado em
// OrderForm.test.tsx.
async function clickRadio(
  user: ReturnType<typeof userEvent.setup>,
  groupName: string,
  optionName: string,
): Promise<void> {
  const group = screen.getByRole('radiogroup', { name: groupName })
  await user.click(within(group).getByRole('radio', { name: optionName }))
}

function baseEditInitialValues(overrides: Partial<ProductFormInitialValues> = {}): ProductFormInitialValues {
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
    ...overrides,
  }
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

  // Adaptado de "a ordem visual dos campos segue Nome, Categoria, Descrição,
  // Preço, Peso, Tempo, Personalização" (cc3199e) — Peso/Tempo/Personalização
  // migraram para a seção Composição (não fazem mais parte de Dados Gerais),
  // então a ordem verificada aqui cobre só os campos que continuam nesta
  // seção.
  it('a ordem visual dos campos de Dados Gerais segue Nome, Tipo do produto, Categoria, Descrição, Preço', () => {
    renderForm()

    const labels = screen.getAllByText(/^(Nome|Tipo do produto|Categoria|Descrição|Preço)$/)
    expect(labels.map((label) => label.textContent)).toEqual([
      'Nome',
      'Tipo do produto',
      'Categoria',
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
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_price: 0 }))
    })

    it('converte corretamente para o número enviado ao backend (centavos -> reais)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user, '123456')
      const select = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[0]
      await user.click(select)
      await user.click(await screen.findByRole('option', { name: /PLA/i }))
      await user.type(screen.getAllByLabelText('Peso (g)')[0], '1')
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
  })

  describe('tempo de produção por plate — valida no salvar (nunca no blur individual, mesmo padrão já usado por peso/filamento neste formulário)', () => {
    it('em branco não bloqueia o envio — vira production_time_seconds: 0 (tempo do plate é opcional)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
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
      await user.type(screen.getAllByLabelText(/tempo de produção/i)[0], '30m45s')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ plates: [expect.objectContaining({ production_time_seconds: 1845 })] }),
      )
    })

    it('editar um tempo já válido para um texto inválido continua bloqueando o envio, mantendo o texto digitado', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      const timeInput = screen.getAllByLabelText(/tempo de produção/i)[0]
      await user.type(timeInput, '1h30min')
      await user.click(screen.getByRole('button', { name: /salvar/i }))
      expect(onSubmit).toHaveBeenCalledTimes(1)

      await user.clear(timeInput)
      await user.type(timeInput, 'xyz')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText(/duração inválida/i)).toBeInTheDocument()
      expect(timeInput).toHaveValue('xyz')
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
  })

  describe('composição de filamentos por plate', () => {
    it('só oferece filamentos ativos', () => {
      renderForm()
      // ft1/ft2 (ativos) aparecem; ft3 (inativo, fixture) nunca aparece como
      // opção nova — só apareceria se já estivesse vinculado (ver bloco de
      // "item vinculado que ficou inativo" abaixo).
      expect(screen.queryByRole('option', { name: /TPU/i })).not.toBeInTheDocument()
    })

    it('impede o mesmo filamento duas vezes NO MESMO plate, mas permite o mesmo filamento em plates diferentes', async () => {
      const user = userEvent.setup()
      renderForm()

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

    // Adaptado de "peso total (g) — aceita decimal com vírgula/rejeita
    // negativo/rejeita texto inválido" (cc3199e): o campo de peso solto no
    // Produto não existe mais — peso agora é sempre por linha de filamento
    // dentro de um plate, então as mesmas regras de parseNumberField são
    // verificadas ali.
    it('peso do filamento aceita decimal com vírgula', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await fillNameAndPrice(user)

      const select = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[0]
      await user.click(select)
      await user.click(await screen.findByRole('option', { name: /PLA/i }))
      await user.type(screen.getAllByLabelText('Peso (g)')[0], '45,5')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          plates: [expect.objectContaining({ filaments: [{ filament_type_id: 'ft1', weight_grams: 45.5 }] })],
        }),
      )
    })

    it('peso do filamento rejeita texto inválido', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await fillNameAndPrice(user)

      const select = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[0]
      await user.click(select)
      await user.click(await screen.findByRole('option', { name: /PLA/i }))
      await user.type(screen.getAllByLabelText('Peso (g)')[0], 'abc')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText(/deve ser um número válido/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    // Adaptado de "peso total (g) — vazio é permitido (opcional)": um plate
    // com uma única linha de filamento nunca tocada (nem tipo, nem peso) não
    // bloqueia o envio — plate ainda sem composição definida, mesmo
    // comportamento opcional que o campo de peso solto antigo já tinha.
    it('plate com a única linha de filamento totalmente vazia (nunca tocada) não bloqueia o envio', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      await fillNameAndPrice(user)

      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ plates: [{ production_time_seconds: 0, filaments: [] }] }))
    })

    describe('item vinculado que ficou inativo', () => {
      function editValuesWithInactiveFilament(): ProductFormInitialValues {
        return baseEditInitialValues({
          plates: [
            {
              key: 'plate-1',
              timeInput: '01:00',
              filaments: [{ key: 'row-1', filamentTypeId: 'ft3', weight: '10' }],
            },
          ],
        })
      }

      it('permanece visível e marcado como inativo (nunca some silenciosamente da tela)', async () => {
        const user = userEvent.setup()
        renderForm({ mode: 'edit', initialValues: editValuesWithInactiveFilament() })

        const select = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[0]
        await user.click(select)
        expect(
          await screen.findByRole('option', { name: /TPU · Voolt3D · Industrial · Cinza \(inativo\)/i }),
        ).toBeInTheDocument()
      })

      it('bloqueia o salvamento enquanto o filamento inativo permanecer na composição', async () => {
        const user = userEvent.setup()
        const { onSubmit } = renderForm({ mode: 'edit', initialValues: editValuesWithInactiveFilament() })

        await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

        expect(await screen.findByText(/remova os filamentos inativos/i)).toBeInTheDocument()
        expect(onSubmit).not.toHaveBeenCalled()
      })

      it('permite a remoção consciente do filamento inativo, liberando o salvamento', async () => {
        const user = userEvent.setup()
        const { onSubmit } = renderForm({ mode: 'edit', initialValues: editValuesWithInactiveFilament() })

        await user.click(
          screen.getByRole('button', { name: /remover tpu · voolt3d · industrial · cinza \(inativo\)/i }),
        )
        await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

        expect(onSubmit).toHaveBeenCalled()
      })

      it('não é possível selecionar um NOVO filamento inativo numa linha diferente', async () => {
        const user = userEvent.setup()
        renderForm()

        await user.click(screen.getByRole('button', { name: /adicionar filamento/i }))
        const secondSelect = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[1]
        await user.click(secondSelect)

        expect(screen.queryByRole('option', { name: /TPU/i })).not.toBeInTheDocument()
      })
    })
  })

  describe('totais automáticos — exemplo de aceite (Suporte para Controle PS5)', () => {
    it('37,16 g + 97,34 g = 134,50 g; 01:17 + 02:54 = 04:11', async () => {
      const user = userEvent.setup()
      renderForm()

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

  // Restaurado de "payload completo — envia todos os campos preenchidos
  // corretamente, sem units_per_plate" (cc3199e), com igualdade exata (não
  // objectContaining) — mesma garantia de regressão, adaptado ao novo
  // formato (plates em vez de default_print_time_seconds/
  // default_weight_grams soltos).
  it('payload completo por igualdade exata: todos os campos preenchidos, sem units_per_plate', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro Gatinho')
    await clickRadio(user, 'Categoria', 'Decoração')
    await user.type(screen.getByLabelText(/descrição/i), 'Chaveiro em formato de gato')
    await user.type(screen.getByLabelText(/^preço$/i), '2550')
    await user.type(screen.getAllByLabelText(/tempo de produção/i)[0], '1h30min')
    const select = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })[0]
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: /PLA/i }))
    await user.type(screen.getAllByLabelText('Peso (g)')[0], '45')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Chaveiro Gatinho',
      product_type: 'CATALOG',
      category: 'Decoração',
      description: 'Chaveiro em formato de gato',
      default_price: 25.5,
      allows_personalization: true,
      plates: [{ production_time_seconds: 5400, filaments: [{ filament_type_id: 'ft1', weight_grams: 45 }] }],
      manual_weight_override_grams: null,
      manual_time_override_seconds: null,
      accessories: [],
      packaging: [],
    })
    const submittedValue = onSubmit.mock.calls[0][0]
    expect('units_per_plate' in submittedValue).toBe(false)
    expect('default_print_time_seconds' in submittedValue).toBe(false)
    expect('default_weight_grams' in submittedValue).toBe(false)
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

    it('seleciona só uma embalagem (sem nenhum acessório)', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('button', { name: /selecionar acessórios e embalagens/i }))
      await user.click(screen.getByRole('button', { name: /adicionar embalagem/i }))
      await user.click(screen.getByRole('combobox', { name: 'Embalagem' }))
      await user.click(await screen.findByRole('option', { name: 'Saco plástico' }))
      await user.click(screen.getByRole('combobox', { name: 'Quantidade da embalagem' }))
      await user.click(await screen.findByRole('option', { name: '1' }))
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(screen.getByText(/Saco plástico · Embalagem · Qtd\. 1/)).toBeInTheDocument()
      expect(screen.queryByText(/Acessório · Qtd\./)).not.toBeInTheDocument()
    })

    it('reabrir o seletor e alterar a quantidade de um acessório já selecionado atualiza o resumo', async () => {
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

      const summaryItem = screen.getByText(/Chaveiro metálico/).closest('li') as HTMLElement
      await user.click(within(summaryItem).getByRole('button', { name: /editar/i }))
      await user.click(screen.getByRole('combobox', { name: 'Quantidade do acessório' }))
      await user.click(await screen.findByRole('option', { name: '3' }))
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(screen.getByText(/Chaveiro metálico · Acessório · Qtd\. 3/)).toBeInTheDocument()
    })

    it('reabrir o seletor e alterar a quantidade de uma embalagem já selecionada atualiza o resumo', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('button', { name: /selecionar acessórios e embalagens/i }))
      await user.click(screen.getByRole('button', { name: /adicionar embalagem/i }))
      await user.click(screen.getByRole('combobox', { name: 'Embalagem' }))
      await user.click(await screen.findByRole('option', { name: 'Saco plástico' }))
      await user.click(screen.getByRole('combobox', { name: 'Quantidade da embalagem' }))
      await user.click(await screen.findByRole('option', { name: '1' }))
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))
      expect(screen.getByText(/Saco plástico · Embalagem · Qtd\. 1/)).toBeInTheDocument()

      const summaryItem = screen.getByText(/Saco plástico/).closest('li') as HTMLElement
      await user.click(within(summaryItem).getByRole('button', { name: /editar/i }))
      await user.click(screen.getByRole('combobox', { name: 'Quantidade da embalagem' }))
      await user.click(await screen.findByRole('option', { name: '5' }))
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(screen.getByText(/Saco plástico · Embalagem · Qtd\. 5/)).toBeInTheDocument()
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

    it('"Remover" no resumo tira uma embalagem sem reabrir o seletor', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('button', { name: /selecionar acessórios e embalagens/i }))
      await user.click(screen.getByRole('button', { name: /adicionar embalagem/i }))
      await user.click(screen.getByRole('combobox', { name: 'Embalagem' }))
      await user.click(await screen.findByRole('option', { name: 'Saco plástico' }))
      await user.click(screen.getByRole('combobox', { name: 'Quantidade da embalagem' }))
      await user.click(await screen.findByRole('option', { name: '1' }))
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(screen.getByText(/Saco plástico/)).toBeInTheDocument()
      const summaryItem = screen.getByText(/Saco plástico/).closest('li') as HTMLElement
      await user.click(within(summaryItem).getByRole('button', { name: /remover/i }))

      expect(screen.queryByText(/Saco plástico/)).not.toBeInTheDocument()
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
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ allows_personalization: false }))
    })

    it('criação: reabrir uma nova janela de "Novo produto" restaura o padrão ativado, mesmo após desativar na janela anterior', async () => {
      const user = userEvent.setup()
      const { unmount } = renderForm()

      await user.click(screen.getByRole('switch', { name: /permite personalização/i }))
      expect(screen.getByRole('switch', { name: /permite personalização/i })).not.toBeChecked()

      unmount()
      renderForm()

      expect(screen.getByRole('switch', { name: /permite personalização/i })).toBeChecked()
    })

    it('é navegável e alternável por teclado (parte de ativado, teclado desativa)', async () => {
      const user = userEvent.setup()
      renderForm()

      const toggle = screen.getByRole('switch', { name: /permite personalização/i })
      expect(toggle).toBeChecked()
      toggle.focus()
      await user.keyboard(' ')

      expect(toggle).not.toBeChecked()
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

  describe('Categoria e Descrição', () => {
    it('categoria e descrição vazias enviam null', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: null, description: null }))
    })

    it('categoria pré-definida selecionada e descrição preenchida (com trim) são enviadas corretamente', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickRadio(user, 'Categoria', 'Decoração')
      await user.type(screen.getByLabelText(/descrição/i), '  Chaveiro em resina  ')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Decoração', description: 'Chaveiro em resina' }),
      )
    })

    it('mostra as 9 categorias pré-definidas mais "Outro", nenhuma selecionada por padrão', () => {
      renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Categoria' })
      const options = within(group).getAllByRole('radio')
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
        'Outro',
      ])
      expect(options.every((option) => option.getAttribute('aria-checked') === 'false')).toBe(true)
    })

    it('Beauty e Office são opções independentes; "Beauty Office" não é mais uma opção pré-definida', () => {
      renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Categoria' })
      expect(within(group).getByRole('radio', { name: 'Beauty' })).toBeInTheDocument()
      expect(within(group).getByRole('radio', { name: 'Office' })).toBeInTheDocument()
      expect(within(group).queryByRole('radio', { name: 'Beauty Office' })).not.toBeInTheDocument()
    })

    it('seleção exclusiva entre Beauty e Office: escolher uma desmarca a outra', async () => {
      const user = userEvent.setup()
      renderForm()

      await clickRadio(user, 'Categoria', 'Beauty')
      expect(screen.getByRole('radio', { name: 'Beauty' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Office' })).toHaveAttribute('aria-checked', 'false')

      await clickRadio(user, 'Categoria', 'Office')
      expect(screen.getByRole('radio', { name: 'Office' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Beauty' })).toHaveAttribute('aria-checked', 'false')
    })

    it('seleção de Beauty envia category: "Beauty"', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickRadio(user, 'Categoria', 'Beauty')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: 'Beauty' }))
    })

    it('seleção de Office envia category: "Office"', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickRadio(user, 'Categoria', 'Office')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: 'Office' }))
    })

    it('categoria antiga "Beauty Office" (produto existente) é preservada e abre como "Outro" na edição, com o texto original', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues({ category: 'Beauty Office' }) })

      expect(screen.getByRole('radio', { name: 'Outro' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText('Informe a categoria')).toHaveValue('Beauty Office')
      expect(screen.queryByRole('radio', { name: 'Beauty Office' })).not.toBeInTheDocument()
    })

    it('mostra o texto explicativo da categoria', () => {
      renderForm()

      expect(
        screen.getByText(
          'A categoria organiza os produtos por finalidade ou público, facilitando a localização e a consulta na listagem.',
        ),
      ).toBeInTheDocument()
    })

    it('seleção exclusiva: escolher uma categoria desmarca a anterior', async () => {
      const user = userEvent.setup()
      renderForm()

      await clickRadio(user, 'Categoria', 'Chaveiro')
      expect(screen.getByRole('radio', { name: 'Chaveiro' })).toHaveAttribute('aria-checked', 'true')

      await clickRadio(user, 'Categoria', 'Gamer')
      expect(screen.getByRole('radio', { name: 'Gamer' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Chaveiro' })).toHaveAttribute('aria-checked', 'false')
    })

    it('preserva exatamente a capitalização apresentada (ex.: "Brinquedo Sensorial") no payload', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickRadio(user, 'Categoria', 'Brinquedo Sensorial')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: 'Brinquedo Sensorial' }))
    })

    it('ao selecionar "Outro", mostra o campo "Informe a categoria"', async () => {
      const user = userEvent.setup()
      renderForm()

      expect(screen.queryByLabelText('Informe a categoria')).not.toBeInTheDocument()
      await clickRadio(user, 'Categoria', 'Outro')
      expect(screen.getByLabelText('Informe a categoria')).toBeInTheDocument()
    })

    it('"Outro" sem texto bloqueia o envio com "Informe a categoria."', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickRadio(user, 'Categoria', 'Outro')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText('Informe a categoria.')).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('"Outro" com texto preenchido envia o texto digitado como categoria', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await clickRadio(user, 'Categoria', 'Outro')
      await user.type(screen.getByLabelText('Informe a categoria'), 'Colecionáveis')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: 'Colecionáveis' }))
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
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ product_type: 'CUSTOM' }))
    })

    it('produtos novos sem alterar a seleção enviam product_type: CATALOG', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ product_type: 'CATALOG' }))
    })

    // Novo nesta rodada corretiva: Tipo do produto nunca foi editável na
    // edição (mesma restrição que ProductEditDetailsForm já tinha, ver
    // supabase/migrations/20260829143000_add_product_edit_function.sql) —
    // agora exibido como texto fixo em vez do radiogroup, para não sugerir
    // uma edição que o backend rejeitaria (update_product_full não aceita
    // product_type).
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

    it('preenche todos os campos a partir de initialValues (nome, categoria, descrição, personalização, plates, acessórios, embalagens)', () => {
      renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          name: 'Chaveiro Gatinho',
          category: 'Decoração',
          description: 'Chaveiro em formato de gato',
          allowsPersonalization: true,
          plates: [
            {
              key: 'plate-1',
              timeInput: '01:30',
              filaments: [{ key: 'row-1', filamentTypeId: 'ft1', weight: '45' }],
            },
          ],
          accessories: [{ id: 'a1', quantity: 1 }],
          packaging: [{ id: 'k1', quantity: 1 }],
        }),
      })

      expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Chaveiro Gatinho')
      expect(screen.getByRole('radio', { name: 'Decoração' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText(/descrição/i)).toHaveValue('Chaveiro em formato de gato')
      expect(screen.getByRole('switch', { name: /permite personalização/i })).toBeChecked()
      expect(screen.getByText('Plate 1')).toBeInTheDocument()
      expect(screen.getByText('45 g')).toBeInTheDocument()
      expect(screen.getByText(/Chaveiro metálico · Acessório · Qtd\. 1/)).toBeInTheDocument()
      expect(screen.getByText(/Saco plástico · Embalagem · Qtd\. 1/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeInTheDocument()
    })

    it('modo edição: carrega múltiplos plates, cada um com sua própria composição', () => {
      renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          plates: [
            { key: 'plate-1', timeInput: '01:17', filaments: [{ key: 'row-1', filamentTypeId: 'ft1', weight: '37.16' }] },
            {
              key: 'plate-2',
              timeInput: '02:54',
              filaments: [
                { key: 'row-2', filamentTypeId: 'ft2', weight: '97.34' },
                { key: 'row-3', filamentTypeId: 'ft1', weight: '5' },
              ],
            },
          ],
        }),
      })

      expect(screen.getByText('Plate 1')).toBeInTheDocument()
      expect(screen.getByText('Plate 2')).toBeInTheDocument()
      expect(screen.getAllByRole('combobox', { name: 'Tipo de filamento' })).toHaveLength(3)
    })

    it('modo edição: carrega ajustes manuais pré-existentes já habilitados, com os valores efetivos corretos', () => {
      renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          plates: [
            { key: 'plate-1', timeInput: '01:17', filaments: [{ key: 'row-1', filamentTypeId: 'ft1', weight: '37.16' }] },
          ],
          manualWeightOverrideGrams: 40,
          manualTimeOverrideSeconds: null,
        }),
      })

      expect(screen.getByText('40 g')).toBeInTheDocument()
      expect(screen.getByText(/ajustado manualmente/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/peso efetivo/i)).toHaveValue('40')
    })

    it('categoria existente que não corresponde a nenhuma opção pré-definida abre como "Outro", com o texto preenchido', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues({ category: 'Miniaturas Colecionáveis' }) })

      expect(screen.getByRole('radio', { name: 'Outro' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText('Informe a categoria')).toHaveValue('Miniaturas Colecionáveis')
    })

    it('categoria nula em initialValues não seleciona nenhuma opção', () => {
      renderForm({ mode: 'edit', initialValues: baseEditInitialValues({ category: null }) })

      const group = screen.getByRole('radiogroup', { name: 'Categoria' })
      const options = within(group).getAllByRole('radio')
      expect(options.every((option) => option.getAttribute('aria-checked') === 'false')).toBe(true)
    })

    // Adaptado de "preço já preenchido não bloqueia o envio (não exige nova
    // digitação)" (cc3199e): preço não é mais um campo desta edição (nem
    // exibido, nem validado) — o equivalente agora é confirmar que salvar
    // sem tocar em nada não é bloqueado por nenhuma validação de preço.
    it('salvar sem alterar nada não é bloqueado por nenhuma validação de preço (preço não faz mais parte desta edição)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          plates: [
            { key: 'plate-1', timeInput: '01:00', filaments: [{ key: 'row-1', filamentTypeId: 'ft1', weight: '10' }] },
          ],
        }),
      })

      await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

      expect(onSubmit).toHaveBeenCalled()
      expect(screen.queryByText(/informe o preço/i)).not.toBeInTheDocument()
    })

    it('modo edição: submete o payload completo via updateFull, incluindo plates/acessórios/embalagens/ajustes atuais', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({
        mode: 'edit',
        initialValues: baseEditInitialValues({
          name: 'Suporte PS5',
          plates: [
            { key: 'plate-1', timeInput: '01:17', filaments: [{ key: 'row-1', filamentTypeId: 'ft1', weight: '37.16' }] },
          ],
          accessories: [{ id: 'a1', quantity: 1 }],
          packaging: [{ id: 'k1', quantity: 1 }],
        }),
      })

      await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Suporte PS5',
          plates: [{ production_time_seconds: 4620, filaments: [{ filament_type_id: 'ft1', weight_grams: 37.16 }] }],
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
