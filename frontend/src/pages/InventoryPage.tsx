import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { SortableColumnHeader } from '@/components/dataTable/SortableColumnHeader'
import { sortByColumn, type SortState } from '@/components/dataTable/sorting'
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { useAccessories } from '@/hooks/useAccessories'
import { usePackaging } from '@/hooks/usePackaging'
import { ApiError } from '@/lib/api/errors'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import { cn } from '@/lib/utils'

// Módulo 3 (Estoque), Incremento 4 — somente consulta e navegação.
// Criação/edição/exclusão/ativação continuam fora de escopo desta rodada
// (Incrementos futuros consumirão createAccessory/updateAccessory/
// deleteAccessory e os equivalentes de packaging, já implementados no
// backend nos Incrementos 2/3, mas ainda não conectados a nenhuma tela).

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
  is_active: boolean
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

type InventorySortColumn = 'name' | 'size' | 'variant' | 'unit_cost' | 'minimum_stock' | 'is_active'

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

// Indicador só informativo (nunca um controle) — Ativo/Inativo nesta etapa
// não é editável (sem Switch), conforme aprovado para o Incremento 4. O
// texto em si já é o nome acessível, sem necessidade de aria extra.
function ActiveBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        isActive ? 'bg-brand-primary-soft text-brand-primary-dark' : 'bg-muted text-muted-foreground',
      )}
    >
      {isActive ? 'Ativo' : 'Inativo'}
    </span>
  )
}

interface InventoryAreaPanelProps {
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
  statusFilterAriaLabel: string
}

// Painel completo de uma área (busca + filtro + ordenação + tabela +
// estados) — usado tanto por Acessórios quanto por Embalagens, nunca
// duplicado entre as duas. Cada instância deste componente tem seu próprio
// estado local (searchTerm/statusFilter/sort), então Acessórios e
// Embalagens nunca compartilham busca/filtro/ordenação entre si — são
// montados em sub-rotas diferentes, nunca ao mesmo tempo.
function InventoryAreaPanel({
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
  statusFilterAriaLabel,
}: InventoryAreaPanelProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all')
  const [sort, setSort] = useState<SortState<InventorySortColumn> | null>(null)

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
        <StatusFilter value={statusFilter} onChange={setStatusFilter} ariaLabel={statusFilterAriaLabel} />
      </div>

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
            <Table className="min-w-[900px] table-fixed text-[16px]">
              <TableHeader>
                <TableRow>
                  <SortableColumnHeader column="name" label="Nome" sort={sort} onSortChange={setSort} className="w-[24%]" />
                  <SortableColumnHeader column="size" label="Tamanho" sort={sort} onSortChange={setSort} className="w-[14%]" />
                  <SortableColumnHeader
                    column="variant"
                    label="Variante"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[20%]"
                  />
                  <SortableColumnHeader
                    column="unit_cost"
                    label="Custo"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[16%]"
                  />
                  <SortableColumnHeader
                    column="minimum_stock"
                    label="Estoque mínimo"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[14%]"
                  />
                  <SortableColumnHeader
                    column="is_active"
                    label="Ativo"
                    sort={sort}
                    onSortChange={setSort}
                    className="w-[12%]"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedItems.map((item) => {
                  const sizeText = formatSize(item.size)
                  const costText = formatCost(item.unit_cost)
                  return (
                    <TableRow
                      key={item.id}
                      // Mesmo zebra striping com a paleta Forma já aprovado
                      // em Clientes/Produtos/Empresas/Pedidos.
                      className="odd:bg-brand-primary-soft/50 even:bg-white hover:bg-brand-primary-soft"
                    >
                      <TableCell className="truncate" title={item.name}>
                        {item.name}
                      </TableCell>
                      <TableCell className="truncate" title={sizeText}>
                        {sizeText}
                      </TableCell>
                      <TableCell className="truncate" title={item.variant ?? undefined}>
                        {item.variant ?? '—'}
                      </TableCell>
                      <TableCell className="truncate" title={costText}>
                        {costText}
                      </TableCell>
                      <TableCell>{formatMinimumStock(item.minimum_stock)}</TableCell>
                      <TableCell>
                        <ActiveBadge isActive={item.is_active} />
                      </TableCell>
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

export type InventoryArea = 'acessorios' | 'embalagens'

const INVENTORY_AREA_ITEMS: Array<{ key: InventoryArea; to: string; label: string }> = [
  { key: 'acessorios', to: '/estoque/acessorios', label: 'Acessórios' },
  { key: 'embalagens', to: '/estoque/embalagens', label: 'Embalagens' },
]

// Navegação interna entre as duas áreas — mesmo idioma visual/semântico já
// usado pela navegação principal (AppLayout): Link + aria-current="page" +
// cor/peso tipográfico somados (nunca só cor), nunca uma experiência nova.
function InventoryAreaNav({ area }: { area: InventoryArea }) {
  return (
    <nav aria-label="Áreas do Estoque" className="border-border mt-4 flex items-center gap-1 border-b">
      {INVENTORY_AREA_ITEMS.map((item) => {
        const isActive = item.key === area
        return (
          <Link
            key={item.key}
            to={item.to}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-brand-accent -mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2',
              isActive
                ? 'border-brand-primary text-brand-primary-dark font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground font-normal',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

function InventoryPageShell({ area, children }: { area: InventoryArea; children: React.ReactNode }) {
  return (
    <AppLayout>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium">Estoque</h1>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        Consulte os cadastros mestre de acessórios e embalagens usados na composição de produtos.
      </p>
      <InventoryAreaNav area={area} />
      {children}
    </AppLayout>
  )
}

// Um hook por sub-componente (nunca os dois hooks no mesmo componente) —
// evita disparar useAccessories/usePackaging ao mesmo tempo quando só uma
// das duas áreas está de fato montada (as duas sub-rotas nunca renderizam
// simultaneamente).
function AccessoriesInventoryPage() {
  const { accessories, isLoading, error, refetch } = useAccessories()
  return (
    <InventoryPageShell area="acessorios">
      <InventoryAreaPanel
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
        statusFilterAriaLabel="Filtrar acessórios por status"
      />
    </InventoryPageShell>
  )
}

function PackagingInventoryPage() {
  const { packaging, isLoading, error, refetch } = usePackaging()
  return (
    <InventoryPageShell area="embalagens">
      <InventoryAreaPanel
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
      />
    </InventoryPageShell>
  )
}

export function InventoryPage({ area }: { area: InventoryArea }) {
  return area === 'acessorios' ? <AccessoriesInventoryPage /> : <PackagingInventoryPage />
}
