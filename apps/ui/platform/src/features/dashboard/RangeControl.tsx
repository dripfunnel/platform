import type { DashboardRange } from '../../api/dashboard'
import { dashboardRanges } from '../../api/dashboard'
import { messages } from '../../messages'
import './dashboard.css'

const words = messages.dashboard

// The date range held in the URL (`?range=`), applied to every card.
export const RangeControl = ({ value, onChange }: { value: DashboardRange; onChange: (range: DashboardRange) => void }) => (
  <div role="group" aria-label={words.range.label} className="df-range">
    <span className="df-muted">{words.range.showing}</span>
    {dashboardRanges.map((range) => (
      <button key={range} type="button" className="df-range-option" aria-pressed={range === value} onClick={() => onChange(range)}>
        {words.range[range]}
      </button>
    ))}
  </div>
)
