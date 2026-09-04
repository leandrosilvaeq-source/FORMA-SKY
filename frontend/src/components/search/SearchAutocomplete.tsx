import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { SearchIcon, XIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { normalizeForSearch } from '@/lib/forms/textSearch'
import { cn } from '@/lib/utils'

export interface SearchAutocompleteOption {
  id: string
  label: string
  // Rótulo curto opcional para diferenciar tipos de sugestão numa mesma
  // lista (ex.: "Pedido"/"Cliente"/"Produto" em Pedidos) — exibido como um
  // badge compacto antes do nome. Clientes/Produtos/Empresas nunca passam
  // este campo, então continuam com a mesma renderização de antes (sem
  // nenhum badge), pixel-idêntica.
  description?: string
}

export interface SearchAutocompleteProps {
  value: string
  onValueChange: (value: string) => void
  // Já filtradas/deduplicadas/ordenadas pelo chamador (ex.: mesma ordem
  // visual atual da tabela) — este componente não sabe nada sobre a
  // origem dos dados, só decide COMO exibir/navegar a lista.
  suggestions: SearchAutocompleteOption[]
  onSelect: (label: string) => void
  ariaLabel: string
  placeholder: string
  clearLabel: string
  listboxId: string
  listboxAriaLabel: string
  noResultsText: string
  className?: string
  // Opcional (2026-09-04, "Compra de filamentos" compacta): foca o campo ao
  // montar — usado só quando uma nova linha é adicionada dinamicamente a uma
  // lista (ex.: PurchaseDialog.tsx, "Adicionar filamento"), nunca no
  // carregamento inicial. Repassado direto ao <input> nativo (mesmo
  // comportamento padrão do atributo HTML autoFocus); nenhum chamador
  // existente passa este prop, então nenhum comportamento anterior muda.
  autoFocus?: boolean
}

// Destaca o trecho correspondente ao termo buscado, reaproveitando
// normalizeForSearch (nenhuma logica de comparacao duplicada) -- nunca
// recalcula o indice na string normalizada com um algoritmo proprio.
// Guarda defensiva: so destaca quando o comprimento normalizado bate com o
// original (verdade para o alfabeto latino acentuado usado em nomes
// pt-BR -- cada acento decompoe em exatamente 1 marca combinante); em
// qualquer caso fora do esperado, cai de volta para o nome sem destaque em
// vez de arriscar um recorte errado.
function highlightMatch(label: string, normalizedTerm: string): ReactNode {
  if (!normalizedTerm) return label
  const normalizedLabel = normalizeForSearch(label)
  if (normalizedLabel.length !== label.length) return label
  const matchStart = normalizedLabel.indexOf(normalizedTerm)
  if (matchStart === -1) return label
  const matchEnd = matchStart + normalizedTerm.length
  return (
    <>
      {label.slice(0, matchStart)}
      <strong className="text-brand-primary-dark font-semibold">
        {label.slice(matchStart, matchEnd)}
      </strong>
      {label.slice(matchEnd)}
    </>
  )
}

// Combobox com popup listbox e aria-activedescendant (WAI-ARIA 1.2) —
// extraído de CustomersPage.tsx (primeira implementação validada) para ser
// reutilizado sem duplicar em ProductsPage.tsx. O foco nunca sai do
// input: ArrowDown/ArrowUp só movem qual opção está "ativa" (destacada +
// referenciada por aria-activedescendant); Enter confirma a opção ativa;
// nunca seleciona sozinho com 1 única correspondência (só clique ou Enter
// explícitos). Fecha com Escape (sem apagar o texto) e ao clicar fora
// (listener de mousedown no document, escopado ao wrapper).
export function SearchAutocomplete({
  value,
  onValueChange,
  suggestions,
  onSelect,
  ariaLabel,
  placeholder,
  clearLabel,
  listboxId,
  listboxAriaLabel,
  noResultsText,
  className,
  autoFocus,
}: SearchAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const normalizedValue = normalizeForSearch(value)
  const showSuggestions = isOpen && normalizedValue !== ''

  // Fecha o autocomplete ao clicar fora do campo/lista — o foco nunca sai
  // do input durante a navegação por teclado, então "clicar fora" é o
  // único outro gatilho de fechamento que precisa de um listener global.
  useEffect(() => {
    if (!isOpen) return
    function handleDocumentMouseDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setActiveIndex(null)
      }
    }
    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [isOpen])

  function closeSuggestions() {
    setIsOpen(false)
    setActiveIndex(null)
  }

  function handleChange(next: string) {
    onValueChange(next)
    setActiveIndex(null)
    setIsOpen(true)
  }

  function handleFocus() {
    if (normalizeForSearch(value) !== '') setIsOpen(true)
  }

  // Fecha a lista quando o foco sai do widget por completo (Tab para
  // outro elemento) — cliques dentro da própria lista não disparam blur
  // do input porque as opções têm onMouseDown com preventDefault (abaixo),
  // então o foco nunca sai do input por causa delas.
  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    const nextFocusTarget = event.relatedTarget as Node | null
    if (wrapperRef.current && (!nextFocusTarget || !wrapperRef.current.contains(nextFocusTarget))) {
      closeSuggestions()
    }
  }

  function selectSuggestion(label: string) {
    onSelect(label)
    closeSuggestions()
  }

  function handleClear() {
    onValueChange('')
    closeSuggestions()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (normalizeForSearch(value) === '') return
      if (!showSuggestions) {
        setIsOpen(true)
        setActiveIndex(suggestions.length > 0 ? 0 : null)
        return
      }
      if (suggestions.length === 0) return
      setActiveIndex((current) =>
        current === null ? 0 : Math.min(current + 1, suggestions.length - 1),
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!showSuggestions || suggestions.length === 0) return
      setActiveIndex((current) =>
        current === null ? suggestions.length - 1 : Math.max(current - 1, 0),
      )
      return
    }

    if (event.key === 'Enter') {
      if (showSuggestions && activeIndex !== null && suggestions[activeIndex]) {
        event.preventDefault()
        selectSuggestion(suggestions[activeIndex].label)
      }
      return
    }

    if (event.key === 'Escape') {
      if (showSuggestions) {
        event.preventDefault()
        closeSuggestions()
      }
      return
    }
    // Tab: sem preventDefault — segue o fluxo natural de foco do
    // navegador; o fechamento da lista quando o foco realmente sai do
    // campo (via Tab) é tratado pelo onBlur acima.
  }

  const activeOptionId =
    showSuggestions && activeIndex !== null && suggestions[activeIndex]
      ? `${listboxId}-option-${suggestions[activeIndex].id}`
      : undefined

  return (
    <div ref={wrapperRef} className={cn('relative z-20', className)}>
      <SearchIcon className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4" />
      <Input
        role="combobox"
        aria-expanded={showSuggestions}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        autoFocus={autoFocus}
        className="focus-visible:border-brand-primary focus-visible:ring-brand-accent/50 pr-8 pl-8"
      />
      {value && (
        <button
          type="button"
          // preventDefault no mousedown mantém o foco no input, mesmo
          // sendo um <button> nativamente focável — mesmo motivo das
          // opções da listbox abaixo.
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleClear}
          aria-label={clearLabel}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-brand-accent absolute inset-y-0 right-2 my-auto flex size-5 items-center justify-center rounded outline-none focus-visible:ring-2"
        >
          <XIcon className="size-3.5" />
        </button>
      )}

      {showSuggestions && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={listboxAriaLabel}
          className="bg-popover text-popover-foreground ring-foreground/10 absolute inset-x-0 top-full mt-1 max-h-64 overflow-y-auto rounded-lg p-1 shadow-md ring-1"
        >
          {suggestions.length === 0 ? (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">{noResultsText}</li>
          ) : (
            suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                id={`${listboxId}-option-${suggestion.id}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                // Sem isto, o mousedown (comportamento padrão do
                // navegador) tira o foco do input antes do clique
                // completar — o onBlur fecharia a lista (desmontando
                // este <li>) antes do onClick disparar.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(suggestion.label)}
                className={cn(
                  'flex cursor-default items-center gap-1.5 rounded-md px-2 py-1.5 text-sm select-none',
                  index === activeIndex
                    ? 'bg-brand-primary-soft text-brand-primary-dark'
                    : 'text-foreground',
                )}
              >
                {suggestion.description && (
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide uppercase',
                      index === activeIndex
                        ? 'bg-brand-primary text-brand-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {suggestion.description}
                  </span>
                )}
                <span className="min-w-0 truncate">
                  {highlightMatch(suggestion.label, normalizedValue)}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
