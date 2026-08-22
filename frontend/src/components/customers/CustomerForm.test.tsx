import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomerForm } from './CustomerForm'
import type { Company, Customer, LeadSource } from '@/types/domain'

const companies: Company[] = [
  {
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
  },
]

// Propositalmente fora da ordem aprovada, para confirmar que a ordenação é
// feita no frontend — mesmo padrão de OrderForm.test.tsx.
const leadSources: LeadSource[] = [
  { id: 'l2', name: 'WhatsApp', is_active: true },
  { id: 'l1', name: 'Instagram', is_active: true },
]
const inactiveLeadSource: LeadSource = { id: 'l3', name: 'Origem Inativa', is_active: false }

// Fixture de edição — usada só pelos testes de "Como nos conheceu:" em modo
// edição (initialValues), com acquisition_source_id sobrescrito por teste.
const editCustomer: Customer = {
  id: 'cust-1',
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

function renderForm(overrides: Partial<Parameters<typeof CustomerForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <CustomerForm
      companies={companies}
      leadSources={leadSources}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onCancel }
}

async function fillNameAndSubmit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/^nome$/i), 'Ana')
  await user.click(screen.getByRole('button', { name: /salvar/i }))
}

describe('CustomerForm', () => {
  it('renders the expected fields and no "ativo" control', () => {
    renderForm()

    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /whatsapp/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /instagram/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/empresa/i)).toBeInTheDocument()
    expect(screen.getByText('Como nos conheceu:')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Como nos conheceu' })).toBeInTheDocument()
    expect(screen.getByLabelText(/observações/i)).toBeInTheDocument()
    expect(screen.queryByText(/ativo/i)).not.toBeInTheDocument()
  })

  it('não exibe mais os rótulos antigos do campo de origem ("Origem", "Nos conheceu pelo:")', () => {
    renderForm()

    expect(screen.queryByText('Origem', { selector: 'label' })).not.toBeInTheDocument()
    expect(screen.queryByText('Nos conheceu pelo:')).not.toBeInTheDocument()
  })

  it('shows a validation error and does not submit when name is empty', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(await screen.findByText(/informe o nome do cliente/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the trimmed values without an is_active field', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^nome$/i), '  Ana  ')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Ana',
      whatsapp: null,
      instagram: null,
      company_id: null,
      acquisition_source_id: null,
      notes: null,
    })
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  describe('Como nos conheceu: (mesmo padrão visual de action buttons de "Entrou em contato por" em Pedidos)', () => {
    it('mostra as origens ativas como action buttons (ícone em cima, nome embaixo), na ordem aprovada, excluindo a inativa', () => {
      renderForm({ leadSources: [...leadSources, inactiveLeadSource] })

      const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
      const options = within(group).getAllByRole('radio')
      expect(options.map((option) => option.textContent)).toEqual(['Instagram', 'WhatsApp'])
      expect(within(group).queryByRole('radio', { name: 'Origem Inativa' })).not.toBeInTheDocument()
    })

    it('cada botão tem ícone (svg oculto para leitor de tela) e nome acessível pelo nome real da origem', () => {
      renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
      const instagramOption = within(group).getByRole('radio', { name: 'Como nos conheceu: Instagram' })
      const whatsappOption = within(group).getByRole('radio', { name: 'Como nos conheceu: WhatsApp' })
      expect(instagramOption.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
      expect(whatsappOption.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    })

    it('seleção exclusiva: escolher uma origem desmarca a anterior, e o botão selecionado é destacado com a paleta Forma', async () => {
      const user = userEvent.setup()
      renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
      const instagramOption = within(group).getByRole('radio', { name: 'Como nos conheceu: Instagram' })
      const whatsappOption = within(group).getByRole('radio', { name: 'Como nos conheceu: WhatsApp' })

      await user.click(instagramOption)
      expect(instagramOption).toHaveAttribute('aria-checked', 'true')
      expect(instagramOption.className).toContain('border-brand-primary')

      await user.click(whatsappOption)
      expect(whatsappOption).toHaveAttribute('aria-checked', 'true')
      expect(instagramOption).toHaveAttribute('aria-checked', 'false')
      expect(instagramOption.className).not.toContain('border-brand-primary')
    })

    it('é navegável e alternável por teclado (foco visível via outline-none + focus-visible:ring)', async () => {
      const user = userEvent.setup()
      renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
      const instagramOption = within(group).getByRole('radio', { name: 'Como nos conheceu: Instagram' })
      instagramOption.focus()
      expect(instagramOption).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(instagramOption).toHaveAttribute('aria-checked', 'true')
    })

    it('selecionar uma origem muda aria-checked e envia acquisition_source_id no payload (criação)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
      const instagramOption = within(group).getByRole('radio', { name: 'Como nos conheceu: Instagram' })
      expect(instagramOption).toHaveAttribute('aria-checked', 'false')

      await user.click(instagramOption)
      expect(instagramOption).toHaveAttribute('aria-checked', 'true')

      await fillNameAndSubmit(user)

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ acquisition_source_id: 'l1' }))
    })

    it('criação: nenhuma origem selecionada preserva o comportamento atual: acquisition_source_id null no payload (opcional, nada inventado)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
      expect(within(group).getAllByRole('radio').every((option) => option.getAttribute('aria-checked') === 'false')).toBe(
        true,
      )

      await fillNameAndSubmit(user)

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ acquisition_source_id: null }))
    })

    it('edição: abre com a origem já cadastrada selecionada', () => {
      renderForm({ initialValues: { ...editCustomer, acquisition_source_id: 'l1' } })

      const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
      expect(within(group).getByRole('radio', { name: 'Como nos conheceu: Instagram' })).toHaveAttribute('aria-checked', 'true')
      expect(within(group).getByRole('radio', { name: 'Como nos conheceu: WhatsApp' })).toHaveAttribute('aria-checked', 'false')
    })

    it('edição: salvar sem alterar a origem preserva o acquisition_source_id existente', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({ initialValues: { ...editCustomer, acquisition_source_id: 'l1' } })

      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ acquisition_source_id: 'l1' }))
    })

    it('edição: trocar a origem envia o novo acquisition_source_id', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({ initialValues: { ...editCustomer, acquisition_source_id: 'l1' } })

      const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
      await user.click(within(group).getByRole('radio', { name: 'Como nos conheceu: WhatsApp' }))
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ acquisition_source_id: 'l2' }))
    })

    it('edição: origem nula no cliente existente abre sem nenhuma opção selecionada e continua sendo aceita ao salvar', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({ initialValues: { ...editCustomer, acquisition_source_id: null } })

      const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
      expect(within(group).getAllByRole('radio').every((option) => option.getAttribute('aria-checked') === 'false')).toBe(
        true,
      )

      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ acquisition_source_id: null }))
    })

    it('estrutura responsiva: flex-wrap permite quebra de linha sem overflow horizontal quando as opções não cabem em uma linha', () => {
      renderForm()

      const group = screen.getByRole('radiogroup', { name: 'Como nos conheceu' })
      expect(group.className).toContain('flex-wrap')
    })
  })

  describe('Instagram — preenchimento inteligente no submit', () => {
    it.each([
      ['@usuario', '@usuario'],
      ['usuario', '@usuario'],
      ['https://www.instagram.com/usuario/', '@usuario'],
      ['https://instagram.com/usuario?igsh=abc', '@usuario'],
      ['   usuario   ', '@usuario'],
    ])('entrada "%s" é normalizada para "%s" no payload', async (input, expected) => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Ana')
      await user.type(screen.getByRole('textbox', { name: /instagram/i }), input)
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ instagram: expected }))
    })

    it('campo vazio continua sendo enviado como null (comportamento atual preservado)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndSubmit(user)

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ instagram: null }))
    })

    it('mostra a ação de abrir o perfil só quando há um valor normalizado válido', async () => {
      const user = userEvent.setup()
      renderForm()

      expect(screen.queryByRole('link', { name: /abrir perfil/i })).not.toBeInTheDocument()

      await user.type(screen.getByRole('textbox', { name: /instagram/i }), 'usuario')

      const link = screen.getByRole('link', { name: /abrir perfil @usuario/i })
      expect(link).toHaveAttribute('href', 'https://instagram.com/usuario')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  describe('WhatsApp — preenchimento inteligente no submit', () => {
    it.each([
      ['41999999999', '+5541999999999'],
      ['(41) 99999-9999', '+5541999999999'],
      ['+55 41 99999-9999', '+5541999999999'],
      ['5541999999999', '+5541999999999'],
      ['https://wa.me/5541999999999', '+5541999999999'],
      ['wa.me/5541999999999', '+5541999999999'],
    ])('entrada "%s" é normalizada para "%s" no payload', async (input, expected) => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Ana')
      await user.type(screen.getByRole('textbox', { name: /whatsapp/i }), input)
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ whatsapp: expected }))
    })

    it('campo vazio continua sendo enviado como null (comportamento atual preservado)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await fillNameAndSubmit(user)

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ whatsapp: null }))
    })

    it('mostra a ação de abrir conversa só quando há um valor normalizado válido em E.164', async () => {
      const user = userEvent.setup()
      renderForm()

      expect(screen.queryByRole('link', { name: /abrir conversa/i })).not.toBeInTheDocument()

      await user.type(screen.getByRole('textbox', { name: /whatsapp/i }), '41999999999')

      const link = screen.getByRole('link', { name: /abrir conversa no whatsapp com \+5541999999999/i })
      expect(link).toHaveAttribute('href', 'https://wa.me/5541999999999')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('não mostra a ação de abrir conversa para uma entrada incompleta', async () => {
      const user = userEvent.setup()
      renderForm()

      await user.type(screen.getByRole('textbox', { name: /whatsapp/i }), '123')

      expect(screen.queryByRole('link', { name: /abrir conversa/i })).not.toBeInTheDocument()
    })
  })
})
