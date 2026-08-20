import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductForm } from './ProductForm'

function renderForm() {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(<ProductForm isSubmitting={false} submitError={null} onSubmit={onSubmit} onCancel={onCancel} />)
  return { onSubmit, onCancel }
}

describe('ProductForm', () => {
  it('renders the expected fields', () => {
    renderForm()

    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/categoria/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/descrição/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^preço$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/tempo de impressão/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/peso/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/unidades por placa/i)).toBeInTheDocument()
  })

  it('shows a validation error and does not submit when name is empty', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^preço$/i), '10')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(await screen.findByText(/informe o nome do produto/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('preço aceita vírgula como separador decimal ("10,50" -> 10.5), mesmo parser de ProductPriceForm', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
    await user.type(screen.getByLabelText(/^preço$/i), '10,50')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chaveiro', default_price: 10.5 }))
  })

  it('preço com ponto continua funcionando (regressão)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
    await user.type(screen.getByLabelText(/^preço$/i), '10.50')
    await user.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ default_price: 10.5 }))
  })

  it('preço vazio ou negativo não envia e mostra erro', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(screen.getByLabelText(/^nome$/i), 'Chaveiro')
    await user.click(screen.getByRole('button', { name: /salvar/i }))
    expect(await screen.findByText(/informe o preço/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/^preço$/i), '-5')
    await user.click(screen.getByRole('button', { name: /salvar/i }))
    expect(await screen.findByText('O preço deve ser maior ou igual a 0.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(onCancel).toHaveBeenCalled()
  })
})
