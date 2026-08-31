// Tipografia compacta compartilhada das listagens principais (Clientes,
// Empresas, Produtos, Pedidos, Estoque) — único valor, nunca duplicado nem
// divergente entre módulos.
//
// 16px era o tamanho já em uso (explícito, via text-[16px]) em toda tabela
// de listagem antes desta rodada — 16 * 0.85 = 13.6px, redução de 15%
// exata em relação ao tamanho atual. Aplicado só no elemento <Table> raiz:
// cabeçalhos (TableHead) e células (TableCell) nunca declaram seu próprio
// text-*, então herdam este valor pela cascata do CSS — nunca em
// formulários, diálogos, títulos de página, menus ou cards (nenhum desses
// usa esta classe).
export const TABLE_COMPACT_TEXT_CLASSNAME = 'text-[13.6px]'

// Controles/badges DENTRO da tabela que já declaram o próprio tamanho
// (Button, badges) NÃO herdam TABLE_COMPACT_TEXT_CLASSNAME pela cascata —
// um text-[Npx] próprio sempre vence o do ancestral, então não há redução
// acumulada por aninhamento. Quando o tamanho de origem já é pequeno
// (Button size="sm" = 12.8px), aplicar 15% resultaria abaixo do piso de
// legibilidade de 12px (12.8 * 0.85 ≈ 10.9px) — usa-se este valor (12px
// exatos, o próprio piso) em vez do fator de 15%.
export const TABLE_COMPACT_ACTION_TEXT_CLASSNAME = 'text-xs'
