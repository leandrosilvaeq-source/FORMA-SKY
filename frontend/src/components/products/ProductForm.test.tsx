import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductForm } from './ProductForm'
import { formatCentsToBRL } from '@/lib/forms/currencyField'

function renderForm(overrides: Partial<Parameters<typeof ProductForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <ProductForm isSubmitting={false} submitError={null} onSubmit={onSubmit} onCancel={onCancel} {...overrides} />,
  )
  return { onSubmit, onCancel }
}

async function fillNameAndPrice(user: ReturnType<typeof userEvent.setup>, priceDigits = '2500') {
  await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
  await user.type(screen.getByLabelText(/^preço$/i), priceDigits)
}

// Clica numa opção de um dos grupos de seleção exclusiva (role=radiogroup)
// — Tipo do produto ou Categoria — mesmo padrão já aprovado em
// OrderForm.test.tsx.
async function clickRadio(
  user: ReturnType<typeof userEvent.setup>,
  groupName: string,
  optionName: string,
): Promise<void> {
  const group = screen.getByRole('radiogroup', { name: groupName })
  await user.click(within(group).getByRole('radio', { name: optionName }))
}

describe('ProductForm', () => {
  it('renders the expected fields, sem "Unidades por placa"', () => {
    renderForm()

    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/categoria/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/descrição/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^preço$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/tempo total de impressão/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/peso total do produto/i)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /permite personalização/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/unidades por pla/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/unidades por pla/i)).not.toBeInTheDocument()
  })

  it('a ordem visual dos campos segue Nome, Categoria, Descrição, Preço, Tempo, Peso, Personalização', () => {
    renderForm()

    const labels = screen.getAllByText(/^(Nome|Categoria|Descrição|Preço|Tempo total de impressão|Peso total do produto \(g\)|Permite personalização)$/)
    expect(labels.map((label) => label.textContent)).toEqual([
      'Nome',
      'Categoria',
      'Descrição',
      'Preço',
      'Tempo total de impressão',
      'Peso total do produto (g)',
      'Permite personalização',
    ])
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
      await user.type(priceInput, '9999999999') // no teto exato
      await user.type(priceInput, '9') // um dígito a mais estoura o teto

      expect(await screen.findByText(/não pode ultrapassar/i)).toBeInTheDocument()
    })

    it('preço nunca tocado bloqueia o envio com "Informe o preço."', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText('Informe o preço.')).toBeInTheDocument()
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
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_price: 1234.56 }))
    })
  })

  describe('tempo total de impressão — campo inteligente', () => {
    it('possui um texto de ajuda associado por aria-describedby', () => {
      renderForm()

      const input = screen.getByLabelText(/tempo total de impressão/i)
      const describedBy = input.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      const helpText = screen.getByText('Aceita 1h30min, 1,5h, 01:30:00, 90m ou 30m45s.')
      expect(describedBy).toContain(helpText.id)
    })

    it.each([
      ['1h30min', '01:30:00'],
      ['1,5h', '01:30:00'],
      ['90m', '01:30:00'],
      ['30m45s', '00:30:45'],
      ['12:30', '12:30:00'],
    ])('blur normaliza "%s" para %s', async (typed, normalized) => {
      const user = userEvent.setup()
      renderForm()

      const input = screen.getByLabelText(/tempo total de impressão/i)
      await user.type(input, typed)
      await user.tab()

      expect(input).toHaveValue(normalized)
    })

    it('campo vazio permanece vazio após blur e envia null', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      const input = screen.getByLabelText(/tempo total de impressão/i)
      await user.click(input)
      await user.tab()
      expect(input).toHaveValue('')

      await fillNameAndPrice(user)
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_print_time_seconds: null }))
    })

    it('texto inválido mostra erro inline no blur, sem apagar o que foi digitado', async () => {
      const user = userEvent.setup()
      renderForm()

      const input = screen.getByLabelText(/tempo total de impressão/i)
      await user.type(input, 'abacaxi')
      await user.tab()

      expect(await screen.findByText(/duração inválida/i)).toBeInTheDocument()
      expect(input).toHaveValue('abacaxi')
    })

    it('erro de duração bloqueia o envio', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await user.type(screen.getByLabelText(/tempo total de impressão/i), 'abacaxi')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText(/duração inválida/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('envia default_print_time_seconds em segundos inteiros, preservando segundos exatos', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await user.type(screen.getByLabelText(/tempo total de impressão/i), '30m45s')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_print_time_seconds: 1845 }))
    })

    it('não normaliza no blur se o valor já ficou inválido depois de editado (mantém erro)', async () => {
      const user = userEvent.setup()
      renderForm()

      const input = screen.getByLabelText(/tempo total de impressão/i)
      await user.type(input, '1h30min')
      await user.tab()
      expect(input).toHaveValue('01:30:00')

      await user.clear(input)
      await user.type(input, 'xyz')
      await user.tab()

      expect(await screen.findByText(/duração inválida/i)).toBeInTheDocument()
      expect(input).toHaveValue('xyz')
    })
  })

  describe('peso total do produto', () => {
    it('vazio é permitido (opcional)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_weight_grams: null }))
    })

    it('aceita 0', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await user.type(screen.getByLabelText(/peso total do produto/i), '0')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_weight_grams: 0 }))
    })

    it('aceita decimal com vírgula', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await user.type(screen.getByLabelText(/peso total do produto/i), '45,5')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_weight_grams: 45.5 }))
    })

    it('rejeita negativo', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await user.type(screen.getByLabelText(/peso total do produto/i), '-5')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText('O peso deve ser maior ou igual a 0.')).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('rejeita texto inválido', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndPrice(user)
      await user.type(screen.getByLabelText(/peso total do produto/i), 'abc')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(await screen.findByText(/deve ser um número válido/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('personalização, categoria e descrição', () => {
    it('permite personalização começa desmarcado e envia false por padrão', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      const toggle = screen.getByRole('switch', { name: /permite personalização/i })
      expect(toggle).not.toBeChecked()

      await fillNameAndPrice(user)
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ allows_personalization: false }))
    })

    it('alternar o Switch envia allows_personalization: true', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.click(screen.getByRole('switch', { name: /permite personalização/i }))
      await fillNameAndPrice(user)
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ allows_personalization: true }))
    })

    it('o Switch é navegável e alternável por teclado', async () => {
      const user = userEvent.setup()
      renderForm()

      const toggle = screen.getByRole('switch', { name: /permite personalização/i })
      toggle.focus()
      await user.keyboard(' ')

      expect(toggle).toBeChecked()
    })

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
  })

  describe('Categoria — seleção exclusiva por action buttons', () => {
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
      renderForm({
        mode: 'edit',
        initialValues: {
          name: 'Produto Antigo',
          category: 'Beauty Office',
          description: null,
          defaultPrice: 10,
          defaultPrintTimeSeconds: null,
          defaultWeightGrams: null,
          allowsPersonalization: false,
          productType: 'CATALOG',
        },
      })

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

  describe('edição (mode="edit", initialValues)', () => {
    const editInitialValues = {
      name: 'Chaveiro Gatinho',
      category: 'Decoração',
      description: 'Chaveiro em formato de gato',
      defaultPrice: 25.5,
      defaultPrintTimeSeconds: 5400,
      defaultWeightGrams: 45,
      allowsPersonalization: true,
      productType: 'CUSTOM' as const,
    }

    it('preenche todos os campos a partir de initialValues', () => {
      renderForm({ mode: 'edit', initialValues: editInitialValues })

      expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Chaveiro Gatinho')
      expect(screen.getByRole('radio', { name: 'Personalizado' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Decoração' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText(/descrição/i)).toHaveValue('Chaveiro em formato de gato')
      expect(screen.getByLabelText(/^preço$/i)).toHaveValue(formatCentsToBRL(2550))
      expect(screen.getByLabelText(/tempo total de impressão/i)).toHaveValue('01:30:00')
      expect(screen.getByLabelText(/peso total do produto/i)).toHaveValue('45')
      expect(screen.getByRole('switch', { name: /permite personalização/i })).toBeChecked()
      expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeInTheDocument()
    })

    it('categoria existente que não corresponde a nenhuma opção pré-definida abre como "Outro", com o texto preenchido', () => {
      renderForm({ mode: 'edit', initialValues: { ...editInitialValues, category: 'Miniaturas Colecionáveis' } })

      expect(screen.getByRole('radio', { name: 'Outro' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText('Informe a categoria')).toHaveValue('Miniaturas Colecionáveis')
    })

    it('categoria nula em initialValues não seleciona nenhuma opção', () => {
      renderForm({ mode: 'edit', initialValues: { ...editInitialValues, category: null } })

      const group = screen.getByRole('radiogroup', { name: 'Categoria' })
      const options = within(group).getAllByRole('radio')
      expect(options.every((option) => option.getAttribute('aria-checked') === 'false')).toBe(true)
    })

    it('preço já preenchido não bloqueia o envio (não exige nova digitação)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({ mode: 'edit', initialValues: editInitialValues })

      await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_price: 25.5 }))
    })
  })

  describe('payload completo', () => {
    it('envia todos os campos preenchidos corretamente, sem units_per_plate', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro Gatinho')
      await clickRadio(user, 'Categoria', 'Decoração')
      await user.type(screen.getByLabelText(/descrição/i), 'Chaveiro em formato de gato')
      await user.type(screen.getByLabelText(/^preço$/i), '2550')
      await user.type(screen.getByLabelText(/tempo total de impressão/i), '1h30min')
      await user.type(screen.getByLabelText(/peso total do produto/i), '45')
      await user.click(screen.getByRole('switch', { name: /permite personalização/i }))
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Chaveiro Gatinho',
        product_type: 'CATALOG',
        category: 'Decoração',
        description: 'Chaveiro em formato de gato',
        default_price: 25.5,
        default_print_time_seconds: 5400,
        default_weight_grams: 45,
        allows_personalization: true,
      })
      const submittedValue = onSubmit.mock.calls[0][0]
      expect('units_per_plate' in submittedValue).toBe(false)
    })
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  describe('isSubmitting / submitError', () => {
    it('isSubmitting=true desabilita Cancelar e Salvar, mostrando "Salvando..."', () => {
      renderForm({ isSubmitting: true })

      expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Salvando...' })).toBeDisabled()
    })

    it('submitError é exibido', () => {
      renderForm({ submitError: 'categoria inválida' })

      expect(screen.getByText('categoria inválida')).toBeInTheDocument()
    })
  })
})
