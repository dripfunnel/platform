import type { Order } from '../../api/order'
import { fill, messages } from '../../messages'
import { eventText } from './orderDetail'
import { timeText, zoneName } from './orderView'

const words = messages.orders.detail

/** The order's history, newest first, and the team's "Add a note" (only the team sees it). */
export const OrderHistory = ({ order, timeZone, note }: { order: Order; timeZone: string; note: { disabled: boolean; onAdd: () => void } | null }) => (
  <section className="df-order-card df-order-history" aria-labelledby="df-order-history">
    <div className="df-order-card-head">
      <h2 id="df-order-history">{words.history.title}</h2>
      <span className="df-order-sub">{fill(messages.orders.timesIn, { zone: zoneName(timeZone) })}</span>
    </div>
    {order.history.length === 0 ? (
      <p className="df-order-sub">{words.history.empty}</p>
    ) : (
      <ol className="df-order-events">
        {order.history.map((event) => (
          <li key={event.id}>
            <span className="df-order-event-time">{timeText(event.at, timeZone)}</span>
            <span>{eventText(event)}</span>
          </li>
        ))}
      </ol>
    )}
    {note && (
      <button type="button" className="df-order-add-note" disabled={note.disabled} onClick={note.onAdd}>
        {words.note.add}
      </button>
    )}
  </section>
)
