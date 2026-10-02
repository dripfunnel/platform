import { DashboardCard } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { DashboardData } from '../../api/dashboard'
import { fill, formatCount, messages } from '../../messages'

const words = messages.dashboard.signups

export const SignupsCard = ({ signups, range, fresh }: { signups: DashboardData['signups']; range: DashboardData['range']; fresh: boolean }) => (
  <DashboardCard title={words.title} aside={<span className="df-muted">{range === 'month' ? words.thisWeek : messages.dashboard.range[range]}</span>}>
    <Link to="/stores" search={{ created: range === 'month' ? 'month' : '30d' }} className="df-tiles df-tiles--two df-signups">
      <span className="df-tile df-tile--small">
        <span className="df-tile-number">{formatCount(signups.started)}</span>
        <span className="df-muted">{words.started}</span>
      </span>
      <span className="df-tile df-tile--small">
        <span className="df-tile-number">{formatCount(signups.completed)}</span>
        <span className="df-muted">{words.completed}</span>
      </span>
    </Link>
    <p className="df-median">
      {fresh || signups.conversion === null ? (
        <span className="df-muted">{words.fresh}</span>
      ) : (
        <>
          <strong>{signups.conversion}</strong> <span className="df-muted">{fill(words.conversion, { comparison: signups.comparison })}</span>
        </>
      )}
    </p>
  </DashboardCard>
)
