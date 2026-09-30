import type { SetupState, StoreDomain, StorefrontState, StoreState } from '../../api/stores'
import { fill, formatCount, formatDate, messages, plural } from '../../messages'
import { StatusPill, type StatusTone } from '../common/StatusPill'
import type { StatusIconName } from '../shell/Icon'

const words = messages.stores

interface Look {
  tone: StatusTone
  icon: StatusIconName
}

// The admin prototype's store pills (designs/DF Admin Prototype.dc.html: sB, SF, setB, dB).
const statusLook: Record<StoreState['kind'], Look> = {
  trial: { tone: 'info', icon: 'hour' },
  active: { tone: 'success', icon: 'ok' },
  pastdue: { tone: 'warning', icon: 'clock' },
  suspended: { tone: 'solid', icon: 'ban' },
  cancelled: { tone: 'neutral', icon: 'ban' },
}

const storefrontLook: Record<StorefrontState, Look> = {
  live: { tone: 'success', icon: 'ok' },
  building: { tone: 'info', icon: 'clock' },
  failed: { tone: 'danger', icon: 'alert' },
  own: { tone: 'neutral', icon: 'pen' },
}

export const setupLook: Record<SetupState, Look> = {
  done: { tone: 'success', icon: 'ok' },
  running: { tone: 'info', icon: 'clock' },
  failed: { tone: 'danger', icon: 'alert' },
  stuck: { tone: 'warning', icon: 'clock' },
  cleaning: { tone: 'info', icon: 'clock' },
}

const domainLook: Record<StoreDomain['status'], Look> = {
  live: { tone: 'success', icon: 'ok' },
  waiting: { tone: 'warning', icon: 'clock' },
  failed: { tone: 'danger', icon: 'alert' },
}

const statusLabel = (state: StoreState) => {
  switch (state.kind) {
    case 'trial':
      return state.daysLeft <= 1
        ? words.statusLabel.trialTomorrow
        : fill(plural(words.statusLabel.trialDays, state.daysLeft), { count: formatCount(state.daysLeft) })
    case 'pastdue':
      return fill(plural(words.statusLabel.pastdue, state.daysPastDue), { count: formatCount(state.daysPastDue) })
    default:
      return words.statuses[state.kind]
  }
}

// The line under a status pill; the warning and danger ones take their colour (`tone`).
export const statusSub = (state: StoreState): { text: string; tone: 'muted' | 'warning' | 'danger' } | null => {
  switch (state.kind) {
    case 'trial':
      return { text: fill(words.statusSub.trial, { date: formatDate(state.trialEndsAt) }), tone: 'muted' }
    case 'pastdue':
      return { text: words.statusSub.pastdue, tone: 'warning' }
    case 'suspended':
      return { text: fill(words.statusSub.suspended, { reason: state.reason, by: state.by }), tone: 'danger' }
    case 'cancelled':
      return { text: fill(words.statusSub.cancelled, { date: formatDate(state.since) }), tone: 'muted' }
    case 'active':
      return null
  }
}

export const StatusSub = ({ state }: { state: StoreState }) => {
  const sub = statusSub(state)
  return sub && <span className={`df-status-sub df-status-sub--${sub.tone}`}>{sub.text}</span>
}

export const StoreStatusPill = ({ state }: { state: StoreState }) => <StatusPill {...statusLook[state.kind]} label={statusLabel(state)} />

export const StorefrontPill = ({ storefront }: { storefront: StorefrontState }) => (
  <StatusPill {...storefrontLook[storefront]} label={words.storefronts[storefront]} />
)

export const DomainPill = ({ status }: { status: StoreDomain['status'] }) => (
  <StatusPill {...domainLook[status]} label={messages.store.domains.status[status]} />
)

// The list shows a domain's pill only when there is something to say: a custom domain, or one
// that isn't live yet.
export const DomainNote = ({ domain }: { domain: StoreDomain }) => {
  if (domain.custom && domain.status === 'live') return <StatusPill tone="success" icon="ok" label={words.customLive} />
  return domain.status === 'live' ? null : <DomainPill status={domain.status} />
}

export const LiveLink = ({ host }: { host: string }) => (
  <a href={`https://${host}`} target="_blank" rel="noopener noreferrer" className="df-host" aria-label={fill(words.opensInNewTab, { host })}>
    {host} ↗
  </a>
)
