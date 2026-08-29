import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  filamentRowsFrom,
  filamentTypeLabel,
  filterSelectableFilamentTypes,
  findFilamentTypeById,
  hasInactiveFilamentSelection,
  isFilamentRowInactive,
  nextFilamentRowKey,
  validateFilamentRows,
  type FilamentCompositionRow,
} from '@/lib/forms/productFilamentComposition'
import type { UpdateProductFilamentsInput } from '@/lib/api/productFilaments'
import type { FilamentTypeSummary, ProductFilament } from '@/types/domain'

// Módulo 3, Incremento 6A — seção "Filamentos" da composição do produto.
// Deliberadamente um componente NOVO e independente de
// ProductCompositionForm.tsx (Acessórios/Embalagens, NUNCA alterado por
// este incremento): salvamento separado e atômico — este formulário tem seu
// próprio botão "Salvar filamentos", nunca reaproveita nem interfere no
// submit de Acessórios/Embalagens. As duas seções vivem no mesmo diálogo
// "Composição do Produto" (ProductsPage.tsx), mas cada uma é uma <form>
// própria com seu próprio ciclo de vida de erro/submitting.

const SELECT_TRIGGER_CLASSNAME = 'focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-full min-w-0'
const WEIGHT_INPUT_CLASSNAME = 'w-32 shrink-0 focus-visible:border-brand-primary focus-visible:ring-brand-accent/50'
const REMOVE_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0'
const ADD_BUTTON_CLASSNAME =
  'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark'
const INACTIVE_TYPE_MESSAGE = 'Este tipo de filamento está inativo. Remova-o da composição para poder salvar.'
const BLOCKED_BY_INACTIVE_MESSAGE = 'Remova os tipos de filamento inativos da composição antes de salvar.'

interface FilamentCompositionFormProps {
  filamentTypes: FilamentTypeSummary[]
  initialFilaments: ProductFilament[]
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: UpdateProductFilamentsInput) => void
}

export function FilamentCompositionForm({
  filamentTypes,
  initialFilaments,
  isSubmitting,
  submitError,
  onSubmit,
}: FilamentCompositionFormProps) {
  const [rows, setRows] = useState<FilamentCompositionRow[]>(() => filamentRowsFrom(initialFilaments))
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)

  // Bloqueia o salvamento inteiro enquanto QUALQUER linha apontar para um
  // tipo hoje inativo — set_product_filaments rejeita a composição inteira
  // nesse caso; barramos aqui antes de tentar, com mensagem clara em vez do
  // erro cru do banco. O tipo nunca é removido automaticamente: só some da
  // tela quando o próprio usuário clica em Remover — requisito explícito
  // "preservar tipos inativos já vinculados".
  const hasInactiveType = hasInactiveFilamentSelection(rows, filamentTypes)

  function addRow() {
    setRows((current) => [...current, { key: nextFilamentRowKey(), filamentTypeId: null, weight: '' }])
  }

  function removeRow(key: string) {
    setBlockedMessage(null)
    setRows((current) => current.filter((row) => row.key !== key))
  }

  function updateRow(key: string, patch: Partial<FilamentCompositionRow>) {
    setBlockedMessage(null)
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  // "Cancelar" aqui nunca fecha o diálogo (essa seção não é dona dele) —
  // só descarta edições locais não salvas, voltando ao último estado salvo.
  function resetRows() {
    setRowErrors({})
    setBlockedMessage(null)
    setRows(filamentRowsFrom(initialFilaments))
  }

  function selectableFilamentTypes(currentFilamentTypeId: string | null) {
    const chosen = new Set(rows.map((row) => row.filamentTypeId).filter((id): id is string => id !== null))
    return filterSelectableFilamentTypes(filamentTypes, chosen, currentFilamentTypeId)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (hasInactiveType) {
      setBlockedMessage(BLOCKED_BY_INACTIVE_MESSAGE)
      return
    }

    const result = validateFilamentRows(rows)
    if (Object.keys(result.errors).length > 0) {
      setRowErrors(result.errors)
      return
    }
    setRowErrors({})
    setBlockedMessage(null)

    onSubmit({ filaments: result.items })
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <div className="flex items-center justify-between">
        <Label>Filamentos</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={isSubmitting}
          className={ADD_BUTTON_CLASSNAME}
        >
          Adicionar filamento
        </Button>
      </div>

      {rows.length === 0 && <p className="text-muted-foreground text-sm">Nenhum filamento na composição.</p>}

      {rows.map((row, index) => {
        const options = selectableFilamentTypes(row.filamentTypeId).map((type) => ({
          label: filamentTypeLabel(type),
          value: type.filament_type_id as string | null,
        }))
        const selectedType = findFilamentTypeById(filamentTypes, row.filamentTypeId)
        const inactive = isFilamentRowInactive(row, filamentTypes)
        const removeLabel = selectedType
          ? `Remover ${filamentTypeLabel(selectedType)}`
          : `Remover filamento (linha ${index + 1})`

        return (
          <div key={row.key} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Select
                items={options}
                value={row.filamentTypeId}
                disabled={isSubmitting}
                onValueChange={(value) => updateRow(row.key, { filamentTypeId: value })}
              >
                <SelectTrigger
                  aria-label="Tipo de filamento"
                  title={selectedType ? filamentTypeLabel(selectedType) : undefined}
                  className={SELECT_TRIGGER_CLASSNAME}
                >
                  <SelectValue placeholder="Selecione um tipo de filamento" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((item) => (
                    <SelectItem key={item.value ?? 'none'} value={item.value} title={item.label} className="truncate">
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Peso teórico por unidade (g)"
                inputMode="decimal"
                placeholder="Peso (g)"
                value={row.weight}
                disabled={isSubmitting}
                onChange={(event) => updateRow(row.key, { weight: event.target.value })}
                className={WEIGHT_INPUT_CLASSNAME}
              />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => removeRow(row.key)}
                disabled={isSubmitting}
                aria-label={removeLabel}
                className={REMOVE_BUTTON_CLASSNAME}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            {inactive && <p className="text-destructive text-sm">{INACTIVE_TYPE_MESSAGE}</p>}
            {!inactive && rowErrors[row.key] && <p className="text-destructive text-sm">{rowErrors[row.key]}</p>}
          </div>
        )
      })}

      {blockedMessage && <p className="text-destructive text-sm">{blockedMessage}</p>}
      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={resetRows}
          disabled={isSubmitting}
          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
        >
          Desfazer alterações
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting || hasInactiveType}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
        >
          {isSubmitting ? 'Salvando...' : 'Salvar filamentos'}
        </Button>
      </div>
    </form>
  )
}
