import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { formatCentsToBRL, MAX_CENTS } from '@/lib/forms/currencyField'
import { ProductPriceForm } from './ProductPriceForm'

// getByText normaliza espaços (inclusive NBSP) do texto renderizado, mas não
// normaliza uma string de busca literal — por isso usamos regex com \s aqui.
const MAX_MESSAGE = /O novo preço não pode ultrapassar R\$\s*99\.999\.999,99\./

function renderForm(overrides: Partial<Parameters<typeof ProductPriceForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <ProductPriceForm
      currentPrice={10}
      isSubmitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onCancel }
}

function getPriceInput() {
  return screen.getByLabelText(/novo preço/i) as HTMLInputElement
}

describe('ProductPriceForm — campo de preço bancário', () => {
  it('1. valor inicial é R$ 0,00', () => {
    renderForm()

    expect(getPriceInput()).toHaveValue(formatCentsToBRL(0))
  })

  it('2. campo não editado continua obrigatório: Salvar sem digitar mostra erro e não envia', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(await screen.findByText('Informe o novo preço.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('3. digitar 1 mostra R$ 0,01', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(getPriceInput(), '1')

    expect(getPriceInput()).toHaveValue(formatCentsToBRL(1))
  })

  it('4. digitar a sequência 1250 mostra R$ 12,50', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(getPriceInput(), '1250')

    expect(getPriceInput()).toHaveValue(formatCentsToBRL(1250))
  })

  it('5. Backspace remove o último dígito: 12,50 -> 1,25 -> 0,12 -> 0,01 -> 0,00', async () => {
    const user = userEvent.setup()
    renderForm()
    const input = getPriceInput()

    await user.type(input, '1250')
    expect(input).toHaveValue(formatCentsToBRL(1250))

    await user.type(input, '{Backspace}')
    expect(input).toHaveValue(formatCentsToBRL(125))

    await user.type(input, '{Backspace}')
    expect(input).toHaveValue(formatCentsToBRL(12))

    await user.type(input, '{Backspace}')
    expect(input).toHaveValue(formatCentsToBRL(1))

    await user.type(input, '{Backspace}')
    expect(input).toHaveValue(formatCentsToBRL(0))
  })

  it('6. digitar 0 explicitamente e enviar resulta em new_price: 0', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(getPriceInput(), '0')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({ new_price: 0, reason: null })
  })

  it('7. digitar 1250 e enviar resulta em new_price: 12.5', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(getPriceInput(), '1250')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({ new_price: 12.5, reason: null })
  })

  it('8. colar "12,50" resulta em R$ 12,50', async () => {
    const user = userEvent.setup()
    renderForm()
    const input = getPriceInput()

    await user.click(input)
    await user.paste('12,50')

    expect(input).toHaveValue(formatCentsToBRL(1250))
  })

  it('9. colar "R$ 12,50" resulta em R$ 12,50', async () => {
    const user = userEvent.setup()
    renderForm()
    const input = getPriceInput()

    await user.click(input)
    await user.paste('R$ 12,50')

    expect(input).toHaveValue(formatCentsToBRL(1250))
  })

  it('10. colar "1250" (sem separador) segue o comportamento bancário: R$ 12,50', async () => {
    const user = userEvent.setup()
    renderForm()
    const input = getPriceInput()

    await user.click(input)
    await user.paste('1250')

    expect(input).toHaveValue(formatCentsToBRL(1250))
  })

  it('11. selecionar tudo e digitar substitui o valor anterior', async () => {
    const user = userEvent.setup()
    renderForm()
    const input = getPriceInput()

    await user.type(input, '1250')
    expect(input).toHaveValue(formatCentsToBRL(1250))

    await user.type(input, '9', { initialSelectionStart: 0, initialSelectionEnd: input.value.length })

    expect(input).toHaveValue(formatCentsToBRL(9))
  })

  it('12. aceita o limite máximo permitido (R$ 99.999.999,99) e envia corretamente', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    const input = getPriceInput()

    await user.type(input, '9999999999')
    expect(input).toHaveValue(formatCentsToBRL(MAX_CENTS))

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({ new_price: 99999999.99, reason: null })
  })

  it('13. tentar ultrapassar o limite máximo mostra erro claro e não altera o valor', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()
    const input = getPriceInput()

    await user.type(input, '9999999999')
    await user.type(input, '9')

    expect(await screen.findByText(MAX_MESSAGE)).toBeInTheDocument()
    expect(input).toHaveValue(formatCentsToBRL(MAX_CENTS))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('14. motivo é opcional: envia reason null quando não preenchido', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(getPriceInput(), '20')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({ new_price: 0.2, reason: null })
  })

  it('motivo preenchido é enviado aparado (trim)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.type(getPriceInput(), '2000')
    await user.type(screen.getByLabelText(/motivo/i), '  Promoção  ')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(onSubmit).toHaveBeenCalledWith({ new_price: 20, reason: 'Promoção' })
  })

  it('15. exibe o submitError vindo do pai', () => {
    renderForm({ submitError: 'Falha ao atualizar o preço.' })

    expect(screen.getByText('Falha ao atualizar o preço.')).toBeInTheDocument()
  })

  it('16. acessibilidade: nomes acessíveis e aria-invalid/aria-describedby associados ao erro', async () => {
    const user = userEvent.setup()
    renderForm()
    const input = getPriceInput()

    expect(input).toBeInTheDocument()
    expect(screen.getByLabelText(/motivo \(opcional\)/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^salvar$/i })).toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-invalid')

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'product-new-price-error')
    expect(screen.getByText('Informe o novo preço.')).toHaveAttribute('id', 'product-new-price-error')
  })

  it('17. desabilita Cancelar e Salvar durante a submissão, mostrando "Salvando..."', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({ isSubmitting: true })

    expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled()
    const saveButton = screen.getByRole('button', { name: /salvando/i })
    expect(saveButton).toBeDisabled()

    await user.click(saveButton)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('18. chama onCancel ao clicar em Cancelar', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('mostra o preço atual (prop currentPrice) formatado em Real brasileiro', () => {
    renderForm({ currentPrice: 1234.5 })

    expect(screen.getByText(/R\$\s*1\.234,50/)).toBeInTheDocument()
  })

  it('erro de valor vazio some assim que o usuário volta a digitar', async () => {
    const user = userEvent.setup()
    renderForm()
    const input = getPriceInput()

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))
    expect(await screen.findByText('Informe o novo preço.')).toBeInTheDocument()

    await user.type(input, '5')

    expect(screen.queryByText('Informe o novo preço.')).not.toBeInTheDocument()
  })

  // Teclado virtual (mobile) não dispara onKeyDown de forma confiável — o
  // navegador já aplica a edição e só o evento onChange chega. Estes testes
  // usam fireEvent.change diretamente (sem keydown) para simular esse caso.
  describe('fallback de onChange para teclado virtual (mobile, sem keydown)', () => {
    it('1. alteração mobile para valor bruto "R$ 0,001" resulta em R$ 0,01', () => {
      renderForm()
      const input = getPriceInput()

      fireEvent.change(input, { target: { value: 'R$ 0,001' } })

      expect(input).toHaveValue(formatCentsToBRL(1))
    })

    it('2. sequência mobile (edições sucessivas do valor bruto) resulta em R$ 12,50', () => {
      renderForm()
      const input = getPriceInput()

      fireEvent.change(input, { target: { value: 'R$ 0,001' } })
      expect(input).toHaveValue(formatCentsToBRL(1))

      fireEvent.change(input, { target: { value: 'R$ 0,012' } })
      expect(input).toHaveValue(formatCentsToBRL(12))

      fireEvent.change(input, { target: { value: 'R$ 0,125' } })
      expect(input).toHaveValue(formatCentsToBRL(125))

      fireEvent.change(input, { target: { value: 'R$ 1,250' } })
      expect(input).toHaveValue(formatCentsToBRL(1250))
    })

    it('3. exclusão mobile do último dígito funciona (R$ 1,25 -> apagar -> R$ 1,2 bruto -> R$ 0,12)', () => {
      renderForm()
      const input = getPriceInput()

      fireEvent.change(input, { target: { value: 'R$ 1,250' } })
      expect(input).toHaveValue(formatCentsToBRL(1250))

      fireEvent.change(input, { target: { value: 'R$ 1,2' } })

      expect(input).toHaveValue(formatCentsToBRL(12))
    })

    it('4. selecionar/substituir por alteração direta funciona (valor bruto totalmente novo)', () => {
      renderForm()
      const input = getPriceInput()

      fireEvent.change(input, { target: { value: 'R$ 12,50' } })
      expect(input).toHaveValue(formatCentsToBRL(1250))

      // Seleção total substituída por "9" no teclado virtual: o navegador já
      // entrega o valor bruto resultante como só "9", sem o restante.
      fireEvent.change(input, { target: { value: '9' } })

      expect(input).toHaveValue(formatCentsToBRL(9))
    })

    it('5. valor acima de MAX_CENTS via onChange é rejeitado, preservando o último valor válido', () => {
      renderForm()
      const input = getPriceInput()

      fireEvent.change(input, { target: { value: 'R$ 1,250' } })
      expect(input).toHaveValue(formatCentsToBRL(1250))

      fireEvent.change(input, { target: { value: 'R$ 999.999.999,99' } })

      expect(screen.getByText(MAX_MESSAGE)).toBeInTheDocument()
      expect(input).toHaveValue(formatCentsToBRL(1250))
    })

    it('cursor fica no final do valor após a edição (useRef controlando o input local)', () => {
      renderForm()
      const input = getPriceInput()

      fireEvent.change(input, { target: { value: 'R$ 1,250' } })

      const end = input.value.length
      expect(input.selectionStart).toBe(end)
      expect(input.selectionEnd).toBe(end)
    })

    it('6. entrada mobile marca hasEdited e permite o submit (inclusive com valor 0)', async () => {
      const user = userEvent.setup()
      const { onSubmit } = renderForm()
      const input = getPriceInput()

      fireEvent.change(input, { target: { value: 'R$ 0,00' } })
      await user.click(screen.getByRole('button', { name: /^salvar$/i }))

      expect(onSubmit).toHaveBeenCalledWith({ new_price: 0, reason: null })
    })
  })
})
