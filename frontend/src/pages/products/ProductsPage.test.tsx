import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'
import type { Product } from '@/types/domain'

const {
  useProductsMock,
  useAccessoriesMock,
  usePackagingMock,
  useProductCompositionMock,
  useAllProductCategoriesMock,
  useProductCategoriesMock,
  useProductPlatesMock,
  useProductPriceHistoryMock,
  toastMock,
  useAuthMock,
} = vi.hoisted(() => ({
  useProductsMock: vi.fn(),
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  useProductCompositionMock: vi.fn(),
  useAllProductCategoriesMock: vi.fn(),
  useProductCategoriesMock: vi.fn(),
  useProductPlatesMock: vi.fn(),
  useProductPriceHistoryMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  useAuthMock: vi.fn(),
}))

vi.mock('@/hooks/useProducts', () => ({ useProducts: useProductsMock }))
vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
vi.mock('@/hooks/useProductComposition', () => ({
  useProductComposition: useProductCompositionMock,
}))
vi.mock('@/hooks/useAllProductCategories', () => ({
  useAllProductCategories: useAllProductCategoriesMock,
}))
vi.mock('@/hooks/useProductCategories', () => ({ useProductCategories: useProductCategoriesMock }))
vi.mock('@/hooks/useProductPlates', () => ({ useProductPlates: useProductPlatesMock }))
vi.mock('@/hooks/useProductPriceHistory', () => ({
  useProductPriceHistory: useProductPriceHistoryMock,
}))
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
  production_weight_manual_override_grams: null,
  production_time_manual_override_seconds: null,
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

const productAccessoryRow = {
  id: 'pa1',
  product_id: '1',
  accessory_id: 'a1',
  quantity: 2,
  created_at: '',
}

// Estrutura produtiva por plates (migration 20260829180000, ainda não
// aplicada) — fixture "já migrada": o Produto tem 1 plate real com
// weight_grams direto (sem filamento) — usada como padrão em beforeEach
// para que a maioria dos testes de "Editar produto" exercite o caminho
// autoritativo (product_plates), não o fallback legado. Os testes de
// fallback legado abaixo sobrescrevem useProductPlatesMock explicitamente
// para plates: [].
const productPlateRow = {
  id: 'pp1',
  product_id: '1',
  plate_number: 1,
  production_time_seconds: 3600,
  weight_grams: 40,
  created_at: '',
  updated_at: '',
}

function renderPage() {
  return render(<ProductsPage />, { wrapper: MemoryRouter })
}

function mockProducts(
  list: Product[],
  overrides: Partial<{
    isLoading: boolean
    error: unknown
    refetch: ReturnType<typeof vi.fn>
  }> = {},
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
    // Estrutura produtiva por plates (2026-08-29): ProductsPage.tsx só
    // chama createWithPlates (nunca mais create() "puro") — reaproveita o
    // mesmo mock de createMock, já que os testes deste arquivo tratam as
    // duas como "a ação de criar" indistintamente.
    createWithPlates: createMock,
    changePrice: changePriceMock,
    update: updateMock,
    // Edição completa por plates (rodada corretiva 2026-08-29) —
    // update_product_full, substitui updateDetails. Um mock resolvido
    // trivial basta aqui: nenhum destes testes (busca/ordenação) abre
    // "Editar produto".
    updateFull: vi.fn().mockResolvedValue(list[0]),
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
  const dataRows = screen
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('cell').length > 0)
  return dataRows.map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

describe('ProductsPage', () => {
  let createMock: ReturnType<typeof vi.fn>
  let changePriceMock: ReturnType<typeof vi.fn>
  let updateMock: ReturnType<typeof vi.fn>
  let updateFullMock: ReturnType<typeof vi.fn>
  let refetchMock: ReturnType<typeof vi.fn>
  let saveCompositionMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createMock = vi.fn().mockResolvedValue(undefined)
    changePriceMock = vi.fn().mockResolvedValue(undefined)
    updateMock = vi.fn().mockResolvedValue({ ...product, is_active: false })
    updateFullMock = vi.fn().mockResolvedValue(product)
    refetchMock = vi.fn()
    saveCompositionMock = vi.fn().mockResolvedValue(undefined)

    useAuthMock.mockReturnValue({
      session: { user: { email: 'op@formasky.com' } },
      signOut: vi.fn(),
    })
    useProductsMock.mockReturnValue({
      products: [product],
      isLoading: false,
      error: null,
      refetch: refetchMock,
      create: createMock,
      createWithPlates: createMock,
      changePrice: changePriceMock,
      update: updateMock,
      updateFull: updateFullMock,
    })
    useProductPriceHistoryMock.mockReturnValue({
      status: 'success',
      history: [],
      isLoading: false,
      error: null,
      retry: vi.fn(),
    })
    useAccessoriesMock.mockReturnValue({
      accessories: [accessory],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    usePackagingMock.mockReturnValue({
      packaging: [packagingItem],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    useProductCompositionMock.mockReturnValue({
      status: 'success',
      accessories: [productAccessoryRow],
      packaging: [],
      isLoading: false,
      error: null,
      retry: vi.fn(),
      save: saveCompositionMock,
    })
    // Categorias (múltiplas por Produto, migration 20260829180000, ainda
    // não aplicada) — useAllProductCategoriesMock (listagem/busca/ordenação)
    // é derivado DINAMICAMENTE do `products` configurado em useProductsMock
    // a cada teste (mesma regra de "1 categoria" que product.category já
    // representava), para não exigir repetir esse mock em toda chamada
    // avulsa de useProductsMock.mockReturnValue espalhada neste arquivo.
    useAllProductCategoriesMock.mockImplementation(() => {
      const { products: currentProducts } = useProductsMock() as { products: Product[] }
      const categoriesByProductId = new Map<string, string[]>()
      for (const item of currentProducts) {
        if (item.category) categoriesByProductId.set(item.id, [item.category])
      }
      return { categoriesByProductId, isLoading: false, error: null, retry: vi.fn() }
    })
    // useProductCategoriesMock (diálogo "Editar produto", um único Produto)
    // — todos os testes deste arquivo editam o Produto id '1' (categoria
    // "Decoração"), então um valor estático padrão basta.
    useProductCategoriesMock.mockReturnValue({
      status: 'success',
      categories: [
        { id: 'pc1', product_id: '1', category: 'Decoração', position: 1, created_at: '' },
      ],
      isLoading: false,
      error: null,
      retry: vi.fn(),
    })
    // Padrão: o Produto já tem 1 plate real (product_plates é a fonte
    // autoritativa, weight_grams direto) — os testes de fallback legado
    // abaixo sobrescrevem para plates: [] explicitamente.
    useProductPlatesMock.mockReturnValue({
      status: 'success',
      plates: [productPlateRow],
      isLoading: false,
      error: null,
      retry: vi.fn(),
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
        {
          ...product,
          id: '2',
          name: 'Miniatura Personalizada Reutilizável',
          product_type: 'CUSTOM',
        },
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
        products: [
          {
            ...product,
            product_type: 'CATALOG',
            default_print_time_seconds: 5400,
            default_weight_grams: 45,
          },
        ],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        changePrice: changePriceMock,
        update: updateMock,
      })
      renderPage()

      // Nome acessível regex-ancorado (não exato): cabeçalhos com alça de
      // redimensionamento passam a incluir "Redimensionar coluna {Label}" no
      // nome computado do <th> (ver ColumnResizeHandle) — mesma decisão já
      // aplicada em OrdersPage.test.tsx/CompaniesPage.test.tsx.
      expect(screen.getByRole('columnheader', { name: /^Tipo/ })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /^Tempo de Produção/ })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /^Peso total \(g\)/ })).toBeInTheDocument()
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

    it('preserva Switch, "Editar produto" e "Acessórios e Embalagem" na mesma linha do link', () => {
      renderPage()

      const row = screen.getByRole('row', { name: /chaveiro/i })
      expect(within(row).getByRole('link', { name: 'Chaveiro' })).toBeInTheDocument()
      expect(within(row).getByRole('switch', { name: 'Desativar Chaveiro' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /^editar produto$/i })).toBeInTheDocument()
      expect(
        within(row).getByRole('button', { name: /^acessórios e embalagem$/i }),
      ).toBeInTheDocument()
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

      await waitFor(() =>
        expect(toastMock.error).toHaveBeenCalledWith('Falha ao atualizar produto.'),
      )
      expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('preserva as ações "Editar produto" e "Acessórios e Embalagem" na mesma linha do Switch', () => {
      renderPage()

      const row = screen.getByRole('row', { name: /chaveiro/i })
      expect(within(row).getByRole('switch', { name: 'Desativar Chaveiro' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /^editar produto$/i })).toBeInTheDocument()
      expect(
        within(row).getByRole('button', { name: /^acessórios e embalagem$/i }),
      ).toBeInTheDocument()
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

    const dataRows = screen
      .getAllByRole('row')
      .filter((row) => within(row).queryAllByRole('cell').length > 0)
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

  // Largura ampliada dos diálogos de Novo/Editar produto (rodada corretiva
  // 2026-08-30 — a janela "continuava estreita" na validação manual porque
  // o max-w-[1400px] anterior, sem breakpoint, nunca vencia o sm:max-w-sm
  // padrão de DialogContent — ver comentário de PRODUCT_FORM_DIALOG_CLASSNAME
  // em ProductsPage.tsx). jsdom não mede largura real de viewport: este
  // teste confirma que a classe correta está presente E que a classe
  // padrão sm:max-w-sm NÃO sobrevive no className final (prova de que o
  // conflito foi resolvido pelo twMerge, não só mascarado); a confirmação
  // visual final (largura efetiva ~96vw/1600px num navegador real) continua
  // dependendo de validação manual, registrada no roadmap.
  it('o diálogo "Novo produto" usa largura ampliada (w-[96vw], sm:max-w-[1600px]) e nunca o padrão sm:max-w-sm', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo produto/i }))

    const dialog = screen.getByRole('dialog', { name: /novo produto/i })
    expect(dialog).toHaveClass('w-[96vw]')
    expect(dialog).toHaveClass('sm:max-w-[1600px]')
    expect(dialog).not.toHaveClass('sm:max-w-sm')
    expect(dialog).not.toHaveClass('w-full')
  })

  it('o diálogo "Editar produto" usa largura ampliada (w-[96vw], sm:max-w-[1600px]) e nunca o padrão sm:max-w-sm', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

    const dialog = screen.getByRole('dialog', { name: /editar produto/i })
    expect(dialog).toHaveClass('w-[96vw]')
    expect(dialog).toHaveClass('sm:max-w-[1600px]')
    expect(dialog).not.toHaveClass('sm:max-w-sm')
    expect(dialog).not.toHaveClass('w-full')
  })

  it('Novo produto e Editar produto usam exatamente a mesma largura', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo produto/i }))
    const createDialog = screen.getByRole('dialog', { name: /novo produto/i })
    const createClassName = createDialog.className
    await user.click(within(createDialog).getByRole('button', { name: /^cancelar$/i }))

    await user.click(screen.getByRole('button', { name: /^editar produto$/i }))
    const editDialog = screen.getByRole('dialog', { name: /editar produto/i })

    expect(editDialog.className).toBe(createClassName)
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
    // Categoria e peso do plate são obrigatórios (migration 20260829180000,
    // ainda não aplicada) — ver cobertura completa em ProductForm.test.tsx.
    await user.click(screen.getByRole('checkbox', { name: 'Decoração' }))
    await user.type(screen.getAllByLabelText(/^peso \(g\)$/i)[0], '10')
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

  it('criação envia o tempo do Plate 1 em segundos (não minutos) dentro de plates[0].production_time_seconds', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /novo produto/i }))
    await user.type(screen.getByLabelText(/^nome$/i), 'Vaso')
    await user.type(screen.getByLabelText(/^preço$/i), '2500')
    await user.click(screen.getByRole('checkbox', { name: 'Decoração' }))
    await user.type(screen.getAllByLabelText(/^peso \(g\)$/i)[0], '10')
    await user.type(screen.getByRole('textbox', { name: /tempo de produção/i }), '1h30min')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          plates: [expect.objectContaining({ production_time_seconds: 5400 })],
        }),
      ),
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
    await user.click(screen.getByRole('button', { name: /^editar produto$/i }))
    await user.type(screen.getByLabelText(/novo preço/i), '1500')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(changePriceMock).toHaveBeenCalledWith('1', { new_price: 15, reason: null }),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Preço atualizado.')
  })

  it('price dialog identifies the product by name and accepts a pasted comma-formatted amount', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

    expect(screen.getByText('"Chaveiro"')).toBeInTheDocument()

    const priceInput = screen.getByLabelText(/novo preço/i)
    await user.click(priceInput)
    await user.paste('15,50')
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(changePriceMock).toHaveBeenCalledWith('1', { new_price: 15.5, reason: null }),
    )
  })

  describe('Editar produto — formulário completo por plates', () => {
    it('abre pré-preenchido com os dados atuais do produto, categorias/plates e acessórios/embalagens já carregados', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.getByLabelText('Nome')).toHaveValue('Chaveiro')
      expect(screen.getByRole('checkbox', { name: 'Decoração' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      expect(screen.getByText('Plate 1')).toBeInTheDocument()
      expect(screen.getAllByLabelText('Peso (g)')[0]).toHaveValue('40')
      expect(screen.getByRole('combobox', { name: 'Acessório' })).toHaveTextContent('Ímã 6x2')
      expect(screen.getByRole('combobox', { name: 'Quantidade do acessório' })).toHaveTextContent(
        '2',
      )
    })

    it('não exibe mais o campo de Preço editável nesta seção — o preço continua só na seção "Preço"', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeInTheDocument()
      expect(screen.getByLabelText(/novo preço/i)).toBeInTheDocument()
      const dialog = screen.getByRole('dialog', { name: 'Editar produto' })
      // Nenhum campo rotulado "Preço" (exatamente) dentro do formulário
      // completo — só o de "Novo preço", da seção separada.
      expect(within(dialog).queryByLabelText(/^preço$/i)).not.toBeInTheDocument()
    })

    it('edita os campos e a composição, salva tudo atomicamente via updateFull, nunca envia default_price nem product_type', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))
      await user.clear(screen.getByLabelText('Nome'))
      await user.type(screen.getByLabelText('Nome'), 'Chaveiro Grande')
      await user.click(screen.getByRole('button', { name: /^salvar alterações$/i }))

      await waitFor(() =>
        expect(updateFullMock).toHaveBeenCalledWith(
          '1',
          expect.objectContaining({
            name: 'Chaveiro Grande',
            categories: ['Decoração'],
            plates: [{ production_time_seconds: 3600, weight_grams: 40 }],
            accessories: [{ id: 'a1', quantity: 2 }],
            packaging: [],
          }),
        ),
      )
      const payload = updateFullMock.mock.calls[0][1]
      expect('default_price' in payload).toBe(false)
      expect('product_type' in payload).toBe(false)
      expect(toastMock.success).toHaveBeenCalledWith('Produto atualizado.')
    })

    it('mostra um skeleton de carregamento enquanto os plates ainda não chegaram, sem abrir o formulário vazio', async () => {
      useProductPlatesMock.mockReturnValue({
        status: 'loading',
        plates: [],
        isLoading: true,
        error: null,
        retry: vi.fn(),
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument()
      expect(screen.queryByText('Plate 1')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^salvar alterações$/i })).not.toBeInTheDocument()
    })

    it('mostra o erro real e permite tentar novamente quando os plates falham ao carregar', async () => {
      const retryMock = vi.fn()
      useProductPlatesMock.mockReturnValue({
        status: 'error',
        plates: [],
        isLoading: false,
        error: new ApiError('database', 500, 'Falha ao carregar plates.'),
        retry: retryMock,
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.getByText('Falha ao carregar plates.')).toBeInTheDocument()
      expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
      expect(retryMock).toHaveBeenCalled()
    })

    it('Produto sem nenhum plate ainda: usa peso/tempo legados (default_weight_grams/default_print_time_seconds) como Plate 1', async () => {
      useProductsMock.mockReturnValue({
        products: [{ ...product, default_weight_grams: 12.5, default_print_time_seconds: 600 }],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        createWithPlates: createMock,
        changePrice: changePriceMock,
        update: updateMock,
        updateFull: updateFullMock,
      })
      useProductPlatesMock.mockReturnValue({
        status: 'success',
        plates: [],
        isLoading: false,
        error: null,
        retry: vi.fn(),
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.getByText('Plate 1')).toBeInTheDocument()
      expect(screen.getAllByLabelText('Peso (g)')[0]).toHaveValue('12.5')
    })

    it('Produto sem plates e sem nenhum peso/tempo legado: nasce com 1 plate vazio, nunca some/erra', async () => {
      useProductPlatesMock.mockReturnValue({
        status: 'success',
        plates: [],
        isLoading: false,
        error: null,
        retry: vi.fn(),
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.getByText('Plate 1')).toBeInTheDocument()
      expect(screen.getByLabelText('Nome')).toHaveValue('Chaveiro')
    })

    it('carrega múltiplos plates, cada um com seu peso/tempo próprios', async () => {
      useProductPlatesMock.mockReturnValue({
        status: 'success',
        plates: [
          productPlateRow,
          {
            ...productPlateRow,
            id: 'pp2',
            plate_number: 2,
            production_time_seconds: 1800,
            weight_grams: 10,
          },
        ],
        isLoading: false,
        error: null,
        retry: vi.fn(),
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.getByText('Plate 1')).toBeInTheDocument()
      expect(screen.getByText('Plate 2')).toBeInTheDocument()
    })

    it('carrega ajustes manuais pré-existentes do Produto (colunas de override)', async () => {
      useProductsMock.mockReturnValue({
        products: [
          {
            ...product,
            production_weight_manual_override_grams: 55,
            production_time_manual_override_seconds: null,
          },
        ],
        isLoading: false,
        error: null,
        refetch: refetchMock,
        create: createMock,
        createWithPlates: createMock,
        changePrice: changePriceMock,
        update: updateMock,
        updateFull: updateFullMock,
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.getByText('55 g')).toBeInTheDocument()
      expect(screen.getByText(/ajustado manualmente/i)).toBeInTheDocument()
    })
  })

  describe('Editar produto — seção "Histórico de preços" (2026-08-29)', () => {
    const historyEntry = {
      id: 'h1',
      product_id: '1',
      price: 10,
      effective_from: '2026-08-20T12:00:00.000Z',
      effective_to: null,
      reason: 'Reajuste',
      created_by: 'u1',
      created_at: '2026-08-20T12:00:00.000Z',
    }

    it('exibe o histórico, mais recente primeiro (ordem já vem do hook)', async () => {
      useProductPriceHistoryMock.mockReturnValue({
        status: 'success',
        history: [
          historyEntry,
          { ...historyEntry, id: 'h0', price: 8, effective_to: historyEntry.effective_from },
        ],
        isLoading: false,
        error: null,
        retry: vi.fn(),
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      const rows = screen
        .getAllByRole('row')
        .filter((row) => within(row).queryAllByRole('cell').length > 0)
      // A primeira linha de dados do histórico é a mais recente (vigente).
      expect(within(rows[0]).getByText('Vigente')).toBeInTheDocument()
      expect(within(rows[1]).getByText('Anterior')).toBeInTheDocument()
    })

    it('estado vazio: nenhum histórico registrado', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.getByText('Nenhum histórico de preço registrado.')).toBeInTheDocument()
    })

    it('estado de carregamento', async () => {
      useProductPriceHistoryMock.mockReturnValue({
        status: 'loading',
        history: [],
        isLoading: true,
        error: null,
        retry: vi.fn(),
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.queryByText('Nenhum histórico de preço registrado.')).not.toBeInTheDocument()
    })

    it('estado de erro mostra a mensagem real e permite tentar novamente', async () => {
      const retryMock = vi.fn()
      useProductPriceHistoryMock.mockReturnValue({
        status: 'error',
        history: [],
        error: new ApiError('database', 500, 'Falha ao carregar histórico.'),
        retry: retryMock,
      })
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('button', { name: /^editar produto$/i }))

      expect(screen.getByText('Falha ao carregar histórico.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
      expect(retryMock).toHaveBeenCalled()
    })
  })

  it('regressão: abrir "Editar produto" e salvar não afeta o diálogo/estado de Acessórios e Embalagem (dialog rápido) nem a Ficha Técnica', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^editar produto$/i }))
    await user.click(screen.getByRole('button', { name: /^salvar alterações$/i }))

    await waitFor(() => expect(updateFullMock).toHaveBeenCalled())
    // O diálogo rápido "Acessórios e Embalagem" (ProductCompositionForm,
    // save independente) nunca é acionado pela edição completa — são dois
    // caminhos de escrita coerentes com a MESMA tabela/RPC
    // (set_product_composition), nunca a mesma chamada.
    expect(saveCompositionMock).not.toHaveBeenCalled()
    // O link para a Ficha Técnica continua intacto (mesmo href de sempre).
    expect(screen.getByRole('link', { name: 'Chaveiro' })).toHaveAttribute('href', '/produtos/1')
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

    await waitFor(() =>
      expect(saveCompositionMock).toHaveBeenCalledWith({ accessories: [], packaging: [] }),
    )
    expect(toastMock.success).toHaveBeenCalledWith('Acessórios e embalagem atualizados.')
  })

  // ---------------------------------------------------------------------------
  // Filamentos — rodada corretiva 2026-08-29: o antigo diálogo dedicado
  // "Filamentos" (dentro de "Acessórios e Embalagem", escrevendo direto e de
  // forma independente em product_filaments via set_product_filaments) foi
  // REMOVIDO — mantê-lo seria exatamente a segunda fonte de verdade que esta
  // rodada corrige (achado 3 da auditoria). A composição de filamentos por
  // plate agora só é editável pelo formulário completo "Editar produto"
  // (bloco acima). A cobertura de comportamento de formulário (múltiplos
  // tipos/peso decimal, duplicidade, peso<=0, item inativo bloqueando
  // salvar) já está coberta em ProductForm.test.tsx — replicada ali porque é
  // o MESMO componente reaproveitado (ProductForm), não um formulário
  // paralelo com regras próprias. Os testes abaixo cobrem só o que é
  // responsabilidade desta página: nenhum caminho de escrita independente
  // em product_filaments sobrevive na "Acessórios e Embalagem" (dialog
  // rápido) e o link "Composição de filamentos" não existe mais ali.
  // ---------------------------------------------------------------------------

  it('o diálogo rápido "Acessórios e Embalagem" não tem mais nenhuma seção de Filamentos', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))

    expect(screen.queryByRole('combobox', { name: 'Tipo de filamento' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^salvar filamentos$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^adicionar filamento$/i })).not.toBeInTheDocument()
  })

  it('salvar Acessórios/Embalagens no diálogo rápido chama só saveComposition, nenhuma outra escrita', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^acessórios e embalagem$/i }))
    await user.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(saveCompositionMock).toHaveBeenCalled())
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

    it('não considera tipo ou preço — só nome e categorias vinculadas (múltiplas por Produto, migration 20260829180000, ainda não aplicada)', async () => {
      mockProducts([{ ...vaso, category: 'Decorativos Especiais' }, suporte, luminaria])
      const user = userEvent.setup()
      renderPage()

      // "especiais" bate na categoria de Vaso (busca por nome OU por
      // qualquer categoria vinculada) — decisão desta rodada, nunca mais
      // "só o nome".
      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'especiais')

      expect(within(getTable()).getByText('Vaso Decorativo')).toBeInTheDocument()
      expect(within(getTable()).queryByText('Suporte de Celular')).not.toBeInTheDocument()
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
      [
        'Tempo de Produção',
        ['ana', 'Beatriz', 'Carlos', 'Ana'],
        ['Carlos', 'Beatriz', 'ana', 'Ana'],
      ],
      ['Peso total (g)', ['ana', 'Beatriz', 'Carlos', 'Ana'], ['Carlos', 'Beatriz', 'ana', 'Ana']],
      ['Preço', ['ana', 'Beatriz', 'Ana', 'Carlos'], ['Carlos', 'Ana', 'Beatriz', 'ana']],
      ['Ativo', ['ana', 'Carlos', 'Ana', 'Beatriz'], ['Carlos', 'Ana', 'Beatriz', 'ana']],
    ])(
      'coluna %s: crescente e decrescente respeitam a ordem esperada (vazios sempre no final, texto de Tipo/Categoria, numérico de Tempo/Peso/Preço)',
      async (columnLabel, ascOrder, descOrder) => {
        const user = userEvent.setup()
        renderPage()

        await applySort(user, columnLabel, 'Ordenar crescente')
        expect(getVisibleProductNamesInOrder()).toEqual(ascOrder)

        await applySort(user, columnLabel, 'Ordenar decrescente')
        expect(getVisibleProductNamesInOrder()).toEqual(descOrder)
      },
    )

    it('somente uma coluna ordenada por vez: escolher outra coluna substitui a ordenação anterior', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      )

      await applySort(user, 'Preço', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Preço/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      )
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute(
        'aria-sort',
        'none',
      )
      expect(getVisibleProductNamesInOrder()).toEqual(['ana', 'Beatriz', 'Ana', 'Carlos'])
    })

    it('remover a ordenação restaura a ordem original (a ordem em que o hook devolveu os registros)', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto', 'Ordenar decrescente')
      expect(getVisibleProductNamesInOrder()).not.toEqual(['Carlos', 'ana', 'Ana', 'Beatriz'])

      await applySort(user, 'Produto', 'Remover ordenação')

      expect(getVisibleProductNamesInOrder()).toEqual(['Carlos', 'ana', 'Ana', 'Beatriz'])
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute(
        'aria-sort',
        'none',
      )
    })

    it('aria-sort correto: none por padrão, ascending/descending após ordenar', async () => {
      const user = userEvent.setup()
      renderPage()

      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute(
        'aria-sort',
        'none',
      )

      await applySort(user, 'Produto', 'Ordenar crescente')
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      )

      await applySort(user, 'Produto', 'Ordenar decrescente')
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      )
    })

    it('a coluna de ações (sem título nem dado próprio) não é ordenável', () => {
      renderPage()

      const headers = screen.getAllByRole('columnheader')
      const actionsHeader = headers[headers.length - 1]
      expect(actionsHeader).toHaveTextContent('')
      expect(
        within(actionsHeader).queryByRole('button', { name: /ordenar coluna/i }),
      ).not.toBeInTheDocument()
      expect(actionsHeader).not.toHaveAttribute('aria-sort')
    })

    it('nomes acessíveis claros nos botões de ordenação de cada coluna', () => {
      renderPage()

      for (const label of [
        'Produto',
        'Tipo',
        'Categoria',
        'Tempo de Produção',
        'Peso total (g)',
        'Preço',
        'Ativo',
      ]) {
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
      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      )
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

      expect(screen.getByRole('columnheader', { name: /^Produto/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      )
    })

    it('zebra striping é recalculado conforme a ordem visual resultante da busca + ordenação', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto', 'Ordenar crescente')

      const dataRows = screen
        .getAllByRole('row')
        .filter((row) => within(row).queryAllByRole('cell').length > 0)
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

  // Padronização das listagens (tipografia compacta, colunas
  // redimensionáveis e persistidas). Sem coluna de data em Produtos. A
  // cobertura genérica da infraestrutura compartilhada mora em
  // columnWidths.test.ts/usePersistentColumnWidths.test.ts/
  // ColumnResizeHandle.test.tsx.
  describe('colunas redimensionáveis e persistidas (padronização das listagens)', () => {
    afterEach(() => {
      window.localStorage.clear()
    })

    it('fonte compacta: a tabela usa a classe compartilhada de tipografia compacta (13.6px)', () => {
      renderPage()
      expect(screen.getByRole('table')).toHaveClass('text-[13.6px]')
    })

    it('presença das alças: cabeçalhos ordenáveis e o cabeçalho de Ações têm separador de redimensionamento', () => {
      renderPage()
      expect(screen.getByRole('separator', { name: 'Redimensionar coluna Produto' })).toBeInTheDocument()
      expect(screen.getByRole('separator', { name: 'Redimensionar coluna Ações' })).toBeInTheDocument()
    })

    it('identificadores de coluna: 8 colunas viram 8 <col> no colgroup', () => {
      renderPage()
      expect(document.querySelectorAll('col')).toHaveLength(8)
    })

    it('a coluna Ações nunca pode ser reduzida abaixo do mínimo necessário para "Editar produto" + "Acessórios e Embalagem" (340px)', () => {
      renderPage()
      const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Ações' })

      fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 })
      fireEvent.pointerMove(handle, { clientX: -9999, pointerId: 1 })

      const actionsCol = document.querySelectorAll('col')[7] as HTMLElement
      expect(Number.parseInt(actionsCol.style.width, 10)).toBe(340)
    })

    it('redimensionar uma coluna por teclado altera só aquela coluna, nunca as demais', () => {
      renderPage()
      const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Produto' })
      const otherWidthBefore = (document.querySelectorAll('col')[1] as HTMLElement).style.width

      handle.focus()
      fireEvent.keyDown(handle, { key: 'ArrowRight' })

      expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('200px')
      expect((document.querySelectorAll('col')[1] as HTMLElement).style.width).toBe(otherWidthBefore)
    })

    it('largura salva é restaurada após remontar a página', () => {
      const { unmount } = renderPage()
      const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Produto' })

      fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
      fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1 })
      fireEvent.pointerUp(handle, { clientX: 160, pointerId: 1 })
      unmount()

      renderPage()
      expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('250px')
    })

    it('"Restaurar larguras" volta a coluna redimensionada ao padrão desta tabela', () => {
      renderPage()
      const handle = screen.getByRole('separator', { name: 'Redimensionar coluna Produto' })
      fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
      fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1 })
      fireEvent.pointerUp(handle, { clientX: 160, pointerId: 1 })
      expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('250px')

      fireEvent.click(screen.getByRole('button', { name: 'Restaurar larguras' }))

      expect((document.querySelectorAll('col')[0] as HTMLElement).style.width).toBe('190px')
    })

    it('rolagem horizontal disponível: a tabela continua dentro de um contêiner overflow-x-auto', () => {
      renderPage()
      const scrollContainer = screen.getByRole('table').closest('.overflow-x-auto')
      expect(scrollContainer).toBeInTheDocument()
    })

    it('regressão: as ações "Editar produto" e "Acessórios e Embalagem" continuam em uma única linha, sem quebra', () => {
      renderPage()
      const actionsCell = within(getTable()).getByRole('button', { name: 'Editar produto' }).closest('div')
      expect(actionsCell).toHaveClass('flex-nowrap')
      expect(actionsCell).not.toHaveClass('flex-wrap')
      expect(within(getTable()).getByRole('button', { name: 'Editar produto' })).toBeInTheDocument()
      expect(within(getTable()).getByRole('button', { name: 'Acessórios e Embalagem' })).toBeInTheDocument()
    })

    it('regressão: busca e ordenação continuam funcionando após o redimensionamento', async () => {
      const user = userEvent.setup()
      renderPage()

      await applySort(user, 'Produto', 'Ordenar crescente')
      expect(getVisibleProductNamesInOrder()).toContain('Chaveiro')
    })
  })

  // Filtro "Filtros" (Categoria/Tipo, 2026-08-31) — popover não-modal com
  // dois grupos de checkboxes. Regras exercitadas aqui:
  //  - Categoria lista só o que está em uso nos produtos carregados (nunca
  //    um catálogo à parte); Tipo lista sempre o enum inteiro.
  //  - "Sem categoria" só aparece quando há produto sem nenhuma categoria.
  //  - Dentro de cada grupo a regra é OR; entre os dois grupos é AND.
  //  - O filtro roda depois da busca e antes da ordenação.
  //  - Contador no botão, chips removíveis e "Limpar filtros" (que nunca
  //    toca na busca).
  describe('Filtro "Filtros" (Categoria e Tipo)', () => {
    const vasoDecoracao = {
      ...product,
      id: 'flt1',
      name: 'Vaso Grande',
      category: 'Decoração',
      product_type: 'CATALOG' as const,
    }
    const chaveiroDecoracao = {
      ...product,
      id: 'flt2',
      name: 'Chaveiro Redondo',
      category: 'Decoração',
      product_type: 'CUSTOM' as const,
    }
    const suporteUtilidades = {
      ...product,
      id: 'flt3',
      name: 'Suporte Celular',
      category: 'Utilidades',
      product_type: 'SPOT' as const,
    }
    const blocoSemCategoria = {
      ...product,
      id: 'flt4',
      name: 'Bloco Neutro',
      category: null,
      product_type: 'CATALOG' as const,
    }

    beforeEach(() => {
      mockProducts([vasoDecoracao, chaveiroDecoracao, suporteUtilidades, blocoSemCategoria])
    })

    // Abre o popover de filtros e espera o conteúdo montar (o botão
    // "Limpar filtros" só existe dentro do popover aberto).
    async function openFilters(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await user.click(screen.getByRole('button', { name: /^Filtros/ }))
      await screen.findByRole('button', { name: 'Limpar filtros' })
    }

    it('o botão "Filtros" abre um popover com as seções Categorias e Tipo de produto', async () => {
      const user = userEvent.setup()
      renderPage()

      expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument()

      await openFilters(user)

      expect(screen.getByText('Categorias')).toBeInTheDocument()
      expect(screen.getByText('Tipo de produto')).toBeInTheDocument()
    })

    it('Categorias lista só as categorias em uso pelos produtos carregados, em ordem alfabética, mais "Sem categoria"', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      expect(screen.getByRole('checkbox', { name: 'Decoração' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Utilidades' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Sem categoria' })).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: 'Presentes' })).not.toBeInTheDocument()
    })

    it('Tipo de produto sempre lista os três tipos do domínio (mesmo os ausentes na lista atual), com os rótulos em português', async () => {
      const user = userEvent.setup()
      mockProducts([vasoDecoracao]) // só CATALOG carregado
      renderPage()
      await openFilters(user)

      expect(screen.getByRole('checkbox', { name: 'Catálogo' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Personalizado' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'SPOT' })).toBeInTheDocument()
    })

    it('"Sem categoria" só aparece quando existe algum produto sem nenhuma categoria', async () => {
      const user = userEvent.setup()
      mockProducts([vasoDecoracao, chaveiroDecoracao, suporteUtilidades])
      renderPage()
      await openFilters(user)

      expect(screen.queryByRole('checkbox', { name: 'Sem categoria' })).not.toBeInTheDocument()
    })

    it('sem nenhuma categoria em uso e sem produtos sem categoria, mostra "Nenhuma categoria cadastrada."', async () => {
      const user = userEvent.setup()
      mockProducts([])
      renderPage()
      await openFilters(user)

      expect(screen.getByText('Nenhuma categoria cadastrada.')).toBeInTheDocument()
    })

    it('marcar uma categoria filtra a tabela para só os produtos daquela categoria', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Decoração' }))

      expect(getVisibleProductNamesInOrder()).toEqual(['Vaso Grande', 'Chaveiro Redondo'])
    })

    it('duas categorias marcadas se combinam por OR (união das duas)', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Decoração' }))
      await user.click(screen.getByRole('checkbox', { name: 'Utilidades' }))

      expect(getVisibleProductNamesInOrder()).toEqual([
        'Vaso Grande',
        'Chaveiro Redondo',
        'Suporte Celular',
      ])
    })

    it('"Sem categoria" traz só os produtos sem nenhuma categoria vinculada', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Sem categoria' }))

      expect(getVisibleProductNamesInOrder()).toEqual(['Bloco Neutro'])
    })

    it('marcar um tipo filtra a tabela para só os produtos daquele tipo', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Personalizado' }))

      expect(getVisibleProductNamesInOrder()).toEqual(['Chaveiro Redondo'])
    })

    it('Categoria e Tipo se combinam por AND: o produto precisa passar nos dois grupos', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Decoração' }))
      await user.click(screen.getByRole('checkbox', { name: 'Catálogo' }))

      // Chaveiro Redondo é Decoração mas CUSTOM -> barrado pelo grupo Tipo.
      expect(getVisibleProductNamesInOrder()).toEqual(['Vaso Grande'])
    })

    it('quando nenhum produto passa nos filtros, mostra o estado vazio da listagem filtrada (sem tabela)', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Utilidades' }))
      await user.click(screen.getByRole('checkbox', { name: 'Catálogo' }))

      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.getByText('Nenhum produto encontrado para esta busca.')).toBeInTheDocument()
    })

    it('o botão "Filtros" mostra a contagem total de seleções (categorias + "sem categoria" + tipos)', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Decoração' }))
      await user.click(screen.getByRole('checkbox', { name: 'SPOT' }))
      expect(screen.getByRole('button', { name: 'Filtros (2)' })).toBeInTheDocument()

      await user.click(screen.getByRole('checkbox', { name: 'Sem categoria' }))
      expect(screen.getByRole('button', { name: 'Filtros (3)' })).toBeInTheDocument()
    })

    it('cada seleção vira um chip removível; remover um chip desmarca só aquele filtro', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Decoração' }))
      await user.click(screen.getByRole('checkbox', { name: 'Catálogo' }))

      expect(
        screen.getByRole('button', { name: 'Remover filtro Categoria: Decoração' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Remover filtro Tipo: Catálogo' }),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Remover filtro Categoria: Decoração' }))

      // Só o filtro de Tipo "Catálogo" continua ativo.
      expect(
        screen.queryByRole('button', { name: 'Remover filtro Categoria: Decoração' }),
      ).not.toBeInTheDocument()
      expect(getVisibleProductNamesInOrder()).toEqual(['Vaso Grande', 'Bloco Neutro'])
    })

    it('"Limpar filtros" remove Categoria e Tipo mas preserva a busca ativa', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.type(screen.getByRole('combobox', { name: 'Buscar produto' }), 'nd')
      expect(getVisibleProductNamesInOrder()).toEqual(['Vaso Grande', 'Chaveiro Redondo'])

      await openFilters(user)
      await user.click(screen.getByRole('checkbox', { name: 'Catálogo' }))
      expect(getVisibleProductNamesInOrder()).toEqual(['Vaso Grande'])

      await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))

      expect(screen.getByRole('combobox', { name: 'Buscar produto' })).toHaveValue('nd')
      expect(getVisibleProductNamesInOrder()).toEqual(['Vaso Grande', 'Chaveiro Redondo'])
      expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument()
    })

    it('"Limpar filtros" fica desabilitado enquanto não houver nenhuma seleção', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeDisabled()

      await user.click(screen.getByRole('checkbox', { name: 'Decoração' }))
      expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeEnabled()
    })

    it('o filtro é aplicado antes da ordenação: ordena só o subconjunto filtrado', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Decoração' }))
      await applySort(user, 'Produto', 'Ordenar decrescente')

      expect(getVisibleProductNamesInOrder()).toEqual(['Vaso Grande', 'Chaveiro Redondo'])
    })

    it('um produto passa no filtro de Categoria se QUALQUER uma das suas categorias estiver marcada', async () => {
      const user = userEvent.setup()
      // Vaso Grande vinculado a duas categorias: "Decoração" e "Presentes".
      useAllProductCategoriesMock.mockReturnValue({
        categoriesByProductId: new Map<string, string[]>([
          ['flt1', ['Decoração', 'Presentes']],
          ['flt2', ['Decoração']],
          ['flt3', ['Utilidades']],
        ]),
        isLoading: false,
        error: null,
        retry: vi.fn(),
      })
      mockProducts([vasoDecoracao, chaveiroDecoracao, suporteUtilidades])
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Presentes' }))

      expect(getVisibleProductNamesInOrder()).toEqual(['Vaso Grande'])
    })
  })
})
