import { StatusPill, type StatusTone } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { ChecklistItem, ChecklistItemKey, ItemStatus } from '../../api/onboarding'
import { partnerOnlyItems } from '../../api/onboarding'
import { fill, messages } from '../../messages'
import type { PartnerRole } from '../shell/partnerRoles'
import './onboarding.css'

const words = messages.onboarding

// Where each item is finished (FIRST-RELEASE §4); Settings and Domains are placeholders until
// their cards land, which is honest: the placeholder says so.
const itemLinks: Record<Exclude<ChecklistItemKey, 'testSignup'>, '/settings' | '/branding' | '/domains' | '/plans'> = {
  company: '/settings',
  branding: '/branding',
  portalHost: '/domains',
  wildcards: '/domains',
  emailSender: '/domains',
  plan: '/plans',
  legal: '/branding',
  paymentMethod: '/settings',
  payoutDetails: '/settings',
}

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
  // `cannot` is the role's standing refusal (the button is disabled); `error` is a failed run (it stays enabled).
  testSignup: { run: () => void; busy: boolean; cannot: string | null; error: string | null; done: string | null }
}

export const Checklist = ({ items, role, partner, staffSetup, testSignup }: ChecklistProps) => (
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
            {x.key === 'testSignup' || locked ? <strong>{label}</strong> : <Link to={itemLinks[x.key]}>{label}</Link>}
            <span className="df-checklist-detail">{locked ? fill(words.entersThisItself, { partner }) : x.detail}</span>
            {x.doneBy && <span className={`df-checklist-by${x.doneBy === 'DripFunnel' ? ' df-checklist-by--staff' : ''}`}>{fill(words.doneBy, { who: x.doneBy })}</span>}
            {x.key === 'testSignup' && x.status !== 'done' && (
              <div className="df-checklist-action">
                <button type="button" className="df-button" onClick={testSignup.run} disabled={testSignup.busy || testSignup.cannot !== null} aria-describedby={(testSignup.cannot ?? testSignup.error) ? 'test-signup-why' : undefined}>
                  {words.runTest}
                </button>
                {(testSignup.cannot ?? testSignup.error) && (
                  <span id="test-signup-why" className="df-checklist-why" role={testSignup.error ? 'alert' : undefined}>
                    {testSignup.cannot ?? testSignup.error}
                  </span>
                )}
              </div>
            )}
            {x.key === 'testSignup' && testSignup.done && (
              <span role="status" className="df-checklist-why">
                {testSignup.done}
              </span>
            )}
          </div>
          <StatusPill tone={pill.tone} icon={pill.icon} label={pill.label} />
        </li>
      )
    })}
  </ol>
)
