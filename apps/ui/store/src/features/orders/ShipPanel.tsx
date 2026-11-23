import { useEffect, useId, useRef, useState } from 'react'
import type { BookableCourier } from '../../api/order'
import type { Warehouse } from '../../api/stock'
import { RadioCards } from '../common/RadioCards'
import { fill, formatCount, messages, plural } from '../../messages'

const words = messages.orders.detail.ship
const own = 'own'

export type ShipKind = 'courier' | 'pickup' | 'toStore'

export interface ShipForm {
  warehouseId: string
  /** The courier to book a label with; null when the tracking is entered by hand. */
  book: string | null
  courierName: string | null
  trackingNumber: string | null
  trackingUrl: string | null
}

export interface ShipPanelProps {
  kind: ShipKind
  count: number
  warehouses: readonly Warehouse[] | null
  /** The connected couriers a label can be booked with; empty where only tracking by hand applies. */
  couriers: readonly BookableCourier[]
  courierName: (provider: string) => string
  store: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onShip: (form: ShipForm) => void
}

/** "Ship N items" (PortalOrders): from which location, a label booked with a connected courier or the tracking by hand, and the button that ships them. */
export const ShipPanel = ({ kind, count, warehouses, couriers, courierName, store, busy, error, onCancel, onShip }: ShipPanelProps) => {
  const id = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [courier, setCourier] = useState('')
  const [tracking, setTracking] = useState('')
  const [link, setLink] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [mode, setMode] = useState<string>(couriers[0]?.provider ?? own)

  useEffect(() => headingRef.current?.focus(), [])
  useEffect(() => {
    if (warehouses && !warehouses.some((w) => w.id === warehouseId)) setWarehouseId(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '')
  }, [warehouses, warehouseId])

  const booked = kind === 'courier' ? couriers.find((c) => c.provider === mode) ?? null : null
  const courierFields = kind !== 'pickup' && !booked
  const submit = () => {
    const number = tracking.trim()
    const url = link.trim()
    if (count === 0) return setProblem(words.pickNone)
    if (url && !/^https:\/\/\S+$/i.test(url)) return setProblem(words.linkInvalid)
    if (url && !number) return setProblem(words.linkNeedsNumber)
    setProblem(null)
    onShip({ warehouseId, book: booked?.provider ?? null, courierName: courierFields ? courier.trim() || null : null, trackingNumber: courierFields ? number || null : null, trackingUrl: courierFields ? url || null : null })
  }

  const bookNote = booked && fill(booked.pickupMode === 'scheduled' ? words.noteBookScheduled : words.noteBookOnRequest, { courier: courierName(booked.provider) })
  const note = kind === 'pickup' ? words.notePickup : kind === 'toStore' ? fill(words.noteToStore, { store }) : (bookNote ?? words.note)
  const confirm = kind === 'pickup' ? words.confirmPickup : kind === 'toStore' ? words.confirmToStore : booked ? words.confirmBook : words.confirm
  const ways = [...couriers.map((c) => ({ value: c.provider, label: fill(words.bookWith, { courier: courierName(c.provider) }) })), { value: own, label: words.own }]
  const noLocation = warehouses !== null && warehouses.length === 0

  return (
    <section className="df-order-card df-order-form" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1}>
        {fill(plural(kind === 'toStore' ? words.titleToStore : words.title, count), { count: formatCount(count) })}
      </h2>
      {kind === 'courier' && couriers.length > 0 && (
        <>
          <span id={`${id}-how`} className="df-order-sub">
            {words.how}
          </span>
          <RadioCards labelledBy={`${id}-how`} options={ways} value={mode} disabled={busy} onChange={setMode} />
        </>
      )}
      <div className="df-form-grid">
        <label className="df-form-field">
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
          <label className="df-form-field">
            <span>{words.courier}</span>
            <input value={courier} maxLength={80} placeholder={words.courierPlaceholder} onChange={(event) => setCourier(event.target.value)} />
          </label>
        )}
      </div>
      {courierFields && (
        <div className="df-form-grid">
          <label className="df-form-field">
            <span>
              {words.tracking} <small>{words.trackingHint}</small>
            </span>
            <input className="df-form-mono" value={tracking} maxLength={80} placeholder={words.trackingPlaceholder} onChange={(event) => setTracking(event.target.value)} />
          </label>
          <label className="df-form-field">
            <span>
              {words.link} <small>{words.linkHint}</small>
            </span>
            <input type="url" value={link} placeholder={words.linkPlaceholder} onChange={(event) => setLink(event.target.value)} />
          </label>
        </div>
      )}
      <p className="df-order-sub">{noLocation ? words.noLocation : note}</p>
      {(problem ?? error) && (
        <p className="df-form-problem" role="alert">
          {problem ?? error}
        </p>
      )}
      <div className="df-form-actions">
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
