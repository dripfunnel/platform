import { useEffect, useId, useRef, useState } from 'react'
import type { Warehouse } from '../../api/stock'
import { fill, formatCount, messages, plural } from '../../messages'

const words = messages.orders.detail.ship

export type ShipKind = 'courier' | 'pickup' | 'toStore'

export interface ShipForm {
  warehouseId: string
  courierName: string | null
  trackingNumber: string | null
  trackingUrl: string | null
}

export interface ShipPanelProps {
  kind: ShipKind
  count: number
  warehouses: readonly Warehouse[] | null
  store: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onShip: (form: ShipForm) => void
}

/** "Ship N items" (PortalOrders): from which location, the courier and tracking, and the button that ships them. */
export const ShipPanel = ({ kind, count, warehouses, store, busy, error, onCancel, onShip }: ShipPanelProps) => {
  const id = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [courier, setCourier] = useState('')
  const [tracking, setTracking] = useState('')
  const [link, setLink] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => headingRef.current?.focus(), [])
  useEffect(() => {
    if (warehouses && !warehouses.some((w) => w.id === warehouseId)) setWarehouseId(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '')
  }, [warehouses, warehouseId])

  const courierFields = kind !== 'pickup'
  const submit = () => {
    const number = tracking.trim()
    const url = link.trim()
    if (count === 0) return setProblem(words.pickNone)
    if (url && !/^https:\/\/\S+$/i.test(url)) return setProblem(words.linkInvalid)
    if (url && !number) return setProblem(words.linkNeedsNumber)
    setProblem(null)
    onShip({ warehouseId, courierName: courierFields ? courier.trim() || null : null, trackingNumber: courierFields ? number || null : null, trackingUrl: courierFields ? url || null : null })
  }

  const note = kind === 'pickup' ? words.notePickup : kind === 'toStore' ? fill(words.noteToStore, { store }) : words.note
  const confirm = kind === 'pickup' ? words.confirmPickup : kind === 'toStore' ? words.confirmToStore : words.confirm
  const noLocation = warehouses !== null && warehouses.length === 0

  return (
    <section className="df-order-card df-order-form" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1}>
        {fill(plural(kind === 'toStore' ? words.titleToStore : words.title, count), { count: formatCount(count) })}
      </h2>
      <div className="df-order-form-grid">
        <label className="df-order-field">
          <span>{words.location}</span>
          <select value={warehouseId} disabled={!warehouses || noLocation} onChange={(event) => setWarehouseId(event.target.value)}>
            {(warehouses ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {courierFields && (
          <label className="df-order-field">
            <span>{words.courier}</span>
            <input value={courier} maxLength={80} placeholder={words.courierPlaceholder} onChange={(event) => setCourier(event.target.value)} />
          </label>
        )}
      </div>
      {courierFields && (
        <div className="df-order-form-grid">
          <label className="df-order-field">
            <span>
              {words.tracking} <small>{words.trackingHint}</small>
            </span>
            <input className="df-order-mono" value={tracking} maxLength={80} placeholder={words.trackingPlaceholder} onChange={(event) => setTracking(event.target.value)} />
          </label>
          <label className="df-order-field">
            <span>
              {words.link} <small>{words.linkHint}</small>
            </span>
            <input type="url" value={link} placeholder={words.linkPlaceholder} onChange={(event) => setLink(event.target.value)} />
          </label>
        </div>
      )}
      <p className="df-order-sub">{noLocation ? words.noLocation : note}</p>
      {(problem ?? error) && (
        <p className="df-order-problem" role="alert">
          {problem ?? error}
        </p>
      )}
      <div className="df-order-form-actions">
        <button type="button" className="df-button" onClick={onCancel}>
          {words.cancel}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={busy || !warehouseId} aria-busy={busy || undefined} onClick={submit}>
          {confirm}
        </button>
      </div>
    </section>
  )
}
