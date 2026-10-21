import { SearchField, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { SupportTarget } from '../../api/support'
import { fill, formatTime, messages } from '../../messages'
import { ShowMore, type More } from '../common/paged'
import type { SearchState } from './supportHarness'
import { firstOf, refusalText, roleText } from './supportText'

const words = messages.support

const statusLook: Record<SupportTarget['status'], { tone: StatusTone; icon: StatusIconName }> = {
  active: { tone: 'success', icon: 'ok' },
  invited: { tone: 'info', icon: 'hour' },
  suspended: { tone: 'solid', icon: 'ban' },
}

export interface UsersTabProps {
  users: readonly SupportTarget[]
  state: SearchState
  search: string | undefined
  partner: string
  me: string
  more: More
  onSearch: (search: string | undefined) => void
  onMore: () => void
  onOpen: (target: SupportTarget) => void
}

// §12.1: the rules first, then every merchant user the partner may sign in as, each with why not.
export const UsersTab = ({ users, state, search, partner, me, more, onSearch, onOpen, onMore }: UsersTabProps) => (
  <div className="df-panels">
    <section className="df-panel df-panel--wide" aria-label={words.rulesLabel}>
      <ul className="df-support-rules">
        {words.rules.map((rule) => (
          <li key={rule.title}>
            <strong>{rule.title}</strong>
            <span>{fill(rule.body, { partner: firstOf(partner), me: firstOf(me) })}</span>
          </li>
        ))}
      </ul>
    </section>
    <section className="df-panel df-panel--wide" aria-label={words.usersLabel}>
      <SearchField label={words.find} placeholder={words.findHint} value={search} onChange={onSearch} labelVisible />
      {state === 'searching' ? (
        <p className="df-muted" role="status">
          {words.searching}
        </p>
      ) : state === 'failed' ? (
        <p role="alert">{words.searchFailed}</p>
      ) : users.length === 0 ? (
        <p className="df-muted">{search ? words.noMatch : words.noUsers}</p>
      ) : (
        <table className="df-support-users">
          <caption className="df-visually-hidden">{words.usersLabel}</caption>
          <thead>
            <tr>
              <th scope="col">{words.columns.user}</th>
              <th scope="col">{words.columns.type}</th>
              <th scope="col">{words.columns.store}</th>
              <th scope="col">{words.columns.lastSignIn}</th>
              <th scope="col">{words.columns.status}</th>
              <th scope="col">{words.columns.action}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const whyId = `support-why-${user.membershipId}`
              const refused = !user.mySessionId && !user.start.allowed ? refusalText(user.start.reason, user) : null
              return (
                <tr key={user.membershipId}>
                  <td data-label={words.columns.user}>
                    <strong>{user.name}</strong>
                    <span className="df-support-sub">{user.email}</span>
                  </td>
                  <td data-label={words.columns.type}>{words.types[user.type]}</td>
                  <td data-label={words.columns.store}>
                    <Link to="/stores/$storeId" params={{ storeId: user.store.id }}>
                      {user.store.name}
                    </Link>
                    <span className="df-support-sub">{roleText(user)}</span>
                  </td>
                  <td data-label={words.columns.lastSignIn}>{user.lastSignInAt ? formatTime(user.lastSignInAt) : words.never}</td>
                  <td data-label={words.columns.status}>
                    <StatusPill {...statusLook[user.status]} label={words.statuses[user.status]} />
                  </td>
                  <td data-label={words.columns.action}>
                    <span className="df-support-action">
                      <button
                        type="button"
                        className={user.mySessionId ? 'df-button df-button--small' : 'df-button df-button--small df-button--primary'}
                        aria-describedby={refused ? whyId : undefined}
                        disabled={refused !== null}
                        onClick={() => onOpen(user)}
                      >
                        {user.mySessionId ? words.returnTo : words.open}
                      </button>
                      {refused && (
                        <span id={whyId} className="df-support-why">
                          {refused}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <ShowMore more={more} onMore={onMore} label={words.showMore} failed={words.moreFailed} />
    </section>
  </div>
)
