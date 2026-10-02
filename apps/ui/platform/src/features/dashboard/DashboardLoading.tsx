import { LoadingState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/cards.css'
import { fill, messages } from '../../messages'
import './dashboard.css'

const words = messages.dashboard

// The six cards' outline, so the page doesn't jump when the numbers arrive.
const shape = (
  <div className="df-dashboard-grid">
    {[false, false, true, false, false, false].map((wide, card) => (
      <div key={card} className={wide ? 'df-card df-card--wide' : 'df-card'}>
        <div className="df-skeleton df-skeleton--short" />
        <div className="df-skeleton df-skeleton--figure" />
        <div className="df-skeleton" />
        <div className="df-skeleton df-skeleton--short" />
      </div>
    ))}
  </div>
)

export const DashboardLoading = ({ product }: { product: string }) => (
  <div className="df-page df-dashboard">
    <h1 className="df-page-title">{words.title}</h1>
    <p className="df-page-lede">{fill(words.lede, { product })}</p>
    <LoadingState label={words.loading} shape={shape} />
  </div>
)
