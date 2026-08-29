import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { SortableColumnHeader } from '@/components/dataTable/SortableColumnHeader'
import { sortByColumn, type SortState } from '@/components/dataTable/sorting'
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete'
import { ProductCompositionForm } from '@/components/products/ProductCompositionForm'
import { FilamentCompositionForm } from '@/components/products/FilamentCompositionForm'
import { ProductForm, type ProductFormSubmitValues } from '@/components/products/ProductForm'
import { ProductEditDetailsForm } from '@/components/products/ProductEditDetailsForm'
import { ProductPriceForm } from '@/components/products/ProductPriceForm'
import { ProductPriceHistoryList } from '@/components/products/ProductPriceHistoryList'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAccessories } from '@/hooks/useAccessories'
import { useFilamentTypes } from '@/hooks/useFilamentTypes'
import { usePackaging } from '@/hooks/usePackaging'
import { useProductComposition } from '@/hooks/useProductComposition'
import { useProductFilaments } from '@/hooks/useProductFilaments'
import { useProductPriceHistory } from '@/hooks/useProductPriceHistory'
import { useProducts } from '@/hooks/useProducts'
import { ApiError } from '@/lib/api/errors'
import { formatSecondsToHHMMSS } from '@/lib/forms/durationField'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import type { UpdateProductCompositionInput } from '@/lib/api/productComposition'
import type { UpdateProductFilamentsInput } from '@/lib/api/productFilaments'
import type { UpdateProductDetailsInput, UpdateProductPriceInput } from '@/lib/api/products'
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

// Ordenação: Tipo/Categoria comparam pelo texto exibido ao usuário (nunca o
// valor bruto de product_type); Tempo/Peso comparam o valor numérico em
// segundos/gramas (nunca o texto já formatado em HH:MM:SS/"NNN g", que
// ordenaria como texto e não numericamente); Preço é sempre um número
// presente (products.default_price nunca é null no contrato).
type ProductSortColumn = 'name' | 'product_type' | 'category' | 'print_time' | 'weight' | 'price' | 'is_active'

function getProductSortValue(product: Product, column: ProductSortColumn): string | number | boolean | null {
  switch (column) {
    case 'name':
      return product.name
    case 'product_type':
      return PRODUCT_TYPE_LABELS[product.product_type]
    case 'category':
      return product.category
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
  const { products, isLoading, error, refetch, createWithPlates, changePrice, update, updateDetails } = useProducts()
  const { accessories } = useAccessories()
  const { packaging } = usePackaging()

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sort, setSort] = useState<SortState<ProductSortColumn> | null>(null)

  // "Editar produto" (substitui o antigo botão "Alterar preço") — três
  // seções independentes no mesmo diálogo: Dados do produto (update_product,
  // NOVA), Preço (ProductPriceForm/update_product_price, inalterado) e
  // Histórico de preços (somente leitura, useProductPriceHistory, NOVO).
  // Cada seção tem seu próprio estado de submitting/erro — nunca a mesma
  // chamada/transação entre elas, mesmo idioma já usado por Filamentos vs.
  // Acessórios/Embalagens no diálogo de composição.
  const [editDialogProduct, setEditDialogProduct] = useState<Product | null>(null)
  const [isSubmittingDetails, setIsSubmittingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [isSubmittingPrice, setIsSubmittingPrice] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)
  const priceHistory = useProductPriceHistory(editDialogProduct?.id ?? null)

  const [compositionDialogProduct, setCompositionDialogProduct] = useState<Product | null>(null)
  const [isSubmittingComposition, setIsSubmittingComposition] = useState(false)
  const [compositionError, setCompositionError] = useState<string | null>(null)
  const composition = useProductComposition(compositionDialogProduct?.id ?? null)

  // Filamentos (Módulo 3, Incremento 6A) — estado próprio, independente do
  // de Acessórios/Embalagens acima: salvamento separado e atômico (nunca
  // reaproveita isSubmittingComposition/compositionError). filamentTypesHook
  // só é usado para preencher as opções do Select desta seção — nenhuma
  // relação com useAccessories/usePackaging já existentes.
  const [isSubmittingFilaments, setIsSubmittingFilaments] = useState(false)
  const [filamentsError, setFilamentsError] = useState<string | null>(null)
  const filamentComposition = useProductFilaments(compositionDialogProduct?.id ?? null)
  const filamentTypesHook = useFilamentTypes()

  // Busca: só pelo nome (product.name), local sobre `products` já
  // carregados — nenhuma nova chamada a useProducts/API a cada tecla
  // digitada.
  const filteredProducts = useMemo(() => {
    const term = normalizeForSearch(searchTerm)
    if (!term) return products
    return products.filter((product) => normalizeForSearch(product.name).includes(term))
  }, [products, searchTerm])

  // Ordenação aplicada DEPOIS do filtro de busca (filtra primeiro, ordena o
  // resultado filtrado em seguida). Nunca muta `products` (o array vindo
  // do hook) — sortByColumn sempre retorna uma cópia nova.
  const sortedProducts = useMemo(
    () => sortByColumn(filteredProducts, sort, getProductSortValue),
    [filteredProducts, sort],
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
    setDetailsError(null)
    setPriceError(null)
    setEditDialogProduct(product)
  }

  function openCompositionDialog(product: Product) {
    setCompositionError(null)
    setFilamentsError(null)
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
        category: values.category,
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

  // Independente de handlePriceSubmit acima: chama updateDetails
  // (Edge Function -> update_product, RPC própria) — nunca a mesma
  // chamada/transação de Preço. Uma falha aqui nunca desfaz nem impede um
  // salvamento de Preço já concluído (ou vice-versa).
  async function handleDetailsSubmit(values: UpdateProductDetailsInput) {
    if (!editDialogProduct) return
    setIsSubmittingDetails(true)
    setDetailsError(null)
    try {
      await updateDetails(editDialogProduct.id, values)
      toast.success('Dados do produto atualizados.')
      setEditDialogProduct(null)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setDetailsError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmittingDetails(false)
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

  // Independente de handleCompositionSubmit acima: chama
  // filamentComposition.save (Edge Function -> set_product_filaments, RPC
  // própria) — nunca a mesma chamada/transação de Acessórios/Embalagens.
  // Uma falha aqui nunca desfaz nem impede um salvamento de
  // Acessórios/Embalagens já concluído (ou vice-versa) — são duas operações
  // atômicas independentes, cada uma numa única transação Postgres própria.
  async function handleFilamentsSubmit(values: UpdateProductFilamentsInput) {
    setIsSubmittingFilaments(true)
    setFilamentsError(null)
    try {
      await filamentComposition.save(values)
      toast.success('Filamentos atualizados.')
      setCompositionDialogProduct(null)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setFilamentsError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmittingFilaments(false)
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
        A listagem reúne todos os produtos de Catálogo e os produtos reutilizáveis. Produtos SPOT criados somente
        dentro de um pedido não aparecem aqui; um SPOT aparece quando é cadastrado como produto reutilizável.
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
          <p className="text-muted-foreground text-sm">Nenhum produto encontrado para esta busca.</p>
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
                  return (
                    <TableRow
                      key={product.id}
                      // Mesmo zebra striping com a paleta Forma já aprovado em
                      // Clientes — ver frontend/src/pages/customers/CustomersPage.tsx.
                      // Baseado na posição renderizada (nth-child via
                      // odd:/even:), então já reflete a ordem visual atual
                      // (busca + ordenação) sem nenhum cálculo extra.
                      className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft"
                    >
                      <TableCell className="truncate" title={product.name}>
                        <Link to={`/produtos/${product.id}`} className={PRODUCT_NAME_LINK_CLASSNAME}>
                          {product.name}
                        </Link>
                      </TableCell>
                      <TableCell className="truncate">{PRODUCT_TYPE_LABELS[product.product_type]}</TableCell>
                      <TableCell className="truncate" title={product.category ?? undefined}>
                        {product.category ?? '—'}
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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo produto</DialogTitle>
            <DialogDescription>Preencha os dados para cadastrar um produto de Catálogo.</DialogDescription>
          </DialogHeader>
          <ProductForm
            filamentTypes={filamentTypesHook.types}
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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar produto</DialogTitle>
            <DialogDescription>
              {editDialogProduct ? (
                <>
                  Dados, preço e histórico de <span className="text-foreground font-medium">"{editDialogProduct.name}"</span>.
                </>
              ) : (
                ''
              )}
            </DialogDescription>
          </DialogHeader>
          {editDialogProduct && (
            <ProductEditDetailsForm
              key={editDialogProduct.id}
              product={editDialogProduct}
              isSubmitting={isSubmittingDetails}
              submitError={detailsError}
              onSubmit={(values) => void handleDetailsSubmit(values)}
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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Acessórios e Embalagem</DialogTitle>
            <DialogDescription>
              {compositionDialogProduct ? `Acessórios e embalagens de "${compositionDialogProduct.name}".` : ''}
            </DialogDescription>
          </DialogHeader>
          {compositionDialogProduct && (composition.status === 'idle' || composition.status === 'loading') && (
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

          {/* Filamentos (Módulo 3, Incremento 6A) — seção própria dentro do
              mesmo diálogo "Composição do Produto", mas com carregamento,
              erro e salvamento inteiramente independentes da seção de
              Acessórios/Embalagens acima (nunca a mesma requisição, nunca o
              mesmo estado de submitting/erro). */}
          <div className="border-border mt-2 flex flex-col gap-3 border-t pt-4">
            {compositionDialogProduct &&
              (filamentComposition.status === 'idle' ||
                filamentComposition.status === 'loading' ||
                filamentTypesHook.isLoading) && (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              )}
            {compositionDialogProduct &&
              !filamentTypesHook.isLoading &&
              filamentComposition.status !== 'loading' &&
              filamentComposition.status !== 'idle' &&
              filamentTypesHook.error && (
                <div className="border-destructive/50 bg-destructive/10 flex items-center justify-between rounded-lg border p-3 text-sm">
                  <span>{toErrorMessage(filamentTypesHook.error)}</span>
                  <Button variant="outline" size="sm" onClick={filamentTypesHook.refetch}>
                    Tentar novamente
                  </Button>
                </div>
              )}
            {compositionDialogProduct && filamentComposition.status === 'error' && (
              <div className="border-destructive/50 bg-destructive/10 flex items-center justify-between rounded-lg border p-3 text-sm">
                <span>{toErrorMessage(filamentComposition.error)}</span>
                <Button variant="outline" size="sm" onClick={filamentComposition.retry}>
                  Tentar novamente
                </Button>
              </div>
            )}
            {compositionDialogProduct &&
              !filamentTypesHook.isLoading &&
              !filamentTypesHook.error &&
              filamentComposition.status === 'success' && (
                <FilamentCompositionForm
                  key={compositionDialogProduct.id}
                  filamentTypes={filamentTypesHook.types}
                  initialFilaments={filamentComposition.filaments}
                  isSubmitting={isSubmittingFilaments}
                  submitError={filamentsError}
                  onSubmit={(values) => void handleFilamentsSubmit(values)}
                />
              )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
