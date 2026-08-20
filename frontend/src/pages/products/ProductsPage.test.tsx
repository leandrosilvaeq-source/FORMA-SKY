import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'

const { useProductsMock, useAccessoriesMock, usePackagingMock, useProductCompositionMock, toastMock, useAuthMock } =
  vi.hoisted(() => ({
    useProductsMock: vi.fn(),
    useAccessoriesMock: vi.fn(),
    usePackagingMock: vi.fn(),
    useProductCompositionMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
    useAuthMock: vi.fn(),
  }))

vi.mock('@/hooks/useProducts', () => ({ useProducts: useProductsMock }))
vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
vi.mock('@/hooks/useProductComposition', () => ({ useProductComposition: useProductCompositionMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { ProductsPage } from './ProductsPage'

const product = {
  id: '1',
  name: 'Chaveiro',
  category: 'Decoração',
  description: null,
  default_price: 10,
  default_print_time_minutes: null,
  default_weight_grams: null,
  units_per_plate: null,
  default_file_id: null,
  allows_personalization: false,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const accessory = {
  id: 'a1',
  name: 'Ímã 6x2',
  material: null,
  size: null,
  variant: null,
  unit_cost: null,
  minimum_stock: null,
  current_stock: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const packagingItem = {
  id: 'k1',
  name: 'Caixa M',
  material: null,
  size: null,
  variant: null,
  unit_cost: null,
  minimum_stock: null,
  current_stock: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const productAccessoryRow = { id: 'pa1', product_id: '1', accessory_id: 'a1', quantity: 2, created_at: '' }

function renderPage() {
  return render(<ProductsPage />, { wrapper: MemoryRouter })
}

describe('ProductsPage', () => {
  let createMock: ReturnType<typeof vi.fn>
  let changePriceMock: ReturnType<typeof vi.fn>
  let updateMock: ReturnType<typeof vi.fn>
  let refetchMock: ReturnType<typeof vi.fn>
  let saveCompositionMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createMock = vi.fn().mockResolvedValue(undefined)
    changePriceMock = vi.fn().mockResolvedValue(undefined)
    updateMock = vi.fn().mockResolvedValue({ ...product, is_active: false })
    refetchMock = vi.fn()
    saveCompositionMock = vi.fn().mockResolvedValue(undefined)

    useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
    useProductsMock.mockReturnValue({
      products: [product],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      changePrice: changePriceMock,
      update: updateMock,
    })
    useAccessoriesMock.mockReturnValue({ accessories: [accessory], isLoading: false, error: null, refetch: vi.fn() })
    usePackagingMock.mockReturnValue({ packaging: [packagingItem], isLoading: false, error: null, refetch: vi.fn() })
    useProductCompositionMock.mockReturnValue({
      status: 'success',
      accessories: [productAccessoryRow],
      packaging: [],
      isLoading: false,
      error: null,
      retry: vi.fn(),
      save: saveCompositionMock,
    })
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('renders the product list with name, category, price and an active Switch', () => {
    renderPage()

    expect(screen.getByText('Chaveiro')).toBeInTheDocument()
    expect(screen.getByText('Decoração')).toBeInTheDocument()
    expect(screen.getByText(/R\$\s*10,00/)).toBeInTheDocument()
    expect(screen.queryByText('Sim')).not.toBeInTheDocument()
    expect(screen.queryByText('Não')).not.toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Desativar Chaveiro' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  describe('Switch de ativo/inativo na listagem', () => {
    it('produto inativo é renderizado com o Switch desmarcado, com nome acessível de ativar', () => {
      useProductsMock.mockReturnValue({
        products: [{ ...product, is_active: false }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        changePrice: changePriceMock,
        update: updateMock,
      })
      renderPage()

      const toggle = screen.getByRole('switch', { name: 'Ativar Chaveiro' })
      expect(toggle).toHaveAttribute('aria-checked', 'false')
    })

    it('clicar no Switch de um produto ativo chama update com o id correto e is_active: false', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('switch', { name: 'Desativar Chaveiro' }))

      await waitFor(() => expect(updateMock).toHaveBeenCalledWith('1', { is_active: false }))
    })

    it('clicar no Switch de um produto inativo chama update com o id correto e is_active: true', async () => {
      useProductsMock.mockReturnValue({
        products: [{ ...product, is_active: false }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        changePrice: changePriceMock,
        update: updateMock,
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('switch', { name: 'Ativar Chaveiro' }))

      await waitFor(() => expect(updateMock).toHaveBeenCalledWith('1', { is_active: true }))
    })

    it('bloqueia o Switch enquanto a mutation está pendente', async () => {
      let resolveUpdate: (value: typeof product) => void = () => {}
      updateMock.mockReturnValue(
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
      )
      const user = userEvent.setup()
      renderPage()

      const toggle = screen.getByRole('switch', { name: 'Desativar Chaveiro' })
      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-disabled', 'true')

      resolveUpdate({ ...product, is_active: false })
      await waitFor(() => expect(toggle).not.toHaveAttribute('aria-disabled', 'true'))
    })

    it('mostra um toast de erro quando a mutation falha, sem travar o Switch', async () => {
      updateMock.mockRejectedValue(new ApiError('database', 500, 'Falha ao atualizar produto.'))
      const user = userEvent.setup()
      renderPage()

      const toggle = screen.getByRole('switch', { name: 'Desativar Chaveiro' })
      await user.click(toggle)

      await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Falha ao atualizar produto.'))
      expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('preserva as ações "Alterar preço" e "Composição" na mesma linha do Switch', () => {
      renderPage()

      const row = screen.getByRole('row', { name: /chaveiro/i })
      expect(within(row).getByRole('switch', { name: 'Desativar Chaveiro' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /alterar preço/i })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /^composição$/i })).toBeInTheDocument()
    })
  })

  it('zebra striping: roxo claro nas linhas ímpares, branco nas pares, só nas linhas de dados do tbody', () => {
    const secondProduct = { ...product, id: '2', name: 'Vaso' }
    useProductsMock.mockReturnValue({
      products: [product, secondProduct],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      changePrice: changePriceMock,
      update: updateMock,
    })
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

  it('opens the dialog, submits a new product and shows a success toast', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo produto/i }))
    await user.type(screen.getByLabelText(/^nome$/i), 'Vaso')
    await user.type(screen.getByLabelText(/^preço$/i), '25')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Vaso', default_price: 25, allows_personalization: false }),
      ),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Produto cadastrado.')
  })

  it('does not call create when the price is invalid, shows an inline error instead', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo produto/i }))
    await user.type(screen.getByLabelText(/^nome$/i), 'Vaso')
    await user.type(screen.getByLabelText(/^preço$/i), '-5')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(await screen.findByText('O preço deve ser maior ou igual a 0.')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('opens the price dialog and submits a new price for the product', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /alterar preço/i }))
    await user.type(screen.getByLabelText(/novo preço/i), '15')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(changePriceMock).toHaveBeenCalledWith('1', { new_price: 15, reason: null }))
    expect(toastMock.success).toHaveBeenCalledWith('Preço atualizado.')
  })

  it('opens the composition dialog pré-preenchido and saves the replaced composition', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^composição$/i }))

    expect(screen.getByDisplayValue('2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(saveCompositionMock).toHaveBeenCalledWith({
        accessories: [{ id: 'a1', quantity: 2 }],
        packaging: [],
      }),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Composição atualizada.')
  })

  it('does not render the composition form while the composition is still loading', async () => {
    useProductCompositionMock.mockReturnValue({
      status: 'loading',
      accessories: [],
      packaging: [],
      isLoading: true,
      error: null,
      retry: vi.fn(),
      save: saveCompositionMock,
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^composição$/i }))

    expect(screen.queryByRole('button', { name: /^salvar$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/nenhum acessório na composição/i)).not.toBeInTheDocument()
  })

  it('does not render the composition form after a load failure, shows the error and allows retry', async () => {
    const retryMock = vi.fn()
    useProductCompositionMock.mockReturnValue({
      status: 'error',
      accessories: [],
      packaging: [],
      isLoading: false,
      error: new ApiError('database', 500, 'Falha ao carregar composição.'),
      retry: retryMock,
      save: saveCompositionMock,
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^composição$/i }))

    expect(screen.getByText('Falha ao carregar composição.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^salvar$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(retryMock).toHaveBeenCalled()
  })

  it('renders the composition form normally when the composition genuinely loaded empty', async () => {
    useProductCompositionMock.mockReturnValue({
      status: 'success',
      accessories: [],
      packaging: [],
      isLoading: false,
      error: null,
      retry: vi.fn(),
      save: saveCompositionMock,
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^composição$/i }))

    expect(screen.getByText('Nenhum acessório na composição.')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma embalagem na composição.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(saveCompositionMock).toHaveBeenCalledWith({ accessories: [], packaging: [] }))
    expect(toastMock.success).toHaveBeenCalledWith('Composição atualizada.')
  })

  it('shows an inline error with a retry action when the list fails to load', async () => {
    useProductsMock.mockReturnValue({
      products: [],
      isLoading: false,
      error: new ApiError('database', 500, 'Falha ao carregar produtos.'),
      refetch: refetchMock,
      create: createMock,
      changePrice: changePriceMock,
      update: updateMock,
    })
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Falha ao carregar produtos.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(refetchMock).toHaveBeenCalled()
  })

  it('shows the empty state when there are no products', () => {
    useProductsMock.mockReturnValue({
      products: [],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      changePrice: changePriceMock,
      update: updateMock,
    })
    renderPage()

    expect(screen.getByText('Nenhum produto cadastrado.')).toBeInTheDocument()
  })

  it('shows a loading skeleton while products are loading, instead of the table or the empty state', () => {
    useProductsMock.mockReturnValue({
      products: [],
      isLoading: true,
      error: null,
      refetch: refetchMock,
      create: createMock,
      changePrice: changePriceMock,
      update: updateMock,
    })
    renderPage()

    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByText('Nenhum produto cadastrado.')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
