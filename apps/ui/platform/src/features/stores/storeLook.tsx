import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import type { SearchStatus } from '../../api/search'
import type { BillingMode, StoreDomain, StoreState, StorefrontState } from '../../api/stores'
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
      if (state.daysLeft === null) return null
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
      return state.since ? { text: fill(words.statusSub.cancelled, { date: formatDate(state.since) }), tone: 'muted' } : null
    case 'active':
      return null
  }
}

export const StoreStatusPill = ({ state }: { state: StoreState }) => <StatusPill {...statusLook[state.kind]} label={words.statuses[state.kind]} />

// A search result carries the API's status as stored, closed included (FIRST-RELEASE §2.2).
const searchLook: Record<SearchStatus, Look & { label: string }> = {
  trial: { ...statusLook.trial, label: words.statuses.trial },
  active: { ...statusLook.active, label: words.statuses.active },
  past_due: { ...statusLook.pastdue, label: words.statuses.pastdue },
  suspended: { ...statusLook.suspended, label: words.statuses.suspended },
  cancelled: { ...statusLook.cancelled, label: words.statuses.cancelled },
  closed: { tone: 'neutral', icon: 'cross', label: words.statuses.closed },
}

export const SearchStatusPill = ({ status }: { status: SearchStatus }) => <StatusPill {...searchLook[status]} />

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

// "DripFunnel for Northstar" or the partner itself: who charges the merchant (§1, §11.4).
export const chargedByOf = (mode: BillingMode, partner: string): string => (mode === 'own' ? partner : fill(words.chargedByDripFunnel, { partner }))

export const planNameOf = (plan: { name: string } | null): string => plan?.name ?? words.noPlan

// The header's notice for a suspended or past-due store, worded here from the API's state (§6.3).
// The API sends neither when the store was suspended nor when the card is retried (#166's findings).
export const noticeOf = ({ state, owner }: { state: StoreState; owner: { name: string } }): { tone: 'danger' | 'warning'; text: string } | null =>
  state.kind === 'suspended'
    ? { tone: 'danger', text: fill(state.reason ? messages.store.notice.suspended : messages.store.notice.suspendedNoReason, { reason: state.reason }) }
    : state.kind === 'pastdue'
      ? { tone: 'warning', text: fill(messages.store.notice.pastdue, { days: formatCount(state.daysPastDue), owner: owner.name.split(' ')[0] ?? owner.name }) }
      : null

// A store without its own domain shows its code: the API gives the list no shop address (#166's findings).
export const DomainCell = ({ domain, code }: { domain: StoreDomain | null; code: string }) => (domain ? <DomainLink host={domain.host} /> : <code className="df-muted">{code}</code>)

export const DomainLink = ({ host }: { host: string }) => (
  <a href={`https://${host}`} target="_blank" rel="noopener noreferrer" className="df-host" aria-label={fill(words.opensInNewTab, { host })}>
    {host} ↗
  </a>
)
