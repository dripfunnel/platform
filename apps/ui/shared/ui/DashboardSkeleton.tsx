import './cards.css'
import './states.css'

// The cards' outline while the numbers load, so the page doesn't jump; `cards` says which are wide.
export const DashboardSkeleton = ({ cards }: { cards: readonly boolean[] }) => (
  <div className="df-dashboard-grid">
    {cards.map((wide, card) => (
      <div key={card} className={wide ? 'df-card df-card--wide' : 'df-card'}>
        <div className="df-skeleton df-skeleton--short" />
        <div className="df-skeleton df-skeleton--figure" />
        <div className="df-skeleton" />
        <div className="df-skeleton df-skeleton--short" />
      </div>
    ))}
  </div>
)
