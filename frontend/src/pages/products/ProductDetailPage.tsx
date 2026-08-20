import { Link, useParams } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAccessories } from '@/hooks/useAccessories'
import { usePackaging } from '@/hooks/usePackaging'
import { useProduct } from '@/hooks/useProduct'
import { useProductComposition } from '@/hooks/useProductComposition'
import { ApiError } from '@/lib/api/errors'
import {
  calculateComponentsSubtotal,
  resolveAccessoryLines,
  resolvePackagingLines,
  type CompositionLineStatus,
  type ComponentsSubtotal,
  type ResolvedCompositionLine,
} from '@/lib/products/productCosts'
import type { Product } from '@/types/domain'

const BACK_LINK_CLASSNAME =
  'text-brand-primary hover:text-brand-primary-dark focus-visible:ring-brand-accent w-fit rounded text-sm outline-none hover:underline focus-visible:ring-2'
const FIELD_LABEL_CLASSNAME = 'text-muted-foreground text-xs'
const FIELD_VALUE_CLASSNAME = 'text-sm font-medium'
const BADGE_CLASSNAME = 'rounded-full px-2 py-0.5 text-xs font-medium'
const COMPONENTS_NOTE =
  'Este valor considera somente acessórios e embalagens. Material, energia, máquina, perdas e mão de obra ainda não estão incluídos.'

function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatGrams(grams: number, fractionDigits = 0): string {
  return `${grams.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} g`
}

// Sempre arredonda para minuto inteiro na exibição — usado tanto para o
// tempo do plate (já inteiro no banco) quanto para o tempo por unidade
// (fracionário, resultado de uma divisão só de exibição).
function formatMinutesAsHoursMinutes(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes)
  const hours = Math.floor(rounded / 60)
  const minutes = rounded % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

// units_per_plate já é `> 0` por constraint do banco quando não é null
// (supabase/migrations/20260813205942_create_products_table.sql) — esta
// checagem é defensiva, não corretiva: nunca divide por um valor
// ausente/zero/negativo, mesmo que isso hoje não deva acontecer na prática.
function hasValidUnitsPerPlate(unitsPerPlate: number | null): unitsPerPlate is number {
  return unitsPerPlate !== null && Number.isFinite(unitsPerPlate) && unitsPerPlate > 0
}

// Valor por unidade só é calculável quando o valor do plate É conhecido E
// units_per_plate é válido — nunca os dois casos juntos assumidos como 0.
function perUnit(plateValue: number | null, unitsPerPlate: number | null): number | null {
  if (plateValue === null) return null
  if (!hasValidUnitsPerPlate(unitsPerPlate)) return null
  return plateValue / unitsPerPlate
}

function ActiveBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={
        isActive
          ? 'bg-brand-primary-soft text-brand-primary-dark rounded-full px-2 py-0.5 text-xs font-medium'
          : 'bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium'
      }
    >
      {isActive ? 'Ativo' : 'Inativo'}
    </span>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className={FIELD_LABEL_CLASSNAME}>{label}</p>
      <p className={FIELD_VALUE_CLASSNAME}>{value}</p>
    </div>
  )
}

const LINE_STATUS_LABEL: Record<CompositionLineStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  missing: 'Indisponível',
}

const LINE_STATUS_CLASSNAME: Record<CompositionLineStatus, string> = {
  active: 'bg-brand-primary-soft text-brand-primary-dark',
  inactive: 'bg-muted text-muted-foreground',
  missing: 'bg-destructive/10 text-destructive',
}

function LineStatusBadge({ status }: { status: CompositionLineStatus }) {
  return <span className={`${BADGE_CLASSNAME} ${LINE_STATUS_CLASSNAME[status]}`}>{LINE_STATUS_LABEL[status]}</span>
}

function ComponentsTable({
  title,
  lines,
  emptyMessage,
}: {
  title: string
  lines: ResolvedCompositionLine[]
  emptyMessage: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        ) : (
          <Table className="table-fixed text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="h-auto w-[35%] py-2 whitespace-normal">Nome</TableHead>
                <TableHead className="h-auto w-[20%] py-2 whitespace-normal">Situação</TableHead>
                <TableHead className="h-auto w-[15%] py-2 text-right whitespace-normal">Quantidade</TableHead>
                <TableHead className="h-auto w-[15%] py-2 text-right whitespace-normal">Custo unitário</TableHead>
                <TableHead className="h-auto w-[15%] py-2 text-right whitespace-normal">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.key}>
                  <TableCell className="truncate" title={line.name}>
                    {line.name}
                  </TableCell>
                  <TableCell>
                    <LineStatusBadge status={line.status} />
                  </TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">
                    {line.unitCost !== null ? formatBRL(line.unitCost) : 'Não informado'}
                  </TableCell>
                  <TableCell className="text-right">
                    {line.subtotal !== null ? formatBRL(line.subtotal) : 'Não calculável'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function ComponentsSubtotalCard({ subtotal }: { subtotal: ComponentsSubtotal }) {
  const valueText =
    subtotal.status === 'not_calculable' ? 'Não calculável' : formatBRL(subtotal.total)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subtotal de componentes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-brand-primary-dark text-xl font-semibold">{valueText}</span>
          {subtotal.status === 'partial' && (
            <span className={`${BADGE_CLASSNAME} bg-brand-primary-soft text-brand-primary-dark`}>
              Subtotal parcial
            </span>
          )}
        </div>
        {subtotal.status === 'empty' && (
          <p className="text-muted-foreground text-sm">
            Este produto não possui acessórios ou embalagens vinculados.
          </p>
        )}
        {subtotal.hasIncompleteData && (
          <p className="text-destructive text-sm">
            Existem componentes sem custo informado. Eles não foram incluídos neste subtotal.
          </p>
        )}
        <p className="text-muted-foreground text-xs">{COMPONENTS_NOTE}</p>
      </CardContent>
    </Card>
  )
}

function ProductDetailContent({ product }: { product: Product }) {
  const weightPerUnit = perUnit(product.default_weight_grams, product.units_per_plate)
  const timePerUnit = perUnit(product.default_print_time_minutes, product.units_per_plate)

  const composition = useProductComposition(product.id)
  const accessoriesHook = useAccessories()
  const packagingHook = usePackaging()

  const componentsLoading = composition.status === 'loading' || accessoriesHook.isLoading || packagingHook.isLoading

  // Prioridade arbitrária mas determinística quando mais de uma fonte falha
  // ao mesmo tempo: composição, depois acessórios, depois embalagens. Cada
  // "Tentar novamente" aciona só a fonte correspondente — nenhuma delas
  // depende de useProduct, então o retry nunca esconde/recarrega
  // Identificação nem Produção.
  const componentsErrorInfo =
    composition.status === 'error'
      ? { message: toErrorMessage(composition.error), retry: composition.retry }
      : accessoriesHook.error
        ? { message: toErrorMessage(accessoriesHook.error), retry: accessoriesHook.refetch }
        : packagingHook.error
          ? { message: toErrorMessage(packagingHook.error), retry: packagingHook.refetch }
          : null

  const componentsReady = !componentsLoading && !componentsErrorInfo && composition.status === 'success'

  const accessoryLines = componentsReady
    ? resolveAccessoryLines(composition.accessories, accessoriesHook.accessories)
    : []
  const packagingLines = componentsReady
    ? resolvePackagingLines(composition.packaging, packagingHook.packaging)
    : []
  const subtotal = calculateComponentsSubtotal(accessoryLines, packagingLines)

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Field label="Nome" value={product.name} />
          <Field label="Categoria" value={product.category ?? 'Não informada'} />
          <Field label="Descrição" value={product.description ?? 'Não informada'} />
          <Field label="Preço atual" value={formatBRL(product.default_price)} />
          <Field label="Permite personalização" value={product.allows_personalization ? 'Sim' : 'Não'} />
          <Field label="Situação" value={product.is_active ? 'Ativo' : 'Inativo'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Produção</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            Peso e tempo abaixo são do plate completo. Os valores "por unidade" são estimativas
            calculadas dividindo pelo número de unidades por plate — nunca gravadas no banco.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Field
              label="Peso do plate"
              value={product.default_weight_grams !== null ? formatGrams(product.default_weight_grams) : 'Não informado'}
            />
            <Field
              label="Tempo de impressão do plate"
              value={
                product.default_print_time_minutes !== null
                  ? formatMinutesAsHoursMinutes(product.default_print_time_minutes)
                  : 'Não informado'
              }
            />
            <Field
              label="Unidades por plate"
              value={product.units_per_plate !== null ? String(product.units_per_plate) : 'Não informado'}
            />
            <Field
              label="Peso estimado por unidade"
              value={weightPerUnit !== null ? `${formatGrams(weightPerUnit, 2)} (estimado)` : 'Não calculável'}
            />
            <Field
              label="Tempo estimado por unidade"
              value={timePerUnit !== null ? `${formatMinutesAsHoursMinutes(timePerUnit)} (estimado)` : 'Não calculável'}
            />
          </div>
        </CardContent>
      </Card>

      {componentsLoading && (
        <Card>
          <CardHeader>
            <CardTitle>Acessórios e embalagens</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      )}

      {!componentsLoading && componentsErrorInfo && (
        <div className="border-destructive/50 bg-destructive/10 flex items-center justify-between rounded-lg border p-3 text-sm">
          <span>{componentsErrorInfo.message}</span>
          <Button variant="outline" size="sm" onClick={componentsErrorInfo.retry}>
            Tentar novamente
          </Button>
        </div>
      )}

      {componentsReady && (
        <>
          <ComponentsTable title="Acessórios" lines={accessoryLines} emptyMessage="Nenhum acessório vinculado." />
          <ComponentsTable title="Embalagens" lines={packagingLines} emptyMessage="Nenhuma embalagem vinculada." />
          <ComponentsSubtotalCard subtotal={subtotal} />
        </>
      )}
    </div>
  )
}

export function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>()
  const { status, product, error, retry } = useProduct(productId ?? '')

  return (
    <AppLayout>
      <div className="flex flex-col gap-2">
        <Link to="/produtos" className={BACK_LINK_CLASSNAME}>
          ← Voltar para Produtos
        </Link>
        <div>
          <h1 className="font-heading text-2xl font-medium">Ficha Técnica do Produto</h1>
          {status === 'success' && product && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-muted-foreground text-lg font-medium">{product.name}</span>
              <ActiveBadge isActive={product.is_active} />
            </div>
          )}
        </div>
      </div>

      {status === 'loading' && (
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {status === 'error' && (
        <div className="border-destructive/50 bg-destructive/10 mt-4 flex items-center justify-between rounded-lg border p-3 text-sm">
          <span>{toErrorMessage(error)}</span>
          <Button variant="outline" size="sm" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      )}

      {status === 'not_found' && (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">Produto não encontrado.</p>
          <Link to="/produtos" className={BACK_LINK_CLASSNAME}>
            Voltar para a listagem de Produtos
          </Link>
        </div>
      )}

      {status === 'success' && product && <ProductDetailContent product={product} />}
    </AppLayout>
  )
}
