import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { EllipsisIcon } from 'lucide-react'
import { FilamentSpoolForm, type FilamentSpoolFormValues } from './FilamentSpoolForm'
import { FilamentSpoolPanel } from './FilamentSpoolPanel'
import { StockLevelBadge, getStockLevel } from './StockMovementPanel'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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

// Peso nominal + disponível + % restante mesclados numa única célula —
// eram 3 colunas separadas, uma das causas do min-width forçando rolagem
// horizontal em resolução normal de notebook (achado real da segunda
// rodada de validação manual, 2026-08-28).
function formatPeso(spool: FilamentSpool): string {
  const percentRemaining = Math.round((spool.current_net_weight_grams / spool.nominal_weight_grams) * 100)
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
  filamentType: FilamentTypeSummary
  // Chamado após qualquer ação que possa afetar o saldo consolidado do tipo
  // (criar/editar/ativar/desativar/descartar/excluir/arquivar rolo, e —
  // repassado ao FilamentSpoolPanel — movimentar/pesar). O chamador
  // (FilamentsInventoryPage) reaproveita o `refetch` de useFilamentTypes: o
  // resumo exibido aqui SEMPRE vem de `filamentType` (vw_filament_type_summary,
  // nunca recalculado em JS) — este callback só pede ao pai para buscar a
  // versão mais recente desse resumo.
  onSummaryChanged: () => void
  onClose: () => void
}

// Ao abrir um tipo: mostra um resumo consolidado (saldo disponível, rolos,
// abertos, esgotados, estoque mínimo, situação — sempre vindo do resumo do
// backend, nunca recalculado aqui) e lista os rolos com identificador, peso,
// status, data de abertura e ações (requisito 7). "Movimentar"/"Registrar
// pesagem"/"Consultar histórico" abrem o mesmo FilamentSpoolPanel (painel
// único com as 3 ações), num diálogo aninhado — mesmo padrão já em produção
// em OrderManagementPanel.tsx (diálogo dentro de diálogo). Tabela (desktop)
// e cartões (telas pequenas) mostram os mesmos dados/ações — nunca uma
// tabela larga forçada a rolar em resolução normal de notebook.
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

  // Fluxo de exclusão/arquivamento revisado (validação manual, 2026-08-28,
  // SEGUNDA rodada): a rodada anterior tentava hard delete primeiro e
  // decidia arquivar só depois de capturar um erro de negócio — não
  // funcionou como esperado na prática. Agora a decisão é tomada ANTES de
  // qualquer confirmação, a partir de spool.has_movement_history (campo
  // confiável e não-textual — ver comentário em lib/api/filamentSpools.ts).
  // deletingSpool?.has_movement_history sozinho já determina qual dos dois
  // diálogos/ações aparece — nenhum estado extra (offerArchive) é
  // necessário.
  const [deletingSpool, setDeletingSpool] = useState<FilamentSpool | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [managingSpool, setManagingSpool] = useState<FilamentSpool | null>(null)
  const [isManageDialogOpen, setIsManageDialogOpen] = useState(false)

  // "Rolos abertos"/"rolos esgotados" no resumo: uma contagem por status dos
  // rolos JÁ carregados para a tabela abaixo — não é o mesmo cálculo que
  // total_available_grams/usable_spool_count (que vêm sempre do resumo do
  // backend, vw_filament_type_summary, nunca recalculados aqui).
  const openCount = useMemo(() => spools.filter((spool) => spool.status === 'ABERTO').length, [spools])
  const exhaustedCount = useMemo(() => spools.filter((spool) => spool.status === 'ESGOTADO').length, [spools])
  const visibleSpools = useMemo(() => (showArchived ? spools : spools.filter((spool) => spool.is_active)), [spools, showArchived])
  const stockLevel = getStockLevel(filamentType.total_available_grams, filamentType.minimum_stock_grams)
  const deletingSpoolHasHistory = deletingSpool?.has_movement_history ?? false

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
    setIsDeleteDialogOpen(true)
  }

  // Só chamada quando deletingSpool.has_movement_history é false — o
  // backend (delete_filament_spool) continua sendo a proteção definitiva
  // (defesa em profundidade: se o indicador local estiver desatualizado por
  // uma corrida real, o erro de negócio ainda aparece aqui, sem excluir
  // nada e sem fechar o diálogo).
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

  // Só chamada quando deletingSpool.has_movement_history é true. Arquivamento
  // = is_active=false (contrato já existente, mesmo usado pelo Switch
  // "Ativo" da tabela) — nunca um hard delete quando há histórico. Um rolo
  // arquivado sai da lista ativa (a menos que "Mostrar arquivados" esteja
  // marcado) e do saldo disponível do tipo (vw_filament_type_summary já
  // exclui is_active=false), mas o histórico permanece consultável.
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

  // Menu compacto (Editar/Ativar-ou-desativar/Descartar/Excluir ou Arquivar
  // rolo) — reaproveitado pela tabela (desktop) e pelos cartões (telas
  // pequenas). Terceira rodada de validação manual (2026-08-28): a coluna
  // "Ativo" (Switch) e o botão largo "Movimentar / Pesar" foram removidos —
  // ativar/desativar virou item deste menu, e o botão de gatilho agora é só
  // o ícone de três pontos (sem texto visível), para que a célula de ações
  // caiba em ~720px de largura de diálogo sem sobrepor o botão "Gerenciar".
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
          {!isDiscarded && <DropdownMenuItem onClick={() => openDiscardDialog(spool)}>Descartar</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => openDeleteDialog(spool)}>
            {spool.has_movement_history ? 'Arquivar rolo' : 'Excluir rolo'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Botão "Gerenciar" (abre o FilamentSpoolPanel — Movimentar / Pesar /
  // Histórico) — reaproveitado pela tabela e pelos cartões. Para um rolo
  // arquivado, continua clicável: o painel já restringe sozinho a apenas
  // consultar o histórico (isArchived/isReadOnly em FilamentSpoolPanel.tsx),
  // nunca bloqueado aqui na linha.
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
          nome acessível via aria-labelledby automático do base-ui. */}
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
        <>
          {/* Tabela: só a partir de sm (≥640px) — 5 colunas semânticas
              (Identificador, Peso, Status, Abertura, Ações). Terceira rodada
              de validação manual (2026-08-28): a coluna "Ativo" (Switch) foi
              removida — ativo/arquivado agora aparece como badge junto ao
              Status; e as DUAS colunas de ação ("Movimentar / Pesar" +
              três-pontos) viraram UMA só (Gerenciar + três-pontos, num
              único flex com gap), causa raiz real do botão sobreposto e da
              rolagem horizontal num diálogo de ~720px. Sem overflow-x-auto
              próprio nem min-w no <Table>: table-fixed + larguras
              percentuais bastam porque o conteúdo de cada célula agora cabe
              genuinamente no orçamento de ~720px — não escondemos rolagem
              com overflow-x-hidden, simplesmente deixou de haver conteúdo
              que precise rolar. */}
          <div className="hidden sm:block">
            <Table className="table-fixed text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-auto w-[16%] py-2 whitespace-normal">Identificador</TableHead>
                  <TableHead className="h-auto w-[26%] py-2 whitespace-normal">Peso</TableHead>
                  <TableHead className="h-auto w-[18%] py-2 whitespace-normal">Status</TableHead>
                  <TableHead className="h-auto w-[14%] py-2 whitespace-normal">Abertura</TableHead>
                  <TableHead className="h-auto w-[26%] py-2 text-right whitespace-normal">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleSpools.map((spool) => (
                  <TableRow key={spool.id} className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft">
                    <TableCell className="truncate" title={spool.code}>
                      {spool.code}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatPeso(spool)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5 whitespace-normal">
                        <span>{spool.status}</span>
                        {!spool.is_active && <ArchivedBadge />}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(spool.opened_at ? spool.opened_at.slice(0, 10) : null)}</TableCell>
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

          {/* Cartões: abaixo de sm — cada rolo vira um bloco empilhado, sem
              depender de uma tabela larga (requisito explícito da segunda
              rodada de validação manual, mantido na terceira). Gerenciar e
              três-pontos ficam em linha própria, igual à tabela. */}
          <div className="flex flex-col gap-3 sm:hidden">
            {visibleSpools.map((spool) => (
              <Card key={spool.id} size="sm">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{spool.code}</span>
                    {!spool.is_active && <ArchivedBadge />}
                  </div>
                  <div className="text-muted-foreground grid grid-cols-2 gap-1 text-xs">
                    <span>Peso: {formatPeso(spool)}</span>
                    <span>Status: {spool.status}</span>
                    <span>Abertura: {formatDate(spool.opened_at ? spool.opened_at.slice(0, 10) : null)}</span>
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
            <DialogTitle>{togglingSpool?.is_active ? 'Arquivar rolo' : 'Ativar rolo'}</DialogTitle>
            <DialogDescription>
              {togglingSpool &&
                (togglingSpool.is_active
                  ? `Tem certeza que deseja arquivar o rolo "${togglingSpool.code}"? Um rolo arquivado sai da lista ativa e da quantidade disponível do tipo — o histórico continua acessível.`
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
              {isConfirmingToggle ? 'Salvando...' : togglingSpool?.is_active ? 'Arquivar' : 'Ativar'}
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

      {/* Excluir/Arquivar: qual das duas ações aparece é decidido ANTES da
          confirmação, a partir de deletingSpoolHasHistory (dado já
          carregado, nunca a partir do texto de um erro — achado real da
          segunda rodada de validação manual, 2026-08-28). */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deletingSpoolHasHistory ? 'Arquivar rolo' : 'Excluir rolo'}</DialogTitle>
            <DialogDescription>
              {deletingSpool && !deletingSpoolHasHistory &&
                `Tem certeza que deseja excluir o rolo "${deletingSpool.code}"? Esta ação não poderá ser desfeita.`}
              {deletingSpool && deletingSpoolHasHistory &&
                `Este rolo possui histórico e não pode ser apagado definitivamente. Deseja arquivá-lo? Um rolo arquivado sai da lista ativa e da quantidade disponível do tipo, mas todo o histórico permanece acessível (use "Mostrar arquivados" para consultá-lo depois).`}
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
