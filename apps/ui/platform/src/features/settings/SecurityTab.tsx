import { firstName, SessionControls, sessionControls, type PortalStaffSession } from '@dripfunnel/shared/ui'
import { useId } from 'react'
import type { TeamMember } from '../../api/settings'
import { fill, formatList, messages } from '../../messages'

const words = messages.settings.security
const items = sessionControls.map((control) => ({ control, label: messages.controls[control] }))

export interface SecurityTabProps {
  required: boolean
  team: readonly TeamMember[]
  // False while more of the team is still to load, so the list never claims to be everyone.
  complete: boolean
  // An impersonation never changes how the team signs in (ACCESS.md §8.1); null when the switch is free.
  blocked: string | null
  isOwner: boolean
  busy: boolean
  session: PortalStaffSession | null
  onChange: (required: boolean) => void
}

// Security (§14.4): one switch, the Owner's; turning it off removes nobody's 2-factor. Below it,
// what a staff session can't change, turned off with the reason (#46).
export const SecurityTab = ({ required, team, complete, blocked, isOwner, busy, session, onChange }: SecurityTabProps) => {
  const id = useId()
  const reasonId = useId()
  // Active members only: an invited one sets 2-factor up at their first sign-in when it's required.
  const off = team.filter((member) => member.status === 'active' && !member.secondFactor).map((member) => member.name)
  const why = blocked ?? (isOwner ? null : words.ownerOnly)
  return (
    <div className="df-panels">
      <section className="df-panel df-panel--wide" aria-labelledby="settings-security">
        <h2 id="settings-security">{words.title}</h2>
        <label className="df-settings-switch" htmlFor={id}>
          <input id={id} type="checkbox" checked={required} disabled={why !== null || busy} aria-describedby={why ? reasonId : undefined} onChange={(event) => onChange(event.target.checked)} />
          {words.switch}
        </label>
        {why && (
          <span id={reasonId} className="df-muted">
            {why}
          </span>
        )}
        <p>{required ? words.on : words.off}</p>
        <p className="df-muted">{off.length > 0 ? fill(complete ? words.offFor : words.offForPartial, { names: formatList(off) }) : complete ? words.allOn : words.allOnPartial}</p>
        {required && <p className="df-muted">{words.turningOff}</p>}
      </section>
      <section className="df-panel df-panel--wide" aria-labelledby="settings-account">
        <h2 id="settings-account">{messages.settings.account}</h2>
        <p className="df-muted">{messages.settings.accountSub}</p>
        <SessionControls
          session={session}
          items={items}
          reason={(block, current) => fill(messages.blocked[block], { user: current.actingAs ? firstName(current.actingAs.name) : '', partner: current.partnerName })}
        />
      </section>
    </div>
  )
}
