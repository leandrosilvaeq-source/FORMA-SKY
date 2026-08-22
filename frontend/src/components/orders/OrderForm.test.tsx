import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrderForm } from './OrderForm'
import type { Company, Customer, LeadSource, Product } from '@/types/domain'

const customers: Customer[] = [
  {
    id: 'c1',
    name: 'Ana Cliente',
    whatsapp: null,
    instagram: null,
    company_id: null,
    acquisition_source_id: null,
    notes: null,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
]

const companies: Company[] = [
  {
    id: 'e1',
    name: 'Empresa A',
    trade_name: null,
    document_number: null,
    whatsapp: null,
    instagram: null,
    notes: null,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
]

const inactiveCustomer: Customer = {
  id: 'c2',
  name: 'Cliente Inativo',
  whatsapp: null,
  instagram: null,
  company_id: null,
  acquisition_source_id: null,
  notes: null,
  is_active: false,
  created_at: '',
  updated_at: '',
}

const inactiveCompany: Company = {
  id: 'e2',
  name: 'Empresa Inativa',
  trade_name: null,
  document_number: null,
  whatsapp: null,
  instagram: null,
  notes: null,
  is_active: false,
  created_at: '',
  updated_at: '',
}

// Propositalmente fora da ordem aprovada (WhatsApp antes de Instagram) para
// testar que a ordenação de exibição é feita no frontend, não herdada da
// ordem em que a prop chega.
const leadSources: LeadSource[] = [
  { id: 'l2', name: 'WhatsApp', is_active: true },
  { id: 'l1', name: 'Instagram', is_active: true },
]
const inactiveLeadSource: LeadSource = { id: 'l3', name: 'Origem Inativa', is_active: false }

// As 6 origens reais de public.lead_sources, propositalmente fora de ordem
// na prop — testa a ordenação completa aprovada, não só um par.
const allLeadSourcesScrambled: LeadSource[] = [
  { id: 'l6', name: 'Outros', is_active: true },
  { id: 'l4', name: 'Facebook', is_active: true },
  { id: 'l1', name: 'Indicação / boca a boca', is_active: true },
  { id: 'l5', name: 'TikTok', is_active: true },
  { id: 'l2', name: 'Instagram', is_active: true },
  { id: 'l3', name: 'WhatsApp', is_active: true },
]

const products: Product[] = [
  {
    id: 'p1',
    name: 'Chaveiro',
    category: null,
    description: null,
    default_price: 25,
    product_type: 'CATALOG',
    default_print_time_seconds: null,
    default_weight_grams: null,
    units_per_plate: null,
    default_file_id: null,
    allows_personalization: false,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'p2',
    name: 'Produto descontinuado',
    category: null,
    description: null,
    default_price: 40,
    product_type: 'CATALOG',
    default_print_time_seconds: null,
    default_weight_grams: null,
    units_per_plate: null,
    default_file_id: null,
    allows_personalization: false,
    is_active: false,
    created_at: '',
    updated_at: '',
  },
  // Produto CUSTOM ativo, cadastrado como reutilizável (public.products) —
  // não pode aparecer no seletor de item Catálogo: só product_type=CATALOG
  // é oferecido ali, mesmo o produto estando ativo.
  {
    id: 'p3',
    name: 'Miniatura Personalizada Reutilizável',
    category: null,
    description: null,
    default_price: 60,
    product_type: 'CUSTOM',
    default_print_time_seconds: null,
    default_weight_grams: null,
    units_per_plate: null,
    default_file_id: null,
    allows_personalization: false,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
  // Produto SPOT ativo, cadastrado como reutilizável — mesmo motivo do
  // CUSTOM acima: nunca aparece no seletor de item Catálogo.
  {
    id: 'p4',
    name: 'Peça Spot Reutilizável',
    category: null,
    description: null,
    default_price: 15,
    product_type: 'SPOT',
    default_print_time_seconds: null,
    default_weight_grams: null,
    units_per_plate: null,
    default_file_id: null,
    allows_personalization: false,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
]

// Abre um Select pelo nome acessível do combobox e clica na opção indicada,
// esperando o popup renderizar (findByRole retenta) — evitar getByRole
// direto aqui elimina uma flakiness de timing observada entre a abertura do
// popup (com transição CSS) e o clique seguinte.
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  comboboxName: string,
  optionName: string,
): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

// Clica numa opção de um dos controles segmentados (role=radiogroup),
// escopado ao próprio grupo — necessário porque "Empresa (B2B)" etc. só
// existem como rótulo de radio dentro do grupo certo (Tipo de venda, Forma
// de entrega, Entrou em contato por), nunca como texto solto no documento.
async function clickRadio(
  user: ReturnType<typeof userEvent.setup>,
  groupName: string,
  optionName: string,
): Promise<void> {
  const group = screen.getByRole('radiogroup', { name: groupName })
  await user.click(within(group).getByRole('radio', { name: optionName }))
}

function renderForm(overrides: Partial<Parameters<typeof OrderForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <OrderForm
      customers={customers}
      companies={companies}
      leadSources={leadSources}
      products={products}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onCancel }
}

// Quantidade já nasce em '1' (ver emptyRow() em OrderForm.tsx) — não precisa
// ser digitada para formar um pedido mínimo válido.
async function fillMinimalValidOrder(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
  await selectOption(user, 'Produto', 'Chaveiro')
}

describe('OrderForm', () => {
  it('renderiza em B2C por padrão: Empresa ausente, Cliente/Contato presente, 1 linha de item vazia', () => {
    renderForm()

    const saleTypeGroup = screen.getByRole('radiogroup', { name: 'Tipo de venda' })
    expect(within(saleTypeGroup).getByRole('radio', { name: 'B2C' })).toHaveAttribute('aria-checked', 'true')
    expect(within(saleTypeGroup).getByRole('radio', { name: 'B2B' })).toHaveAttribute('aria-checked', 'false')

    expect(screen.queryByRole('combobox', { name: 'Empresa' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Cliente/Contato' })).toBeInTheDocument()
    expect(screen.getByLabelText('Quantidade')).toBeInTheDocument()
    expect(screen.getByLabelText('Preço unitário')).toBeInTheDocument()
    expect(screen.getByText('Selecione um produto')).toBeInTheDocument()
  })

  it('B2B revela o bloco Empresa; B2C não o mostra', async () => {
    const user = userEvent.setup()
    renderForm()

    await clickRadio(user, 'Tipo de venda', 'B2B')
    expect(screen.getByRole('combobox', { name: 'Empresa' })).toBeInTheDocument()

    await clickRadio(user, 'Tipo de venda', 'B2C')
    expect(screen.queryByRole('combobox', { name: 'Empresa' })).not.toBeInTheDocument()
  })

  it('Empresa é obrigatória em B2B: bloqueia o envio e mostra erro quando não selecionada', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await clickRadio(user, 'Tipo de venda', 'B2B')
    await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
    await selectOption(user, 'Produto', 'Chaveiro')

    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(await screen.findByText('Selecione uma empresa.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('B2B envia o company_id da empresa selecionada', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await clickRadio(user, 'Tipo de venda', 'B2B')
    await selectOption(user, 'Empresa', 'Empresa A')
    await fillMinimalValidOrder(user)

    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 'c1', company_id: 'e1' }))
  })

  it('alternar de B2B para B2C força company_id null no payload, mesmo com empresa já escolhida', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await clickRadio(user, 'Tipo de venda', 'B2B')
    await selectOption(user, 'Empresa', 'Empresa A')
    await clickRadio(user, 'Tipo de venda', 'B2C')

    expect(screen.queryByRole('combobox', { name: 'Empresa' })).not.toBeInTheDocument()

    await fillMinimalValidOrder(user)
    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ company_id: null }))
  })

  it('Cliente/Contato é obrigatório: bloqueia o envio e mostra erro quando ausente', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(await screen.findByText('Selecione um cliente.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cliente inativo continua excluído do campo Cliente/Contato', async () => {
    const user = userEvent.setup()
    renderForm({ customers: [...customers, inactiveCustomer] })

    await user.click(screen.getByRole('combobox', { name: 'Cliente/Contato' }))

    expect(await screen.findByRole('option', { name: 'Ana Cliente' })).toBeInTheDocument()
    expect(screen.queryByText('Cliente Inativo')).not.toBeInTheDocument()
  })

  it('empresa inativa continua excluída do campo Empresa, mantendo "Nenhuma empresa"', async () => {
    const user = userEvent.setup()
    renderForm({ companies: [...companies, inactiveCompany] })

    await clickRadio(user, 'Tipo de venda', 'B2B')
    await user.click(screen.getByRole('combobox', { name: 'Empresa' }))

    expect(await screen.findByRole('option', { name: 'Empresa A' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Nenhuma empresa' })).toBeInTheDocument()
    expect(screen.queryByText('Empresa Inativa')).not.toBeInTheDocument()
  })

  it('Entrou em contato por: mostra as origens reais na ordem aprovada e permite selecionar uma', async () => {
    const user = userEvent.setup()
    renderForm()

    const group = screen.getByRole('radiogroup', { name: 'Entrou em contato por' })
    const options = within(group).getAllByRole('radio')
    // Ordem aprovada: Instagram antes de WhatsApp — mesmo a prop leadSources
    // chegando na ordem inversa (ver fixture acima).
    expect(options.map((option) => option.textContent)).toEqual(['Instagram', 'WhatsApp'])

    await user.click(within(group).getByRole('radio', { name: 'Instagram' }))
    expect(within(group).getByRole('radio', { name: 'Instagram' })).toHaveAttribute('aria-checked', 'true')
  })

  it('origem inativa continua excluída dos controles de "Entrou em contato por"', () => {
    renderForm({ leadSources: [...leadSources, inactiveLeadSource] })

    const group = screen.getByRole('radiogroup', { name: 'Entrou em contato por' })
    expect(within(group).queryByRole('radio', { name: 'Origem Inativa' })).not.toBeInTheDocument()
  })

  it('com as 6 origens reais, respeita a ordem aprovada mesmo chegando fora de ordem na prop', () => {
    renderForm({ leadSources: allLeadSourcesScrambled })

    const group = screen.getByRole('radiogroup', { name: 'Entrou em contato por' })
    const options = within(group).getAllByRole('radio')
    // "Indicação" é o rótulo VISÍVEL abreviado (a opção mais longa, para
    // caber tudo numa linha em desktop) — o nome acessível completo é
    // testado à parte, abaixo.
    expect(options.map((option) => option.textContent)).toEqual([
      'Indicação',
      'Instagram',
      'WhatsApp',
      'Facebook',
      'TikTok',
      'Outros',
    ])
  })

  it('"Indicação / boca a boca" mostra rótulo abreviado na tela, mas preserva o nome acessível completo', () => {
    renderForm({ leadSources: allLeadSourcesScrambled })

    const group = screen.getByRole('radiogroup', { name: 'Entrou em contato por' })
    const option = within(group).getByRole('radio', { name: 'Indicação / boca a boca' })
    expect(option).toHaveTextContent('Indicação')
    expect(option).not.toHaveTextContent('Indicação / boca a boca')
  })

  it('cada opção de "Entrou em contato por" mostra um ícone decorativo ao lado do nome', () => {
    renderForm({ leadSources: allLeadSourcesScrambled })

    const group = screen.getByRole('radiogroup', { name: 'Entrou em contato por' })
    for (const option of within(group).getAllByRole('radio')) {
      expect(option.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
    }
  })

  it('as 6 origens aparecem como cards verticais (ícone acima, nome abaixo), largura/altura uniformes', () => {
    renderForm({ leadSources: allLeadSourcesScrambled })

    const group = screen.getByRole('radiogroup', { name: 'Entrou em contato por' })
    const options = within(group).getAllByRole('radio')
    expect(options).toHaveLength(6)
    for (const option of options) {
      expect(option).toHaveClass('flex-col')
      expect(option).toHaveClass('items-center')
      expect(option).toHaveClass('w-20')
      expect(option).toHaveClass('h-20')
      // Ícone e nome, cada um em seu próprio nó dentro do card — disposição
      // vertical (não lado a lado).
      const icon = option.querySelector('svg')
      const label = option.querySelector('span')
      expect(icon).toBeInTheDocument()
      expect(label).toBeInTheDocument()
    }
  })

  it('o container de "Entrou em contato por" permite quebra responsiva (flex-wrap), sem overflow forçado', () => {
    renderForm({ leadSources: allLeadSourcesScrambled })

    const group = screen.getByRole('radiogroup', { name: 'Entrou em contato por' })
    expect(group).toHaveClass('flex-wrap')
  })

  it('"Entrou em contato por" é seleção exclusiva: escolher uma origem desmarca a anterior', async () => {
    const user = userEvent.setup()
    renderForm()

    await clickRadio(user, 'Entrou em contato por', 'Instagram')
    expect(screen.getByRole('radio', { name: 'Instagram' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'WhatsApp' })).toHaveAttribute('aria-checked', 'false')

    await clickRadio(user, 'Entrou em contato por', 'WhatsApp')
    expect(screen.getByRole('radio', { name: 'WhatsApp' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Instagram' })).toHaveAttribute('aria-checked', 'false')
  })

  it('envia o lead_source_id da origem selecionada nos novos controles', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await clickRadio(user, 'Entrou em contato por', 'Instagram')
    await fillMinimalValidOrder(user)
    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ lead_source_id: 'l1' }))
  })

  it('nenhuma origem selecionada -> lead_source_id omitido do payload (herança fica com o backend)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await fillMinimalValidOrder(user)
    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(onSubmit).toHaveBeenCalled()
    const submittedValue = onSubmit.mock.calls[0][0]
    expect('lead_source_id' in submittedValue).toBe(false)
  })

  it('Tipo de item: Catálogo aparece marcado/disponível; Personalizado e Spot aparecem desabilitados como "Em breve"', () => {
    renderForm()

    expect(screen.getByLabelText('Catálogo')).toBeChecked()
    expect(screen.getByLabelText('Catálogo')).not.toBeDisabled()

    expect(screen.getByLabelText('Personalizado')).not.toBeChecked()
    expect(screen.getByLabelText('Personalizado')).toBeDisabled()
    expect(screen.getByLabelText('Spot')).not.toBeChecked()
    expect(screen.getByLabelText('Spot')).toBeDisabled()

    expect(screen.getAllByText('Em breve')).toHaveLength(2)
  })

  it('não oferece um produto inativo como opção de item', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('combobox', { name: 'Produto' }))

    expect(screen.queryByText('Produto descontinuado')).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Chaveiro' })).toBeInTheDocument()
  })

  describe('seletor de Produto só oferece product_type=CATALOG ativo (item Catálogo)', () => {
    it('produto CATALOG ativo aparece no seletor', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('combobox', { name: 'Produto' }))

      expect(await screen.findByRole('option', { name: 'Chaveiro' })).toBeInTheDocument()
    })

    it('produto CATALOG inativo não aparece no seletor', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('combobox', { name: 'Produto' }))
      await screen.findByRole('option', { name: 'Chaveiro' })

      expect(screen.queryByRole('option', { name: 'Produto descontinuado' })).not.toBeInTheDocument()
    })

    it('produto CUSTOM ativo (cadastrado como reutilizável) não aparece no seletor', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('combobox', { name: 'Produto' }))
      await screen.findByRole('option', { name: 'Chaveiro' })

      expect(screen.queryByRole('option', { name: 'Miniatura Personalizada Reutilizável' })).not.toBeInTheDocument()
      expect(screen.queryByText('Miniatura Personalizada Reutilizável')).not.toBeInTheDocument()
    })

    it('produto SPOT ativo (cadastrado como reutilizável) não aparece no seletor', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.click(screen.getByRole('combobox', { name: 'Produto' }))
      await screen.findByRole('option', { name: 'Chaveiro' })

      expect(screen.queryByRole('option', { name: 'Peça Spot Reutilizável' })).not.toBeInTheDocument()
      expect(screen.queryByText('Peça Spot Reutilizável')).not.toBeInTheDocument()
    })
  })

  it('nenhuma opção Personalizado ou SPOT é habilitada no formulário de pedido (só Catálogo funcional)', () => {
    renderForm()

    expect(screen.getByLabelText('Catálogo')).not.toBeDisabled()
    expect(screen.getByLabelText('Personalizado')).toBeDisabled()
    expect(screen.getByLabelText('Spot')).toBeDisabled()
    expect(screen.getAllByText('Em breve')).toHaveLength(2)
  })

  it('ao escolher um produto, preenche o preço unitário com default_price, mantendo o campo editável', async () => {
    const user = userEvent.setup()
    renderForm()

    await selectOption(user, 'Produto', 'Chaveiro')

    const unitPriceInput = screen.getByLabelText('Preço unitário') as HTMLInputElement
    expect(unitPriceInput.value).toBe('25')

    await user.clear(unitPriceInput)
    await user.type(unitPriceInput, '30')
    expect(unitPriceInput.value).toBe('30')
  })

  it('a primeira linha de item nasce com quantidade 1', () => {
    renderForm()

    expect((screen.getByLabelText('Quantidade') as HTMLInputElement).value).toBe('1')
  })

  it('uma linha criada por "Adicionar item" também nasce com quantidade 1', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('button', { name: /adicionar item/i }))

    const quantityInputs = screen.getAllByLabelText('Quantidade') as HTMLInputElement[]
    expect(quantityInputs).toHaveLength(2)
    expect(quantityInputs[0].value).toBe('1')
    expect(quantityInputs[1].value).toBe('1')
  })

  it('quantidade nunca cai abaixo de 1 ao clicar em diminuir, partindo do valor inicial', async () => {
    const user = userEvent.setup()
    renderForm()

    const quantityInput = screen.getByLabelText('Quantidade') as HTMLInputElement
    expect(quantityInput.value).toBe('1')

    await user.click(screen.getByRole('button', { name: 'Diminuir quantidade' }))
    expect(quantityInput.value).toBe('1')

    await user.click(screen.getByRole('button', { name: 'Aumentar quantidade' }))
    expect(quantityInput.value).toBe('2')
  })

  it('alterar a quantidade pelo stepper atualiza o total da linha e o total do pedido', async () => {
    const user = userEvent.setup()
    renderForm()

    await selectOption(user, 'Produto', 'Chaveiro')
    await user.click(screen.getByRole('button', { name: 'Aumentar quantidade' }))
    await user.click(screen.getByRole('button', { name: 'Aumentar quantidade' }))

    expect((screen.getByLabelText('Quantidade') as HTMLInputElement).value).toBe('3')
    // Escopado à tabela: com 1 único item, o total da linha e o "Total do
    // pedido" no rodapé coincidem (R$ 75,00 nos dois lugares).
    expect(within(screen.getByRole('table')).getByText('R$ 75,00')).toBeInTheDocument()
    expect(screen.getByText('Total do pedido').closest('div')).toHaveTextContent('R$ 75,00')
  })

  it('destaca o total do pedido no rodapé: fonte grande, peso forte, cor da paleta Forma, contagem de itens em texto secundário', () => {
    renderForm()

    const footer = screen.getByText('Total do pedido').closest('div') as HTMLElement
    const valueEl = within(footer).getByText('R$ 0,00')
    expect(valueEl).toHaveClass('text-brand-primary-dark')
    expect(valueEl).toHaveClass('text-2xl')
    expect(valueEl).toHaveClass('font-bold')

    const itemCount = within(footer).getByText('1 item')
    expect(itemCount).not.toHaveClass('text-2xl')
  })

  it('total do pedido soma o frete quando Correios/Transportadora está selecionado (mesma fórmula de total_receivable)', async () => {
    const user = userEvent.setup()
    renderForm()

    await selectOption(user, 'Produto', 'Chaveiro')
    await clickRadio(user, 'Forma de entrega', 'Correios')
    await user.type(screen.getByLabelText('Frete'), '10')

    // 1 item (Chaveiro, R$ 25,00) + frete R$ 10,00 = R$ 35,00.
    expect(screen.getByText('Total do pedido').closest('div')).toHaveTextContent('R$ 35,00')
  })

  it('total do pedido volta a refletir só os itens quando a forma de entrega muda para "Em mãos" (frete ocultado)', async () => {
    const user = userEvent.setup()
    renderForm()

    await selectOption(user, 'Produto', 'Chaveiro')
    await clickRadio(user, 'Forma de entrega', 'Correios')
    await user.type(screen.getByLabelText('Frete'), '10')
    await clickRadio(user, 'Forma de entrega', 'Em mãos')

    expect(screen.getByText('Total do pedido').closest('div')).toHaveTextContent('R$ 25,00')
  })

  it('adiciona e remove linhas de item, nunca deixando menos de 1', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('button', { name: /adicionar item/i }))
    expect(screen.getAllByLabelText('Quantidade')).toHaveLength(2)

    const removeButtons = screen.getAllByRole('button', { name: 'Remover item' })
    await user.click(removeButtons[0])
    expect(screen.getAllByLabelText('Quantidade')).toHaveLength(1)

    // Última linha não pode ser removida.
    await user.click(screen.getByRole('button', { name: 'Remover item' }))
    expect(screen.getAllByLabelText('Quantidade')).toHaveLength(1)
  })

  it('Forma de entrega "Em mãos": Frete não aparece', () => {
    renderForm()

    expect(screen.queryByLabelText('Frete')).not.toBeInTheDocument()
  })

  it('Forma de entrega "Correios": Frete aparece', async () => {
    const user = userEvent.setup()
    renderForm()

    await clickRadio(user, 'Forma de entrega', 'Correios')

    expect(screen.getByLabelText('Frete')).toBeInTheDocument()
  })

  it('Forma de entrega "Transportadora": Frete aparece', async () => {
    const user = userEvent.setup()
    renderForm()

    await clickRadio(user, 'Forma de entrega', 'Transportadora')

    expect(screen.getByLabelText('Frete')).toBeInTheDocument()
  })

  it('cada opção de Forma de entrega mostra um ícone decorativo ao lado do nome', () => {
    renderForm()

    const group = screen.getByRole('radiogroup', { name: 'Forma de entrega' })
    const options = within(group).getAllByRole('radio')
    expect(options).toHaveLength(3)
    for (const option of options) {
      expect(option.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
    }
  })

  it('escolher "Em mãos" depois de já ter digitado um frete oculta o campo e não deixa o valor antigo vazar no payload', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await clickRadio(user, 'Forma de entrega', 'Correios')
    await user.type(screen.getByLabelText('Frete'), '50')
    await clickRadio(user, 'Forma de entrega', 'Em mãos')

    expect(screen.queryByLabelText('Frete')).not.toBeInTheDocument()

    await fillMinimalValidOrder(user)
    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ shipping_cost: null, delivery_method: 'Em mãos' }))
  })

  it('envia o valor de frete digitado quando Correios está selecionado', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await clickRadio(user, 'Forma de entrega', 'Correios')
    await user.type(screen.getByLabelText('Frete'), '35.5')
    await fillMinimalValidOrder(user)

    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ shipping_cost: 35.5, delivery_method: 'Correios' }),
    )
  })

  it('nenhuma forma de entrega selecionada -> delivery_method e shipping_cost nulos no payload', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await fillMinimalValidOrder(user)
    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ delivery_method: null, shipping_cost: null }))
  })

  it('submete com o payload correto quando cliente e item de Catálogo são válidos, preservando o contrato atual', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
    await selectOption(user, 'Produto', 'Chaveiro')
    const quantityInput = screen.getByLabelText('Quantidade')
    await user.clear(quantityInput)
    await user.type(quantityInput, '2')
    await user.type(screen.getByLabelText('Taxa de personalização'), '10')

    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'c1',
        company_id: null,
        expected_delivery_date: null,
        discount_value: null,
        notes: null,
        items: [
          expect.objectContaining({
            item_type: 'CATALOG',
            product_id: 'p1',
            item_name: 'Chaveiro',
            quantity: 2,
            unit_price: 25,
            personalization_fee: 10,
          }),
        ],
      }),
    )
    // Desconto por item foi removido da interface — nenhuma chave
    // discount_value é enviada por item nesta rodada.
    const submittedValue = onSubmit.mock.calls[0][0]
    expect('discount_value' in submittedValue.items[0]).toBe(false)
  })

  it('não envia e mostra erro quando a quantidade é 0', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
    await selectOption(user, 'Produto', 'Chaveiro')
    const quantityInput = screen.getByLabelText('Quantidade')
    await user.clear(quantityInput)
    await user.type(quantityInput, '0')

    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(await screen.findByText('A quantidade deve ser maior ou igual a 1.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('não envia e mostra erro quando a quantidade é decimal', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
    await selectOption(user, 'Produto', 'Chaveiro')
    const quantityInput = screen.getByLabelText('Quantidade')
    await user.clear(quantityInput)
    await user.type(quantityInput, '1.5')

    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(await screen.findByText('A quantidade deve ser um número inteiro.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('não envia e mostra erro quando o preço unitário é negativo', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await selectOption(user, 'Cliente/Contato', 'Ana Cliente')
    await selectOption(user, 'Produto', 'Chaveiro')

    const unitPriceInput = screen.getByLabelText('Preço unitário')
    await user.clear(unitPriceInput)
    await user.type(unitPriceInput, '-5')

    await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

    expect(await screen.findByText('O preço unitário deve ser maior ou igual a 0.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  describe('Método de pagamento e Prazo de entrega', () => {
    it('mostra os botões Pix, Dinheiro e Cartão, com "Não informado" selecionado por padrão (sem crédito/débito separados)', () => {
      renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Método de pagamento' })
      expect(within(group).getByRole('radio', { name: 'Pix' })).toBeInTheDocument()
      expect(within(group).getByRole('radio', { name: 'Dinheiro' })).toBeInTheDocument()
      expect(within(group).getByRole('radio', { name: 'Cartão' })).toBeInTheDocument()
      expect(within(group).getByRole('radio', { name: 'Não informado' })).toHaveAttribute('aria-checked', 'true')
      expect(within(group).queryByRole('radio', { name: /crédito/i })).not.toBeInTheDocument()
      expect(within(group).queryByRole('radio', { name: /débito/i })).not.toBeInTheDocument()
    })

    it('método de pagamento é um grupo de seleção exclusiva: escolher um desmarca o anterior', async () => {
      const user = userEvent.setup()
      renderForm()

      await clickRadio(user, 'Método de pagamento', 'Pix')
      expect(screen.getByRole('radio', { name: 'Pix' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Não informado' })).toHaveAttribute('aria-checked', 'false')

      await clickRadio(user, 'Método de pagamento', 'Cartão')
      expect(screen.getByRole('radio', { name: 'Cartão' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Pix' })).toHaveAttribute('aria-checked', 'false')
    })

    it('cada opção de Método de pagamento mostra um ícone decorativo ao lado do nome, sem duplicar o nome acessível', () => {
      renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Método de pagamento' })
      for (const option of within(group).getAllByRole('radio')) {
        expect(option.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
      }
    })

    it.each([
      ['Pix', 'PIX'],
      ['Dinheiro', 'DINHEIRO'],
      ['Cartão', 'CARTAO'],
    ])('envia payment_method=%s como %s no payload', async (label, value) => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillMinimalValidOrder(user)
      await clickRadio(user, 'Método de pagamento', label)
      await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ payment_method: value }))
    })

    it('método de pagamento não escolhido envia payment_method: null — campo opcional, sem obrigatoriedade inventada (orders.payment_method é nullable e create_order() nunca exigiu o parâmetro)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillMinimalValidOrder(user)
      await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ payment_method: null }))
      // Sem mensagem de erro nenhuma — não deixar de escolher método de
      // pagamento nunca bloqueia o envio.
      expect(screen.queryByText(/método de pagamento/i, { selector: 'p' })).not.toBeInTheDocument()
    })

    it('Prazo de entrega vazio envia expected_delivery_date: null', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillMinimalValidOrder(user)
      await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ expected_delivery_date: null }))
    })

    it('Prazo de entrega preenchido envia a data no formato YYYY-MM-DD (mesmo formato de expected_delivery_date)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillMinimalValidOrder(user)
      await user.type(screen.getByLabelText('Prazo de entrega'), '2026-09-15')
      await user.click(screen.getByRole('button', { name: /salvar pedido/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ expected_delivery_date: '2026-09-15' }))
    })
  })

  it('chama onCancel ao clicar em Cancelar', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  describe('modo de edição (mode="edit", initialValues, readOnly)', () => {
    const editInitialValues = {
      companyId: null,
      customerId: 'c1',
      leadSourceId: 'l1',
      paymentMethod: 'PIX' as const,
      deliveryMethod: 'Correios',
      shippingCost: 15.5,
      expectedDeliveryDate: '2026-08-25',
      notes: 'Observação existente',
      items: [{ productId: 'p1', quantity: 2, unitPrice: 25, personalizationFee: 0 }],
    }

    it('mostra nº do pedido, status e status financeiro somente leitura, e rotula o botão "Salvar alterações"', () => {
      renderForm({
        mode: 'edit',
        orderNumber: 'FS-26-001',
        orderStatusLabel: 'Orçamento',
        paymentStatusLabel: 'Aguardando pagamento',
        initialValues: editInitialValues,
      })

      expect(screen.getByText('FS-26-001')).toBeInTheDocument()
      expect(screen.getByText('Orçamento')).toBeInTheDocument()
      expect(screen.getByText('Aguardando pagamento')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Salvar pedido' })).not.toBeInTheDocument()
    })

    it('modo create não mostra o bloco de informações somente leitura', () => {
      renderForm()

      expect(screen.queryByText('Nº do pedido')).not.toBeInTheDocument()
    })

    it('pré-preenche cabeçalho e item a partir de initialValues (B2C)', () => {
      renderForm({ mode: 'edit', initialValues: editInitialValues })

      expect(screen.getByRole('radio', { name: 'B2C' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('combobox', { name: 'Cliente/Contato' })).toHaveTextContent('Ana Cliente')
      expect(screen.getByRole('radio', { name: 'Instagram' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Pix' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radio', { name: 'Correios' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText('Frete')).toHaveValue('15.5')
      expect(screen.getByLabelText('Prazo de entrega')).toHaveValue('2026-08-25')
      expect(screen.getByLabelText('Observações')).toHaveValue('Observação existente')
      expect(screen.getByRole('combobox', { name: 'Produto' })).toHaveTextContent('Chaveiro')
      expect(screen.getByLabelText('Quantidade')).toHaveValue('2')
      expect(screen.getByLabelText('Preço unitário')).toHaveValue('25')
    })

    it('pré-preenche em B2B quando initialValues.companyId está presente', () => {
      renderForm({ mode: 'edit', initialValues: { ...editInitialValues, companyId: 'e1' } })

      expect(screen.getByRole('radio', { name: 'B2B' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('combobox', { name: 'Empresa' })).toHaveTextContent('Empresa A')
    })

    it('readOnly desabilita todos os controles, oculta "Salvar alterações" e mostra a mensagem de bloqueio', () => {
      renderForm({
        mode: 'edit',
        initialValues: editInitialValues,
        readOnly: true,
        readOnlyMessage: 'Este pedido está em "Aprovado" — não pode ser totalmente editado.',
      })

      expect(screen.getByText('Este pedido está em "Aprovado" — não pode ser totalmente editado.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /salvar alterações/i })).not.toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Cliente/Contato' })).toBeDisabled()
      expect(screen.getByLabelText('Quantidade')).toBeDisabled()
      expect(screen.getByLabelText('Preço unitário')).toBeDisabled()
      expect(screen.getByRole('button', { name: /adicionar item/i })).toBeDisabled()
      expect(screen.getByRole('radio', { name: 'B2C' })).toBeDisabled()
      expect(screen.getByRole('button', { name: /cancelar/i })).not.toBeDisabled()
    })
  })
})
