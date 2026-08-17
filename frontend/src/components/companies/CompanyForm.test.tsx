import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompanyForm } from './CompanyForm'

function renderForm() {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(<CompanyForm isSubmitting={false} submitError={null} onSubmit={onSubmit} onCancel={onCancel} />)
  return { onSubmit, onCancel }
}

describe('CompanyForm', () => {
  it('renders the expected fields and no "ativo" control', () => {
    renderForm()

    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/nome fantasia/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/documento/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/whatsapp/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/instagram/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/observações/i)).toBeInTheDocument()
    expect(screen.queryByText(/ativo/i)).not.toBeInTheDocument()
  })

  it('shows a validation error and does not submit when name is empty', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(await screen.findByText(/informe o nome da empresa/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed values, turning blank optional fields into null', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^nome$/i), '  Empresa Teste  ')
    await user.type(screen.getByLabelText(/nome fantasia/i), '  Fantasia  ')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Empresa Teste',
      trade_name: 'Fantasia',
      document_number: null,
      whatsapp: null,
      instagram: null,
      notes: null,
    })
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(onCancel).toHaveBeenCalled()
  })
})
