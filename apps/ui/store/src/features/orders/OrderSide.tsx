import type { Order } from '../../api/order'
import type { ApiMoney } from '../../api/orders'
import { fill, messages } from '../../messages'
import { addressText, methodText } from './orderDetail'
import { moneyText, type OrdersAccess } from './orderView'

const words = messages.orders.detail

const some = (m: ApiMoney | null): m is ApiMoney => m !== null && Number(m.amount) > 0

/** The order's money as the API worked it out: items, discount, delivery, tax, duties, total and what went back. */
const Totals = ({ order }: { order: Order }) => {
  const rows: { key: string; label: string; value: string; strong?: boolean; refund?: boolean }[] = []
  if (order.subtotal) rows.push({ key: 'items', label: words.totals.items, value: moneyText(order.subtotal) })
  if (some(order.discount)) rows.push({ key: 'discount', label: words.totals.discount, value: fill(words.totals.less, { amount: moneyText(order.discount) }) })
  if (order.shipping) rows.push({ key: 'delivery', label: words.totals.delivery, value: some(order.shipping) ? moneyText(order.shipping) : words.totals.free })
  if (order.tax) rows.push({ key: 'tax', label: order.taxInclusive ? words.totals.includesTax : words.totals.tax, value: moneyText(order.tax) })
  if (some(order.duties)) rows.push({ key: 'duties', label: words.totals.duties, value: moneyText(order.duties) })
  if (order.total) rows.push({ key: 'total', label: words.totals.total, value: moneyText(order.total), strong: true })
  if (some(order.refunded)) rows.push({ key: 'refunded', label: words.totals.refunded, value: fill(words.totals.less, { amount: moneyText(order.refunded) }), refund: true })
  rows.push({ key: 'method', label: words.totals.paidWith, value: methodText(order.paymentMethod) })
  return (
    <section className="df-order-card df-order-side" aria-labelledby="df-order-totals">
      <h2 id="df-order-totals">{words.totals.title}</h2>
      <dl className="df-order-totals">
        {rows.map((r) => (
          <div key={r.key} className={r.strong ? 'df-order-total df-order-total--strong' : r.refund ? 'df-order-total df-order-total--refund' : 'df-order-total'}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const Customer = ({ order, contact }: { order: Order; contact: boolean }) => (
  <section className="df-order-card df-order-side" aria-labelledby="df-order-customer">
    <h2 id="df-order-customer">{words.customer.title}</h2>
    <span className="df-order-customer-name">{order.customerName ?? words.customer.guest}</span>
    {contact && (order.email || order.phone) && (
      <span className="df-order-text2">
        {order.email}
        {order.email && order.phone && <br />}
        {order.phone}
      </span>
    )}
    {order.shippingOption === 'pickup' ? (
      <span className="df-order-text2">{words.customer.pickup}</span>
    ) : (
      order.shippingAddress && (
        <span className="df-order-text2 df-order-address">
          <strong>{words.customer.deliverTo}</strong>
          <span>{addressText(order.shippingAddress, order.customerName)}</span>
        </span>
      )
    )}
    {order.marketName && <span className="df-order-sub">{fill(words.customer.market, { market: order.marketName })}</span>}
    {order.shopperNote && (
      <span className="df-order-text2">
        <strong>{words.customer.shopperNote}</strong>
        <br />
        {order.shopperNote}
      </span>
    )}
  </section>
)

/** The right column: payment and the shopper for the merchant side; for a supplier, where its items go. */
export const OrderSide = ({ order, access, store }: { order: Order; access: OrdersAccess; store: string }) => {
  if (access.supplier) {
    const toShopper = order.parts.some((p) => p.shippingMode === 'to-shopper')
    if (toShopper) return <Customer order={order} contact={false} />
    return (
      <section className="df-order-card df-order-side" aria-labelledby="df-order-send-to">
        <h2 id="df-order-send-to">{words.sendTo.title}</h2>
        <span className="df-order-customer-name">{store}</span>
        <span className="df-order-sub">{fill(words.sendTo.body, { store })}</span>
      </section>
    )
  }
  return (
    <>
      {access.money && <Totals order={order} />}
      <Customer order={order} contact />
    </>
  )
}
