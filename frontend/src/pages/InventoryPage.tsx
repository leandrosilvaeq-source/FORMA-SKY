import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { EllipsisIcon, HistoryIcon, ImageIcon, SlidersHorizontalIcon, ZoomInIcon } from 'lucide-react'
import { ResizableTableHead } from '@/components/dataTable/ResizableTableHead'
import { RestoreColumnWidthsButton } from '@/components/dataTable/RestoreColumnWidthsButton'
import { SortableColumnHeader } from '@/components/dataTable/SortableColumnHeader'
import { sortByColumn, type SortState } from '@/components/dataTable/sorting'
import {
  TABLE_COMPACT_ACTION_TEXT_CLASSNAME,
  TABLE_COMPACT_TEXT_CLASSNAME,
} from '@/components/dataTable/tableTypography'
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete'
import { InventoryItemForm, type InventoryItemFormValues } from '@/components/inventory/InventoryItemForm'
import { InventoryPageShell, type InventoryArea } from '@/components/inventory/InventoryPageShell'
import { StockMovementPanel, StockLevelBadge, getStockLevel } from '@/components/inventory/StockMovementPanel'
import { AccessoryStockAdjustDialog } from '@/components/inventory/AccessoryStockAdjustDialog'
import { AccessoryHistoryDialog } from '@/components/inventory/AccessoryHistoryDialog'
import { EntityImageUploadField } from '@/components/inventory/EntityImageUploadField'
import { EntityImagePreviewDialog } from '@/components/inventory/EntityImagePreviewDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { useAccessories } from '@/hooks/useAccessories'
import { useAuth } from '@/context/AuthContext'
import { usePackaging } from '@/hooks/usePackaging'
import { usePersistentColumnWidths } from '@/hooks/usePersistentColumnWidths'
import { useEntityImageThumbnails } from '@/hooks/useEntityImageThumbnails'
import { purgeEntityImages, removeEntityImage, uploadEntityImage } from '@/lib/api/entityImages'
import type { ProcessedEntityImage } from '@/lib/images/processEntityImage'
import { ApiError } from '@/lib/api/errors'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import type { ColumnWidthSpec } from '@/lib/tables/columnWidths'
import { cn } from '@/lib/utils'

// tableId varia por área (inventory-accessories/inventory-packaging) —
// InventoryAreaPanel é a MESMA instância de componente usada pelas duas
// sub-rotas, então a largura persistida nunca pode ser compartilhada entre
// Acessórios e Embalagens; cada wrapper (AccessoriesInventoryPage/
// PackagingInventoryPage) passa seu próprio tableId.
// minWidth de "actions" (300px) garante que "Editar" + "Movimentar
// estoque" + "Excluir" nunca quebrem em 2 linhas mesmo no menor arraste
// possível — mesmo raciocínio já aplicado à coluna Ações de Pedidos.
const INVENTORY_COLUMN_SPECS: ColumnWidthSpec[] = [
  { id: 'name', defaultWidth: 175, minWidth: 100, maxWidth: 400 },
  { id: 'size', defaultWidth: 95, minWidth: 75, maxWidth: 180 },
  { id: 'variant', defaultWidth: 140, minWidth: 90, maxWidth: 320 },
  { id: 'unit_cost', defaultWidth: 115, minWidth: 85, maxWidth: 220 },
  { id: 'minimum_stock', defaultWidth: 115, minWidth: 85, maxWidth: 220 },
  { id: 'current_stock', defaultWidth: 150, minWidth: 100, maxWidth: 280 },
  { id: 'is_active', defaultWidth: 90, minWidth: 75, maxWidth: 180 },
  { id: 'actions', defaultWidth: 340, minWidth: 300, maxWidth: 500 },
]

// Acessórios (2026-09-06): ordem própria (Acessório · Tamanho · Variante ·
// Estoque mínimo · Disponível · Custo unitário · Ações), SEM a coluna
// "Ativo" (o Switch saiu — Ativar/Desativar vive no menu de três pontos) e
// com "Ações" mais estreita (só "Ajuste" + 2 botões-ícone, nunca mais 3
// botões de texto). Larguras persistidas continuam por id (tableId
// 'inventory-accessories') — a largura antiga de 'is_active' é descartada
// por normalizeColumnWidths, as demais são preservadas. Embalagens seguem
// usando INVENTORY_COLUMN_SPECS acima, intactas.
const ACCESSORY_COLUMN_SPECS: ColumnWidthSpec[] = [
  { id: 'name', defaultWidth: 175, minWidth: 100, maxWidth: 400 },
  { id: 'size', defaultWidth: 95, minWidth: 75, maxWidth: 180 },
  { id: 'variant', defaultWidth: 140, minWidth: 90, maxWidth: 320 },
  { id: 'minimum_stock', defaultWidth: 115, minWidth: 85, maxWidth: 220 },
  { id: 'current_stock', defaultWidth: 150, minWidth: 100, maxWidth: 280 },
  { id: 'unit_cost', defaultWidth: 130, minWidth: 90, maxWidth: 240 },
  { id: 'actions', defaultWidth: 210, minWidth: 170, maxWidth: 380 },
]

// Módulo 3 (Estoque). Incremento 4: consulta e navegação. Incremento 5:
// CRIAÇÃO. Incremento 6: EDIÇÃO. Incremento 7: ATIVAÇÃO/DESATIVAÇÃO (Switch
// funcional na coluna "Ativo", só `{ is_active }`). Este incremento
// completa o MVP local com EXCLUSÃO FÍSICA SEGURA — backend já protegido
// desde os Incrementos 2/3 (delete_accessory/delete_packaging, SECURITY
// DEFINER, bloqueia com 409 quando há vínculo em product_accessories/
// product_packaging, nunca cascateia); aqui só o botão "Excluir" por linha
// + diálogo de confirmação + o método `delete` dos hooks, reaproveitando
// integralmente a Edge Function/RPC já existentes (nenhuma rota nova,
// nenhuma migration necessária).

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

// Acessórios e embalagens têm exatamente o mesmo formato de linha exibido
// nesta etapa (confirmado por leitura: Accessory e Packaging são
// estruturalmente idênticos em types/domain.ts) — um único formato/painel é
// reutilizado pelas duas áreas, nunca duplicado.
interface InventoryItem {
  id: string
  name: string
  size: string | null
  variant: string | null
  unit_cost: number | null
  minimum_stock: number | null
  // Módulo 3, Incremento 2 — accessories/packaging.current_stock sempre
  // existiu no schema (Migration 18), mas só passa a ser exibido/usado
  // nesta rodada; nunca editável na tabela (só via
  // "Movimentar estoque" -> register_stock_movement).
  current_stock: number
  is_active: boolean
  // Módulo 3 — infraestrutura de foto principal (2026-09-06). Só a listagem
  // de Acessórios (variant 'accessory') exibe a miniatura; Embalagens não
  // consome este campo. Caminho INTERNO do objeto (nunca uma URL) — a
  // listagem resolve as URLs assinadas em lote (useEntityImageThumbnails).
  image_path?: string | null
  image_thumb_path?: string | null
}

// size nulo ou vazio vira "Não se aplica"; um valor legado fora de
// PP/P/M/G/GG (ex.: "M3") é exibido exatamente como está gravado — nunca
// convertido/escondido (docs/03_MODELO_BANCO_DADOS.md §13.3).
function formatSize(size: string | null): string {
  return size ?? 'Não se aplica'
}

// unit_cost nulo é "Não informado" — nunca R$ 0,00 (custo ausente não pode
// ser tratado como zero, mesma regra já registrada em §13.3).
function formatCost(unitCost: number | null): string {
  return unitCost !== null ? unitCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Não informado'
}

function formatMinimumStock(value: number | null): string {
  return value !== null ? String(value) : '—'
}

// Miniatura da foto principal, ao lado do nome na listagem de Acessórios
// (2026-09-06). Tamanho compacto e fixo (28px), nunca uma coluna própria.
// Estados: sem foto -> placeholder neutro; com foto mas URL ainda
// carregando em lote -> skeleton; com foto e URL -> a imagem; com foto mas
// a assinatura falhou (URL null e já não carrega) -> placeholder (a
// listagem nunca quebra por causa da foto).
//
// Quando há foto E `onZoom` é fornecido, a miniatura vira um <button> que
// abre o pop-up de foto ampliada (EntityImagePreviewDialog). O placeholder
// (sem foto) e os estados de carregamento/erro NUNCA são clicáveis. O clique
// para a propagação para não disparar nenhuma ação da linha.
function AccessoryRowThumbnail({
  name,
  thumbPath,
  url,
  loading,
  onZoom,
}: {
  name: string
  thumbPath: string | null | undefined
  url: string | null | undefined
  loading: boolean
  onZoom?: () => void
}) {
  if (!thumbPath) {
    return (
      <span
        className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-black/5"
        aria-hidden="true"
      >
        <ImageIcon className="size-3.5" />
      </span>
    )
  }
  if (loading && !url) {
    return <Skeleton className="size-7 shrink-0 rounded-md" />
  }
  if (!url) {
    return (
      <span
        className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-black/5"
        aria-hidden="true"
      >
        <ImageIcon className="size-3.5" />
      </span>
    )
  }
  if (!onZoom) {
    return (
      <img
        src={url}
        alt={`Foto de ${name}`}
        loading="lazy"
        className="size-7 shrink-0 rounded-md object-cover ring-1 ring-black/5"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onZoom()
      }}
      aria-label={`Ampliar foto de ${name}`}
      className="group focus-visible:ring-brand-accent relative size-7 shrink-0 cursor-zoom-in overflow-hidden rounded-md ring-1 ring-black/5 outline-none focus-visible:ring-2"
    >
      <img src={url} alt="" loading="lazy" className="size-7 object-cover" />
      {/* Indicação discreta de que a foto pode ser ampliada. */}
      <span
        aria-hidden="true"
        className="absolute right-0 bottom-0 flex items-center justify-center rounded-tl-md bg-black/55 p-0.5 text-white opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <ZoomInIcon className="size-2.5" />
      </span>
    </button>
  )
}

type InventorySortColumn = 'name' | 'size' | 'variant' | 'unit_cost' | 'minimum_stock' | 'current_stock' | 'is_active'

// PP/P/M/G/GG têm uma ordem semântica (tamanho crescente) que não é a
// mesma da ordem alfabética ("GG" viria antes de "M") — mapeado para um
// índice numérico só para fins de ordenação, mesmo raciocínio já usado
// para Tempo/Peso em Produtos (ordena pelo valor real, nunca pelo texto
// formatado). Um valor legado fora do enum (sem índice conhecido) cai no
// mesmo grupo "sem valor" de um size null — vai para o final, de forma
// determinística, mas sem reivindicar uma posição semântica que não existe
// para um valor livre.
const SIZE_SORT_ORDER: Record<string, number> = { PP: 1, P: 2, M: 3, G: 4, GG: 5 }

function getInventorySortValue(
  item: InventoryItem,
  column: InventorySortColumn,
): string | number | boolean | null {
  switch (column) {
    case 'name':
      return item.name
    case 'size':
      return item.size !== null ? (SIZE_SORT_ORDER[item.size] ?? null) : null
    case 'variant':
      return item.variant
    case 'unit_cost':
      return item.unit_cost
    case 'minimum_stock':
      return item.minimum_stock
    case 'current_stock':
      return item.current_stock
    case 'is_active':
      return item.is_active
  }
}

// Busca por nome, tamanho e variante — case-insensitive e sem acento via
// normalizeForSearch (mesma função já usada em Clientes/Produtos/Empresas/
// Pedidos), espaços de borda do termo digitado já removidos por ela.
function matchesInventorySearch(item: InventoryItem, normalizedTerm: string): boolean {
  if (!normalizedTerm) return true
  return (
    normalizeForSearch(item.name).includes(normalizedTerm) ||
    normalizeForSearch(item.size ?? '').includes(normalizedTerm) ||
    normalizeForSearch(item.variant ?? '').includes(normalizedTerm)
  )
}

type StatusFilterValue = 'all' | 'active' | 'inactive'

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilterValue; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
]

function matchesStatusFilter(item: InventoryItem, filter: StatusFilterValue): boolean {
  if (filter === 'all') return true
  return filter === 'active' ? item.is_active : !item.is_active
}

// Mesmo idioma de radiogroup-com-botões já aprovado em ProductForm.tsx
// ("Tipo do produto"/"Categoria") — reaproveitado aqui em vez de inventar
// um componente de filtro novo. Botões nativos: focáveis e ativáveis por
// teclado (Tab + Enter/Espaço) sem necessidade de roving tabindex, mesmo
// padrão já em produção.
function StatusFilter({
  value,
  onChange,
  ariaLabel,
}: {
  value: StatusFilterValue
  onChange: (next: StatusFilterValue) => void
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {STATUS_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
            value === option.value
              ? 'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
              : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface InventoryAreaPanelProps {
  // Distingue a largura persistida de Acessórios da de Embalagens — mesmo
  // componente, tabelas logicamente diferentes (ver comentário em
  // INVENTORY_COLUMN_SPECS acima).
  tableId: 'inventory-accessories' | 'inventory-packaging'
  items: InventoryItem[]
  isLoading: boolean
  error: ApiError | null
  onRetry: () => void
  emptyMessage: string
  noResultsMessage: string
  // Texto do próprio dropdown de sugestões (SearchAutocomplete) quando
  // nenhuma sugestão bate com o termo digitado — deliberadamente um texto
  // diferente de `noResultsMessage` (mesma distinção já usada em Clientes/
  // Produtos/Empresas/Pedidos, ex.: "Nenhuma empresa encontrada." no
  // dropdown vs. "Nenhuma empresa encontrada para esta busca." na tabela),
  // nunca a mesma string — texto idêntico nos dois faria a mensagem
  // aparecer duplicada na tela ao mesmo tempo (dropdown aberto + tabela sem
  // resultado), ambíguo até para leitor de tela.
  searchNoSuggestionsText: string
  searchPlaceholder: string
  searchAriaLabel: string
  listboxId: string
  listboxAriaLabel: string
  // Acessórios (2026-09-06) removeu o filtro visual Todos/Ativos/Inativos —
  // Embalagens continua com ele. Quando `showStatusFilter` é false o
  // <StatusFilter> não é renderizado e a listagem mostra sempre todos os
  // itens (statusFilter permanece 'all', nunca deixa de exibir inativos).
  // Default true (Embalagens). `statusFilterAriaLabel` só é lido quando o
  // filtro é exibido.
  showStatusFilter?: boolean
  statusFilterAriaLabel?: string
  // Rótulos das colunas que Acessórios renomeia: "Nome" -> "Acessório",
  // "Custo" -> "Custo unitário", "Saldo atual" -> "Disponível". Embalagens
  // mantém os padrões. NUNCA muda a chave de ordenação
  // (column="name"/"unit_cost"/"current_stock") nem nada no banco/API — só o
  // texto do cabeçalho.
  nameColumnLabel?: string
  costColumnLabel?: string
  currentStockColumnLabel?: string
  // 'accessory' (2026-09-06): ordem de colunas própria, SEM a coluna
  // "Ativo", e coluna "Ações" compacta ("Ajuste" + Histórico só-ícone +
  // menu de três pontos com Editar / Ativar-Desativar / Excluir). 'default'
  // (Embalagens) permanece exatamente como antes: 7 colunas + coluna
  // "Ativo" (Switch) + 3 botões de texto (Editar / Movimentar estoque /
  // Excluir).
  variant?: 'default' | 'accessory'
  createButtonLabel: string
  onOpenCreateDialog: () => void
  onEditItem: (item: InventoryItem) => void
  // Usado para montar o nome acessível do Switch ("Ativar acessório Nome"/
  // "Desativar embalagem Nome") — cada área passa o substantivo no singular
  // que a identifica.
  itemNounSingular: string
  onToggleActive: (item: InventoryItem) => void
  // Só o item com a mutation em andamento fica com o Switch desabilitado —
  // nunca a listagem inteira (mesmo padrão já aprovado em
  // CompaniesPage.tsx: pendingToggleId).
  pendingToggleId: string | null
  // Abre o diálogo de confirmação — nunca chama a API diretamente a partir
  // da listagem; a exclusão de fato só acontece depois de "Excluir
  // definitivamente" no diálogo (ver AccessoriesInventoryPage/
  // PackagingInventoryPage).
  onDeleteItem: (item: InventoryItem) => void
  // Abre o painel de movimentação de estoque (Embalagens) — um único botão
  // por linha, nunca uma ação direta na tabela. Opcional: a variante
  // 'accessory' não usa ("Movimentar estoque" foi substituído por "Ajuste"
  // + "Histórico").
  onManageStock?: (item: InventoryItem) => void
  // Variante 'accessory' (2026-09-06): abre a janela de ajuste por
  // quantidade absoluta / a janela dedicada de histórico.
  onAdjustStock?: (item: InventoryItem) => void
  onOpenHistory?: (item: InventoryItem) => void
  // Variante 'accessory' (2026-09-06): mapa image_thumb_path -> URL assinada
  // já resolvido em lote pelo pai (useEntityImageThumbnails). A célula do
  // nome exibe a miniatura; enquanto `thumbnailsLoading` é true e o item tem
  // foto, mostra um placeholder de carregamento. Embalagens não passa nada.
  thumbnailUrls?: Record<string, string | null>
  thumbnailsLoading?: boolean
  // Variante 'accessory' (2026-09-06): clicar na miniatura de um acessório
  // que tem foto abre o pop-up de foto ampliada. Só é chamado para itens com
  // `image_path`; o placeholder (sem foto) nunca dispara.
  onPreviewImage?: (item: InventoryItem) => void
}

// Painel completo de uma área (busca + filtro + ordenação + tabela +
// estados) — usado tanto por Acessórios quanto por Embalagens, nunca
// duplicado entre as duas. Cada instância deste componente tem seu próprio
// estado local (searchTerm/statusFilter/sort), então Acessórios e
// Embalagens nunca compartilham busca/filtro/ordenação entre si — são
// montados em sub-rotas diferentes, nunca ao mesmo tempo.
function InventoryAreaPanel({
  tableId,
  items,
  isLoading,
  error,
  onRetry,
  emptyMessage,
  noResultsMessage,
  searchNoSuggestionsText,
  searchPlaceholder,
  searchAriaLabel,
  listboxId,
  listboxAriaLabel,
  showStatusFilter = true,
  statusFilterAriaLabel,
  nameColumnLabel = 'Nome',
  costColumnLabel = 'Custo',
  currentStockColumnLabel = 'Saldo atual',
  variant = 'default',
  createButtonLabel,
  onOpenCreateDialog,
  onEditItem,
  itemNounSingular,
  onToggleActive,
  pendingToggleId,
  onDeleteItem,
  onManageStock,
  onAdjustStock,
  onOpenHistory,
  thumbnailUrls,
  thumbnailsLoading = false,
  onPreviewImage,
}: InventoryAreaPanelProps) {
  const isAccessoryVariant = variant === 'accessory'
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all')
  const [sort, setSort] = useState<SortState<InventorySortColumn> | null>(null)
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const columnSpecs = isAccessoryVariant ? ACCESSORY_COLUMN_SPECS : INVENTORY_COLUMN_SPECS
  const columnWidths = usePersistentColumnWidths(tableId, userId, columnSpecs)

  // Cabeçalho ordenável reutilizável — evita repetir o bloco `resize={{…}}`
  // por coluna, e mantém as duas variantes (default/accessory) montando a
  // mesma peça, só em ordem diferente.
  const sortableHeader = (column: InventorySortColumn, label: string) => (
    <SortableColumnHeader
      column={column}
      label={label}
      sort={sort}
      onSortChange={setSort}
      resize={{
        width: columnWidths.getWidth(column),
        onResize: columnWidths.setColumnWidth,
        onCommit: columnWidths.commitWidths,
        onKeyboardResize: columnWidths.adjustByKeyboard,
      }}
    />
  )

  // Busca e filtro combinados: primeiro busca, depois filtro de status —
  // ordem não importa matematicamente (é um AND lógico), mas mantém a
  // mesma sequência já usada nas demais listagens (busca → filtro →
  // ordenação).
  const filteredItems = useMemo(() => {
    const term = normalizeForSearch(searchTerm)
    return items.filter((item) => matchesInventorySearch(item, term)).filter((item) => matchesStatusFilter(item, statusFilter))
  }, [items, searchTerm, statusFilter])

  // Nunca muta `items` (o array vindo do hook) — sortByColumn sempre
  // retorna uma cópia nova.
  const sortedItems = useMemo(() => sortByColumn(filteredItems, sort, getInventorySortValue), [filteredItems, sort])

  const suggestions = useMemo(() => {
    const seenIds = new Set<string>()
    const result: Array<{ id: string; label: string }> = []
    for (const item of sortedItems) {
      if (seenIds.has(item.id)) continue
      seenIds.add(item.id)
      result.push({ id: item.id, label: item.name })
    }
    return result
  }, [sortedItems])

  return (
    <div>
      {error && (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/10 mt-4 flex items-center justify-between rounded-lg border p-3 text-sm"
        >
          <span>{toErrorMessage(error)}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchAutocomplete
            className="max-w-xs"
            value={searchTerm}
            onValueChange={setSearchTerm}
            suggestions={suggestions}
            onSelect={setSearchTerm}
            ariaLabel={searchAriaLabel}
            placeholder={searchPlaceholder}
            clearLabel="Limpar busca"
            listboxId={listboxId}
            listboxAriaLabel={listboxAriaLabel}
            noResultsText={searchNoSuggestionsText}
          />
          {showStatusFilter && statusFilterAriaLabel && (
            <StatusFilter
              value={statusFilter}
              onChange={setStatusFilter}
              ariaLabel={statusFilterAriaLabel}
            />
          )}
        </div>
        <Button
          onClick={onOpenCreateDialog}
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark shrink-0"
        >
          {createButtonLabel}
        </Button>
      </div>

      {/* Contador de resultados + "Limpar filtros": só aparece quando há
          algo para contar/limpar — nunca junto do estado de carregamento
          nem quando o cadastro mestre está completamente vazio (o texto
          "Nenhum X cadastrado." já comunica isso sozinho, sem precisar de
          um "0 resultados" redundante ao lado). "Limpar filtros" só reseta
          o filtro de Status (statusFilter) — a busca já tem seu próprio
          controle dedicado ("Limpar busca", built-in no SearchAutocomplete
          acima), então os dois nunca se sobrepõem. */}
      {!isLoading && items.length > 0 && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {sortedItems.length} {sortedItems.length === 1 ? 'resultado' : 'resultados'}
          </p>
          {statusFilter !== 'all' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStatusFilter('all')}
              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
            >
              Limpar filtros
            </Button>
          )}
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
        ) : items.length === 0 ? (
          <p role="status" className="text-muted-foreground text-sm">
            {emptyMessage}
          </p>
        ) : sortedItems.length === 0 ? (
          <p role="status" className="text-muted-foreground text-sm">
            {noResultsMessage}
          </p>
        ) : (
          // overflow-x-auto + min-w garante rolagem horizontal controlada só
          // em telas estreitas (mesmo padrão já aprovado em Clientes/
          // Produtos/Empresas/Pedidos) — nenhuma coluna cortada em desktop
          // amplo.
          <div className="overflow-x-auto">
            <div className="mb-1 flex justify-end">
              <RestoreColumnWidthsButton onClick={columnWidths.resetWidths} />
            </div>
            <Table
              className={cn('table-fixed', TABLE_COMPACT_TEXT_CLASSNAME)}
              style={{ minWidth: columnWidths.totalWidthPx }}
            >
              <colgroup>
                {columnSpecs.map((spec) => (
                  <col key={spec.id} style={{ width: columnWidths.getWidth(spec.id) }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  {isAccessoryVariant ? (
                    <>
                      {sortableHeader('name', nameColumnLabel)}
                      {sortableHeader('size', 'Tamanho')}
                      {sortableHeader('variant', 'Variante')}
                      {sortableHeader('minimum_stock', 'Estoque mínimo')}
                      {sortableHeader('current_stock', currentStockColumnLabel)}
                      {sortableHeader('unit_cost', costColumnLabel)}
                    </>
                  ) : (
                    <>
                      {sortableHeader('name', nameColumnLabel)}
                      {sortableHeader('size', 'Tamanho')}
                      {sortableHeader('variant', 'Variante')}
                      {sortableHeader('unit_cost', costColumnLabel)}
                      {sortableHeader('minimum_stock', 'Estoque mínimo')}
                      {sortableHeader('current_stock', currentStockColumnLabel)}
                      {sortableHeader('is_active', 'Ativo')}
                    </>
                  )}
                  <ResizableTableHead
                    columnId="actions"
                    columnLabel="Ações"
                    resize={{
                      width: columnWidths.getWidth('actions'),
                      onResize: columnWidths.setColumnWidth,
                      onCommit: columnWidths.commitWidths,
                      onKeyboardResize: columnWidths.adjustByKeyboard,
                    }}
                  >
                    {/* Acessórios (2026-09-06): "Ações" VISÍVEL no cabeçalho
                        (TableHead já é text-left, coerente com os botões da
                        coluna). Embalagens continua sem texto visível (só o
                        nome acessível pela alça), inalterada. */}
                    {isAccessoryVariant ? 'Ações' : null}
                  </ResizableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedItems.map((item) => {
                  const sizeText = formatSize(item.size)
                  const costText = formatCost(item.unit_cost)
                  const stockLevel = getStockLevel(item.current_stock, item.minimum_stock)

                  const nameCell = isAccessoryVariant ? (
                    <TableCell title={item.name}>
                      <div className="flex items-center gap-2">
                        <AccessoryRowThumbnail
                          name={item.name}
                          thumbPath={item.image_thumb_path}
                          url={item.image_thumb_path ? thumbnailUrls?.[item.image_thumb_path] : null}
                          loading={thumbnailsLoading}
                          onZoom={item.image_path && onPreviewImage ? () => onPreviewImage(item) : undefined}
                        />
                        <span className="truncate">{item.name}</span>
                      </div>
                    </TableCell>
                  ) : (
                    <TableCell className="truncate" title={item.name}>
                      {item.name}
                    </TableCell>
                  )
                  const sizeCell = (
                    <TableCell className="truncate" title={sizeText}>
                      {sizeText}
                    </TableCell>
                  )
                  const variantCell = (
                    <TableCell className="truncate" title={item.variant ?? undefined}>
                      {item.variant ?? '—'}
                    </TableCell>
                  )
                  const costCell = (
                    <TableCell className="truncate" title={costText}>
                      {costText}
                    </TableCell>
                  )
                  const minimumStockCell = <TableCell>{formatMinimumStock(item.minimum_stock)}</TableCell>
                  const currentStockCell = (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums">{item.current_stock}</span>
                        <StockLevelBadge level={stockLevel} />
                      </div>
                    </TableCell>
                  )

                  return (
                    <TableRow
                      key={item.id}
                      // Mesmo zebra striping com a paleta Forma já aprovado
                      // em Clientes/Produtos/Empresas/Pedidos.
                      className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft"
                    >
                      {isAccessoryVariant ? (
                        <>
                          {nameCell}
                          {sizeCell}
                          {variantCell}
                          {minimumStockCell}
                          {currentStockCell}
                          {costCell}
                          <TableCell>
                            {/* "Ações" compacta de Acessórios (2026-09-06):
                                três botões-ícone de mesmo tamanho/formato —
                                "Ajustar quantidade" (SlidersHorizontal) +
                                "Histórico" + menu de três pontos, nesta
                                ordem. Nunca "Movimentar estoque"/"Gerenciar".
                                flex-nowrap + shrink-0 impedem quebra em 2
                                linhas. */}
                            <div className="flex flex-nowrap items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="icon-sm"
                                onClick={() => onAdjustStock?.(item)}
                                aria-label="Ajustar quantidade"
                                title="Ajustar quantidade"
                                className="shrink-0 border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                              >
                                <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                onClick={() => onOpenHistory?.(item)}
                                aria-label="Histórico"
                                title="Histórico"
                                className="shrink-0 border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                              >
                                <HistoryIcon className="size-4" aria-hidden="true" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  aria-label={`Mais ações — ${itemNounSingular} ${item.name}`}
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
                                  <DropdownMenuItem onClick={() => onEditItem(item)}>Editar</DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={pendingToggleId === item.id}
                                    onClick={() => onToggleActive(item)}
                                  >
                                    {item.is_active ? 'Desativar' : 'Ativar'}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => onDeleteItem(item)}
                                    className="text-destructive data-highlighted:text-destructive"
                                  >
                                    Excluir
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          {nameCell}
                          {sizeCell}
                          {variantCell}
                          {costCell}
                          {minimumStockCell}
                          {currentStockCell}
                          <TableCell>
                            <Switch
                              checked={item.is_active}
                              disabled={pendingToggleId === item.id}
                              onCheckedChange={() => onToggleActive(item)}
                              aria-label={`${item.is_active ? 'Desativar' : 'Ativar'} ${itemNounSingular} ${item.name}`}
                              className="data-checked:bg-brand-primary focus-visible:ring-brand-accent/50"
                            />
                          </TableCell>
                          <TableCell>
                            {/* flex-nowrap + shrink-0 (mesmo padrão de
                                OrdersPage.tsx/ProductsPage.tsx): a coluna Ações
                                nunca deve quebrar os 3 botões em 2 linhas, mesmo
                                no menor arraste possível — minWidth de "actions"
                                (300px, ver INVENTORY_COLUMN_SPECS) garante espaço
                                suficiente. */}
                            <div className="flex flex-nowrap items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onEditItem(item)}
                                className={cn(
                                  'shrink-0 border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark',
                                  TABLE_COMPACT_ACTION_TEXT_CLASSNAME,
                                )}
                              >
                                Editar
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onManageStock?.(item)}
                                aria-label={`Movimentar estoque — ${itemNounSingular} ${item.name}`}
                                className={cn(
                                  'shrink-0 border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark',
                                  TABLE_COMPACT_ACTION_TEXT_CLASSNAME,
                                )}
                              >
                                Movimentar estoque
                              </Button>
                              {/* variant="destructive" é intencionalmente sutil
                                  (bg-destructive/10, não um vermelho sólido) —
                                  não compete visualmente com "Editar"
                                  (brand-primary) nem com o botão primário "Novo
                                  X" da barra acima. aria-label sobrepõe o texto
                                  visível "Excluir" com o nome completo do item,
                                  mesmo idioma já usado no aria-label do Switch
                                  acima. */}
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => onDeleteItem(item)}
                                aria-label={`Excluir ${itemNounSingular} ${item.name}`}
                                className={cn('shrink-0', TABLE_COMPACT_ACTION_TEXT_CLASSNAME)}
                              >
                                Excluir
                              </Button>
                            </div>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

export type { InventoryArea }

// Um hook por sub-componente (nunca os dois hooks no mesmo componente) —
// evita disparar useAccessories/usePackaging ao mesmo tempo quando só uma
// das duas áreas está de fato montada (as duas sub-rotas nunca renderizam
// simultaneamente).
// Diálogo de criação: mesmo padrão de CustomersPage/ProductsPage/
// CompaniesPage — erro de validação (ApiError.type === 'validation') fica
// visível dentro do formulário (o diálogo permanece aberto, valores
// preenchidos preservados); qualquer outro erro (autenticação, servidor)
// vira toast, também sem fechar o diálogo. O diálogo só fecha em caso de
// sucesso, e a listagem já reflete o novo item imediatamente (o hook
// insere localmente, sem precisar de refetch).
function AccessoriesInventoryPage() {
  const {
    accessories,
    isLoading,
    error,
    refetch,
    create,
    update,
    delete: deleteAccessoryItem,
    setLocalStock,
    setLocalImage,
  } = useAccessories()

  // Miniaturas da listagem — URLs assinadas resolvidas EM LOTE (nunca uma
  // requisição por linha). O diálogo de edição reaproveita este mesmo mapa
  // para pré-visualizar a foto atual do acessório sem uma chamada extra.
  const accessoryThumbnails = useEntityImageThumbnails(
    accessories.map((accessory) => accessory.image_thumb_path),
  )

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // Foto escolhida no "Novo acessório" — já processada (WebP + thumb), ainda
  // NÃO enviada: o acessório é criado primeiro; só depois, com o id
  // retornado, a foto é enviada. Falha no envio nunca impede a criação.
  const [createPhoto, setCreatePhoto] = useState<ProcessedEntityImage | null>(null)

  // Diálogo de edição: estado separado do de criação — nunca abertos ao
  // mesmo tempo, mas cada um com seu próprio ciclo de vida/erro/submitting,
  // sem reaproveitar o estado de criação.
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  // Alteração de foto na EDIÇÃO — nova foto processada (substituição) OU
  // remoção explícita. Só abrir e cancelar não toca em nada; salvar sem
  // mexer na foto preserva os caminhos atuais.
  const [editPhoto, setEditPhoto] = useState<ProcessedEntityImage | null>(null)
  const [editPhotoRemoved, setEditPhotoRemoved] = useState(false)

  // Ativação/desativação: estado próprio desta área, independente do de
  // criação/edição. pendingToggleId só é setado durante a requisição de
  // fato (dentro de handleConfirmToggle) — desabilita o Switch daquele
  // item; togglingItem/isToggleDialogOpen controlam o diálogo de
  // confirmação que sempre é exibido antes de qualquer chamada à API.
  const [togglingItem, setTogglingItem] = useState<InventoryItem | null>(null)
  const [isToggleDialogOpen, setIsToggleDialogOpen] = useState(false)
  const [isConfirmingToggle, setIsConfirmingToggle] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)

  // Exclusão: estado próprio, independente de criação/edição/ativação —
  // deleteError fica dentro do próprio diálogo de confirmação (nunca vira
  // toast), já que o usuário precisa decidir o próximo passo (Cancelar ou
  // ir desativar) olhando para o item ainda visível no diálogo.
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Ajuste por quantidade absoluta / Histórico (2026-09-06): dois diálogos
  // próprios, independentes dos demais — substituem o antigo "Movimentar
  // estoque" (StockMovementPanel) só em Acessórios. Embalagens continua com
  // o painel de movimentação completo.
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null)
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null)

  // Foto ampliada (2026-09-06): clicar na miniatura de um acessório com foto
  // abre o EntityImagePreviewDialog, que assina a URL do ORIGINAL sob
  // demanda (nunca em lote com a listagem). Estado independente dos demais
  // diálogos.
  const [previewItem, setPreviewItem] = useState<InventoryItem | null>(null)

  function openCreateDialog() {
    setCreateError(null)
    setCreatePhoto(null)
    setIsCreateDialogOpen(true)
  }

  // Fluxo seguro da foto na CRIAÇÃO: (1) cria o acessório; (2) só com o id
  // retornado envia a foto e vincula; (3) falha no envio NÃO desfaz a
  // criação — o acessório fica cadastrado sem foto, com aviso claro, e a
  // foto pode ser adicionada depois pela edição. Escolher uma foto nunca
  // cria um registro incompleto: nada acontece antes do submit.
  async function handleCreateSubmit(values: InventoryItemFormValues) {
    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      const created = await create(values)

      if (createPhoto) {
        try {
          const linked = await uploadEntityImage('accessories', created.id, {
            original: createPhoto.original,
            thumb: createPhoto.thumb,
          })
          setLocalImage(created.id, linked.image_path, linked.image_thumb_path)
          toast.success('Acessório cadastrado.')
        } catch {
          toast.error(
            'O acessório foi criado, mas a foto não pôde ser salva. Você pode adicioná-la pela edição.',
          )
        }
      } else {
        toast.success('Acessório cadastrado.')
      }

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

  // Clicar no Switch nunca chama a API diretamente — só abre a confirmação;
  // a mudança de fato só acontece em handleConfirmToggle, depois do usuário
  // confirmar. checked={item.is_active} no Switch nunca reflete algo
  // otimista: sem confirmação, o Switch simplesmente volta para o valor
  // corrente do item (nada mudou ainda).
  function openToggleDialog(item: InventoryItem) {
    setTogglingItem(item)
    setToggleError(null)
    setIsToggleDialogOpen(true)
  }

  // Envia só `{ is_active }` — o mesmo update_accessory usado pela edição,
  // sem rota nova. Sucesso: toast claro + fecha o diálogo — o próprio
  // Switch (controlado por item.is_active) já reflete o novo estado assim
  // que o hook substitui o item local. Erro: fica inline no diálogo (nunca
  // toast), diálogo continua aberto e funcional — o item nunca é
  // substituído localmente, então o Switch permanece no estado anterior.
  async function handleConfirmToggle() {
    if (!togglingItem) return
    const willActivate = !togglingItem.is_active
    setIsConfirmingToggle(true)
    setPendingToggleId(togglingItem.id)
    setToggleError(null)
    try {
      await update(togglingItem.id, { is_active: willActivate })
      toast.success(`Acessório ${willActivate ? 'ativado' : 'desativado'}.`)
      setIsToggleDialogOpen(false)
    } catch (err) {
      setToggleError(toErrorMessage(err))
    } finally {
      setIsConfirmingToggle(false)
      setPendingToggleId(null)
    }
  }

  function openDeleteDialog(item: InventoryItem) {
    setDeletingItem(item)
    setDeleteError(null)
    setIsDeleteDialogOpen(true)
  }

  // delete_accessory (Edge Function -> RPC) já bloqueia com 409 quando o
  // acessório está vinculado a um produto (product_accessories), com uma
  // mensagem que já orienta desativar em vez de excluir — exibida aqui tal
  // qual, sem reescrever. O item só sai do array local depois do await
  // resolver com sucesso (useAccessories.delete) — em bloqueio/erro, o item
  // permanece exatamente como estava e o diálogo continua aberto e
  // funcional para o usuário decidir o próximo passo.
  async function handleConfirmDelete() {
    if (!deletingItem) return
    const target = deletingItem
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteAccessoryItem(target.id)

      // Só DEPOIS da exclusão confirmada: limpa a foto e a miniatura do
      // acessário no bucket privado. Best-effort — o acessório já foi
      // excluído, uma falha de limpeza física não é revertida nem
      // bloqueia o fluxo (o backend recusa o purge, preservando a foto, se
      // por algum motivo o registro ainda existir). Se a exclusão for
      // BLOQUEADA (409 por histórico/vínculo), o catch abaixo assume e o
      // purge nunca é chamado — a foto é preservada.
      if (target.image_path) {
        void purgeEntityImages('accessories', target.id).catch(() => {
          /* limpeza física é best-effort — nunca desfaz a exclusão já concluída */
        })
      }

      toast.success('Acessório excluído.')
      setIsDeleteDialogOpen(false)
    } catch (err) {
      setDeleteError(toErrorMessage(err))
    } finally {
      setIsDeleting(false)
    }
  }

  function openEditDialog(item: InventoryItem) {
    setEditingItem(item)
    setEditError(null)
    setEditPhoto(null)
    setEditPhotoRemoved(false)
    setIsEditDialogOpen(true)
  }

  async function handleEditSubmit(values: InventoryItemFormValues) {
    if (!editingItem) return
    setIsSubmittingEdit(true)
    setEditError(null)
    try {
      await update(editingItem.id, values)

      // Alteração de foto (se houver) é um passo SEPARADO, depois dos
      // campos. Uma falha aqui nunca apaga a foto anterior nem reverte os
      // campos já salvos — só avisa.
      if (editPhoto) {
        try {
          const linked = await uploadEntityImage('accessories', editingItem.id, {
            original: editPhoto.original,
            thumb: editPhoto.thumb,
          })
          setLocalImage(editingItem.id, linked.image_path, linked.image_thumb_path)
        } catch {
          toast.error('Os dados foram salvos, mas a nova foto não pôde ser enviada. A foto anterior foi mantida.')
          setIsSubmittingEdit(false)
          setIsEditDialogOpen(false)
          return
        }
      } else if (editPhotoRemoved && editingItem.image_path) {
        try {
          await removeEntityImage('accessories', editingItem.id)
          setLocalImage(editingItem.id, null, null)
        } catch {
          toast.error('Os dados foram salvos, mas a foto não pôde ser removida. Tente novamente pela edição.')
          setIsSubmittingEdit(false)
          setIsEditDialogOpen(false)
          return
        }
      }

      toast.success('Acessório atualizado.')
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

  return (
    <InventoryPageShell
      area="acessorios"
      onPurchaseCompleted={(category) => {
        if (category === 'ACCESSORY') refetch()
      }}
    >
      <InventoryAreaPanel
        tableId="inventory-accessories"
        variant="accessory"
        items={accessories}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        emptyMessage="Nenhum acessório cadastrado."
        noResultsMessage="Nenhum resultado encontrado."
        searchNoSuggestionsText="Nenhum acessório encontrado."
        searchPlaceholder="Buscar acessórios"
        searchAriaLabel="Buscar acessórios"
        listboxId="inventory-accessories-search-listbox"
        listboxAriaLabel="Sugestões de acessório"
        showStatusFilter={false}
        nameColumnLabel="Acessório"
        costColumnLabel="Custo unitário"
        currentStockColumnLabel="Disponível"
        createButtonLabel="Novo acessório"
        onOpenCreateDialog={openCreateDialog}
        onEditItem={openEditDialog}
        itemNounSingular="acessório"
        onToggleActive={openToggleDialog}
        pendingToggleId={pendingToggleId}
        onDeleteItem={openDeleteDialog}
        onAdjustStock={setAdjustingItem}
        onOpenHistory={setHistoryItem}
        onPreviewImage={setPreviewItem}
        thumbnailUrls={accessoryThumbnails.urls}
        thumbnailsLoading={accessoryThumbnails.isLoading}
      />

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo acessório</DialogTitle>
            <DialogDescription>Preencha os dados para cadastrar um novo acessório.</DialogDescription>
          </DialogHeader>
          {/* Seção "Foto de referência" — opcional. A imagem é processada
              localmente aqui (WebP + thumb) e só enviada após a criação, com
              o id retornado (ver handleCreateSubmit). */}
          <EntityImageUploadField
            idPrefix="accessory-create-photo"
            isUploading={isSubmittingCreate && createPhoto !== null}
            disabled={isSubmittingCreate}
            onImageSelected={setCreatePhoto}
            onImageRemoved={() => setCreatePhoto(null)}
          />
          <InventoryItemForm
            idPrefix="accessory"
            isSubmitting={isSubmittingCreate}
            submitError={createError}
            onSubmit={(values) => void handleCreateSubmit(values)}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={isToggleDialogOpen} onOpenChange={setIsToggleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{togglingItem?.is_active ? 'Desativar acessório' : 'Ativar acessório'}</DialogTitle>
            <DialogDescription>
              {togglingItem &&
                (togglingItem.is_active
                  ? `Tem certeza que deseja desativar "${togglingItem.name}"? Um acessório inativo deixa de poder ser adicionado a novas composições de produtos, mas os vínculos já existentes são preservados.`
                  : `Tem certeza que deseja ativar "${togglingItem.name}"?`)}
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
                ? togglingItem?.is_active
                  ? 'Desativando...'
                  : 'Ativando...'
                : togglingItem?.is_active
                  ? 'Desativar'
                  : 'Ativar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar acessório</DialogTitle>
            <DialogDescription>Atualize os dados do acessório.</DialogDescription>
          </DialogHeader>
          {editingItem && (
            <>
              {/* Foto atual pré-visualizada pela URL já assinada em lote pela
                  listagem (sem chamada extra). Substituir/remover só têm
                  efeito ao salvar; só abrir e cancelar não altera nada. */}
              <EntityImageUploadField
                key={`${editingItem.id}-photo`}
                idPrefix="accessory-edit-photo"
                savedPreviewUrl={
                  !editPhotoRemoved && editingItem.image_thumb_path
                    ? (accessoryThumbnails.urls[editingItem.image_thumb_path] ?? null)
                    : null
                }
                isUploading={isSubmittingEdit && (editPhoto !== null || editPhotoRemoved)}
                disabled={isSubmittingEdit}
                onImageSelected={(processed) => {
                  setEditPhoto(processed)
                  setEditPhotoRemoved(false)
                }}
                onImageRemoved={() => {
                  setEditPhoto(null)
                  setEditPhotoRemoved(true)
                }}
              />
              <InventoryItemForm
                key={editingItem.id}
                idPrefix="accessory-edit"
                mode="edit"
                initialValues={{
                  name: editingItem.name,
                  size: editingItem.size,
                  variant: editingItem.variant,
                  minimum_stock: editingItem.minimum_stock,
                }}
                isSubmitting={isSubmittingEdit}
                submitError={editError}
                onSubmit={(values) => void handleEditSubmit(values)}
                onCancel={() => setIsEditDialogOpen(false)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir acessório</DialogTitle>
            <DialogDescription>
              {deletingItem &&
                `Tem certeza que deseja excluir "${deletingItem.name}"? Esta ação é permanente e não pode ser desfeita.`}
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

      <AccessoryStockAdjustDialog
        item={
          adjustingItem
            ? {
                id: adjustingItem.id,
                name: adjustingItem.name,
                current_stock: adjustingItem.current_stock,
              }
            : null
        }
        onClose={() => setAdjustingItem(null)}
        onAdjusted={(accessoryId, newStock) => setLocalStock(accessoryId, newStock)}
      />

      <AccessoryHistoryDialog
        item={
          historyItem
            ? {
                id: historyItem.id,
                name: historyItem.name,
                current_stock: historyItem.current_stock,
                minimum_stock: historyItem.minimum_stock,
              }
            : null
        }
        onClose={() => setHistoryItem(null)}
      />

      <EntityImagePreviewDialog
        open={previewItem !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewItem(null)
        }}
        title={previewItem?.name ?? ''}
        alt={previewItem ? `Foto de ${previewItem.name}` : ''}
        imagePath={previewItem?.image_path ?? null}
      />
    </InventoryPageShell>
  )
}

function PackagingInventoryPage() {
  const {
    packaging,
    isLoading,
    error,
    refetch,
    create,
    update,
    delete: deletePackagingItem,
    setLocalStock,
  } = usePackaging()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [togglingItem, setTogglingItem] = useState<InventoryItem | null>(null)
  const [isToggleDialogOpen, setIsToggleDialogOpen] = useState(false)
  const [isConfirmingToggle, setIsConfirmingToggle] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)

  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [managingItem, setManagingItem] = useState<InventoryItem | null>(null)
  const [isManageStockDialogOpen, setIsManageStockDialogOpen] = useState(false)

  function openCreateDialog() {
    setCreateError(null)
    setIsCreateDialogOpen(true)
  }

  async function handleCreateSubmit(values: InventoryItemFormValues) {
    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      await create(values)
      toast.success('Embalagem cadastrada.')
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

  function openToggleDialog(item: InventoryItem) {
    setTogglingItem(item)
    setToggleError(null)
    setIsToggleDialogOpen(true)
  }

  async function handleConfirmToggle() {
    if (!togglingItem) return
    const willActivate = !togglingItem.is_active
    setIsConfirmingToggle(true)
    setPendingToggleId(togglingItem.id)
    setToggleError(null)
    try {
      await update(togglingItem.id, { is_active: willActivate })
      toast.success(`Embalagem ${willActivate ? 'ativada' : 'desativada'}.`)
      setIsToggleDialogOpen(false)
    } catch (err) {
      setToggleError(toErrorMessage(err))
    } finally {
      setIsConfirmingToggle(false)
      setPendingToggleId(null)
    }
  }

  function openDeleteDialog(item: InventoryItem) {
    setDeletingItem(item)
    setDeleteError(null)
    setIsDeleteDialogOpen(true)
  }

  async function handleConfirmDelete() {
    if (!deletingItem) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deletePackagingItem(deletingItem.id)
      toast.success('Embalagem excluída.')
      setIsDeleteDialogOpen(false)
    } catch (err) {
      setDeleteError(toErrorMessage(err))
    } finally {
      setIsDeleting(false)
    }
  }

  function openEditDialog(item: InventoryItem) {
    setEditingItem(item)
    setEditError(null)
    setIsEditDialogOpen(true)
  }

  async function handleEditSubmit(values: InventoryItemFormValues) {
    if (!editingItem) return
    setIsSubmittingEdit(true)
    setEditError(null)
    try {
      await update(editingItem.id, values)
      toast.success('Embalagem atualizada.')
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

  function openManageStockDialog(item: InventoryItem) {
    setManagingItem(item)
    setIsManageStockDialogOpen(true)
  }

  return (
    <InventoryPageShell
      area="embalagens"
      onPurchaseCompleted={(category) => {
        if (category === 'PACKAGING') refetch()
      }}
    >
      <InventoryAreaPanel
        tableId="inventory-packaging"
        items={packaging}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        emptyMessage="Nenhuma embalagem cadastrada."
        noResultsMessage="Nenhum resultado encontrado."
        searchNoSuggestionsText="Nenhuma embalagem encontrada."
        searchPlaceholder="Buscar embalagens"
        searchAriaLabel="Buscar embalagens"
        listboxId="inventory-packaging-search-listbox"
        listboxAriaLabel="Sugestões de embalagem"
        statusFilterAriaLabel="Filtrar embalagens por status"
        createButtonLabel="Nova embalagem"
        onOpenCreateDialog={openCreateDialog}
        onEditItem={openEditDialog}
        itemNounSingular="embalagem"
        onToggleActive={openToggleDialog}
        pendingToggleId={pendingToggleId}
        onDeleteItem={openDeleteDialog}
        onManageStock={openManageStockDialog}
      />

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova embalagem</DialogTitle>
            <DialogDescription>Preencha os dados para cadastrar uma nova embalagem.</DialogDescription>
          </DialogHeader>
          <InventoryItemForm
            idPrefix="packaging"
            isSubmitting={isSubmittingCreate}
            submitError={createError}
            onSubmit={(values) => void handleCreateSubmit(values)}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={isToggleDialogOpen} onOpenChange={setIsToggleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{togglingItem?.is_active ? 'Desativar embalagem' : 'Ativar embalagem'}</DialogTitle>
            <DialogDescription>
              {togglingItem &&
                (togglingItem.is_active
                  ? `Tem certeza que deseja desativar "${togglingItem.name}"? Uma embalagem inativa deixa de poder ser adicionada a novas composições de produtos, mas os vínculos já existentes são preservados.`
                  : `Tem certeza que deseja ativar "${togglingItem.name}"?`)}
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
                ? togglingItem?.is_active
                  ? 'Desativando...'
                  : 'Ativando...'
                : togglingItem?.is_active
                  ? 'Desativar'
                  : 'Ativar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar embalagem</DialogTitle>
            <DialogDescription>Atualize os dados da embalagem.</DialogDescription>
          </DialogHeader>
          {editingItem && (
            <InventoryItemForm
              key={editingItem.id}
              idPrefix="packaging-edit"
              mode="edit"
              initialValues={{
                name: editingItem.name,
                size: editingItem.size,
                variant: editingItem.variant,
                minimum_stock: editingItem.minimum_stock,
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
            <DialogTitle>Excluir embalagem</DialogTitle>
            <DialogDescription>
              {deletingItem &&
                `Tem certeza que deseja excluir "${deletingItem.name}"? Esta ação é permanente e não pode ser desfeita.`}
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

      <Dialog open={isManageStockDialogOpen} onOpenChange={setIsManageStockDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Movimentar estoque</DialogTitle>
            <DialogDescription>{managingItem?.name}</DialogDescription>
          </DialogHeader>
          {managingItem && (
            <StockMovementPanel
              key={managingItem.id}
              itemType="PACKAGING"
              itemId={managingItem.id}
              itemName={managingItem.name}
              itemCategoryLabel="Embalagem"
              currentStock={managingItem.current_stock}
              minimumStock={managingItem.minimum_stock}
              isActive={managingItem.is_active}
              onStockChanged={(newStock) => setLocalStock(managingItem.id, newStock)}
              onSuccess={() => setIsManageStockDialogOpen(false)}
              onClose={() => setIsManageStockDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </InventoryPageShell>
  )
}

// area="filamentos" nunca chega aqui — App.tsx roteia /estoque/filamentos
// diretamente para FilamentsInventoryPage (Módulo 3, Incremento 4), que tem
// forma de dado fundamentalmente diferente (tipo com drill-down de rolos,
// não uma lista plana) e por isso não reaproveita InventoryAreaPanel.
export function InventoryPage({ area }: { area: 'acessorios' | 'embalagens' }) {
  return area === 'acessorios' ? <AccessoriesInventoryPage /> : <PackagingInventoryPage />
}
