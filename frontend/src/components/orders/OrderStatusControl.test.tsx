import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api/errors'

const { changeOrderStatusMock, toastMock } = vi.hoisted(() => ({
  changeOrderStatusMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/api/orders', () => ({ changeOrderStatus: changeOrderStatusMock }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { OrderStatusControl } from './OrderStatusControl'
import type { OrderStatus } from '@/types/domain'

function renderControl(status: OrderStatus, onChanged: () => void = vi.fn()) {
  render(<OrderStatusControl orderId="o1" orderNumber="FS-26-001" status={status} onChanged={onChanged} />)
  return onChanged
}

describe('OrderStatusControl', () => {
  beforeEach(() => {
    changeOrderStatusMock.mockReset().mockResolvedValue(undefined)
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  it('QUOTE: renders a clickable badge (button), not a plain span', () => {
    renderControl('QUOTE')

    expect(screen.getByRole('button', { name: 'Orçamento' })).toBeInTheDocument()
  })

  it('DELIVERED: renders a plain badge with no button/interaction', () => {
    renderControl('DELIVERED')

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Entregue')).toBeInTheDocument()
  })

  it('CANCELLED: renders a plain badge with no button/interaction', () => {
    renderControl('CANCELLED')

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Cancelado')).toBeInTheDocument()
  })

  it('clicking the badge opens a dialog showing only the next valid transition (never a skipped status)', async () => {
    const user = userEvent.setup()
    renderControl('APPROVED')

    await user.click(screen.getByRole('button', { name: 'Aprovado' }))

    expect(screen.getByRole('heading', { name: 'Alterar status — FS-26-001' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /avançar para "fila de produção"/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /em produção/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /entregue/i })).not.toBeInTheDocument()
  })

  it('QUOTE/WAITING_APPROVAL/APPROVED/IN_PRODUCTION_QUEUE: mostra a opção de cancelar', async () => {
    const user = userEvent.setup()
    renderControl('IN_PRODUCTION_QUEUE')

    await user.click(screen.getByRole('button', { name: 'Fila de produção' }))

    expect(screen.getByRole('button', { name: /cancelar pedido/i })).toBeInTheDocument()
  })

  it('IN_PRODUCTION: não mostra a opção de cancelar (bloqueado pela máquina de estados)', async () => {
    const user = userEvent.setup()
    renderControl('IN_PRODUCTION')

    await user.click(screen.getByRole('button', { name: 'Em produção' }))

    expect(screen.queryByRole('button', { name: /cancelar pedido/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /avançar para "aguardando entrega"/i })).toBeInTheDocument()
  })

  it('exige confirmação: clicar em "Avançar para" não chama changeOrderStatus imediatamente', async () => {
    const user = userEvent.setup()
    renderControl('QUOTE')

    await user.click(screen.getByRole('button', { name: 'Orçamento' }))
    await user.click(screen.getByRole('button', { name: /avançar para/i }))

    expect(screen.getByText(/tem certeza que deseja avançar/i)).toBeInTheDocument()
    expect(changeOrderStatusMock).not.toHaveBeenCalled()
  })

  it('"Voltar" no passo de confirmação não altera nada e volta ao menu de opções', async () => {
    const user = userEvent.setup()
    renderControl('QUOTE')

    await user.click(screen.getByRole('button', { name: 'Orçamento' }))
    await user.click(screen.getByRole('button', { name: /avançar para/i }))
    await user.click(screen.getByRole('button', { name: /^voltar$/i }))

    expect(screen.getByRole('button', { name: /avançar para "aguardando aprovação"/i })).toBeInTheDocument()
    expect(changeOrderStatusMock).not.toHaveBeenCalled()
  })

  it('confirmar chama changeOrderStatus, mostra toast de sucesso e chama onChanged', async () => {
    const user = userEvent.setup()
    const onChanged = renderControl('QUOTE')

    await user.click(screen.getByRole('button', { name: 'Orçamento' }))
    await user.click(screen.getByRole('button', { name: /avançar para/i }))
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => expect(changeOrderStatusMock).toHaveBeenCalledWith('o1', 'WAITING_APPROVAL'))
    expect(toastMock.success).toHaveBeenCalledWith('Pedido FS-26-001: status atualizado para "Aguardando aprovação".')
    expect(onChanged).toHaveBeenCalled()
  })

  it('cancelar mostra o texto de aviso de encerramento e chama changeOrderStatus com CANCELLED', async () => {
    const user = userEvent.setup()
    const onChanged = renderControl('QUOTE')

    await user.click(screen.getByRole('button', { name: 'Orçamento' }))
    await user.click(screen.getByRole('button', { name: /cancelar pedido/i }))

    expect(screen.getByText(/esta ação encerra o fluxo do pedido/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => expect(changeOrderStatusMock).toHaveBeenCalledWith('o1', 'CANCELLED'))
    expect(toastMock.success).toHaveBeenCalledWith('Pedido FS-26-001 cancelado.')
    expect(onChanged).toHaveBeenCalled()
  })

  it('bloqueia duplo clique: o botão Confirmar fica desabilitado enquanto a chamada está em andamento', async () => {
    let resolvePromise: () => void = () => {}
    changeOrderStatusMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePromise = resolve
      }),
    )
    const user = userEvent.setup()
    renderControl('QUOTE')

    await user.click(screen.getByRole('button', { name: 'Orçamento' }))
    await user.click(screen.getByRole('button', { name: /avançar para/i }))
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    expect(screen.getByRole('button', { name: /confirmando/i })).toBeDisabled()
    await act(async () => {
      resolvePromise()
      await Promise.resolve()
    })
  })

  it('mostra o erro real do backend e mantém o diálogo aberto quando a transição falha', async () => {
    changeOrderStatusMock.mockRejectedValue(new ApiError('business_rule', 409, 'Transição de status inválida'))
    const user = userEvent.setup()
    renderControl('QUOTE')

    await user.click(screen.getByRole('button', { name: 'Orçamento' }))
    await user.click(screen.getByRole('button', { name: /avançar para/i }))
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    expect(await screen.findByText('Transição de status inválida')).toBeInTheDocument()
    expect(screen.getByText(/tem certeza que deseja avançar/i)).toBeInTheDocument()
  })

  // Gate de cores pendentes (rodada corretiva, migration 20260829180000,
  // ainda não aplicada) — change_order_status bloqueia IN_PRODUCTION_QUEUE
  // -> IN_PRODUCTION enquanto qualquer item CATALOG tiver unidade/plate sem
  // cor ativa; o erro chega pelo MESMO caminho genérico já testado acima
  // (ApiError business_rule), então nenhuma mudança de código foi
  // necessária aqui — este teste só confirma que a mensagem real do gate
  // (com identificação de produto/unidade/plate) chega íntegra à tela,
  // nunca reescrita ou genérica.
  it('IN_PRODUCTION_QUEUE -> IN_PRODUCTION bloqueado por cor pendente: mostra a mensagem real com a identificação da pendência', async () => {
    changeOrderStatusMock.mockRejectedValue(
      new ApiError(
        'business_rule',
        409,
        'Defina as cores antes de iniciar a produção — Chaveiro — Unidade 1, Plate 1: cor pendente.',
      ),
    )
    const user = userEvent.setup()
    renderControl('IN_PRODUCTION_QUEUE')

    await user.click(screen.getByRole('button', { name: 'Fila de produção' }))
    await user.click(screen.getByRole('button', { name: /avançar para/i }))
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    expect(
      await screen.findByText('Defina as cores antes de iniciar a produção — Chaveiro — Unidade 1, Plate 1: cor pendente.'),
    ).toBeInTheDocument()
  })

  it('fechar o diálogo sem confirmar não chama changeOrderStatus nem onChanged', async () => {
    const user = userEvent.setup()
    const onChanged = renderControl('QUOTE')

    await user.click(screen.getByRole('button', { name: 'Orçamento' }))
    await user.keyboard('{Escape}')

    expect(changeOrderStatusMock).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
