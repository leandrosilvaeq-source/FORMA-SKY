import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { EllipsisIcon, SlidersHorizontalIcon } from 'lucide-react'
import { FilamentSpoolForm, type FilamentSpoolFormValues } from './FilamentSpoolForm'
import { FilamentSpoolHistoryDialog } from './FilamentSpoolHistoryDialog'
import { FilamentSpoolStatusControl } from './FilamentSpoolStatusControl'
import { FilamentSpoolWeightAdjustDialog } from './FilamentSpoolWeightAdjustDialog'
import { StockLevelBadge, getStockLevel } from './StockMovementPanel'
import { UNSPECIFIED_MANUFACTURER } from './FilamentTypeForm'
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
import type { FilamentSpool, FilamentSpoolStatus, FilamentTypeSummary } from '@/types/domain'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}g`
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
  // CORREÇÃO (2026-09-04): sobe quando um tipo do grupo é arquivado/removido
  // pelos botões do próprio rodapé desta janela ("Excluir tipo") — esse
  // diálogo de confirmação é ANINHADO (aberto de dentro do drawer, que
  // continua montado por baixo dele) e arquivar um tipo também arquiva
  // todos os seus rolos no backend, deixando a tabela de rolos aqui
  // desatualizada até o sinal chegar. Nunca sobe por ações de DENTRO desta
  // janela (criar/editar/excluir rolo, pesar), que já atualizam seus
  // próprios rolos localmente, nem por uma compra (que nunca acontece com
  // esta janela aberta ao mesmo tempo — diálogos de nível de página não-
  // aninhados). O drawer reage à mudança do número refazendo sua própria
  // busca de rolos (useFilamentSpools), nunca por polling — só quando o
  // valor realmente muda.
  refreshSignal: number
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
// vw_filament_type_summary, somados por grupo); logo abaixo do título
// "Rolos em estoque", a lista física dos rolos de TODOS os fabricantes do
// grupo — cada rolo mostra a que fabricante/tipo pertence; e, no rodapé,
// os controles inferiores: "Mostrar arquivados" e os botões de ação de
// TIPO (Novo rolo / Editar tipo / Ativar-Desativar tipo / Excluir tipo),
// um conjunto por tipo, cada um ligado ao seu filament_type_id. Nenhuma
// regra de negócio de rolo mudou: delete guards, arquivamento, histórico,
// DESCARTADO terminal, bloqueios e mensagens reais do backend são
// preservados.
export function FilamentTypeDrawer({
  group,
  onSummaryChanged,
  refreshSignal,
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

  // CORREÇÃO (2026-09-04): refaz a busca de rolos quando refreshSignal muda
  // DEPOIS da primeira renderização — nunca no mount inicial (useFilamentSpools
  // já busca sozinho ao montar; refazer aqui também seria uma requisição
  // duplicada). Como o drawer inteiro desmonta ao fechar (só é renderizado
  // enquanto `openGroup` existe, em FilamentsInventoryPage.tsx), a primeira
  // renderização de CADA abertura reinicia esta guarda — o efeito só dispara
  // de verdade quando algo muda por fora enquanto a janela está aberta (hoje,
  // só um tipo do grupo sendo arquivado pelo próprio rodapé deste drawer —
  // ver o comentário de refreshSignal na interface acima).
  const isFirstRenderRef = useRef(true)
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    refetch()
  }, [refreshSignal, refetch])

  // filament_type_id -> resumo do tipo, para rotular cada rolo com seu
  // fabricante/linha/cor.
  const typeById = useMemo(() => {
    const map = new Map<string, FilamentTypeSummary>()
    for (const type of group.types) map.set(type.filament_type_id, type)
    return map
  }, [group.types])

  // Marca (2026-09-04) — DISTINTA de "Fabricante / tipo" acima: aquela é
  // sempre o fabricante do TIPO (mesmo valor para todo rolo do tipo); esta é
  // a marca REAL desta compra específica, que pode variar rolo a rolo dentro
  // do mesmo tipo. Fonte, nesta ordem: (1) purchase_item_manufacturer — rolo
  // nascido da compra multi-item (2026-09-04), derivado de
  // inventory_purchase_filament_items via purchase_item_id, já calculado em
  // lote por listFilamentSpools (nunca uma consulta por rolo aqui); (2) na
  // ausência dele (rolo antigo, sem purchase_item_id), o fabricante
  // histórico do TIPO — já carregado em typeById, sem nenhuma consulta
  // extra; (3) "—" quando nenhum dos dois é um valor real (vazio ou o
  // marcador interno "Não informado"). Nunca grava nada — leitura pura.
  function spoolMarcaLabel(spool: FilamentSpool): string {
    const purchaseManufacturer = spool.purchase_item_manufacturer?.trim()
    if (purchaseManufacturer) return purchaseManufacturer
    const historical = typeById.get(spool.filament_type_id)?.manufacturer?.trim()
    if (historical && historical !== UNSPECIFIED_MANUFACTURER) return historical
    return '—'
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

  const [deletingSpool, setDeletingSpool] = useState<FilamentSpool | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Janela simplificada "Ajustar peso" (2026-09-05) — substitui o antigo
  // atalho que abria a janela "Gerenciar" com "Ajuste" pré-selecionado.
  const [adjustingSpool, setAdjustingSpool] = useState<FilamentSpool | null>(null)

  // Janela dedicada de histórico (2026-09-05), aberta pelo item "Histórico"
  // do menu de três pontos — nunca mais a antiga janela "Gerenciar".
  const [historySpool, setHistorySpool] = useState<FilamentSpool | null>(null)

  // Id do rolo com uma mudança de status em andamento — evita clique duplo
  // no dropdown/menu enquanto a chamada ao backend ainda não voltou.
  const [pendingStatusSpoolId, setPendingStatusSpoolId] = useState<string | null>(null)

  // Rolo aguardando confirmação explícita antes de ser marcado DESCARTADO
  // (terminal — ver update_filament_spool/FILAMENT_SPOOL_DISCARD_IS_FINAL).
  // Nenhuma outra transição de status pede confirmação.
  const [discardCandidate, setDiscardCandidate] = useState<FilamentSpool | null>(null)

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

  function openDeleteDialog(spool: FilamentSpool) {
    setDeletingSpool(spool)
    setDeleteError(null)
    setIsDeleteDialogOpen(true)
  }

  // Regra revisada do usuário (2026-09-03) para "Excluir rolo":
  //  - rolo SEM movimentações  -> exclusão física definitiva
  //    (delete_filament_spool, DELETE /filament-spools/:id; a RPC nunca
  //    cascateia e as FKs de filament_movements continuam intactas).
  //  - rolo COM movimentações -> NÃO chama DELETE: só arquiva o rolo
  //    (is_active=false via update_filament_spool, o mesmo mecanismo de
  //    inativação segura que já existia). O histórico (pesagens, entradas,
  //    perdas, ajustes) é preservado por inteiro; o rolo sai da listagem
  //    padrão, das contagens e dos resumos, e continua acessível em
  //    "Mostrar arquivados". Nenhum erro por possuir movimentações neste
  //    fluxo.
  //  - rolo VINCULADO A PEDIDO -> deveria bloquear as duas operações. Não
  //    existe hoje NENHUMA estrutura que ligue rolo a pedido
  //    (filament_movements.reference_type/reference_id são campos
  //    reservados, nunca populados; nenhuma tabela/coluna/RPC associa
  //    filament_spools a orders). Essa proteção será implementada junto ao
  //    motor Pedidos -> Estoque do Módulo 3 — aqui não se inventa nenhuma
  //    verificação falsa.
  const deletingSpoolHasHistory = deletingSpool?.has_movement_history ?? false

  async function handleConfirmRemoveSpool() {
    if (!deletingSpool) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      if (deletingSpool.has_movement_history) {
        await update(deletingSpool.id, { is_active: false })
        toast.success('Rolo removido do estoque. Histórico preservado.')
      } else {
        await deleteSpool(deletingSpool.id)
        toast.success('Rolo excluído.')
      }
      setIsDeleteDialogOpen(false)
      onSummaryChanged()
    } catch (err) {
      setDeleteError(toErrorMessage(err))
    } finally {
      setIsDeleting(false)
    }
  }

  // Status interativo (2026-09-05) — substitui o botão "Gerenciar"/a antiga
  // aba "Movimentar" para trocar de status. Sempre passa por
  // update_filament_spool (a MESMA rota/regra já usada por Editar rolo),
  // nunca um estado só visual: só é aplicado ao estado local depois da
  // resposta do backend. DESCARTADO é terminal (FILAMENT_SPOOL_DISCARD_IS_FINAL)
  // — a proteção real continua no backend, esta função só evita uma
  // chamada previsivelmente rejeitada.
  async function applyStatusChange(spool: FilamentSpool, status: FilamentSpoolStatus) {
    setPendingStatusSpoolId(spool.id)
    try {
      await update(spool.id, { status })
      toast.success('Status atualizado.')
      onSummaryChanged()
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setPendingStatusSpoolId(null)
    }
  }

  // Selecionar a opção JÁ atual nunca chega aqui (FilamentSpoolStatusControl
  // desabilita o próprio item) — o `status === spool.status` abaixo é só uma
  // segunda barreira. Mudar para DESCARTADO sempre pede confirmação
  // explícita antes de gravar (evita descarte acidental); as demais
  // transições são imediatas.
  function handleStatusSelect(spool: FilamentSpool, status: FilamentSpoolStatus) {
    if (status === spool.status) return
    if (status === 'DESCARTADO') {
      setDiscardCandidate(spool)
      return
    }
    void applyStatusChange(spool, status)
  }

  async function handleConfirmDiscard() {
    if (!discardCandidate) return
    await applyStatusChange(discardCandidate, 'DESCARTADO')
    setDiscardCandidate(null)
  }

  // Menu de três pontos de cada rolo físico — "Editar" e "Excluir rolo"
  // (Desativar/Arquivar não voltam ao menu), mais "Abrir rolo" e "Histórico"
  // (2026-09-05). "Excluir rolo" resolve entre exclusão física (sem
  // histórico) e arquivamento com preservação do histórico (com
  // movimentações) — ver handleConfirmRemoveSpool. Um rolo já arquivado
  // (is_active=false) já foi removido do estoque ativo: "Excluir rolo" fica
  // desabilitado para não repetir a remoção. "Abrir rolo" usa a MESMA regra
  // de backend do dropdown de Status (applyStatusChange/update_filament_spool)
  // — só aparece quando o rolo está ativo e ainda não está ABERTO nem
  // DESCARTADO (terminal).
  function SpoolActionsMenu({ spool }: { spool: FilamentSpool }) {
    const canOpen = spool.is_active && spool.status !== 'ABERTO' && spool.status !== 'DESCARTADO'
    const isPending = pendingStatusSpoolId === spool.id
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
            disabled={!spool.is_active}
            onClick={() => openDeleteDialog(spool)}
            className="text-destructive data-highlighted:text-destructive"
          >
            Excluir rolo
          </DropdownMenuItem>
          {canOpen && (
            <DropdownMenuItem disabled={isPending} onClick={() => handleStatusSelect(spool, 'ABERTO')}>
              Abrir rolo
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setHistorySpool(spool)}>Histórico</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Botão compacto (2026-09-05) — mesmo ícone de antes (SlidersHorizontalIcon),
  // agora só o ícone (rótulo continua acessível via aria-label) para caber
  // ao lado do menu de três pontos dentro da coluna "Ações". Abre a janela
  // simplificada FilamentSpoolWeightAdjustDialog em vez da antiga janela
  // "Gerenciar" com "Ajuste" pré-selecionado. Desabilitado para um rolo
  // DESCARTADO (terminal) ou arquivado — mesma regra que já bloqueava
  // Movimentar/Pesar dentro da antiga janela "Gerenciar"
  // (FilamentSpoolPanel.isReadOnly).
  function AdjustWeightButton({ spool }: { spool: FilamentSpool }) {
    const disabled = spool.status === 'DESCARTADO' || !spool.is_active
    return (
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => setAdjustingSpool(spool)}
        aria-label={`Ajustar peso do rolo ${spool.code}`}
        disabled={disabled}
        className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0"
      >
        <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
      </Button>
    )
  }

  // As ações de TIPO (por filament_type_id) eram um menu de três pontos numa
  // linha redundante acima da tabela; agora são botões visíveis no rodapé da
  // janela. Um conjunto por tipo — quando o grupo reúne tipos históricos de
  // fabricantes diferentes, cada conjunto é rotulado e ligado ao seu
  // filament_type_id, nunca ao tipo errado. Os callbacks (onEditType /
  // onToggleType / onDeleteType / openCreateDialog) e seus diálogos e
  // confirmações continuam os mesmos — só muda o gatilho.
  function TypeActionButtons({
    type,
    showLabel,
  }: {
    type: FilamentTypeSummary
    showLabel: boolean
  }) {
    return (
      <div
        role="group"
        aria-label={`Ações do tipo ${type.manufacturer} — ${type.commercial_color}`}
        className="flex flex-col gap-1.5"
      >
        {showLabel && (
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
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openCreateDialog(type.filament_type_id)}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
          >
            Novo rolo
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditType(type)}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
          >
            Editar tipo
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pendingToggleTypeId === type.filament_type_id}
            onClick={() => onToggleType(type)}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
          >
            {type.is_active ? 'Desativar tipo' : 'Ativar tipo'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!type.is_active}
            onClick={() => onDeleteType(type)}
          >
            Excluir tipo
          </Button>
        </div>
      </div>
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

      {/* Rolos em estoque — a listagem física dos rolos vem logo abaixo do
          título. Não há mais a linha redundante de tipo/fabricante aqui: as
          ações de TIPO foram para os botões do rodapé (TypeActionButtons) e
          o menu de três pontos de cada rolo físico continua na coluna
          "Ações" da tabela/card. */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Rolos em estoque</p>

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
                    <TableHead className="h-auto w-[18%] py-2 whitespace-normal">
                      Identificador
                    </TableHead>
                    <TableHead className="h-auto w-[20%] py-2 whitespace-normal">Marca</TableHead>
                    <TableHead className="h-auto w-[19%] py-2 whitespace-normal">
                      Peso Líquido
                    </TableHead>
                    <TableHead className="h-auto w-[19%] py-2 whitespace-normal">Status</TableHead>
                    <TableHead className="h-auto w-[24%] py-2 text-right whitespace-normal">
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
                      <TableCell className="truncate" title={spoolMarcaLabel(spool)}>
                        {spoolMarcaLabel(spool)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatGrams(spool.current_net_weight_grams)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5 whitespace-normal">
                          <FilamentSpoolStatusControl
                            spoolCode={spool.code}
                            status={spool.status}
                            disabled={!spool.is_active || pendingStatusSpoolId === spool.id}
                            onSelect={(status) => handleStatusSelect(spool, status)}
                          />
                          {!spool.is_active && <ArchivedBadge />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-center justify-end gap-2">
                          <AdjustWeightButton spool={spool} />
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
                      <span>Marca: {spoolMarcaLabel(spool)}</span>
                      <span>Peso Líquido: {formatGrams(spool.current_net_weight_grams)}</span>
                    </div>
                    <FilamentSpoolStatusControl
                      spoolCode={spool.code}
                      status={spool.status}
                      disabled={!spool.is_active || pendingStatusSpoolId === spool.id}
                      onSelect={(status) => handleStatusSelect(spool, status)}
                    />
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <AdjustWeightButton spool={spool} />
                      <SpoolActionsMenu spool={spool} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
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

      {/* Controles e ações inferiores — depois da tabela/cards/estado vazio:
          o filtro "Mostrar arquivados" e, abaixo dele, os botões de ação do
          tipo (um conjunto por tipo do grupo). */}
      <div className="flex flex-col gap-3 border-t pt-4">
        <label className="flex w-fit items-center gap-2 text-sm">
          <Switch
            checked={showArchived}
            onCheckedChange={(checked) => setShowArchived(checked === true)}
            className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
          />
          Mostrar arquivados
        </label>

        <div className="flex flex-col gap-3">
          {group.types.map((type) => (
            <TypeActionButtons
              key={type.filament_type_id}
              type={type}
              showLabel={group.types.length > 1}
            />
          ))}
        </div>
      </div>

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

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deletingSpoolHasHistory ? 'Remover rolo do estoque' : 'Excluir rolo'}
            </DialogTitle>
            <DialogDescription>
              {deletingSpool &&
                (deletingSpoolHasHistory
                  ? 'Este rolo possui histórico. Ele será removido do estoque ativo, mas suas movimentações serão preservadas.'
                  : `Tem certeza que deseja excluir o rolo "${deletingSpool.code}"? Esta exclusão é permanente e não poderá ser desfeita — não é arquivamento nem desativação.`)}
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
                onClick={() => void handleConfirmRemoveSpool()}
                disabled={isDeleting}
                className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
              >
                {isDeleting ? 'Removendo...' : 'Remover do estoque'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleConfirmRemoveSpool()}
                disabled={isDeleting}
              >
                {isDeleting ? 'Excluindo...' : 'Excluir definitivamente'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação antes de Descartado (2026-09-05) — a única transição de
          status que pede confirmação explícita, para evitar descarte
          acidental (DESCARTADO é terminal: update_filament_spool rejeita
          qualquer mudança de status posterior). */}
      <Dialog
        open={discardCandidate !== null}
        onOpenChange={(open) => {
          if (!open && pendingStatusSpoolId !== discardCandidate?.id) setDiscardCandidate(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Descartar rolo</DialogTitle>
            <DialogDescription>
              {discardCandidate &&
                `Tem certeza que deseja marcar o rolo "${discardCandidate.code}" como Descartado? Esta ação é definitiva — um rolo descartado não pode voltar a ser movimentado nem ter o status alterado.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDiscardCandidate(null)}
              disabled={pendingStatusSpoolId === discardCandidate?.id}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmDiscard()}
              disabled={pendingStatusSpoolId === discardCandidate?.id}
            >
              {pendingStatusSpoolId === discardCandidate?.id ? 'Descartando...' : 'Descartar rolo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FilamentSpoolWeightAdjustDialog
        spool={adjustingSpool}
        onClose={() => setAdjustingSpool(null)}
        onAdjusted={(spoolId, patch) => {
          setLocalSpoolState(spoolId, patch)
          onSummaryChanged()
        }}
      />

      <FilamentSpoolHistoryDialog spool={historySpool} onClose={() => setHistorySpool(null)} />
    </div>
  )
}
