import { useCallback, useEffect, useState } from 'react'
import { listProductPlateFilaments, listProductPlates } from '@/lib/api/productPlates'
import { ApiError } from '@/lib/api/errors'
import type { ProductPlate, ProductPlateFilament } from '@/types/domain'

// Espelha useProductComposition.ts na estrutura — leitura só (nenhum
// `save`: toda escrita de plates passa por updateProductFull/
// createProductWithPlates, nunca por uma chamada isolada daqui, para que
// product_plates/product_plate_filaments nunca sejam alterados fora da
// transação atômica única do Produto inteiro).

export type ProductPlatesStatus = 'idle' | 'loading' | 'error' | 'success'

interface UseProductPlatesResult {
  status: ProductPlatesStatus
  plates: ProductPlate[]
  filamentsByPlateId: Map<string, ProductPlateFilament[]>
  isLoading: boolean
  error: ApiError | null
  retry: () => void
}

interface LoadResult {
  productId: string
  status: 'success' | 'error'
  plates: ProductPlate[]
  filamentsByPlateId: Map<string, ProductPlateFilament[]>
  error: ApiError | null
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('database', 500, 'Erro desconhecido.')
}

export function useProductPlates(productId: string | null): UseProductPlatesResult {
  const [trackedProductId, setTrackedProductId] = useState(productId)
  const [result, setResult] = useState<LoadResult | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  if (productId !== trackedProductId) {
    setTrackedProductId(productId)
    setResult(null)
  }

  useEffect(() => {
    if (!productId) return

    let cancelled = false

    listProductPlates(productId)
      .then(async (plates) => {
        const filaments = await listProductPlateFilaments(plates.map((plate) => plate.id))
        if (cancelled) return
        const filamentsByPlateId = new Map<string, ProductPlateFilament[]>()
        for (const filament of filaments) {
          const current = filamentsByPlateId.get(filament.plate_id) ?? []
          current.push(filament)
          filamentsByPlateId.set(filament.plate_id, current)
        }
        setResult({ productId, status: 'success', plates, filamentsByPlateId, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResult({ productId, status: 'error', plates: [], filamentsByPlateId: new Map(), error: toApiError(err) })
      })

    return () => {
      cancelled = true
    }
  }, [productId, retryToken])

  let status: ProductPlatesStatus
  let plates: ProductPlate[] = []
  let filamentsByPlateId = new Map<string, ProductPlateFilament[]>()
  let error: ApiError | null = null

  if (!productId) {
    status = 'idle'
  } else if (result === null || result.productId !== productId) {
    status = 'loading'
  } else if (result.status === 'success') {
    status = 'success'
    plates = result.plates
    filamentsByPlateId = result.filamentsByPlateId
  } else {
    status = 'error'
    error = result.error
  }

  const retry = useCallback(() => {
    setResult(null)
    setRetryToken((count) => count + 1)
  }, [])

  return { status, plates, filamentsByPlateId, isLoading: status === 'loading', error, retry }
}
