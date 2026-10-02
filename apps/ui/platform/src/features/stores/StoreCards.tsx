import { Link } from '@tanstack/react-router'
import type { StoreRow } from '../../api/stores'
import { messages } from '../../messages'
import { StatusSub, StoreStatusPill } from './storeLook'

// On a phone the prototype draws cards: name and status, plan · domain, the status line (§6.1).
export const StoreCards = ({ stores }: { stores: readonly StoreRow[] }) => (
  <ul className="df-store-cards" aria-label={messages.stores.tableLabel}>
    {stores.map((store) => (
      <li key={store.id}>
        <Link to="/stores" search={{ store: store.id }} className="df-store-card">
          <span className="df-store-card-head">
            <strong>{store.name}</strong>
            <StoreStatusPill state={store.state} />
          </span>
          <span className="df-muted">
            {store.plan.name} · {store.domain.host}
          </span>
          <StatusSub state={store.state} />
        </Link>
      </li>
    ))}
  </ul>
)
