import { formatMoney } from '@dripfunnel/shared/format'
import { Link } from '@tanstack/react-router'
import type { StoreRow } from '../../api/stores'
import { fill, formatDate, locale, messages } from '../../messages'
import { DomainNote, LiveLink, StatusSub, StorefrontPill, StoreStatusPill } from './storeLook'
import '../common/list.css'
import './stores.css'

const words = messages.stores

// The prototype's columns and cells, in its order. No Retry here: it lives in the store's
// header and its Provisioning tab (decided on #20).
const Row = ({ store }: { store: StoreRow }) => (
  <tr>
    <th scope="row">
      <div className="df-stack">
        <Link to="/stores/$storeId" params={{ storeId: store.id }} className="df-row-title">
          {store.name}
        </Link>
        <code className="df-muted">{store.code}</code>
      </div>
    </th>
    <td>
      <Link to="/partners/$partnerId" params={{ partnerId: store.partner.id }} className="df-row-link">
        {store.partner.name}
      </Link>
    </td>
    <td>
      <div className="df-stack">
        <span>{store.owner.name}</span>
        <span className="df-muted">{store.owner.email}</span>
      </div>
    </td>
    <td>
      <div className="df-stack">
        <strong>{store.plan.name}</strong>
        <span className="df-muted df-nowrap">{fill(words.perMonth, { price: formatMoney(store.plan.price, locale) })}</span>
      </div>
    </td>
    <td>
      <div className="df-stack">
        <StoreStatusPill state={store.state} />
        <StatusSub state={store.state} />
      </div>
    </td>
    <td>
      <StorefrontPill storefront={store.storefront} />
    </td>
    <td>
      <div className="df-stack">
        <LiveLink host={store.domain.host} />
        <DomainNote domain={store.domain} />
      </div>
    </td>
    <td className="df-muted df-nowrap">{formatDate(store.createdAt)}</td>
  </tr>
)

// Scrolls sideways inside itself on a narrow screen, and takes focus so a keyboard can
// scroll it (WCAG 2.1.1).
export const StoresTable = ({ stores }: { stores: readonly StoreRow[] }) => (
  <div className="df-table-scroll" role="region" aria-label={words.tableLabel} tabIndex={0}>
    <table className="df-table">
      <thead>
        <tr>
          {Object.values(words.columns).map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {stores.map((store) => (
          <Row key={store.id} store={store} />
        ))}
      </tbody>
    </table>
  </div>
)
