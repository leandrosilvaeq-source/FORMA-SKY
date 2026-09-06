import { useCallback, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FilterIcon } from 'lucide-react'
import { InventoryPageShell } from '@/components/inventory/InventoryPageShell'
import {
  FilamentTypeForm,
  type FilamentTypeFormValues,
} from '@/components/inventory/FilamentTypeForm'
import { FilamentTypeDrawer } from '@/components/inventory/FilamentTypeDrawer'
import { FilamentColorBadge } from '@/components/inventory/FilamentColorBadge'
import { ResizableTableHead } from '@/components/dataTable/ResizableTableHead'
import { ColumnResizeHandle } from '@/components/dataTable/ColumnResizeHandle'
import { RestoreColumnWidthsButton } from '@/components/dataTable/RestoreColumnWidthsButton'
import {
  TABLE_COMPACT_ACTION_TEXT_CLASSNAME,
  TABLE_COMPACT_TEXT_CLASSNAME,
} from '@/components/dataTable/tableTypography'
import { getStockLevel, type StockLevel } from '@/components/inventory/stockLevel'
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
import { isRemovalPlanChangedError, type FilamentTypeRemovalPlan } from '@/lib/api/filamentTypes'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import {
  distinctFilamentColors,
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
import {
  FILAMENT_LINE_FILTER_OPTIONS,
  resolveFilamentLineDisplayLabel,
} from '@/lib/inventory/filamentLineAliases'
import type { ColumnWidthSpec } from '@/lib/tables/columnWidths'
import { cn } from '@/lib/utils'
import type { FilamentMaterial, FilamentTypeSummary } from '@/types/domain'

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
// "Ver rolos", por isso é bem mais estreita que antes. 'minimumStock'
// (2026-09-04) — esta listagem consolidada nunca teve um card mobile
// dedicado (só a <table> com overflow-x-auto, responsiva por rolagem
// horizontal); a coluna nova aparece nela em qualquer largura de tela,
// exatamente como as demais.
const FILAMENTS_COLUMN_SPECS: ColumnWidthSpec[] = [
  { id: 'material', defaultWidth: 110, minWidth: 80, maxWidth: 220 },
  { id: 'line', defaultWidth: 150, minWidth: 90, maxWidth: 320 },
  { id: 'color', defaultWidth: 150, minWidth: 90, maxWidth: 320 },
  { id: 'available', defaultWidth: 140, minWidth: 100, maxWidth: 260 },
  { id: 'spools', defaultWidth: 170, minWidth: 130, maxWidth: 280 },
  { id: 'minimumStock', defaultWidth: 130, minWidth: 100, maxWidth: 220 },
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

// Estoque mínimo (2026-09-04) — padrão brasileiro COM espaço antes de "g"
// ("500 g"/"1.000 g"/"2.000 g", pedido explícito desta coluna nova) —
// distinto de formatGrams acima (sem espaço, "500g"), usado pela coluna
// Disponível já existente, que esta rodada não altera.
function formatMinimumStockGrams(value: number): string {
  return `${value.toLocaleString('pt-BR')} g`
}

// Badge de Situação ESPECÍFICO desta listagem (2026-09-04) — NUNCA o
// StockLevelBadge compartilhado (StockMovementPanel.tsx), que continua
// exatamente como está para Acessórios/Embalagens (cinza, "Estoque
// normal"). getStockLevel (cálculo) é reaproveitado sem nenhuma alteração —
// só "normal" ganha um texto ("Normal") e cor verdes própria aqui; "low"/
// "empty" preservam o mesmo rótulo e cor de sempre. Verde = mesmo padrão de
// sucesso já usado em OrderStatusControl/OrderPaymentStatusControl
// ('border-emerald-300 bg-emerald-50 text-emerald-800'), nunca uma cor
// inventada nesta rodada.
const FILAMENT_STOCK_LEVEL_LABELS: Record<StockLevel, string> = {
  empty: 'Sem estoque',
  low: 'Estoque baixo',
  normal: 'Normal',
}
const FILAMENT_STOCK_LEVEL_CLASSNAMES: Record<StockLevel, string> = {
  empty: 'border-destructive/40 bg-destructive/10 text-destructive',
  low: 'border-amber-300 bg-amber-50 text-amber-800',
  normal: 'border-emerald-300 bg-emerald-50 text-emerald-800',
}

function FilamentStockLevelBadge({ level }: { level: StockLevel }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${FILAMENT_STOCK_LEVEL_CLASSNAMES[level]}`}
    >
      {FILAMENT_STOCK_LEVEL_LABELS[level]}
    </span>
  )
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

// Material (fixo: PLA/PETG/TPU, mesmo enum de FilamentMaterial) — a partir
// de 2026-09-05.
const FILAMENT_MATERIAL_FILTER_OPTIONS: FilamentMaterial[] = ['PLA', 'PETG', 'TPU']

const FILTER_ACTION_BUTTON_CLASSNAME =
  'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50'
const FILTER_ACTION_BUTTON_SELECTED_CLASSNAME =
  'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
const FILTER_ACTION_BUTTON_UNSELECTED_CLASSNAME =
  'border-input text-muted-foreground hover:bg-muted hover:text-foreground'

// Filtro de seleção única (Material / Linha, 2026-09-05) — mesmo padrão
// visual/semântico de action buttons já usado em "Novo tipo de filamento"
// (FilamentTypeForm.tsx) e em "Compra de filamentos" (PurchaseDialog.tsx):
// role="radiogroup" + botões role="radio" com aria-checked, nunca um
// dropdown. "Todos" (selectedValue === null) é sempre a primeira opção —
// limpa o grupo em vez de selecionar um valor. Aplica o filtro
// imediatamente ao clicar (mesmo setFilters síncrono dos demais filtros
// desta página) — nunca exige F5.
function SingleSelectActionFilter({
  label,
  ariaLabel,
  options,
  selectedValue,
  onSelect,
}: {
  label: string
  ariaLabel: string
  options: readonly string[]
  selectedValue: string | null
  onSelect: (value: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
        <button
          type="button"
          role="radio"
          aria-checked={selectedValue === null}
          onClick={() => onSelect(null)}
          className={cn(
            FILTER_ACTION_BUTTON_CLASSNAME,
            selectedValue === null
              ? FILTER_ACTION_BUTTON_SELECTED_CLASSNAME
              : FILTER_ACTION_BUTTON_UNSELECTED_CLASSNAME,
          )}
        >
          Todos
        </button>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selectedValue === option}
            onClick={() => onSelect(option)}
            className={cn(
              FILTER_ACTION_BUTTON_CLASSNAME,
              selectedValue === option
                ? FILTER_ACTION_BUTTON_SELECTED_CLASSNAME
                : FILTER_ACTION_BUTTON_UNSELECTED_CLASSNAME,
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
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
    getRemovalPlan,
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

  // CORREÇÃO (2026-09-04, "corrija a atualização automática do fluxo de
  // Filamentos"): a janela "Ver rolos" (FilamentTypeDrawer) carrega seus
  // próprios rolos com um useFilamentSpools() independente. Uma COMPRA nunca
  // acontece com "Ver rolos" aberto ao mesmo tempo (diálogos de nível de
  // página não-aninhados — abrir "Compras" torna "Ver rolos" inacessível, e
  // vice-versa; reabrir "Ver rolos" depois já remonta o componente do zero e
  // busca os rolos de novo sozinho, sem precisar de nada aqui). O caso real
  // que FICA aberto durante uma mudança externa é "Excluir tipo" pelos
  // botões do próprio rodapé de "Ver rolos": esse diálogo de confirmação É
  // aninhado (aberto de DENTRO do drawer), então arquivar um tipo com rolos
  // deixava a tabela de rolos do drawer (que continua montada por baixo)
  // mostrando os rolos como se ainda estivessem ativos, até fechar/reabrir
  // ou dar F5. dataVersion é o sinal que sobe SÓ nesse caso — repassado como
  // prop `refreshSignal`; o drawer decide, ao notar a mudança, refazer sua
  // própria busca de rolos. Ações que já acontecem DENTRO da janela (criar/
  // editar/excluir rolo, pesar, ajustar) continuam chamando só refetchAll
  // (via onSummaryChanged, inalterado) — elas já atualizam seus próprios
  // rolos localmente (create/update/setLocalSpoolState), então subir
  // dataVersion ali geraria uma segunda busca redundante.
  const [dataVersion, setDataVersion] = useState(0)
  const refetchAllAndSignalDrawer = useCallback(() => {
    refetchAll()
    setDataVersion((current) => current + 1)
  }, [refetchAll])

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
  // Plano AUTORITATIVO da remoção, buscado no backend ao abrir o diálogo. A
  // variante da confirmação (permanente / arquivamento / bloqueio) vem
  // SEMPRE de deletePlan.planned_result — nunca mais da presença de rolos.
  const [deletePlan, setDeletePlan] = useState<FilamentTypeRemovalPlan | null>(null)
  const [isLoadingDeletePlan, setIsLoadingDeletePlan] = useState(false)
  const [deletePlanError, setDeletePlanError] = useState<string | null>(null)
  // true quando o backend recusou a execução porque o plano mudou entre a
  // consulta e a confirmação (FILAMENT_TYPE_REMOVAL_PLAN_CHANGED). O diálogo
  // fica aberto, recarrega o plano e pede nova confirmação.
  const [deletePlanChanged, setDeletePlanChanged] = useState(false)

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
  // Sugestões de Cor (2026-09-04) para "Novo tipo de filamento"/"Editar tipo
  // de filamento" — todos os tipos já carregados (ativos e arquivados),
  // dedupe/canonicalização já feita por distinctFilamentColors.
  const existingColors = useMemo(() => distinctFilamentColors(types), [types])
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

  // Grupos totalmente arquivados (nenhum tipo ATIVO) nunca aparecem nesta
  // listagem operacional (2026-09-05: o controle "Mostrar tipos arquivados"
  // foi removido — não há mais como revelá-los aqui). Os tipos continuam
  // intactos no banco (nenhum UPDATE/DELETE por esta mudança) — só deixaram
  // de ter um caminho de exibição/"Ver rolos" nesta tela. Não confundir com
  // o "Mostrar arquivados" dos ROLOS, dentro da janela "Ver rolos"
  // (FilamentTypeDrawer) — controle DIFERENTE, preservado sem alteração.
  const visibleGroups = useMemo(() => {
    const term = normalizeForSearch(searchTerm)
    return filterFilamentGroups(groups, filters)
      .filter((group) => group.hasActiveType)
      .filter((group) => matchesFilamentGroupSearch(group, term))
  }, [groups, filters, searchTerm])

  const activeFilterCount = filamentGroupFilterCount(filters)
  // Material/Linha são seleção única (action buttons, 2026-09-05) — o Set
  // nunca guarda mais de um elemento; null representa "Todos".
  const selectedMaterial = filters.materials.size > 0 ? [...filters.materials][0] : null
  const selectedLine = filters.lines.size > 0 ? [...filters.lines][0] : null

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

  // Material/Linha: seleção ÚNICA — escolher um valor SUBSTITUI o Set
  // (nunca soma); "Todos" (value === null) volta ao Set vazio, equivalente
  // a clearFilterGroup. Aplica imediatamente (mesmo setFilters síncrono),
  // nunca exige F5; combina normalmente com o resto de `filters` (Cor,
  // faixa de rolos) e com a busca — tudo já é AND por construção em
  // matchesFilamentGroupFilters/visibleGroups.
  function setSingleFilterValue(kind: 'materials' | 'lines', value: string | null) {
    setFilters((current) => ({ ...current, [kind]: value === null ? new Set() : new Set([value]) }))
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

  // Variante da confirmação, derivada SÓ do plano autoritativo do backend.
  //   PHYSICALLY_DELETED -> exclusão física permanente (destrutiva).
  //   ARCHIVED           -> remoção lógica, histórico preservado.
  //   BLOCKED_ACTIVE_ORDER -> bloqueio: nenhuma ação destrutiva.
  const deletePlanResult = deletePlan?.planned_result ?? null
  // expected_result enviado no DELETE — só existe para os dois planos
  // executáveis; BLOCKED_ACTIVE_ORDER não tem confirmação.
  const deleteExpectedResult: 'PHYSICALLY_DELETED' | 'ARCHIVED' | null =
    deletePlanResult === 'PHYSICALLY_DELETED' || deletePlanResult === 'ARCHIVED'
      ? deletePlanResult
      : null

  const loadRemovalPlan = useCallback(
    async (typeId: string) => {
      setIsLoadingDeletePlan(true)
      setDeletePlanError(null)
      try {
        const plan = await getRemovalPlan(typeId)
        setDeletePlan(plan)
      } catch (err) {
        setDeletePlan(null)
        setDeletePlanError(toErrorMessage(err))
      } finally {
        setIsLoadingDeletePlan(false)
      }
    },
    [getRemovalPlan],
  )

  function openDeleteDialog(type: FilamentTypeSummary) {
    setDeletingType(type)
    setDeleteError(null)
    setDeletePlan(null)
    setDeletePlanError(null)
    setDeletePlanChanged(false)
    setIsDeleteDialogOpen(true)
    void loadRemovalPlan(type.filament_type_id)
  }

  async function handleConfirmDelete() {
    if (!deletingType || !deleteExpectedResult) return
    setIsDeleting(true)
    setDeleteError(null)
    setDeletePlanChanged(false)
    try {
      const outcome = await deleteType(deletingType.filament_type_id, deleteExpectedResult)
      if (outcome.result === 'PHYSICALLY_DELETED') {
        toast.success('Tipo de filamento excluído.')
      } else {
        toast.success('Tipo removido do estoque. Histórico preservado.')
        // O tipo e todos os seus rolos foram inativados na mesma transação
        // no backend — recarrega tipos e contagens para refletir os
        // agregados corretos (e o grupo sai da listagem operacional). Este
        // botão também é alcançável de DENTRO da janela "Ver rolos" (ações
        // de tipo no rodapé) — sinaliza o drawer para refazer sua própria
        // busca de rolos (os rolos deste tipo também foram arquivados).
        refetchAllAndSignalDrawer()
      }
      setIsDeleteDialogOpen(false)
    } catch (err) {
      if (isRemovalPlanChangedError(err)) {
        // O plano mudou entre a consulta e a execução — nada foi alterado.
        // Recarrega o plano e mantém o diálogo aberto para nova confirmação.
        setDeletePlanChanged(true)
        void loadRemovalPlan(deletingType.filament_type_id)
      } else {
        setDeleteError(toErrorMessage(err))
      }
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
        // "Compras" é um diálogo de nível de página (o botão fica no
        // cabeçalho, fora de "Ver rolos") — os dois nunca ficam abertos ao
        // mesmo tempo (abrir um torna o outro inacessível, mesmo
        // comportamento do primitivo de Dialog para diálogos não
        // aninhados), então não há uma janela "Ver rolos" para sinalizar
        // aqui. Ao reabri-la depois, ela remonta do zero e busca os rolos
        // de novo sozinha (useFilamentSpools) — já sem exigir F5.
        if (category === 'FILAMENT') refetchAll()
      }}
    >
      <div className="mt-4 flex flex-col gap-3">
        {/* "Novo Filamento" fica em sua própria linha (à direita no
            desktop) — a linha de baixo agrupa Busca | Material | Linha | Cor. */}
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setCreateError(null)
              setIsCreateDialogOpen(true)
            }}
            className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark shrink-0"
          >
            Novo Filamento
          </Button>
        </div>

        {/* Busca | Material | Linha | Cor na MESMA linha no desktop —
            TODOS os grupos têm a largura do próprio conteúdo (nenhum
            `flex-1`/`grow`): sem o crescimento artificial de Linha, o grupo
            Cor fica logo depois de Linha, separado só pelo gap padrão
            (`md:gap-4`), e o espaço livre sobra à direita de Cor — nunca
            entre Linha e Cor. `min-w-0` no grupo Linha deixa os 8 botões
            internos quebrarem DENTRO da própria área quando o espaço aperta,
            em vez de esticar a linha ou gerar rolagem horizontal.
            `md:flex-wrap` permite a quebra organizada em telas
            intermediárias (Cor passa para a linha de baixo, mas continua
            logo depois de Linha na ordem); abaixo de `md` tudo empilha
            (flex-col). `md:items-start` alinha os quatro rótulos no mesmo
            topo. Sem largura rígida, sem position absolute, sem margem
            negativa, sem margem automática. */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:gap-4">
            <div className="flex flex-col items-start gap-1.5 md:shrink-0">
              {/* O campo de busca não tinha rótulo visível — ganhou um
                  ("Buscar") para alinhar com Material/Linha/Cor no topo. O
                  `aria-label` descritivo continua sendo o nome acessível. */}
              <Label htmlFor="filament-type-search">Buscar</Label>
              <input
                id="filament-type-search"
                type="search"
                aria-label="Buscar tipos de filamento"
                placeholder="Buscar por material, linha, cor ou fabricante"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="border-input focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 h-9 w-full rounded-md border bg-white px-3 text-sm outline-none focus-visible:ring-2 md:w-64"
              />
            </div>
            <div className="md:shrink-0">
              <SingleSelectActionFilter
                label="Material"
                ariaLabel="Filtrar por material"
                options={FILAMENT_MATERIAL_FILTER_OPTIONS}
                selectedValue={selectedMaterial}
                onSelect={(value) => setSingleFilterValue('materials', value)}
              />
            </div>
            <div className="min-w-0">
              <SingleSelectActionFilter
                label="Linha"
                ariaLabel="Filtrar por linha"
                options={FILAMENT_LINE_FILTER_OPTIONS}
                selectedValue={selectedLine}
                onSelect={(value) => setSingleFilterValue('lines', value)}
              />
            </div>
            <div className="md:shrink-0">
              {/* Cor continua o mesmo Popover multisseleção — só ganhou um
                  rótulo próprio, para alinhar com Busca/Material/Linha no topo.
                  Fica imediatamente depois de Linha (nenhum `ml-auto`/
                  `self-end`/`justify-*` empurrando para a direita). */}
              <div className="flex flex-col items-start gap-1.5">
                <Label>Cor</Label>
                <MultiSelectFilterButton
                  label="Cor"
                  ariaLabel="Filtrar por cor"
                  options={filterOptions.colors}
                  selected={filters.colors}
                  onToggle={(value) => toggleFilterValue('colors', value)}
                  onClear={() => clearFilterGroup('colors')}
                />
              </div>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
                className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
              >
                Limpar filtros ({activeFilterCount})
              </Button>
            </div>
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
                    columnId="minimumStock"
                    columnLabel="Estoque mínimo"
                    className="text-right"
                    resize={{
                      width: columnWidths.getWidth('minimumStock'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  >
                    Estoque mínimo
                  </ResizableTableHead>
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
                  const lineDisplayLabel = resolveFilamentLineDisplayLabel(group.lineLabel)
                  return (
                    <TableRow
                      key={group.key}
                      className="odd:bg-brand-primary-soft/50 hover:bg-brand-primary-soft even:bg-white"
                    >
                      <TableCell>{group.material}</TableCell>
                      <TableCell className="truncate" title={lineDisplayLabel}>
                        {lineDisplayLabel}
                      </TableCell>
                      <TableCell className="truncate">
                        <FilamentColorBadge label={group.colorLabel} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatGrams(group.availableGrams)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {group.availableSpoolCount === null ? '—' : group.availableSpoolCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {group.minimumStockGrams !== null
                          ? formatMinimumStockGrams(group.minimumStockGrams)
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <FilamentStockLevelBadge level={stockLevel} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-nowrap items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDrawer(group)}
                            aria-label={`Ver rolos de ${group.material} · ${lineDisplayLabel} · ${group.colorLabel}`}
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
            existingColors={existingColors}
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
              existingColors={existingColors}
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
            {/* Título e corpo vêm SEMPRE do plano autoritativo do backend
                (get_filament_type_removal_plan), nunca da presença de
                rolos:
                  PHYSICALLY_DELETED   -> "Excluir tipo de filamento" (permanente);
                  ARCHIVED             -> "Remover tipo do estoque" (histórico preservado);
                  BLOCKED_ACTIVE_ORDER -> bloqueio, sem ação destrutiva.
                Enquanto o plano carrega, um título neutro. */}
            <DialogTitle>
              {deletePlanResult === 'PHYSICALLY_DELETED'
                ? 'Excluir tipo de filamento'
                : deletePlanResult === 'ARCHIVED'
                  ? 'Remover tipo do estoque'
                  : deletePlanResult === 'BLOCKED_ACTIVE_ORDER'
                    ? 'Não é possível remover o tipo'
                    : 'Remover tipo de filamento'}
            </DialogTitle>
            <DialogDescription>
              {!deletingType
                ? null
                : isLoadingDeletePlan
                  ? 'Verificando o que será removido...'
                  : deletePlanError
                    ? deletePlanError
                    : deletePlanResult === 'PHYSICALLY_DELETED'
                      ? `Tem certeza que deseja excluir "${deletingType.manufacturer} — ${deletingType.commercial_color}"? Este tipo não possui rolos, movimentações, compras nem vínculo com pedidos — a exclusão é permanente e não poderá ser desfeita.`
                      : deletePlanResult === 'ARCHIVED'
                        ? `"${deletingType.manufacturer} — ${deletingType.commercial_color}" e todos os seus rolos serão retirados do estoque ativo. Históricos, movimentações, compras e vínculos de pedidos finalizados são preservados.`
                        : deletePlanResult === 'BLOCKED_ACTIVE_ORDER'
                          ? `"${deletingType.manufacturer} — ${deletingType.commercial_color}" está sendo utilizado por pedido(s) ativo(s) e não pode ser removido${
                              deletePlan && deletePlan.active_order_numbers.length > 0
                                ? `. Pedido(s): ${deletePlan.active_order_numbers.join(', ')}`
                                : ''
                            }.`
                          : null}
            </DialogDescription>
          </DialogHeader>
          {deletePlanChanged && (
            <p role="status" className="text-sm">
              As condições deste tipo mudaram desde a conferência. Revise as informações acima e
              confirme novamente.
            </p>
          )}
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
              {deleteExpectedResult ? 'Cancelar' : 'Fechar'}
            </Button>
            {deletePlanError ? (
              <Button
                type="button"
                onClick={() => {
                  if (deletingType) void loadRemovalPlan(deletingType.filament_type_id)
                }}
                disabled={isLoadingDeletePlan || !deletingType}
                className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
              >
                Tentar novamente
              </Button>
            ) : deleteExpectedResult === 'ARCHIVED' ? (
              <Button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting || isLoadingDeletePlan}
                className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
              >
                {isDeleting ? 'Removendo...' : 'Remover do estoque'}
              </Button>
            ) : deleteExpectedResult === 'PHYSICALLY_DELETED' ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting || isLoadingDeletePlan}
              >
                {isDeleting ? 'Excluindo...' : 'Excluir definitivamente'}
              </Button>
            ) : null}
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
                ? `${openGroup.material} - ${resolveFilamentLineDisplayLabel(openGroup.lineLabel)} - ${openGroup.colorLabel}`
                : ''}
            </DialogTitle>
          </DialogHeader>
          {openGroup && (
            <FilamentTypeDrawer
              group={openGroup}
              onSummaryChanged={refetchAll}
              refreshSignal={dataVersion}
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
