import type { ReactNode } from 'react'
import type { StatusIconName } from './Icon'
import type { StatusTone } from './StatusPill'
import './activity.css'

export type ActivityResult = 'success' | 'denied' | 'failed'

// LOGGING.md §4's three results, the same pill in both consoles; the word is the app's.
export const activityResultLook: Record<ActivityResult, { tone: StatusTone; icon: StatusIconName }> = {
  success: { tone: 'success', icon: 'ok' },
  denied: { tone: 'warning', icon: 'ban' },
  failed: { tone: 'danger', icon: 'alert' },
}

// One fact in an entry's details; a list of them sits in `<dl className="df-activity-facts">`.
export const ActivityFact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="df-activity-fact">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
)
