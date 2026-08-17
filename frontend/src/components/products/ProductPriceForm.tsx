import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { parseNumberField } from '@/lib/forms/numberField'
import type { UpdateProductPriceInput } from '@/lib/api/products'

interface ProductPriceFormProps {
  currentPrice: number
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: UpdateProductPriceInput) => void
  onCancel: () => void
}

export function ProductPriceForm({
  currentPrice,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: ProductPriceFormProps) {
  const [newPrice, setNewPrice] = useState('')
  const [reason, setReason] = useState('')
  const [priceError, setPriceError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const price = parseNumberField(newPrice, 'O novo preço', { required: true, min: 0 })
    if (price.error) {
      setPriceError(price.error)
      return
    }
    setPriceError(null)

    onSubmit({
      new_price: price.value as number,
      reason: reason.trim() ? reason.trim() : null,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <p className="text-muted-foreground text-sm">
        Preço atual: {currentPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-new-price">Novo preço</Label>
        <Input
          id="product-new-price"
          inputMode="decimal"
          value={newPrice}
          onChange={(event) => setNewPrice(event.target.value)}
        />
        {priceError && <p className="text-destructive text-sm">{priceError}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-price-reason">Motivo (opcional)</Label>
        <Textarea id="product-price-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}
