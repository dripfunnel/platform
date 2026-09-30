// States (?state=): loading, error, readonly, denied, confirm. Without one the screen shows the
// API's store, with each action as the API allows it for the signed-in staff member.
import { Link } from '@tanstack/react-router'
import type { Store, StoreDnsRecord } from '../../api/stores'
import { messages } from '../../messages'
import { EmptyState } from '../common/EmptyState'
import { ErrorState } from '../common/ErrorState'
import { LoadingState } from '../common/LoadingState'
import { ReadOnlyNotice } from '../common/ReadOnlyNotice'
import { CustomersTab, type StoreCustomers } from './CustomersTab'
import { DomainsTab } from './DomainsTab'
import { NotesTab } from './NotesTab'
import { OverviewTab } from './OverviewTab'
import { ProvisioningTab } from './ProvisioningTab'
import type { DialogAction } from './storeDialog'
import { StorefrontTab } from './StorefrontTab'
import type { StoreScreenState } from './storeHarness'
import { StoreHeader } from './StoreHeader'
import { StoreTabs, type StoreTab } from './StoreTabs'
import { SupportTab } from './SupportTab'
import { UsersTab } from './UsersTab'
import '../common/list.css'

const words = messages.store

export interface StoreDetailProps {
  store: Store | null
  tab: StoreTab
  forced: StoreScreenState | null
  readOnly: boolean
  onAction: (action: DialogAction) => void
  onAddNote: (text: string) => Promise<boolean>
  onRecheck: (record: StoreDnsRecord) => Promise<void>
  customers: StoreCustomers
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

type TabProps = Pick<StoreDetailProps, 'tab' | 'onAction' | 'onAddNote' | 'onRecheck' | 'customers'> & { store: Store }

const TabContent = ({ store, tab, onAction, onAddNote, onRecheck, customers }: TabProps) => {
  switch (tab) {
    case 'overview':
      return <OverviewTab store={store} />
    case 'storefront':
      return <StorefrontTab store={store} />
    case 'domains':
      return <DomainsTab store={store} onRecheck={onRecheck} />
    case 'provisioning':
      return <ProvisioningTab store={store} onAction={onAction} />
    case 'users':
      return <UsersTab store={store} />
    case 'customers':
      return <CustomersTab store={store} customers={customers} />
    case 'support':
      return <SupportTab store={store} />
    case 'activity':
      return (
        <div className="df-panel df-panel--wide">
          <p className="df-muted">{words.activity.placeholder}</p>
        </div>
      )
    case 'notes':
      return <NotesTab store={store} onAddNote={onAddNote} />
  }
}

export const StoreDetail = ({ store, tab, forced, readOnly, onAction, onAddNote, onRecheck, customers, onReload }: StoreDetailProps) => {
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
  return (
    <div className="df-page df-list">
      {readOnly && <ReadOnlyNotice title={messages.stores.readOnly.title} body={messages.stores.readOnly.body} />}
      <StoreHeader store={store} onAction={onAction} />
      <StoreTabs storeId={store.id} current={tab} />
      <TabContent store={store} tab={tab} onAction={onAction} onAddNote={onAddNote} onRecheck={onRecheck} customers={customers} />
    </div>
  )
}
