import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'
import type { Company, Customer } from '@/types/domain'

const { useCompaniesMock, useCustomersMock, toastMock, useAuthMock } = vi.hoisted(() => ({
  useCompaniesMock: vi.fn(),
  useCustomersMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  useAuthMock: vi.fn(),
}))

vi.mock('@/hooks/useCompanies', () => ({ useCompanies: useCompaniesMock }))
vi.mock('@/hooks/useCustomers', () => ({ useCustomers: useCustomersMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { CompaniesPage } from './CompaniesPage'

const company: Company = {
  id: 'c1',
  name: 'Empresa A',
  trade_name: 'Fantasia A',
  document_number: '12345678000199',
  whatsapp: null,
  instagram: null,
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
}

function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cust-1',
    name: 'Ana Cliente',
    whatsapp: null,
    instagram: null,
    company_id: 'c1',
    acquisition_source_id: null,
    notes: null,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function renderPage() {
  return render(<CompaniesPage />, { wrapper: MemoryRouter })
}

function mockCompanies(
  list: Company[],
  overrides: Partial<{ isLoading: boolean; error: unknown; refetch: ReturnType<typeof vi.fn> }> = {},
  createMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(list[0]),
  updateMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(list[0]),
) {
  useCompaniesMock.mockReturnValue({
    companies: list,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    create: createMock,
    update: updateMock,
  })
}

function mockLinkedCustomers(list: Customer[]) {
  useCustomersMock.mockReturnValue({
    customers: list,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  })
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
  return screen.queryByRole('listbox', { name: 'Sugestões de empresa' })
}

function getListbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Sugestões de empresa' })
}

async function applySort(
  user: ReturnType<typeof userEvent.setup>,
  columnLabel: string,
  option: 'Ordenar crescente' | 'Ordenar decrescente' | 'Remover ordenação',
): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Ordenar coluna ${columnLabel}` }))
  await user.click(await screen.findByRole('menuitem', { name: option }))
}

// Retorna, na ordem visual atual (DOM), o nome de "Empresa" de cada linha
// de dados — usado como "impressão digital" da ordem das linhas em
// qualquer teste de busca/ordenação, já que o nome é sempre visível e
// único por linha nos fixtures usados aqui, independente de qual coluna
// está de fato ordenando.
function getVisibleCompanyNamesInOrder(): string[] {
  const dataRows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)
  return dataRows.map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

describe('CompaniesPage', () => {
  let createMock: ReturnType<typeof vi.fn>
  let updateMock: ReturnType<typeof vi.fn>
  let refetchMock: ReturnType<typeof vi.fn>
  let customersRefetchMock: ReturnType<typeof vi.fn>
  let customersUpdateMock: ReturnType<typeof vi.fn>
  let customersCreateMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createMock = vi.fn().mockResolvedValue(company)
    updateMock = vi.fn().mockResolvedValue(company)
    refetchMock = vi.fn()
    customersRefetchMock = vi.fn()
    customersUpdateMock = vi.fn()
    customersCreateMock = vi.fn()

    useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
    useCompaniesMock.mockReturnValue({
      companies: [company],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      update: updateMock,
    })
    useCustomersMock.mockReturnValue({
      customers: [],
      isLoading: false,
      error: null,
      refetch: customersRefetchMock,
      create: customersCreateMock,
      update: customersUpdateMock,
    })
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('renders the company table with the expected columns (Nome fantasia e Documento continuam ausentes da listagem)', () => {
    renderPage()

    expect(screen.getByText('Empresa A')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Empresa' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Contato(s)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Instagram' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Observações' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Ativo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editar/i })).toBeInTheDocument()

    expect(screen.queryByRole('columnheader', { name: 'Nome fantasia' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Documento' })).not.toBeInTheDocument()
    // Os valores continuam existindo no domínio, só não aparecem mais na tabela.
    expect(screen.queryByText('Fantasia A')).not.toBeInTheDocument()
    expect(screen.queryByText('12345678000199')).not.toBeInTheDocument()
  })

  it('ordem das colunas: Empresa, Contato(s), WhatsApp, Instagram, Observações, Ativo, Ações', () => {
    renderPage()

    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual([
      'Empresa',
      'Contato(s)',
      'WhatsApp',
      'Instagram',
      'Observações',
      'Ativo',
      '',
    ])
  })

  it('nome longo é truncado visualmente na listagem, mantendo o texto completo em title', () => {
    const longCompany: Company = {
      ...company,
      name: 'Empresa Com Um Nome Extremamente Longo Para Testar Truncamento Visual Ltda',
    }
    useCompaniesMock.mockReturnValue({
      companies: [longCompany],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      update: updateMock,
    })
    renderPage()

    const nameCell = screen.getByText(longCompany.name)
    expect(nameCell).toHaveClass('truncate')
    expect(nameCell.closest('td')).toHaveAttribute('title', longCompany.name)
  })

  it('editar abre o formulário só com Nome/WhatsApp/Instagram/Observações; Nome fantasia e Documento não aparecem em lugar nenhum', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /editar/i }))

    expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Empresa A')
    expect(screen.getByRole('textbox', { name: /whatsapp/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /instagram/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /observações/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/nome fantasia/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Fantasia A')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/documento/i)).not.toBeInTheDocument()
  })

  it('editar e salvar outros campos não envia trade_name nem document_number no payload — preserva os valores já existentes no banco', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /editar/i }))
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(updateMock).toHaveBeenCalled())
    const [, submittedValues] = updateMock.mock.calls[0]
    expect(submittedValues).not.toHaveProperty('trade_name')
    expect(submittedValues).not.toHaveProperty('document_number')
  })

  describe('zebra striping', () => {
    it('primeira linha (ímpar) roxa clara, segunda linha (par) branca, header fora da contagem', () => {
      const secondCompany: Company = { ...company, id: 'c2', name: 'Empresa B' }
      useCompaniesMock.mockReturnValue({
        companies: [company, secondCompany],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        update: updateMock,
      })
      renderPage()

      const dataRows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)
      expect(dataRows).toHaveLength(2)
      expect(dataRows[0]).toHaveClass('odd:bg-brand-primary-soft/50')
      expect(dataRows[1]).toHaveClass('even:bg-white')
      for (const row of dataRows) {
        expect(row).toHaveClass('hover:bg-brand-primary-soft')
      }

      const headerRow = screen
        .getAllByRole('row')
        .find((row) => within(row).queryAllByRole('columnheader').length > 0)
      expect(headerRow).not.toHaveClass('odd:bg-brand-primary-soft/50')
      expect(headerRow).not.toHaveClass('even:bg-white')
    })

    it('com apenas uma empresa, a primeira linha aparece com o fundo roxo suave (ímpar)', () => {
      renderPage()

      const dataRows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)
      expect(dataRows).toHaveLength(1)
      expect(dataRows[0]).toHaveClass('odd:bg-brand-primary-soft/50')
    })
  })

  it('botão "Nova empresa" usa a paleta Forma (bg-brand-primary)', () => {
    renderPage()

    const button = screen.getByRole('button', { name: /nova empresa/i })
    expect(button).toHaveClass('bg-brand-primary')
    expect(button).toHaveClass('text-brand-primary-foreground')
  })

  it('botão "Editar" preservado, com borda e texto roxos', () => {
    renderPage()

    const button = screen.getByRole('button', { name: /editar/i })
    expect(button).toHaveClass('border-brand-primary')
    expect(button).toHaveClass('text-brand-primary')
  })

  it('opens the dialog, submits a new company and shows a success toast', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /nova empresa/i }))
    await user.type(screen.getByLabelText(/^nome$/i), 'Nova Empresa')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nova Empresa' })),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Empresa cadastrada.')
  })

  describe('Switch de ativo/inativo na listagem', () => {
    it('usa a paleta Forma e nome acessível com a ação e o nome da empresa', () => {
      renderPage()

      const toggle = screen.getByRole('switch', { name: 'Desativar Empresa A' })
      expect(toggle).toHaveClass('data-checked:bg-brand-primary')
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })

    it('empresa inativa é renderizada com o Switch desmarcado e nome acessível de ativar', () => {
      useCompaniesMock.mockReturnValue({
        companies: [{ ...company, is_active: false }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        update: updateMock,
      })
      renderPage()

      const toggle = screen.getByRole('switch', { name: 'Ativar Empresa A' })
      expect(toggle).toHaveAttribute('aria-checked', 'false')
    })

    it('clicar no Switch de uma empresa ativa chama update com o id correto e is_active: false', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('switch', { name: 'Desativar Empresa A' }))

      await waitFor(() => expect(updateMock).toHaveBeenCalledWith('c1', { is_active: false }))
    })

    it('clicar no Switch de uma empresa inativa chama update com o id correto e is_active: true', async () => {
      useCompaniesMock.mockReturnValue({
        companies: [{ ...company, is_active: false }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        update: updateMock,
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('switch', { name: 'Ativar Empresa A' }))

      await waitFor(() => expect(updateMock).toHaveBeenCalledWith('c1', { is_active: true }))
    })

    it('bloqueia o Switch enquanto a mutation está pendente', async () => {
      let resolveUpdate: (value: Company) => void = () => {}
      updateMock.mockReturnValue(
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
      )
      const user = userEvent.setup()
      renderPage()

      const toggle = screen.getByRole('switch', { name: 'Desativar Empresa A' })
      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-disabled', 'true')

      resolveUpdate({ ...company, is_active: false })
      await waitFor(() => expect(toggle).not.toHaveAttribute('aria-disabled', 'true'))
    })

    it('mostra um toast de erro quando a mutation falha, sem travar o Switch', async () => {
      updateMock.mockRejectedValue(new ApiError('database', 500, 'Falha ao atualizar empresa.'))
      const user = userEvent.setup()
      renderPage()

      const toggle = screen.getByRole('switch', { name: 'Desativar Empresa A' })
      await user.click(toggle)

      await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Falha ao atualizar empresa.'))
      expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
    })
  })

  it('shows an inline error with a retry action when the list fails to load', async () => {
    useCompaniesMock.mockReturnValue({
      companies: [],
      isLoading: false,
      error: new ApiError('database', 500, 'Falha ao carregar empresas.'),
      refetch: refetchMock,
      create: createMock,
      update: updateMock,
    })
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Falha ao carregar empresas.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(refetchMock).toHaveBeenCalled()
  })

  it('shows a loading skeleton while companies are loading, instead of the table or the empty state', () => {
    useCompaniesMock.mockReturnValue({
      companies: [],
      isLoading: true,
      error: null,
      refetch: refetchMock,
      create: createMock,
      update: updateMock,
    })
    renderPage()

    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByText('Nenhuma empresa cadastrada.')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no companies', () => {
    useCompaniesMock.mockReturnValue({
      companies: [],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      update: updateMock,
    })
    renderPage()

    expect(screen.getByText('Nenhuma empresa cadastrada.')).toBeInTheDocument()
  })

  describe('WhatsApp/Instagram clicáveis na listagem', () => {
    function renderWithCompany(overrides: Partial<Company>) {
      useCompaniesMock.mockReturnValue({
        companies: [{ ...company, ...overrides }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        update: updateMock,
      })
      renderPage()
    }

    it.each([
      ['+5541999999999', '+55 (41) 99999-9999'],
      ['(41) 99999-9999', '+55 (41) 99999-9999'],
    ])('%s normaliza só para exibição como "%s" e vira link do WhatsApp', (raw, expectedDisplay) => {
      renderWithCompany({ whatsapp: raw })

      const link = screen.getByRole('link', { name: expectedDisplay })
      expect(link).toHaveTextContent(expectedDisplay)
      expect(link).toHaveAttribute('href', 'https://wa.me/5541999999999')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer')
    })

    it('valor de WhatsApp irreconhecível permanece texto puro, sem virar link', () => {
      renderWithCompany({ whatsapp: 'az' })

      expect(screen.getByText('az')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /az/i })).not.toBeInTheDocument()
    })

    it('WhatsApp null continua mostrando "—", sem link', () => {
      renderWithCompany({ whatsapp: null })

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[2]).toHaveTextContent('—')
      expect(within(cells[2]).queryByRole('link')).not.toBeInTheDocument()
    })

    it('WhatsApp vazio nunca vira link (mesmo comportamento de campo ausente já usado em Clientes)', () => {
      renderWithCompany({ whatsapp: '' })

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(within(cells[2]).queryByRole('link')).not.toBeInTheDocument()
    })

    it.each([
      ['@usuario', '@usuario'],
      ['usuario', '@usuario'],
      ['https://instagram.com/usuario/', '@usuario'],
    ])('%s normaliza só para exibição como "%s" e vira link do Instagram', (raw, expectedDisplay) => {
      renderWithCompany({ instagram: raw })

      const link = screen.getByRole('link', { name: expectedDisplay })
      expect(link).toHaveTextContent(expectedDisplay)
      expect(link).toHaveAttribute('href', 'https://instagram.com/usuario')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer')
    })

    it('valor de Instagram irreconhecível permanece texto puro, sem virar link', () => {
      renderWithCompany({ instagram: 'john doe' })

      expect(screen.getByText('john doe')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /john doe/i })).not.toBeInTheDocument()
    })

    it('Instagram null continua mostrando "—", sem link', () => {
      renderWithCompany({ instagram: null })

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[3]).toHaveTextContent('—')
      expect(within(cells[3]).queryByRole('link')).not.toBeInTheDocument()
    })
  })

  describe('coluna Observações na listagem', () => {
    function renderWithCompany(overrides: Partial<Company>) {
      useCompaniesMock.mockReturnValue({
        companies: [{ ...company, ...overrides }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        update: updateMock,
      })
      renderPage()
    }

    it('observação preenchida aparece na linha correspondente', () => {
      renderWithCompany({ notes: 'Cliente prefere contato por WhatsApp.' })

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[4]).toHaveTextContent('Cliente prefere contato por WhatsApp.')
    })

    it('observação longa é truncada visualmente, com o texto completo em title', () => {
      const longNote =
        'Observação bastante longa para verificar se o truncamento visual e o atributo title funcionam corretamente nesta coluna da listagem de empresas.'
      renderWithCompany({ notes: longNote })

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[4]).toHaveClass('truncate')
      expect(cells[4]).toHaveAttribute('title', longNote)
    })

    it('observação nula mostra "—"', () => {
      renderWithCompany({ notes: null })

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[4]).toHaveTextContent('—')
    })

    it('observação vazia mostra "—"', () => {
      renderWithCompany({ notes: '' })

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[4]).toHaveTextContent('—')
    })

    it('observação só com espaços em branco mostra "—"', () => {
      renderWithCompany({ notes: '   ' })

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[4]).toHaveTextContent('—')
    })
  })

  describe('coluna Contato(s) na listagem — clientes cujo company_id aponta para a empresa', () => {
    it('coluna existe na posição correta (entre Nome e WhatsApp)', () => {
      renderPage()

      const headers = screen.getAllByRole('columnheader').map((header) => header.textContent)
      expect(headers[0]).toBe('Empresa')
      expect(headers[1]).toBe('Contato(s)')
      expect(headers[2]).toBe('WhatsApp')
    })

    it('empresa com um cliente vinculado mostra o nome dele', () => {
      useCustomersMock.mockReturnValue({
        customers: [customerFixture({ name: 'Ana Cliente', company_id: 'c1' })],
        isLoading: false,
        error: null,
        refetch: customersRefetchMock,
        create: customersCreateMock,
        update: customersUpdateMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[1]).toHaveTextContent('Ana Cliente')
    })

    it('empresa com vários clientes mostra todos, em ordem alfabética, separados por vírgula', () => {
      useCustomersMock.mockReturnValue({
        customers: [
          customerFixture({ id: 'cust-1', name: 'Carla Cliente', company_id: 'c1' }),
          customerFixture({ id: 'cust-2', name: 'Ana Cliente', company_id: 'c1' }),
          customerFixture({ id: 'cust-3', name: 'Bruno Cliente', company_id: 'c1' }),
        ],
        isLoading: false,
        error: null,
        refetch: customersRefetchMock,
        create: customersCreateMock,
        update: customersUpdateMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[1]).toHaveTextContent('Ana Cliente, Bruno Cliente, Carla Cliente')
    })

    it('empresa sem clientes vinculados mostra "—" (não confundido com o "Nenhum cliente vinculado" do formulário)', () => {
      renderPage()

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[1]).toHaveTextContent('—')
    })

    it('cliente de OUTRA empresa não aparece na lista de contatos desta empresa', () => {
      useCustomersMock.mockReturnValue({
        customers: [customerFixture({ name: 'Cliente de Outra Empresa', company_id: 'c-outra' })],
        isLoading: false,
        error: null,
        refetch: customersRefetchMock,
        create: customersCreateMock,
        update: customersUpdateMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[1]).toHaveTextContent('—')
    })

    it('lista longa de contatos é truncada visualmente, com a lista completa em title', () => {
      useCustomersMock.mockReturnValue({
        customers: [
          customerFixture({ id: 'cust-1', name: 'Alexandre Cliente da Silva', company_id: 'c1' }),
          customerFixture({ id: 'cust-2', name: 'Beatriz Cliente de Oliveira', company_id: 'c1' }),
          customerFixture({ id: 'cust-3', name: 'Carlos Cliente Fernandes', company_id: 'c1' }),
        ],
        isLoading: false,
        error: null,
        refetch: customersRefetchMock,
        create: customersCreateMock,
        update: customersUpdateMock,
      })
      renderPage()

      const expectedFullText = 'Alexandre Cliente da Silva, Beatriz Cliente de Oliveira, Carlos Cliente Fernandes'
      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[1]).toHaveClass('truncate')
      expect(cells[1]).toHaveAttribute('title', expectedFullText)
    })

    it('carregamento dos clientes mostra "Carregando contatos…", nunca confundido com ausência de vínculo ("—")', () => {
      useCustomersMock.mockReturnValue({
        customers: [],
        isLoading: true,
        error: null,
        refetch: customersRefetchMock,
        create: customersCreateMock,
        update: customersUpdateMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[1]).toHaveTextContent('Carregando contatos…')
    })

    it('erro ao carregar clientes mostra "Contato indisponível" na coluna, mas não remove a listagem de empresas', async () => {
      useCustomersMock.mockReturnValue({
        customers: [],
        isLoading: false,
        error: new ApiError('database', 500, 'Falha ao carregar clientes.'),
        refetch: customersRefetchMock,
        create: customersCreateMock,
        update: customersUpdateMock,
      })
      const user = userEvent.setup()
      renderPage()

      // A listagem de empresas continua visível e funcional.
      expect(screen.getByText('Empresa A')).toBeInTheDocument()
      expect(screen.getByRole('table')).toBeInTheDocument()

      const row = screen.getByRole('row', { name: /empresa a/i })
      const cells = within(row).getAllByRole('cell')
      expect(cells[1]).toHaveTextContent('Contato indisponível')

      // Retry reutiliza o refetch de clientes, não altera/remove nada.
      await user.click(
        screen.getByRole('button', { name: /tentar novamente/i, hidden: false }),
      )
      expect(customersRefetchMock).toHaveBeenCalled()
      expect(customersUpdateMock).not.toHaveBeenCalled()
      expect(customersCreateMock).not.toHaveBeenCalled()
    })

    it('nunca chama create/update de clientes — a consulta é só leitura', () => {
      useCustomersMock.mockReturnValue({
        customers: [customerFixture({ name: 'Ana Cliente', company_id: 'c1' })],
        isLoading: false,
        error: null,
        refetch: customersRefetchMock,
        create: customersCreateMock,
        update: customersUpdateMock,
      })
      renderPage()

      expect(customersCreateMock).not.toHaveBeenCalled()
      expect(customersUpdateMock).not.toHaveBeenCalled()
    })
  })

  it('renomeação: não mostra mais o cabeçalho "Nome"', () => {
    renderPage()

    expect(screen.queryByRole('columnheader', { name: 'Nome' })).not.toBeInTheDocument()
  })

  describe('Busca rápida por empresa', () => {
    const alfa = { ...company, id: '10', name: 'Alfa Comércio', whatsapp: null, instagram: null }
    const betaLtda = { ...company, id: '11', name: 'Beta Distribuidora', whatsapp: null, instagram: null }
    const joaoMe = { ...company, id: '12', name: 'João ME', whatsapp: null, instagram: null }

    beforeEach(() => {
      mockCompanies([alfa, betaLtda, joaoMe])
      mockLinkedCustomers([])
    })

    it('possui rótulo acessível "Buscar empresa" e placeholder "Buscar empresa..."', () => {
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar empresa' })
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('placeholder', 'Buscar empresa...')
    })

    it('busca por nome completo encontra a empresa correspondente', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'Alfa Comércio')

      expect(within(getTable()).getByText('Alfa Comércio')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Beta Distribuidora')).not.toBeInTheDocument()
    })

    it('correspondência parcial ("alfa") encontra "Alfa Comércio"', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'alfa')

      expect(within(getTable()).getByText('Alfa Comércio')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Beta Distribuidora')).not.toBeInTheDocument()
    })

    it('busca sem diferenciar maiúsculas/minúsculas', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'BETA')

      expect(within(getTable()).getByText('Beta Distribuidora')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Alfa Comércio')).not.toBeInTheDocument()
    })

    it('busca tolerante a acentos ("joao" encontra "João ME")', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'joao')

      expect(within(getTable()).getByText('João ME')).toBeInTheDocument()
    })

    it('remove espaços extras do termo pesquisado', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), '   alfa   ')

      expect(within(getTable()).getByText('Alfa Comércio')).toBeInTheDocument()
    })

    it('termo sem resultado mostra o estado vazio específico da busca, distinto de "Nenhuma empresa cadastrada."', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'xyzxyz')

      expect(screen.getByText('Nenhuma empresa encontrada para esta busca.')).toBeInTheDocument()
      expect(screen.queryByText('Nenhuma empresa cadastrada.')).not.toBeInTheDocument()
    })

    it('não considera Contato, WhatsApp, Instagram ou Observações — só o nome da empresa', async () => {
      mockCompanies([{ ...alfa, whatsapp: '+5541999990000', notes: 'Prefere contato por WhatsApp' }, betaLtda, joaoMe])
      const user = userEvent.setup()
      renderPage()

      // "whatsapp" só bate na observação de Alfa, nunca no nome.
      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'whatsapp')

      expect(screen.getByText('Nenhuma empresa encontrada para esta busca.')).toBeInTheDocument()
    })

    it('limpar busca restaura todas as empresas', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar empresa' })
      await user.type(input, 'alfa')
      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(input).toHaveValue('')
      expect(screen.getByText('Alfa Comércio')).toBeInTheDocument()
      expect(screen.getByText('Beta Distribuidora')).toBeInTheDocument()
      expect(screen.getByText('João ME')).toBeInTheDocument()
    })

    it('nenhuma nova chamada ao hook/API enquanto o usuário digita', async () => {
      const refetchMock = vi.fn()
      mockCompanies([alfa, betaLtda, joaoMe], { refetch: refetchMock })
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'alfa')

      expect(refetchMock).not.toHaveBeenCalled()
    })
  })

  describe('Autocomplete/typeahead do campo "Buscar empresa"', () => {
    const grande = { ...company, id: '20', name: 'Empresa Grande', whatsapp: null, instagram: null }
    const pequena = { ...company, id: '21', name: 'Empresa Pequena', whatsapp: null, instagram: null }
    const outra = { ...company, id: '22', name: 'Outra Corp', whatsapp: null, instagram: null }

    beforeEach(() => {
      mockCompanies([grande, pequena, outra])
      mockLinkedCustomers([])
    })

    it('não abre a lista com o campo vazio', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('combobox', { name: 'Buscar empresa' }))

      expect(queryListbox()).not.toBeInTheDocument()
    })

    it('sugestões são atualizadas a cada caractere digitado', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar empresa' })
      await user.type(input, 'empresa')
      expect(within(getListbox()).getAllByRole('option')).toHaveLength(2)

      await user.type(input, ' g')
      expect(within(getListbox()).getAllByRole('option')).toHaveLength(1)
      expect(within(getListbox()).getByRole('option', { name: 'Empresa Grande' })).toBeInTheDocument()
    })

    it('clicar numa sugestão preenche o nome completo, filtra a tabela e fecha a lista', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'empresa')
      await user.click(within(getListbox()).getByRole('option', { name: 'Empresa Pequena' }))

      expect(screen.getByRole('combobox', { name: 'Buscar empresa' })).toHaveValue('Empresa Pequena')
      expect(queryListbox()).not.toBeInTheDocument()
      expect(within(getTable()).getByText('Empresa Pequena')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Empresa Grande')).not.toBeInTheDocument()
    })

    it('ArrowDown + Enter seleciona a primeira sugestão', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar empresa' })
      await user.type(input, 'empresa')
      await user.keyboard('{ArrowDown}{Enter}')

      expect(input).toHaveValue('Empresa Grande')
      expect(queryListbox()).not.toBeInTheDocument()
    })

    it('ArrowUp navega para a sugestão anterior', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar empresa' })
      await user.type(input, 'empresa')
      await user.keyboard('{ArrowDown}{ArrowDown}') // ativa Empresa Pequena (índice 1)
      await user.keyboard('{ArrowUp}') // volta para Empresa Grande (índice 0)
      await user.keyboard('{Enter}')

      expect(input).toHaveValue('Empresa Grande')
    })

    it('Escape fecha a lista sem apagar o texto digitado', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar empresa' })
      await user.type(input, 'empresa')
      await user.keyboard('{Escape}')

      expect(queryListbox()).not.toBeInTheDocument()
      expect(input).toHaveValue('empresa')
      expect(within(getTable()).getByText('Empresa Grande')).toBeInTheDocument()
      expect(within(getTable()).getByText('Empresa Pequena')).toBeInTheDocument()
    })

    it('clicar fora do campo/lista fecha as sugestões, sem alterar o texto nem a tabela', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar empresa' })
      await user.type(input, 'empresa')
      expect(queryListbox()).toBeInTheDocument()

      await user.click(screen.getByRole('heading', { name: 'Empresas' }))

      expect(queryListbox()).not.toBeInTheDocument()
      expect(input).toHaveValue('empresa')
    })

    it('"Limpar busca" fecha o autocomplete e restaura a tabela completa', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'empresa')
      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(queryListbox()).not.toBeInTheDocument()
      expect(within(getTable()).getByText('Outra Corp')).toBeInTheDocument()
    })

    it('voltar a editar o texto reabre as sugestões com a lista atualizada', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar empresa' })
      await user.type(input, 'empresa')
      await user.click(within(getListbox()).getByRole('option', { name: 'Empresa Grande' }))
      expect(queryListbox()).not.toBeInTheDocument()

      await user.type(input, ' extra')

      expect(queryListbox()).toBeInTheDocument()
    })

    it('nenhuma seleção automática mesmo com uma única sugestão correspondente', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar empresa' })
      await user.type(input, 'outra')

      expect(within(getListbox()).getAllByRole('option')).toHaveLength(1)
      expect(input).toHaveValue('outra')
      expect(within(getTable()).getByText('Outra Corp')).toBeInTheDocument()
    })

    it('atributos e nomes acessíveis do combobox/listbox/opções', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar empresa' })
      expect(input).toHaveAttribute('aria-autocomplete', 'list')
      expect(input).toHaveAttribute('aria-controls', 'company-search-listbox')
      expect(input).toHaveAttribute('aria-expanded', 'false')
      expect(input).not.toHaveAttribute('aria-activedescendant')

      await user.type(input, 'empresa')
      expect(input).toHaveAttribute('aria-expanded', 'true')
      expect(getListbox()).toHaveAttribute('id', 'company-search-listbox')

      await user.keyboard('{ArrowDown}')
      const activeOption = within(getListbox()).getByRole('option', { name: 'Empresa Grande' })
      expect(input).toHaveAttribute('aria-activedescendant', activeOption.id)
      expect(activeOption).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('Ordenação por coluna (menu estilo filtro de tabela)', () => {
    // Conjunto único de 4 empresas reaproveitado por todos os testes desta
    // seção — mesmo desenho de Clientes/Produtos: valores vazios (id 'co3')
    // para provar que ficam sempre no final; e um empate real de nome
    // ('ana' vs 'Ana', id 'co2' e 'co3', nessa ordem original) para provar
    // estabilidade — Intl.Collator(sensitivity:'base') trata os dois como
    // iguais.
    const rowCarlos = {
      ...company,
      id: 'co1',
      name: 'Carlos',
      whatsapp: '+5541988880001',
      instagram: '@zzz_carlos',
      notes: 'Zebra note',
      is_active: true,
    }
    const rowAnaLower = {
      ...company,
      id: 'co2',
      name: 'ana',
      whatsapp: '+5541988880002',
      instagram: '@aaa_ana',
      notes: 'Alpha note',
      is_active: false,
    }
    const rowAnaUpper = {
      ...company,
      id: 'co3',
      name: 'Ana',
      whatsapp: null,
      instagram: null,
      notes: null,
      is_active: true,
    }
    const rowBeatriz = {
      ...company,
      id: 'co4',
      name: 'Beatriz',
      whatsapp: '+5541988880003',
      instagram: '@mmm_beatriz',
      notes: 'Beta note',
      is_active: true,
    }

    beforeEach(() => {
      mockCompanies([rowCarlos, rowAnaLower, rowAnaUpper, rowBeatriz])
      // Contato(s): Carlos->Zeta Contato, ana->Alfa Contato, Ana->nenhum
      // (vazio), Beatriz->Beta Contato — mesmo padrão de "Categoria" em
      // Produtos: um valor vazio (empresa sem contato vinculado) e 3
      // valores em ordem não alfabética.
      mockLinkedCustomers([
        customerFixture({ id: 'cust-1', name: 'Zeta Contato', company_id: 'co1' }),
        customerFixture({ id: 'cust-2', name: 'Alfa Contato', company_id: 'co2' }),
        customerFixture({ id: 'cust-3', name: 'Beta Contato', company_id: 'co4' }),
      ])
    })

    it.each([
      ['Empresa', ['ana', 'Ana', 'Beatriz', 'Carlos'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Contato(s)', ['ana', 'Beatriz', 'Carlos', 'Ana'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['WhatsApp', ['Carlos', 'ana', 'Beatriz', 'Ana'], ['Beatriz', 'ana', 'Carlos', 'Ana']],
      ['Instagram', ['ana', 'Beatriz', 'Carlos', 'Ana'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Observações', ['ana', 'Beatriz', 'Carlos', 'Ana'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Ativo', ['ana', 'Carlos', 'Ana', 'Beatriz'], ['Carlos', 'Ana', 'Beatriz', 'ana']],
    ])('coluna %s: crescente e decrescente respeitam a ordem esperada (vazios sempre no final)', async (columnLabel, ascOrder, descOrder) => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, columnLabel, 'Ordenar crescente')
      expect(getVisibleCompanyNamesInOrder()).toEqual(ascOrder)

      await applySort(user, columnLabel, 'Ordenar decrescente')
      expect(getVisibleCompanyNamesInOrder()).toEqual(descOrder)
    })

    it('somente uma coluna ordenada por vez: escolher outra coluna substitui a ordenação anterior', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Empresa', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Empresa/ })).toHaveAttribute('aria-sort', 'ascending')

      await applySort(user, 'Ativo', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Ativo/ })).toHaveAttribute('aria-sort', 'ascending')
      expect(screen.getByRole('columnheader', { name: /^Empresa/ })).toHaveAttribute('aria-sort', 'none')
      expect(getVisibleCompanyNamesInOrder()).toEqual(['ana', 'Carlos', 'Ana', 'Beatriz'])
    })

    it('remover a ordenação restaura a ordem original (a ordem em que o hook devolveu os registros)', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Empresa', 'Ordenar decrescente')
      expect(getVisibleCompanyNamesInOrder()).not.toEqual(['Carlos', 'ana', 'Ana', 'Beatriz'])

      await applySort(user, 'Empresa', 'Remover ordenação')

      expect(getVisibleCompanyNamesInOrder()).toEqual(['Carlos', 'ana', 'Ana', 'Beatriz'])
      expect(screen.getByRole('columnheader', { name: /^Empresa/ })).toHaveAttribute('aria-sort', 'none')
    })

    it('aria-sort correto: none por padrão, ascending/descending após ordenar', async () => {
      const user = userEvent.setup()
      renderPage()

      expect(screen.getByRole('columnheader', { name: /^Empresa/ })).toHaveAttribute('aria-sort', 'none')

      await applySort(user, 'Empresa', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Empresa/ })).toHaveAttribute('aria-sort', 'ascending')

      await applySort(user, 'Empresa', 'Ordenar decrescente')
      expect(screen.getByRole('columnheader', { name: /^Empresa/ })).toHaveAttribute('aria-sort', 'descending')
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

      for (const label of ['Empresa', 'Contato(s)', 'WhatsApp', 'Instagram', 'Observações', 'Ativo']) {
        expect(screen.getByRole('button', { name: `Ordenar coluna ${label}` })).toBeInTheDocument()
      }
    })
  })

  describe('Combinação entre busca e ordenação', () => {
    const carlos = { ...company, id: 'co1', name: 'Carlos', whatsapp: null, instagram: null }
    const alice = { ...company, id: 'co2', name: 'Alice', whatsapp: null, instagram: null }
    const amanda = { ...company, id: 'co3', name: 'Amanda', whatsapp: null, instagram: null }

    beforeEach(() => {
      mockCompanies([carlos, alice, amanda])
      mockLinkedCustomers([])
    })

    it('primeiro filtra pelo nome, depois ordena o resultado filtrado', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'a')
      expect(getVisibleCompanyNamesInOrder()).toHaveLength(3)

      await applySort(user, 'Empresa', 'Ordenar crescente')
      expect(getVisibleCompanyNamesInOrder()).toEqual(['Alice', 'Amanda', 'Carlos'])

      await user.clear(screen.getByRole('combobox', { name: 'Buscar empresa' }))
      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'am')
      expect(getVisibleCompanyNamesInOrder()).toEqual(['Amanda'])
    })

    it('limpar a busca mantém a ordenação ativa', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Empresa', 'Ordenar decrescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'a')
      expect(getVisibleCompanyNamesInOrder()).toEqual(['Carlos', 'Amanda', 'Alice'])

      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(getVisibleCompanyNamesInOrder()).toEqual(['Carlos', 'Amanda', 'Alice'])
      expect(screen.getByRole('columnheader', { name: /^Empresa/ })).toHaveAttribute('aria-sort', 'descending')
    })

    it('remover a ordenação mantém a busca ativa', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Empresa', 'Ordenar crescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'am')
      expect(getVisibleCompanyNamesInOrder()).toEqual(['Amanda'])

      await applySort(user, 'Empresa', 'Remover ordenação')

      expect(screen.getByRole('combobox', { name: 'Buscar empresa' })).toHaveValue('am')
      expect(getVisibleCompanyNamesInOrder()).toEqual(['Amanda'])
    })

    it('autocomplete respeita a ordenação ativa e preserva a ordenação ao selecionar uma sugestão', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Empresa', 'Ordenar decrescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar empresa' }), 'a')

      const options = within(getListbox()).getAllByRole('option')
      expect(options.map((option) => option.textContent)).toEqual(['Carlos', 'Amanda', 'Alice'])

      await user.click(options[0])

      expect(screen.getByRole('columnheader', { name: /^Empresa/ })).toHaveAttribute('aria-sort', 'descending')
    })

    it('zebra striping é recalculado conforme a ordem visual resultante da busca + ordenação', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Empresa', 'Ordenar crescente')

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
