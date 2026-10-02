// States (?state=): loading, empty, error, stale, offline. Without one the screen shows the API's
// numbers for the range in the URL; a brand-new Live partner sees zeros and the words that say so.
import { dashboardNotice, EmptyState, ErrorState, StaleNotice, type DashboardState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/cards.css'
import { Link } from '@tanstack/react-router'
import { freshDashboard, type DashboardData, type DashboardRange } from '../../api/dashboard'
import type { Me } from '../../api/me'
import { fill, formatTime, messages } from '../../messages'
import { AttentionCard } from './AttentionCard'
import './dashboard.css'
import { DashboardLoading } from './DashboardLoading'
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

export const Dashboard = ({ me, data: loaded, forced, onRangeChange, onReload }: DashboardProps) => {
  // ?state=empty shows the brand-new partner exactly as the API would describe one.
  const data = forced === 'empty' ? freshDashboard(loaded.range) : loaded
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
  const fresh = data.fresh
  const notice = dashboardNotice(data, forced, words, fill, formatTime)
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
        <SignupsCard signups={data.signups} range={data.range} fresh={fresh} />
        <AttentionCard attention={data.attention} />
        <UsageCard usage={data.usage} />
        <TopStoresCard top={data.top} />
      </div>
    </div>
  )
}
