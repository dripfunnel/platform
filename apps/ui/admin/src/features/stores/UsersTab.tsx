import { StatusPill } from '@dripfunnel/shared/ui'
import type { SessionPermission } from '../../api/impersonation'
import type { Store, StoreUser } from '../../api/stores'
import { fill, formatTime, messages } from '../../messages'
import { InfoNote } from '../common/InfoNote'
import { ActionControl } from '../common/ActionControl'
import { refusalText } from '../impersonate/sessionText'
import './stores.css'

const words = messages.store.users

const roleOrder: Record<StoreUser['role'], number> = { owner: 0, manager: 1, staff: 2, supplierAdmin: 3, supplierMember: 4 }

// The store's own people first, then one group per supplier by name, as the prototype does.
const groupsOf = (store: Store) => {
  const groups = new Map<string, StoreUser[]>()
  for (const user of store.users) groups.set(user.supplier ?? '', [...(groups.get(user.supplier ?? '') ?? []), user])
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([supplier, users]) => ({
      supplier,
      title: supplier ? fill(words.supplierGroup, { supplier }) : fill(words.ownGroup, { name: store.name }),
      sub: supplier ? words.supplierGroupSub : words.ownGroupSub,
      users: users.sort((a, b) => roleOrder[a.role] - roleOrder[b.role]),
    }))
}

const statusLook = {
  active: { tone: 'success', icon: 'ok' },
  invited: { tone: 'info', icon: 'hour' },
  suspended: { tone: 'neutral', icon: 'ban' },
} as const

const ImpersonateControl = ({ permission, user, onRun }: { permission: SessionPermission | undefined; user: StoreUser; onRun: () => void }) =>
  permission ? <ActionControl label={words.impersonate} refusal={permission.allowed ? null : refusalText(permission.reason, user)} onRun={onRun} /> : null

export const UsersTab = ({ store, onImpersonate }: { store: Store; onImpersonate: (userId: string) => void }) => {
  const groups = groupsOf(store)
  return (
    <div className="df-panels">
      <div className="df-panel--wide">
        <InfoNote>{fill(words.intro, { name: store.name })}</InfoNote>
      </div>
      {groups.length === 0 && <p className="df-muted df-panel--wide">{words.none}</p>}
      {groups.map((group) => (
        <section key={group.supplier} className="df-panel df-panel--wide" aria-label={group.title}>
          <div className="df-panel-head">
            <h2>{group.title}</h2>
            <span className="df-muted">{group.sub}</span>
          </div>
          <ul className="df-people">
            {group.users.map((user) => (
              <li key={user.id}>
                <div className="df-stack">
                  <span className="df-row-title">{user.name}</span>
                  <span className="df-muted">{user.email}</span>
                </div>
                <span>{user.supplier ? fill(words.supplierRole, { role: words.roles[user.role], supplier: user.supplier }) : words.roles[user.role]}</span>
                <StatusPill {...statusLook[user.status]} label={words.statuses[user.status]} />
                <span className="df-muted">
                  {user.lastSignInAt ? fill(words.lastSignIn, { time: formatTime(user.lastSignInAt) }) : words.neverSignedIn}
                </span>
                {store.impersonate[user.id] && (
                  <ImpersonateControl permission={store.impersonate[user.id]} user={user} onRun={() => onImpersonate(user.id)} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
