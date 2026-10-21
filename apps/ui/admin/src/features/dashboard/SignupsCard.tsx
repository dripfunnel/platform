import { DashboardCard } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { DashboardData } from '../../api/dashboard'
import { formatCount, formatWait, messages } from '../../messages'

const words = messages.dashboard.signups

export interface SignupsCardProps {
  signups: DashboardData['signups']
  scope: { partner?: string }
}

// FIRST-RELEASE.md §3 links these to Provisioning, which is (proposed); the Stores list
// filtered by signup date and setup state counts the same stores (decided on #18).
export const SignupsCard = ({ signups, scope }: SignupsCardProps) => {
  const tiles = [
    { key: 'started', label: words.started, count: signups.started, search: { ...scope, created: '7d' } },
    { key: 'completed', label: words.completed, count: signups.completed, search: { ...scope, created: '7d', setup: 'done' } },
    { key: 'failed', label: words.failed, count: signups.failed, search: { ...scope, created: '7d', setup: 'failed' } },
  ] as const
  return (
    <DashboardCard title={words.title} aside={<span className="df-muted">{words.period}</span>}>
      <ul className="df-tiles df-tiles--three">
        {tiles.map((tile) => (
          <li key={tile.key}>
            <Link to="/stores" search={tile.search} className="df-tile df-tile--small">
              <span className="df-tile-number">{formatCount(tile.count)}</span>
              <span className="df-muted">{tile.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="df-median">
        <span className="df-muted">{words.median}</span>
        <strong>{signups.medianSecondsToReady === null ? words.noMedian : formatWait(signups.medianSecondsToReady)}</strong>
      </p>
    </DashboardCard>
  )
}
