import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { parseNumberField } from '@/lib/forms/numberField'
import type { CreateProductInput } from '@/lib/api/products'

interface ProductFormProps {
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: CreateProductInput) => void
  onCancel: () => void
}

export function ProductForm({ isSubmitting, submitError, onSubmit, onCancel }: ProductFormProps) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [defaultPrice, setDefaultPrice] = useState('')
  const [printTimeMinutes, setPrintTimeMinutes] = useState('')
  const [weightGrams, setWeightGrams] = useState('')
  const [unitsPerPlate, setUnitsPerPlate] = useState('')
  const [allowsPersonalization, setAllowsPersonalization] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    const trimmedName = name.trim()
    if (!trimmedName) errors.name = 'Informe o nome do produto.'

    const price = parseNumberField(defaultPrice, 'O preço', { required: true, min: 0 })
    if (price.error) errors.default_price = price.error

    const printTime = parseNumberField(printTimeMinutes, 'O tempo de impressão', { min: 0, integer: true })
    if (printTime.error) errors.default_print_time_minutes = printTime.error

    const weight = parseNumberField(weightGrams, 'O peso', { min: 0 })
    if (weight.error) errors.default_weight_grams = weight.error

    const units = parseNumberField(unitsPerPlate, 'As unidades por placa', { min: 1, integer: true })
    if (units.error) errors.units_per_plate = units.error

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    onSubmit({
      name: trimmedName,
      default_price: price.value as number,
      category: category.trim() ? category.trim() : null,
      description: description.trim() ? description.trim() : null,
      default_print_time_minutes: printTime.value ?? null,
      default_weight_grams: weight.value ?? null,
      units_per_plate: units.value ?? null,
      allows_personalization: allowsPersonalization,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="product-name">Nome</Label>
        <Input id="product-name" value={name} onChange={(event) => setName(event.target.value)} />
        {fieldErrors.name && <p className="text-destructive text-sm">{fieldErrors.name}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-category">Categoria</Label>
        <Input id="product-category" value={category} onChange={(event) => setCategory(event.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-description">Descrição</Label>
        <Textarea
          id="product-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-price">Preço</Label>
        <Input
          id="product-price"
          inputMode="decimal"
          value={defaultPrice}
          onChange={(event) => setDefaultPrice(event.target.value)}
        />
        {fieldErrors.default_price && <p className="text-destructive text-sm">{fieldErrors.default_price}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-print-time">Tempo de impressão (min)</Label>
        <Input
          id="product-print-time"
          inputMode="numeric"
          value={printTimeMinutes}
          onChange={(event) => setPrintTimeMinutes(event.target.value)}
        />
        {fieldErrors.default_print_time_minutes && (
          <p className="text-destructive text-sm">{fieldErrors.default_print_time_minutes}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-weight">Peso (g)</Label>
        <Input
          id="product-weight"
          inputMode="decimal"
          value={weightGrams}
          onChange={(event) => setWeightGrams(event.target.value)}
        />
        {fieldErrors.default_weight_grams && (
          <p className="text-destructive text-sm">{fieldErrors.default_weight_grams}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-units-per-plate">Unidades por placa</Label>
        <Input
          id="product-units-per-plate"
          inputMode="numeric"
          value={unitsPerPlate}
          onChange={(event) => setUnitsPerPlate(event.target.value)}
        />
        {fieldErrors.units_per_plate && <p className="text-destructive text-sm">{fieldErrors.units_per_plate}</p>}
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="product-allows-personalization">Permite personalização</Label>
        <Switch
          id="product-allows-personalization"
          checked={allowsPersonalization}
          onCheckedChange={(checked) => setAllowsPersonalization(checked)}
        />
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
