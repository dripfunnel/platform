import { StatusPill, type StatusTone } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { ChecklistItem, ItemStatus } from '../../api/onboarding'
import { partnerOnlyItems } from '../../api/onboarding'
import { fill, messages } from '../../messages'
import type { PartnerRole } from '../shell/partnerRoles'
import './onboarding.css'

const words = messages.onboarding

const statusLook: Record<ItemStatus, { tone: StatusTone; icon: 'ok' | 'hour' | 'alert' }> = {
  done: { tone: 'success', icon: 'ok' },
  progress: { tone: 'info', icon: 'hour' },
  missing: { tone: 'warning', icon: 'alert' },
}

export interface ChecklistProps {
  items: readonly ChecklistItem[]
  role: PartnerRole
  partner: string
  // True inside a DripFunnel setup session: the partner-only items are locked for staff.
  staffSetup: boolean
}

export const Checklist = ({ items, role, partner, staffSetup }: ChecklistProps) => (
  <ol className="df-checklist">
    {items.map((x, i) => {
      const own = partnerOnlyItems.includes(x.key)
      const locked = own && staffSetup && x.status === 'missing'
      const yours = own && !staffSetup && x.status === 'missing'
      const label = words.items[x.key].label
      const pill = locked
        ? { tone: 'neutral' as const, icon: 'shield' as const, label: fill(words.entersThis, { partner }) }
        : yours
          ? { tone: 'warning' as const, icon: 'alert' as const, label: role === 'partner-owner' ? words.yourTurn : words.ownerAdds }
          : { ...statusLook[x.status], label: words.status[x.status] }
      return (
        <li key={x.key} className={`df-checklist-row${yours && role === 'partner-owner' ? ' df-checklist-row--yours' : ''}`}>
          <span className="df-checklist-n" aria-hidden="true">
            {i + 1}
          </span>
          <div className="df-checklist-body">
            {locked ? <strong>{label}</strong> : <Link to={x.to}>{label}</Link>}
            <span className="df-checklist-detail">{locked ? fill(words.entersThisItself, { partner }) : (x.detail ?? words.items[x.key].hint)}</span>
            {x.doneBy && <span className={`df-checklist-by${x.doneBy === 'DripFunnel' ? ' df-checklist-by--staff' : ''}`}>{fill(words.doneBy, { who: x.doneBy })}</span>}
          </div>
          <StatusPill tone={pill.tone} icon={pill.icon} label={pill.label} />
        </li>
      )
    })}
  </ol>
)
