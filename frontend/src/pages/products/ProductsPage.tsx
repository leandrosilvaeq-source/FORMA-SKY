import { useState } from 'react'
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
import type { UpdateProductCompositionInput } from '@/lib/api/productComposition'
import type { CreateProductInput, UpdateProductPriceInput } from '@/lib/api/products'
import type { Product } from '@/types/domain'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

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
      toast.success('Composição atualizada.')
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
          <Table className="table-fixed text-[16px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-auto w-[30%] py-2 whitespace-normal">Nome</TableHead>
                <TableHead className="h-auto w-[20%] py-2 whitespace-normal">Categoria</TableHead>
                <TableHead className="h-auto w-[15%] py-2 whitespace-normal">Preço</TableHead>
                <TableHead className="h-auto w-[10%] py-2 whitespace-normal">Ativo</TableHead>
                <TableHead className="h-auto w-[25%] py-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow
                  key={product.id}
                  // Mesmo zebra striping com a paleta Forma já aprovado em
                  // Clientes — ver frontend/src/pages/customers/CustomersPage.tsx.
                  className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft"
                >
                  <TableCell className="truncate" title={product.name}>
                    {product.name}
                  </TableCell>
                  <TableCell className="truncate" title={product.category ?? undefined}>
                    {product.category ?? '—'}
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
                        Composição
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar preço</DialogTitle>
            <DialogDescription>
              {priceDialogProduct ? `Novo preço para "${priceDialogProduct.name}".` : ''}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Composição padrão</DialogTitle>
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
