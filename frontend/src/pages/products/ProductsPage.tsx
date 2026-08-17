import { useState } from 'react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProductCompositionForm } from '@/components/products/ProductCompositionForm'
import { ProductForm } from '@/components/products/ProductForm'
import { ProductPriceForm } from '@/components/products/ProductPriceForm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
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
  const { products, isLoading, error, refetch, create, changePrice } = useProducts()
  const { accessories } = useAccessories()
  const { packaging } = usePackaging()

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

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
        <Button onClick={openCreateDialog}>Novo produto</Button>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Preço</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>{product.name}</TableCell>
                  <TableCell>{product.category ?? '—'}</TableCell>
                  <TableCell>{formatPrice(product.default_price)}</TableCell>
                  <TableCell>{product.is_active ? 'Sim' : 'Não'}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openPriceDialog(product)}>
                        Alterar preço
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openCompositionDialog(product)}>
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
