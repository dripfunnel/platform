import { Link } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { setCustomerGroups, setCustomerNote, setCustomerTags, type Customer, type CustomerGroup } from '../../api/customers'
import { harnessSearch } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { merchantStatus, timeText } from '../orders/orderView'
import { addressText, consentOf, defaultAddress, spentText, type CustomersAccess } from './customerView'
import { EditCustomer } from './EditCustomer'

const words = messages.customers.detail

export interface CustomerDetailProps {
  customer: Customer
  groups: readonly CustomerGroup[]
  access: CustomersAccess
  timeZone: string
  busy: boolean
  /** Runs a change and says so; false when the API refused it, whose words it shows. */
  act: (work: () => Promise<void>, done: string) => Promise<boolean>
  onTag: () => void
  onStopMarketing: () => void
  /** The harness's sample, whose order links open the sample order. */
  sample: boolean
}

/** One customer (PortalOrders › Customers): contact, groups, tags, the team's note, marketing consent and their orders. */
export const CustomerDetail = ({ customer, groups, access, timeZone, busy, act, onTag, onStopMarketing, sample }: CustomerDetailProps) => {
  const noteId = useId()
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(customer.note ?? '')
  useEffect(() => setNote(customer.note ?? ''), [customer.id, customer.note])
  const name = customer.name ?? messages.customers.row.noName
  const address = defaultAddress(customer)
  const consent = consentOf(customer, timeZone)
  const spent = spentText(customer.spent)
  const ro = !access.canEdit

  const toggleGroup = (group: CustomerGroup) => {
    const on = customer.groupIds.includes(group.id)
    const next = on ? customer.groupIds.filter((id) => id !== group.id) : [...customer.groupIds, group.id]
    void act(() => setCustomerGroups(customer.id, next), fill(on ? words.leftGroup : words.addedTo, { name, group: group.name }))
  }
  const removeTag = (tag: string) =>
    void act(async () => void (await setCustomerTags(customer.id, customer.tags.filter((t) => t !== tag))), fill(words.tagRemoved, { tag }))
  const saveNote = () => void act(() => setCustomerNote(customer.id, note.trim() || null), words.noteSaved)

  if (editing) return <EditCustomer customer={customer} busy={busy} act={act} onDone={() => setEditing(false)} />

  return (
    <section className="df-customer" aria-label={name}>
      <div className="df-customer-head">
        <h2>{name}</h2>
        {access.canEdit && (
          <button type="button" className="df-button df-customer-small" onClick={() => setEditing(true)}>
            {words.edit}
          </button>
        )}
      </div>
      <p className="df-customer-text2">
        {fill(words.contact, { email: customer.email ?? words.noEmail, phone: customer.phone ?? words.noPhone })}
        <br />
        {address ? addressText(address) : words.noAddress}
      </p>
      <div className="df-customer-facts">
        <span className="df-customer-fact">{fill(plural(words.orders, customer.ordersCount), { count: formatCount(customer.ordersCount) })}</span>
        {access.money && spent && <span className="df-customer-fact df-customer-fact--money">{fill(words.spent, { amount: spent })}</span>}
      </div>

      <div className="df-customer-block">
        <span className="df-customer-label">{words.groups}</span>
        {groups.length === 0 ? (
          <span className="df-customer-sub">{words.noGroups}</span>
        ) : (
          <div className="df-customer-chips">
            {groups.map((g) => {
              const on = customer.groupIds.includes(g.id)
              return (
                <button key={g.id} type="button" className="df-customer-group" aria-pressed={on} disabled={ro || busy} onClick={() => toggleGroup(g)}>
                  {fill(on ? words.groupOn : words.groupOff, { name: g.name })}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="df-customer-block">
        <span className="df-customer-label">{words.tags}</span>
        <div className="df-customer-chips">
          {customer.tags.map((tag) => (
            <span key={tag} className="df-customer-tag">
              {tag}
              {access.canEdit && (
                <button type="button" aria-label={fill(words.removeTag, { tag })} disabled={busy} onClick={() => removeTag(tag)}>
                  ×
                </button>
              )}
            </span>
          ))}
          {access.canEdit && (
            <button type="button" className="df-link-button" disabled={busy || customer.tags.length >= 20} onClick={onTag}>
              {words.addTag}
            </button>
          )}
        </div>
      </div>

      <div className="df-customer-block">
        <label className="df-customer-label" htmlFor={noteId}>
          {words.note} <span className="df-customer-sub">{words.noteHint}</span>
        </label>
        <textarea id={noteId} rows={2} value={note} maxLength={2000} readOnly={ro} placeholder={words.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
        {access.canEdit && note !== (customer.note ?? '') && (
          <button type="button" className="df-button df-button--primary df-customer-small df-customer-save" disabled={busy} onClick={saveNote}>
            {words.saveNote}
          </button>
        )}
      </div>

      <div className="df-customer-consent">
        <strong>{words.consent.title}</strong>
        <span className={consent.yes ? 'df-customer-consent-yes' : undefined}>{consent.text}</span>
        <span className="df-customer-sub">{consent.sub}</span>
        {consent.yes && access.canEdit && (
          <button type="button" className="df-link-button" disabled={busy} onClick={onStopMarketing}>
            {words.consent.stop}
          </button>
        )}
      </div>

      {customer.orders.length > 0 && (
        <ul className="df-customer-orders" aria-label={words.ordersLabel}>
          {customer.orders.map((o) => {
            const status = merchantStatus(o.state, o.paymentState, o.fulfilmentState)
            return (
              <li key={o.id}>
                <Link to="/orders/$orderId" params={{ orderId: o.id }} search={(prev) => harnessSearch(prev, sample ? 'toShip' : undefined)}>
                  <span className="df-customer-order-number">{o.number}</span>
                  <span className="df-customer-sub">{fill(words.order, { date: timeText(o.placedAt, timeZone), status: messages.orders.status[status] })}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {customer.ordersCount > customer.orders.length && <p className="df-customer-sub">{fill(words.moreOrders, { count: formatCount(customer.orders.length), total: formatCount(customer.ordersCount) })}</p>}
    </section>
  )
}
