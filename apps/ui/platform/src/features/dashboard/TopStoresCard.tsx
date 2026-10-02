import { DashboardCard } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { DashboardData } from '../../api/dashboard'
import { formatAmount, formatCount, messages } from '../../messages'

const words = messages.dashboard.top

// Totals only, in each store's currency (USERS-AND-DOMAINS §4): never an order, customer or product.
export const TopStoresCard = ({ top }: { top: DashboardData['top'] }) => (
  <DashboardCard
    title={words.title}
    aside={
      <Link to="/reports" search={{ tab: 'stores' }} className="df-card-link">
        {words.report}
      </Link>
    }
  >
    <p className="df-muted">{words.sub}</p>
    {top.length === 0 ? (
      <p className="df-muted">{words.none}</p>
    ) : (
      <ol className="df-top">
        {top.map((store, i) => (
          <li key={store.storeId}>
            <Link to="/stores" search={{ store: store.storeId }} className="df-top-row">
              <span className="df-top-n" aria-hidden="true">
                {formatCount(i + 1)}
              </span>
              <span className="df-top-name">
                <strong>{store.storeName}</strong>
                <span className="df-muted">{store.plan}</span>
              </span>
              <strong>{formatAmount(store.sales)}</strong>
            </Link>
          </li>
        ))}
      </ol>
    )}
  </DashboardCard>
)
