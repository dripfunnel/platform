import { useId } from 'react'
import type { StaffAction, StaffMember } from '../../api/staff'
import { fill, formatDate, formatTime, messages } from '../../messages'
import { StatusPill } from '../common/StatusPill'
import { labelOf, refusalText } from './staffDialog'
import '../common/list.css'
import './staff.css'

const words = messages.staff
const roleNames = messages.shell.roles

const twoFactorLook = {
  on: { tone: 'success', icon: 'ok' },
  off: { tone: 'warning', icon: 'alert' },
  notSignedIn: { tone: 'neutral', icon: 'clock' },
} as const

const actionOrder: readonly StaffAction[] = ['changeRole', 'remove', 'resend', 'revoke']

const LastSignIn = ({ member }: { member: StaffMember }) => {
  const invitation = member.invitation
  if (!invitation) return <>{member.lastSignInAt ? formatTime(member.lastSignInAt) : words.never}</>
  return (
    <div className="df-stack">
      <StatusPill
        tone={invitation.expired ? 'danger' : 'info'}
        icon={invitation.expired ? 'cross' : 'hour'}
        label={invitation.expired ? words.invitation.expiredPill : words.invitation.pendingPill}
      />
      <span className="df-muted">
        {invitation.expired
          ? fill(words.invitation.expired, { expires: formatDate(invitation.expiresAt) })
          : fill(words.invitation.pending, { sent: formatDate(invitation.sentAt), expires: formatDate(invitation.expiresAt) })}
      </span>
    </div>
  )
}

export interface StaffTableProps {
  staff: readonly StaffMember[]
  meId: string
  onAction: (action: StaffAction, member: StaffMember) => void
}

// One refusal per row: every control it disables points at the same visible reason (ui/README.md §5).
const Actions = ({ member, onAction }: { member: StaffMember; onAction: StaffTableProps['onAction'] }) => {
  const reasonId = useId()
  const name = labelOf(member)
  const offered = actionOrder.flatMap((action) => {
    const permission = member.actions[action]
    return permission ? [{ action, permission }] : []
  })
  const refusal = offered.find((item) => !item.permission.allowed)?.permission
  return (
    <div className="df-staff-actions">
      <div role="group" aria-label={fill(words.actions.label, { name })} className="df-staff-buttons">
        {offered.map(({ action, permission }) => (
          <button
            key={action}
            type="button"
            className="df-button"
            disabled={!permission.allowed}
            aria-describedby={permission.allowed ? undefined : reasonId}
            onClick={() => onAction(action, member)}
          >
            {words.actions[action]}
          </button>
        ))}
      </div>
      {refusal && !refusal.allowed && (
        <p id={reasonId} className="df-staff-reason">
          {refusalText(refusal.reason, name)}
        </p>
      )}
    </div>
  )
}

// The §10 columns in the prototype's order, the email under the name.
export const StaffTable = ({ staff, meId, onAction }: StaffTableProps) => (
  <div className="df-table-scroll" role="region" aria-label={words.tableLabel} tabIndex={0}>
    <table className="df-table df-staff-table">
      <thead>
        <tr>
          {Object.values(words.columns).map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {staff.map((member) => (
          <tr key={member.id}>
            <th scope="row">
              <div className="df-stack">
                <span className="df-staff-name">
                  <strong>{labelOf(member)}</strong>
                  {member.id === meId && <span className="df-staff-you">{words.you}</span>}
                </span>
                {member.name && <span className="df-muted">{member.email}</span>}
              </div>
            </th>
            <td className="df-nowrap">{roleNames[member.role]}</td>
            <td className="df-nowrap">
              <LastSignIn member={member} />
            </td>
            <td>
              <StatusPill {...twoFactorLook[member.twoFactor]} label={words.twoFactor[member.twoFactor]} />
            </td>
            <td>
              <Actions member={member} onAction={onAction} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)
