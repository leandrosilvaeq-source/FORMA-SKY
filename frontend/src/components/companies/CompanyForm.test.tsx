import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompanyForm, type ContactsStatus } from './CompanyForm'

function renderForm(overrides: Partial<Parameters<typeof CompanyForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <CompanyForm
      contactsStatus="ready"
      contactNames={[]}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onCancel }
}

describe('CompanyForm', () => {
  it('renders only Nome, WhatsApp, Instagram e Observações como campos editáveis — sem "ativo", "nome fantasia" ou "documento"', () => {
    renderForm()

    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/whatsapp/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/instagram/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/observações/i)).toBeInTheDocument()

    expect(screen.queryByText(/ativo/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/nome fantasia/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/nome fantasia/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/documento/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/documento/i)).not.toBeInTheDocument()
  })

  it('shows a validation error and does not submit when name is empty', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(await screen.findByText(/informe o nome da empresa/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed name/notes and normalized WhatsApp/Instagram, and never includes trade_name nem document_number', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^nome$/i), '  Empresa Teste  ')
    await user.type(screen.getByLabelText(/whatsapp/i), '11999990000')
    await user.type(screen.getByLabelText(/instagram/i), '  @empresa  ')
    await user.type(screen.getByLabelText(/observações/i), '  Observação de teste  ')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Empresa Teste',
      whatsapp: '+5511999990000',
      instagram: '@empresa',
      notes: 'Observação de teste',
    })
    const submittedValues = onSubmit.mock.calls[0][0]
    expect(submittedValues).not.toHaveProperty('trade_name')
    expect(submittedValues).not.toHaveProperty('document_number')
  })

  it('campos em branco viram null no payload (nunca string vazia)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Empresa Teste',
      whatsapp: null,
      instagram: null,
      notes: null,
    })
  })

  it('editar uma empresa com nome fantasia e documento já cadastrados: nenhum dos dois aparece no formulário, e salvar não inclui essas propriedades no payload (preserva os valores existentes no banco)', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <CompanyForm
        initialValues={{
          id: 'c1',
          name: 'Empresa A',
          trade_name: 'Fantasia A',
          document_number: '12345678000199',
          whatsapp: null,
          instagram: null,
          notes: 'Nota antiga',
          is_active: true,
          created_at: '',
          updated_at: '',
        }}
        contactsStatus="ready"
        contactNames={[]}
        isSubmitting={false}
        submitError={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText(/nome fantasia/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Fantasia A')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/documento/i)).not.toBeInTheDocument()
    expect(screen.queryByText('12345678000199')).not.toBeInTheDocument()

    // Edita só um campo visível (WhatsApp) e salva — Nome/Observações
    // continuam pré-preenchidos do initialValues, sem o usuário precisar
    // redigitar.
    await user.type(screen.getByLabelText(/whatsapp/i), '11988887777')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    const submittedValues = onSubmit.mock.calls[0][0]
    expect(submittedValues).not.toHaveProperty('trade_name')
    expect(submittedValues).not.toHaveProperty('document_number')
    expect(submittedValues).toEqual({
      name: 'Empresa A',
      whatsapp: '+5511988887777',
      instagram: null,
      notes: 'Nota antiga',
    })
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  describe('"Contato(s)" — informação somente leitura', () => {
    it('Nova empresa mostra o rótulo "Contato(s)" e "Nenhum cliente vinculado"', () => {
      renderForm({ contactsStatus: 'ready', contactNames: [] })

      expect(screen.getByText('Contato(s)')).toBeInTheDocument()
      expect(screen.getByText('Nenhum cliente vinculado')).toBeInTheDocument()
      expect(screen.getByText('Os vínculos são administrados no módulo Clientes.')).toBeInTheDocument()
    })

    it('editar empresa com um cliente vinculado mostra o nome dele', () => {
      renderForm({ contactsStatus: 'ready', contactNames: ['Ana Cliente'] })

      expect(screen.getByText('Ana Cliente')).toBeInTheDocument()
    })

    it('editar empresa com vários clientes mostra todos, separados por vírgula, na ordem recebida (já alfabética a cargo do chamador)', () => {
      renderForm({ contactsStatus: 'ready', contactNames: ['Ana Cliente', 'Bruno Cliente', 'Carla Cliente'] })

      expect(screen.getByText('Ana Cliente, Bruno Cliente, Carla Cliente')).toBeInTheDocument()
    })

    it('empresa sem clientes vinculados mostra "Nenhum cliente vinculado"', () => {
      renderForm({ contactsStatus: 'ready', contactNames: [] })

      expect(screen.getByText('Nenhum cliente vinculado')).toBeInTheDocument()
    })

    it('estado de carregamento mostra "Carregando contatos…", nunca confundido com ausência de vínculo', () => {
      renderForm({ contactsStatus: 'loading', contactNames: [] })

      expect(screen.getByText('Carregando contatos…')).toBeInTheDocument()
      expect(screen.queryByText('Nenhum cliente vinculado')).not.toBeInTheDocument()
    })

    it('estado de erro mostra "Contato indisponível", nunca confundido com ausência de vínculo', () => {
      renderForm({ contactsStatus: 'error', contactNames: [] })

      expect(screen.getByText('Contato indisponível')).toBeInTheDocument()
      expect(screen.queryByText('Nenhum cliente vinculado')).not.toBeInTheDocument()
    })

    it('"Contato(s)" não é editável: não há input/textarea associado, e não aparece no payload de submit', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm({ contactsStatus: 'ready', contactNames: ['Ana Cliente'] })

      expect(screen.queryByLabelText(/contato/i)).not.toBeInTheDocument()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      const submittedValues = onSubmit.mock.calls[0][0]
      expect(submittedValues).not.toHaveProperty('contacts')
      expect(submittedValues).not.toHaveProperty('contactNames')
      expect(submittedValues).not.toHaveProperty('customers')
    })
  })

  it('tipo ContactsStatus aceita exatamente loading | error | ready', () => {
    const statuses: ContactsStatus[] = ['loading', 'error', 'ready']
    expect(statuses).toHaveLength(3)
  })

  describe('WhatsApp e Instagram — mesma normalização/validação já aprovada em Clientes', () => {
    it('WhatsApp com formatação (parênteses/espaço/hífen) é normalizado para E.164 no payload', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.type(screen.getByLabelText(/whatsapp/i), '(41) 99999-9999')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ whatsapp: '+5541999999999' }))
    })

    it('link wa.me é aceito e normalizado (mesma regra de Clientes)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.type(screen.getByLabelText(/whatsapp/i), 'https://wa.me/5541999999999')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ whatsapp: '+5541999999999' }))
    })

    it('WhatsApp que não forma um número válido ainda assim não bloqueia o envio (mesmo comportamento de Clientes)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.type(screen.getByLabelText(/whatsapp/i), 'abc')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ whatsapp: 'abc' }))
      expect(screen.queryByText(/informe um whatsapp válido/i)).not.toBeInTheDocument()

      const whatsappInput = screen.getByLabelText(/whatsapp/i)
      expect(whatsappInput).not.toHaveAttribute('aria-invalid')
      expect(whatsappInput).not.toHaveAttribute('aria-describedby')
    })

    it('WhatsApp vazio envia null, sem erro', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ whatsapp: null }))
      expect(screen.queryByText(/informe um whatsapp válido/i)).not.toBeInTheDocument()
    })

    it('corrigir um WhatsApp não reconhecido antes de reenviar passa a normalizar para E.164', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.type(screen.getByLabelText(/whatsapp/i), 'abc')

      await user.clear(screen.getByLabelText(/whatsapp/i))
      await user.type(screen.getByLabelText(/whatsapp/i), '11999990000')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ whatsapp: '+5511999990000' }))
    })

    it('Instagram com usuário simples (sem @) é normalizado no payload', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.type(screen.getByLabelText(/instagram/i), 'empresa_oficial')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ instagram: '@empresa_oficial' }))
    })

    it('Instagram já com @usuario é preservado no payload', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.type(screen.getByLabelText(/instagram/i), '@empresa_oficial')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ instagram: '@empresa_oficial' }))
    })

    it('Instagram como URL do perfil é normalizado para @usuario no payload', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.type(screen.getByLabelText(/instagram/i), 'https://instagram.com/empresa_oficial/')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ instagram: '@empresa_oficial' }))
    })

    it('Instagram vazio envia null, sem bloquear o envio (nenhum caso de erro tratado, igual a Clientes)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ instagram: null }))
    })

    it('Instagram com texto que não forma um handle reconhecível ainda assim não bloqueia o envio (mesmo comportamento de Clientes)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()

      await user.type(screen.getByLabelText(/^nome$/i), 'Empresa Teste')
      await user.type(screen.getByLabelText(/instagram/i), 'john doe')
      await user.click(screen.getByRole('button', { name: /salvar/i }))

      expect(onSubmit).toHaveBeenCalled()
    })
  })

  describe('botões com a paleta Forma', () => {
    it('Salvar usa bg-brand-primary/hover:bg-brand-primary-dark e preserva o estado desabilitado', () => {
      renderForm({ isSubmitting: true })

      const saveButton = screen.getByRole('button', { name: /salvando/i })
      expect(saveButton).toHaveClass('bg-brand-primary')
      expect(saveButton).toHaveClass('hover:bg-brand-primary-dark')
      expect(saveButton).toBeDisabled()
    })

    it('Cancelar usa borda/texto brand-primary e hover brand-primary-soft, preservando o comportamento de cancelar', async () => {
      const user = userEvent.setup()
      const { onCancel } = renderForm()

      const cancelButton = screen.getByRole('button', { name: /cancelar/i })
      expect(cancelButton).toHaveClass('border-brand-primary')
      expect(cancelButton).toHaveClass('text-brand-primary')
      expect(cancelButton).toHaveClass('hover:bg-brand-primary-soft')

      await user.click(cancelButton)
      expect(onCancel).toHaveBeenCalled()
    })

    it('Cancelar fica desabilitado durante isSubmitting, sem alterar o botão de fechar do diálogo (não renderizado por este componente)', () => {
      renderForm({ isSubmitting: true })

      expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled()
    })
  })
})
