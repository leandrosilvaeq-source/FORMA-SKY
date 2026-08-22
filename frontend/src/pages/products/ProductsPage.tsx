import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProductCompositionForm } from '@/components/products/ProductCompositionForm'
import { ProductForm } from '@/components/products/ProductForm'
import { ProductPriceForm } from '@/components/products/ProductPriceForm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAccessories } from '@/hooks/useAccessories'
import { usePackaging } from '@/hooks/usePackaging'
import { useProductComposition } from '@/hooks/useProductComposition'
import { useProducts } from '@/hooks/useProducts'
import { ApiError } from '@/lib/api/errors'
import { formatSecondsToHHMMSS } from '@/lib/forms/durationField'
import type { UpdateProductCompositionInput } from '@/lib/api/productComposition'
import type { CreateProductInput, UpdateProductPriceInput } from '@/lib/api/products'
import type { Product, ProductType } from '@/types/domain'

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

export function ProductsPage() {
  const { products, isLoading, error, refetch, create, changePrice, update } = useProducts()
  const { accessories } = useAccessories()
  const { packaging } = usePackaging()

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)

  const [priceDialogProduct, setPriceDialogProduct] = useState<Product | null>(null)
  const [isSubmittingPrice, setIsSubmittingPrice] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)

  const [compositionDialogProduct, setCompositionDialogProduct] = useState<Product | null>(null)
  const [isSubmittingComposition, setIsSubmittingComposition] = useState(false)
  const [compositionError, setCompositionError] = useState<string | null>(null)
  const composition = useProductComposition(compositionDialogProduct?.id ?? null)

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

  function openPriceDialog(product: Product) {
    setPriceError(null)
    setPriceDialogProduct(product)
  }

  function openCompositionDialog(product: Product) {
    setCompositionError(null)
    setCompositionDialogProduct(product)
  }

  async function handleCreateSubmit(values: CreateProductInput) {
    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      await create(values)
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
    if (!priceDialogProduct) return
    setIsSubmittingPrice(true)
    setPriceError(null)
    try {
      await changePrice(priceDialogProduct.id, values)
      toast.success('Preço atualizado.')
      setPriceDialogProduct(null)
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

      <div className="mt-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : products.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum produto cadastrado.</p>
        ) : (
          // 8 colunas: overflow-x-auto + min-w garante rolagem horizontal
          // controlada só em telas estreitas (mesmo padrão já aprovado em
          // Pedidos/Empresas) — nenhuma coluna cortada em desktop amplo.
          <div className="overflow-x-auto">
            <Table className="min-w-[1200px] table-fixed text-[16px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-auto w-[19%] py-2 whitespace-normal">Nome</TableHead>
                  <TableHead className="h-auto w-[10%] py-2 whitespace-normal">Tipo</TableHead>
                  <TableHead className="h-auto w-[14%] py-2 whitespace-normal">Categoria</TableHead>
                  <TableHead className="h-auto w-[12%] py-2 whitespace-normal">Tempo total de impressão</TableHead>
                  <TableHead className="h-auto w-[9%] py-2 whitespace-normal">Peso total</TableHead>
                  <TableHead className="h-auto w-[10%] py-2 whitespace-normal">Preço</TableHead>
                  <TableHead className="h-auto w-[8%] py-2 whitespace-normal">Ativo</TableHead>
                  <TableHead className="h-auto w-[18%] py-2" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => {
                  const printTimeText = formatPrintTime(product.default_print_time_seconds)
                  const weightText = formatWeight(product.default_weight_grams)
                  return (
                    <TableRow
                      key={product.id}
                      // Mesmo zebra striping com a paleta Forma já aprovado em
                      // Clientes — ver frontend/src/pages/customers/CustomersPage.tsx.
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
                            onClick={() => openPriceDialog(product)}
                            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                          >
                            Alterar preço
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo produto</DialogTitle>
            <DialogDescription>Preencha os dados para cadastrar um produto de Catálogo.</DialogDescription>
          </DialogHeader>
          <ProductForm
            isSubmitting={isSubmittingCreate}
            submitError={createError}
            onSubmit={(values) => void handleCreateSubmit(values)}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={priceDialogProduct !== null}
        onOpenChange={(open) => {
          if (!open) setPriceDialogProduct(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar preço</DialogTitle>
            <DialogDescription>
              {priceDialogProduct ? (
                <>
                  Novo preço para <span className="text-foreground font-medium">"{priceDialogProduct.name}"</span>.
                </>
              ) : (
                ''
              )}
            </DialogDescription>
          </DialogHeader>
          {priceDialogProduct && (
            <ProductPriceForm
              key={priceDialogProduct.id}
              currentPrice={priceDialogProduct.default_price}
              isSubmitting={isSubmittingPrice}
              submitError={priceError}
              onSubmit={(values) => void handlePriceSubmit(values)}
              onCancel={() => setPriceDialogProduct(null)}
            />
          )}
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
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
