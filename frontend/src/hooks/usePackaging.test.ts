import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listPackagingMock, createPackagingMock, updatePackagingMock, deletePackagingMock } = vi.hoisted(() => ({
  listPackagingMock: vi.fn(),
  createPackagingMock: vi.fn(),
  updatePackagingMock: vi.fn(),
  deletePackagingMock: vi.fn(),
}))

vi.mock('@/lib/api/packaging', () => ({
  listPackaging: listPackagingMock,
  createPackaging: createPackagingMock,
  updatePackaging: updatePackagingMock,
  deletePackaging: deletePackagingMock,
}))

import { usePackaging } from './usePackaging'

const packagingItem = {
  id: '1',
  name: 'Caixa M',
  material: null,
  size: null,
  variant: null,
  unit_cost: null,
  minimum_stock: null,
  current_stock: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
}

const otherPackagingItem = { ...packagingItem, id: '2', name: 'Sacola Kraft' }

describe('usePackaging', () => {
  beforeEach(() => {
    listPackagingMock.mockReset()
    createPackagingMock.mockReset()
    updatePackagingMock.mockReset()
    deletePackagingMock.mockReset()
  })

  it('loads the packaging list on mount', async () => {
    listPackagingMock.mockResolvedValue([packagingItem])

    const { result } = renderHook(() => usePackaging())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.packaging).toEqual([packagingItem])
    expect(result.current.error).toBeNull()
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listPackagingMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => usePackaging())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
  })

  it('create() calls the API, inserts the new item locally (sorted by name) and returns it — without refetching', async () => {
    listPackagingMock.mockResolvedValue([otherPackagingItem])
    createPackagingMock.mockResolvedValue(packagingItem)

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let created
    await act(async () => {
      created = await result.current.create({ name: 'Caixa M', minimum_stock: 3 })
    })

    expect(createPackagingMock).toHaveBeenCalledWith({ name: 'Caixa M', minimum_stock: 3 })
    expect(created).toEqual(packagingItem)
    // "Caixa M" vem antes de "Sacola Kraft" na ordenação pt-BR.
    expect(result.current.packaging).toEqual([packagingItem, otherPackagingItem])
    expect(listPackagingMock).toHaveBeenCalledTimes(1)
  })

  it('create() propagates an ApiError without changing the current list', async () => {
    listPackagingMock.mockResolvedValue([otherPackagingItem])
    createPackagingMock.mockRejectedValue(new ApiError('validation', 400, 'Campo inválido: name.'))

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.create({ name: '', minimum_stock: 0 })
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.packaging).toEqual([otherPackagingItem])
  })

  it('update() calls the API, replaces the item locally (still sorted by name) and returns it — without refetching', async () => {
    listPackagingMock.mockResolvedValue([packagingItem, otherPackagingItem])
    const updated = { ...packagingItem, name: 'Argola plástica', minimum_stock: 15 }
    updatePackagingMock.mockResolvedValue(updated)

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let returned
    await act(async () => {
      returned = await result.current.update('1', { name: 'Argola plástica', minimum_stock: 15 })
    })

    expect(updatePackagingMock).toHaveBeenCalledWith('1', { name: 'Argola plástica', minimum_stock: 15 })
    expect(returned).toEqual(updated)
    // "Argola plástica" reordena antes de "Sacola Kraft" — a lista continua
    // ordenada por nome após a atualização local, sem precisar de refetch.
    expect(result.current.packaging).toEqual([updated, otherPackagingItem])
    expect(listPackagingMock).toHaveBeenCalledTimes(1)
  })

  it('update() propagates an ApiError without changing the current list', async () => {
    listPackagingMock.mockResolvedValue([packagingItem, otherPackagingItem])
    updatePackagingMock.mockRejectedValue(new ApiError('validation', 400, 'Campo inválido: name.'))

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.update('1', { name: '' })
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.packaging).toEqual([packagingItem, otherPackagingItem])
  })

  // Ativação/desativação (Módulo Estoque, incremento de is_active) reusa o
  // mesmo update() genérico acima — nenhum método novo no hook, só um
  // payload de uma única chave.
  it('update() com { is_active } desativa o item localmente, sem alterar nome/tamanho/variante/estoque mínimo', async () => {
    listPackagingMock.mockResolvedValue([packagingItem, otherPackagingItem])
    const deactivated = { ...packagingItem, is_active: false }
    updatePackagingMock.mockResolvedValue(deactivated)

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.update('1', { is_active: false })
    })

    expect(updatePackagingMock).toHaveBeenCalledWith('1', { is_active: false })
    expect(Object.keys(updatePackagingMock.mock.calls[0][1])).toEqual(['is_active'])
    expect(result.current.packaging).toEqual([deactivated, otherPackagingItem])
  })

  it('update() com { is_active } reativa o item localmente e preserva a ordenação por nome', async () => {
    listPackagingMock.mockResolvedValue([packagingItem, otherPackagingItem])
    const reactivated = { ...otherPackagingItem, is_active: true }
    updatePackagingMock.mockResolvedValue(reactivated)

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.update('2', { is_active: true })
    })

    expect(updatePackagingMock).toHaveBeenCalledWith('2', { is_active: true })
    expect(result.current.packaging).toEqual([packagingItem, reactivated])
  })

  it('update() com { is_active } propaga erro sem alterar o estado anterior do item', async () => {
    listPackagingMock.mockResolvedValue([packagingItem, otherPackagingItem])
    updatePackagingMock.mockRejectedValue(new ApiError('database', 500, 'Falha ao atualizar embalagem.'))

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.update('1', { is_active: false })
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.packaging).toEqual([packagingItem, otherPackagingItem])
  })

  // Exclusão física segura (delete_packaging via Edge Function): a
  // verificação de vínculo/bloqueio acontece inteiramente no backend — o
  // hook só reflete o resultado (remove do array local em sucesso, ou
  // propaga o erro sem tocar no array quando a API rejeita).
  it('delete() chama a API e remove só o item correto do array local', async () => {
    listPackagingMock.mockResolvedValue([packagingItem, otherPackagingItem])
    deletePackagingMock.mockResolvedValue({ success: true })

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.delete('1')
    })

    expect(deletePackagingMock).toHaveBeenCalledWith('1')
    expect(result.current.packaging).toEqual([otherPackagingItem])
  })

  it('delete() bloqueado (item vinculado a produto) mantém o item no array local', async () => {
    listPackagingMock.mockResolvedValue([packagingItem, otherPackagingItem])
    deletePackagingMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Esta embalagem está vinculada a um produto e não pode ser excluída. Desative o item.'),
    )

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.delete('1')
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.packaging).toEqual([packagingItem, otherPackagingItem])
  })

  it('delete() com erro inesperado mantém o item no array local', async () => {
    listPackagingMock.mockResolvedValue([packagingItem, otherPackagingItem])
    deletePackagingMock.mockRejectedValue(new ApiError('database', 500, 'Falha ao excluir embalagem.'))

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.delete('1')
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.packaging).toEqual([packagingItem, otherPackagingItem])
  })

  it('delete() de um item inexistente não remove nenhum item do array local (id não bate)', async () => {
    listPackagingMock.mockResolvedValue([packagingItem, otherPackagingItem])
    deletePackagingMock.mockRejectedValue(new ApiError('not_found', 404, 'packaging.id 999 não encontrado'))

    const { result } = renderHook(() => usePackaging())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.delete('999')
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.packaging).toEqual([packagingItem, otherPackagingItem])
  })
})
