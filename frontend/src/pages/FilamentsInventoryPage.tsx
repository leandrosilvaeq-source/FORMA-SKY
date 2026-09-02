import { useCallback, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FilterIcon } from 'lucide-react'
import { InventoryPageShell } from '@/components/inventory/InventoryPageShell'
import {
  FilamentTypeForm,
  type FilamentTypeFormValues,
} from '@/components/inventory/FilamentTypeForm'
import { FilamentTypeDrawer } from '@/components/inventory/FilamentTypeDrawer'
import { ResizableTableHead } from '@/components/dataTable/ResizableTableHead'
import { ColumnResizeHandle } from '@/components/dataTable/ColumnResizeHandle'
import { RestoreColumnWidthsButton } from '@/components/dataTable/RestoreColumnWidthsButton'
import {
  TABLE_COMPACT_ACTION_TEXT_CLASSNAME,
  TABLE_COMPACT_TEXT_CLASSNAME,
} from '@/components/dataTable/tableTypography'
import { StockLevelBadge, getStockLevel } from '@/components/inventory/StockMovementPanel'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { TableHead } from '@/components/ui/table'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useFilamentTypes } from '@/hooks/useFilamentTypes'
import { useFilamentSpoolCounts } from '@/hooks/useFilamentSpoolCounts'
import { usePersistentColumnWidths } from '@/hooks/usePersistentColumnWidths'
import { ApiError } from '@/lib/api/errors'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import {
  groupFilamentTypes,
  matchesFilamentGroupSearch,
  type FilamentGroup,
} from '@/lib/inventory/filamentGroups'
import {
  EMPTY_FILAMENT_GROUP_FILTERS,
  filamentFilterOptions,
  filamentGroupFilterCount,
  filterFilamentGroups,
  isFilamentSpoolRangeInvalid,
  type FilamentFilterOption,
  type FilamentGroupFilterState,
} from '@/lib/inventory/filamentGroupFilters'
import type { ColumnWidthSpec } from '@/lib/tables/columnWidths'
import { cn } from '@/lib/utils'
import type { FilamentTypeSummary } from '@/types/domain'

// Módulo 3 (Estoque) — listagem de Filamentos CONSOLIDADA por Material +
// Linha + Cor (2026-09-01). A coluna Fabricante saiu da listagem principal
// (tipos de fabricantes diferentes com o mesmo Material+Linha+Cor viram uma
// única linha) e o campo Fabricante também saiu da janela "Novo tipo de
// filamento" (decisão revisada do usuário) — a criação envia internamente
// manufacturer 'Não informado' (UNSPECIFIED_MANUFACTURER em
// FilamentTypeForm), já que filament_types.manufacturer é NOT NULL no
// schema atual. O fabricante continua íntegro no banco e é editável no
// modo "Editar tipo de filamento", nas compras, nos rolos, no histórico e
// nos detalhes de "Ver rolos". Nenhuma alteração de schema/migration/RPC/
// Edge Function/dado — só leitura via vw_filament_type_summary +
// agrupamento em JS.

const FILAMENTS_TABLE_ID = 'inventory-filaments'
// Sem a coluna 'manufacturer' e sem a coluna 'is_active' (Switch por tipo,
// ambíguo num grupo com vários tipos) — normalizeColumnWidths descarta as
// larguras persistidas dessas duas colunas removidas e preserva as demais,
// sem limpar nenhum outro item do localStorage. 'actions' agora só tem
// "Ver rolos", por isso é bem mais estreita que antes.
const FILAMENTS_COLUMN_SPECS: ColumnWidthSpec[] = [
  { id: 'material', defaultWidth: 110, minWidth: 80, maxWidth: 220 },
  { id: 'line', defaultWidth: 150, minWidth: 90, maxWidth: 320 },
  { id: 'color', defaultWidth: 150, minWidth: 90, maxWidth: 320 },
  { id: 'available', defaultWidth: 140, minWidth: 100, maxWidth: 260 },
  { id: 'spools', defaultWidth: 170, minWidth: 130, maxWidth: 280 },
  { id: 'situation', defaultWidth: 140, minWidth: 100, maxWidth: 250 },
  { id: 'actions', defaultWidth: 140, minWidth: 110, maxWidth: 240 },
]

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}g`
}

// Botão de filtro multisseleção (Material / Linha / Cor) — mesmo padrão
// visual do filtro de Produtos (Popover não-modal + checkboxes; OR dentro
// do grupo). IDs técnicos só de useId + índice, nunca o texto cru.
function MultiSelectFilterButton({
  label,
  ariaLabel,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string
  ariaLabel: string
  options: FilamentFilterOption[]
  selected: Set<string>
  onToggle: (value: string) => void
  onClear: () => void
}) {
  const idPrefix = useId()
  const count = selected.size
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'gap-1.5',
          count > 0 && 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark',
        )}
      >
        <FilterIcon />
        {count > 0 ? `${label} (${count})` : label}
      </PopoverTrigger>
      <PopoverContent aria-label={ariaLabel}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{label}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={count === 0}
              className="text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark h-7 px-2"
            >
              Limpar
            </Button>
          </div>
          {options.length === 0 ? (
            <p className="text-muted-foreground text-xs">Nenhuma opção disponível.</p>
          ) : (
            <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {options.map((option, index) => {
                const checkboxId = `${idPrefix}-opt-${index}`
                return (
                  <label
                    key={option.value}
                    htmlFor={checkboxId}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={selected.has(option.value)}
                      onCheckedChange={() => onToggle(option.value)}
                    />
                    <span className="truncate">{option.label}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function FilamentsInventoryPage() {
  const {
    types,
    isLoading,
    error,
    refetch,
    create,
    update,
    delete: deleteType,
  } = useFilamentTypes()
  const [searchTerm, setSearchTerm] = useState('')
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const columnWidths = usePersistentColumnWidths(FILAMENTS_TABLE_ID, userId, FILAMENTS_COLUMN_SPECS)

  // Contagem de ROLOS DISPONÍVEIS (saldo > 0) por tipo — uma consulta em
  // lote sobre filament_spools; NUNCA usable_spool_count da view (que não
  // exige saldo > 0). Enquanto carrega, a tabela espera; num erro, a coluna
  // mostra "—", o filtro de faixa fica desabilitado e um aviso de "tentar
  // novamente" aparece — nunca o número da view como fallback.
  const allTypeIds = useMemo(() => types.map((type) => type.filament_type_id), [types])
  const {
    countByTypeId,
    isLoading: countsLoading,
    error: countsError,
    refetch: refetchCounts,
  } = useFilamentSpoolCounts(allTypeIds)

  const refetchAll = useCallback(() => {
    refetch()
    refetchCounts()
  }, [refetch, refetchCounts])

  const [filters, setFilters] = useState<FilamentGroupFilterState>(EMPTY_FILAMENT_GROUP_FILTERS)
  const [minSpoolsInput, setMinSpoolsInput] = useState('')
  const [maxSpoolsInput, setMaxSpoolsInput] = useState('')

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [editingType, setEditingType] = useState<FilamentTypeSummary | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [togglingType, setTogglingType] = useState<FilamentTypeSummary | null>(null)
  const [isToggleDialogOpen, setIsToggleDialogOpen] = useState(false)
  const [isConfirmingToggle, setIsConfirmingToggle] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)

  const [deletingType, setDeletingType] = useState<FilamentTypeSummary | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // openGroupKey (não o grupo inteiro): o drawer precisa de um grupo VIVO —
  // derivado de `types` a cada render — para refletir um refetch disparado
  // de dentro dele e, principalmente, uma edição de tipo que mova o tipo
  // para outro grupo (o grupo atual pode encolher ou sumir).
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Na primeira carga da contagem (countByTypeId === null e ainda sem erro),
  // os grupos nascem com availableSpoolCount = null e a tabela espera. Num
  // erro, também é null (mostra "—"), nunca o número da view.
  const availableCountByTypeId = countsError ? null : countByTypeId
  const groups = useMemo(
    () => groupFilamentTypes(types, availableCountByTypeId),
    [types, availableCountByTypeId],
  )
  const filterOptions = useMemo(() => filamentFilterOptions(types), [types])
  const spoolRangeDisabled = countsError !== null

  const openGroup = useMemo(
    () => groups.find((group) => group.key === openGroupKey) ?? null,
    [groups, openGroupKey],
  )

  // O drawer só fica aberto enquanto o grupo existir. Se o último tipo do
  // grupo for editado para outro Material/Linha/Cor (ou excluído), openGroup
  // vira null e o diálogo fecha sozinho — sem efeito nem setState em render.
  // O grupo "permanece se houver outro tipo/fabricante" (openGroup segue não
  // nulo) e "desaparece se não houver nenhum tipo restante".
  const isDrawerVisible = isDrawerOpen && openGroup !== null

  function handleDrawerOpenChange(open: boolean) {
    setIsDrawerOpen(open)
    if (!open) setOpenGroupKey(null)
  }

  const rangeInvalid = isFilamentSpoolRangeInvalid(filters)

  const visibleGroups = useMemo(() => {
    const term = normalizeForSearch(searchTerm)
    return filterFilamentGroups(groups, filters).filter((group) =>
      matchesFilamentGroupSearch(group, term),
    )
  }, [groups, filters, searchTerm])

  const activeFilterCount = filamentGroupFilterCount(filters)

  function toggleFilterValue(kind: 'materials' | 'lines' | 'colors', value: string) {
    setFilters((current) => {
      const next = new Set(current[kind])
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return { ...current, [kind]: next }
    })
  }

  function clearFilterGroup(kind: 'materials' | 'lines' | 'colors') {
    setFilters((current) => ({ ...current, [kind]: new Set() }))
  }

  function commitSpoolRange(minRaw: string, maxRaw: string) {
    const parse = (raw: string): number | null => {
      const trimmed = raw.trim()
      if (trimmed === '') return null
      const value = Number(trimmed)
      if (!Number.isInteger(value) || value < 0) return null
      return value
    }
    setFilters((current) => ({ ...current, minSpools: parse(minRaw), maxSpools: parse(maxRaw) }))
  }

  function clearSpoolRange() {
    setMinSpoolsInput('')
    setMaxSpoolsInput('')
    setFilters((current) => ({ ...current, minSpools: null, maxSpools: null }))
  }

  function clearAllFilters() {
    setFilters(EMPTY_FILAMENT_GROUP_FILTERS)
    setMinSpoolsInput('')
    setMaxSpoolsInput('')
  }

  async function handleCreateSubmit(values: FilamentTypeFormValues) {
    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      await create(values)
      toast.success('Tipo de filamento cadastrado.')
      setIsCreateDialogOpen(false)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') setCreateError(message)
      else toast.error(message)
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  function openEditDialog(type: FilamentTypeSummary) {
    setEditingType(type)
    setEditError(null)
    setIsEditDialogOpen(true)
  }

  async function handleEditSubmit(values: FilamentTypeFormValues) {
    if (!editingType) return
    setIsSubmittingEdit(true)
    setEditError(null)
    try {
      await update(editingType.filament_type_id, values)
      toast.success('Tipo de filamento atualizado.')
      setIsEditDialogOpen(false)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') setEditError(message)
      else toast.error(message)
    } finally {
      setIsSubmittingEdit(false)
    }
  }

  function openToggleDialog(type: FilamentTypeSummary) {
    setTogglingType(type)
    setToggleError(null)
    setIsToggleDialogOpen(true)
  }

  async function handleConfirmToggle() {
    if (!togglingType) return
    const willActivate = !togglingType.is_active
    setIsConfirmingToggle(true)
    setPendingToggleId(togglingType.filament_type_id)
    setToggleError(null)
    try {
      await update(togglingType.filament_type_id, { is_active: willActivate })
      toast.success(`Tipo de filamento ${willActivate ? 'ativado' : 'desativado'}.`)
      setIsToggleDialogOpen(false)
    } catch (err) {
      setToggleError(toErrorMessage(err))
    } finally {
      setIsConfirmingToggle(false)
      setPendingToggleId(null)
    }
  }

  function openDeleteDialog(type: FilamentTypeSummary) {
    setDeletingType(type)
    setDeleteError(null)
    setIsDeleteDialogOpen(true)
  }

  async function handleConfirmDelete() {
    if (!deletingType) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteType(deletingType.filament_type_id)
      toast.success('Tipo de filamento excluído.')
      setIsDeleteDialogOpen(false)
    } catch (err) {
      setDeleteError(toErrorMessage(err))
    } finally {
      setIsDeleting(false)
    }
  }

  function openDrawer(group: FilamentGroup) {
    setOpenGroupKey(group.key)
    setIsDrawerOpen(true)
  }

  return (
    <InventoryPageShell
      area="filamentos"
      onPurchaseCompleted={(category) => {
        if (category === 'FILAMENT') refetchAll()
      }}
    >
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="search"
            aria-label="Buscar tipos de filamento"
            placeholder="Buscar por material, linha, cor ou fabricante"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="border-input focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 h-9 max-w-sm rounded-md border bg-white px-3 text-sm outline-none focus-visible:ring-2"
          />
          <Button
            onClick={() => {
              setCreateError(null)
              setIsCreateDialogOpen(true)
            }}
            className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark shrink-0"
          >
            Novo tipo de filamento
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MultiSelectFilterButton
            label="Material"
            ariaLabel="Filtrar por material"
            options={filterOptions.materials}
            selected={filters.materials}
            onToggle={(value) => toggleFilterValue('materials', value)}
            onClear={() => clearFilterGroup('materials')}
          />
          <MultiSelectFilterButton
            label="Linha"
            ariaLabel="Filtrar por linha"
            options={filterOptions.lines}
            selected={filters.lines}
            onToggle={(value) => toggleFilterValue('lines', value)}
            onClear={() => clearFilterGroup('lines')}
          />
          <MultiSelectFilterButton
            label="Cor"
            ariaLabel="Filtrar por cor"
            options={filterOptions.colors}
            selected={filters.colors}
            onToggle={(value) => toggleFilterValue('colors', value)}
            onClear={() => clearFilterGroup('colors')}
          />
          {activeFilterCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearAllFilters}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
            >
              Limpar filtros ({activeFilterCount})
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/10 mt-4 flex items-center justify-between rounded-lg border p-3 text-sm"
        >
          <span>{toErrorMessage(error)}</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Tentar novamente
          </Button>
        </div>
      )}

      {countsError && (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/10 mt-4 flex items-center justify-between rounded-lg border p-3 text-sm"
        >
          <span>
            Não foi possível carregar o número de rolos disponíveis. A coluna mostra "—" até tentar
            de novo.
          </span>
          <Button variant="outline" size="sm" onClick={refetchCounts}>
            Tentar novamente
          </Button>
        </div>
      )}

      <div className="mt-3">
        {isLoading || (countsLoading && !countsError) ? (
          <div role="status" className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <span className="sr-only">Carregando...</span>
          </div>
        ) : types.length === 0 ? (
          <p role="status" className="text-muted-foreground text-sm">
            Nenhum tipo de filamento cadastrado.
          </p>
        ) : visibleGroups.length === 0 ? (
          <p role="status" className="text-muted-foreground text-sm">
            Nenhum resultado para a busca e os filtros atuais.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="mb-1 flex justify-end">
              <RestoreColumnWidthsButton onClick={columnWidths.resetWidths} />
            </div>
            <Table
              className={cn('table-fixed', TABLE_COMPACT_TEXT_CLASSNAME)}
              style={{ minWidth: columnWidths.totalWidthPx }}
            >
              <colgroup>
                {FILAMENTS_COLUMN_SPECS.map((spec) => (
                  <col key={spec.id} style={{ width: columnWidths.getWidth(spec.id) }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  {(
                    [
                      { id: 'material', label: 'Material' },
                      { id: 'line', label: 'Linha' },
                      { id: 'color', label: 'Cor' },
                    ] as const
                  ).map((col) => (
                    <ResizableTableHead
                      key={col.id}
                      columnId={col.id}
                      columnLabel={col.label}
                      resize={{
                        width: columnWidths.getWidth(col.id),
                        onResize: columnWidths.setColumnWidth,
                        onCommit: columnWidths.commitWidths,
                        onKeyboardResize: columnWidths.adjustByKeyboard,
                      }}
                    >
                      {col.label}
                    </ResizableTableHead>
                  ))}
                  <ResizableTableHead
                    columnId="available"
                    columnLabel="Disponível"
                    className="text-right"
                    resize={{
                      width: columnWidths.getWidth('available'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  >
                    Disponível
                  </ResizableTableHead>

                  {/* Coluna "Rolos disponíveis" com o filtro de faixa
                      (mín/máx) no próprio cabeçalho — não altera a ordem da
                      coluna, usa a contagem CONSOLIDADA (nunca por
                      fabricante), preserva a alça de redimensionamento. */}
                  <TableHead className="relative h-auto py-2 text-right whitespace-normal">
                    <div className="flex items-center justify-end gap-1">
                      <span className="min-w-0 truncate">Rolos disponíveis</span>
                      <Popover>
                        <PopoverTrigger
                          aria-label="Filtrar por número de rolos disponíveis"
                          className={cn(
                            buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
                            'shrink-0',
                            (filters.minSpools !== null || filters.maxSpools !== null) &&
                              'text-brand-primary',
                          )}
                        >
                          <FilterIcon className="size-3.5" />
                        </PopoverTrigger>
                        <PopoverContent aria-label="Faixa de rolos disponíveis" align="end">
                          <div className="flex flex-col gap-3 text-left">
                            <span className="text-sm font-semibold">Rolos disponíveis</span>
                            {spoolRangeDisabled ? (
                              <p role="status" className="text-muted-foreground text-xs">
                                Contagem de rolos disponíveis indisponível — não é possível filtrar
                                por faixa agora.
                              </p>
                            ) : (
                              <>
                                <div className="flex items-end gap-2">
                                  <div className="flex flex-col gap-1">
                                    <Label htmlFor="filament-spools-min" className="text-xs">
                                      Mínimo
                                    </Label>
                                    <Input
                                      id="filament-spools-min"
                                      inputMode="numeric"
                                      value={minSpoolsInput}
                                      onChange={(event) => setMinSpoolsInput(event.target.value)}
                                      onBlur={() =>
                                        commitSpoolRange(minSpoolsInput, maxSpoolsInput)
                                      }
                                      className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 h-8 w-20"
                                    />
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <Label htmlFor="filament-spools-max" className="text-xs">
                                      Máximo
                                    </Label>
                                    <Input
                                      id="filament-spools-max"
                                      inputMode="numeric"
                                      value={maxSpoolsInput}
                                      onChange={(event) => setMaxSpoolsInput(event.target.value)}
                                      onBlur={() =>
                                        commitSpoolRange(minSpoolsInput, maxSpoolsInput)
                                      }
                                      className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 h-8 w-20"
                                    />
                                  </div>
                                </div>
                                {rangeInvalid && (
                                  <p role="alert" className="text-destructive text-xs">
                                    O mínimo não pode ser maior que o máximo.
                                  </p>
                                )}
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => commitSpoolRange(minSpoolsInput, maxSpoolsInput)}
                                    className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark h-7"
                                  >
                                    Aplicar
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearSpoolRange}
                                    disabled={
                                      filters.minSpools === null && filters.maxSpools === null
                                    }
                                    className="text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark h-7"
                                  >
                                    Limpar
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <ColumnResizeHandle
                      columnId="spools"
                      columnLabel="Rolos disponíveis"
                      width={columnWidths.getWidth('spools')}
                      onResize={columnWidths.setColumnWidth}
                      onCommit={columnWidths.commitWidths}
                      onKeyboardResize={columnWidths.adjustByKeyboard}
                    />
                  </TableHead>

                  <ResizableTableHead
                    columnId="situation"
                    columnLabel="Situação"
                    resize={{
                      width: columnWidths.getWidth('situation'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  >
                    Situação
                  </ResizableTableHead>
                  <ResizableTableHead
                    columnId="actions"
                    columnLabel="Ações"
                    resize={{
                      width: columnWidths.getWidth('actions'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleGroups.map((group) => {
                  const stockLevel = getStockLevel(group.availableGrams, group.minimumStockGrams)
                  return (
                    <TableRow
                      key={group.key}
                      className="odd:bg-brand-primary-soft/50 hover:bg-brand-primary-soft even:bg-white"
                    >
                      <TableCell>{group.material}</TableCell>
                      <TableCell className="truncate" title={group.lineLabel}>
                        {group.lineLabel}
                      </TableCell>
                      <TableCell className="truncate" title={group.colorLabel}>
                        {group.colorLabel}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatGrams(group.availableGrams)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {group.availableSpoolCount === null ? '—' : group.availableSpoolCount}
                      </TableCell>
                      <TableCell>
                        <StockLevelBadge level={stockLevel} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-nowrap items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDrawer(group)}
                            aria-label={`Ver rolos de ${group.material} · ${group.lineLabel} · ${group.colorLabel}`}
                            className={cn(
                              'border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0',
                              TABLE_COMPACT_ACTION_TEXT_CLASSNAME,
                            )}
                          >
                            Ver rolos
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
            <DialogTitle>Novo tipo de filamento</DialogTitle>
            <DialogDescription>
              Preencha os dados para cadastrar um novo tipo de filamento.
            </DialogDescription>
          </DialogHeader>
          <FilamentTypeForm
            idPrefix="filament-type"
            isSubmitting={isSubmittingCreate}
            submitError={createError}
            onSubmit={(values) => void handleCreateSubmit(values)}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar tipo de filamento</DialogTitle>
            <DialogDescription>Atualize os dados do tipo de filamento.</DialogDescription>
          </DialogHeader>
          {editingType && (
            <FilamentTypeForm
              key={editingType.filament_type_id}
              idPrefix="filament-type-edit"
              mode="edit"
              initialValues={{
                material: editingType.material,
                manufacturer: editingType.manufacturer,
                line: editingType.line,
                commercial_color: editingType.commercial_color,
                minimum_stock_grams: editingType.minimum_stock_grams,
                notes: null,
              }}
              isSubmitting={isSubmittingEdit}
              submitError={editError}
              onSubmit={(values) => void handleEditSubmit(values)}
              onCancel={() => setIsEditDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isToggleDialogOpen} onOpenChange={setIsToggleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {togglingType?.is_active ? 'Desativar tipo de filamento' : 'Ativar tipo de filamento'}
            </DialogTitle>
            <DialogDescription>
              {togglingType &&
                (togglingType.is_active
                  ? `Tem certeza que deseja desativar "${togglingType.manufacturer} — ${togglingType.commercial_color}"? Um tipo inativo deixa de poder receber novos rolos, mas os já cadastrados são preservados.`
                  : `Tem certeza que deseja ativar "${togglingType.manufacturer} — ${togglingType.commercial_color}"?`)}
            </DialogDescription>
          </DialogHeader>
          {toggleError && (
            <p role="alert" className="text-destructive text-sm">
              {toggleError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsToggleDialogOpen(false)}
              disabled={isConfirmingToggle}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirmToggle()}
              disabled={isConfirmingToggle}
              className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
            >
              {isConfirmingToggle
                ? 'Salvando...'
                : togglingType?.is_active
                  ? 'Desativar'
                  : 'Ativar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir tipo de filamento</DialogTitle>
            <DialogDescription>
              {deletingType &&
                `Tem certeza que deseja excluir "${deletingType.manufacturer} — ${deletingType.commercial_color}"? Esta ação é permanente. Só é possível quando não há rolo nem composição de produto vinculados.`}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-destructive text-sm">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeleting}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? 'Excluindo...' : 'Excluir definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDrawerVisible} onOpenChange={handleDrawerOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            {/* O título da janela É a identificação do grupo (Material -
                Linha - Cor) — o botão que abre continua "Ver rolos", mas a
                janela aberta não repete esse texto. Sem subtítulo: a
                identificação não aparece duas vezes. */}
            <DialogTitle>
              {openGroup
                ? `${openGroup.material} - ${openGroup.lineLabel} - ${openGroup.colorLabel}`
                : ''}
            </DialogTitle>
          </DialogHeader>
          {openGroup && (
            <FilamentTypeDrawer
              group={openGroup}
              onSummaryChanged={refetchAll}
              onClose={() => handleDrawerOpenChange(false)}
              onEditType={openEditDialog}
              onToggleType={openToggleDialog}
              onDeleteType={openDeleteDialog}
              pendingToggleTypeId={pendingToggleId}
            />
          )}
        </DialogContent>
      </Dialog>
    </InventoryPageShell>
  )
}
