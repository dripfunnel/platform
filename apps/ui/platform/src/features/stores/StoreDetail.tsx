// States (?state=): loading, error, readonly, denied, confirm. Without one the screen shows the API's
// store, with each action as the API allows it for the signed-in partner user.
import { DetailTabs, EmptyState, ErrorState, LoadingState, ReadOnlyNotice } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/detail.css'
import { Link } from '@tanstack/react-router'
import type { Me } from '../../api/me'
import { storeTabs, type Store, type StoreAction, type StoreTab } from '../../api/stores'
import { messages } from '../../messages'
import { ActivityTab } from './tabs/ActivityTab'
import { BillingTab } from './tabs/BillingTab'
import { DomainsTab } from './tabs/DomainsTab'
import { OverviewTab } from './tabs/OverviewTab'
import { PlanTab } from './tabs/PlanTab'
import { SetupTab } from './tabs/SetupTab'
import { StorefrontTab } from './tabs/StorefrontTab'
import { SupportTab } from './tabs/SupportTab'
import type { StoreScreenState } from './storeHarness'
import { StoreHeader } from './StoreHeader'
import { noticeOf } from './storeLook'
import './storeDetail.css'

const words = messages.store

export interface StoreDetailProps {
  me: Me
  store: Store | null
  tab: StoreTab
  forced: StoreScreenState | null
  onAction: (action: StoreAction) => void
  onRecheck: () => Promise<void>
  onReload: () => void
}

export const StoreLoading = () => (
  <div className="df-page df-list">
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const StoreError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const TabContent = ({ me, store, tab, onAction, onRecheck }: Pick<StoreDetailProps, 'me' | 'tab' | 'onAction' | 'onRecheck'> & { store: Store }) => {
  switch (tab) {
    case 'overview':
      return <OverviewTab store={store} />
    case 'plan':
      return <PlanTab store={store} onAction={onAction} />
    case 'billing':
      return <BillingTab store={store} />
    case 'storefront':
      return <StorefrontTab store={store} />
    case 'domains':
      return <DomainsTab store={store} product={me.partner.product} onRecheck={onRecheck} />
    case 'setup':
      return <SetupTab store={store} onAction={onAction} />
    case 'support':
      return <SupportTab store={store} partner={me.partner.name} />
    case 'activity':
      return <ActivityTab store={store} />
  }
}

export const StoreDetail = ({ me, store, tab, forced, onAction, onRecheck, onReload }: StoreDetailProps) => {
  if (forced === 'loading') return <StoreLoading />
  if (forced === 'error') return <StoreError onRetry={onReload} />
  if (!store) {
    return (
      <div className="df-page df-list">
        <EmptyState
          title={words.notFound.title}
          body={words.notFound.body}
          action={
            <Link to="/stores" className="df-button">
              {words.notFound.back}
            </Link>
          }
        />
      </div>
    )
  }
  const notice = noticeOf(store)
  return (
    <div className="df-page df-list">
      {(me.role === 'partner-read-only' || forced === 'readonly') && <ReadOnlyNotice title={messages.states.readonly.title} body={messages.states.readonly.body} />}
      <StoreHeader store={store} product={me.partner.product} onAction={onAction} />
      <DetailTabs
        label={words.tabsLabel}
        tabs={storeTabs}
        labels={words.tabs}
        current={tab}
        link={(next, props) => <Link to="/stores/$storeId" params={{ storeId: store.id }} search={(prev) => ({ ...prev, tab: next === 'overview' ? undefined : next })} activeOptions={{ explicitUndefined: true }} {...props} />}
      />
      {notice && (
        <p role="status" className={`df-store-notice df-store-notice--${notice.tone}`}>
          {notice.text}
        </p>
      )}
      <TabContent me={me} store={store} tab={tab} onAction={onAction} onRecheck={onRecheck} />
    </div>
  )
}
