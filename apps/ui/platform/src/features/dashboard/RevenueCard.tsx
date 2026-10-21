import { DashboardCard } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { DashboardData } from '../../api/dashboard'
import { fill, formatAmount, formatDate, messages } from '../../messages'

const words = messages.dashboard.revenue

// Merchant payments, DripFunnel's fee and the payout, kept apart and labelled (FIRST-RELEASE §1, §5).
export const RevenueCard = ({ revenue, fresh, partner, rangeLabel }: { revenue: DashboardData['revenue']; fresh: boolean; partner: string; rangeLabel: string }) => (
  <DashboardCard title={words.title} aside={<span className="df-muted">{rangeLabel}</span>}>
    <Link to="/billing" className="df-revenue-row">
      <span>{words.collected}</span>
      <strong>{formatAmount(revenue.collected)}</strong>
    </Link>
    <div className="df-revenue-row df-muted">
      <span>{words.fee}</span>
      <span>−{formatAmount(revenue.fee)}</span>
    </div>
    <Link to="/billing" search={{ tab: 'payouts' }} className="df-revenue-row df-revenue-row--payout">
      <span>{words.payout}</span>
      <strong>{formatAmount(revenue.payout)}</strong>
    </Link>
    <p className="df-muted">{fresh ? words.fresh : fill(words.comparison, { comparison: revenue.comparison, date: formatDate(revenue.nextPayoutAt) })}</p>
    <p className="df-muted df-revenue-note">{fill(words.note, { partner })}</p>
  </DashboardCard>
)
