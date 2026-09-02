import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { EllipsisIcon } from 'lucide-react'
import { FilamentSpoolForm, type FilamentSpoolFormValues } from './FilamentSpoolForm'
import { FilamentSpoolPanel } from './FilamentSpoolPanel'
import { StockLevelBadge, getStockLevel } from './StockMovementPanel'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useFilamentSpools } from '@/hooks/useFilamentSpools'
import { ApiError } from '@/lib/api/errors'
import type { FilamentGroup } from '@/lib/inventory/filamentGroups'
import type { FilamentSpool, FilamentTypeSummary } from '@/types/domain'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}g`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR')
}

function formatPeso(spool: FilamentSpool): string {
  const percentRemaining = Math.round(
    (spool.current_net_weight_grams / spool.nominal_weight_grams) * 100,
  )
  return `${formatGrams(spool.current_net_weight_grams)} / ${formatGrams(spool.nominal_weight_grams)} · ${percentRemaining}%`
}

function typeLabel(type: FilamentTypeSummary): string {
  return `${type.material} · ${type.manufacturer} · ${type.line} · ${type.commercial_color}`
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

function ArchivedBadge() {
  return (
    <span className="border-input text-muted-foreground inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
      Arquivado
    </span>
  )
}

export interface FilamentTypeDrawerProps {
  // Grupo consolidado (Material + Linha + Cor) — pode reunir vários tipos
  // de fabricantes diferentes. "Ver rolos" abre TODOS eles.
  group: FilamentGroup
  // Chamado após qualquer ação que possa afetar o saldo consolidado do
  // grupo (criar/editar/ativar/desativar/descartar/excluir/arquivar rolo, e
  // — repassado ao FilamentSpoolPanel — movimentar/pesar). O pai
  // (FilamentsInventoryPage) reaproveita o `refetch` de useFilamentTypes.
  onSummaryChanged: () => void
  onClose: () => void
  // Ações de TIPO (individuais por filament_type_id) — os diálogos moram no
  // pai (FilamentsInventoryPage), a linha consolidada da listagem nunca as
  // dispara sobre um filament_type_id arbitrário.
  onEditType: (type: FilamentTypeSummary) => void
  onToggleType: (type: FilamentTypeSummary) => void
  onDeleteType: (type: FilamentTypeSummary) => void
  pendingToggleTypeId: string | null
}

// Ao abrir um grupo: resumo consolidado (saldo/rolos vindos de
// vw_filament_type_summary, somados por grupo), a lista de tipos/fabricantes
// do grupo (cada um com Editar/Ativar-Desativar/Excluir tipo + "Novo rolo"),
// e a lista de rolos de TODOS os fabricantes — cada rolo mostra a que
// fabricante/tipo pertence. Nenhuma regra de negócio de rolo mudou:
// delete guards, arquivamento, histórico, DESCARTADO terminal, bloqueios e
// mensagens reais do backend são preservados.
export function FilamentTypeDrawer({
  group,
  onSummaryChanged,
  onClose,
  onEditType,
  onToggleType,
  onDeleteType,
  pendingToggleTypeId,
}: FilamentTypeDrawerProps) {
  const {
    spools,
    isLoading,
    error,
    refetch,
    create,
    update,
    delete: deleteSpool,
    setLocalSpoolState,
  } = useFilamentSpools(group.filamentTypeIds)

  // filament_type_id -> resumo do tipo, para rotular cada rolo com seu
  // fabricante/linha/cor.
  const typeById = useMemo(() => {
    const map = new Map<string, FilamentTypeSummary>()
    for (const type of group.types) map.set(type.filament_type_id, type)
    return map
  }, [group.types])

  function spoolManufacturerLabel(spool: FilamentSpool): string {
    const type = typeById.get(spool.filament_type_id)
    return type ? `${type.manufacturer} · ${type.line} · ${type.commercial_color}` : '—'
  }

  const [showArchived, setShowArchived] = useState(false)

  // "Novo rolo" — precisa saber a QUAL tipo/fabricante o rolo pertence.
  const [createTargetTypeId, setCreateTargetTypeId] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [editingSpool, setEditingSpool] = useState<FilamentSpool | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [togglingSpool, setTogglingSpool] = useState<FilamentSpool | null>(null)
  const [isToggleDialogOpen, setIsToggleDialogOpen] = useState(false)
  const [isConfirmingToggle, setIsConfirmingToggle] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)

  const [discardingSpool, setDiscardingSpool] = useState<FilamentSpool | null>(null)
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [discardError, setDiscardError] = useState<string | null>(null)

  const [deletingSpool, setDeletingSpool] = useState<FilamentSpool | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [managingSpool, setManagingSpool] = useState<FilamentSpool | null>(null)
  const [isManageDialogOpen, setIsManageDialogOpen] = useState(false)

  const openCount = useMemo(
    () => spools.filter((spool) => spool.status === 'ABERTO').length,
    [spools],
  )
  const exhaustedCount = useMemo(
    () => spools.filter((spool) => spool.status === 'ESGOTADO').length,
    [spools],
  )
  const visibleSpools = useMemo(
    () => (showArchived ? spools : spools.filter((spool) => spool.is_active)),
    [spools, showArchived],
  )
  const stockLevel = getStockLevel(group.availableGrams, group.minimumStockGrams)
  const deletingSpoolHasHistory = deletingSpool?.has_movement_history ?? false
  const createTargetType = createTargetTypeId ? (typeById.get(createTargetTypeId) ?? null) : null

  function openCreateDialog(typeId: string) {
    setCreateTargetTypeId(typeId)
    setCreateError(null)
    setIsCreateDialogOpen(true)
  }

  async function handleCreateSubmit(values: FilamentSpoolFormValues) {
    if (!createTargetTypeId) return
    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      await create({ ...values, filament_type_id: createTargetTypeId })
      toast.success('Rolo cadastrado.')
      setIsCreateDialogOpen(false)
      onSummaryChanged()
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') setCreateError(message)
      else toast.error(message)
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  function openEditDialog(spool: FilamentSpool) {
    setEditingSpool(spool)
    setEditError(null)
    setIsEditDialogOpen(true)
  }

  async function handleEditSubmit(values: FilamentSpoolFormValues) {
    if (!editingSpool) return
    setIsSubmittingEdit(true)
    setEditError(null)
    try {
      await update(editingSpool.id, {
        nominal_weight_grams: values.nominal_weight_grams,
        empty_spool_weight_grams: values.empty_spool_weight_grams,
        received_at: values.received_at,
        status: values.status ?? undefined,
        notes: values.notes,
      })
      toast.success('Rolo atualizado.')
      setIsEditDialogOpen(false)
      onSummaryChanged()
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') setEditError(message)
      else toast.error(message)
    } finally {
      setIsSubmittingEdit(false)
    }
  }

  function openToggleDialog(spool: FilamentSpool) {
    setTogglingSpool(spool)
    setToggleError(null)
    setIsToggleDialogOpen(true)
  }

  async function handleConfirmToggle() {
    if (!togglingSpool) return
    const willActivate = !togglingSpool.is_active
    setIsConfirmingToggle(true)
    setPendingToggleId(togglingSpool.id)
    setToggleError(null)
    try {
      await update(togglingSpool.id, { is_active: willActivate })
      toast.success(`Rolo ${willActivate ? 'ativado' : 'arquivado'}.`)
      setIsToggleDialogOpen(false)
      onSummaryChanged()
    } catch (err) {
      setToggleError(toErrorMessage(err))
    } finally {
      setIsConfirmingToggle(false)
      setPendingToggleId(null)
    }
  }

  function openDiscardDialog(spool: FilamentSpool) {
    setDiscardingSpool(spool)
    setDiscardError(null)
    setIsDiscardDialogOpen(true)
  }

  async function handleConfirmDiscard() {
    if (!discardingSpool) return
    setIsDiscarding(true)
    setDiscardError(null)
    try {
      await update(discardingSpool.id, { status: 'DESCARTADO' })
      toast.success('Rolo descartado.')
      setIsDiscardDialogOpen(false)
      onSummaryChanged()
    } catch (err) {
      setDiscardError(toErrorMessage(err))
    } finally {
      setIsDiscarding(false)
    }
  }

  function openDeleteDialog(spool: FilamentSpool) {
    setDeletingSpool(spool)
    setDeleteError(null)
    setIsDeleteDialogOpen(true)
  }

  async function handleConfirmDelete() {
    if (!deletingSpool) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteSpool(deletingSpool.id)
      toast.success('Rolo excluído.')
      setIsDeleteDialogOpen(false)
      onSummaryChanged()
    } catch (err) {
      setDeleteError(toErrorMessage(err))
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleConfirmArchive() {
    if (!deletingSpool) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await update(deletingSpool.id, { is_active: false })
      toast.success('Rolo arquivado.')
      setIsDeleteDialogOpen(false)
      onSummaryChanged()
    } catch (err) {
      setDeleteError(toErrorMessage(err))
    } finally {
      setIsDeleting(false)
    }
  }

  function openManageDialog(spool: FilamentSpool) {
    setManagingSpool(spool)
    setIsManageDialogOpen(true)
  }

  function SpoolActionsMenu({ spool }: { spool: FilamentSpool }) {
    const isDiscarded = spool.status === 'DESCARTADO'
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Mais ações para o rolo ${spool.code}`}
          render={
            <Button
              variant="outline"
              size="icon-sm"
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0"
            />
          }
        >
          <EllipsisIcon className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => openEditDialog(spool)}>Editar</DropdownMenuItem>
          <DropdownMenuItem
            disabled={pendingToggleId === spool.id}
            onClick={() => openToggleDialog(spool)}
          >
            {spool.is_active ? 'Desativar' : 'Ativar'}
          </DropdownMenuItem>
          {!isDiscarded && (
            <DropdownMenuItem onClick={() => openDiscardDialog(spool)}>Descartar</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => openDeleteDialog(spool)}>
            {spool.has_movement_history ? 'Arquivar rolo' : 'Excluir rolo'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function ManageSpoolButton({ spool }: { spool: FilamentSpool }) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => openManageDialog(spool)}
        aria-label={`Gerenciar rolo ${spool.code} — movimentar, pesar ou consultar histórico`}
        className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0"
      >
        Gerenciar
      </Button>
    )
  }

  function TypeActionsMenu({ type }: { type: FilamentTypeSummary }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Ações do tipo ${type.manufacturer} — ${type.commercial_color}`}
          render={
            <Button
              variant="outline"
              size="icon-sm"
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0"
            />
          }
        >
          <EllipsisIcon className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => onEditType(type)}>Editar tipo</DropdownMenuItem>
          <DropdownMenuItem
            disabled={pendingToggleTypeId === type.filament_type_id}
            onClick={() => onToggleType(type)}
          >
            {type.is_active ? 'Desativar tipo' : 'Ativar tipo'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDeleteType(type)}>Excluir tipo</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* A identificação do grupo (Material - Linha - Cor) fica só no título
          da janela (DialogTitle em FilamentsInventoryPage) — não é repetida
          aqui. O fabricante continua íntegro no banco e por rolo/tipo mais
          abaixo; só não aparece mais como resumo no topo. */}

      {/* Resumo consolidado — soma de vw_filament_type_summary por grupo,
          nunca recalculado aqui. Abertos/Esgotados são contagens de exibição
          dos rolos já carregados. */}
      <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-2 gap-3 rounded-lg border px-3 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Disponível" value={formatGrams(group.availableGrams)} />
        <Field
          label="Rolos disponíveis"
          value={group.availableSpoolCount === null ? '—' : String(group.availableSpoolCount)}
        />
        <Field label="Abertos" value={String(openCount)} />
        <Field label="Esgotados" value={String(exhaustedCount)} />
        <Field
          label="Estoque mínimo"
          value={
            group.minimumStockGrams !== null
              ? formatGrams(group.minimumStockGrams)
              : 'Não informado'
          }
        />
        <div className="flex flex-col gap-0.5">
          <p className="text-muted-foreground text-xs">Situação</p>
          <StockLevelBadge level={stockLevel} />
        </div>
      </div>

      {/* Rolos em estoque do grupo — ações INDIVIDUAIS de tipo por
          filament_type_id (Editar/Ativar/Excluir tipo, Novo rolo). */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Rolos em estoque</p>
        <div className="flex flex-col gap-2">
          {group.types.map((type) => (
            <div
              key={type.filament_type_id}
              data-testid={`filament-type-row-${type.filament_type_id}`}
              className="border-input flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{type.manufacturer}</span>
                <span className="text-muted-foreground text-xs">
                  {type.line} · {type.commercial_color}
                </span>
                {!type.is_active && (
                  <span className="border-input text-muted-foreground inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
                    Inativo
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openCreateDialog(type.filament_type_id)}
                  className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0"
                >
                  Novo rolo
                </Button>
                <TypeActionsMenu type={type} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/10 flex items-center justify-between rounded-lg border p-3 text-sm"
        >
          <span>{toErrorMessage(error)}</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Tentar novamente
          </Button>
        </div>
      )}

      <label className="flex w-fit items-center gap-2 text-sm">
        <Switch
          checked={showArchived}
          onCheckedChange={(checked) => setShowArchived(checked === true)}
          className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
        />
        Mostrar arquivados
      </label>

      {isLoading ? (
        <div role="status" className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <span className="sr-only">Carregando rolos...</span>
        </div>
      ) : spools.length === 0 ? (
        <p role="status" className="text-muted-foreground text-sm">
          Nenhum rolo cadastrado para este grupo.
        </p>
      ) : visibleSpools.length === 0 ? (
        <p role="status" className="text-muted-foreground text-sm">
          Todos os rolos deste grupo estão arquivados. Marque "Mostrar arquivados" para
          consultá-los.
        </p>
      ) : (
        <>
          <div className="hidden sm:block">
            <Table className="table-fixed text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-auto w-[15%] py-2 whitespace-normal">
                    Identificador
                  </TableHead>
                  <TableHead className="h-auto w-[22%] py-2 whitespace-normal">
                    Fabricante / tipo
                  </TableHead>
                  <TableHead className="h-auto w-[21%] py-2 whitespace-normal">Peso</TableHead>
                  <TableHead className="h-auto w-[14%] py-2 whitespace-normal">Status</TableHead>
                  <TableHead className="h-auto w-[28%] py-2 text-right whitespace-normal">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleSpools.map((spool) => (
                  <TableRow
                    key={spool.id}
                    className="odd:bg-brand-primary-soft/50 hover:bg-brand-primary-soft even:bg-white"
                  >
                    <TableCell className="truncate" title={spool.code}>
                      {spool.code}
                    </TableCell>
                    <TableCell className="truncate" title={spoolManufacturerLabel(spool)}>
                      {spoolManufacturerLabel(spool)}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatPeso(spool)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5 whitespace-normal">
                        <span>{spool.status}</span>
                        {!spool.is_active && <ArchivedBadge />}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center justify-end gap-2">
                        <ManageSpoolButton spool={spool} />
                        <SpoolActionsMenu spool={spool} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 sm:hidden">
            {visibleSpools.map((spool) => (
              <Card key={spool.id} size="sm">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{spool.code}</span>
                    {!spool.is_active && <ArchivedBadge />}
                  </div>
                  <div className="text-muted-foreground grid grid-cols-1 gap-1 text-xs">
                    <span>Fabricante / tipo: {spoolManufacturerLabel(spool)}</span>
                    <span>Peso: {formatPeso(spool)}</span>
                    <span>Status: {spool.status}</span>
                    <span>
                      Abertura: {formatDate(spool.opened_at ? spool.opened_at.slice(0, 10) : null)}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <ManageSpoolButton spool={spool} />
                    <SpoolActionsMenu spool={spool} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
        >
          Fechar
        </Button>
      </DialogFooter>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo rolo</DialogTitle>
            <DialogDescription>
              {createTargetType ? typeLabel(createTargetType) : ''}
            </DialogDescription>
          </DialogHeader>
          <FilamentSpoolForm
            idPrefix="filament-spool"
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
            <DialogTitle>Editar rolo</DialogTitle>
            <DialogDescription>{editingSpool?.code}</DialogDescription>
          </DialogHeader>
          {editingSpool && (
            <FilamentSpoolForm
              key={editingSpool.id}
              idPrefix="filament-spool-edit"
              mode="edit"
              initialValues={{
                nominal_weight_grams: editingSpool.nominal_weight_grams,
                empty_spool_weight_grams: editingSpool.empty_spool_weight_grams,
                received_at: editingSpool.received_at,
                status: editingSpool.status,
                notes: editingSpool.notes,
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
            <DialogTitle>{togglingSpool?.is_active ? 'Arquivar rolo' : 'Ativar rolo'}</DialogTitle>
            <DialogDescription>
              {togglingSpool &&
                (togglingSpool.is_active
                  ? `Tem certeza que deseja arquivar o rolo "${togglingSpool.code}"? Um rolo arquivado sai da lista ativa e da quantidade disponível do grupo — o histórico continua acessível.`
                  : `Tem certeza que deseja ativar o rolo "${togglingSpool.code}"?`)}
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
                : togglingSpool?.is_active
                  ? 'Arquivar'
                  : 'Ativar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDiscardDialogOpen} onOpenChange={setIsDiscardDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Descartar rolo</DialogTitle>
            <DialogDescription>
              {discardingSpool &&
                `Tem certeza que deseja descartar o rolo "${discardingSpool.code}"? Esta ação é definitiva — um rolo descartado nunca é reativado automaticamente e deixa de aceitar novas movimentações. O histórico já registrado permanece disponível para consulta.`}
            </DialogDescription>
          </DialogHeader>
          {discardError && (
            <p role="alert" className="text-destructive text-sm">
              {discardError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDiscardDialogOpen(false)}
              disabled={isDiscarding}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmDiscard()}
              disabled={isDiscarding}
            >
              {isDiscarding ? 'Descartando...' : 'Descartar definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deletingSpoolHasHistory ? 'Arquivar rolo' : 'Excluir rolo'}</DialogTitle>
            <DialogDescription>
              {deletingSpool &&
                !deletingSpoolHasHistory &&
                `Tem certeza que deseja excluir o rolo "${deletingSpool.code}"? Esta ação não poderá ser desfeita.`}
              {deletingSpool &&
                deletingSpoolHasHistory &&
                `Este rolo possui histórico e não pode ser apagado definitivamente. Deseja arquivá-lo? Um rolo arquivado sai da lista ativa e da quantidade disponível do grupo, mas todo o histórico permanece acessível (use "Mostrar arquivados" para consultá-lo depois).`}
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
            {deletingSpoolHasHistory ? (
              <Button
                type="button"
                onClick={() => void handleConfirmArchive()}
                disabled={isDeleting}
                className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
              >
                {isDeleting ? 'Arquivando...' : 'Arquivar rolo'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
              >
                {isDeleting ? 'Excluindo...' : 'Excluir definitivamente'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isManageDialogOpen} onOpenChange={setIsManageDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Movimentar / Pesar / Histórico</DialogTitle>
            <DialogDescription>{managingSpool?.code}</DialogDescription>
          </DialogHeader>
          {managingSpool && (
            <FilamentSpoolPanel
              key={managingSpool.id}
              spool={managingSpool}
              filamentTypeLabel={spoolManufacturerLabel(managingSpool)}
              onSpoolChanged={(patch) => {
                setLocalSpoolState(managingSpool.id, patch)
                setManagingSpool((current) => (current ? { ...current, ...patch } : current))
                onSummaryChanged()
              }}
              onClose={() => setIsManageDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
