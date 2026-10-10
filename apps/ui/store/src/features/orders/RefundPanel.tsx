import { minorOf } from '@dripfunnel/shared/format'
import { useEffect, useId, useRef, useState } from 'react'
import { refundReasons, type Order, type OrderReturn, type RefundInput, type RefundReason } from '../../api/order'
import { fill, messages } from '../../messages'
import { freeToReturn, leftInReturn, lineName, methodText, paidByHand } from './orderDetail'
import { moneyText, type OrdersAccess } from './orderView'
import { Stepper } from './Stepper'

const words = messages.orders.detail.refund

export type RefundRequest = Omit<RefundInput, 'orderId'> & { suppliers: string[] }

export interface RefundPanelProps {
  order: Order
  access: OrdersAccess
  /** The received return being refunded, or null for a refund on its own. */
  from: OrderReturn | null
  busy: boolean
  error: string | null
  onCancel: () => void
  onRefund: (request: RefundRequest) => void
}

/**
 * "Refund" (PortalOrders): the picked units, grouped by who refunds them, each at what the shopper paid for it, or an
 * amount on its own for goodwill. The API works out every figure and refuses what isn't the caller's (FIRST-RELEASE §6).
 */
export const RefundPanel = ({ order, access, from, busy, error, onCancel, onRefund }: RefundPanelProps) => {
  const id = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const groups = order.parts
    .map((part) => ({ part, lines: part.lines.map((line) => ({ line, max: from ? leftInReturn(order, from, line.id) : freeToReturn(order, line) })).filter((l) => l.max > 0) }))
    .filter((g) => g.lines.length > 0)
  const [picks, setPicks] = useState<Readonly<Record<string, number>>>(() => (from ? Object.fromEntries(groups.flatMap((g) => g.lines.map((l) => [l.line.id, l.max]))) : {}))
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState<RefundReason>(from ? 'returned' : 'goodwill')
  const [restock, setRestock] = useState(from !== null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => headingRef.current?.focus(), [])

  const picked = groups.flatMap((g) => g.lines.map((l) => ({ part: g.part, lineId: l.line.id, quantity: picks[l.line.id] ?? 0 }))).filter((l) => l.quantity > 0)
  const currency = order.total?.currency ?? null
  const left = order.total ? BigInt(order.total.amount) - BigInt(order.refunded?.amount ?? '0') : null
  const maxText = currency && left !== null ? moneyText({ amount: String(left), currency }) : ''
  // An amount on its own is the store's goodwill (`extra`); picked items go back at what the shopper paid for them.
  const typed = access.supplier || picked.length > 0 || !currency ? null : minorOf(amount, currency)
  const overridden = access.supplier ? [] : [...new Set(picked.filter((l) => l.part.supplierId !== null).map((l) => l.part.supplierName ?? ''))]

  const submit = () => {
    if (typed === 'invalid') return setProblem(words.amountInvalid)
    if (picked.length === 0 && (typed === null || typed === 0)) return setProblem(words.pickNone)
    if (typeof typed === 'number' && left !== null && BigInt(typed) > left) return setProblem(fill(words.amountTooMuch, { max: maxText }))
    setProblem(null)
    onRefund({
      returnId: from?.id ?? null,
      lines: picked.map(({ lineId, quantity }) => ({ lineId, quantity })),
      extra: typeof typed === 'number' ? String(typed) : null,
      reason,
      restock: restock && picked.length > 0,
      override: overridden.length > 0,
      suppliers: overridden,
    })
  }

  const note = access.supplier ? words.noteSupplier : fill(paidByHand(order.paymentMethod) ? words.noteByHand : words.note, { method: methodText(order.paymentMethod) })
  const confirm = typeof typed === 'number' && typed > 0 && currency ? fill(words.confirmAmount, { amount: moneyText({ amount: String(typed), currency }) }) : words.confirmPicked

  return (
    <section className="df-order-card df-order-form df-order-form--refund" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1}>
        {words.title}
      </h2>
      {groups.map(({ part, lines }) => {
        const theirs = !access.supplier && part.supplierId !== null
        const supplier = part.supplierName ?? ''
        return (
          <div key={part.id} className="df-order-refund-group" role="group" aria-label={theirs ? fill(words.theirs, { supplier }) : words.mine}>
            <div className="df-order-refund-head">
              <strong>{theirs ? fill(words.theirs, { supplier }) : words.mine}</strong>
              <span className={theirs ? 'df-order-refund-who df-order-refund-who--theirs' : 'df-order-refund-who'}>{theirs ? fill(words.theyRefund, { supplier }) : words.youRefund}</span>
            </div>
            {lines.map(({ line, max }) => {
              const name = lineName(line)
              return (
                <div key={line.id} className="df-order-pick-row">
                  <span>
                    {name}
                    {access.money && <span className="df-order-sub"> {fill(words.each, { price: moneyText(line.unitPrice) })}</span>}
                  </span>
                  <Stepper
                    name={name}
                    value={picks[line.id] ?? 0}
                    max={max}
                    onChange={(value) => {
                      setPicks((current) => ({ ...current, [line.id]: value }))
                      setAmount('')
                    }}
                  />
                </div>
              )
            })}
            {theirs && overridden.includes(supplier) && <p className="df-order-override">{fill(words.override, { supplier })}</p>}
          </div>
        )
      })}
      <div className="df-order-form-grid">
        {!access.supplier && currency && (
          <label className="df-order-field">
            <span>{maxText ? fill(words.amount, { max: maxText }) : words.amountLabel}</span>
            <input inputMode="decimal" value={amount} disabled={picked.length > 0} placeholder={picked.length > 0 ? words.amountPicked : ''} onChange={(event) => setAmount(event.target.value)} />
          </label>
        )}
        <label className="df-order-field">
          <span>{words.reason}</span>
          <select value={reason} onChange={(event) => setReason(refundReasons.find((r) => r === event.target.value) ?? 'other')}>
            {refundReasons.map((r) => (
              <option key={r} value={r}>
                {words.reasons[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="df-order-check">
        <input type="checkbox" checked={restock && picked.length > 0} disabled={picked.length === 0} onChange={(event) => setRestock(event.target.checked)} />
        {words.restock}
      </label>
      <p className="df-order-sub">{note}</p>
      {(problem ?? error) && (
        <p className="df-order-problem" role="alert">
          {problem ?? error}
        </p>
      )}
      <div className="df-order-form-actions">
        <button type="button" className="df-button" onClick={onCancel}>
          {words.cancel}
        </button>
        <button type="button" className="df-button df-order-refund-confirm" disabled={busy} aria-busy={busy || undefined} onClick={submit}>
          {confirm}
        </button>
      </div>
    </section>
  )
}
