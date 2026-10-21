import { DashboardCard } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { DashboardData } from '../../api/dashboard'
import { fill, formatCount, messages } from '../../messages'
import { UsageBar } from '../common/UsageBar'

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
            <Link to="/stores/$storeId" params={{ storeId: store.storeId }} search={{ tab: 'plan' }} className="df-usage-row">
              <span className="df-usage-text">
                <strong>{store.storeName}</strong>
                <span className="df-muted">{fill(words.of, { used: formatCount(store.used), limit: formatCount(store.limit), name: words.limits[store.limitKey] })}</span>
              </span>
              <UsageBar percent={store.percent} />
            </Link>
          </li>
        ))}
      </ul>
    )}
  </DashboardCard>
)
