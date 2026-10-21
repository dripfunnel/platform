import { InfoNote } from '@dripfunnel/shared/ui'
import type { Store } from '../../../api/stores'
import { fill, formatAmount, formatCount, formatCountry, formatDate, messages } from '../../../messages'
import { roleOf } from '../../common/storeRoles'
import { chargedByOf, planNameOf } from '../storeLook'

const words = messages.store.overview

// The prototype's Overview (§6.3): the account-level sentence, Account, Contacts, Plan and status history.
export const OverviewTab = ({ store }: { store: Store }) => {
  const facts: readonly [string, string][] = [
    [words.owner, `${store.owner.name} · ${store.owner.email}`],
    [words.country, formatCountry(store.country)],
    [words.created, formatDate(store.createdAt)],
    [words.plan, store.planPrice ? fill(words.planLine, { plan: planNameOf(store.plan), price: formatAmount(store.planPrice), who: chargedByOf(store.billing.mode, store.billing.partnerName) }) : planNameOf(store.plan)],
    [words.people, fill(words.peopleLine, { count: formatCount(store.people.count), suppliers: formatCount(store.people.suppliers) })],
    [words.sales, store.salesLastMonth && store.ordersLastMonth !== null ? fill(words.salesLine, { sales: formatAmount(store.salesLastMonth), orders: formatCount(store.ordersLastMonth) }) : words.noSales],
  ]
  return (
    <div className="df-panels">
      <InfoNote>{words.note}</InfoNote>
      <section className="df-panel" aria-labelledby="store-account">
        <h2 id="store-account">{words.account}</h2>
        <dl className="df-facts">
          {facts.flatMap(([label, value]) => [<dt key={`${label}-label`}>{label}</dt>, <dd key={label}>{value}</dd>])}
        </dl>
      </section>
      <div className="df-panel-stack">
        <section className="df-panel" aria-labelledby="store-contacts">
          <h2 id="store-contacts">{words.contacts}</h2>
          {store.contacts.length <= 1 && <p className="df-muted">{words.onlyOwner}</p>}
          <ul className="df-rows">
            {store.contacts.map((contact) => (
              <li key={contact.email}>
                <strong>{contact.name}</strong>
                <span className="df-muted">{contact.email}</span>
                <span>{roleOf(contact.role)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="df-panel" aria-labelledby="store-history">
          <h2 id="store-history">{words.history}</h2>
          <ol className="df-timeline">
            {store.history.map((entry) => (
              <li key={`${entry.at}-${entry.text}`}>
                <time dateTime={entry.at} className="df-muted">
                  {formatDate(entry.at)}
                </time>
                <span className="df-stack">
                  <span>{entry.text}</span>
                  <span className="df-muted">{entry.by}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
