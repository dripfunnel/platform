import { Link } from '@tanstack/react-router'
import type { Store } from '../../api/stores'
import { fill, messages } from '../../messages'
import { ActionControl } from '@dripfunnel/shared/ui'
import { refusalText } from './refusal'
import type { DialogAction } from './storeDialog'
import { StatusSub, StoreStatusPill } from './storeLook'
import '../common/phone.css'
import './stores.css'

const words = messages.phone.store

// One action at most (the prototype at Phone · 375): Restore for a suspended store, none once it
// is cancelled or closed, Suspend otherwise; and only when the API offers it.
export const phoneAction = (store: Store): 'suspend' | 'restore' | null => {
  const action = store.state.kind === 'suspended' ? 'restore' : store.state.kind === 'cancelled' || store.state.kind === 'closed' ? null : 'suspend'
  return action && store.actions[action] ? action : null
}

const setupText = ({ setup }: Store): string =>
  setup.state === 'done' || setup.step === null
    ? messages.store.provisioning.stepStatus.done
    : fill(words.setupAt, { state: messages.store.provisioning.stepStatus[setup.state], step: messages.provisioning.steps[setup.step] })

const domainText = ({ domain }: Store): string =>
  domain.status === 'live' ? domain.host : fill(words.domainState, { host: domain.host, status: messages.store.domains.status[domain.status] })

export interface PhoneStoreProps {
  store: Store
  onAction: (action: DialogAction) => void
}

export const PhoneStore = ({ store, onAction }: PhoneStoreProps) => {
  const action = phoneAction(store)
  const permission = action && store.actions[action]
  const rows: [string, string][] = [
    [words.rows.storefront, messages.stores.storefronts[store.storefront]],
    [words.rows.domain, domainText(store)],
    [words.rows.setup, setupText(store)],
    [words.rows.plan, store.plan.name ?? messages.stores.noPlan],
    [words.rows.owner, store.owner.name ?? messages.stores.noOwner],
  ]
  return (
    <div className="df-phone">
      <Link to="/stores" className="df-phone-back">
        <span aria-hidden="true">‹ </span>
        {words.back}
      </Link>
      <p className="df-eyebrow">{fill(words.level, { partner: store.partner.name })}</p>
      <h1 className="df-phone-title">{store.name}</h1>
      <div className="df-phone-card df-phone-status-card">
        <StoreStatusPill state={store.state} />
        <StatusSub state={store.state} />
      </div>
      <dl className="df-phone-card df-phone-facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {action && permission && (
        <div className="df-phone-action">
          <ActionControl label={words.actions[action]} refusal={refusalText(permission, action)} danger={action === 'suspend'} onRun={() => onAction(action)} />
        </div>
      )}
      <p className="df-phone-note">{words.elsewhere}</p>
    </div>
  )
}
