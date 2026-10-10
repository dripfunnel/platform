import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import type { Order, OrderReturn } from '../../api/order'
import { fill, formatCount, formatList, messages } from '../../messages'
import { leftInReturn, lineName } from './orderDetail'
import { timeText } from './orderView'

const words = messages.orders.detail.returns

type ReturnState = keyof typeof words.states

const pill: Record<ReturnState, { tone: StatusTone; icon: StatusIconName }> = {
  requested: { tone: 'warning', icon: 'hour' },
  received: { tone: 'warning', icon: 'alert' },
  refunded: { tone: 'success', icon: 'ok' },
  cancelled: { tone: 'neutral', icon: 'ban' },
}

const stateOf = (r: OrderReturn): ReturnState => (r.state in words.states ? (r.state as ReturnState) : 'requested')
const reasonText = (reason: string) => (reason in words.reasons ? words.reasons[reason as keyof typeof words.reasons] : reason)

export interface OrderReturnsProps {
  order: Order
  timeZone: string
  /** The store's own (`orders.refund`, merchant side): receive and cancel a return. */
  canManage: boolean
  /** Refund what a received return holds of the caller's own lines. */
  canRefund: boolean
  disabled: boolean
  onReceive: (r: OrderReturn) => void
  onCancel: (r: OrderReturn) => void
  onRefund: (r: OrderReturn) => void
}

/** Each return (PortalOrders): On its way back → Received → Refunded, or Cancelled while on its way back. */
export const OrderReturns = ({ order, timeZone, canManage, canRefund, disabled, onReceive, onCancel, onRefund }: OrderReturnsProps) => {
  const lines = new Map(order.parts.flatMap((p) => p.lines.map((l) => [l.id, { name: lineName(l), supplier: p.supplierName }] as const)))
  return (
    <>
      {order.returns.map((r) => {
        const state = stateOf(r)
        const suppliers = [...new Set(r.lines.map((l) => lines.get(l.lineId)?.supplier).filter((s): s is string => Boolean(s)))]
        const sub = { reason: reasonText(r.reason), time: timeText(r.startedAt, timeZone) }
        const owed = r.lines.some((l) => lines.has(l.lineId) && leftInReturn(order, r, l.lineId) > 0)
        return (
          <section key={r.id} className="df-order-card df-order-return" aria-label={fill(words.title, { number: r.number })}>
            <div className="df-order-card-head">
              <h2>{fill(words.title, { number: r.number })}</h2>
              <StatusPill {...pill[state]} label={words.states[state]} />
            </div>
            <span>{formatList(r.lines.map((l) => fill(messages.orders.detail.shipments.item, { count: formatCount(l.quantity), name: lines.get(l.lineId)?.name ?? '' })))}</span>
            <span className="df-order-sub">{suppliers.length > 0 ? fill(words.suppliersRefund, { ...sub, suppliers: formatList(suppliers) }) : fill(words.sub, sub)}</span>
            {(state === 'requested' && canManage) || (state === 'received' && canRefund && owed) ? (
              <div className="df-order-return-actions">
                {state === 'requested' ? (
                  <>
                    <button type="button" className="df-button" disabled={disabled} onClick={() => onReceive(r)}>
                      {words.receive}
                    </button>
                    <button type="button" className="df-link-button" disabled={disabled} onClick={() => onCancel(r)}>
                      {words.cancel}
                    </button>
                  </>
                ) : (
                  <button type="button" className="df-button" disabled={disabled} onClick={() => onRefund(r)}>
                    {words.refundThese}
                  </button>
                )}
              </div>
            ) : null}
          </section>
        )
      })}
    </>
  )
}
