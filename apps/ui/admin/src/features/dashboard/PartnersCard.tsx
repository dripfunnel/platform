import type { StatusIconName } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { partnerStates, type DashboardData, type PartnerState } from '../../api/dashboard'
import { formatCount, messages } from '../../messages'
import { StatusPill, type StatusTone } from '../common/StatusPill'
import { DashboardCard } from './DashboardCard'

const words = messages.dashboard

const look: Record<PartnerState, { tone: StatusTone; icon: StatusIconName }> = {
  live: { tone: 'success', icon: 'ok' },
  awaiting: { tone: 'info', icon: 'hour' },
  draft: { tone: 'neutral', icon: 'pen' },
  paused: { tone: 'warning', icon: 'pause' },
}

export const PartnersCard = ({ partners }: { partners: DashboardData['partners'] }) => (
  <DashboardCard
    title={words.partners.title}
    aside={
      <Link to="/partners" className="df-card-link">
        {words.partners.all}
      </Link>
    }
  >
    <ul className="df-tiles df-tiles--two">
      {partnerStates.map((state) => (
        <li key={state}>
          <Link to="/partners" search={{ status: state }} className="df-tile">
            <span className="df-tile-number">{formatCount(partners[state])}</span>
            <StatusPill tone={look[state].tone} icon={look[state].icon} label={words.partnerStates[state]} />
          </Link>
        </li>
      ))}
    </ul>
  </DashboardCard>
)
