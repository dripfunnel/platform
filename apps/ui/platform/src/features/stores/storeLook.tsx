import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import type { StoreDomain, StoreState, StorefrontState } from '../../api/stores'
import { fill, formatCount, formatDate, messages, plural } from '../../messages'

const words = messages.stores

interface Look {
  tone: StatusTone
  icon: StatusIconName
}

// The prototype's pills (designs/DF Platform Prototype.dc.html: sB, sfB, dB): word, colour and icon (SAAS.md §4.2).
const statusLook: Record<StoreState['kind'], Look> = {
  trial: { tone: 'info', icon: 'hour' },
  active: { tone: 'success', icon: 'ok' },
  pastdue: { tone: 'warning', icon: 'alert' },
  suspended: { tone: 'solid', icon: 'ban' },
  cancelled: { tone: 'neutral', icon: 'cross' },
}

const storefrontLook: Record<StorefrontState, Look> = {
  live: { tone: 'success', icon: 'ok' },
  building: { tone: 'info', icon: 'clock' },
  failed: { tone: 'danger', icon: 'cross' },
  own: { tone: 'neutral', icon: 'pen' },
}

const domainLook: Record<Exclude<StoreDomain['status'], 'live'>, Look> = {
  waiting: { tone: 'warning', icon: 'hour' },
  failed: { tone: 'danger', icon: 'cross' },
}

export const statusSub = (state: StoreState): { text: string; tone: 'muted' | 'warning' | 'danger' } | null => {
  switch (state.kind) {
    case 'trial':
      return {
        text:
          state.daysLeft === 0
            ? words.statusSub.trialToday
            : state.daysLeft === 1
              ? words.statusSub.trialTomorrow
              : fill(plural(words.statusSub.trialDays, state.daysLeft), { count: formatCount(state.daysLeft) }),
        tone: 'muted',
      }
    case 'pastdue':
      return { text: fill(plural(words.statusSub.pastdue, state.daysPastDue), { count: formatCount(state.daysPastDue) }), tone: 'warning' }
    case 'suspended':
      return { text: state.reason, tone: 'danger' }
    case 'cancelled':
      return { text: fill(words.statusSub.cancelled, { date: formatDate(state.since) }), tone: 'muted' }
    case 'active':
      return null
  }
}

export const StoreStatusPill = ({ state }: { state: StoreState }) => <StatusPill {...statusLook[state.kind]} label={words.statuses[state.kind]} />

export const StatusSub = ({ state }: { state: StoreState }) => {
  const sub = statusSub(state)
  return sub && <span className={`df-status-sub df-status-sub--${sub.tone}`}>{sub.text}</span>
}

export const StorefrontPill = ({ storefront }: { storefront: StorefrontState }) => (
  <StatusPill {...storefrontLook[storefront]} label={words.storefronts[storefront]} />
)

// Under the domain only when there is something to say: a custom domain not yet live (§6.1).
export const DomainNote = ({ domain }: { domain: StoreDomain }) =>
  domain.status === 'live' ? null : <StatusPill {...domainLook[domain.status]} label={words.domainStatus[domain.status]} />

export const DomainLink = ({ host }: { host: string }) => (
  <a href={`https://${host}`} target="_blank" rel="noopener noreferrer" className="df-host" aria-label={fill(words.opensInNewTab, { host })}>
    {host} ↗
  </a>
)
