import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { SortableColumnHeader } from '@/components/dataTable/SortableColumnHeader'
import { sortByColumn, type SortState } from '@/components/dataTable/sorting'
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete'
import { ProductCompositionForm } from '@/components/products/ProductCompositionForm'
import {
  ProductForm,
  type ProductFormInitialValues,
  type ProductFormSubmitValues,
} from '@/components/products/ProductForm'
import { ProductPriceForm } from '@/components/products/ProductPriceForm'
import { ProductPriceHistoryList } from '@/components/products/ProductPriceHistoryList'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAccessories } from '@/hooks/useAccessories'
import { useAllProductCategories } from '@/hooks/useAllProductCategories'
import { usePackaging } from '@/hooks/usePackaging'
import { useProductCategories } from '@/hooks/useProductCategories'
import { useProductComposition } from '@/hooks/useProductComposition'
import { useProductPlates } from '@/hooks/useProductPlates'
import { useProductPriceHistory } from '@/hooks/useProductPriceHistory'
import { useProducts } from '@/hooks/useProducts'
import { ApiError } from '@/lib/api/errors'
import { formatSecondsToHHMMSS } from '@/lib/forms/durationField'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import { plateRowsFrom, plateRowsFromLegacyWeight } from '@/lib/forms/productPlates'
import type { UpdateProductCompositionInput } from '@/lib/api/productComposition'
import type { UpdateProductPriceInput } from '@/lib/api/products'
import type { Product, ProductType } from '@/types/domain'

const PRODUCT_SEARCH_LISTBOX_ID = 'product-search-listbox'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatPrintTime(seconds: number | null): string {
  return seconds !== null ? formatSecondsToHHMMSS(seconds) : 'Não informado'
}

function formatWeight(grams: number | null): string {
  return grams !== null ? `${grams.toLocaleString('pt-BR')} g` : 'Não informado'
}

// Só CATALOG está em uso real hoje — os rótulos de CUSTOM/SPOT já aparecem
// na listagem porque o Tipo passou a ser selecionável em "Novo produto",
// mesmo esses dois fluxos não estando habilitados em Pedidos ainda.
const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  CATALOG: 'Catálogo',
  CUSTOM: 'Personalizado',
  SPOT: 'SPOT',
}

const PRODUCT_NAME_LINK_CLASSNAME =
  'text-brand-primary hover:text-brand-primary-dark focus-visible:ring-brand-accent rounded outline-none hover:underline focus-visible:ring-2'

// Largura efetiva de Novo/Editar Produto (rodada corretiva 2026-08-30) — a
// causa real da janela "estreita" reportada na validação manual: o padrão
// de DialogContent (components/ui/dialog.tsx) já define `sm:max-w-sm`, e
// esse utilitário COM breakpoint sempre vence, no CSS gerado, um
// `max-w-[1400px]` SEM breakpoint (a camada `@media (min-width:640px)` do
// Tailwind é emitida depois da camada base, então empata em especificidade
// e ganha por ordem) — twMerge não resolve isso porque `max-w-[1400px]` e
// `sm:max-w-sm` são grupos DIFERENTES (base vs. variante sm:), então os
// dois sobreviviam no className final e o navegador sempre aplicava
// sm:max-w-sm (24rem) em qualquer viewport de desktop. Corrigido usando o
// MESMO breakpoint do padrão (`sm:max-w-[1600px]`) — aí sim twMerge
// reconhece o conflito (mesmo grupo, mesma variante) e descarta o
// `sm:max-w-sm` original. w-[96vw] (sem breakpoint) já sobrepõe w-full do
// padrão do mesmo jeito (mesmo grupo, sem variante). Mesma classe nos dois
// diálogos (Novo/Editar) — literalmente a mesma constante, nunca duas
// strings que podem divergir.
const PRODUCT_FORM_DIALOG_CLASSNAME = 'w-[96vw] sm:max-w-[1600px] max-h-[90vh] overflow-y-auto'

// Ordenação: Tipo/Categoria comparam pelo texto exibido ao usuário (nunca o
// valor bruto de product_type); Tempo/Peso comparam o valor numérico em
// segundos/gramas (nunca o texto já formatado em HH:MM:SS/"NNN g", que
// ordenaria como texto e não numericamente); Preço é sempre um número
// presente (products.default_price nunca é null no contrato).
type ProductSortColumn =
  'name' | 'product_type' | 'category' | 'print_time' | 'weight' | 'price' | 'is_active'

// Categoria: a partir da migration 20260829180000 (múltiplas categorias,
// ainda não aplicada) um Produto pode ter N categorias — a ordenação usa a
// junção ordenada alfabeticamente (nunca a ordem de inserção, que não seria
// determinística entre execuções) das categorias vinculadas, lidas de
// categoriesByProductId (useAllProductCategories) — nunca mais só
// product.category (espelho de position=1, insuficiente para representar
// todas as categorias na coluna).
function joinedCategoriesText(categories: string[]): string {
  return categories
    .slice()
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .join(', ')
}

function getProductSortValue(
  product: Product,
  column: ProductSortColumn,
  categoriesByProductId: Map<string, string[]>,
): string | number | boolean | null {
  switch (column) {
    case 'name':
      return product.name
    case 'product_type':
      return PRODUCT_TYPE_LABELS[product.product_type]
    case 'category':
      return joinedCategoriesText(categoriesByProductId.get(product.id) ?? [])
    case 'print_time':
      return product.default_print_time_seconds
    case 'weight':
      return product.default_weight_grams
    case 'price':
      return product.default_price
    case 'is_active':
      return product.is_active
  }
}

export function ProductsPage() {
  const { products, isLoading, error, refetch, createWithPlates, changePrice, update, updateFull } =
    useProducts()
  const { accessories } = useAccessories()
  const { packaging } = usePackaging()
  const allCategories = useAllProductCategories()

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sort, setSort] = useState<SortState<ProductSortColumn> | null>(null)

  // "Editar produto" — três seções independentes no mesmo diálogo: o
  // formulário completo por plates (ProductForm mode="edit" ->
  // update_product_full) e categorias (useProductCategories,
  // set_product_categories dentro da mesma RPC), Preço (ProductPriceForm/
  // update_product_price, inalterado — nunca enviado por update_product_full,
  // ver comentário em ProductForm.tsx) e Histórico de preços (somente
  // leitura, useProductPriceHistory). Cada seção tem seu próprio estado de
  // submitting/erro — nunca a mesma chamada/transação entre elas.
  //
  // Fonte autoritativa da composição de produção: product_plates
  // (weight_grams direto — migration 20260829180000, ainda não aplicada,
  // retirou toda composição de filamento do plate do Produto). Fallback
  // (plateRowsFromLegacyWeight) só cobre o caso de borda de um Produto sem
  // NENHUMA linha em product_plates ao carregar a edição — não deveria
  // acontecer após o backfill dessa migration (que cobre todo Produto
  // existente), mas evita abrir a edição com uma composição vazia e apagar
  // silenciosamente peso/tempo que só estavam em default_weight_grams/
  // default_print_time_seconds.
  const [editDialogProduct, setEditDialogProduct] = useState<Product | null>(null)
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const editPlates = useProductPlates(editDialogProduct?.id ?? null)
  const editCategories = useProductCategories(editDialogProduct?.id ?? null)
  const editComposition = useProductComposition(editDialogProduct?.id ?? null)
  const [isSubmittingPrice, setIsSubmittingPrice] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)
  const priceHistory = useProductPriceHistory(editDialogProduct?.id ?? null)

  const editDataLoading =
    editPlates.isLoading || editCategories.isLoading || editComposition.isLoading
  const editDataError =
    editPlates.status === 'error'
      ? editPlates.error
      : editCategories.status === 'error'
        ? editCategories.error
        : editComposition.status === 'error'
          ? editComposition.error
          : null

  function retryEditData() {
    editPlates.retry()
    editCategories.retry()
    editComposition.retry()
  }

  const editInitialValues: ProductFormInitialValues | null =
    editDialogProduct &&
    !editDataLoading &&
    !editDataError &&
    editPlates.status === 'success' &&
    editCategories.status === 'success' &&
    editComposition.status === 'success'
      ? {
          name: editDialogProduct.name,
          categories: editCategories.categories.map((item) => item.category),
          description: editDialogProduct.description,
          defaultPrice: editDialogProduct.default_price,
          allowsPersonalization: editDialogProduct.allows_personalization,
          productType: editDialogProduct.product_type,
          plates:
            editPlates.plates.length > 0
              ? plateRowsFrom(editPlates.plates)
              : plateRowsFromLegacyWeight(
                  editDialogProduct.default_weight_grams,
                  editDialogProduct.default_print_time_seconds,
                ),
          manualWeightOverrideGrams: editDialogProduct.production_weight_manual_override_grams,
          manualTimeOverrideSeconds: editDialogProduct.production_time_manual_override_seconds,
          accessories: editComposition.accessories.map((item) => ({
            id: item.accessory_id,
            quantity: item.quantity,
          })),
          packaging: editComposition.packaging.map((item) => ({
            id: item.packaging_id,
            quantity: item.quantity,
          })),
        }
      : null

  const [compositionDialogProduct, setCompositionDialogProduct] = useState<Product | null>(null)
  const [isSubmittingComposition, setIsSubmittingComposition] = useState(false)
  const [compositionError, setCompositionError] = useState<string | null>(null)
  const composition = useProductComposition(compositionDialogProduct?.id ?? null)

  // Busca: pelo nome (product.name) OU por QUALQUER categoria vinculada
  // (múltiplas por Produto, migration 20260829180000, ainda não aplicada) —
  // nunca só a categoria espelhada (position=1). Local sobre `products`/
  // `allCategories` já carregados — nenhuma nova chamada a API a cada tecla
  // digitada.
  const filteredProducts = useMemo(() => {
    const term = normalizeForSearch(searchTerm)
    if (!term) return products
    return products.filter((product) => {
      if (normalizeForSearch(product.name).includes(term)) return true
      const categories = allCategories.categoriesByProductId.get(product.id) ?? []
      return categories.some((category) => normalizeForSearch(category).includes(term))
    })
  }, [products, searchTerm, allCategories.categoriesByProductId])

  // Ordenação aplicada DEPOIS do filtro de busca (filtra primeiro, ordena o
  // resultado filtrado em seguida). Nunca muta `products` (o array vindo
  // do hook) — sortByColumn sempre retorna uma cópia nova.
  const sortedProducts = useMemo(
    () =>
      sortByColumn(filteredProducts, sort, (product, column) =>
        getProductSortValue(product, column, allCategories.categoriesByProductId),
      ),
    [filteredProducts, sort, allCategories.categoriesByProductId],
  )

  // Sugestões do autocomplete: mesma lista já filtrada+ordenada que a
  // tabela mostra (respeita a ordenação visual ativa), deduplicada por
  // product.id — nunca duas sugestões idênticas quando a mesma referência
  // aparece repetida no array vindo do hook.
  const suggestions = useMemo(() => {
    const seenIds = new Set<string>()
    const result: Array<{ id: string; label: string }> = []
    for (const product of sortedProducts) {
      if (seenIds.has(product.id)) continue
      seenIds.add(product.id)
      result.push({ id: product.id, label: product.name })
    }
    return result
  }, [sortedProducts])

  function openCreateDialog() {
    setCreateError(null)
    setIsCreateDialogOpen(true)
  }

  async function handleToggleActive(product: Product) {
    setPendingToggleId(product.id)
    try {
      await update(product.id, { is_active: !product.is_active })
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setPendingToggleId(null)
    }
  }

  function openEditDialog(product: Product) {
    setEditError(null)
    setPriceError(null)
    setEditDialogProduct(product)
  }

  function openCompositionDialog(product: Product) {
    setCompositionError(null)
    setCompositionDialogProduct(product)
  }

  // Estrutura produtiva por plates (2026-08-29): "Novo produto" passa a
  // sempre enviar plates/ajuste manual/Acessórios/Embalagens junto do
  // cadastro, numa única chamada atômica (create_product_with_plates) —
  // createProduct() "puro" (sem plates) não é mais chamado por aqui.
  async function handleCreateSubmit(values: ProductFormSubmitValues) {
    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      await createWithPlates({
        name: values.name,
        product_type: values.product_type,
        default_price: values.default_price,
        categories: values.categories,
        description: values.description,
        allows_personalization: values.allows_personalization,
        plates: values.plates,
        manual_weight_override_grams: values.manual_weight_override_grams,
        manual_time_override_seconds: values.manual_time_override_seconds,
        accessories: values.accessories,
        packaging: values.packaging,
      })
      toast.success('Produto cadastrado.')
      setIsCreateDialogOpen(false)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setCreateError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  async function handlePriceSubmit(values: UpdateProductPriceInput) {
    if (!editDialogProduct) return
    setIsSubmittingPrice(true)
    setPriceError(null)
    try {
      await changePrice(editDialogProduct.id, values)
      toast.success('Preço atualizado.')
      setEditDialogProduct(null)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setPriceError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmittingPrice(false)
    }
  }

  // Independente de handlePriceSubmit acima: chama updateFull (Edge
  // Function -> update_product_full, RPC atômica única para Dados
  // Gerais+Composição por plates+Acessórios/Embalagens) — nunca a mesma
  // chamada/transação de Preço. Uma falha aqui nunca desfaz nem impede um
  // salvamento de Preço já concluído (ou vice-versa). default_price/
  // product_type de values são deliberadamente omitidos do payload — não
  // fazem parte do contrato de UpdateProductFullInput (preço continua só
  // pela seção "Preço", tipo nunca é editável na edição).
  async function handleEditSubmit(values: ProductFormSubmitValues) {
    if (!editDialogProduct) return
    setIsSubmittingEdit(true)
    setEditError(null)
    try {
      await updateFull(editDialogProduct.id, {
        name: values.name,
        categories: values.categories,
        description: values.description,
        allows_personalization: values.allows_personalization,
        plates: values.plates,
        manual_weight_override_grams: values.manual_weight_override_grams,
        manual_time_override_seconds: values.manual_time_override_seconds,
        accessories: values.accessories,
        packaging: values.packaging,
      })
      toast.success('Produto atualizado.')
      setEditDialogProduct(null)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setEditError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmittingEdit(false)
    }
  }

  async function handleCompositionSubmit(values: UpdateProductCompositionInput) {
    setIsSubmittingComposition(true)
    setCompositionError(null)
    try {
      await composition.save(values)
      toast.success('Acessórios e embalagem atualizados.')
      setCompositionDialogProduct(null)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setCompositionError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmittingComposition(false)
    }
  }

  return (
    <AppLayout>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium">Produtos</h1>
        <Button
          onClick={openCreateDialog}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
        >
          Novo produto
        </Button>
      </div>

      {/* Regra confirmada (não é mais uma lacuna a preencher): o modelo já
          distingue SPOT reutilizável sem nenhum campo adicional —
          - registro em public.products = produto reutilizável (aparece
            aqui, qualquer que seja product_type: CATALOG, CUSTOM ou SPOT);
          - SPOT criado só dentro de um pedido vive exclusivamente em
            order_items (item_type='SPOT', product_id NULL) e nunca tem
            linha correspondente em products — por isso nunca aparece
            nesta listagem, sem precisar de nenhuma coluna is_reusable. */}
      <p className="text-muted-foreground mt-1 text-sm">
        A listagem reúne todos os produtos de Catálogo e os produtos reutilizáveis. Produtos SPOT
        criados somente dentro de um pedido não aparecem aqui; um SPOT aparece quando é cadastrado
        como produto reutilizável.
      </p>

      {error && (
        <div className="border-destructive/50 bg-destructive/10 mt-4 flex items-center justify-between rounded-lg border p-3 text-sm">
          <span>{toErrorMessage(error)}</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Tentar novamente
          </Button>
        </div>
      )}

      <SearchAutocomplete
        className="mt-4 max-w-xs"
        value={searchTerm}
        onValueChange={setSearchTerm}
        suggestions={suggestions}
        onSelect={setSearchTerm}
        ariaLabel="Buscar produto"
        placeholder="Buscar produto..."
        clearLabel="Limpar busca"
        listboxId={PRODUCT_SEARCH_LISTBOX_ID}
        listboxAriaLabel="Sugestões de produto"
        noResultsText="Nenhum produto encontrado."
      />

      <div className="mt-3">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : products.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum produto cadastrado.</p>
        ) : sortedProducts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum produto encontrado para esta busca.
          </p>
        ) : (
          // 8 colunas: overflow-x-auto + min-w garante rolagem horizontal
          // controlada só em telas estreitas (mesmo padrão já aprovado em
          // Pedidos/Empresas) — nenhuma coluna cortada em desktop amplo.
          <div className="overflow-x-auto">
            <Table className="min-w-[1200px] table-fixed text-[16px]">
              <TableHeader>
                <TableRow>
                  <SortableColumnHeader
                    column="name"
                    label="Produto"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[16%]"
                  />
                  <SortableColumnHeader
                    column="product_type"
                    label="Tipo"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[9%]"
                  />
                  <SortableColumnHeader
                    column="category"
                    label="Categoria"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[12%]"
                  />
                  <SortableColumnHeader
                    column="print_time"
                    label="Tempo de Produção"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[11%]"
                  />
                  <SortableColumnHeader
                    column="weight"
                    label="Peso total (g)"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[11%]"
                  />
                  <SortableColumnHeader
                    column="price"
                    label="Preço"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[9%]"
                  />
                  <SortableColumnHeader
                    column="is_active"
                    label="Ativo"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[8%]"
                  />
                  <TableHead className="h-auto w-[24%] py-2" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedProducts.map((product) => {
                  const printTimeText = formatPrintTime(product.default_print_time_seconds)
                  const weightText = formatWeight(product.default_weight_grams)
                  const categoriesText = joinedCategoriesText(
                    allCategories.categoriesByProductId.get(product.id) ?? [],
                  )
                  return (
                    <TableRow
                      key={product.id}
                      // Mesmo zebra striping com a paleta Forma já aprovado em
                      // Clientes — ver frontend/src/pages/customers/CustomersPage.tsx.
                      // Baseado na posição renderizada (nth-child via
                      // odd:/even:), então já reflete a ordem visual atual
                      // (busca + ordenação) sem nenhum cálculo extra.
                      className="odd:bg-brand-primary-soft/50 hover:bg-brand-primary-soft even:bg-white"
                    >
                      <TableCell className="truncate" title={product.name}>
                        <Link
                          to={`/produtos/${product.id}`}
                          className={PRODUCT_NAME_LINK_CLASSNAME}
                        >
                          {product.name}
                        </Link>
                      </TableCell>
                      <TableCell className="truncate">
                        {PRODUCT_TYPE_LABELS[product.product_type]}
                      </TableCell>
                      <TableCell className="truncate" title={categoriesText || undefined}>
                        {categoriesText || '—'}
                      </TableCell>
                      <TableCell className="truncate" title={printTimeText}>
                        {printTimeText}
                      </TableCell>
                      <TableCell className="truncate" title={weightText}>
                        {weightText}
                      </TableCell>
                      <TableCell>{formatPrice(product.default_price)}</TableCell>
                      <TableCell>
                        <Switch
                          checked={product.is_active}
                          disabled={pendingToggleId === product.id}
                          onCheckedChange={() => void handleToggleActive(product)}
                          aria-label={`${product.is_active ? 'Desativar' : 'Ativar'} ${product.name}`}
                          className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(product)}
                            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                          >
                            Editar produto
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openCompositionDialog(product)}
                            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                          >
                            Acessórios e Embalagem
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className={PRODUCT_FORM_DIALOG_CLASSNAME}>
          <DialogHeader>
            <DialogTitle>Novo produto</DialogTitle>
            <DialogDescription>
              Preencha os dados para cadastrar um produto de Catálogo.
            </DialogDescription>
          </DialogHeader>
          <ProductForm
            accessoriesList={accessories}
            packagingList={packaging}
            isSubmitting={isSubmittingCreate}
            submitError={createError}
            onSubmit={(values) => void handleCreateSubmit(values)}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={editDialogProduct !== null}
        onOpenChange={(open) => {
          if (!open) setEditDialogProduct(null)
        }}
      >
        <DialogContent className={PRODUCT_FORM_DIALOG_CLASSNAME}>
          <DialogHeader>
            <DialogTitle>Editar produto</DialogTitle>
            <DialogDescription>
              {editDialogProduct ? (
                <>
                  Dados, composição, preço e histórico de{' '}
                  <span className="text-foreground font-medium">"{editDialogProduct.name}"</span>.
                </>
              ) : (
                ''
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Formulário completo (Dados Gerais + Categorias + Composição por
              plates + Acessórios/Embalagens) — carrega plates/categorias/
              composição antes de montar o formulário: nunca abre vazio
              durante o carregamento (skeleton abaixo), nunca perde dado real
              de um Produto sem nenhum plate (fallback para
              plateRowsFromLegacyWeight). */}
          {editDialogProduct && editDataError && (
            <div className="border-destructive/50 bg-destructive/10 flex items-center justify-between rounded-lg border p-3 text-sm">
              <span>{toErrorMessage(editDataError)}</span>
              <Button variant="outline" size="sm" onClick={retryEditData}>
                Tentar novamente
              </Button>
            </div>
          )}
          {editDialogProduct && !editDataError && (editDataLoading || !editInitialValues) && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {editDialogProduct && !editDataError && editInitialValues && (
            <ProductForm
              key={editDialogProduct.id}
              mode="edit"
              initialValues={editInitialValues}
              accessoriesList={accessories}
              packagingList={packaging}
              isSubmitting={isSubmittingEdit}
              submitError={editError}
              onSubmit={(values) => void handleEditSubmit(values)}
              onCancel={() => setEditDialogProduct(null)}
            />
          )}

          {/* Preço — seção própria, independente de "Dados do produto"
              acima: ProductPriceForm inalterado (mesmo componente já usado
              antes, com Motivo/histórico preservados), nunca a mesma
              chamada/transação. */}
          <div className="border-border mt-2 flex flex-col gap-3 border-t pt-4">
            <h3 className="text-sm font-semibold">Preço</h3>
            {editDialogProduct && (
              <ProductPriceForm
                key={editDialogProduct.id}
                currentPrice={editDialogProduct.default_price}
                isSubmitting={isSubmittingPrice}
                submitError={priceError}
                onSubmit={(values) => void handlePriceSubmit(values)}
                onCancel={() => setEditDialogProduct(null)}
              />
            )}
          </div>

          {/* Histórico de preços — somente leitura, independente das duas
              seções acima. */}
          <div className="border-border mt-2 border-t pt-4">
            <ProductPriceHistoryList
              status={priceHistory.status}
              history={priceHistory.history}
              errorMessage={priceHistory.error ? toErrorMessage(priceHistory.error) : null}
              onRetry={priceHistory.retry}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={compositionDialogProduct !== null}
        onOpenChange={(open) => {
          if (!open) setCompositionDialogProduct(null)
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Acessórios e Embalagem</DialogTitle>
            <DialogDescription>
              {compositionDialogProduct
                ? `Acessórios e embalagens de "${compositionDialogProduct.name}".`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {compositionDialogProduct &&
            (composition.status === 'idle' || composition.status === 'loading') && (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}
          {compositionDialogProduct && composition.status === 'error' && (
            <div className="border-destructive/50 bg-destructive/10 flex items-center justify-between rounded-lg border p-3 text-sm">
              <span>{toErrorMessage(composition.error)}</span>
              <Button variant="outline" size="sm" onClick={composition.retry}>
                Tentar novamente
              </Button>
            </div>
          )}
          {compositionDialogProduct && composition.status === 'success' && (
            <ProductCompositionForm
              key={compositionDialogProduct.id}
              accessories={accessories}
              packaging={packaging}
              initialAccessories={composition.accessories}
              initialPackaging={composition.packaging}
              isSubmitting={isSubmittingComposition}
              submitError={compositionError}
              onSubmit={(values) => void handleCompositionSubmit(values)}
              onCancel={() => setCompositionDialogProduct(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
