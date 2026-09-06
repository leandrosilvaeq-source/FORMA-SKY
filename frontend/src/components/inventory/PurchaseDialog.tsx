import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { toast } from 'sonner'
import {
  Disc3Icon,
  PackageIcon,
  PlusIcon,
  PuzzleIcon,
  ShoppingCartIcon,
  Trash2Icon,
} from 'lucide-react'
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete'
import { Button } from '@/components/ui/button'
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
import { useAccessories } from '@/hooks/useAccessories'
import { usePackaging } from '@/hooks/usePackaging'
import { useFilamentTypes } from '@/hooks/useFilamentTypes'
import {
  registerAccessoryPurchase,
  registerFilamentPurchase,
  registerInventoryPurchase,
  type PurchaseChannel,
  type RegisterAccessoryPurchaseInput,
  type RegisterAccessoryPurchaseItemInput,
  type RegisterFilamentPurchaseInput,
  type RegisterFilamentPurchaseItemInput,
  type RegisterInventoryPurchaseInput,
} from '@/lib/api/inventoryPurchases'
import { allocateFreightCents, predictUnitCostAfter } from '@/lib/inventory/accessoryPurchaseCost'
import { ApiError } from '@/lib/api/errors'
import {
  formatDateToBrShort,
  maskBrShortDate,
  parseBrShortDate,
} from '@/lib/forms/brShortDate'
import { parseNumberField } from '@/lib/forms/numberField'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import {
  MAX_CENTS,
  appendDigit,
  centsToAmount,
  formatCentsToBRL,
  parsePastedTextToCents,
  rawValueToCents,
  removeLastDigit,
} from '@/lib/forms/currencyField'
import { cn } from '@/lib/utils'
import type { Accessory, FilamentTypeSummary, InventoryPurchaseCategory } from '@/types/domain'

// Módulo 3, Incremento 5 (Compras) — pedido do usuário em 2026-08-28, depois
// do MVP manual de filamentos ter sido aprovado: fluxo centralizado de
// Compras (Filamentos/Acessórios/Embalagens) dentro do módulo Estoque, um
// único botão/diálogo compartilhado pelas três áreas (nunca duplicado por
// página — InventoryPageShell.tsx renderiza este componente uma vez só).
// Toda compra concluída chama a Edge Function `inventory-purchases`,
// transacional: para Acessório/Embalagem, registra o movimento de entrada no
// item já cadastrado. Nenhum saldo é escrito pelo frontend — a RPC é sempre
// a única escrita.
//
// Filamento (revisão de 2026-09-04 — "Compra de filamentos" reestruturada
// para aceitar VÁRIOS itens/tipos/marcas na mesma compra, e reorganizada
// numa segunda rodada da mesma data em 5 seções compactas, nesta ordem: 1.
// Dados Gerais (Data da compra + Local da compra), 2. Itens (uma linha por
// item no desktop: Tipo | Peso | Quantidade | Marca | Valor total |
// Remover), 3. Frete (campo único), 4. Resumo (Total da compra / Frete /
// Custo por filamento), 5. Cancelar/Registrar compra). Ao salvar, chama
// POST /inventory-purchases/filament -> register_filament_purchase, que cria
// um único cabeçalho + todos os itens + todos os rolos correspondentes numa
// única transação atômica (falha em qualquer item/rolo reverte a compra
// inteira). Cada item exige um filament_type_id JÁ CADASTRADO em Estoque ->
// Filamentos — nunca cria nem localiza tipo por Material/Cor/Acabamento. O
// fornecedor da compra (marca de cada item) nunca altera o cadastro do tipo.

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Padrão brasileiro de milhar — "1000" nunca aparece sem formatação ao
// usuário; sempre "1.000 g".
function formatGrams(value: number): string {
  return `${value.toLocaleString('pt-BR')} g`
}

const ACTION_BUTTON_CLASSNAME =
  'focus-visible:ring-brand-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_BUTTON_SELECTED_CLASSNAME =
  'border-brand-primary bg-brand-primary-soft text-brand-primary-dark'
const ACTION_BUTTON_UNSELECTED_CLASSNAME =
  'border-input text-muted-foreground hover:bg-muted hover:text-foreground'

type IconComponent = ComponentType<{ className?: string }>

// Ordem exigida: Filamento, Acessório, Embalagem.
const CATEGORY_ITEMS: Array<{
  value: InventoryPurchaseCategory
  label: string
  Icon: IconComponent
}> = [
  { value: 'FILAMENT', label: 'Filamento', Icon: Disc3Icon },
  { value: 'ACCESSORY', label: 'Acessório', Icon: PuzzleIcon },
  { value: 'PACKAGING', label: 'Embalagem', Icon: PackageIcon },
]

// Peso: só os 3 valores pedidos, como action buttons — valores numéricos
// internos preservados exatamente (250/500/1000), nunca um campo de texto
// livre nesta etapa. Exibidos no padrão brasileiro (formatGrams).
const NOMINAL_WEIGHT_OPTIONS = [250, 500, 1000] as const

// Local da compra — os 4 valores oficiais, na ordem pedida.
// Site/Outro acrescentados em 2026-09-04 (ajustes finais de Filamentos) —
// sem campo de texto livre adicional quando "Outro" é escolhido.
const PURCHASE_CHANNEL_OPTIONS: Array<{ value: PurchaseChannel; label: string }> = [
  { value: 'MERCADO_LIVRE', label: 'Mercado Livre' },
  { value: 'ALIEXPRESS', label: 'AliExpress' },
  { value: 'SHOPEE', label: 'Shopee' },
  { value: 'PRESENCIAL', label: 'Presencial' },
  { value: 'SITE', label: 'Site' },
  { value: 'OUTRO', label: 'Outro' },
]

interface CurrencyFieldState {
  cents: number
  hasEdited: boolean
}

function emptyCurrencyField(): CurrencyFieldState {
  return { cents: 0, hasEdited: false }
}

// Campo de valor monetário "bancário" (dígito sempre entra pela direita) —
// mesmo comportamento de ProductPriceForm.tsx/RegisterPaymentForm.tsx,
// reaproveitado aqui para os campos de valor desta tela (Valor dos itens/
// Frete de Acessório-Embalagem; Valor total por item + Valor do frete de
// Filamento) via um pequeno componente de apresentação, em vez de duplicar
// os 3 handlers em cada instância. `inputClassName` permite a cada chamador
// ajustar a largura (w-40 fixo nos usos originais; w-full para preencher a
// coluna da grade compacta de itens de Filamento).
function CurrencyInput({
  id,
  label,
  state,
  onChange,
  disabled,
  error,
  inputClassName = 'w-40',
}: {
  id: string
  label: string
  state: CurrencyFieldState
  onChange: (next: CurrencyFieldState) => void
  disabled: boolean
  error?: string
  inputClassName?: string
}) {
  function applyCents(cents: number) {
    onChange({ cents, hasEdited: true })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const { key, currentTarget } = event
    const isFullSelection =
      currentTarget.value.length > 0 &&
      currentTarget.selectionStart === 0 &&
      currentTarget.selectionEnd === currentTarget.value.length

    if (/^[0-9]$/.test(key)) {
      event.preventDefault()
      const base = isFullSelection ? 0 : state.cents
      const next = appendDigit(base, key)
      if (next === null) return
      applyCents(next)
      return
    }

    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault()
      applyCents(isFullSelection ? 0 : removeLastDigit(state.cents))
      return
    }

    const passthrough = new Set([
      'Tab',
      'Shift',
      'Control',
      'Meta',
      'Alt',
      'Escape',
      'Enter',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
    ])
    if (passthrough.has(key) || event.ctrlKey || event.metaKey) return
    event.preventDefault()
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = rawValueToCents(event.target.value)
    if (next > MAX_CENTS) return
    applyCents(next)
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const parsed = parsePastedTextToCents(event.clipboardData.getData('text'))
    if (parsed === null) return
    applyCents(parsed)
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="numeric"
        value={formatCentsToBRL(state.cents)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className={cn(
          'focus-visible:border-brand-primary focus-visible:ring-brand-accent/50',
          inputClassName,
        )}
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  )
}

// Select pesquisável de UM acessório ATIVO já cadastrado, usado por CADA
// linha da "Compra de acessórios" (2026-09-06 — vários acessórios na mesma
// compra). Nunca mostra inativos nem cria cadastro (requisito: "cadastrar
// primeiro na aba Acessórios"). `accessories`/`isLoading` vêm de um ÚNICO
// useAccessories() no componente pai (nunca um por linha). `excludeIds`
// remove das sugestões os acessórios já escolhidos em OUTRAS linhas —
// impede o mesmo acessório em duas linhas antes mesmo do envio. Rótulo/ids
// incluem o número do item para nunca colidir entre linhas.
function AccessoryItemPicker({
  index,
  accessories,
  selectedId,
  excludeIds,
  onSelect,
  disabled,
  error,
  autoFocus,
}: {
  index: number
  accessories: Accessory[]
  selectedId: string | null
  excludeIds: Set<string>
  onSelect: (id: string | null, label: string) => void
  disabled: boolean
  error?: string
  autoFocus?: boolean
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const suggestions = accessories
    .filter((item) => item.id === selectedId || !excludeIds.has(item.id))
    .map((item) => ({
      id: item.id,
      label: item.variant ? `${item.name} — ${item.variant}` : item.name,
    }))
  const normalizedTerm = normalizeForSearch(searchTerm)
  const filtered = normalizedTerm
    ? suggestions.filter((s) => normalizeForSearch(s.label).includes(normalizedTerm))
    : suggestions
  const fieldLabel = `Acessório — item ${index}`

  function handleSelect(label: string) {
    const match = filtered.find((suggestion) => suggestion.label === label)
    setSearchTerm(label)
    onSelect(match?.id ?? null, label)
  }

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`purchase-accessory-${index}`} className="sr-only sm:not-sr-only">
          {fieldLabel}
        </Label>
        <SearchAutocomplete
          value={searchTerm}
          onValueChange={(value) => {
            setSearchTerm(value)
            onSelect(null, value)
          }}
          suggestions={filtered}
          onSelect={handleSelect}
          ariaLabel={fieldLabel}
          placeholder="Buscar acessório ativo"
          clearLabel={`Limpar seleção de acessório — item ${index}`}
          listboxId={`purchase-accessory-listbox-${index}`}
          listboxAriaLabel={`Sugestões de acessório — item ${index}`}
          noResultsText="Nenhum acessório ativo encontrado."
          autoFocus={autoFocus}
        />
        {selectedId === null && searchTerm && (
          <p className="text-muted-foreground text-xs">Selecione um acessório da lista.</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </fieldset>
  )
}

// Select pesquisável de UM tipo de filamento ATIVO já cadastrado em
// Estoque -> Filamentos, usado por CADA linha de item da compra (2026-09-04
// — vários itens/tipos/marcas na mesma compra). Cada opção é UM
// filament_type_id (nunca o grupo consolidado da listagem), rotulada
// "Material - Linha - Cor" (fabricante não entra no rótulo — pedido
// explícito). Busca própria por Material/Linha/Cor (mesmo texto do rótulo),
// já que SearchAutocomplete não filtra sozinho — só destaca o trecho
// buscado nas sugestões já filtradas que o chamador passa. `types`/
// `isLoading` vêm de um ÚNICO useFilamentTypes() no componente pai (nunca um
// por linha) — evita N buscas redundantes quando a compra tem vários itens.
// Rótulos/ids incluem o número do item (index, 1-based) para nunca colidir
// entre linhas (múltiplas instâncias no mesmo formulário). `autoFocus`
// (opcional): usado só na linha recém-criada por "Adicionar filamento", para
// posicionar o foco no Tipo do novo item.
function FilamentTypeItemPicker({
  index,
  types,
  selectedId,
  onSelect,
  disabled,
  error,
  autoFocus,
}: {
  index: number
  types: FilamentTypeSummary[]
  selectedId: string | null
  onSelect: (id: string | null, label: string) => void
  disabled: boolean
  error?: string
  autoFocus?: boolean
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const allSuggestions = types.map((type) => ({
    id: type.filament_type_id,
    label: `${type.material} - ${type.line} - ${type.commercial_color}`,
  }))
  const normalizedTerm = normalizeForSearch(searchTerm)
  const suggestions = normalizedTerm
    ? allSuggestions.filter((suggestion) =>
        normalizeForSearch(suggestion.label).includes(normalizedTerm),
      )
    : allSuggestions
  const fieldLabel = `Tipo — item ${index}`

  function handleSelect(label: string) {
    const match = suggestions.find((suggestion) => suggestion.label === label)
    setSearchTerm(label)
    onSelect(match?.id ?? null, label)
  }

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`purchase-filament-type-${index}`} className="sr-only sm:not-sr-only">
          {fieldLabel}
        </Label>
        <SearchAutocomplete
          value={searchTerm}
          onValueChange={(value) => {
            setSearchTerm(value)
            onSelect(null, value)
          }}
          suggestions={suggestions}
          onSelect={handleSelect}
          ariaLabel={fieldLabel}
          placeholder="Buscar por material, linha ou cor"
          clearLabel={`Limpar seleção de tipo de filamento — item ${index}`}
          listboxId={`purchase-filament-type-listbox-${index}`}
          listboxAriaLabel={`Sugestões de tipo de filamento — item ${index}`}
          noResultsText="Nenhum tipo de filamento encontrado."
          autoFocus={autoFocus}
        />
        {selectedId === null && searchTerm && (
          <p className="text-muted-foreground text-xs">Selecione um tipo de filamento da lista.</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </fieldset>
  )
}

function PackagingItemPicker({
  selectedId,
  onSelect,
  disabled,
  error,
}: {
  selectedId: string | null
  onSelect: (id: string | null, label: string) => void
  disabled: boolean
  error?: string
}) {
  const { packaging, isLoading } = usePackaging()
  const [searchTerm, setSearchTerm] = useState('')
  const activeItems = packaging.filter((item) => item.is_active)
  const suggestions = activeItems.map((item) => ({
    id: item.id,
    label: item.variant ? `${item.name} — ${item.variant}` : item.name,
  }))

  function handleSelect(label: string) {
    const match = suggestions.find((suggestion) => suggestion.label === label)
    setSearchTerm(label)
    onSelect(match?.id ?? null, label)
  }

  if (!isLoading && activeItems.length === 0) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Nenhuma embalagem ativa cadastrada. Cadastre uma na aba Embalagens antes de registrar esta
        compra.
      </p>
    )
  }

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex flex-col gap-2">
        <Label htmlFor="purchase-packaging">Embalagem</Label>
        <SearchAutocomplete
          value={searchTerm}
          onValueChange={(value) => {
            setSearchTerm(value)
            onSelect(null, value)
          }}
          suggestions={suggestions}
          onSelect={handleSelect}
          ariaLabel="Embalagem"
          placeholder="Buscar embalagem ativa"
          clearLabel="Limpar seleção de embalagem"
          listboxId="purchase-packaging-listbox"
          listboxAriaLabel="Sugestões de embalagem"
          noResultsText="Nenhuma embalagem ativa encontrada."
        />
        {selectedId === null && searchTerm && (
          <p className="text-muted-foreground text-xs">Selecione uma embalagem da lista.</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </fieldset>
  )
}

// Um item da "Compra de filamentos" (2026-09-04) — estado local de
// formulário, nunca enviado assim (handleFilamentSubmit converte para
// RegisterFilamentPurchaseItemInput). `key` é gerado uma vez por item
// (crypto.randomUUID()), usado como React key e para escopar erros de campo
// (fieldErrors), nunca reaproveitado entre itens diferentes mesmo depois de
// remover/adicionar outros.
//
// "Valor total" (2026-09-05, antes "Valor unitário"): o campo pede quanto o
// usuário pagou por TODOS os rolos daquela linha (ex.: 4 rolos por
// R$ 320,00), nunca o preço de um rolo só — mais próximo de como uma compra
// real é lida na nota/recibo. CORREÇÃO (2026-09-05, migration 20260905160000):
// o contrato do backend passou a aceitar total_value diretamente
// (RegisterFilamentPurchaseItemInput.total_value) — o frontend nunca mais
// divide pela quantidade antes de enviar; register_filament_purchase grava
// o valor exatamente como recebido e deriva o valor por rolo internamente.
// Isso elimina o arredondamento de centavo que existia quando o frontend
// convertia para unit_value antes do envio (ex.: quantidade 3 + R$ 100,00
// persistia como R$ 99,99 no cabeçalho da compra).
interface FilamentPurchaseItemState {
  key: string
  filamentTypeId: string | null
  nominalWeightGrams: number | null
  quantity: string
  manufacturer: string
  totalValueField: CurrencyFieldState
}

function emptyFilamentItem(): FilamentPurchaseItemState {
  return {
    key: crypto.randomUUID(),
    filamentTypeId: null,
    nominalWeightGrams: null,
    quantity: '',
    manufacturer: '',
    totalValueField: emptyCurrencyField(),
  }
}

// Grade compacta de cada linha de item, na ordem pedida — Tipo | Peso |
// Quantidade | Marca | Valor total | Remover. Tipo é a coluna mais larga
// (fr maior); Peso usa "auto" (o próprio conteúdo dos 3 botões decide a
// largura, sem forçar quebra); Quantidade/Valor total têm largura fixa
// compacta; Marca fica intermediária; Remover é só o ícone. Em telas
// pequenas (abaixo de sm), vira uma única coluna empilhada — nunca corta
// conteúdo nem impede a rolagem vertical da janela (max-h-[90vh]
// overflow-y-auto já no DialogContent).
const FILAMENT_ITEM_ROW_GRID_CLASSNAME =
  'grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(200px,2.2fr)_auto_72px_minmax(130px,1.1fr)_130px_auto] sm:items-end sm:gap-2'

// Grade compacta de cada linha da "Compra de acessórios" (2026-09-06):
// Acessório | Quantidade | Valor total | Remover. Acessório é a coluna mais
// larga; Quantidade/Valor total têm largura fixa compacta; Remover é só o
// ícone. Abaixo de sm, empilha em uma coluna. max-h-[90vh] overflow-y-auto
// do DialogContent garante rolagem só vertical.
const ACCESSORY_ITEM_ROW_GRID_CLASSNAME =
  'grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(220px,2.6fr)_90px_150px_auto] sm:items-end sm:gap-2'

// Um item da "Compra de acessórios" — estado local de formulário, nunca
// enviado assim (handleAccessorySubmit converte para
// RegisterAccessoryPurchaseItemInput). "Valor total" é quanto o usuário
// pagou por TODOS os itens da linha (nunca o unitário) — enviado
// diretamente ao backend, que grava o total exato e deriva o Custo unitário
// por média ponderada móvel (migration 20260906140000). `key` é gerada uma
// vez por item (crypto.randomUUID()), usada como React key e para escopar
// erros de campo.
interface AccessoryPurchaseItemState {
  key: string
  accessoryId: string | null
  quantity: string
  totalValueField: CurrencyFieldState
}

function emptyAccessoryItem(): AccessoryPurchaseItemState {
  return {
    key: crypto.randomUUID(),
    accessoryId: null,
    quantity: '',
    totalValueField: emptyCurrencyField(),
  }
}

const ACCESSORY_PURCHASE_MAX_ITEMS = 50

export interface PurchaseDialogProps {
  // Chamado após uma compra concluída com sucesso, com a categoria
  // comprada — cada página de área decide se aquilo afeta os dados que ela
  // própria exibe (ex.: FilamentsInventoryPage só refaz a busca quando
  // category === 'FILAMENT') e chama seu próprio refetch, sem esta
  // exigir/assumir qual hook cada página usa.
  onPurchaseCompleted: (category: InventoryPurchaseCategory) => void
}

export function PurchaseDialog({ onPurchaseCompleted }: PurchaseDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [category, setCategory] = useState<InventoryPurchaseCategory | null>(null)

  // Acessório/Embalagem
  const [itemId, setItemId] = useState<string | null>(null)

  // Filamento — Dados Gerais (2026-09-04, janela compacta): Data da compra
  // (dd/mm/aa, texto controlado, convertida só na submissão) + Local da
  // compra (um dos 4 valores oficiais).
  const [purchaseDateText, setPurchaseDateText] = useState('')
  const [purchaseChannel, setPurchaseChannel] = useState<PurchaseChannel | null>(null)

  // Filamento — Itens: lista dinâmica, cada um com seu próprio tipo/peso
  // líquido/quantidade/marca/valor unitário; useFilamentTypes() é chamado
  // UMA ÚNICA VEZ aqui (nunca um por linha) e repassado por prop a cada
  // FilamentTypeItemPicker. autoFocusItemKey guarda a key do item recém-
  // adicionado por "Adicionar filamento", para focar o Tipo dele.
  const [filamentItems, setFilamentItems] = useState<FilamentPurchaseItemState[]>([])
  const [autoFocusItemKey, setAutoFocusItemKey] = useState<string | null>(null)
  // CORREÇÃO (2026-09-04, "corrija a atualização automática do fluxo de
  // Filamentos"): este useFilamentTypes() é uma instância PRÓPRIA, distinta
  // da de FilamentsInventoryPage.tsx — cada hook tem seu próprio estado, sem
  // nada compartilhado entre elas (o projeto não usa um cache/query client
  // central). Sem isto, um tipo cadastrado/editado/arquivado na página de
  // Filamentos nunca aparecia (ou continuava aparecendo já arquivado) neste
  // seletor até um F5 recarregar o componente do zero. `refetchFilamentTypes`
  // é chamado toda vez que a janela ABRE (handleOpenChange abaixo) — nunca a
  // cada tecla nem em loop/polling — garantindo que o seletor de "Tipo de
  // filamento" sempre reflita o cadastro mais recente sem exigir F5.
  const { types: filamentTypes, isLoading: isLoadingFilamentTypes, refetch: refetchFilamentTypes } =
    useFilamentTypes()
  const activeFilamentTypes = filamentTypes.filter((type) => type.is_active)

  // Acessório — Compra multi-item (2026-09-06). Mesma disciplina do bloco de
  // Filamento acima: useAccessories() é chamado UMA ÚNICA VEZ aqui (instância
  // própria, distinta da de AccessoriesInventoryPage — o projeto não tem
  // cache central) e repassado por prop a cada AccessoryItemPicker;
  // `refetchAccessories` roda toda vez que a janela ABRE, para o seletor e a
  // PREVISÃO de custo refletirem saldo/custo mais recentes sem F5. Cabeçalho
  // próprio: Fornecedor (texto livre opcional) e Observação (opcional) — a
  // Data reaproveita purchaseDateText (compartilhada com Filamento).
  const { accessories, isLoading: isLoadingAccessories, refetch: refetchAccessories } = useAccessories()
  const activeAccessories = accessories.filter((item) => item.is_active)
  const [accessoryItems, setAccessoryItems] = useState<AccessoryPurchaseItemState[]>([])
  const [autoFocusAccessoryKey, setAutoFocusAccessoryKey] = useState<string | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [purchaseNotes, setPurchaseNotes] = useState('')

  // Compartilhados: quantidade/Valor dos itens são usados só por Acessório/
  // Embalagem a partir desta rodada (Filamento passou a ter quantidade e
  // valor unitário por item, ver filamentItems acima). Frete continua
  // compartilhado pelas 3 categorias — informado uma única vez por compra,
  // nunca dividido entre itens/rolos (para Filamento, exibido em sua própria
  // seção "Frete").
  const [quantity, setQuantity] = useState('')
  const [itemValueField, setItemValueField] = useState<CurrencyFieldState>(emptyCurrencyField())
  const [freightValueField, setFreightValueField] =
    useState<CurrencyFieldState>(emptyCurrencyField())

  // Idempotência (mesmo padrão de StockMovementForm.tsx): a MESMA chave é
  // reenviada enquanto o payload não muda entre tentativas (retry seguro de
  // duplo clique/falha de rede); qualquer mudança gera uma chave nova.
  const idempotencyRef = useRef<{ key: string; fingerprint: string } | null>(null)
  function getIdempotencyKey(fingerprint: string): string {
    if (idempotencyRef.current && idempotencyRef.current.fingerprint === fingerprint) {
      return idempotencyRef.current.key
    }
    const key = crypto.randomUUID()
    idempotencyRef.current = { key, fingerprint }
    return key
  }

  function resetForm() {
    setCategory(null)
    setItemId(null)
    setPurchaseDateText('')
    setPurchaseChannel(null)
    setFilamentItems([])
    setAutoFocusItemKey(null)
    setAccessoryItems([])
    setAutoFocusAccessoryKey(null)
    setSupplierName('')
    setPurchaseNotes('')
    setQuantity('')
    setItemValueField(emptyCurrencyField())
    setFreightValueField(emptyCurrencyField())
    setFieldErrors({})
    setSubmitError(null)
    idempotencyRef.current = null
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      resetForm()
      // Sempre busca os cadastros mais recentes ao abrir — nunca os dados
      // carregados na primeira montagem do diálogo. Só dispara neste instante
      // (abertura), nunca em polling nem a cada renderização.
      refetchFilamentTypes()
      refetchAccessories()
    }
    setIsOpen(next)
  }

  function handleCategoryChange(next: InventoryPurchaseCategory) {
    setCategory(next)
    setItemId(null)
    // Ao entrar em Filamento OU Acessório, a janela já apresenta uma linha
    // vazia e a data pré-preenchida com hoje; ao sair, tudo é descartado
    // (reconstruído do zero se o usuário voltar).
    setPurchaseDateText(
      next === 'FILAMENT' || next === 'ACCESSORY' ? formatDateToBrShort(new Date()) : '',
    )
    setPurchaseChannel(null)
    setFilamentItems(next === 'FILAMENT' ? [emptyFilamentItem()] : [])
    setAutoFocusItemKey(null)
    setAccessoryItems(next === 'ACCESSORY' ? [emptyAccessoryItem()] : [])
    setAutoFocusAccessoryKey(null)
    setSupplierName('')
    setPurchaseNotes('')
    setQuantity('')
    setFieldErrors({})
  }

  function handleAddAccessoryItem() {
    const next = emptyAccessoryItem()
    setAccessoryItems((current) =>
      current.length >= ACCESSORY_PURCHASE_MAX_ITEMS ? current : [...current, next],
    )
    setAutoFocusAccessoryKey(next.key)
    setFieldErrors((current) => ({ ...current, items: '' }))
  }

  function handleRemoveAccessoryItem(key: string) {
    setAccessoryItems((current) =>
      current.length <= 1 ? current : current.filter((item) => item.key !== key),
    )
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[`acc_${key}_accessory_id`]
      delete next[`acc_${key}_quantity`]
      delete next[`acc_${key}_total_value`]
      return next
    })
  }

  function updateAccessoryItem(key: string, patch: Partial<AccessoryPurchaseItemState>) {
    setAccessoryItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    )
  }

  function clearAccessoryItemError(key: string, field: string) {
    setFieldErrors((current) => ({ ...current, [`acc_${key}_${field}`]: '' }))
  }

  function handleAddFilamentItem() {
    const next = emptyFilamentItem()
    setFilamentItems((current) => [...current, next])
    setAutoFocusItemKey(next.key)
    setFieldErrors((current) => ({ ...current, items: '' }))
  }

  function handleRemoveFilamentItem(key: string) {
    setFilamentItems((current) =>
      current.length <= 1 ? current : current.filter((item) => item.key !== key),
    )
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[`item_${key}_filament_type_id`]
      delete next[`item_${key}_nominal_weight_grams`]
      delete next[`item_${key}_quantity`]
      delete next[`item_${key}_manufacturer`]
      delete next[`item_${key}_unit_value`]
      return next
    })
  }

  function updateFilamentItem(key: string, patch: Partial<FilamentPurchaseItemState>) {
    setFilamentItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    )
  }

  function clearFilamentItemError(key: string, field: string) {
    setFieldErrors((current) => ({ ...current, [`item_${key}_${field}`]: '' }))
  }

  const parsedQuantity = parseNumberField(quantity, 'a quantidade', { integer: true }).value

  function handleQuantityChange(raw: string) {
    setQuantity(raw)
    setFieldErrors((current) => ({ ...current, quantity: '' }))
  }

  // Único bloco de JSX reaproveitado em 2 posições diferentes (Acessório e
  // Embalagem) — Filamento não usa mais este campo (quantidade passou a ser
  // por item, ver filamentItems).
  const quantityField = (
    <div className="flex flex-col gap-2">
      <Label htmlFor="purchase-quantity">Quantidade</Label>
      <Input
        id="purchase-quantity"
        inputMode="numeric"
        value={quantity}
        onChange={(event) => handleQuantityChange(event.target.value)}
        disabled={isSubmitting}
        aria-invalid={fieldErrors.quantity ? true : undefined}
        className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-24"
      />
      {fieldErrors.quantity && <p className="text-destructive text-sm">{fieldErrors.quantity}</p>}
    </div>
  )

  const itemValueReais = centsToAmount(itemValueField.cents)
  const freightValueReais = centsToAmount(freightValueField.cents)
  const totalReais = itemValueReais + freightValueReais
  const averageUnitCost =
    parsedQuantity && parsedQuantity > 0 ? itemValueReais / parsedQuantity : null

  // Resumo de Filamento — cálculos só a partir dos valores já informados nos
  // itens, nunca distribuindo o frete entre eles: Subtotal dos itens (não
  // exibido isoladamente, só usado para compor o Total), Total da compra
  // (subtotal + frete), Custo por filamento (total ÷ quantidade total de
  // rolos — nunca NaN/Infinity quando a quantidade total é 0).
  //
  // Subtotal (2026-09-05): soma os CENTAVOS do Valor total de cada item
  // diretamente — inteiros, soma exata, sem nenhuma divisão por quantidade
  // no caminho (o mesmo total_value exato enviado ao backend, ver
  // handleFilamentSubmit) — por isso quantidade 3 + Valor total
  // R$ 100,00 continua mostrando exatamente R$ 100,00 aqui, mesmo sabendo
  // que 100,00 não divide em 3 partes exatas de centavo. O backend
  // (register_filament_purchase, migration 20260905160000) faz o mesmo:
  // soma total_value de cada item diretamente, nunca quantity*unit_value —
  // o subtotal persistido também fica exato.
  const filamentTotalQuantity = filamentItems.reduce((sum, item) => {
    const itemQuantity = parseNumberField(item.quantity, 'a quantidade', { integer: true }).value
    return sum + (itemQuantity && itemQuantity > 0 ? itemQuantity : 0)
  }, 0)
  const filamentSubtotalCents = filamentItems.reduce((sum, item) => {
    const itemQuantity = parseNumberField(item.quantity, 'a quantidade', { integer: true }).value
    if (!itemQuantity || itemQuantity <= 0) return sum
    return sum + item.totalValueField.cents
  }, 0)
  const filamentTotalReais = centsToAmount(filamentSubtotalCents + freightValueField.cents)
  const filamentCostPerRoll =
    filamentTotalQuantity > 0 ? filamentTotalReais / filamentTotalQuantity : 0

  // Resumo de Acessórios — mesma disciplina: soma os CENTAVOS do "Valor
  // total" de cada linha diretamente (soma exata), rateia o frete pelo MESMO
  // método determinístico da RPC (allocateFreightCents) e calcula a PREVISÃO
  // do novo Custo unitário por linha pela regra aprovada
  // (predictUnitCostAfter). Tudo aqui é só informativo — o valor real vem do
  // backend (unit_cost_after de cada item).
  const accessoryLineTotalsCents = accessoryItems.map((item) => item.totalValueField.cents)
  const accessorySubtotalCents = accessoryLineTotalsCents.reduce((sum, cents) => sum + cents, 0)
  const accessoryTotalQuantity = accessoryItems.reduce((sum, item) => {
    const itemQuantity = parseNumberField(item.quantity, 'a quantidade', { integer: true }).value
    return sum + (itemQuantity && itemQuantity > 0 ? itemQuantity : 0)
  }, 0)
  const accessoryTotalReais = centsToAmount(accessorySubtotalCents + freightValueField.cents)
  const accessoryFreightAllocationCents = allocateFreightCents(
    accessoryLineTotalsCents,
    freightValueField.cents,
  )
  const accessoryPredictedCosts = accessoryItems.map((item, index) => {
    const itemQuantity = parseNumberField(item.quantity, 'a quantidade', { integer: true }).value
    if (
      !item.accessoryId ||
      !itemQuantity ||
      itemQuantity <= 0 ||
      item.totalValueField.cents <= 0
    ) {
      return null
    }
    const accessory = accessories.find((entry) => entry.id === item.accessoryId)
    if (!accessory) return null
    return {
      name: accessory.variant ? `${accessory.name} — ${accessory.variant}` : accessory.name,
      predicted: predictUnitCostAfter({
        balanceBefore: accessory.current_stock,
        unitCostBefore: accessory.unit_cost,
        quantity: itemQuantity,
        lineTotalCents: item.totalValueField.cents,
        freightAllocatedCents: accessoryFreightAllocationCents[index] ?? 0,
      }),
    }
  })

  // EMBALAGEM continua no fluxo de item único, INALTERADO (register_inventory_purchase
  // / rota base). Acessório passou a ter janela multi-item própria
  // (handleAccessorySubmit abaixo) a partir de 2026-09-06.
  async function handlePackagingSubmit() {
    if (category !== 'PACKAGING') return

    const errors: Record<string, string> = {}

    const quantityResult = parseNumberField(quantity, 'a quantidade', {
      required: true,
      min: 1,
      integer: true,
    })
    if (quantityResult.error) errors.quantity = quantityResult.error

    if (!itemValueField.hasEdited) {
      errors.item_value = 'Informe o valor dos itens.'
    }

    if (!itemId) {
      errors.item_id = 'Selecione uma embalagem.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    const input: RegisterInventoryPurchaseInput = {
      category: 'PACKAGING',
      quantity: quantityResult.value as number,
      item_value: itemValueReais,
      freight_value: freightValueReais,
      item_id: itemId as string,
    }
    const fingerprint = JSON.stringify(input)

    setFieldErrors({})
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await registerInventoryPurchase({ ...input, idempotency_key: getIdempotencyKey(fingerprint) })
      toast.success('Compra registrada.')
      onPurchaseCompleted('PACKAGING')
      handleOpenChange(false)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setSubmitError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // Compra de acessórios com uma ou várias linhas (2026-09-06). Envia
  // total_value de cada linha EXATAMENTE como digitado (nunca dividido); o
  // frete é único e é rateado no backend; o Custo unitário é derivado no
  // PostgreSQL por média ponderada móvel — o frontend nunca envia unit_cost,
  // freight_allocated nem saldos.
  async function handleAccessorySubmit() {
    if (category !== 'ACCESSORY') return

    const errors: Record<string, string> = {}

    const dateResult = parseBrShortDate(purchaseDateText)
    if (dateResult.error) errors.purchase_date = dateResult.error

    const trimmedSupplier = supplierName.trim()
    if (trimmedSupplier.length > 200) {
      errors.supplier_name = 'O fornecedor deve ter no máximo 200 caracteres.'
    }
    const trimmedNotes = purchaseNotes.trim()
    if (trimmedNotes.length > 1000) {
      errors.notes = 'A observação deve ter no máximo 1000 caracteres.'
    }

    if (accessoryItems.length === 0) {
      errors.items = 'Adicione ao menos um item de compra.'
    }
    if (accessoryItems.length > ACCESSORY_PURCHASE_MAX_ITEMS) {
      errors.items = `No máximo ${ACCESSORY_PURCHASE_MAX_ITEMS} itens por compra.`
    }

    const validatedItems: RegisterAccessoryPurchaseItemInput[] = []
    const seenIds = new Set<string>()

    for (const item of accessoryItems) {
      let itemHasError = false

      if (!item.accessoryId) {
        errors[`acc_${item.key}_accessory_id`] = 'Selecione um acessório.'
        itemHasError = true
      } else if (seenIds.has(item.accessoryId)) {
        errors[`acc_${item.key}_accessory_id`] = 'Este acessório já foi adicionado em outra linha.'
        itemHasError = true
      }

      const quantityResult = parseNumberField(item.quantity, 'a quantidade', {
        required: true,
        min: 1,
        integer: true,
      })
      if (quantityResult.error) {
        errors[`acc_${item.key}_quantity`] = quantityResult.error
        itemHasError = true
      }

      if (item.totalValueField.cents <= 0) {
        errors[`acc_${item.key}_total_value`] = 'Informe o valor total do item, maior que zero.'
        itemHasError = true
      }

      if (!itemHasError && item.accessoryId) {
        seenIds.add(item.accessoryId)
        validatedItems.push({
          accessory_id: item.accessoryId,
          quantity: quantityResult.value as number,
          // Enviado diretamente, em reais, exatamente como informado — NUNCA
          // dividido pela quantidade aqui (o backend grava total_value tal
          // como recebido e deriva o Custo unitário internamente).
          total_value: centsToAmount(item.totalValueField.cents),
        })
      }
    }

    if (Object.keys(errors).length > 0 || validatedItems.length === 0 || !dateResult.value) {
      setFieldErrors(errors)
      return
    }

    const input: RegisterAccessoryPurchaseInput = {
      items: validatedItems,
      freight_value: freightValueReais,
      supplier_name: trimmedSupplier || null,
      notes: trimmedNotes || null,
      occurred_at: dateResult.value,
    }
    const fingerprint = JSON.stringify(input)

    setFieldErrors({})
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await registerAccessoryPurchase({
        ...input,
        idempotency_key: getIdempotencyKey(fingerprint),
      })
      toast.success('Compra registrada.')
      onPurchaseCompleted('ACCESSORY')
      handleOpenChange(false)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setSubmitError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleFilamentSubmit() {
    const errors: Record<string, string> = {}

    const dateResult = parseBrShortDate(purchaseDateText)
    if (dateResult.error) errors.purchase_date = dateResult.error

    if (!purchaseChannel) {
      errors.purchase_channel = 'Selecione o local da compra.'
    }

    if (filamentItems.length === 0) {
      errors.items = 'Adicione ao menos um item de compra.'
    }

    const validatedItems: RegisterFilamentPurchaseItemInput[] = []

    for (const item of filamentItems) {
      let itemHasError = false

      if (!item.filamentTypeId) {
        errors[`item_${item.key}_filament_type_id`] = 'Selecione um tipo de filamento.'
        itemHasError = true
      }
      if (!item.nominalWeightGrams) {
        errors[`item_${item.key}_nominal_weight_grams`] = 'Selecione o peso.'
        itemHasError = true
      }

      const quantityResult = parseNumberField(item.quantity, 'a quantidade', {
        required: true,
        min: 1,
        integer: true,
      })
      if (quantityResult.error) {
        errors[`item_${item.key}_quantity`] = quantityResult.error
        itemHasError = true
      }

      const manufacturer = item.manufacturer.trim()
      if (!manufacturer) {
        errors[`item_${item.key}_manufacturer`] = 'Informe a marca.'
        itemHasError = true
      }

      // Valor total do item: obrigatório e maior que zero (cobre tanto o
      // campo nunca tocado — cents=0 por padrão — quanto um valor
      // explicitamente zerado pelo usuário).
      if (item.totalValueField.cents <= 0) {
        errors[`item_${item.key}_unit_value`] = 'Informe o valor total do item, maior que zero.'
        itemHasError = true
      }

      if (!itemHasError) {
        validatedItems.push({
          filament_type_id: item.filamentTypeId as string,
          manufacturer,
          nominal_weight_grams: item.nominalWeightGrams as number,
          quantity: quantityResult.value as number,
          // Enviado diretamente, em reais, exatamente como informado —
          // NUNCA dividido pela quantidade aqui (2026-09-05,
          // migration 20260905160000: o backend passou a aceitar e gravar
          // total_value tal como recebido, derivando o valor por rolo
          // internamente).
          total_value: centsToAmount(item.totalValueField.cents),
        })
      }
    }

    if (
      Object.keys(errors).length > 0 ||
      validatedItems.length === 0 ||
      !dateResult.value ||
      !purchaseChannel
    ) {
      setFieldErrors(errors)
      return
    }

    const filamentInput: RegisterFilamentPurchaseInput = {
      freight_value: freightValueReais,
      occurred_at: dateResult.value,
      purchase_channel: purchaseChannel,
      items: validatedItems,
    }
    const fingerprint = JSON.stringify(filamentInput)

    setFieldErrors({})
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await registerFilamentPurchase({
        ...filamentInput,
        idempotency_key: getIdempotencyKey(fingerprint),
      })
      toast.success('Compra registrada.')
      onPurchaseCompleted('FILAMENT')
      handleOpenChange(false)
    } catch (err) {
      const message = toErrorMessage(err)
      if (err instanceof ApiError && err.type === 'validation') {
        setSubmitError(message)
      } else {
        toast.error(message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!category) return

    if (category === 'FILAMENT') {
      void handleFilamentSubmit()
      return
    }
    if (category === 'ACCESSORY') {
      void handleAccessorySubmit()
      return
    }
    void handlePackagingSubmit()
  }

  return (
    <>
      <Button
        onClick={() => handleOpenChange(true)}
        variant="outline"
        className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0"
      >
        <ShoppingCartIcon className="size-4" aria-hidden="true" />
        Compras
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          className={cn(
            'max-h-[90vh] overflow-y-auto',
            // Filamento e Acessório precisam de mais largura no desktop para
            // acomodar os itens em uma única linha — Embalagem mantém a
            // largura original.
            category === 'FILAMENT' || category === 'ACCESSORY' ? 'sm:max-w-4xl' : 'sm:max-w-2xl',
          )}
        >
          <DialogHeader>
            <DialogTitle>
              {category === 'FILAMENT'
                ? 'Compra de filamentos'
                : category === 'ACCESSORY'
                  ? 'Compra de acessórios'
                  : 'Registrar compra'}
            </DialogTitle>
            <DialogDescription>
              {category === 'FILAMENT'
                ? 'Registre um ou mais filamentos na mesma compra — os rolos correspondentes são criados automaticamente no estoque.'
                : category === 'ACCESSORY'
                  ? 'Registre um ou mais acessórios na mesma compra — a entrada de estoque e o Custo unitário de cada acessório são atualizados automaticamente.'
                  : 'Selecione o item e preencha os dados da compra — a entrada correspondente é lançada automaticamente no estoque.'}
            </DialogDescription>
          </DialogHeader>

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label>Item</Label>
              <div role="radiogroup" aria-label="Item" className="flex flex-wrap gap-2">
                {CATEGORY_ITEMS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={category === item.value}
                    disabled={isSubmitting}
                    onClick={() => handleCategoryChange(item.value)}
                    className={cn(
                      ACTION_BUTTON_CLASSNAME,
                      category === item.value
                        ? ACTION_BUTTON_SELECTED_CLASSNAME
                        : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                    )}
                  >
                    <item.Icon className="text-brand-primary size-8 shrink-0" aria-hidden="true" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {category === 'FILAMENT' && (
              <>
                {/* 1. Dados Gerais */}
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <p className="text-sm font-medium" data-section-heading="true">
                    Dados Gerais
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="purchase-date">Data da compra</Label>
                      <Input
                        id="purchase-date"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={8}
                        placeholder="dd/mm/aa"
                        value={purchaseDateText}
                        onChange={(event) => {
                          // Só dígitos entram; as barras são inseridas pela
                          // máscara. Colagem com ou sem barras cai aqui pelo
                          // mesmo caminho (o event.target.value já traz o
                          // texto colado inteiro).
                          setPurchaseDateText(maskBrShortDate(event.target.value))
                          setFieldErrors((current) => ({ ...current, purchase_date: '' }))
                        }}
                        disabled={isSubmitting}
                        aria-invalid={fieldErrors.purchase_date ? true : undefined}
                        className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-28"
                      />
                      {fieldErrors.purchase_date && (
                        <p className="text-destructive text-sm">{fieldErrors.purchase_date}</p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label>Local da compra</Label>
                      <div
                        role="radiogroup"
                        aria-label="Local da compra"
                        className="flex flex-wrap gap-2"
                      >
                        {PURCHASE_CHANNEL_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={purchaseChannel === option.value}
                            disabled={isSubmitting}
                            onClick={() => {
                              setPurchaseChannel(option.value)
                              setFieldErrors((current) => ({ ...current, purchase_channel: '' }))
                            }}
                            className={cn(
                              'focus-visible:ring-brand-accent rounded-md border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                              purchaseChannel === option.value
                                ? ACTION_BUTTON_SELECTED_CLASSNAME
                                : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      {fieldErrors.purchase_channel && (
                        <p className="text-destructive text-sm">{fieldErrors.purchase_channel}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. Itens */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium" data-section-heading="true">
                      Itens
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={handleAddFilamentItem}
                      disabled={
                        isSubmitting ||
                        (!isLoadingFilamentTypes && activeFilamentTypes.length === 0)
                      }
                      aria-label="Adicionar filamento"
                      className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                    >
                      <PlusIcon aria-hidden="true" />
                    </Button>
                  </div>
                  {fieldErrors.items && (
                    <p className="text-destructive text-sm">{fieldErrors.items}</p>
                  )}

                  {!isLoadingFilamentTypes && activeFilamentTypes.length === 0 ? (
                    <p role="status" className="text-muted-foreground text-sm">
                      Cadastre um tipo de filamento antes de registrar a compra.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div
                        className={cn(
                          FILAMENT_ITEM_ROW_GRID_CLASSNAME,
                          'text-muted-foreground hidden text-xs font-medium sm:grid',
                        )}
                        aria-hidden="true"
                      >
                        <span>Tipo</span>
                        <span>Peso</span>
                        <span>Quantidade</span>
                        <span>Marca</span>
                        <span>Valor total</span>
                        <span />
                      </div>

                      {filamentItems.map((item, index) => (
                        <div
                          key={item.key}
                          role="group"
                          aria-label={`Item ${index + 1}`}
                          className={cn(
                            FILAMENT_ITEM_ROW_GRID_CLASSNAME,
                            'border-input rounded-lg border p-2 sm:border-0 sm:p-0',
                          )}
                        >
                          <FilamentTypeItemPicker
                            index={index + 1}
                            types={activeFilamentTypes}
                            selectedId={item.filamentTypeId}
                            onSelect={(id) => {
                              updateFilamentItem(item.key, { filamentTypeId: id })
                              clearFilamentItemError(item.key, 'filament_type_id')
                            }}
                            disabled={isSubmitting}
                            error={fieldErrors[`item_${item.key}_filament_type_id`]}
                            autoFocus={item.key === autoFocusItemKey}
                          />

                          <div className="flex flex-col gap-1">
                            <Label className="sr-only sm:not-sr-only">{`Peso — item ${index + 1}`}</Label>
                            <div
                              role="radiogroup"
                              aria-label={`Peso — item ${index + 1}`}
                              className="flex flex-wrap gap-1"
                            >
                              {NOMINAL_WEIGHT_OPTIONS.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  role="radio"
                                  aria-checked={item.nominalWeightGrams === option}
                                  disabled={isSubmitting}
                                  onClick={() => {
                                    updateFilamentItem(item.key, { nominalWeightGrams: option })
                                    clearFilamentItemError(item.key, 'nominal_weight_grams')
                                  }}
                                  className={cn(
                                    'focus-visible:ring-brand-accent rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
                                    item.nominalWeightGrams === option
                                      ? ACTION_BUTTON_SELECTED_CLASSNAME
                                      : ACTION_BUTTON_UNSELECTED_CLASSNAME,
                                  )}
                                >
                                  {formatGrams(option)}
                                </button>
                              ))}
                            </div>
                            {fieldErrors[`item_${item.key}_nominal_weight_grams`] && (
                              <p className="text-destructive text-sm">
                                {fieldErrors[`item_${item.key}_nominal_weight_grams`]}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-col gap-1">
                            <Label
                              htmlFor={`purchase-item-${item.key}-quantity`}
                              className="sr-only sm:not-sr-only"
                            >
                              Quantidade
                            </Label>
                            <Input
                              id={`purchase-item-${item.key}-quantity`}
                              inputMode="numeric"
                              value={item.quantity}
                              onChange={(event) => {
                                updateFilamentItem(item.key, { quantity: event.target.value })
                                clearFilamentItemError(item.key, 'quantity')
                              }}
                              disabled={isSubmitting}
                              aria-invalid={
                                fieldErrors[`item_${item.key}_quantity`] ? true : undefined
                              }
                              className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-full"
                            />
                            {fieldErrors[`item_${item.key}_quantity`] && (
                              <p className="text-destructive text-sm">
                                {fieldErrors[`item_${item.key}_quantity`]}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-col gap-1">
                            <Label
                              htmlFor={`purchase-item-${item.key}-manufacturer`}
                              className="sr-only sm:not-sr-only"
                            >
                              Marca
                            </Label>
                            <Input
                              id={`purchase-item-${item.key}-manufacturer`}
                              value={item.manufacturer}
                              placeholder="Ex.: Bambu Lab"
                              onChange={(event) => {
                                updateFilamentItem(item.key, { manufacturer: event.target.value })
                                clearFilamentItemError(item.key, 'manufacturer')
                              }}
                              disabled={isSubmitting}
                              aria-invalid={
                                fieldErrors[`item_${item.key}_manufacturer`] ? true : undefined
                              }
                              className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-full"
                            />
                            {fieldErrors[`item_${item.key}_manufacturer`] && (
                              <p className="text-destructive text-sm">
                                {fieldErrors[`item_${item.key}_manufacturer`]}
                              </p>
                            )}
                          </div>

                          <CurrencyInput
                            id={`purchase-item-${item.key}-total-value`}
                            label="Valor total"
                            inputClassName="w-full"
                            state={item.totalValueField}
                            onChange={(next) => {
                              updateFilamentItem(item.key, { totalValueField: next })
                              clearFilamentItemError(item.key, 'unit_value')
                            }}
                            disabled={isSubmitting}
                            error={fieldErrors[`item_${item.key}_unit_value`]}
                          />

                          <div className="flex items-end justify-end sm:items-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              aria-label={`Remover item ${index + 1}`}
                              onClick={() => handleRemoveFilamentItem(item.key)}
                              disabled={isSubmitting || filamentItems.length <= 1}
                              className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0"
                            >
                              <Trash2Icon aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. Frete */}
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <p className="text-sm font-medium" data-section-heading="true">
                    Frete
                  </p>
                  <CurrencyInput
                    id="purchase-filament-freight"
                    label="Valor do frete"
                    state={freightValueField}
                    onChange={setFreightValueField}
                    disabled={isSubmitting}
                  />
                </div>

                {/* 4. Resumo */}
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium" data-section-heading="true">
                    Resumo
                  </p>
                  <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-3 gap-2 rounded-lg border px-3 py-2">
                    <div>
                      <p className="text-muted-foreground text-xs">Total da compra</p>
                      <p className="text-brand-primary-dark text-sm font-medium">
                        {formatBRL(filamentTotalReais)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Frete</p>
                      <p className="text-brand-primary-dark text-sm font-medium">
                        {formatBRL(freightValueReais)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Custo por filamento</p>
                      <p className="text-brand-primary-dark text-sm font-medium">
                        {formatBRL(filamentCostPerRoll)}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {category === 'ACCESSORY' && (
              <>
                {/* 1. Dados Gerais */}
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <p className="text-sm font-medium" data-section-heading="true">
                    Dados Gerais
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="purchase-accessory-date">Data da compra</Label>
                      <Input
                        id="purchase-accessory-date"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={8}
                        placeholder="dd/mm/aa"
                        value={purchaseDateText}
                        onChange={(event) => {
                          setPurchaseDateText(maskBrShortDate(event.target.value))
                          setFieldErrors((current) => ({ ...current, purchase_date: '' }))
                        }}
                        disabled={isSubmitting}
                        aria-invalid={fieldErrors.purchase_date ? true : undefined}
                        className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-28"
                      />
                      {fieldErrors.purchase_date && (
                        <p className="text-destructive text-sm">{fieldErrors.purchase_date}</p>
                      )}
                    </div>

                    <div className="flex min-w-[200px] flex-1 flex-col gap-2">
                      <Label htmlFor="purchase-accessory-supplier">Fornecedor (opcional)</Label>
                      <Input
                        id="purchase-accessory-supplier"
                        value={supplierName}
                        maxLength={200}
                        placeholder="Ex.: Loja X"
                        onChange={(event) => {
                          setSupplierName(event.target.value)
                          setFieldErrors((current) => ({ ...current, supplier_name: '' }))
                        }}
                        disabled={isSubmitting}
                        aria-invalid={fieldErrors.supplier_name ? true : undefined}
                        className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                      />
                      {fieldErrors.supplier_name && (
                        <p className="text-destructive text-sm">{fieldErrors.supplier_name}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. Itens */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium" data-section-heading="true">
                      Itens
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={handleAddAccessoryItem}
                      disabled={
                        isSubmitting ||
                        accessoryItems.length >= ACCESSORY_PURCHASE_MAX_ITEMS ||
                        (!isLoadingAccessories && activeAccessories.length === 0)
                      }
                      aria-label="Adicionar outro acessório"
                      className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
                    >
                      <PlusIcon aria-hidden="true" />
                    </Button>
                  </div>
                  {fieldErrors.items && (
                    <p className="text-destructive text-sm">{fieldErrors.items}</p>
                  )}

                  {!isLoadingAccessories && activeAccessories.length === 0 ? (
                    <p role="status" className="text-muted-foreground text-sm">
                      Nenhum acessório ativo cadastrado. Cadastre um na aba Acessórios antes de
                      registrar esta compra.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div
                        className={cn(
                          ACCESSORY_ITEM_ROW_GRID_CLASSNAME,
                          'text-muted-foreground hidden text-xs font-medium sm:grid',
                        )}
                        aria-hidden="true"
                      >
                        <span>Acessório</span>
                        <span>Quantidade</span>
                        <span>Valor total</span>
                        <span />
                      </div>

                      {accessoryItems.map((item, index) => {
                        const excludeIds = new Set(
                          accessoryItems
                            .filter((other) => other.key !== item.key && other.accessoryId)
                            .map((other) => other.accessoryId as string),
                        )
                        return (
                          <div
                            key={item.key}
                            role="group"
                            aria-label={`Item ${index + 1}`}
                            className={cn(
                              ACCESSORY_ITEM_ROW_GRID_CLASSNAME,
                              'border-input rounded-lg border p-2 sm:border-0 sm:p-0',
                            )}
                          >
                            <AccessoryItemPicker
                              index={index + 1}
                              accessories={activeAccessories}
                              selectedId={item.accessoryId}
                              excludeIds={excludeIds}
                              onSelect={(id) => {
                                updateAccessoryItem(item.key, { accessoryId: id })
                                clearAccessoryItemError(item.key, 'accessory_id')
                              }}
                              disabled={isSubmitting}
                              error={fieldErrors[`acc_${item.key}_accessory_id`]}
                              autoFocus={item.key === autoFocusAccessoryKey}
                            />

                            <div className="flex flex-col gap-1">
                              <Label
                                htmlFor={`purchase-accessory-${item.key}-quantity`}
                                className="sr-only sm:not-sr-only"
                              >
                                Quantidade
                              </Label>
                              <Input
                                id={`purchase-accessory-${item.key}-quantity`}
                                inputMode="numeric"
                                value={item.quantity}
                                onChange={(event) => {
                                  updateAccessoryItem(item.key, { quantity: event.target.value })
                                  clearAccessoryItemError(item.key, 'quantity')
                                }}
                                disabled={isSubmitting}
                                aria-invalid={
                                  fieldErrors[`acc_${item.key}_quantity`] ? true : undefined
                                }
                                className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 w-full"
                              />
                              {fieldErrors[`acc_${item.key}_quantity`] && (
                                <p className="text-destructive text-sm">
                                  {fieldErrors[`acc_${item.key}_quantity`]}
                                </p>
                              )}
                            </div>

                            <CurrencyInput
                              id={`purchase-accessory-${item.key}-total-value`}
                              label="Valor total"
                              inputClassName="w-full"
                              state={item.totalValueField}
                              onChange={(next) => {
                                updateAccessoryItem(item.key, { totalValueField: next })
                                clearAccessoryItemError(item.key, 'total_value')
                              }}
                              disabled={isSubmitting}
                              error={fieldErrors[`acc_${item.key}_total_value`]}
                            />

                            <div className="flex items-end justify-end sm:items-center">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                aria-label={`Remover item ${index + 1}`}
                                onClick={() => handleRemoveAccessoryItem(item.key)}
                                disabled={isSubmitting || accessoryItems.length <= 1}
                                className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark shrink-0"
                              >
                                <Trash2Icon aria-hidden="true" />
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 3. Frete */}
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <p className="text-sm font-medium" data-section-heading="true">
                    Frete
                  </p>
                  <CurrencyInput
                    id="purchase-accessory-freight"
                    label="Valor do frete"
                    state={freightValueField}
                    onChange={setFreightValueField}
                    disabled={isSubmitting}
                  />
                </div>

                {/* 4. Observação */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="purchase-accessory-notes">Observação (opcional)</Label>
                  <Input
                    id="purchase-accessory-notes"
                    value={purchaseNotes}
                    maxLength={1000}
                    onChange={(event) => {
                      setPurchaseNotes(event.target.value)
                      setFieldErrors((current) => ({ ...current, notes: '' }))
                    }}
                    disabled={isSubmitting}
                    aria-invalid={fieldErrors.notes ? true : undefined}
                    className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50"
                  />
                  {fieldErrors.notes && <p className="text-destructive text-sm">{fieldErrors.notes}</p>}
                </div>

                {/* 5. Resumo */}
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium" data-section-heading="true">
                    Resumo
                  </p>
                  <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-2 gap-2 rounded-lg border px-3 py-2 sm:grid-cols-4">
                    <div>
                      <p className="text-muted-foreground text-xs">Quantidade total</p>
                      <p className="text-brand-primary-dark text-sm font-medium">
                        {accessoryTotalQuantity}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Subtotal</p>
                      <p className="text-brand-primary-dark text-sm font-medium">
                        {formatBRL(centsToAmount(accessorySubtotalCents))}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Frete</p>
                      <p className="text-brand-primary-dark text-sm font-medium">
                        {formatBRL(freightValueReais)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Total da compra</p>
                      <p className="text-brand-primary-dark text-sm font-medium">
                        {formatBRL(accessoryTotalReais)}
                      </p>
                    </div>
                  </div>
                  {accessoryPredictedCosts.some((entry) => entry !== null) && (
                    <div className="border-brand-primary/20 flex flex-col gap-1 rounded-lg border px-3 py-2">
                      <p className="text-muted-foreground text-xs">
                        Custo unitário previsto (o valor final é calculado pelo servidor)
                      </p>
                      {accessoryPredictedCosts.map((entry, index) =>
                        entry ? (
                          <p key={index} className="text-brand-primary-dark text-sm">
                            {entry.name}: <span className="font-medium">{formatBRL(entry.predicted)}</span>
                          </p>
                        ) : null,
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {category === 'PACKAGING' && (
              <>
                <PackagingItemPicker
                  selectedId={itemId}
                  onSelect={(id) => {
                    setItemId(id)
                    setFieldErrors((current) => ({ ...current, item_id: '' }))
                  }}
                  disabled={isSubmitting}
                  error={fieldErrors.item_id}
                />
                {quantityField}
              </>
            )}

            {category === 'PACKAGING' && (
              <>
                <div className="flex flex-wrap gap-4">
                  <CurrencyInput
                    id="purchase-item-value"
                    label="Valor dos itens"
                    state={itemValueField}
                    onChange={(next) => {
                      setItemValueField(next)
                      setFieldErrors((current) => ({ ...current, item_value: '' }))
                    }}
                    disabled={isSubmitting}
                    error={fieldErrors.item_value}
                  />
                  <CurrencyInput
                    id="purchase-freight-value"
                    label="Frete"
                    state={freightValueField}
                    onChange={setFreightValueField}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="border-brand-primary/20 bg-brand-primary-soft/40 grid grid-cols-2 gap-2 rounded-lg border px-3 py-2 sm:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground text-xs">Valor dos itens</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {formatBRL(itemValueReais)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Frete</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {formatBRL(freightValueReais)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Total da compra</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {formatBRL(totalReais)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Custo médio por unidade</p>
                    <p className="text-brand-primary-dark text-sm font-medium">
                      {averageUnitCost !== null ? formatBRL(averageUnitCost) : '—'}
                    </p>
                  </div>
                </div>
              </>
            )}

            {submitError && <p className="text-destructive text-sm">{submitError}</p>}

            {/* 5. Botões */}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
                className="border-brand-primary text-brand-primary hover:bg-brand-primary-soft hover:text-brand-primary-dark"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !category}
                className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-dark"
              >
                {isSubmitting ? 'Registrando...' : 'Registrar compra'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
