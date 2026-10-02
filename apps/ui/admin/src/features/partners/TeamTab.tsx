import { StatusPill } from '@dripfunnel/shared/ui'
import type { SessionPermission } from '../../api/impersonation'
import type { Partner, PartnerAction, PartnerUser } from '../../api/partners'
import { fill, formatDate, formatTime, messages } from '../../messages'
import { ActionControl } from '../common/ActionControl'
import { refusalText as sessionRefusal } from '../impersonate/sessionText'
import { refusalText } from './refusal'
import { InvitationPill } from './partnerLook'
import './partners.css'

const words = messages.partner

export interface TeamTabProps {
  partner: Partner
  onAction: (action: PartnerAction) => void
  onImpersonate: (userId: string) => void
}

const invitationDetail = (partner: Partner) => {
  const { owner } = partner
  if (owner.invitation === 'active') return fill(words.team.invitationDetail.active, { name: owner.name ?? owner.email })
  if (owner.invitation === 'sent') {
    return fill(words.team.invitationDetail.sent, { date: owner.invitationSentAt ? formatDate(owner.invitationSentAt) : '', email: owner.email })
  }
  return fill(words.team.invitationDetail.held, { org: partner.name })
}

// The API's answer for this person; none means it sent none, so nothing is offered.
const ImpersonateControl = ({ permission, person, onRun }: { permission: SessionPermission | undefined; person: PartnerUser; onRun: () => void }) =>
  permission ? (
    <ActionControl label={words.team.impersonate} refusal={permission.allowed ? null : sessionRefusal(permission.reason, person)} onRun={onRun} />
  ) : null

export const TeamTab = ({ partner, onAction, onImpersonate }: TeamTabProps) => {
  const inviteAction = partner.actions.sendInvite ? 'sendInvite' : partner.actions.resendInvite ? 'resendInvite' : null
  const invitePermission = inviteAction ? partner.actions[inviteAction] : undefined
  return (
    <div className="df-panels">
      <section className="df-panel df-panel--wide" aria-labelledby="owner-invitation">
        <h2 id="owner-invitation">{words.team.invitationTitle}</h2>
        <p className="df-muted">{words.team.invitationSub}</p>
        <div className="df-invitation">
          <div className="df-stack">
            <span>{partner.owner.name ?? messages.partners.notJoined}</span>
            <span className="df-muted">{partner.owner.email}</span>
          </div>
          <InvitationPill status={partner.owner.invitation} />
        </div>
        <p>{invitationDetail(partner)}</p>
        {inviteAction && invitePermission && (
          <ActionControl
            refusal={refusalText(invitePermission, inviteAction, partner.name)}
            label={words.actions[inviteAction]}
            primary={inviteAction === 'sendInvite'}
            onRun={() => onAction(inviteAction)}
          />
        )}
      </section>
      <section className="df-panel df-panel--wide" aria-labelledby="partner-people">
        <h2 id="partner-people">{fill(words.team.peopleTitle, { name: partner.name })}</h2>
        <p className="df-muted">{words.team.peopleSub}</p>
        {partner.team.length === 0 ? (
          <p className="df-muted">{partner.house ? words.team.houseTeam : words.team.nobody}</p>
        ) : (
          <ul className="df-people">
            {partner.team.map((person) => (
              <li key={person.id}>
                <div className="df-stack">
                  <span className="df-row-title">{person.name}</span>
                  <span className="df-muted">
                    {person.email} · {words.team.roles[person.role]}
                  </span>
                  <span className="df-muted">
                    {person.lastSignInAt ? fill(words.team.lastSignIn, { time: formatTime(person.lastSignInAt) }) : words.team.neverSignedIn}
                  </span>
                </div>
                <StatusPill
                  tone={person.status === 'active' ? 'success' : 'info'}
                  icon={person.status === 'active' ? 'ok' : 'hour'}
                  label={words.team.statuses[person.status]}
                />
                <ImpersonateControl permission={partner.impersonate[person.id]} person={person} onRun={() => onImpersonate(person.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
