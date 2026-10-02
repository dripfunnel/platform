import { DashboardCard } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { DashboardData } from '../../api/dashboard'
import { fill, formatCount, formatTime, formatWait, messages } from '../../messages'

const words = messages.dashboard.awaiting

// FIRST-RELEASE.md §3 links this card to Approvals, which is (proposed); until §13 settles it,
// the Partners list filtered to awaiting approval is the list it counts (decided on #18).
export const AwaitingCard = ({ awaiting }: { awaiting: DashboardData['awaiting'] }) => (
  <DashboardCard
    title={words.title}
    aside={
      <Link to="/partners" search={{ status: 'awaiting' }} className="df-card-link">
        {fill(words.count, { count: formatCount(awaiting.count) })}
      </Link>
    }
  >
    {awaiting.oldest ? (
      <div className="df-awaiting">
        <p className="df-eyebrow">{words.longest}</p>
        <Link to="/partners/$partnerId" params={{ partnerId: awaiting.oldest.id }} className="df-awaiting-name">
          {awaiting.oldest.name}
        </Link>
        <p className="df-figure">{formatWait(awaiting.oldest.waitingSeconds)}</p>
        <p className="df-muted">{fill(words.submitted, { time: formatTime(awaiting.oldest.submittedAt) })}</p>
      </div>
    ) : (
      <p className="df-muted">{words.none}</p>
    )}
  </DashboardCard>
)
