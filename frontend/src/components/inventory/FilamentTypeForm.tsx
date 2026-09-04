import { useState, type FormEvent } from 'react'
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { parseNumberField } from '@/lib/forms/numberField'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import { cn } from '@/lib/utils'
import type { FilamentMaterial } from '@/types/domain'

// Materiais aceitos nesta etapa do MVP — ABS explicitamente fora do escopo
// aprovado (supabase/migrations/20260827100000_create_filament_types_table.sql).
const MATERIAL_OPTIONS: FilamentMaterial[] = ['PLA', 'PETG', 'TPU']

// Opções oficiais de Linha (2026-09-04: passou a ser só action buttons, sem
// campo de texto livre nem opção de digitar uma linha personalizada) —
// ainda assim nunca um enum travado no BANCO (filament_types.line continua
// texto livre, sem CHECK): um registro histórico com uma linha fora desta
// lista nunca é apagado/convertido em silêncio (ver historicalLine abaixo).
// "Tricolor" acrescentada em 2026-09-04 (ajustes finais de Filamentos) —
// enviada e preservada com exatamente essa grafia, mesmo tratamento das
// demais opções.
const LINE_OPTIONS = ['Sólida', 'Silk', 'Matte', 'Velvet', 'Translúcido', 'DuoColor', 'Tricolor']

// Fabricante saiu da janela "Novo tipo de filamento" (decisão revisada do
// usuário, 2026-09-01): no modo CREATE o formulário não exibe nem exige o
// campo. Como filament_types.manufacturer é NOT NULL no schema atual (e
// alterar isso está fora de escopo: nenhuma migration/RPC/Edge Function),
// a criação envia internamente este valor. O modo EDIT continua com o
// campo, para consultar/corrigir tipos históricos e os criados por Compras
// (que podem ter um fabricante real informado na compra).
export const UNSPECIFIED_MANUFACTURER = 'Não informado'

// color_code (código da cor do fabricante) foi removido da interface nesta
// rodada (pedido explícito: "remover da interface a necessidade de
// informar código da cor/filamento") — nunca exigido para cadastrar/editar
// um tipo. A coluna continua existindo no banco (filament_types.color_code,
// nullable, já era opcional antes desta decisão) para preservar
// compatibilidade com registros antigos que já tenham um valor — este
// formulário simplesmente nunca envia essa chave, então create/update
// nunca a tocam (PATCH sem a chave preserva o valor atual; create sem a
// chave grava null, mesmo comportamento de antes para um cadastro sem
// código informado). O identificador interno automático do rolo
// (filament_spools.code, formato RL-YY-NNN) é outra coisa — gerado pelo
// backend, nunca digitado, e não é afetado por esta remoção.
export interface FilamentTypeFormValues {
  material: FilamentMaterial
  manufacturer: string
  line: string
  commercial_color: string
  minimum_stock_grams: number | null
  notes: string | null
}

export interface FilamentTypeFormInitialValues {
  material: FilamentMaterial
  manufacturer: string
  line: string
  commercial_color: string
  minimum_stock_grams: number | null
  notes: string | null
}

interface FilamentTypeFormProps {
  idPrefix: string
  mode?: 'create' | 'edit'
  initialValues?: FilamentTypeFormInitialValues
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: FilamentTypeFormValues) => void
  onCancel: () => void
  // Cores já cadastradas em outros tipos (2026-09-04, sugestões do campo
  // Cor) — já deduplicadas/canonicalizadas pelo chamador
  // (distinctFilamentColors, mesma regra de dedupe da listagem consolidada).
  // Opcional: um chamador que ainda não carregou tipo nenhum passa a lista
  // vazia (nenhuma sugestão, campo continua um texto livre normal).
  existingColors?: string[]
}

export function FilamentTypeForm({
  idPrefix,
  mode = 'create',
  initialValues,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
  existingColors = [],
}: FilamentTypeFormProps) {
  const [material, setMaterial] = useState<FilamentMaterial | null>(initialValues?.material ?? null)
  const [manufacturer, setManufacturer] = useState(initialValues?.manufacturer ?? '')
  const [line, setLine] = useState<string | null>(initialValues?.line ?? null)
  const [commercialColor, setCommercialColor] = useState(initialValues?.commercial_color ?? '')

  // Valor histórico de Linha que não está entre as opções oficiais (registro
  // criado antes desta mudança, ou digitado livremente quando o campo ainda
  // era texto livre): nunca alterado automaticamente. Aparece como mais uma
  // opção selecionável (já selecionada) na abertura do formulário, para o
  // usuário poder ver o valor real e, se quiser, substituí-lo por uma opção
  // oficial — nunca é apagado ou convertido em silêncio.
  const historicalLine =
    initialValues?.line && !LINE_OPTIONS.includes(initialValues.line) ? initialValues.line : null
  const lineOptions = historicalLine ? [...LINE_OPTIONS, historicalLine] : LINE_OPTIONS

  // Sugestões de Cor (2026-09-04) — filtradas pelo texto já digitado, caixa/
  // acento-insensível (mesma normalizeForSearch usada em todo o projeto).
  // SearchAutocomplete não filtra sozinho (só decide COMO exibir/navegar a
  // lista já filtrada) — o filtro é feito aqui, sem nenhuma requisição nova
  // (existingColors já veio pronto do chamador).
  const normalizedColorTerm = normalizeForSearch(commercialColor)
  const colorSuggestions = (
    normalizedColorTerm
      ? existingColors.filter((color) => normalizeForSearch(color).includes(normalizedColorTerm))
      : existingColors
  ).map((color) => ({ id: color, label: color }))
  const [minimumStockGrams, setMinimumStockGrams] = useState(
    initialValues?.minimum_stock_grams != null ? String(initialValues.minimum_stock_grams) : '',
  )
  const [notes, setNotes] = useState(initialValues?.notes ?? '')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const isEditMode = mode === 'edit'

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const errors: Record<string, string> = {}

    if (!material) errors.material = 'Selecione o material.'

    // Fabricante só é editável/exigido no modo EDIT. No modo CREATE o campo
    // nem aparece e o valor enviado é UNSPECIFIED_MANUFACTURER.
    const trimmedManufacturer = manufacturer.trim()
    if (isEditMode && !trimmedManufacturer) errors.manufacturer = 'Informe o fabricante.'

    if (!line) errors.line = 'Selecione a linha.'

    const trimmedColor = commercialColor.trim()
    if (!trimmedColor) errors.commercial_color = 'Informe a cor.'

    const minimumStockResult = parseNumberField(minimumStockGrams, 'o peso mínimo de alerta', {
      min: 0,
    })
    if (minimumStockResult.error) errors.minimum_stock_grams = minimumStockResult.error

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    onSubmit({
      material: material as FilamentMaterial,
      manufacturer: isEditMode ? trimmedManufacturer : UNSPECIFIED_MANUFACTURER,
      line: line as string,
      commercial_color: trimmedColor,
      minimum_stock_grams: minimumStockResult.value ?? null,
      notes: notes.trim() ? notes.trim() : null,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label>Material</Label>
        <div role="radiogroup" aria-label="Material" className="flex flex-wrap gap-2">
          {MATERIAL_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={material === option}
              disabled={isSubmitting}
              onClick={() => {
                setMaterial(option)
                setFieldErrors((current) => ({ ...current, material: '' }))
              }}
              className={cn(
                'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                material === option
                  ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        {fieldErrors.material && <p className="text-destructive text-sm">{fieldErrors.material}</p>}
      </div>

      {/* Fabricante: só no modo EDIT (ver UNSPECIFIED_MANUFACTURER). */}
      {isEditMode && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-manufacturer`}>Fabricante</Label>
          <Input
            id={`${idPrefix}-manufacturer`}
            value={manufacturer}
            onChange={(event) => {
              setManufacturer(event.target.value)
              setFieldErrors((current) => ({ ...current, manufacturer: '' }))
            }}
            disabled={isSubmitting}
            aria-invalid={fieldErrors.manufacturer ? true : undefined}
            className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
          />
          {fieldErrors.manufacturer && (
            <p className="text-destructive text-sm">{fieldErrors.manufacturer}</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label>Linha</Label>
        <div role="radiogroup" aria-label="Linha" className="flex flex-wrap gap-2">
          {lineOptions.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={line === option}
              disabled={isSubmitting}
              onClick={() => {
                setLine(option)
                setFieldErrors((current) => ({ ...current, line: '' }))
              }}
              className={cn(
                'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                line === option
                  ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        {fieldErrors.line && <p className="text-destructive text-sm">{fieldErrors.line}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-commercial-color`}>Cor</Label>
        <SearchAutocomplete
          value={commercialColor}
          onValueChange={(value) => {
            setCommercialColor(value)
            setFieldErrors((current) => ({ ...current, commercial_color: '' }))
          }}
          suggestions={colorSuggestions}
          onSelect={(label) => {
            setCommercialColor(label)
            setFieldErrors((current) => ({ ...current, commercial_color: '' }))
          }}
          ariaLabel="Cor"
          placeholder="Ex.: Preto"
          clearLabel="Limpar cor"
          listboxId={`${idPrefix}-commercial-color-listbox`}
          listboxAriaLabel="Cores já cadastradas"
          noResultsText="Nenhuma cor cadastrada com esse nome — continue digitando para cadastrar uma cor nova."
        />
        {fieldErrors.commercial_color && (
          <p className="text-destructive text-sm">{fieldErrors.commercial_color}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-minimum-stock-grams`}>Peso mínimo de alerta (g)</Label>
        <Input
          id={`${idPrefix}-minimum-stock-grams`}
          inputMode="decimal"
          value={minimumStockGrams}
          onChange={(event) => setMinimumStockGrams(event.target.value)}
          disabled={isSubmitting}
          aria-invalid={fieldErrors.minimum_stock_grams ? true : undefined}
          className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-32"
        />
        {fieldErrors.minimum_stock_grams && (
          <p className="text-destructive text-sm">{fieldErrors.minimum_stock_grams}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-notes`}>Observações (opcional)</Label>
        <Textarea
          id={`${idPrefix}-notes`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={isSubmitting}
        />
      </div>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
        >
          {isSubmitting ? 'Salvando...' : mode === 'edit' ? 'Salvar alterações' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}
