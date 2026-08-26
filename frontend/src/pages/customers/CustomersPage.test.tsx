import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'
import type { Company, Customer } from '@/types/domain'

const { useCustomersMock, useCompaniesMock, useLeadSourcesMock, toastMock, useAuthMock } = vi.hoisted(() => ({
  useCustomersMock: vi.fn(),
  useCompaniesMock: vi.fn(),
  useLeadSourcesMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  useAuthMock: vi.fn(),
}))

vi.mock('@/hooks/useCustomers', () => ({ useCustomers: useCustomersMock }))
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: useCompaniesMock }))
vi.mock('@/hooks/useLeadSources', () => ({ useLeadSources: useLeadSourcesMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { CustomersPage } from './CustomersPage'

const company = {
  id: 'c1',
  name: 'Empresa A',
  trade_name: null,
  document_number: null,
  whatsapp: null,
  instagram: null,
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const leadSource = { id: 'l1', name: 'Indicação / boca a boca', is_active: true }

const customer: Customer = {
  id: '1',
  name: 'Ana',
  whatsapp: '11999990000',
  instagram: '@ana',
  company_id: 'c1',
  acquisition_source_id: 'l1',
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

function renderPage() {
  return render(<CustomersPage />, { wrapper: MemoryRouter })
}

function mockCustomers(
  list: Customer[],
  overrides: Partial<{ isLoading: boolean; error: unknown; refetch: ReturnType<typeof vi.fn> }> = {},
  createMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(list[0]),
  updateMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(list[0]),
) {
  useCustomersMock.mockReturnValue({
    customers: list,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    create: createMock,
    update: updateMock,
  })
  return { createMock, updateMock }
}

// Retorna, na ordem visual atual (DOM), o nome de "Cliente" de cada linha de
// dados — usado como "impressão digital" da ordem das linhas em qualquer
// teste de busca/ordenação, já que o nome é sempre visível e único por
// linha neste arquivo, independente de qual coluna está de fato ordenando.
function getVisibleCustomerNamesInOrder(): string[] {
  const dataRows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)
  return dataRows.map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

async function applySort(
  user: ReturnType<typeof userEvent.setup>,
  columnLabel: string,
  option: 'Ordenar crescente' | 'Ordenar decrescente' | 'Remover ordenação',
): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Ordenar coluna ${columnLabel}` }))
  await user.click(await screen.findByRole('menuitem', { name: option }))
}

// A lista de sugestões do autocomplete pode repetir, como sugestão, o
// mesmo nome já visível numa célula da tabela — por isso qualquer
// asserção de presença/ausência de um nome precisa ser explicitamente
// escopada à tabela ou à listbox, nunca screen.getByText/queryByText solto
// (que passaria a encontrar 2 elementos e quebrar com "multiple elements").
function getTable(): HTMLElement {
  return screen.getByRole('table')
}

function queryListbox(): HTMLElement | null {
  return screen.queryByRole('listbox', { name: 'Sugestões de cliente' })
}

function getListbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Sugestões de cliente' })
}

describe('CustomersPage', () => {
  let createMock: ReturnType<typeof vi.fn>
  let updateMock: ReturnType<typeof vi.fn>
  let refetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createMock = vi.fn().mockResolvedValue(customer)
    updateMock = vi.fn().mockResolvedValue(customer)
    refetchMock = vi.fn()

    useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
    useCustomersMock.mockReturnValue({
      customers: [customer],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      update: updateMock,
    })
    useCompaniesMock.mockReturnValue({ companies: [company], isLoading: false, error: null, refetch: vi.fn() })
    useLeadSourcesMock.mockReturnValue({
      leadSources: [leadSource],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('renders the company/lead source names instead of raw ids', () => {
    renderPage()

    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Empresa A')).toBeInTheDocument()
    expect(screen.getByText('Indicação / boca a boca')).toBeInTheDocument()
    expect(screen.queryByText('c1')).not.toBeInTheDocument()
    expect(screen.queryByText('l1')).not.toBeInTheDocument()
  })

  it('shows the column headers in the approved order, with "Cliente" instead of "Nome" and "Como nos conheceu" instead of "Origem"', () => {
    renderPage()

    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual([
      'Cliente',
      'Empresa',
      'WhatsApp',
      'Instagram',
      'Como nos conheceu',
      'Observações',
      'Ativo',
      '',
    ])
    expect(screen.queryByText('Origem')).not.toBeInTheDocument()
    expect(screen.queryByText('Nome')).not.toBeInTheDocument()
  })

  it('keeps each value under the correct column after the reorder', () => {
    renderPage()

    const row = screen.getByRole('row', { name: /ana/i })
    const cells = within(row).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('Ana')
    expect(cells[1]).toHaveTextContent('Empresa A')
    // 11999990000 é um número BR válido (11 dígitos): a listagem agora
    // normaliza para exibição, ver describe 'WhatsApp/Instagram clicáveis'.
    expect(cells[2]).toHaveTextContent('+55 (11) 99999-0000')
    expect(cells[3]).toHaveTextContent('@ana')
    expect(cells[4]).toHaveTextContent('Indicação / boca a boca')
    expect(cells[5]).toHaveTextContent('—')
    expect(within(cells[6]).getByRole('switch')).toBeInTheDocument()
    expect(within(cells[7]).getByRole('button', { name: /editar/i })).toBeInTheDocument()
  })

  it('zebra striping: roxo claro nas linhas ímpares, branco nas pares, só nas linhas de dados do tbody', () => {
    const secondCustomer: Customer = { ...customer, id: '2', name: 'Bruno' }
    mockCustomers([customer, secondCustomer], {}, createMock, updateMock)
    renderPage()

    const dataRows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)
    expect(dataRows).toHaveLength(2)
    for (const row of dataRows) {
      expect(row).toHaveClass('odd:bg-brand-primary-soft/50')
      expect(row).toHaveClass('even:bg-white')
      expect(row).toHaveClass('hover:bg-brand-primary-soft')
    }

    const headerRow = screen
      .getAllByRole('row')
      .find((row) => within(row).queryAllByRole('columnheader').length > 0)
    expect(headerRow).not.toHaveClass('odd:bg-brand-primary-soft/50')
    expect(headerRow).not.toHaveClass('even:bg-white')
  })

  it('clicking "Editar" opens the dialog pre-filled for that customer, with the "Como nos conheceu:" selector', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /editar/i }))

    expect(screen.getByText('Editar cliente')).toBeInTheDocument()
    expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Ana')
    // Regressão: o seletor "Como nos conheceu" (radiogroup de action
    // buttons) continua presente e abre com a origem já cadastrada
    // selecionada — comportamento do CustomerForm, só exercitado aqui via
    // integração com a listagem.
    const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
    expect(within(group).getByRole('radio', { name: 'Como nos conheceu: Indicação / boca a boca' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('opens the dialog, submits a new customer and shows a success toast (formulário Novo cliente sem regressão)', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo cliente/i }))
    await user.type(screen.getByLabelText(/^nome$/i), 'Novo Cliente')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Novo Cliente' })),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Cliente cadastrado.')
  })

  it('toggles active/inactive from the listing, calling update with is_active', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('switch'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('1', { is_active: false }))
  })

  it('shows an inline error with a retry action when the list fails to load', async () => {
    mockCustomers([], { error: new ApiError('database', 500, 'Falha ao carregar clientes.'), refetch: refetchMock }, createMock, updateMock)
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Falha ao carregar clientes.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(refetchMock).toHaveBeenCalled()
  })

  it('shows the loading skeleton (regressão)', () => {
    mockCustomers([], { isLoading: true }, createMock, updateMock)
    renderPage()

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Nenhum cliente cadastrado.')).not.toBeInTheDocument()
  })

  it('lista originalmente vazia mostra "Nenhum cliente cadastrado." (sem busca)', () => {
    mockCustomers([], {}, createMock, updateMock)
    renderPage()

    expect(screen.getByText('Nenhum cliente cadastrado.')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum cliente encontrado para esta busca.')).not.toBeInTheDocument()
  })

  describe('Empresa no formulário de Cliente (ativas vs. inativas — mesmo padrão de OrderForm.tsx)', () => {
    // Duas empresas inativas propositalmente distintas: uma nunca vinculada
    // a nenhum cliente (deve ficar sempre fora da lista) e outra vinculada
    // ao cliente em edição (deve continuar aparecendo só nesse caso, para
    // não apagar/substituir o vínculo existente).
    const inactiveCompany: Company = { ...company, id: 'c2', name: 'Empresa Inativa', is_active: false }
    const inactiveLinkedCompany: Company = {
      ...company,
      id: 'c3',
      name: 'Empresa Vinculada Desativada',
      is_active: false,
    }
    const customerWithInactiveCompany: Customer = { ...customer, id: '5', name: 'Cliente Vinculado', company_id: 'c3' }

    beforeEach(() => {
      useCompaniesMock.mockReturnValue({
        companies: [company, inactiveCompany, inactiveLinkedCompany],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })
    })

    it('empresa ativa aparece na lista ao criar um novo cliente', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /novo cliente/i }))
      await user.click(screen.getByRole('combobox', { name: 'Empresa' }))

      expect(await screen.findByRole('option', { name: 'Empresa A' })).toBeInTheDocument()
    })

    it('empresa inativa (sem vínculo com o cliente em edição) não aparece ao criar um novo cliente', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /novo cliente/i }))
      await user.click(screen.getByRole('combobox', { name: 'Empresa' }))
      await screen.findByRole('option', { name: 'Empresa A' })

      expect(screen.queryByRole('option', { name: 'Empresa Inativa' })).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Empresa Vinculada Desativada' })).not.toBeInTheDocument()
    })

    it('empresa inativa já vinculada ao cliente em edição continua aparecendo e selecionável', async () => {
      mockCustomers([customerWithInactiveCompany], {}, createMock, updateMock)
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /editar/i }))
      await user.click(screen.getByRole('combobox', { name: 'Empresa' }))

      expect(await screen.findByRole('option', { name: 'Empresa Vinculada Desativada' })).toBeInTheDocument()
      // A outra empresa inativa, sem vínculo com ESTE cliente, continua fora.
      expect(screen.queryByRole('option', { name: 'Empresa Inativa' })).not.toBeInTheDocument()
    })

    it('o campo Empresa já abre com o vínculo existente selecionado, mesmo com a empresa desativada', async () => {
      mockCustomers([customerWithInactiveCompany], {}, createMock, updateMock)
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /editar/i }))

      expect(screen.getByRole('combobox', { name: 'Empresa' })).toHaveTextContent('Empresa Vinculada Desativada')
    })

    it('salvar a edição sem tocar no campo Empresa preserva o company_id existente (nenhuma substituição automática)', async () => {
      mockCustomers([customerWithInactiveCompany], {}, createMock, updateMock)
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /editar/i }))
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      await waitFor(() =>
        expect(updateMock).toHaveBeenCalledWith('5', expect.objectContaining({ company_id: 'c3' })),
      )
    })

    it('trocar para uma empresa ativa a partir de um vínculo inativo funciona normalmente', async () => {
      mockCustomers([customerWithInactiveCompany], {}, createMock, updateMock)
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /editar/i }))
      await user.click(screen.getByRole('combobox', { name: 'Empresa' }))
      await user.click(await screen.findByRole('option', { name: 'Empresa A' }))
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      await waitFor(() =>
        expect(updateMock).toHaveBeenCalledWith('5', expect.objectContaining({ company_id: 'c1' })),
      )
    })
  })

  describe('WhatsApp/Instagram clicáveis na listagem', () => {
    function renderWithCustomer(overrides: Partial<typeof customer>) {
      mockCustomers([{ ...customer, ...overrides }], {}, createMock, updateMock)
      renderPage()
    }

    it.each([
      ['+5541999999999', '+55 (41) 99999-9999'],
      ['(41) 99999-9999', '+55 (41) 99999-9999'],
    ])('%s normaliza só para exibição como "%s" e vira link do WhatsApp', (raw, expectedDisplay) => {
      renderWithCustomer({ whatsapp: raw })

      const link = screen.getByRole('link', { name: expectedDisplay })
      expect(link).toHaveTextContent(expectedDisplay)
      expect(link).toHaveAttribute('href', 'https://wa.me/5541999999999')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('valor de WhatsApp irreconhecível permanece texto puro, sem virar link', () => {
      renderWithCustomer({ whatsapp: 'az' })

      expect(screen.getByText('az')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /az/i })).not.toBeInTheDocument()
    })

    it('WhatsApp null continua mostrando "—"', () => {
      renderWithCustomer({ whatsapp: null })

      const row = screen.getByRole('row', { name: /ana/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[2]).toHaveTextContent('—')
      expect(within(cells[2]).queryByRole('link')).not.toBeInTheDocument()
    })

    it.each([
      ['@usuario', '@usuario'],
      ['usuario', '@usuario'],
      ['https://instagram.com/usuario/', '@usuario'],
    ])('%s normaliza só para exibição como "%s" e vira link do Instagram', (raw, expectedDisplay) => {
      renderWithCustomer({ instagram: raw })

      const link = screen.getByRole('link', { name: expectedDisplay })
      expect(link).toHaveTextContent(expectedDisplay)
      expect(link).toHaveAttribute('href', 'https://instagram.com/usuario')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('valor de Instagram irreconhecível permanece texto puro, sem virar link', () => {
      renderWithCustomer({ instagram: 'john doe' })

      expect(screen.getByText('john doe')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /john doe/i })).not.toBeInTheDocument()
    })

    it('Instagram null continua mostrando "—"', () => {
      renderWithCustomer({ instagram: null })

      const row = screen.getByRole('row', { name: /ana/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[3]).toHaveTextContent('—')
      expect(within(cells[3]).queryByRole('link')).not.toBeInTheDocument()
    })
  })

  describe('Busca rápida por cliente', () => {
    const maria: Customer = { ...customer, id: '10', name: 'Maria da Silva', whatsapp: null, instagram: null }
    const joao: Customer = { ...customer, id: '11', name: 'João', whatsapp: null, instagram: null }
    const pedro: Customer = { ...customer, id: '12', name: 'Pedro', whatsapp: '5541999990000', instagram: '@pedrosilva' }

    beforeEach(() => {
      mockCustomers([maria, joao, pedro], {}, createMock, updateMock)
    })

    it('possui rótulo acessível "Buscar cliente" e placeholder "Buscar cliente..."', () => {
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar cliente' })
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('placeholder', 'Buscar cliente...')
    })

    it('busca por nome completo encontra o cliente correspondente', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'Maria da Silva')

      expect(within(getTable()).getByText('Maria da Silva')).toBeInTheDocument()
      expect(within(getTable()).queryByText('João')).not.toBeInTheDocument()
      expect(within(getTable()).queryByText('Pedro')).not.toBeInTheDocument()
    })

    it('busca parcial ("maria") encontra "Maria da Silva"', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'maria')

      expect(within(getTable()).getByText('Maria da Silva')).toBeInTheDocument()
      expect(within(getTable()).queryByText('João')).not.toBeInTheDocument()
    })

    it('busca sem diferenciar maiúsculas/minúsculas', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'PEDRO')

      expect(within(getTable()).getByText('Pedro')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Maria da Silva')).not.toBeInTheDocument()
    })

    it('busca tolerante a acentos ("joao" encontra "João")', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'joao')

      expect(within(getTable()).getByText('João')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Pedro')).not.toBeInTheDocument()
    })

    it('remove espaços extras do termo pesquisado', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), '   maria   ')

      expect(within(getTable()).getByText('Maria da Silva')).toBeInTheDocument()
    })

    it('termo sem resultado mostra o estado vazio específico da busca', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'xyzxyz')

      expect(screen.getByText('Nenhum cliente encontrado para esta busca.')).toBeInTheDocument()
      expect(screen.queryByText('Nenhum cliente cadastrado.')).not.toBeInTheDocument()
    })

    it('não filtra por WhatsApp, Instagram, empresa ou observações — só pelo nome', async () => {
      const user = userEvent.setup()
      renderPage()

      // "pedrosilva" só bate no instagram de Pedro (@pedrosilva), nunca no
      // nome — a busca deve ignorar esse valor e não encontrar ninguém.
      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'pedrosilva')

      expect(screen.getByText('Nenhum cliente encontrado para esta busca.')).toBeInTheDocument()
    })

    it('possui um botão de limpar quando há texto, que restaura a lista completa', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar cliente' })
      await user.type(input, 'maria')
      expect(screen.queryByText('João')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(input).toHaveValue('')
      expect(queryListbox()).not.toBeInTheDocument()
      expect(screen.getByText('Maria da Silva')).toBeInTheDocument()
      expect(screen.getByText('João')).toBeInTheDocument()
      expect(screen.getByText('Pedro')).toBeInTheDocument()
    })

    it('não faz nenhuma nova chamada ao hook/API enquanto o usuário digita', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'maria')

      expect(refetchMock).not.toHaveBeenCalled()
      expect(createMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
    })
  })

  describe('Autocomplete/typeahead do campo "Buscar cliente"', () => {
    const leandroAugusto: Customer = { ...customer, id: '20', name: 'Leandro Augusto', whatsapp: null, instagram: null }
    const leandroMartinato: Customer = {
      ...customer,
      id: '21',
      name: 'Leandro Martinato',
      whatsapp: null,
      instagram: null,
    }
    const beatriz: Customer = { ...customer, id: '22', name: 'Beatriz', whatsapp: null, instagram: null }
    const jose: Customer = { ...customer, id: '23', name: 'José', whatsapp: null, instagram: null }

    beforeEach(() => {
      mockCustomers([leandroAugusto, leandroMartinato, beatriz, jose], {}, createMock, updateMock)
    })

    it('não abre a lista com o campo vazio, nem só ao focar o campo', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('combobox', { name: 'Buscar cliente' }))

      expect(queryListbox()).not.toBeInTheDocument()
    })

    it('digitar "leandro" mostra os dois na tabela e nas sugestões', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'leandro')

      expect(within(getTable()).getByText('Leandro Augusto')).toBeInTheDocument()
      expect(within(getTable()).getByText('Leandro Martinato')).toBeInTheDocument()
      const options = within(getListbox()).getAllByRole('option')
      expect(options.map((option) => option.textContent)).toEqual(['Leandro Augusto', 'Leandro Martinato'])
    })

    it('digitar "leandro a" mantém somente "Leandro Augusto" na tabela e nas sugestões', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'leandro a')

      expect(within(getTable()).getByText('Leandro Augusto')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Leandro Martinato')).not.toBeInTheDocument()
      const options = within(getListbox()).getAllByRole('option')
      expect(options.map((option) => option.textContent)).toEqual(['Leandro Augusto'])
    })

    it('apagar caracteres (voltando de "leandro a" para "leandro") atualiza tabela e sugestões, trazendo os dois de volta', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar cliente' })
      await user.type(input, 'leandro a')
      expect(within(getListbox()).getAllByRole('option')).toHaveLength(1)

      await user.keyboard('{Backspace}{Backspace}')

      expect(within(getTable()).getByText('Leandro Augusto')).toBeInTheDocument()
      expect(within(getTable()).getByText('Leandro Martinato')).toBeInTheDocument()
      expect(within(getListbox()).getAllByRole('option')).toHaveLength(2)
    })

    it('sugestões sem diferenciar maiúsculas/minúsculas e tolerantes a acentos', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'LEANDRO')
      expect(within(getListbox()).getAllByRole('option')).toHaveLength(2)

      await user.clear(screen.getByRole('combobox', { name: 'Buscar cliente' }))
      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'jose')

      expect(within(getListbox()).getByRole('option', { name: 'José' })).toBeInTheDocument()
    })

    it('quando não há correspondência, a caixa de sugestões mostra "Nenhum cliente encontrado."', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'zzz')

      expect(within(getListbox()).getByText('Nenhum cliente encontrado.')).toBeInTheDocument()
      expect(screen.getByText('Nenhum cliente encontrado para esta busca.')).toBeInTheDocument()
    })

    it('clicar numa sugestão preenche o nome completo, filtra a tabela e fecha a lista', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'leandro')
      await user.click(within(getListbox()).getByRole('option', { name: 'Leandro Martinato' }))

      expect(screen.getByRole('combobox', { name: 'Buscar cliente' })).toHaveValue('Leandro Martinato')
      expect(queryListbox()).not.toBeInTheDocument()
      expect(within(getTable()).getByText('Leandro Martinato')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Leandro Augusto')).not.toBeInTheDocument()
    })

    it('ArrowDown + Enter seleciona a primeira sugestão (ordem visual atual)', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar cliente' })
      await user.type(input, 'leandro')
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{Enter}')

      expect(input).toHaveValue('Leandro Augusto')
      expect(queryListbox()).not.toBeInTheDocument()
      expect(within(getTable()).queryByText('Leandro Martinato')).not.toBeInTheDocument()
    })

    it('ArrowUp navega para a sugestão anterior', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar cliente' })
      await user.type(input, 'leandro')
      await user.keyboard('{ArrowDown}{ArrowDown}') // ativa Martinato (índice 1)
      await user.keyboard('{ArrowUp}') // volta para Augusto (índice 0)
      await user.keyboard('{Enter}')

      expect(input).toHaveValue('Leandro Augusto')
    })

    it('Escape fecha a lista sem apagar o texto digitado', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar cliente' })
      await user.type(input, 'leandro')
      await user.keyboard('{Escape}')

      expect(queryListbox()).not.toBeInTheDocument()
      expect(input).toHaveValue('leandro')
      // Escape não desfaz o filtro da tabela — só fecha o autocomplete.
      expect(within(getTable()).getByText('Leandro Augusto')).toBeInTheDocument()
      expect(within(getTable()).getByText('Leandro Martinato')).toBeInTheDocument()
    })

    it('clicar fora do campo/lista fecha as sugestões, sem alterar o texto nem a tabela', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar cliente' })
      await user.type(input, 'leandro')
      expect(queryListbox()).toBeInTheDocument()

      await user.click(screen.getByRole('heading', { name: 'Clientes' }))

      expect(queryListbox()).not.toBeInTheDocument()
      expect(input).toHaveValue('leandro')
    })

    it('"Limpar busca" fecha o autocomplete e restaura a tabela completa', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'leandro')
      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(queryListbox()).not.toBeInTheDocument()
      expect(within(getTable()).getByText('Beatriz')).toBeInTheDocument()
      expect(within(getTable()).getByText('José')).toBeInTheDocument()
    })

    it('voltar a editar o texto reabre as sugestões com a lista atualizada', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar cliente' })
      await user.type(input, 'leandro')
      await user.click(within(getListbox()).getByRole('option', { name: 'Leandro Augusto' }))
      expect(queryListbox()).not.toBeInTheDocument()

      await user.type(input, ' ')

      expect(queryListbox()).toBeInTheDocument()
    })

    it('nenhuma seleção automática mesmo com uma única sugestão correspondente', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar cliente' })
      await user.type(input, 'martinato')

      expect(within(getListbox()).getAllByRole('option')).toHaveLength(1)
      // O texto digitado continua exatamente como o usuário escreveu — só
      // clique ou Enter explícitos preenchem o nome completo.
      expect(input).toHaveValue('martinato')
      expect(within(getTable()).getByText('Leandro Martinato')).toBeInTheDocument()
    })

    it('a tabela continua sendo filtrada normalmente enquanto a lista de sugestões está aberta', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'leandro a')

      expect(queryListbox()).toBeInTheDocument()
      expect(within(getTable()).getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)).toHaveLength(1)
    })

    it('a ordenação ativa da tabela é preservada ao selecionar uma sugestão', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Cliente', 'Ordenar decrescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'leandro')
      await user.click(within(getListbox()).getByRole('option', { name: 'Leandro Augusto' }))

      expect(screen.getByRole('columnheader', { name: /^Cliente/ })).toHaveAttribute('aria-sort', 'descending')
    })

    it('nenhuma nova chamada ao hook/API ao abrir/navegar/selecionar sugestões', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'leandro')
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
      await user.click(within(getListbox()).getByRole('option', { name: 'Leandro Augusto' }))

      expect(refetchMock).not.toHaveBeenCalled()
      expect(createMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
    })

    it('não duplica sugestões quando a mesma referência de cliente aparece repetida no array', async () => {
      mockCustomers([leandroAugusto, leandroAugusto], {}, createMock, updateMock)
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'leandro')

      expect(within(getListbox()).getAllByRole('option')).toHaveLength(1)
    })

    it('atributos e nomes acessíveis do combobox/listbox/opções', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar cliente' })
      expect(input).toHaveAttribute('aria-autocomplete', 'list')
      expect(input).toHaveAttribute('aria-controls', 'customer-search-listbox')
      expect(input).toHaveAttribute('aria-expanded', 'false')
      expect(input).not.toHaveAttribute('aria-activedescendant')

      await user.type(input, 'leandro')
      expect(input).toHaveAttribute('aria-expanded', 'true')
      expect(getListbox()).toHaveAttribute('id', 'customer-search-listbox')

      await user.keyboard('{ArrowDown}')
      const activeOption = within(getListbox()).getByRole('option', { name: 'Leandro Augusto' })
      expect(input).toHaveAttribute('aria-activedescendant', activeOption.id)
      expect(activeOption).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('Ordenação por coluna (menu estilo filtro de tabela)', () => {
    // Conjunto único de 4 clientes reaproveitado por todos os testes desta
    // seção. Propositalmente inclui: valores vazios (id '3' e, só para
    // "Como nos conheceu", também id '4') para provar que ficam sempre no
    // final; e um empate real de nome ('ana' vs 'Ana', id '2' e '3', nessa
    // ordem original) para provar estabilidade — comparação por
    // Intl.Collator(sensitivity:'base') trata os dois como iguais, então o
    // desempate deve preservar a ordem original (índice 1 antes do 2).
    const rowCarlos: Customer = {
      id: '1',
      name: 'Carlos',
      whatsapp: '+5541988880001',
      instagram: '@zzz_carlos',
      company_id: 'c-zeta',
      acquisition_source_id: 'l-whatsapp',
      notes: 'Zebra note',
      is_active: true,
      created_at: '',
      updated_at: '',
    }
    const rowAnaLower: Customer = {
      id: '2',
      name: 'ana',
      whatsapp: '+5541988880002',
      instagram: '@aaa_ana',
      company_id: 'c-alfa',
      acquisition_source_id: 'l-instagram',
      notes: 'Alpha note',
      is_active: false,
      created_at: '',
      updated_at: '',
    }
    const rowAnaUpper: Customer = {
      id: '3',
      name: 'Ana',
      whatsapp: null,
      instagram: null,
      company_id: null,
      acquisition_source_id: null,
      notes: null,
      is_active: true,
      created_at: '',
      updated_at: '',
    }
    const rowBeatriz: Customer = {
      id: '4',
      name: 'Beatriz',
      whatsapp: '+5541988880003',
      instagram: '@mmm_beatriz',
      company_id: 'c-beta',
      acquisition_source_id: null,
      notes: 'Beta note',
      is_active: true,
      created_at: '',
      updated_at: '',
    }

    beforeEach(() => {
      mockCustomers([rowCarlos, rowAnaLower, rowAnaUpper, rowBeatriz], {}, createMock, updateMock)
      useCompaniesMock.mockReturnValue({
        companies: [
          { ...company, id: 'c-zeta', name: 'Zeta Ltda' },
          { ...company, id: 'c-alfa', name: 'Alfa Ltda' },
          { ...company, id: 'c-beta', name: 'Beta Ltda' },
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })
      useLeadSourcesMock.mockReturnValue({
        leadSources: [
          { id: 'l-whatsapp', name: 'WhatsApp', is_active: true },
          { id: 'l-instagram', name: 'Instagram', is_active: true },
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })
    })

    it.each([
      ['Cliente', ['ana', 'Ana', 'Beatriz', 'Carlos'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Empresa', ['ana', 'Beatriz', 'Carlos', 'Ana'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['WhatsApp', ['Carlos', 'ana', 'Beatriz', 'Ana'], ['Beatriz', 'ana', 'Carlos', 'Ana']],
      ['Instagram', ['ana', 'Beatriz', 'Carlos', 'Ana'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Como nos conheceu', ['ana', 'Carlos', 'Ana', 'Beatriz'], ['Carlos', 'ana', 'Ana', 'Beatriz']],
      ['Observações', ['ana', 'Beatriz', 'Carlos', 'Ana'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Ativo', ['ana', 'Carlos', 'Ana', 'Beatriz'], ['Carlos', 'Ana', 'Beatriz', 'ana']],
    ])('coluna %s: crescente e decrescente respeitam a ordem esperada (vazios sempre no final)', async (columnLabel, ascOrder, descOrder) => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, columnLabel, 'Ordenar crescente')
      expect(getVisibleCustomerNamesInOrder()).toEqual(ascOrder)

      await applySort(user, columnLabel, 'Ordenar decrescente')
      expect(getVisibleCustomerNamesInOrder()).toEqual(descOrder)
    })

    it('somente uma coluna ordenada por vez: escolher outra coluna substitui a ordenação anterior', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Cliente', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Cliente/ })).toHaveAttribute('aria-sort', 'ascending')

      await applySort(user, 'Empresa', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Empresa/ })).toHaveAttribute('aria-sort', 'ascending')
      expect(screen.getByRole('columnheader', { name: /^Cliente/ })).toHaveAttribute('aria-sort', 'none')
      expect(getVisibleCustomerNamesInOrder()).toEqual(['ana', 'Beatriz', 'Carlos', 'Ana'])
    })

    it('remover a ordenação restaura a ordem original (a ordem em que o hook devolveu os registros)', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Cliente', 'Ordenar decrescente')
      expect(getVisibleCustomerNamesInOrder()).not.toEqual(['Carlos', 'ana', 'Ana', 'Beatriz'])

      await applySort(user, 'Cliente', 'Remover ordenação')

      expect(getVisibleCustomerNamesInOrder()).toEqual(['Carlos', 'ana', 'Ana', 'Beatriz'])
      expect(screen.getByRole('columnheader', { name: /^Cliente/ })).toHaveAttribute('aria-sort', 'none')
    })

    it('aria-sort correto: none por padrão, ascending/descending após ordenar', async () => {
      const user = userEvent.setup()
      renderPage()

      expect(screen.getByRole('columnheader', { name: /^Cliente/ })).toHaveAttribute('aria-sort', 'none')

      await applySort(user, 'Cliente', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Cliente/ })).toHaveAttribute('aria-sort', 'ascending')

      await applySort(user, 'Cliente', 'Ordenar decrescente')
      expect(screen.getByRole('columnheader', { name: /^Cliente/ })).toHaveAttribute('aria-sort', 'descending')
    })

    it('a coluna de ações (sem título nem dado próprio) não é ordenável', () => {
      renderPage()

      const headers = screen.getAllByRole('columnheader')
      const actionsHeader = headers[headers.length - 1]
      expect(actionsHeader).toHaveTextContent('')
      expect(within(actionsHeader).queryByRole('button', { name: /ordenar coluna/i })).not.toBeInTheDocument()
      expect(actionsHeader).not.toHaveAttribute('aria-sort')
    })

    it('nomes acessíveis claros nos botões de ordenação de cada coluna', () => {
      renderPage()

      for (const label of ['Cliente', 'WhatsApp', 'Instagram', 'Como nos conheceu', 'Empresa', 'Observações', 'Ativo']) {
        expect(screen.getByRole('button', { name: `Ordenar coluna ${label}` })).toBeInTheDocument()
      }
    })

    it('o menu é utilizável por teclado e fecha após selecionar uma opção', async () => {
      const user = userEvent.setup()
      renderPage()

      const trigger = screen.getByRole('button', { name: 'Ordenar coluna Cliente' })
      trigger.focus()
      await user.keyboard('{Enter}')

      const option = await screen.findByRole('menuitem', { name: 'Ordenar crescente' })
      expect(option).toBeInTheDocument()

      await user.keyboard('{Enter}')

      await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Ordenar crescente' })).not.toBeInTheDocument())
      expect(screen.getByRole('columnheader', { name: /^Cliente/ })).toHaveAttribute('aria-sort', 'ascending')
    })
  })

  describe('Combinação entre busca e ordenação', () => {
    const rowCarlos: Customer = { ...customer, id: '1', name: 'Carlos', whatsapp: null, instagram: null }
    const rowAlice: Customer = { ...customer, id: '2', name: 'Alice', whatsapp: null, instagram: null }
    const rowAmanda: Customer = { ...customer, id: '3', name: 'Amanda', whatsapp: null, instagram: null }

    beforeEach(() => {
      mockCustomers([rowCarlos, rowAlice, rowAmanda], {}, createMock, updateMock)
    })

    it('primeiro filtra pelo nome, depois ordena o resultado filtrado', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'a')
      // "a" bate em Carlos, Alice e Amanda (todos contêm "a") — confirma
      // que os 3 continuam presentes antes de ordenar.
      expect(getVisibleCustomerNamesInOrder()).toHaveLength(3)

      await applySort(user, 'Cliente', 'Ordenar crescente')
      expect(getVisibleCustomerNamesInOrder()).toEqual(['Alice', 'Amanda', 'Carlos'])

      await user.clear(screen.getByRole('combobox', { name: 'Buscar cliente' }))
      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'am')
      // Só Amanda contém "am" — busca aplicada sobre a lista já ordenada,
      // resultado final ainda deve respeitar a ordenação ativa.
      expect(getVisibleCustomerNamesInOrder()).toEqual(['Amanda'])
    })

    it('limpar a busca mantém a ordenação ativa', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Cliente', 'Ordenar decrescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'a')
      expect(getVisibleCustomerNamesInOrder()).toEqual(['Carlos', 'Amanda', 'Alice'])

      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(getVisibleCustomerNamesInOrder()).toEqual(['Carlos', 'Amanda', 'Alice'])
      expect(screen.getByRole('columnheader', { name: /^Cliente/ })).toHaveAttribute('aria-sort', 'descending')
    })

    it('remover a ordenação mantém a busca ativa', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Cliente', 'Ordenar crescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar cliente' }), 'am')
      expect(getVisibleCustomerNamesInOrder()).toEqual(['Amanda'])

      await applySort(user, 'Cliente', 'Remover ordenação')

      expect(screen.getByRole('combobox', { name: 'Buscar cliente' })).toHaveValue('am')
      expect(getVisibleCustomerNamesInOrder()).toEqual(['Amanda'])
    })

    it('zebra striping é recalculado conforme a ordem visual resultante da busca + ordenação', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Cliente', 'Ordenar crescente')

      const dataRows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)
      expect(dataRows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
        'Alice',
        'Amanda',
        'Carlos',
      ])
      for (const row of dataRows) {
        expect(row).toHaveClass('odd:bg-brand-primary-soft/50')
        expect(row).toHaveClass('even:bg-white')
      }
    })
  })
})
