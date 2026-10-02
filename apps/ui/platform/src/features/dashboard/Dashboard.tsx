// States (?state=): loading, empty, error, stale, offline. Without one the screen shows the API's
// numbers for the range in the URL; a brand-new Live partner sees zeros and the words that say so.
import { EmptyState, ErrorState, StaleNotice } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/cards.css'
import { Link } from '@tanstack/react-router'
import type { DashboardData, DashboardRange } from '../../api/dashboard'
import type { Me } from '../../api/me'
import { fill, formatTime, messages } from '../../messages'
import { AttentionCard } from './AttentionCard'
import './dashboard.css'
import { DashboardLoading } from './DashboardLoading'
import type { DashboardState } from './dashboardStates'
import { RangeControl } from './RangeControl'
import { RevenueCard } from './RevenueCard'
import { SignupsCard } from './SignupsCard'
import { StoresCard } from './StoresCard'
import { TopStoresCard } from './TopStoresCard'
import { UsageCard } from './UsageCard'

const words = messages.dashboard
const sample = messages.states.error

export interface DashboardProps {
  me: Me
  data: DashboardData
  forced: DashboardState | null
  onRangeChange: (range: DashboardRange) => void
  onReload: () => void
}

export const Dashboard = ({ me, data, forced, onRangeChange, onReload }: DashboardProps) => {
  if (forced === 'loading') return <DashboardLoading product={me.partner.product} />
  const lede = fill(words.lede, { product: me.partner.product })
  if (forced === 'error') {
    return (
      <div className="df-page df-dashboard">
        <h1 className="df-page-title">{words.title}</h1>
        <p className="df-page-lede">{lede}</p>
        <ErrorState
          title={words.error.title}
          body={words.error.body}
          details={{ label: sample.detailsLabel, codeLabel: sample.codeLabel, code: sample.code, requestIdLabel: sample.requestIdLabel, requestId: sample.requestId }}
          retry={{ label: words.error.retry, onRetry: onReload }}
        />
      </div>
    )
  }
  const fresh = forced === 'empty' || data.fresh
  const notice =
    forced === 'offline'
      ? words.offline
      : forced === 'stale' || data.staleSince !== null
        ? { title: fill(words.stale.title, { time: formatTime(data.staleSince ?? data.asOf) }), body: words.stale.body }
        : null
  return (
    <div className="df-page df-dashboard">
      {notice && <StaleNotice title={notice.title} body={notice.body} refreshLabel={words.refresh} onRefresh={onReload} />}
      <h1 className="df-page-title">{words.title}</h1>
      <p className="df-page-lede">{lede}</p>
      <RangeControl value={data.range} onChange={onRangeChange} />
      {fresh && (
        <EmptyState
          title={words.empty.title}
          body={fill(words.empty.body, { host: me.partner.host })}
          action={
            <Link to="/stores" className="df-button df-button--primary">
              {words.empty.action}
            </Link>
          }
        />
      )}
      <div className="df-dashboard-grid">
        <StoresCard stores={data.stores} />
        <RevenueCard revenue={data.revenue} fresh={fresh} partner={me.partner.name.split(' ')[0] ?? me.partner.name} rangeLabel={words.range[data.range]} />
        <AttentionCard attention={fresh ? [] : data.attention} />
        <SignupsCard signups={data.signups} range={data.range} fresh={fresh} />
        <UsageCard usage={fresh ? { nearCount: 0, stores: [] } : data.usage} />
        <TopStoresCard top={fresh ? [] : data.top} />
      </div>
    </div>
  )
}
