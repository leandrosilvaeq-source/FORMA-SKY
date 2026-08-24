import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'

const { listAccessoriesMock, createAccessoryMock, updateAccessoryMock, deleteAccessoryMock } = vi.hoisted(() => ({
  listAccessoriesMock: vi.fn(),
  createAccessoryMock: vi.fn(),
  updateAccessoryMock: vi.fn(),
  deleteAccessoryMock: vi.fn(),
}))

vi.mock('@/lib/api/accessories', () => ({
  listAccessories: listAccessoriesMock,
  createAccessory: createAccessoryMock,
  updateAccessory: updateAccessoryMock,
  deleteAccessory: deleteAccessoryMock,
}))

import { useAccessories } from './useAccessories'

const accessory = {
  id: '1',
  name: 'Ímã 6x2',
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

const otherAccessory = { ...accessory, id: '2', name: 'Zebra clipe' }

describe('useAccessories', () => {
  beforeEach(() => {
    listAccessoriesMock.mockReset()
    createAccessoryMock.mockReset()
    updateAccessoryMock.mockReset()
    deleteAccessoryMock.mockReset()
  })

  it('loads the accessory list on mount', async () => {
    listAccessoriesMock.mockResolvedValue([accessory])

    const { result } = renderHook(() => useAccessories())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.accessories).toEqual([accessory])
    expect(result.current.error).toBeNull()
  })

  it('exposes an ApiError when the list fails to load', async () => {
    listAccessoriesMock.mockRejectedValue(new ApiError('database', 500, 'falhou'))

    const { result } = renderHook(() => useAccessories())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('falhou')
  })

  it('create() calls the API, inserts the new item locally (sorted by name) and returns it — without refetching', async () => {
    listAccessoriesMock.mockResolvedValue([otherAccessory])
    createAccessoryMock.mockResolvedValue(accessory)

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let created
    await act(async () => {
      created = await result.current.create({ name: 'Ímã 6x2', minimum_stock: 5 })
    })

    expect(createAccessoryMock).toHaveBeenCalledWith({ name: 'Ímã 6x2', minimum_stock: 5 })
    expect(created).toEqual(accessory)
    // "Ímã 6x2" vem antes de "Zebra clipe" na ordenação pt-BR — o hook
    // reordena localmente, mesma ordem que um refetch real traria.
    expect(result.current.accessories).toEqual([accessory, otherAccessory])
    // Nunca dispara uma nova chamada de listagem — só a chamada inicial do
    // mount.
    expect(listAccessoriesMock).toHaveBeenCalledTimes(1)
  })

  it('create() propagates an ApiError without changing the current list', async () => {
    listAccessoriesMock.mockResolvedValue([otherAccessory])
    createAccessoryMock.mockRejectedValue(new ApiError('validation', 400, 'Campo inválido: name.'))

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.create({ name: '', minimum_stock: 0 })
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.accessories).toEqual([otherAccessory])
  })

  it('update() calls the API, replaces the item locally (still sorted by name) and returns it — without refetching', async () => {
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    const updated = { ...accessory, name: 'Ábaco', minimum_stock: 20 }
    updateAccessoryMock.mockResolvedValue(updated)

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let returned
    await act(async () => {
      returned = await result.current.update('1', { name: 'Ábaco', minimum_stock: 20 })
    })

    expect(updateAccessoryMock).toHaveBeenCalledWith('1', { name: 'Ábaco', minimum_stock: 20 })
    expect(returned).toEqual(updated)
    // "Ábaco" reordena antes de "Zebra clipe" — a lista continua ordenada
    // por nome após a atualização local, sem precisar de refetch.
    expect(result.current.accessories).toEqual([updated, otherAccessory])
    expect(listAccessoriesMock).toHaveBeenCalledTimes(1)
  })

  it('update() propagates an ApiError without changing the current list', async () => {
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    updateAccessoryMock.mockRejectedValue(new ApiError('validation', 400, 'Campo inválido: name.'))

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.update('1', { name: '' })
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.accessories).toEqual([accessory, otherAccessory])
  })

  // Ativação/desativação (Módulo Estoque, incremento de is_active) reusa o
  // mesmo update() genérico acima — nenhum método novo no hook, só um
  // payload de uma única chave. Estes testes documentam explicitamente esse
  // uso, em vez de depender implicitamente dos testes de update() gerais.
  it('update() com { is_active } desativa o item localmente, sem alterar nome/tamanho/variante/estoque mínimo', async () => {
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    const deactivated = { ...accessory, is_active: false }
    updateAccessoryMock.mockResolvedValue(deactivated)

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.update('1', { is_active: false })
    })

    expect(updateAccessoryMock).toHaveBeenCalledWith('1', { is_active: false })
    // O payload enviado contém só a chave is_active — nada mais.
    expect(Object.keys(updateAccessoryMock.mock.calls[0][1])).toEqual(['is_active'])
    expect(result.current.accessories).toEqual([deactivated, otherAccessory])
  })

  it('update() com { is_active } reativa o item localmente e preserva a ordenação por nome', async () => {
    // "Zebra clipe" (id '2') reordena para o final mesmo depois de
    // reativado — a reordenação por nome nunca depende de is_active.
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    const reactivated = { ...otherAccessory, is_active: true }
    updateAccessoryMock.mockResolvedValue(reactivated)

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.update('2', { is_active: true })
    })

    expect(updateAccessoryMock).toHaveBeenCalledWith('2', { is_active: true })
    expect(result.current.accessories).toEqual([accessory, reactivated])
  })

  it('update() com { is_active } propaga erro sem alterar o estado anterior do item', async () => {
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    updateAccessoryMock.mockRejectedValue(new ApiError('database', 500, 'Falha ao atualizar acessório.'))

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.update('1', { is_active: false })
      }),
    ).rejects.toBeInstanceOf(ApiError)

    // O item permanece exatamente como estava (is_active: true) — nenhuma
    // atualização otimista é aplicada antes da resposta da API.
    expect(result.current.accessories).toEqual([accessory, otherAccessory])
  })

  // Exclusão física segura (delete_accessory via Edge Function): a
  // verificação de vínculo/bloqueio acontece inteiramente no backend — o
  // hook só reflete o resultado (remove do array local em sucesso, ou
  // propaga o erro sem tocar no array quando a API rejeita).
  it('delete() chama a API e remove só o item correto do array local', async () => {
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    deleteAccessoryMock.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.delete('1')
    })

    expect(deleteAccessoryMock).toHaveBeenCalledWith('1')
    expect(result.current.accessories).toEqual([otherAccessory])
  })

  it('delete() bloqueado (item vinculado a produto) mantém o item no array local', async () => {
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    deleteAccessoryMock.mockRejectedValue(
      new ApiError('business_rule', 409, 'Este acessório está vinculado a um produto e não pode ser excluído. Desative o item.'),
    )

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.delete('1')
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.accessories).toEqual([accessory, otherAccessory])
  })

  it('delete() com erro inesperado mantém o item no array local', async () => {
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    deleteAccessoryMock.mockRejectedValue(new ApiError('database', 500, 'Falha ao excluir acessório.'))

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.delete('1')
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.accessories).toEqual([accessory, otherAccessory])
  })

  it('delete() de um item inexistente não remove nenhum item do array local (id não bate)', async () => {
    listAccessoriesMock.mockResolvedValue([accessory, otherAccessory])
    deleteAccessoryMock.mockRejectedValue(new ApiError('not_found', 404, 'accessories.id 999 não encontrado'))

    const { result } = renderHook(() => useAccessories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      act(async () => {
        await result.current.delete('999')
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(result.current.accessories).toEqual([accessory, otherAccessory])
  })
})
