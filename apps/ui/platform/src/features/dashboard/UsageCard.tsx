import { DashboardCard } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { DashboardData } from '../../api/dashboard'
import { fill, formatCount, messages } from '../../messages'

const words = messages.dashboard.usage

// Stores at 80% or more of a plan limit; the bar is the API's percent, the words its counts.
export const UsageCard = ({ usage }: { usage: DashboardData['usage'] }) => (
  <DashboardCard
    title={words.title}
    aside={
      <Link to="/stores" search={{ near: 'yes' }} className="df-card-link">
        {fill(words.near, { count: formatCount(usage.nearCount) })}
      </Link>
    }
  >
    {usage.stores.length === 0 ? (
      <p className="df-muted">{words.none}</p>
    ) : (
      <ul className="df-usage">
        {usage.stores.map((store) => (
          <li key={store.storeId}>
            <Link to="/stores" search={{ store: store.storeId, tab: 'plan' }} className="df-usage-row">
              <span className="df-usage-text">
                <strong>{store.storeName}</strong>
                <span className="df-muted">{fill(words.of, { used: formatCount(store.used), limit: formatCount(store.limit), name: words.limits[store.limitKey] })}</span>
              </span>
              <span className="df-usage-bar" aria-hidden="true">
                <span className={store.percent >= 100 ? 'df-usage-bar-fill df-usage-bar-fill--full' : 'df-usage-bar-fill'} style={{ width: `${Math.min(100, store.percent)}%` }} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    )}
  </DashboardCard>
)
