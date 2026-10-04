import { EmptyState, ErrorState, ListHeader, LoadingState, PermissionDenied, StatusPill } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import { Link } from '@tanstack/react-router'
import type { Address, DomainKind, DomainsPage, MerchantDomain } from '../../api/domains'
import { fill, formatDate, messages } from '../../messages'
import { statusPill, whenText } from './domainLook'
import { RecordTable } from './RecordTable'
import type { DomainsState } from './domainsHarness'
import './domains.css'

const words = messages.domains
const screen = messages.screens.domains

const Header = ({ action }: { action?: React.ReactNode }) => <ListHeader title={screen.title} sub={screen.lede} action={action} />

export const DomainsLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={words.loading} rows={4} />
  </div>
)

export const DomainsError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

// Owners and Admins add one while fewer than four exist (§9.2); anyone else sees why not.
const AddButton = ({ canAdd, allAdded, kind }: { canAdd: boolean; allAdded: boolean; kind?: DomainKind }) => {
  if (allAdded) return null
  if (!canAdd) return <PermissionDenied actionLabel={words.add} reason={words.addRefused} />
  return (
    <Link to="/domains/new" search={kind ? { k: kind } : {}} className="df-button df-button--primary">
      {kind === 'portal' ? words.empty.action : words.add}
    </Link>
  )
}

export interface AddressCardProps {
  address: Extract<Address, { added: true }>
  fallbackSender: string | null
  now: number
  checking: boolean
  onRecheck: () => void
  onCopy: (text: string) => void
}

export const AddressCard = ({ address, fallbackSender, now, checking, onRecheck, onCopy }: AddressCardProps) => {
  const kind = words.kinds[address.kind]
  return (
    <section className="df-panel df-address" aria-labelledby={`address-${address.kind}`}>
      <div className="df-address-head">
        <div className="df-stack">
          <span className="df-address-kind">{kind.label}</span>
          <div className="df-address-title">
            <h2 id={`address-${address.kind}`}>{address.host}</h2>
            <StatusPill {...statusPill(address.status)} />
          </div>
          <span className="df-muted">{kind.what}</span>
        </div>
        <div className="df-address-check">
          <button type="button" className="df-button" disabled={checking} onClick={onRecheck}>
            {checking ? words.checking : words.recheck}
          </button>
          <span className="df-muted">{whenText(address, now)}</span>
        </div>
      </div>
      {address.kind === 'email' && fallbackSender && <p className="df-address-fallback">{fill(words.fallback, { sender: fallbackSender })}</p>}
      <RecordTable host={address.host} kind={address.kind} records={address.records} showFound onCopy={onCopy} />
    </section>
  )
}

const MerchantList = ({ items, more, busy, onMore }: { items: readonly MerchantDomain[]; more: boolean; busy: boolean; onMore: () => void }) => (
  <section className="df-panel" aria-labelledby="merchant-domains">
    <div className="df-stack">
      <h2 id="merchant-domains">{words.merchants.title}</h2>
      <span className="df-muted">{words.merchants.lede}</span>
    </div>
    {items.length === 0 ? (
      <p className="df-muted">{words.merchants.none}</p>
    ) : (
      <ul className="df-merchant-domains" aria-label={words.merchants.label}>
        {items.map((domain) => (
          <li key={`${domain.storeId} ${domain.host}`}>
            <Link to="/stores/$storeId" params={{ storeId: domain.storeId }} search={{ tab: 'domains' }} className="df-merchant-domain">
              <strong>{domain.storeName}</strong>
              <span className="df-merchant-host">{domain.host}</span>
              <StatusPill {...statusPill(domain.status)} />
              <span className="df-muted">{domain.status === 'live' ? words.status.live : fill(words.merchants.since, { date: formatDate(domain.since) })}</span>
            </Link>
          </li>
        ))}
      </ul>
    )}
    {more && (
      <div className="df-show-more">
        <button type="button" className="df-button" disabled={busy} onClick={onMore}>
          {words.merchants.showMore}
        </button>
      </div>
    )}
  </section>
)

export interface DomainsProps {
  page: DomainsPage
  forced: DomainsState | null
  now: number
  checking: DomainKind | null
  merchants: { items: readonly MerchantDomain[]; more: boolean; busy: boolean }
  onRecheck: (address: Extract<Address, { added: true }>) => void
  onMore: () => void
  onCopy: (text: string) => void
  onRetry: () => void
}

export const Domains = ({ page, forced, now, checking, merchants, onRecheck, onMore, onCopy, onRetry }: DomainsProps) => {
  if (forced === 'loading') return <DomainsLoading />
  if (forced === 'error') return <DomainsError onRetry={onRetry} />
  const added = forced === 'empty' ? [] : page.partner.addresses.filter((a): a is Extract<Address, { added: true }> => a.added)
  const canAdd = page.partner.canAdd && forced !== 'denied'
  const allAdded = added.length === page.partner.addresses.length
  if (added.length === 0) {
    return (
      <div className="df-page df-list">
        <Header />
        <EmptyState title={words.empty.title} body={words.empty.body} action={<AddButton canAdd={canAdd} allAdded={false} kind="portal" />} />
      </div>
    )
  }
  return (
    <div className="df-page df-list df-domains">
      <Header action={<AddButton canAdd={canAdd} allAdded={allAdded} />} />
      {added.map((address) => (
        <AddressCard key={address.kind} address={address} fallbackSender={page.partner.fallbackSender} now={now} checking={checking === address.kind} onRecheck={() => onRecheck(address)} onCopy={onCopy} />
      ))}
      <MerchantList items={merchants.items} more={merchants.more} busy={merchants.busy} onMore={onMore} />
    </div>
  )
}
