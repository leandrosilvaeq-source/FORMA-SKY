import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '@/lib/api/errors'

const {
  useProductMock,
  useProductCompositionMock,
  useAccessoriesMock,
  usePackagingMock,
  useProductCategoriesMock,
  useProductPlatesMock,
  useAuthMock,
} = vi.hoisted(() => ({
  useProductMock: vi.fn(),
  useProductCompositionMock: vi.fn(),
  useAccessoriesMock: vi.fn(),
  usePackagingMock: vi.fn(),
  useProductCategoriesMock: vi.fn(),
  useProductPlatesMock: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('@/hooks/useProduct', () => ({ useProduct: useProductMock }))
vi.mock('@/hooks/useProductComposition', () => ({ useProductComposition: useProductCompositionMock }))
vi.mock('@/hooks/useAccessories', () => ({ useAccessories: useAccessoriesMock }))
vi.mock('@/hooks/usePackaging', () => ({ usePackaging: usePackagingMock }))
vi.mock('@/hooks/useProductCategories', () => ({ useProductCategories: useProductCategoriesMock }))
vi.mock('@/hooks/useProductPlates', () => ({ useProductPlates: useProductPlatesMock }))
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }))

import { ProductDetailPage } from './ProductDetailPage'

const product = {
  id: 'p1',
  name: 'Chaveiro Gatinho',
  category: 'Decoração',
  description: 'Chaveiro em formato de gato',
  default_price: 25.5,
  // 2h10min = 7800s — mesmo valor de antes (130 minutos), já convertido
  // pela migration de renomeação (simula um produto legado convertido).
  product_type: 'CATALOG',
  default_print_time_seconds: 7800,
  default_weight_grams: 45,
  units_per_plate: 4,
  default_file_id: null,
  allows_personalization: true,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const accessoryWithCost = {
  id: 'a1',
  name: 'Ímã 6x2',
  material: null,
  size: null,
  variant: null,
  unit_cost: 1.5,
  minimum_stock: null,
  current_stock: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const inactiveAccessory = { ...accessoryWithCost, id: 'a2', name: 'Parafuso M3', unit_cost: 0.2, is_active: false }
const accessoryWithoutCost = { ...accessoryWithCost, id: 'a3', name: 'LED', unit_cost: null }

const packagingWithCost = {
  id: 'k1',
  name: 'Caixa M',
  material: null,
  size: null,
  variant: null,
  unit_cost: 3,
  minimum_stock: null,
  current_stock: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const inactivePackaging = { ...packagingWithCost, id: 'k2', name: 'Ziplock PP', unit_cost: 0.5, is_active: false }
const packagingWithoutCost = { ...packagingWithCost, id: 'k3', name: 'Sacola Kraft', unit_cost: null }

function renderPage(path = '/produtos/p1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/produtos/:productId" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProductDetailPage', () => {
  const retryMock = vi.fn()
  const compositionRetryMock = vi.fn()
  const accessoriesRefetchMock = vi.fn()
  const packagingRefetchMock = vi.fn()

  beforeEach(() => {
    useAuthMock.mockReturnValue({ session: { user: { email: 'op@formasky.com' } }, signOut: vi.fn() })
    retryMock.mockReset()
    compositionRetryMock.mockReset()
    accessoriesRefetchMock.mockReset()
    packagingRefetchMock.mockReset()

    // Padrão: composição/acessórios/embalagens vazios e bem-sucedidos — os
    // testes de Identificação/Produção não dependem disso, mas precisam de
    // um estado consistente para as fontes não ficarem "loading" para
    // sempre.
    useProductCompositionMock.mockReturnValue({
      status: 'success',
      accessories: [],
      packaging: [],
      isLoading: false,
      error: null,
      retry: compositionRetryMock,
      save: vi.fn(),
    })
    useAccessoriesMock.mockReturnValue({ accessories: [], isLoading: false, error: null, refetch: accessoriesRefetchMock })
    usePackagingMock.mockReturnValue({ packaging: [], isLoading: false, error: null, refetch: packagingRefetchMock })

    // Categorias (múltiplas por Produto, migration 20260829180000, ainda
    // não aplicada) — padrão vazio e bem-sucedido.
    useProductCategoriesMock.mockReturnValue({
      status: 'success',
      categories: [],
      isLoading: false,
      error: null,
      retry: vi.fn(),
    })
    // Plates (mesma migration — weight_grams direto, sem filamento) —
    // padrão vazio e bem-sucedido.
    useProductPlatesMock.mockReturnValue({
      status: 'success',
      plates: [],
      isLoading: false,
      error: null,
      retry: vi.fn(),
    })
  })

  it('renders a loading skeleton while the product is loading', () => {
    useProductMock.mockReturnValue({ status: 'loading', product: null, error: null, retry: retryMock })
    renderPage()

    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('shows an inline error with a retry action when loading fails', async () => {
    useProductMock.mockReturnValue({
      status: 'error',
      product: null,
      error: new ApiError('database', 500, 'Falha ao carregar produto.'),
      retry: retryMock,
    })
    renderPage()

    expect(screen.getByText('Falha ao carregar produto.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(retryMock).toHaveBeenCalled()
  })

  it('shows a "não encontrado" message with a link back to the listing', () => {
    useProductMock.mockReturnValue({ status: 'not_found', product: null, error: null, retry: retryMock })
    renderPage()

    expect(screen.getByText('Produto não encontrado.')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: /produtos/i })
    expect(links.some((link) => link.getAttribute('href') === '/produtos')).toBe(true)
  })

  it('always renders a link back to the product listing', () => {
    useProductMock.mockReturnValue({ status: 'loading', product: null, error: null, retry: retryMock })
    renderPage()

    expect(screen.getByRole('link', { name: /voltar para produtos/i })).toHaveAttribute('href', '/produtos')
  })

  describe('produto carregado com sucesso', () => {
    beforeEach(() => {
      useProductMock.mockReturnValue({ status: 'success', product, error: null, retry: retryMock })
    })

    it('renderiza o produto correto: nome, categorias, descrição, preço em Real e situação', () => {
      useProductCategoriesMock.mockReturnValue({
        status: 'success',
        categories: [{ id: 'pc1', product_id: 'p1', category: 'Decoração', position: 1, created_at: '' }],
        isLoading: false,
        error: null,
        retry: vi.fn(),
      })
      renderPage()

      expect(screen.getAllByText('Chaveiro Gatinho').length).toBeGreaterThan(0)
      expect(screen.getByText('Decoração')).toBeInTheDocument()
      expect(screen.getByText('Chaveiro em formato de gato')).toBeInTheDocument()
      expect(screen.getByText(/R\$\s*25,50/)).toBeInTheDocument()
      expect(screen.getByText('Sim')).toBeInTheDocument()
      expect(screen.getAllByText('Ativo').length).toBeGreaterThan(0)
    })

    it('múltiplas categorias vinculadas são exibidas juntas, separadas por vírgula', () => {
      useProductCategoriesMock.mockReturnValue({
        status: 'success',
        categories: [
          { id: 'pc1', product_id: 'p1', category: 'Decoração', position: 1, created_at: '' },
          { id: 'pc2', product_id: 'p1', category: 'Pet', position: 2, created_at: '' },
        ],
        isLoading: false,
        error: null,
        retry: vi.fn(),
      })
      renderPage()

      expect(screen.getByText('Decoração, Pet')).toBeInTheDocument()
    })

    it('renderiza "Peso total (g)" e "Tempo de Produção" formatado como HH:MM:SS, sem as nomenclaturas antigas', () => {
      renderPage()

      expect(screen.getByText('Peso total (g)')).toBeInTheDocument()
      expect(screen.getByText('45 g')).toBeInTheDocument()
      expect(screen.getByText('Tempo de Produção')).toBeInTheDocument()
      expect(screen.getByText('02:10:00')).toBeInTheDocument()
      expect(screen.queryByText('Peso total do produto')).not.toBeInTheDocument()
      expect(screen.queryByText('Tempo total de impressão')).not.toBeInTheDocument()
    })

    it('ordem visual na seção Produção: "Peso total (g)" antes de "Tempo de Produção"', () => {
      renderPage()

      const labels = screen.getAllByText(/^(Peso total \(g\)|Tempo de Produção)$/)
      expect(labels.map((label) => label.textContent)).toEqual(['Peso total (g)', 'Tempo de Produção'])
    })

    it('não exibe mais "Unidades por plate", "Peso do plate" nem nenhuma estimativa por unidade', () => {
      renderPage()

      expect(screen.queryByText(/unidades por pla/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/tempo de impressão do plate/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/estimado por unidade/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/\(estimado\)/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/plate completo/i)).not.toBeInTheDocument()
    })

    it('produto legado convertido (antes em minutos) continua exibindo o tempo equivalente em HH:MM:SS', () => {
      // product.default_print_time_seconds = 7800 simula exatamente um
      // produto legado de 130 minutos já convertido pela migration
      // (130 * 60 = 7800) — 7800s = 02:10:00, mesmo tempo "real" de antes.
      renderPage()

      expect(screen.getByText('02:10:00')).toBeInTheDocument()
    })

    it('tempo de impressão zero (00:00:00) é exibido, não confundido com "Não informado"', () => {
      useProductMock.mockReturnValue({
        status: 'success',
        product: { ...product, default_print_time_seconds: 0 },
        error: null,
        retry: retryMock,
      })
      renderPage()

      expect(screen.getByText('00:00:00')).toBeInTheDocument()
    })

    it('produto inativo mostra o indicador "Inativo"', () => {
      useProductMock.mockReturnValue({
        status: 'success',
        product: { ...product, is_active: false },
        error: null,
        retry: retryMock,
      })
      renderPage()

      expect(screen.getAllByText('Inativo').length).toBeGreaterThan(0)
    })
  })

  describe('campos nulos/ausentes', () => {
    const productWithNulls = {
      ...product,
      category: null,
      description: null,
      default_weight_grams: null,
      product_type: 'CATALOG',
      default_print_time_seconds: null,
      units_per_plate: null,
    }

    it('categorias vazias e descrição nula mostram "Não informada"', () => {
      useProductMock.mockReturnValue({ status: 'success', product: productWithNulls, error: null, retry: retryMock })
      renderPage()

      const naoInformada = screen.getAllByText('Não informada')
      expect(naoInformada.length).toBe(2)
    })

    it('peso e tempo nulos mostram "Não informado" (somente os 2 campos que restaram em Produção)', () => {
      useProductMock.mockReturnValue({ status: 'success', product: productWithNulls, error: null, retry: retryMock })
      renderPage()

      const naoInformado = screen.getAllByText('Não informado')
      expect(naoInformado.length).toBe(2)
    })
  })

  describe('Acessórios e Embalagens (Incremento 2)', () => {
    beforeEach(() => {
      useProductMock.mockReturnValue({ status: 'success', product, error: null, retry: retryMock })
    })

    it('composição vazia mostra as mensagens de "nenhum item vinculado"', () => {
      renderPage()

      expect(screen.getByText('Nenhum acessório vinculado.')).toBeInTheDocument()
      expect(screen.getByText('Nenhuma embalagem vinculada.')).toBeInTheDocument()
    })

    it('acessório com custo: nome, situação, quantidade, custo unitário e subtotal corretos', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [{ id: 'pa1', product_id: 'p1', accessory_id: 'a1', quantity: 3, created_at: '' }],
        packaging: [],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      useAccessoriesMock.mockReturnValue({
        accessories: [accessoryWithCost],
        isLoading: false,
        error: null,
        refetch: accessoriesRefetchMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /ímã 6x2/i })
      expect(within(row).getByText('Ativo')).toBeInTheDocument()
      expect(within(row).getByText('3')).toBeInTheDocument()
      expect(within(row).getByText(/R\$\s*1,50/)).toBeInTheDocument()
      expect(within(row).getByText(/R\$\s*4,50/)).toBeInTheDocument()
    })

    it('acessório inativo continua visível, com situação "Inativo"', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [{ id: 'pa2', product_id: 'p1', accessory_id: 'a2', quantity: 1, created_at: '' }],
        packaging: [],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      useAccessoriesMock.mockReturnValue({
        accessories: [inactiveAccessory],
        isLoading: false,
        error: null,
        refetch: accessoriesRefetchMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /parafuso m3/i })
      expect(within(row).getByText('Inativo')).toBeInTheDocument()
    })

    it('acessório com custo unitário nulo mostra "Não informado" e subtotal "Não calculável" (nunca 0)', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [{ id: 'pa3', product_id: 'p1', accessory_id: 'a3', quantity: 2, created_at: '' }],
        packaging: [],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      useAccessoriesMock.mockReturnValue({
        accessories: [accessoryWithoutCost],
        isLoading: false,
        error: null,
        refetch: accessoriesRefetchMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /led/i })
      expect(within(row).getByText('Não informado')).toBeInTheDocument()
      expect(within(row).getByText('Não calculável')).toBeInTheDocument()
    })

    it('accessory_id referenciado que não existe no catálogo: "Item não encontrado", quantidade preservada, situação "Indisponível"', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [{ id: 'pa4', product_id: 'p1', accessory_id: 'ghost', quantity: 9, created_at: '' }],
        packaging: [],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      useAccessoriesMock.mockReturnValue({ accessories: [], isLoading: false, error: null, refetch: accessoriesRefetchMock })
      renderPage()

      const row = screen.getByRole('row', { name: /item não encontrado/i })
      expect(within(row).getByText('Indisponível')).toBeInTheDocument()
      expect(within(row).getByText('9')).toBeInTheDocument()
      expect(within(row).getByText('Não informado')).toBeInTheDocument()
      expect(within(row).getByText('Não calculável')).toBeInTheDocument()
    })

    it('embalagem com custo: nome, situação, quantidade, custo unitário e subtotal corretos', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [],
        packaging: [{ id: 'pk1', product_id: 'p1', packaging_id: 'k1', quantity: 2, created_at: '' }],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      usePackagingMock.mockReturnValue({
        packaging: [packagingWithCost],
        isLoading: false,
        error: null,
        refetch: packagingRefetchMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /caixa m/i })
      expect(within(row).getByText('Ativo')).toBeInTheDocument()
      expect(within(row).getByText('2')).toBeInTheDocument()
      expect(within(row).getByText(/R\$\s*3,00/)).toBeInTheDocument()
      expect(within(row).getByText(/R\$\s*6,00/)).toBeInTheDocument()
    })

    it('embalagem inativa continua visível, com situação "Inativo"', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [],
        packaging: [{ id: 'pk2', product_id: 'p1', packaging_id: 'k2', quantity: 1, created_at: '' }],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      usePackagingMock.mockReturnValue({
        packaging: [inactivePackaging],
        isLoading: false,
        error: null,
        refetch: packagingRefetchMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /ziplock pp/i })
      expect(within(row).getByText('Inativo')).toBeInTheDocument()
    })

    it('embalagem com custo unitário nulo mostra "Não informado" e subtotal "Não calculável" (nunca 0)', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [],
        packaging: [{ id: 'pk3', product_id: 'p1', packaging_id: 'k3', quantity: 1, created_at: '' }],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      usePackagingMock.mockReturnValue({
        packaging: [packagingWithoutCost],
        isLoading: false,
        error: null,
        refetch: packagingRefetchMock,
      })
      renderPage()

      const row = screen.getByRole('row', { name: /sacola kraft/i })
      expect(within(row).getByText('Não informado')).toBeInTheDocument()
      expect(within(row).getByText('Não calculável')).toBeInTheDocument()
    })

    it('packaging_id referenciado que não existe no catálogo: "Item não encontrado", quantidade preservada, situação "Indisponível"', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [],
        packaging: [{ id: 'pk4', product_id: 'p1', packaging_id: 'ghost-pkg', quantity: 6, created_at: '' }],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      usePackagingMock.mockReturnValue({ packaging: [], isLoading: false, error: null, refetch: packagingRefetchMock })
      renderPage()

      const row = screen.getByRole('row', { name: /item não encontrado/i })
      expect(within(row).getByText('Indisponível')).toBeInTheDocument()
      expect(within(row).getByText('6')).toBeInTheDocument()
    })
  })

  describe('Subtotal de componentes', () => {
    beforeEach(() => {
      useProductMock.mockReturnValue({ status: 'success', product, error: null, retry: retryMock })
    })

    it('A. todos os custos informados: soma acessórios + embalagens, sem badge parcial nem aviso', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [{ id: 'pa1', product_id: 'p1', accessory_id: 'a1', quantity: 2, created_at: '' }],
        packaging: [{ id: 'pk1', product_id: 'p1', packaging_id: 'k1', quantity: 1, created_at: '' }],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      useAccessoriesMock.mockReturnValue({
        accessories: [accessoryWithCost],
        isLoading: false,
        error: null,
        refetch: accessoriesRefetchMock,
      })
      usePackagingMock.mockReturnValue({
        packaging: [packagingWithCost],
        isLoading: false,
        error: null,
        refetch: packagingRefetchMock,
      })
      renderPage()

      // 2 × R$1,50 (acessório) + 1 × R$3,00 (embalagem) = R$6,00
      expect(screen.getByText(/R\$\s*6,00/)).toBeInTheDocument()
      expect(screen.queryByText('Subtotal parcial')).not.toBeInTheDocument()
      expect(screen.queryByText(/Existem componentes sem custo informado/)).not.toBeInTheDocument()
    })

    it('B. parte dos componentes com custo: valor parcial, badge "Subtotal parcial" e aviso de dados incompletos', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [
          { id: 'pa1', product_id: 'p1', accessory_id: 'a1', quantity: 2, created_at: '' },
          { id: 'pa3', product_id: 'p1', accessory_id: 'a3', quantity: 1, created_at: '' },
        ],
        packaging: [],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      useAccessoriesMock.mockReturnValue({
        accessories: [accessoryWithCost, accessoryWithoutCost],
        isLoading: false,
        error: null,
        refetch: accessoriesRefetchMock,
      })
      renderPage()

      const subtotalCard = screen.getByText('Subtotal de componentes').closest('[data-slot="card"]') as HTMLElement
      expect(within(subtotalCard).getByText(/R\$\s*3,00/)).toBeInTheDocument()
      expect(within(subtotalCard).getByText('Subtotal parcial')).toBeInTheDocument()
      expect(
        screen.getByText('Existem componentes sem custo informado. Eles não foram incluídos neste subtotal.'),
      ).toBeInTheDocument()
    })

    it('C. nenhum componente com custo informado: "Não calculável" com aviso de dados incompletos', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [{ id: 'pa3', product_id: 'p1', accessory_id: 'a3', quantity: 1, created_at: '' }],
        packaging: [],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      useAccessoriesMock.mockReturnValue({
        accessories: [accessoryWithoutCost],
        isLoading: false,
        error: null,
        refetch: accessoriesRefetchMock,
      })
      renderPage()

      const subtotalCard = screen.getByText('Subtotal de componentes').closest('[data-slot="card"]') as HTMLElement
      expect(within(subtotalCard).getByText('Não calculável')).toBeInTheDocument()
      expect(
        screen.getByText('Existem componentes sem custo informado. Eles não foram incluídos neste subtotal.'),
      ).toBeInTheDocument()
    })

    it('D. sem acessórios nem embalagens: R$ 0,00 e mensagem específica de composição vazia', () => {
      renderPage()

      expect(screen.getByText(/R\$\s*0,00/)).toBeInTheDocument()
      expect(screen.getByText('Este produto não possui acessórios ou embalagens vinculados.')).toBeInTheDocument()
    })

    it('sempre mostra a observação permanente de que o valor não inclui material/energia/máquina/perdas/MDO', () => {
      renderPage()

      expect(
        screen.getByText(
          'Este valor considera somente acessórios e embalagens. Material, energia, máquina, perdas e mão de obra ainda não estão incluídos.',
        ),
      ).toBeInTheDocument()
    })

    it('nunca usa os termos "custo total", "margem", "lucro" ou "rentabilidade"', () => {
      renderPage()

      const bodyText = document.body.textContent ?? ''
      expect(bodyText).not.toMatch(/custo total/i)
      expect(bodyText).not.toMatch(/margem/i)
      expect(bodyText).not.toMatch(/lucro/i)
      expect(bodyText).not.toMatch(/rentabilidade/i)
    })
  })

  describe('estados de carregamento e erro dos componentes', () => {
    beforeEach(() => {
      useProductMock.mockReturnValue({ status: 'success', product, error: null, retry: retryMock })
    })

    it('mostra skeleton enquanto a composição está carregando, sem esconder Identificação/Produção', () => {
      useProductCompositionMock.mockReturnValue({
        status: 'loading',
        accessories: [],
        packaging: [],
        isLoading: true,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      renderPage()

      expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
      expect(screen.getByText('Identificação')).toBeInTheDocument()
      expect(screen.getByText('Produção')).toBeInTheDocument()
    })

    it('erro ao carregar a composição fica restrito à área de componentes, sem esconder Identificação/Produção', async () => {
      useProductCompositionMock.mockReturnValue({
        status: 'error',
        accessories: [],
        packaging: [],
        isLoading: false,
        error: new ApiError('database', 500, 'Falha ao carregar composição.'),
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      renderPage()

      expect(screen.getByText('Identificação')).toBeInTheDocument()
      expect(screen.getByText('Produção')).toBeInTheDocument()
      expect(screen.getByText('Falha ao carregar composição.')).toBeInTheDocument()

      await userEvent.setup().click(screen.getByRole('button', { name: /tentar novamente/i }))
      expect(compositionRetryMock).toHaveBeenCalled()
      expect(retryMock).not.toHaveBeenCalled()
    })

    it('erro ao carregar acessórios fica restrito à área de componentes, com retry próprio', async () => {
      useAccessoriesMock.mockReturnValue({
        accessories: [],
        isLoading: false,
        error: new ApiError('database', 500, 'Falha ao carregar acessórios.'),
        refetch: accessoriesRefetchMock,
      })
      renderPage()

      expect(screen.getByText('Identificação')).toBeInTheDocument()
      expect(screen.getByText('Falha ao carregar acessórios.')).toBeInTheDocument()

      await userEvent.setup().click(screen.getByRole('button', { name: /tentar novamente/i }))
      expect(accessoriesRefetchMock).toHaveBeenCalled()
    })

    it('erro ao carregar embalagens fica restrito à área de componentes, com retry próprio', async () => {
      usePackagingMock.mockReturnValue({
        packaging: [],
        isLoading: false,
        error: new ApiError('database', 500, 'Falha ao carregar embalagens.'),
        refetch: packagingRefetchMock,
      })
      renderPage()

      expect(screen.getByText('Falha ao carregar embalagens.')).toBeInTheDocument()

      await userEvent.setup().click(screen.getByRole('button', { name: /tentar novamente/i }))
      expect(packagingRefetchMock).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Plates (migration 20260829180000_add_categories_plate_weight_and_order_colors.sql,
  // ainda não aplicada) — substitui o antigo bloco "Filamentos": o Produto
  // não tem mais composição de filamento própria, cada plate mostra só seu
  // peso (weight_grams direto) e tempo de produção. Bloco inteiramente
  // independente do de Acessórios/Embalagens (própria fonte/carregamento/
  // erro/retry; nenhuma alteração no Subtotal de componentes).
  // ---------------------------------------------------------------------------

  describe('Plates', () => {
    beforeEach(() => {
      useProductMock.mockReturnValue({ status: 'success', product, error: null, retry: retryMock })
    })

    it('exibe um plate com peso e tempo de produção diretos, sem nenhuma coluna de filamento', () => {
      useProductPlatesMock.mockReturnValue({
        status: 'success',
        plates: [
          { id: 'pp1', product_id: 'p1', plate_number: 1, production_time_seconds: 3600, weight_grams: 40, created_at: '', updated_at: '' },
        ],
        isLoading: false,
        error: null,
        retry: vi.fn(),
      })
      renderPage()

      const row = screen.getByText('Plate 1').closest('tr')
      if (!row) throw new Error('linha da tabela de Plates não encontrada')
      expect(within(row).getByText('40,00 g')).toBeInTheDocument()
      expect(within(row).getByText('01:00:00')).toBeInTheDocument()
      expect(screen.queryByText(/filamento/i)).not.toBeInTheDocument()
    })

    it('mostra um card por plate na ordem correta com múltiplos plates', () => {
      useProductPlatesMock.mockReturnValue({
        status: 'success',
        plates: [
          { id: 'pp1', product_id: 'p1', plate_number: 1, production_time_seconds: 3600, weight_grams: 40, created_at: '', updated_at: '' },
          { id: 'pp2', product_id: 'p1', plate_number: 2, production_time_seconds: 1800, weight_grams: 10, created_at: '', updated_at: '' },
        ],
        isLoading: false,
        error: null,
        retry: vi.fn(),
      })
      renderPage()

      expect(screen.getByText('Plate 1')).toBeInTheDocument()
      expect(screen.getByText('Plate 2')).toBeInTheDocument()
      expect(screen.getByText('40,00 g')).toBeInTheDocument()
      expect(screen.getByText('10,00 g')).toBeInTheDocument()
    })

    it('mostra "Nenhum plate cadastrado." quando a composição está genuinamente vazia', () => {
      renderPage()

      expect(screen.getByText('Nenhum plate cadastrado.')).toBeInTheDocument()
    })

    it('erro ao carregar os plates fica restrito ao bloco de Plates, com retry próprio', async () => {
      const platesRetryMock = vi.fn()
      useProductPlatesMock.mockReturnValue({
        status: 'error',
        plates: [],
        isLoading: false,
        error: new ApiError('database', 500, 'Falha ao carregar plates.'),
        retry: platesRetryMock,
      })
      renderPage()

      expect(screen.getByText('Identificação')).toBeInTheDocument()
      expect(screen.getByText('Falha ao carregar plates.')).toBeInTheDocument()

      await userEvent.setup().click(screen.getByRole('button', { name: /tentar novamente/i }))
      expect(platesRetryMock).toHaveBeenCalled()
    })

    it('não altera o Subtotal de componentes (continua só Acessórios/Embalagens)', () => {
      useAccessoriesMock.mockReturnValue({
        accessories: [accessoryWithCost],
        isLoading: false,
        error: null,
        refetch: accessoriesRefetchMock,
      })
      useProductCompositionMock.mockReturnValue({
        status: 'success',
        accessories: [{ accessory_id: 'a1', quantity: 2 }],
        packaging: [],
        isLoading: false,
        error: null,
        retry: compositionRetryMock,
        save: vi.fn(),
      })
      useProductPlatesMock.mockReturnValue({
        status: 'success',
        plates: [
          { id: 'pp1', product_id: 'p1', plate_number: 1, production_time_seconds: 3600, weight_grams: 40, created_at: '', updated_at: '' },
        ],
        isLoading: false,
        error: null,
        retry: vi.fn(),
      })
      renderPage()

      // Subtotal = 2 × R$1,50 = R$3,00 — exatamente como seria sem nenhum
      // plate cadastrado; plate nunca soma no subtotal (sem custo, fora de
      // escopo desta rodada).
      expect(screen.getAllByText(/R\$\s*3,00/).length).toBeGreaterThan(0)
    })
  })
})
