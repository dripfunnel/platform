// States (?state=): loading, empty, error, denied; see approvalsHarness.ts. Without one the
// screen shows the partners awaiting approval, oldest submitted first.
import { Link } from '@tanstack/react-router'
import type { PartnerPage } from '../../api/partners'
import { messages } from '../../messages'
import { EmptyState } from '../common/EmptyState'
import { ErrorState } from '../common/ErrorState'
import { ListHeader } from '../common/ListHeader'
import { LoadingState } from '../common/LoadingState'
import { Pager } from '../common/Pager'
import { ApprovalCard } from './ApprovalCard'
import type { ApprovalsScreenState } from './approvalsHarness'
import '../common/list.css'
import './approvals.css'

const words = messages.approvals

export interface ApprovalsProps {
  page: PartnerPage | null
  forced: ApprovalsScreenState | null
  onReload: () => void
}

const ApprovalsHeader = () => <ListHeader level={words.level} title={words.title} sub={words.sub} />

export const ApprovalsLoading = () => (
  <div className="df-page df-list">
    <ApprovalsHeader />
    <LoadingState label={words.loading} rows={3} />
  </div>
)

export const ApprovalsError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <ApprovalsHeader />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

export const Approvals = ({ page, forced, onReload }: ApprovalsProps) => {
  if (forced === 'loading') return <ApprovalsLoading />
  if (forced === 'error') return <ApprovalsError onRetry={onReload} />

  if (!page) {
    return (
      <div className="df-page df-list">
        <ApprovalsHeader />
        <EmptyState
          title={words.denied.title}
          body={words.denied.body}
          action={
            <Link to="/partners" search={{ status: 'awaiting' }} className="df-button">
              {words.denied.back}
            </Link>
          }
        />
      </div>
    )
  }

  if (forced === 'empty' || (page.items.length === 0 && !page.pageInfo.hasPreviousPage)) {
    return (
      <div className="df-page df-list">
        <ApprovalsHeader />
        <EmptyState title={words.empty.title} body={words.empty.body} />
      </div>
    )
  }

  return (
    <div className="df-page df-list">
      <ApprovalsHeader />
      <ul className="df-approvals" aria-label={words.listLabel}>
        {page.items.map((partner) => (
          <li key={partner.id}>
            <ApprovalCard partner={partner} />
          </li>
        ))}
      </ul>
      <Pager
        label={words.pagerLabel}
        pageInfo={page.pageInfo}
        link={(cursor, label) => (
          <Link to="/approvals" search={cursor} className="df-button">
            {label}
          </Link>
        )}
      />
    </div>
  )
}
