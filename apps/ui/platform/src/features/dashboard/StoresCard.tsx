import { DashboardCard, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { DashboardData, StoreStatusKey } from '../../api/dashboard'
import { fill, formatCount, messages } from '../../messages'

const words = messages.dashboard.stores

const look: Record<StoreStatusKey, { tone: StatusTone; icon: StatusIconName }> = {
  active: { tone: 'success', icon: 'ok' },
  trial: { tone: 'info', icon: 'hour' },
  pastdue: { tone: 'warning', icon: 'alert' },
  suspended: { tone: 'solid', icon: 'ban' },
}

export const StoresCard = ({ stores }: { stores: DashboardData['stores'] }) => (
  <DashboardCard
    title={words.title}
    aside={
      <Link to="/stores" className="df-card-link">
        {fill(words.total, { count: formatCount(stores.total) })}
      </Link>
    }
  >
    <ul className="df-tiles df-tiles--two">
      {(Object.keys(look) as StoreStatusKey[]).map((status) => (
        <li key={status}>
          <Link to="/stores" search={{ status }} className="df-tile" aria-label={fill(words.statusLabel, { count: formatCount(stores.byStatus[status]), status: words.status[status] })}>
            <span className="df-tile-number">{formatCount(stores.byStatus[status])}</span>
            <StatusPill tone={look[status].tone} icon={look[status].icon} label={words.status[status]} />
          </Link>
        </li>
      ))}
    </ul>
    <p className="df-muted">
      <Link to="/stores" search={{ created: 'month' }} className="df-strong-link">
        {formatCount(stores.newThisMonth)}
      </Link>{' '}
      {words.newThisMonth}
    </p>
  </DashboardCard>
)
