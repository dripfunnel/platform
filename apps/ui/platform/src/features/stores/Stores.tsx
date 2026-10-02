// States (?state=): loading, empty, error, readonly, denied. Without one the screen shows the API's
// page of the partner's stores, newest first, and is empty until a merchant has signed up.
import { EmptyState, ErrorState, ListHeader, LoadingState, ReadOnlyNotice, useAnnouncement } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import { useState } from 'react'
import type { Me } from '../../api/me'
import type { ExportJob } from '@dripfunnel/shared/graphql'
import type { BillingStatus, StorePage, StoreRow } from '../../api/stores'
import { fill, formatCount, messages, plural } from '../../messages'
import { CreateStoreButton } from './CreateStoreButton'
import { FilterChips } from './FilterChips'
import { StoreCards } from './StoreCards'
import { StoreFilters } from './StoreFilters'
import { StoresExport } from './StoresExport'
import type { StoresState } from './storeHarness'
import { isFiltered } from './storeSearch'
import { StoresTable } from './StoresTable'
import './stores.css'
import type { StoreFilter } from '../../api/stores'

const words = messages.stores
const screen = messages.screens.stores

export interface StoresProps {
  me: Me
  page: StorePage
  filter: StoreFilter
  forced: StoresState | null
  onFilterChange: (filter: StoreFilter) => void
  onReload: () => void
  // The next page after a cursor, appended under the rows ("Show 25 more", FIRST-RELEASE.md §16).
  loadMore: (after: string) => Promise<StorePage>
  exportJob: ExportJob | null
  onExport: () => void
  onBillingStatus: (store: StoreRow, status: BillingStatus) => void
}

const Header = ({ product, action }: { product: string; action?: React.ReactNode }) => (
  <ListHeader title={screen.title} sub={fill(screen.lede, { product })} action={action} />
)

export const StoresLoading = ({ product }: { product: string }) => (
  <div className="df-page df-list">
    <Header product={product} />
    <LoadingState label={words.loading} rows={8} />
  </div>
)

export const StoresError = ({ product, onRetry }: { product: string; onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header product={product} />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

interface More {
  of: StorePage
  items: readonly StoreRow[]
  pageInfo: StorePage['pageInfo']
  busy: boolean
  failed: boolean
}

export const Stores = ({ me, page, filter, forced, onFilterChange, onReload, loadMore, exportJob, onExport, onBillingStatus }: StoresProps) => {
  const [more, setMore] = useState<More | null>(null)
  // A new page from the loader (a new filter, a reload) starts the appended rows over.
  const shown: More = more?.of === page ? more : { of: page, items: [], pageInfo: page.pageInfo, busy: false, failed: false }
  const announcement = useAnnouncement(shown.items.length > 0 ? fill(plural(words.moreShown, shown.items.length), { count: formatCount(shown.items.length) }) : '')
  const product = me.partner.product

  if (forced === 'loading') return <StoresLoading product={product} />
  if (forced === 'error') return <StoresError product={product} onRetry={onReload} />

  const create = <CreateStoreButton permission={page.actions.create} product={product} />
  // The API offers `billingStatus` only when the partner bills its merchants itself (§11.4).
  const billingPermission = page.actions.billingStatus
  const billing = billingPermission ? { allowed: billingPermission.allowed, onChange: onBillingStatus } : null

  if (forced === 'empty' || (page.items.length === 0 && !isFiltered(filter) && !page.pageInfo.hasPreviousPage)) {
    return (
      <div className="df-page df-list">
        <Header product={product} />
        <EmptyState
          title={words.empty.title}
          body={fill(words.empty.body, { host: me.partner.host })}
          action={<CreateStoreButton permission={page.actions.create} product={product} label={words.empty.action} />}
        />
      </div>
    )
  }

  const onMore = () => {
    const after = shown.pageInfo.endCursor
    if (!after || shown.busy) return
    setMore({ ...shown, busy: true, failed: false })
    loadMore(after).then(
      (next) => setMore({ of: page, items: [...shown.items, ...next.items], pageInfo: next.pageInfo, busy: false, failed: false }),
      () => setMore({ ...shown, busy: false, failed: true }),
    )
  }

  const items = [...page.items, ...shown.items]
  return (
    <div className="df-page df-list">
      {(me.role === 'partner-read-only' || forced === 'readonly') && <ReadOnlyNotice title={messages.states.readonly.title} body={messages.states.readonly.body} />}
      <Header
        product={product}
        action={
          <div className="df-stores-actions">
            <StoresExport permission={page.actions.export} job={exportJob} onExport={onExport} />
            {create}
          </div>
        }
      />
      {billing && (
        <p id="billing-status-refused" className={billing.allowed ? 'df-muted' : 'df-muted df-billing-refused'}>
          {billingPermission?.allowed === false ? fill(messages.store.refused[billingPermission.reason], { verb: messages.store.verbs.billingStatus, name: '' }) : words.billingStatus.note}
        </p>
      )}
      <div className="df-list-toolbar">
        <StoreFilters filter={filter} plans={page.plans} onChange={onFilterChange} />
        <p className="df-muted">{words.newestFirst}</p>
      </div>
      <FilterChips filter={filter} plans={page.plans} />
      {items.length === 0 ? (
        <EmptyState
          title={words.noMatch.title}
          body={words.noMatch.body}
          action={
            <button type="button" className="df-button" onClick={() => onFilterChange({})}>
              {words.filters.clear}
            </button>
          }
        />
      ) : (
        <>
          <StoresTable stores={items} billing={billing} />
          <StoreCards stores={items} />
          <p role="status" className="df-visually-hidden">
            {announcement}
          </p>
          {shown.failed && <ErrorState title={words.moreError.title} body={words.moreError.body} retry={{ label: words.error.retry, onRetry: onMore }} />}
          {shown.pageInfo.hasNextPage && !shown.failed && (
            <div className="df-show-more">
              <button type="button" className="df-button" onClick={onMore} disabled={shown.busy}>
                {fill(words.showMore, { count: formatCount(page.items.length) })}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
