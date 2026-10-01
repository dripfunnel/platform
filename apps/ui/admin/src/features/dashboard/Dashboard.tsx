// States (?state=): loading, empty, error, stale, offline. Without one the screen shows the API's
// numbers, and is empty when the platform has no partner yet: the first thing staff ever see.
import { Link } from '@tanstack/react-router'
import type { DashboardData } from '../../api/dashboard'
import { fill, formatTime, messages } from '../../messages'
import { EmptyState, PermissionDenied } from '@dripfunnel/shared/ui'
import { StaleNotice } from '../common/StaleNotice'
import { AttentionCard } from './AttentionCard'
import { AwaitingCard } from './AwaitingCard'
import './dashboard.css'
import { DashboardError } from './DashboardError'
import { DashboardHeader } from './DashboardHeader'
import { DashboardLoading } from './DashboardLoading'
import type { DashboardState } from './dashboardStates'
import { PartnerFilter } from './PartnerFilter'
import { PartnersCard } from './PartnersCard'
import { SignupsCard } from './SignupsCard'
import { StoresCard } from './StoresCard'

const words = messages.dashboard
const harnessError = messages.states.error

export interface DashboardProps {
  data: DashboardData
  forced: DashboardState | null
  canCreatePartner: boolean
  onPartnerChange: (partnerId: string | undefined) => void
  onReload: () => void
}

const noticeFor = (data: DashboardData, forced: DashboardState | null) => {
  if (forced === 'offline') return words.offline
  if (forced === 'stale' || data.staleSince !== null) {
    return { title: fill(words.stale.title, { time: formatTime(data.staleSince ?? data.asOf) }), body: words.stale.body }
  }
  return null
}

export const Dashboard = ({ data, forced, canCreatePartner, onPartnerChange, onReload }: DashboardProps) => {
  if (forced === 'loading') return <DashboardLoading />

  const sub = fill(words.sub, { time: formatTime(data.asOf) })

  if (forced === 'error') {
    return (
      <DashboardError
        sub={sub}
        onRetry={onReload}
        details={{
          label: harnessError.detailsLabel,
          codeLabel: harnessError.codeLabel,
          code: harnessError.code,
          requestIdLabel: harnessError.requestIdLabel,
          requestId: harnessError.requestId,
        }}
      />
    )
  }

  if (forced === 'empty' || data.partnerOptions.length === 0) {
    return (
      <div className="df-page df-dashboard">
        <DashboardHeader sub={sub} />
        <EmptyState
          title={words.empty.title}
          body={words.empty.body}
          action={
            canCreatePartner ? (
              <Link to="/partners" className="df-button df-button--primary">
                {words.empty.action}
              </Link>
            ) : (
              <PermissionDenied actionLabel={words.empty.action} reason={words.empty.denied} />
            )
          }
        />
      </div>
    )
  }

  const notice = noticeFor(data, forced)
  const scope = data.partnerId ? { partner: data.partnerId } : {}

  return (
    <div className="df-page df-dashboard">
      {notice && <StaleNotice title={notice.title} body={notice.body} refreshLabel={words.refresh} onRefresh={onReload} />}
      <DashboardHeader sub={sub} />
      <PartnerFilter options={data.partnerOptions} value={data.partnerId} onChange={onPartnerChange} />
      <div className="df-dashboard-grid">
        <PartnersCard partners={data.partners} />
        <AwaitingCard awaiting={data.awaiting} />
        <StoresCard stores={data.stores} scope={scope} />
        <AttentionCard attention={data.attention} scope={scope} />
        <SignupsCard signups={data.signups} scope={scope} />
      </div>
    </div>
  )
}
