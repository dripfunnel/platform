import { StatusPill, type StatusTone } from '@dripfunnel/shared/ui'
import type { StatusIconName } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import type { ImpersonationTarget, TargetStatus } from '../../api/impersonation'
import { fill, formatCount, formatDate, messages } from '../../messages'
import { ActionControl } from '../common/ActionControl'
import { membershipLine, refusalText } from './sessionText'
import '../common/list.css'
import './impersonate.css'

const words = messages.impersonate

export const targetStatusLook: Record<TargetStatus, { tone: StatusTone; icon: StatusIconName }> = {
  active: { tone: 'success', icon: 'ok' },
  invited: { tone: 'info', icon: 'hour' },
  suspended: { tone: 'danger', icon: 'ban' },
}

export interface TargetsTableProps {
  targets: readonly ImpersonationTarget[]
  onImpersonate: (target: ImpersonationTarget) => void
  onReturn: (sessionId: string) => void
}

// The first place shows; the rest open under "+N more" (FIRST-RELEASE.md §8).
const Places = ({ target }: { target: ImpersonationTarget }) => {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const [first, ...rest] = target.memberships
  return (
    <div className="df-imp-places">
      {first && <span>{membershipLine(first)}</span>}
      {rest.length > 0 && (
        <>
          {open && (
            <ul id={listId} className="df-imp-more">
              {rest.map((membership) => (
                <li key={membership.id}>{membershipLine(membership)}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="df-link-button"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? undefined : fill(words.users.moreLabel, { count: formatCount(rest.length), name: target.name })}
            onClick={() => setOpen((shown) => !shown)}
          >
            {open ? words.users.less : fill(words.users.more, { count: formatCount(rest.length) })}
          </button>
        </>
      )}
    </div>
  )
}

const Row = ({ target, onImpersonate, onReturn }: { target: ImpersonationTarget } & Omit<TargetsTableProps, 'targets'>) => {
  const partners = [...new Map(target.memberships.map((membership) => [membership.partner.id, membership.partner])).values()]
  const openSession = target.openSession
  return (
    <tr>
      <th scope="row">
        <div className="df-stack">
          <Link to="/activity" search={{ person: target.id }} className="df-row-title">
            {target.name}
          </Link>
          <span className="df-muted">{target.email}</span>
        </div>
      </th>
      <td className="df-nowrap">{words.kinds[target.kind]}</td>
      <td>
        <div className="df-stack">
          {partners.map((partner) => (
            <Link key={partner.id} to="/partners/$partnerId" params={{ partnerId: partner.id }} className="df-row-link">
              {partner.name}
            </Link>
          ))}
        </div>
      </td>
      <td>
        <Places target={target} />
      </td>
      <td className="df-muted df-nowrap">{target.lastSignInAt ? formatDate(target.lastSignInAt) : words.users.never}</td>
      <td>
        <StatusPill {...targetStatusLook[target.status]} label={words.statuses[target.status]} />
      </td>
      <td className="df-imp-action">
        {openSession ? (
          <button type="button" className="df-button" onClick={() => onReturn(openSession)}>
            {words.actions.return}
          </button>
        ) : (
          <ActionControl
            label={words.actions.impersonate}
            primary
            refusal={target.impersonate.allowed ? null : refusalText(target.impersonate.reason, target)}
            onRun={() => onImpersonate(target)}
          />
        )}
      </td>
    </tr>
  )
}

// Scrolls sideways inside itself on a narrow screen, and takes focus so a keyboard can scroll it.
export const TargetsTable = ({ targets, onImpersonate, onReturn }: TargetsTableProps) => (
  <div className="df-table-scroll" role="region" aria-label={words.users.tableLabel} tabIndex={0}>
    <table className="df-table df-imp-table">
      <thead>
        <tr>
          {Object.entries(words.users.columns).map(([key, label]) => (
            <th key={key} scope="col" className={key === 'action' ? 'df-imp-action' : undefined}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {targets.map((target) => (
          <Row key={target.id} target={target} onImpersonate={onImpersonate} onReturn={onReturn} />
        ))}
      </tbody>
    </table>
  </div>
)
