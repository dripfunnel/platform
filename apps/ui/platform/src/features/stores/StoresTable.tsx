import { ClickableRow } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { BillingStatus, StoreRow } from '../../api/stores'
import { fill, formatAmount, formatCount, formatDate, messages } from '../../messages'
import { BillingStatusSelect } from './BillingStatusSelect'
import { DomainLink, DomainNote, StatusSub, StoreStatusPill, StorefrontPill } from './storeLook'

const words = messages.stores

// Under the plan when the API says a limit is at 80% or more ("84% of products", §6.1).
export const NearNote = ({ near }: { near: StoreRow['near'] }) =>
  near && <span className="df-near">{fill(words.near, { percent: formatCount(near.percent), limit: words.limits[near.limit] })}</span>

export const Sales = ({ money }: { money: StoreRow['salesLastMonth'] }) =>
  money ? (
    <span className="df-sales">
      <strong>{formatAmount(money)}</strong> <span className="df-muted">{money.currency}</span>
    </span>
  ) : (
    <span className="df-muted">{words.noSales}</span>
  )

export interface BillingColumn {
  allowed: boolean
  onChange: (store: StoreRow, status: BillingStatus) => void
}

// The prototype's columns, in its order; Billing status only when the partner bills its merchants (§6.1).
const Row = ({ store, billing }: { store: StoreRow; billing: BillingColumn | null }) => (
  <ClickableRow>
    <th scope="row">
      <div className="df-stack">
        <Link to="/stores/$storeId" params={{ storeId: store.id }} className="df-row-title">
          {store.name}
        </Link>
        <code className="df-muted">{store.code}</code>
      </div>
    </th>
    <td>
      <div className="df-stack">
        <span>{store.owner.name}</span>
        <span className="df-muted">{store.owner.email}</span>
      </div>
    </td>
    <td>
      <div className="df-stack">
        <span>{store.plan.name}</span>
        <NearNote near={store.near} />
      </div>
    </td>
    <td>
      <div className="df-stack">
        <StoreStatusPill state={store.state} />
        <StatusSub state={store.state} />
      </div>
    </td>
    <td className="df-number df-nowrap">
      <Sales money={store.salesLastMonth} />
    </td>
    <td>
      <StorefrontPill storefront={store.storefront} />
    </td>
    <td>
      <div className="df-stack">
        <DomainLink host={store.domain.host} />
        <DomainNote domain={store.domain} />
      </div>
    </td>
    <td className="df-muted df-nowrap">{formatDate(store.createdAt)}</td>
    {billing && (
      <td>
        <BillingStatusSelect store={store} allowed={billing.allowed} onChange={billing.onChange} />
      </td>
    )}
  </ClickableRow>
)

// Scrolls sideways inside itself, and takes focus so a keyboard can scroll it (WCAG 2.1.1).
export const StoresTable = ({ stores, billing }: { stores: readonly StoreRow[]; billing: BillingColumn | null }) => (
  <div className="df-table-scroll df-stores-table" role="region" aria-label={words.tableLabel} tabIndex={0}>
    <table className="df-table">
      <thead>
        <tr>
          {[...Object.values(words.columns), ...(billing ? [words.billingStatus.column] : [])].map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {stores.map((store) => (
          <Row key={store.id} store={store} billing={billing} />
        ))}
      </tbody>
    </table>
  </div>
)
