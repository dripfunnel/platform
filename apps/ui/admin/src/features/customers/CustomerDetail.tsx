// States (?state=): loading, error, readonly. There is no denied state: every staff role may
// open a customer and none may act on one (decided on #42). Without a state the screen shows
// the API's customer, with contacts masked unless the API sent them in full.
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { Customer } from '../../api/customers'
import { messages } from '../../messages'
import { EmptyState } from '../common/EmptyState'
import { ErrorState } from '../common/ErrorState'
import { LoadingState } from '../common/LoadingState'
import { ReadOnlyNotice } from '../common/ReadOnlyNotice'
import type { CustomerScreenState } from './customerHarness'
import { CustomerHeader } from './CustomerHeader'
import { CustomerOverview } from './CustomerOverview'
import { CustomerTabs, type CustomerTab } from './CustomerTabs'
import '../common/list.css'

const words = messages.customer

export interface CustomerDetailProps {
  customer: Customer | null
  tab: CustomerTab
  forced: CustomerScreenState | null
  readOnly: boolean
  onReload: () => void
  // The Activity tab, built by the screen with its filters in the page's URL.
  activity: ReactNode
}

export const CustomerLoading = () => (
  <div className="df-page df-list">
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const CustomerError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

export const CustomerDetail = ({ customer, tab, forced, readOnly, onReload, activity }: CustomerDetailProps) => {
  if (forced === 'loading') return <CustomerLoading />
  if (forced === 'error') return <CustomerError onRetry={onReload} />
  if (!customer) {
    return (
      <div className="df-page df-list">
        <EmptyState
          title={words.notFound.title}
          body={words.notFound.body}
          action={
            <Link to="/customers" className="df-button">
              {words.notFound.back}
            </Link>
          }
        />
      </div>
    )
  }
  return (
    <div className="df-page df-list">
      {readOnly && <ReadOnlyNotice title={messages.customers.readOnly.title} body={messages.customers.readOnly.body} />}
      <CustomerHeader customer={customer} />
      <CustomerTabs customerId={customer.id} current={tab} />
      {tab === 'overview' ? (
        <CustomerOverview customer={customer} />
      ) : (
        activity
      )}
    </div>
  )
}
