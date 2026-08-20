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
    expect(screen.getByRole('columnheader', { name: 'Nome' })).toBeInTheDocument()
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

  it('ordem das colunas: Nome, Contato(s), WhatsApp, Instagram, Observações, Ativo, Ações', () => {
    renderPage()

    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual([
      'Nome',
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
    expect(screen.getByLabelText(/whatsapp/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/instagram/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/observações/i)).toBeInTheDocument()
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
      expect(headers[0]).toBe('Nome')
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
})
