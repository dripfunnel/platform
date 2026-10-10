import { useEffect, useId, useRef, useState } from 'react'
import { returnReasons, type Order, type ReturnReason } from '../../api/order'
import { fill, formatCount, messages } from '../../messages'
import { freeToReturn, lineName } from './orderDetail'
import { Stepper } from './Stepper'

const words = messages.orders.detail.returns

export interface ReturnPanelProps {
  order: Order
  busy: boolean
  error: string | null
  onCancel: () => void
  onStart: (lines: { lineId: string; quantity: number }[], reason: ReturnReason) => void
}

/** "Start a return" (PortalOrders): the shipped units coming back, and why. */
export const ReturnPanel = ({ order, busy, error, onCancel, onStart }: ReturnPanelProps) => {
  const id = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [picks, setPicks] = useState<Readonly<Record<string, number>>>({})
  const [reason, setReason] = useState<ReturnReason>('doesnt_fit')
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => headingRef.current?.focus(), [])

  const lines = order.parts.flatMap((part) => part.lines.map((line) => ({ line, part, max: freeToReturn(order, line) }))).filter((l) => l.max > 0)
  const suppliers = lines.some((l) => l.part.supplierId !== null)
  const start = () => {
    const picked = lines.map(({ line }) => ({ lineId: line.id, quantity: picks[line.id] ?? 0 })).filter((l) => l.quantity > 0)
    if (picked.length === 0) return setProblem(words.start.pickNone)
    setProblem(null)
    onStart(picked, reason)
  }

  return (
    <section className="df-order-card df-order-form" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1}>
        {words.start.title}
      </h2>
      {lines.map(({ line, part, max }) => {
        const name = lineName(line)
        const shipped = formatCount(max)
        return (
          <div key={line.id} className="df-order-pick-row">
            <span className="df-order-line-name">
              <span>{name}</span>
              <span className="df-order-sub">{part.supplierName ? fill(words.start.supplierShipped, { supplier: part.supplierName, count: shipped }) : fill(words.start.shipped, { count: shipped })}</span>
            </span>
            <Stepper name={name} value={picks[line.id] ?? 0} max={max} onChange={(value) => setPicks((current) => ({ ...current, [line.id]: value }))} />
          </div>
        )
      })}
      <label className="df-form-field">
        <span>{words.start.reason}</span>
        <select value={reason} onChange={(event) => setReason(returnReasons.find((r) => r === event.target.value) ?? 'doesnt_fit')}>
          {returnReasons.map((r) => (
            <option key={r} value={r}>
              {words.reasons[r]}
            </option>
          ))}
        </select>
      </label>
      <p className="df-order-sub">{suppliers ? words.start.noteSuppliers : words.start.note}</p>
      {(problem ?? error) && (
        <p className="df-form-problem" role="alert">
          {problem ?? error}
        </p>
      )}
      <div className="df-form-actions">
        <button type="button" className="df-button" onClick={onCancel}>
          {words.start.cancel}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={busy} aria-busy={busy || undefined} onClick={start}>
          {words.start.confirm}
        </button>
      </div>
    </section>
  )
}
