import { StatusPill, type StatusTone, DashboardCard } from '@dripfunnel/shared/ui'
import type { StatusIconName } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { AttentionReason, AttentionStore, DashboardData } from '../../api/dashboard'
import { fill, formatCount, messages, plural } from '../../messages'

const words = messages.dashboard.attention

interface ReasonLook {
  tone: StatusTone
  icon: StatusIconName
  badge: string
  detail: string
}

const lookOf = (reason: AttentionReason): ReasonLook => {
  switch (reason.kind) {
    case 'pastDue':
      return {
        tone: 'warning',
        icon: 'clock',
        badge: fill(plural(words.pastDueBadge, reason.daysPastDue), { days: formatCount(reason.daysPastDue) }),
        detail: words.pastDueDetail,
      }
    case 'suspended':
      return { tone: 'solid', icon: 'ban', badge: words.suspendedBadge, detail: reason.reason }
    case 'setup':
      return {
        tone: reason.state === 'failed' ? 'danger' : 'warning',
        icon: reason.state === 'failed' ? 'alert' : 'clock',
        badge: reason.state === 'failed' ? words.setupFailedBadge : words.setupStuckBadge,
        detail: fill(words.setupDetail, { step: messages.provisioning.steps[reason.step], attempt: formatCount(reason.attempt) }),
      }
  }
}

const AttentionRow = ({ store }: { store: AttentionStore }) => {
  const look = lookOf(store.reason)
  return (
    <li className="df-attention-row">
      <div className="df-attention-name">
        <Link to="/stores/$storeId" params={{ storeId: store.id }} className="df-row-title">
          {store.name}
        </Link>
        <span className="df-muted">
          {store.partnerName} · {look.detail}
        </span>
      </div>
      <StatusPill tone={look.tone} icon={look.icon} label={look.badge} />
      {store.reason.kind !== 'setup' && (
        <Link
          to="/stores/$storeId"
          params={{ storeId: store.id }}
          className="df-button df-button--small"
          aria-label={fill(words.openStoreLabel, { name: store.name })}
        >
          {words.openStore}
        </Link>
      )}
    </li>
  )
}

export interface AttentionCardProps {
  attention: DashboardData['attention']
  scope: { partner?: string }
}

export const AttentionCard = ({ attention, scope }: AttentionCardProps) => {
  const categories = [
    { key: 'pastDue', label: words.pastDue, count: attention.pastDue, search: { ...scope, status: 'pastdue' } },
    { key: 'suspended', label: words.suspended, count: attention.suspended, search: { ...scope, status: 'suspended' } },
    { key: 'setupFailed', label: words.setupFailed, count: attention.setupFailed, search: { ...scope, setup: 'failed' } },
    { key: 'setupStuck', label: words.setupStuck, count: attention.setupStuck, search: { ...scope, setup: 'stuck' } },
  ] as const
  return (
    <DashboardCard
      title={words.title}
      wide
      aside={
        <ul className="df-categories">
          {categories.map((category) => (
            <li key={category.key}>
              <Link to="/stores" search={category.search} className="df-card-link">
                {category.label} {formatCount(category.count)}
              </Link>
            </li>
          ))}
        </ul>
      }
    >
      {attention.stores.length === 0 ? (
        <p className="df-muted">{words.none}</p>
      ) : (
        <ul className="df-attention">
          {attention.stores.map((store) => (
            <AttentionRow key={store.id} store={store} />
          ))}
        </ul>
      )}
      {attention.stores.length < attention.total && (
        <p className="df-muted">
          {fill(words.showing, { shown: formatCount(attention.stores.length), total: formatCount(attention.total) })}
        </p>
      )}
    </DashboardCard>
  )
}
