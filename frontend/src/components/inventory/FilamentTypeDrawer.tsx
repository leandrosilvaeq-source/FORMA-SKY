import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FilamentSpoolForm, type FilamentSpoolFormValues } from './FilamentSpoolForm'
import { FilamentSpoolPanel } from './FilamentSpoolPanel'
import { StockLevelBadge, getStockLevel } from './StockMovementPanel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useFilamentSpools } from '@/hooks/useFilamentSpools'
import { ApiError } from '@/lib/api/errors'
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

export interface FilamentTypeDrawerProps {
  filamentType: FilamentTypeSummary
  // Chamado após qualquer ação que possa afetar o saldo consolidado do tipo
  // (criar/editar/ativar/desativar/descartar/excluir/arquivar rolo, e —
  // repassado ao FilamentSpoolPanel — movimentar/pesar). O chamador
  // (FilamentsInventoryPage) reaproveita o `refetch` de useFilamentTypes:
  // o resumo exibido aqui SEMPRE vem de `filamentType`
  // (vw_filament_type_summary, nunca recalculado em JS) — este callback só
  // pede ao pai para buscar a versão mais recente desse resumo. Achado real
  // da validação manual (2026-08-28): sem isso, o saldo consolidado nunca
  // era atualizado após uma movimentação feita no painel aninhado — a
  // listagem de tipos e este resumo continuavam mostrando o valor do
  // carregamento inicial da página.
  onSummaryChanged: () => void
  onClose: () => void
}

// Ao abrir um tipo: mostra um resumo consolidado (saldo disponível, rolos,
// abertos, esgotados, estoque mínimo, situação — sempre vindo do resumo do
// backend, nunca recalculado aqui) e lista os rolos com identificador, peso
// nominal, peso disponível, percentual estimado restante, status, data de
// abertura e ações (requisito 7). "Movimentar"/"Registrar pesagem"/
// "Consultar histórico" abrem o mesmo FilamentSpoolPanel (painel único com
// as 3 ações), num diálogo aninhado — mesmo padrão já em produção em
// OrderManagementPanel.tsx (diálogo dentro de diálogo).
export function FilamentTypeDrawer({ filamentType, onSummaryChanged, onClose }: FilamentTypeDrawerProps) {
  const { spools, isLoading, error, refetch, create, update, delete: deleteSpool, setLocalSpoolState } = useFilamentSpools(
    filamentType.filament_type_id,
  )

  const [showArchived, setShowArchived] = useState(false)

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

  // Fluxo de exclusão revisado (validação manual, 2026-08-28): um único
  // botão "Excluir rolo" por linha. Se a exclusão física for bloqueada pelo
  // backend (histórico/vínculo — FILAMENT_SPOOL_HAS_MOVEMENTS:, já mapeado
  // para business_rule/409), o MESMO diálogo pivota para oferecer
  // "Arquivar rolo" (is_active=false, contrato já existente) em vez de
  // deixar o usuário num beco sem saída com um erro cru. offerArchive
  // controla qual dos dois modos o diálogo mostra.
  const [deletingSpool, setDeletingSpool] = useState<FilamentSpool | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [offerArchive, setOfferArchive] = useState(false)

  const [managingSpool, setManagingSpool] = useState<FilamentSpool | null>(null)
  const [isManageDialogOpen, setIsManageDialogOpen] = useState(false)

  // "Rolos abertos"/"rolos esgotados" no resumo: uma contagem por status dos
  // rolos JÁ carregados para a tabela abaixo — não é o mesmo cálculo que
  // total_available_grams/usable_spool_count (que vêm sempre do resumo do
  // backend, vw_filament_type_summary, nunca recalculados aqui). Contar
  // quantas linhas já renderizadas têm um status específico é uma agregação
  // de exibição comum, não uma segunda fonte de verdade para o saldo.
  const openCount = useMemo(() => spools.filter((spool) => spool.status === 'ABERTO').length, [spools])
  const exhaustedCount = useMemo(() => spools.filter((spool) => spool.status === 'ESGOTADO').length, [spools])
  const visibleSpools = useMemo(() => (showArchived ? spools : spools.filter((spool) => spool.is_active)), [spools, showArchived])
  const stockLevel = getStockLevel(filamentType.total_available_grams, filamentType.minimum_stock_grams)

  async function handleCreateSubmit(values: FilamentSpoolFormValues) {
    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      await create(values)
      toast.success('Rolo cadastrado.')
      setIsCreateDialogOpen(false)
      onSummaryChanged()
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
      if (err instanceof ApiError && err.type === 'validation') {
        setEditError(message)
      } else {
        toast.error(message)
      }
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
      toast.success(`Rolo ${willActivate ? 'ativado' : 'desativado'}.`)
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

  // Descarte é uma ação separada de ativar/desativar (eixo independente, ver
  // migration) e é terminal: a RPC nunca permite reverter status=DESCARTADO
  // de volta — por isso a confirmação aqui é mais enfática que a de
  // ativar/desativar.
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
    setOfferArchive(false)
    setIsDeleteDialogOpen(true)
  }

  // Tenta a exclusão física primeiro (a única forma de saber com certeza se
  // o rolo tem histórico é perguntar ao backend, que já faz essa checagem
  // de forma confiável em delete_filament_spool — nunca duplicada aqui).
  // Bloqueio por vínculo (business_rule/409) pivota o mesmo diálogo para
  // oferecer arquivamento, em vez de deixar o usuário com um erro sem
  // próximo passo.
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
      if (err instanceof ApiError && err.type === 'business_rule') {
        setOfferArchive(true)
      } else {
        setDeleteError(toErrorMessage(err))
      }
    } finally {
      setIsDeleting(false)
    }
  }

  // Arquivamento = is_active=false (contrato já existente, mesmo usado pelo
  // Switch "Ativo" da tabela) — nunca um hard delete quando há histórico.
  // Um rolo arquivado sai da lista ativa (a menos que "Mostrar arquivados"
  // esteja marcado) e do saldo disponível do tipo (vw_filament_type_summary
  // já exclui is_active=false), mas o histórico permanece consultável.
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-xs">Tipo de filamento</p>
          <p className="text-base font-medium">{typeLabel(filamentType)}</p>
        </div>
        <Button
          onClick={() => {
            setCreateError(null)
            setIsCreateDialogOpen(true)
          }}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark shrink-0"
        >
          Novo rolo
        </Button>
      </div>

      {/* Resumo consolidado — requisito 3: sempre o resumo devolvido pelo
          backend (filamentType, vw_filament_type_summary), nunca
          recalculado aqui. Abertos/Esgotados são contagens de exibição dos
          rolos já carregados, não uma segunda fonte para o saldo em si. */}
      <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-2 gap-3 rounded-lg border px-3 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Disponível" value={formatGrams(filamentType.total_available_grams)} />
        <Field label="Rolos" value={String(filamentType.total_spool_count)} />
        <Field label="Abertos" value={String(openCount)} />
        <Field label="Esgotados" value={String(exhaustedCount)} />
        <Field
          label="Estoque mínimo"
          value={filamentType.minimum_stock_grams !== null ? formatGrams(filamentType.minimum_stock_grams) : 'Não informado'}
        />
        <div className="flex flex-col gap-0.5">
          <p className="text-muted-foreground text-xs">Situação</p>
          <StockLevelBadge level={stockLevel} />
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

      {/* Sem aria-label explícito no Switch: o <label> ao redor já provê o
          nome acessível via aria-labelledby automático do base-ui — passar
          os dois ao mesmo tempo duplicava o nome computado ("Mostrar
          arquivados Mostrar arquivados"). */}
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
          Nenhum rolo cadastrado para este tipo.
        </p>
      ) : visibleSpools.length === 0 ? (
        <p role="status" className="text-muted-foreground text-sm">
          Todos os rolos deste tipo estão arquivados. Marque "Mostrar arquivados" para consultá-los.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[900px] table-fixed text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="h-auto w-[12%] py-2 whitespace-normal">Identificador</TableHead>
                <TableHead className="h-auto w-[10%] py-2 text-right whitespace-normal">Peso nominal</TableHead>
                <TableHead className="h-auto w-[10%] py-2 text-right whitespace-normal">Peso disponível</TableHead>
                <TableHead className="h-auto w-[8%] py-2 text-right whitespace-normal">% restante</TableHead>
                <TableHead className="h-auto w-[10%] py-2 whitespace-normal">Status</TableHead>
                <TableHead className="h-auto w-[10%] py-2 whitespace-normal">Abertura</TableHead>
                <TableHead className="h-auto w-[8%] py-2 whitespace-normal">Ativo</TableHead>
                <TableHead className="h-auto w-[32%] py-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSpools.map((spool) => {
                const percentRemaining = Math.round((spool.current_net_weight_grams / spool.nominal_weight_grams) * 100)
                const isDiscarded = spool.status === 'DESCARTADO'
                const isArchived = !spool.is_active
                return (
                  <TableRow key={spool.id} className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft">
                    <TableCell className="truncate" title={spool.code}>
                      {spool.code}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatGrams(spool.nominal_weight_grams)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatGrams(spool.current_net_weight_grams)}</TableCell>
                    <TableCell className="text-right tabular-nums">{percentRemaining}%</TableCell>
                    <TableCell>{spool.status}</TableCell>
                    <TableCell>{formatDate(spool.opened_at ? spool.opened_at.slice(0, 10) : null)}</TableCell>
                    <TableCell>
                      <Switch
                        checked={spool.is_active}
                        disabled={pendingToggleId === spool.id}
                        onCheckedChange={() => openToggleDialog(spool)}
                        aria-label={`${spool.is_active ? 'Desativar' : 'Ativar'} rolo ${spool.code}`}
                        className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(spool)}
                          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                        >
                          Editar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openManageDialog(spool)}
                          disabled={isArchived}
                          aria-label={
                            isArchived
                              ? `Rolo ${spool.code} arquivado — reative para movimentar, pesar ou consultar histórico`
                              : `Movimentar, pesar ou consultar histórico — rolo ${spool.code}`
                          }
                          title={isArchived ? 'Rolo arquivado — reative para movimentar.' : undefined}
                          className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                        >
                          Movimentar / Pesar
                        </Button>
                        {!isDiscarded && (
                          <Button variant="destructive" size="sm" onClick={() => openDiscardDialog(spool)} aria-label={`Descartar rolo ${spool.code}`}>
                            Descartar
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openDeleteDialog(spool)}
                          aria-label={`Excluir rolo ${spool.code}`}
                        >
                          Excluir rolo
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

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark">
          Fechar
        </Button>
      </DialogFooter>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo rolo</DialogTitle>
            <DialogDescription>{typeLabel(filamentType)}</DialogDescription>
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
            <DialogTitle>{togglingSpool?.is_active ? 'Desativar rolo' : 'Ativar rolo'}</DialogTitle>
            <DialogDescription>
              {togglingSpool &&
                (togglingSpool.is_active
                  ? `Tem certeza que deseja desativar o rolo "${togglingSpool.code}"? Um rolo inativo deixa de contar na quantidade disponível do tipo.`
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
              {isConfirmingToggle ? 'Salvando...' : togglingSpool?.is_active ? 'Desativar' : 'Ativar'}
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
            <Button type="button" variant="destructive" onClick={() => void handleConfirmDiscard()} disabled={isDiscarding}>
              {isDiscarding ? 'Descartando...' : 'Descartar definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{offerArchive ? 'Arquivar rolo' : 'Excluir rolo'}</DialogTitle>
            <DialogDescription>
              {deletingSpool && !offerArchive &&
                `Tem certeza que deseja excluir o rolo "${deletingSpool.code}"? Esta ação não poderá ser desfeita.`}
              {deletingSpool && offerArchive &&
                `O rolo "${deletingSpool.code}" possui histórico de movimentações e não pode ser excluído fisicamente. Deseja arquivá-lo? Um rolo arquivado sai da lista ativa e da quantidade disponível do tipo, mas o histórico continua acessível (use "Mostrar arquivados" para consultá-lo depois).`}
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
            {offerArchive ? (
              <Button
                type="button"
                onClick={() => void handleConfirmArchive()}
                disabled={isDeleting}
                className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
              >
                {isDeleting ? 'Arquivando...' : 'Arquivar rolo'}
              </Button>
            ) : (
              <Button type="button" variant="destructive" onClick={() => void handleConfirmDelete()} disabled={isDeleting}>
                {isDeleting ? 'Excluindo...' : 'Excluir definitivamente'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isManageDialogOpen} onOpenChange={setIsManageDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Movimentar / Pesar / Histórico</DialogTitle>
            <DialogDescription>{managingSpool?.code}</DialogDescription>
          </DialogHeader>
          {managingSpool && (
            <FilamentSpoolPanel
              key={managingSpool.id}
              spool={managingSpool}
              filamentTypeLabel={typeLabel(filamentType)}
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
