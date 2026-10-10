import { useEffect, useRef, useState } from 'react'
import type { Order, OrderShipment } from '../../api/order'
import { fill, formatCount, formatList, messages } from '../../messages'
import { lineName } from './orderDetail'
import { timeText } from './orderView'

const words = messages.orders.detail.shipments
const shipWords = messages.orders.detail.ship

export interface OrderShipmentsProps {
  order: Order
  timeZone: string
  /** Whose shipments the caller may add tracking to: the store's own, or a supplier's own. */
  canTrack: (shipment: OrderShipment) => boolean
  busy: boolean
  error: string | null
  /** A tracking form opened or closed: its last refusal is cleared. */
  onFormChange: () => void
  onTrack: (shipment: OrderShipment, courierName: string | null, trackingNumber: string, trackingUrl: string | null) => void
}

const whenText = (s: OrderShipment, timeZone: string) => {
  const time = timeText(s.shippedAt, timeZone)
  if (s.kind === 'sent_to_store') return fill(words.sentToStore, { time })
  if (s.kind === 'pickup') return fill(words.pickup, { time })
  return fill(words.shipped, { time, place: s.warehouseName })
}

/** What has left: each shipment's items and tracking, and adding tracking to one sent without it (`addTracking`). */
export const OrderShipments = ({ order, timeZone, canTrack, busy, error, onFormChange, onTrack }: OrderShipmentsProps) => {
  const [open, setOpenId] = useState<string | null>(null)
  const setOpen = (id: string | null) => {
    onFormChange()
    setOpenId(id)
  }
  const names = new Map(order.parts.flatMap((p) => p.lines.map((l) => [l.id, lineName(l)] as const)))
  if (order.shipments.length === 0) return null
  return (
    <section className="df-order-card df-order-shipments" aria-labelledby="df-order-shipments">
      <h2 id="df-order-shipments">{words.title}</h2>
      {order.shipments.map((s) => (
        <div key={s.id} className="df-order-shipment">
          <span className="df-order-sub">{whenText(s, timeZone)}</span>
          <span>{formatList(s.lines.map((l) => fill(words.item, { count: formatCount(l.quantity), name: names.get(l.lineId) ?? '' })))}</span>
          {s.trackingNumber ? (
            <span>
              {s.courierName ? fill(words.tracking, { courier: s.courierName, number: s.trackingNumber }) : fill(words.trackingOnly, { number: s.trackingNumber })}
              {s.trackingUrl && (
                <>
                  {' '}
                  <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">
                    {words.track}
                  </a>
                </>
              )}
            </span>
          ) : (
            s.kind !== 'pickup' && (
              <span className="df-order-sub">
                {words.noTracking}
                {canTrack(s) && open !== s.id && (
                  <>
                    {' '}
                    <button type="button" className="df-link-button" onClick={() => setOpen(s.id)}>
                      {words.add}
                    </button>
                  </>
                )}
              </span>
            )
          )}
          {open === s.id && !s.trackingNumber && <TrackingForm shipment={s} busy={busy} error={error} onCancel={() => setOpen(null)} onSave={(c, n, u) => onTrack(s, c, n, u)} />}
        </div>
      ))}
    </section>
  )
}

const TrackingForm = ({ shipment, busy, error, onCancel, onSave }: { shipment: OrderShipment; busy: boolean; error: string | null; onCancel: () => void; onSave: (courier: string | null, number: string, url: string | null) => void }) => {
  const [courier, setCourier] = useState(shipment.courierName ?? '')
  const [number, setNumber] = useState('')
  const [link, setLink] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const save = () => {
    const url = link.trim()
    if (!number.trim()) return setProblem(words.numberMissing)
    if (url && !/^https:\/\/\S+$/i.test(url)) return setProblem(shipWords.linkInvalid)
    setProblem(null)
    onSave(courier.trim() || null, number.trim(), url || null)
  }
  return (
    <div className="df-order-tracking-form">
      <div className="df-order-form-grid">
        <label className="df-order-field">
          <span>{shipWords.tracking}</span>
          <input ref={first} className="df-order-mono" value={number} maxLength={80} placeholder={shipWords.trackingPlaceholder} onChange={(event) => setNumber(event.target.value)} />
        </label>
        <label className="df-order-field">
          <span>{shipWords.courier}</span>
          <input value={courier} maxLength={80} placeholder={shipWords.courierPlaceholder} onChange={(event) => setCourier(event.target.value)} />
        </label>
      </div>
      <label className="df-order-field">
        <span>
          {shipWords.link} <small>{shipWords.linkHint}</small>
        </span>
        <input type="url" value={link} placeholder={shipWords.linkPlaceholder} onChange={(event) => setLink(event.target.value)} />
      </label>
      {(problem ?? error) && (
        <p className="df-order-problem" role="alert">
          {problem ?? error}
        </p>
      )}
      <div className="df-order-form-actions">
        <button type="button" className="df-button" onClick={onCancel}>
          {words.cancel}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={busy} aria-busy={busy || undefined} onClick={save}>
          {words.save}
        </button>
      </div>
    </div>
  )
}
