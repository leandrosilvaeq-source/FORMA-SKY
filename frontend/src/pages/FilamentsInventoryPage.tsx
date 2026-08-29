import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { InventoryPageShell } from '@/components/inventory/InventoryPageShell'
import { FilamentTypeForm, type FilamentTypeFormValues } from '@/components/inventory/FilamentTypeForm'
import { FilamentTypeDrawer } from '@/components/inventory/FilamentTypeDrawer'
import { StockLevelBadge, getStockLevel } from '@/components/inventory/StockMovementPanel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useFilamentTypes } from '@/hooks/useFilamentTypes'
import { ApiError } from '@/lib/api/errors'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import type { FilamentTypeSummary } from '@/types/domain'

// Módulo 3 (Estoque), Incremento 4 — MVP local de filamentos. Segue o mesmo
// padrão visual de InventoryPage.tsx (Acessórios/Embalagens), mas com uma
// forma de dado diferente: listagem de TIPOS (agregados via
// vw_filament_type_summary), com drill-down para os ROLOS de cada tipo
// (FilamentTypeDrawer) — por isso não reaproveita InventoryAreaPanel.

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}g`
}

function matchesSearch(type: FilamentTypeSummary, normalizedTerm: string): boolean {
  if (!normalizedTerm) return true
  return (
    normalizeForSearch(type.manufacturer).includes(normalizedTerm) ||
    normalizeForSearch(type.line).includes(normalizedTerm) ||
    normalizeForSearch(type.commercial_color).includes(normalizedTerm) ||
    normalizeForSearch(type.material).includes(normalizedTerm)
  )
}

export function FilamentsInventoryPage() {
  const { types, isLoading, error, refetch, create, update, delete: deleteType } = useFilamentTypes()
  const [searchTerm, setSearchTerm] = useState('')

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

  // openTypeId (não o objeto inteiro): o resumo exibido no drawer precisa
  // ficar vivo — derivado de `types` a cada render — para refletir um
  // refetch() disparado de dentro do drawer (ver onSummaryChanged). Um
  // snapshot congelado no momento do clique nunca atualizaria depois de uma
  // movimentação feita no painel aninhado (achado real da validação manual,
  // 2026-08-28: saldo consolidado nunca aparecia atualizado).
  const [openTypeId, setOpenTypeId] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const openType = useMemo(() => types.find((type) => type.filament_type_id === openTypeId) ?? null, [types, openTypeId])

  const filteredTypes = useMemo(() => {
    const term = normalizeForSearch(searchTerm)
    return types.filter((type) => matchesSearch(type, term))
  }, [types, searchTerm])

  async function handleCreateSubmit(values: FilamentTypeFormValues) {
    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      await create(values)
      toast.success('Tipo de filamento cadastrado.')
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
      if (err instanceof ApiError && err.type === 'validation') {
        setEditError(message)
      } else {
        toast.error(message)
      }
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

  function openDrawer(type: FilamentTypeSummary) {
    setOpenTypeId(type.filament_type_id)
    setIsDrawerOpen(true)
  }

  return (
    <InventoryPageShell
      area="filamentos"
      onPurchaseCompleted={(category) => {
        if (category === 'FILAMENT') refetch()
      }}
    >
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          aria-label="Buscar tipos de filamento"
          placeholder="Buscar por fabricante, linha, cor ou material"
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

      <div className="mt-3">
        {isLoading ? (
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
        ) : filteredTypes.length === 0 ? (
          <p role="status" className="text-muted-foreground text-sm">
            Nenhum resultado encontrado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1100px] table-fixed text-[16px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-auto w-[10%] py-2 whitespace-normal">Material</TableHead>
                  <TableHead className="h-auto w-[14%] py-2 whitespace-normal">Fabricante</TableHead>
                  <TableHead className="h-auto w-[12%] py-2 whitespace-normal">Linha</TableHead>
                  <TableHead className="h-auto w-[12%] py-2 whitespace-normal">Cor</TableHead>
                  <TableHead className="h-auto w-[12%] py-2 text-right whitespace-normal">Disponível</TableHead>
                  <TableHead className="h-auto w-[9%] py-2 text-right whitespace-normal">Rolos</TableHead>
                  <TableHead className="h-auto w-[11%] py-2 whitespace-normal">Situação</TableHead>
                  <TableHead className="h-auto w-[7%] py-2 whitespace-normal">Ativo</TableHead>
                  <TableHead className="h-auto w-[13%] py-2" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTypes.map((type) => {
                  const stockLevel = getStockLevel(type.total_available_grams, type.minimum_stock_grams)
                  return (
                    <TableRow
                      key={type.filament_type_id}
                      className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft"
                    >
                      <TableCell>{type.material}</TableCell>
                      <TableCell className="truncate" title={type.manufacturer}>
                        {type.manufacturer}
                      </TableCell>
                      <TableCell className="truncate" title={type.line}>
                        {type.line}
                      </TableCell>
                      <TableCell className="truncate" title={type.commercial_color}>
                        {type.commercial_color}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatGrams(type.total_available_grams)}</TableCell>
                      <TableCell className="text-right tabular-nums">{type.usable_spool_count}</TableCell>
                      <TableCell>
                        <StockLevelBadge level={stockLevel} />
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={type.is_active}
                          disabled={pendingToggleId === type.filament_type_id}
                          onCheckedChange={() => openToggleDialog(type)}
                          aria-label={`${type.is_active ? 'Desativar' : 'Ativar'} tipo de filamento ${type.manufacturer} ${type.commercial_color}`}
                          className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDrawer(type)}
                            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                          >
                            Ver rolos
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(type)}
                            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                          >
                            Editar
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => openDeleteDialog(type)}
                            aria-label={`Excluir tipo de filamento ${type.manufacturer} ${type.commercial_color}`}
                          >
                            Excluir
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
            <DialogDescription>Preencha os dados para cadastrar um novo tipo de filamento.</DialogDescription>
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
            <DialogTitle>{togglingType?.is_active ? 'Desativar tipo de filamento' : 'Ativar tipo de filamento'}</DialogTitle>
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
              {isConfirmingToggle ? 'Salvando...' : togglingType?.is_active ? 'Desativar' : 'Ativar'}
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
            <Button type="button" variant="destructive" onClick={() => void handleConfirmDelete()} disabled={isDeleting}>
              {isDeleting ? 'Excluindo...' : 'Excluir definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Rolos do tipo</DialogTitle>
            <DialogDescription>
              {openType && `${openType.material} · ${openType.manufacturer} · ${openType.line} · ${openType.commercial_color}`}
            </DialogDescription>
          </DialogHeader>
          {openType && (
            <FilamentTypeDrawer filamentType={openType} onSummaryChanged={refetch} onClose={() => setIsDrawerOpen(false)} />
          )}
        </DialogContent>
      </Dialog>
    </InventoryPageShell>
  )
}
