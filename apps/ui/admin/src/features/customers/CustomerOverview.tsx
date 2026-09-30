import { Link } from '@tanstack/react-router'
import type { Customer } from '../../api/customers'
import { fill, formatCount, formatDate, formatTime, messages, plural } from '../../messages'
import { StatusPill } from '../common/StatusPill'
import '../common/list.css'
import './customers.css'

const words = messages.customer
const overview = words.overview

// Whether a contact is verified, beside it; nothing to say about one the account doesn't have.
const Verified = ({ has, verified }: { has: boolean; verified: boolean }) =>
  has ? (
    <StatusPill tone={verified ? 'success' : 'warning'} icon={verified ? 'ok' : 'clock'} label={verified ? overview.verified : overview.notVerified} />
  ) : null

// The §5.4 detail. Email and phone are shown as the API sent them: in full only for the roles
// it trusts with them, masked for everyone else. A deleted customer has nothing personal left.
// The notes take the prototype's palettes: a deletion is neutral, a suspended store is danger,
// because its customers can't sign in.
export const CustomerOverview = ({ customer }: { customer: Customer }) => {
  const deleted = customer.status === 'deleted'
  const none = messages.customers.none
  const rows = [
    [overview.email, deleted ? none : (customer.email ?? overview.none), !deleted && <Verified has={customer.email !== null} verified={customer.emailVerified} />],
    [overview.phone, deleted ? none : (customer.phone ?? overview.none), !deleted && <Verified has={customer.phone !== null} verified={customer.phoneVerified} />],
    [
      overview.signsInWith,
      customer.signsInWith ? fill(overview.signsInWithValue, { method: messages.customers.signInMethods[customer.signsInWith] }) : none,
      null,
    ],
    [overview.created, formatDate(customer.createdAt), null],
    [overview.lastSignIn, customer.lastSignInAt ? formatTime(customer.lastSignInAt) : none, null],
    [overview.orders, fill(plural(overview.orderCount, customer.orders), { count: formatCount(customer.orders) }), null],
  ] as const
  return (
    <div className="df-customer-overview">
      {customer.deletedAt && <p className="df-customer-note df-customer-note--neutral">{fill(words.deleted, { date: formatDate(customer.deletedAt) })}</p>}
      {customer.storeSuspension && (
        <p className="df-customer-note df-customer-note--danger">
          {fill(words.suspended, { store: customer.store.name, reason: customer.storeSuspension.reason })}{' '}
          <Link to="/stores/$storeId" params={{ storeId: customer.store.id }}>
            {words.openStore}
          </Link>
        </p>
      )}
      <section className="df-panel" aria-labelledby="customer-overview">
        <div className="df-panel-head">
          <h2 id="customer-overview">{overview.title}</h2>
          {customer.contactsMasked && <span className="df-muted">{overview.masked}</span>}
        </div>
        <dl className="df-facts">
          {rows.flatMap(([label, value, badge]) => [
            <dt key={`${label}-label`}>{label}</dt>,
            <dd key={label}>
              {value}
              {badge}
            </dd>,
          ])}
        </dl>
        <p className="df-muted">{overview.never}</p>
      </section>
    </div>
  )
}
