import { messages } from '../../messages'
import { LoadingState } from '../common/LoadingState'
import { DashboardHeader } from './DashboardHeader'
import './dashboard.css'

const words = messages.dashboard

const cardShapes = [false, false, false, true, false]

// The five cards' outline, so the page doesn't jump when the numbers arrive.
const shape = (
  <div className="df-dashboard-grid">
    {cardShapes.map((wide, card) => (
      <div key={card} className={wide ? 'df-card df-card--wide' : 'df-card'}>
        <div className="df-skeleton df-skeleton--short" />
        <div className="df-skeleton df-skeleton--figure" />
        <div className="df-skeleton" />
        <div className="df-skeleton df-skeleton--short" />
      </div>
    ))}
  </div>
)

export const DashboardLoading = () => (
  <div className="df-page df-dashboard">
    <DashboardHeader sub={words.subLoading} />
    <LoadingState label={words.loading} shape={shape} />
  </div>
)
