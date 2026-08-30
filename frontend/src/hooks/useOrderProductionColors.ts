import { useCallback, useEffect, useState } from 'react'
import { listOrderItems } from '@/lib/api/orderItems'
import { listOrderItemPlates, listOrderItemUnitPlateFilaments } from '@/lib/api/orderProductionColors'
import { updateOrderProductionColors, type OrderProductionColorSelectionInput } from '@/lib/api/orders'
import { colorKey, type ProductionColorItem, type ProductionColorsValue } from '@/components/orders/ProductionColorsPicker'
import { ApiError } from '@/lib/api/errors'

// Caminho para completar/alterar cores DEPOIS da criação do Pedido — via
// PATCH /orders/:id/production-colors (migration
// 20260829180000_add_categories_plate_weight_and_order_colors.sql, ainda
// não aplicada). Usado por OrderManagementPanel.tsx (qualquer status do
// pedido, exceto DELIVERED/CANCELLED, onde a RPC recusa a chamada) —
// diferente de OrderForm/OrderEditForm, que só entram em jogo na criação/
// edição completa de itens (mode="edit" só funciona em QUOTE).
//
// A chave de cada item (ver ProductionColorsPicker.tsx) é o próprio
// order_item_id — nunca reaproveita a key ephemeral de linha de formulário
// usada em OrderForm.tsx.

export type UseOrderProductionColorsStatus = 'idle' | 'loading' | 'error' | 'success'

interface LoadResult {
  status: 'success' | 'error'
  items: ProductionColorItem[]
  value: ProductionColorsValue
  error: ApiError | null
}

interface UseOrderProductionColorsResult {
  status: UseOrderProductionColorsStatus
  items: ProductionColorItem[]
  value: ProductionColorsValue
  isLoading: boolean
  error: ApiError | null
  retry: () => void
  isSaving: boolean
  save: (next: ProductionColorsValue) => Promise<void>
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useOrderProductionColors(orderId: string | null): UseOrderProductionColorsResult {
  const [trackedOrderId, setTrackedOrderId] = useState(orderId)
  const [result, setResult] = useState<LoadResult | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const [isSaving, setIsSaving] = useState(false)

  if (orderId !== trackedOrderId) {
    setTrackedOrderId(orderId)
    setResult(null)
  }

  useEffect(() => {
    if (!orderId) return

    let cancelled = false

    listOrderItems(orderId)
      .then(async (orderItems) => {
        const catalogItems = orderItems.filter((item) => item.item_type === 'CATALOG')
        const orderItemIds = catalogItems.map((item) => item.id)
        const [plates, selections] = await Promise.all([
          listOrderItemPlates(orderItemIds),
          listOrderItemUnitPlateFilaments(orderItemIds),
        ])
        if (cancelled) return

        const platesByOrderItemId = new Map<string, typeof plates>()
        for (const plate of plates) {
          const current = platesByOrderItemId.get(plate.order_item_id) ?? []
          current.push(plate)
          platesByOrderItemId.set(plate.order_item_id, current)
        }
        const plateNumberByPlateId = new Map(plates.map((plate) => [plate.id, plate.plate_number]))

        const items: ProductionColorItem[] = catalogItems.map((item) => ({
          key: item.id,
          label: item.item_name,
          quantity: item.quantity,
          plateCount: (platesByOrderItemId.get(item.id) ?? []).length,
        }))

        const value: ProductionColorsValue = {}
        for (const selection of selections) {
          const plateNumber = plateNumberByPlateId.get(selection.order_item_plate_id)
          if (plateNumber === undefined) continue
          const key = colorKey(selection.order_item_id, selection.unit_number, plateNumber)
          value[key] = [...(value[key] ?? []), selection.filament_type_id]
        }

        setResult({ status: 'success', items, value, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResult({ status: 'error', items: [], value: {}, error: toApiError(err) })
      })

    return () => {
      cancelled = true
    }
  }, [orderId, retryToken])

  let status: UseOrderProductionColorsStatus
  let items: ProductionColorItem[] = []
  let value: ProductionColorsValue = {}
  let error: ApiError | null = null

  if (!orderId) {
    status = 'idle'
  } else if (result === null) {
    status = 'loading'
  } else if (result.status === 'success') {
    status = 'success'
    items = result.items
    value = result.value
  } else {
    status = 'error'
    error = result.error
  }

  const retry = useCallback(() => {
    setResult(null)
    setRetryToken((count) => count + 1)
  }, [])

  // Substitui TODO o conjunto de cores dos itens CATALOG deste Pedido a
  // partir de `next` — mesma semântica "substitui o conjunto inteiro" da
  // RPC (update_order_item_production_colors); nunca um PATCH incremental.
  const save = useCallback(
    async (next: ProductionColorsValue) => {
      if (!orderId) return
      setIsSaving(true)
      try {
        const selections: OrderProductionColorSelectionInput[] = []
        for (const [key, filamentTypeIds] of Object.entries(next)) {
          if (filamentTypeIds.length === 0) continue
          const [orderItemId, unitText, plateText] = key.split(':')
          selections.push({
            order_item_id: orderItemId,
            unit_number: Number(unitText),
            plate_number: Number(plateText),
            filament_type_ids: filamentTypeIds,
          })
        }
        await updateOrderProductionColors(orderId, selections)
        setResult((current) => (current && current.status === 'success' ? { ...current, value: next } : current))
      } finally {
        setIsSaving(false)
      }
    },
    [orderId],
  )

  return { status, items, value, isLoading: status === 'loading', error, retry, isSaving, save }
}
