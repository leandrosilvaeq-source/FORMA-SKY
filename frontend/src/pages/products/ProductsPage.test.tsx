import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'
import type { Product } from '@/types/domain'

const {
  useProductsMock,
  useAccessoriesMock,
  usePackagingMock,
  useProductCompositionMock,
  useFilamentTypesMock,
  useProductFilamentsMock,
  toastMock,
  useAuthMock,
} = vi.hoisted(() => ({
  useProductsMock: vi.fn(),
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  useProductCompositionMock: vi.fn(),
  useFilamentTypesMock: vi.fn(),
  useProductFilamentsMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  useAuthMock: vi.fn(),
}))

vi.mock('@/hooks/useProducts', () => ({ useProducts: useProductsMock }))
vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
vi.mock('@/hooks/useProductComposition', () => ({ useProductComposition: useProductCompositionMock }))
vi.mock('@/hooks/useFilamentTypes', () => ({ useFilamentTypes: useFilamentTypesMock }))
vi.mock('@/hooks/useProductFilaments', () => ({ useProductFilaments: useProductFilamentsMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { ProductsPage } from './ProductsPage'

const product: Product = {
  id: '1',
  name: 'Chaveiro',
  category: 'Decoração',
  description: null,
  default_price: 10,
  product_type: 'CATALOG',
  default_print_time_seconds: null,
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

const filamentType = {
  filament_type_id: 'ft1',
  material: 'PLA' as const,
  manufacturer: 'Voolt3D',
  line: 'Sólida',
  commercial_color: 'Preto',
  color_code: null,
  minimum_stock_grams: null,
  is_active: true,
  total_available_grams: 1000,
  usable_spool_count: 1,
  total_spool_count: 1,
}

const productFilamentRow = {
  id: 'pf1',
  product_id: '1',
  filament_type_id: 'ft1',
  theoretical_weight_grams: 12.5,
  created_at: '',
}

function renderPage() {
  return render(<ProductsPage />, { wrapper: MemoryRouter })
}

function mockProducts(
  list: Product[],
  overrides: Partial<{ isLoading: boolean; error: unknown; refetch: ReturnType<typeof vi.fn> }> = {},
  createMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
  changePriceMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
  updateMock: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(list[0]),
) {
  useProductsMock.mockReturnValue({
    products: list,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    refetch: overrides.refetch ?? vi.fn(),
    create: createMock,
    changePrice: changePriceMock,
    update: updateMock,
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
  return screen.queryByRole('listbox', { name: 'Sugestões de produto' })
}

function getListbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Sugestões de produto' })
}

async function applySort(
  user: ReturnType<typeof userEvent.setup>,
  columnLabel: string,
  option: 'Ordenar crescente' | 'Ordenar decrescente' | 'Remover ordenação',
): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Ordenar coluna ${columnLabel}` }))
  await user.click(await screen.findByRole('menuitem', { name: option }))
}

// Retorna, na ordem visual atual (DOM), o nome de "Produto" de cada linha
// de dados — usado como "impressão digital" da ordem das linhas em
// qualquer teste de busca/ordenação, já que o nome é sempre visível e
// único por linha nos fixtures usados aqui, independente de qual coluna
// está de fato ordenando.
function getVisibleProductNamesInOrder(): string[] {
  const dataRows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)
  return dataRows.map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

describe('ProductsPage', () => {
  let createMock: ReturnType<typeof vi.fn>
  let changePriceMock: ReturnType<typeof vi.fn>
  let updateMock: ReturnType<typeof vi.fn>
  let refetchMock: ReturnType<typeof vi.fn>
  let saveCompositionMock: ReturnType<typeof vi.fn>
  let saveFilamentsMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createMock = vi.fn().mockResolvedValue(undefined)
    changePriceMock = vi.fn().mockResolvedValue(undefined)
    updateMock = vi.fn().mockResolvedValue({ ...product, is_active: false })
    refetchMock = vi.fn()
    saveCompositionMock = vi.fn().mockResolvedValue(undefined)
    saveFilamentsMock = vi.fn().mockResolvedValue(undefined)

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
    useFilamentTypesMock.mockReturnValue({
      types: [filamentType],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })
    useProductFilamentsMock.mockReturnValue({
      status: 'success',
      filaments: [productFilamentRow],
      isLoading: false,
      error: null,
      retry: vi.fn(),
      save: saveFilamentsMock,
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

  it('mostra o texto informativo atualizado da listagem, abaixo do título, na íntegra', () => {
    renderPage()

    expect(
      screen.getByText(
        'A listagem reúne todos os produtos de Catálogo e os produtos reutilizáveis. Produtos SPOT criados somente dentro de um pedido não aparecem aqui; um SPOT aparece quando é cadastrado como produto reutilizável.',
      ),
    ).toBeInTheDocument()
  })

  it('a listagem continua exibindo produtos CATALOG, CUSTOM e SPOT cadastrados (qualquer product_type registrado é reutilizável)', () => {
    useProductsMock.mockReturnValue({
      products: [
        { ...product, id: '1', name: 'Chaveiro', product_type: 'CATALOG' },
        { ...product, id: '2', name: 'Miniatura Personalizada Reutilizável', product_type: 'CUSTOM' },
        { ...product, id: '3', name: 'Peça Spot Reutilizável', product_type: 'SPOT' },
      ],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      changePrice: changePriceMock,
      update: updateMock,
    })
    renderPage()

    expect(screen.getByText('Chaveiro')).toBeInTheDocument()
    expect(screen.getByText('Miniatura Personalizada Reutilizável')).toBeInTheDocument()
    expect(screen.getByText('Peça Spot Reutilizável')).toBeInTheDocument()
  })

  describe('colunas Tipo, Tempo de Produção e Peso total (g)', () => {
    it('exibe Tipo (Catálogo), Tempo de Produção (HH:MM:SS) e Peso total (g) quando preenchidos', () => {
      useProductsMock.mockReturnValue({
        products: [{ ...product, product_type: 'CATALOG', default_print_time_seconds: 5400, default_weight_grams: 45 }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        changePrice: changePriceMock,
        update: updateMock,
      })
      renderPage()

      expect(screen.getByRole('columnheader', { name: 'Tipo' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Tempo de Produção' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Peso total (g)' })).toBeInTheDocument()
      const row = screen.getByRole('row', { name: /chaveiro/i })
      expect(within(row).getByText('Catálogo')).toBeInTheDocument()
      expect(within(row).getByText('01:30:00')).toBeInTheDocument()
      expect(within(row).getByText('45 g')).toBeInTheDocument()
    })

    it.each([
      ['Personalizado', 'CUSTOM'],
      ['SPOT', 'SPOT'],
    ] as const)('Tipo %s é exibido corretamente', (label, value) => {
      useProductsMock.mockReturnValue({
        products: [{ ...product, product_type: value }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        changePrice: changePriceMock,
        update: updateMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /chaveiro/i })
      expect(within(row).getByText(label)).toBeInTheDocument()
    })

    it('Tempo de Produção e Peso total (g) ausentes mostram "Não informado"', () => {
      useProductsMock.mockReturnValue({
        products: [{ ...product, default_print_time_seconds: null, default_weight_grams: null }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        changePrice: changePriceMock,
        update: updateMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /chaveiro/i })
      expect(within(row).getAllByText('Não informado')).toHaveLength(2)
    })
  })

  describe('nome do produto como link para a Ficha Técnica', () => {
    it('o nome do produto é um link com o href correto', () => {
      renderPage()

      const nameLink = screen.getByRole('link', { name: 'Chaveiro' })
      expect(nameLink).toHaveAttribute('href', '/produtos/1')
    })

    it('preserva Switch, "Alterar preço" e "Acessórios e Embalagem" na mesma linha do link', () => {
      renderPage()

      const row = screen.getByRole('row', { name: /chaveiro/i })
      expect(within(row).getByRole('link', { name: 'Chaveiro' })).toBeInTheDocument()
      expect(within(row).getByRole('switch', { name: 'Desativar Chaveiro' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /alterar preço/i })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /^acessórios e embalagem$/i })).toBeInTheDocument()
    })

    it('clicar no nome não aciona o Switch nem outra ação da linha', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('link', { name: 'Chaveiro' }))

      expect(updateMock).not.toHaveBeenCalled()
      expect(changePriceMock).not.toHaveBeenCalled()
    })

    it('preserva a classe de zebra striping/hover da linha com o link', () => {
      renderPage()

      const row = screen.getByRole('row', { name: /chaveiro/i })
      expect(row).toHaveClass('odd:bg-brand-primary-soft/50')
      expect(row).toHaveClass('even:bg-white')
      expect(row).toHaveClass('hover:bg-brand-primary-soft')
    })
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

    it('preserva as ações "Alterar preço" e "Acessórios e Embalagem" na mesma linha do Switch', () => {
      renderPage()

      const row = screen.getByRole('row', { name: /chaveiro/i })
      expect(within(row).getByRole('switch', { name: 'Desativar Chaveiro' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /alterar preço/i })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /^acessórios e embalagem$/i })).toBeInTheDocument()
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

  it('opens the dialog, submits a new product with the bank-style price and shows a success toast', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo produto/i }))
    await user.type(screen.getByLabelText(/^nome$/i), 'Vaso')
    // Campo "bancário": dígitos entram pela direita como centavos —
    // "2500" -> R$ 25,00 (ver ProductForm.test.tsx para a cobertura
    // completa de digitação/Backspace/colagem).
    await user.type(screen.getByLabelText(/^preço$/i), '2500')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    // Permite personalização nasce ativado por padrão na criação — sem
    // interação no Switch, o payload sai com allows_personalization: true.
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Vaso', default_price: 25, allows_personalization: true }),
      ),
    )
    const payload = createMock.mock.calls[0][0]
    expect('units_per_plate' in payload).toBe(false)
    expect(toastMock.success).toHaveBeenCalledWith('Produto cadastrado.')
  })

  it('does not call create when the price is never touched, shows an inline error instead', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo produto/i }))
    await user.type(screen.getByLabelText(/^nome$/i), 'Vaso')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    expect(await screen.findByText('Informe o preço.')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('criação envia default_print_time_seconds (não minutos) quando o tempo de impressão é preenchido', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo produto/i }))
    await user.type(screen.getByLabelText(/^nome$/i), 'Vaso')
    await user.type(screen.getByLabelText(/^preço$/i), '2500')
    await user.type(screen.getByRole('textbox', { name: /tempo de produção/i }), '1h30min')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ default_print_time_seconds: 5400 })),
    )
    const payload = createMock.mock.calls[0][0]
    expect('default_print_time_minutes' in payload).toBe(false)
  })

  it('opens the price dialog and submits a new price for the product', async () => {
    const user = userEvent.setup()
    renderPage()

    // Campo "Novo preço" é um input bancário: os dígitos digitados
    // preenchem da direita para a esquerda, os dois últimos são centavos —
    // "1500" -> R$ 15,00 (ver ProductPriceForm.test.tsx para a cobertura
    // completa do comportamento de digitação/Backspace/colagem).
    await user.click(screen.getByRole('button', { name: /alterar preço/i }))
    await user.type(screen.getByLabelText(/novo preço/i), '1500')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(changePriceMock).toHaveBeenCalledWith('1', { new_price: 15, reason: null }))
    expect(toastMock.success).toHaveBeenCalledWith('Preço atualizado.')
  })

  it('price dialog identifies the product by name and accepts a pasted comma-formatted amount', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /alterar preço/i }))

    expect(screen.getByText('"Chaveiro"')).toBeInTheDocument()

    const priceInput = screen.getByLabelText(/novo preço/i)
    await user.click(priceInput)
    await user.paste('15,50')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(changePriceMock).toHaveBeenCalledWith('1', { new_price: 15.5, reason: null }))
  })

  it('opens the composition dialog pré-preenchido and saves the replaced composition', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))

    expect(screen.getByRole('combobox', { name: 'Quantidade do acessório' })).toHaveTextContent('2')

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(saveCompositionMock).toHaveBeenCalledWith({
        accessories: [{ id: 'a1', quantity: 2 }],
        packaging: [],
      }),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Acessórios e embalagem atualizados.')
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

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))

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

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))

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

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))

    expect(screen.getByText('Nenhum acessório na composição.')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma embalagem na composição.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(saveCompositionMock).toHaveBeenCalledWith({ accessories: [], packaging: [] }))
    expect(toastMock.success).toHaveBeenCalledWith('Acessórios e embalagem atualizados.')
  })

  // ---------------------------------------------------------------------------
  // Filamentos (Módulo 3, Incremento 6A) — seção própria dentro do mesmo
  // diálogo "Acessórios e Embalagem", com carregamento/erro/salvamento
  // inteiramente independentes da seção acima (nunca a mesma chamada).
  // ---------------------------------------------------------------------------

  it('a seção Filamentos aparece pré-preenchida e salva de forma independente da seção de Acessórios/Embalagens', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))

    expect(screen.getByRole('combobox', { name: 'Tipo de filamento' })).toHaveTextContent('PLA · Voolt3D · Sólida · Preto')
    expect(screen.getByRole('textbox', { name: 'Peso teórico por unidade (g)' })).toHaveValue('12.5')

    await user.click(screen.getByRole('button', { name: /^salvar filamentos$/i }))

    await waitFor(() =>
      expect(saveFilamentsMock).toHaveBeenCalledWith({
        filaments: [{ id: 'ft1', theoretical_weight_grams: 12.5 }],
      }),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Filamentos atualizados.')
    // Salvar filamentos nunca aciona o salvamento de Acessórios/Embalagens.
    expect(saveCompositionMock).not.toHaveBeenCalled()
  })

  it('salvar Acessórios/Embalagens nunca aciona o salvamento de Filamentos', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(saveCompositionMock).toHaveBeenCalled())
    expect(saveFilamentsMock).not.toHaveBeenCalled()
  })

  it('permite múltiplos tipos de filamento e peso decimal brasileiro (vírgula)', async () => {
    useProductFilamentsMock.mockReturnValue({
      status: 'success',
      filaments: [],
      isLoading: false,
      error: null,
      retry: vi.fn(),
      save: saveFilamentsMock,
    })
    useFilamentTypesMock.mockReturnValue({
      types: [filamentType, { ...filamentType, filament_type_id: 'ft2', commercial_color: 'Branco' }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))
    await user.click(screen.getByRole('button', { name: /^adicionar filamento$/i }))
    await user.click(screen.getByRole('button', { name: /^adicionar filamento$/i }))

    const typeSelects = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })
    expect(typeSelects).toHaveLength(2)
    await user.click(typeSelects[0])
    await user.click(await screen.findByRole('option', { name: /PLA · Voolt3D · Sólida · Preto/ }))
    await user.click(typeSelects[1])
    await user.click(await screen.findByRole('option', { name: /PLA · Voolt3D · Sólida · Branco/ }))

    const weightInputs = screen.getAllByRole('textbox', { name: 'Peso teórico por unidade (g)' })
    await user.type(weightInputs[0], '12,5')
    await user.type(weightInputs[1], '3,25')

    await user.click(screen.getByRole('button', { name: /^salvar filamentos$/i }))

    await waitFor(() =>
      expect(saveFilamentsMock).toHaveBeenCalledWith({
        filaments: [
          { id: 'ft1', theoretical_weight_grams: 12.5 },
          { id: 'ft2', theoretical_weight_grams: 3.25 },
        ],
      }),
    )
  })

  it('impede selecionar o mesmo tipo de filamento em duas linhas (sem duplicidade)', async () => {
    useProductFilamentsMock.mockReturnValue({
      status: 'success',
      filaments: [productFilamentRow],
      isLoading: false,
      error: null,
      retry: vi.fn(),
      save: saveFilamentsMock,
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))
    await user.click(screen.getByRole('button', { name: /^adicionar filamento$/i }))

    const typeSelects = screen.getAllByRole('combobox', { name: 'Tipo de filamento' })
    await user.click(typeSelects[1])

    // O único tipo cadastrado (ft1) já está escolhido na primeira linha —
    // não deve aparecer como opção disponível na segunda.
    expect(screen.queryByRole('option', { name: /PLA · Voolt3D · Sólida · Preto/ })).not.toBeInTheDocument()
  })

  it('bloqueia salvar com peso zero ou negativo', async () => {
    useProductFilamentsMock.mockReturnValue({
      status: 'success',
      filaments: [{ ...productFilamentRow, theoretical_weight_grams: 0 }],
      isLoading: false,
      error: null,
      retry: vi.fn(),
      save: saveFilamentsMock,
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))
    await user.click(screen.getByRole('button', { name: /^salvar filamentos$/i }))

    expect(await screen.findByText(/deve ser maior ou igual a 0.01/i)).toBeInTheDocument()
    expect(saveFilamentsMock).not.toHaveBeenCalled()
  })

  it('preserva um tipo de filamento inativo já vinculado (nunca some da tela) e bloqueia salvar até ser removido', async () => {
    useFilamentTypesMock.mockReturnValue({
      types: [{ ...filamentType, is_active: false }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))

    expect(screen.getByRole('combobox', { name: 'Tipo de filamento' })).toHaveTextContent(
      'PLA · Voolt3D · Sólida · Preto (inativo)',
    )
    expect(screen.getByText(/este tipo de filamento está inativo/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^salvar filamentos$/i })).toBeDisabled()
  })

  it('a seção Filamentos não aparece enquanto ainda está carregando', async () => {
    useProductFilamentsMock.mockReturnValue({
      status: 'loading',
      filaments: [],
      isLoading: true,
      error: null,
      retry: vi.fn(),
      save: saveFilamentsMock,
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))

    expect(screen.queryByRole('button', { name: /^salvar filamentos$/i })).not.toBeInTheDocument()
  })

  it('mostra o erro real e permite tentar novamente quando a composição de filamentos falha ao carregar', async () => {
    const retryMock = vi.fn()
    useProductFilamentsMock.mockReturnValue({
      status: 'error',
      filaments: [],
      isLoading: false,
      error: new ApiError('database', 500, 'Falha ao carregar filamentos.'),
      retry: retryMock,
      save: saveFilamentsMock,
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))

    expect(screen.getByText('Falha ao carregar filamentos.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^salvar filamentos$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(retryMock).toHaveBeenCalled()
  })

  it('mostra "Nenhum filamento na composição." quando a composição de filamentos carrega genuinamente vazia', async () => {
    useProductFilamentsMock.mockReturnValue({
      status: 'success',
      filaments: [],
      isLoading: false,
      error: null,
      retry: vi.fn(),
      save: saveFilamentsMock,
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))

    expect(screen.getByText('Nenhum filamento na composição.')).toBeInTheDocument()
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

  it('renomeação: mostra o cabeçalho "Produto" e não mostra mais "Nome"', () => {
    renderPage()

    expect(screen.getByRole('columnheader', { name: /^Produto/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Nome' })).not.toBeInTheDocument()
  })

  describe('Busca rápida por produto', () => {
    const vaso = { ...product, id: '10', name: 'Vaso Decorativo' }
    const suporte = { ...product, id: '11', name: 'Suporte de Celular' }
    const luminaria = { ...product, id: '12', name: 'Luminária' }

    beforeEach(() => {
      mockProducts([vaso, suporte, luminaria])
    })

    it('possui rótulo acessível "Buscar produto" e placeholder "Buscar produto..."', () => {
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar produto' })
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('placeholder', 'Buscar produto...')
    })

    it('busca por nome completo encontra o produto correspondente', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'Vaso Decorativo')

      expect(within(getTable()).getByText('Vaso Decorativo')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Suporte de Celular')).not.toBeInTheDocument()
      expect(within(getTable()).queryByText('Luminária')).not.toBeInTheDocument()
    })

    it('correspondência parcial ("vaso") encontra "Vaso Decorativo"', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'vaso')

      expect(within(getTable()).getByText('Vaso Decorativo')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Suporte de Celular')).not.toBeInTheDocument()
    })

    it('busca sem diferenciar maiúsculas/minúsculas', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'SUPORTE')

      expect(within(getTable()).getByText('Suporte de Celular')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Vaso Decorativo')).not.toBeInTheDocument()
    })

    it('busca tolerante a acentos ("luminaria" encontra "Luminária")', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'luminaria')

      expect(within(getTable()).getByText('Luminária')).toBeInTheDocument()
    })

    it('remove espaços extras do termo pesquisado', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), '   vaso   ')

      expect(within(getTable()).getByText('Vaso Decorativo')).toBeInTheDocument()
    })

    it('termo sem resultado mostra o estado vazio específico da busca, distinto de "Nenhum produto cadastrado."', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'xyzxyz')

      expect(screen.getByText('Nenhum produto encontrado para esta busca.')).toBeInTheDocument()
      expect(screen.queryByText('Nenhum produto cadastrado.')).not.toBeInTheDocument()
    })

    it('não considera tipo, categoria, preço ou outros campos — só o nome', async () => {
      mockProducts([{ ...vaso, category: 'Decorativos Especiais' }, suporte, luminaria])
      const user = userEvent.setup()
      renderPage()

      // "especiais" só bate na categoria de Vaso, nunca no nome.
      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'especiais')

      expect(screen.getByText('Nenhum produto encontrado para esta busca.')).toBeInTheDocument()
    })

    it('limpar busca restaura todos os produtos', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar produto' })
      await user.type(input, 'vaso')
      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(input).toHaveValue('')
      expect(screen.getByText('Vaso Decorativo')).toBeInTheDocument()
      expect(screen.getByText('Suporte de Celular')).toBeInTheDocument()
      expect(screen.getByText('Luminária')).toBeInTheDocument()
    })

    it('nenhuma nova chamada ao hook/API enquanto o usuário digita', async () => {
      const refetchMock = vi.fn()
      mockProducts([vaso, suporte, luminaria], { refetch: refetchMock })
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'vaso')

      expect(refetchMock).not.toHaveBeenCalled()
    })
  })

  describe('Autocomplete/typeahead do campo "Buscar produto"', () => {
    const vaso = { ...product, id: '20', name: 'Vaso Grande' }
    const vasinho = { ...product, id: '21', name: 'Vaso Pequeno' }
    const chaveiro = { ...product, id: '22', name: 'Chaveiro' }

    beforeEach(() => {
      mockProducts([vaso, vasinho, chaveiro])
    })

    it('não abre a lista com o campo vazio', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('combobox', { name: 'Buscar produto' }))

      expect(queryListbox()).not.toBeInTheDocument()
    })

    it('sugestões são atualizadas a cada caractere digitado', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar produto' })
      await user.type(input, 'vaso')
      expect(within(getListbox()).getAllByRole('option')).toHaveLength(2)

      await user.type(input, ' g')
      expect(within(getListbox()).getAllByRole('option')).toHaveLength(1)
      expect(within(getListbox()).getByRole('option', { name: 'Vaso Grande' })).toBeInTheDocument()
    })

    it('clicar numa sugestão preenche o nome completo, filtra a tabela e fecha a lista', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'vaso')
      await user.click(within(getListbox()).getByRole('option', { name: 'Vaso Pequeno' }))

      expect(screen.getByRole('combobox', { name: 'Buscar produto' })).toHaveValue('Vaso Pequeno')
      expect(queryListbox()).not.toBeInTheDocument()
      expect(within(getTable()).getByText('Vaso Pequeno')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Vaso Grande')).not.toBeInTheDocument()
    })

    it('ArrowDown + Enter seleciona a primeira sugestão', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar produto' })
      await user.type(input, 'vaso')
      await user.keyboard('{ArrowDown}{Enter}')

      expect(input).toHaveValue('Vaso Grande')
      expect(queryListbox()).not.toBeInTheDocument()
    })

    it('ArrowUp navega para a sugestão anterior', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar produto' })
      await user.type(input, 'vaso')
      await user.keyboard('{ArrowDown}{ArrowDown}') // ativa Vaso Pequeno (índice 1)
      await user.keyboard('{ArrowUp}') // volta para Vaso Grande (índice 0)
      await user.keyboard('{Enter}')

      expect(input).toHaveValue('Vaso Grande')
    })

    it('Escape fecha a lista sem apagar o texto digitado', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar produto' })
      await user.type(input, 'vaso')
      await user.keyboard('{Escape}')

      expect(queryListbox()).not.toBeInTheDocument()
      expect(input).toHaveValue('vaso')
      expect(within(getTable()).getByText('Vaso Grande')).toBeInTheDocument()
      expect(within(getTable()).getByText('Vaso Pequeno')).toBeInTheDocument()
    })

    it('clicar fora do campo/lista fecha as sugestões, sem alterar o texto nem a tabela', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar produto' })
      await user.type(input, 'vaso')
      expect(queryListbox()).toBeInTheDocument()

      await user.click(screen.getByRole('heading', { name: 'Produtos' }))

      expect(queryListbox()).not.toBeInTheDocument()
      expect(input).toHaveValue('vaso')
    })

    it('"Limpar busca" fecha o autocomplete e restaura a tabela completa', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'vaso')
      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(queryListbox()).not.toBeInTheDocument()
      expect(within(getTable()).getByText('Chaveiro')).toBeInTheDocument()
    })

    it('voltar a editar o texto reabre as sugestões com a lista atualizada', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar produto' })
      await user.type(input, 'vaso')
      await user.click(within(getListbox()).getByRole('option', { name: 'Vaso Grande' }))
      expect(queryListbox()).not.toBeInTheDocument()

      await user.type(input, ' extra')

      expect(queryListbox()).toBeInTheDocument()
    })

    it('nenhuma seleção automática mesmo com uma única sugestão correspondente', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar produto' })
      await user.type(input, 'chaveiro')

      expect(within(getListbox()).getAllByRole('option')).toHaveLength(1)
      expect(input).toHaveValue('chaveiro')
      expect(within(getTable()).getByText('Chaveiro')).toBeInTheDocument()
    })

    it('atributos e nomes acessíveis do combobox/listbox/opções', async () => {
      const user = userEvent.setup()
      renderPage()

      const input = screen.getByRole('combobox', { name: 'Buscar produto' })
      expect(input).toHaveAttribute('aria-autocomplete', 'list')
      expect(input).toHaveAttribute('aria-controls', 'product-search-listbox')
      expect(input).toHaveAttribute('aria-expanded', 'false')
      expect(input).not.toHaveAttribute('aria-activedescendant')

      await user.type(input, 'vaso')
      expect(input).toHaveAttribute('aria-expanded', 'true')
      expect(getListbox()).toHaveAttribute('id', 'product-search-listbox')

      await user.keyboard('{ArrowDown}')
      const activeOption = within(getListbox()).getByRole('option', { name: 'Vaso Grande' })
      expect(input).toHaveAttribute('aria-activedescendant', activeOption.id)
      expect(activeOption).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('Ordenação por coluna (menu estilo filtro de tabela)', () => {
    // Conjunto único de 4 produtos reaproveitado por todos os testes desta
    // seção. Propositalmente inclui: valores vazios (id 'p3', category/
    // print_time/weight null) para provar que ficam sempre no final; e um
    // empate real de nome ('ana' vs 'Ana', id 'p2' e 'p3', nessa ordem
    // original) e de Tipo (CATALOG em 'p3' e 'p4') para provar
    // estabilidade — comparação por Intl.Collator(sensitivity:'base')
    // trata "ana"/"Ana" como iguais.
    const rowCarlos = {
      ...product,
      id: 'p1',
      name: 'Carlos',
      product_type: 'SPOT' as const,
      category: 'Zeta Categoria',
      default_print_time_seconds: 300,
      default_weight_grams: 30,
      default_price: 30,
      is_active: true,
    }
    const rowAnaLower = {
      ...product,
      id: 'p2',
      name: 'ana',
      product_type: 'CUSTOM' as const,
      category: 'Alfa Categoria',
      default_print_time_seconds: 100,
      default_weight_grams: 10,
      default_price: 10,
      is_active: false,
    }
    const rowAnaUpper = {
      ...product,
      id: 'p3',
      name: 'Ana',
      product_type: 'CATALOG' as const,
      category: null,
      default_print_time_seconds: null,
      default_weight_grams: null,
      default_price: 20,
      is_active: true,
    }
    const rowBeatriz = {
      ...product,
      id: 'p4',
      name: 'Beatriz',
      product_type: 'CATALOG' as const,
      category: 'Beta Categoria',
      default_print_time_seconds: 200,
      default_weight_grams: 20,
      default_price: 15,
      is_active: true,
    }

    beforeEach(() => {
      mockProducts([rowCarlos, rowAnaLower, rowAnaUpper, rowBeatriz])
    })

    it.each([
      ['Produto', ['ana', 'Ana', 'Beatriz', 'Carlos'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Tipo', ['Ana', 'Beatriz', 'ana', 'Carlos'], ['Carlos', 'ana', 'Ana', 'Beatriz']],
      ['Categoria', ['ana', 'Beatriz', 'Carlos', 'Ana'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Tempo de Produção', ['ana', 'Beatriz', 'Carlos', 'Ana'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Peso total (g)', ['ana', 'Beatriz', 'Carlos', 'Ana'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Preço', ['ana', 'Beatriz', 'Ana', 'Carlos'], ['Carlos', 'Ana', 'Beatriz', 'ana']],
      ['Ativo', ['ana', 'Carlos', 'Ana', 'Beatriz'], ['Carlos', 'Ana', 'Beatriz', 'ana']],
    ])('coluna %s: crescente e decrescente respeitam a ordem esperada (vazios sempre no final, texto de Tipo/Categoria, numérico de Tempo/Peso/Preço)', async (columnLabel, ascOrder, descOrder) => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, columnLabel, 'Ordenar crescente')
      expect(getVisibleProductNamesInOrder()).toEqual(ascOrder)

      await applySort(user, columnLabel, 'Ordenar decrescente')
      expect(getVisibleProductNamesInOrder()).toEqual(descOrder)
    })

    it('somente uma coluna ordenada por vez: escolher outra coluna substitui a ordenação anterior', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute('aria-sort', 'ascending')

      await applySort(user, 'Preço', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Preço/ })).toHaveAttribute('aria-sort', 'ascending')
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute('aria-sort', 'none')
      expect(getVisibleProductNamesInOrder()).toEqual(['ana', 'Beatriz', 'Ana', 'Carlos'])
    })

    it('remover a ordenação restaura a ordem original (a ordem em que o hook devolveu os registros)', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto', 'Ordenar decrescente')
      expect(getVisibleProductNamesInOrder()).not.toEqual(['Carlos', 'ana', 'Ana', 'Beatriz'])

      await applySort(user, 'Produto', 'Remover ordenação')

      expect(getVisibleProductNamesInOrder()).toEqual(['Carlos', 'ana', 'Ana', 'Beatriz'])
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute('aria-sort', 'none')
    })

    it('aria-sort correto: none por padrão, ascending/descending após ordenar', async () => {
      const user = userEvent.setup()
      renderPage()

      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute('aria-sort', 'none')

      await applySort(user, 'Produto', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute('aria-sort', 'ascending')

      await applySort(user, 'Produto', 'Ordenar decrescente')
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute('aria-sort', 'descending')
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

      for (const label of ['Produto', 'Tipo', 'Categoria', 'Tempo de Produção', 'Peso total (g)', 'Preço', 'Ativo']) {
        expect(screen.getByRole('button', { name: `Ordenar coluna ${label}` })).toBeInTheDocument()
      }
    })
  })

  describe('Combinação entre busca e ordenação', () => {
    const carlos = { ...product, id: 'p1', name: 'Carlos', default_price: 30 }
    const alice = { ...product, id: 'p2', name: 'Alice', default_price: 10 }
    const amanda = { ...product, id: 'p3', name: 'Amanda', default_price: 20 }

    beforeEach(() => {
      mockProducts([carlos, alice, amanda])
    })

    it('primeiro filtra pelo nome, depois ordena o resultado filtrado', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'a')
      expect(getVisibleProductNamesInOrder()).toHaveLength(3)

      await applySort(user, 'Produto', 'Ordenar crescente')
      expect(getVisibleProductNamesInOrder()).toEqual(['Alice', 'Amanda', 'Carlos'])

      await user.clear(screen.getByRole('combobox', { name: 'Buscar produto' }))
      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'am')
      expect(getVisibleProductNamesInOrder()).toEqual(['Amanda'])
    })

    it('limpar a busca mantém a ordenação ativa', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto', 'Ordenar decrescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'a')
      expect(getVisibleProductNamesInOrder()).toEqual(['Carlos', 'Amanda', 'Alice'])

      await user.click(screen.getByRole('button', { name: /limpar busca/i }))

      expect(getVisibleProductNamesInOrder()).toEqual(['Carlos', 'Amanda', 'Alice'])
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute('aria-sort', 'descending')
    })

    it('remover a ordenação mantém a busca ativa', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto', 'Ordenar crescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'am')
      expect(getVisibleProductNamesInOrder()).toEqual(['Amanda'])

      await applySort(user, 'Produto', 'Remover ordenação')

      expect(screen.getByRole('combobox', { name: 'Buscar produto' })).toHaveValue('am')
      expect(getVisibleProductNamesInOrder()).toEqual(['Amanda'])
    })

    it('autocomplete respeita a ordenação ativa e preserva a ordenação ao selecionar uma sugestão', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto', 'Ordenar decrescente')
      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'a')

      const options = within(getListbox()).getAllByRole('option')
      expect(options.map((option) => option.textContent)).toEqual(['Carlos', 'Amanda', 'Alice'])

      await user.click(options[0])

      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute('aria-sort', 'descending')
    })

    it('zebra striping é recalculado conforme a ordem visual resultante da busca + ordenação', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto', 'Ordenar crescente')

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
