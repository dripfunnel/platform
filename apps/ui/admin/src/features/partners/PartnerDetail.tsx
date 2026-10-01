// States (?state=): loading, error, readonly, denied, confirm. Without one the screen shows the
// API's partner, with each action as the API allows it for the signed-in staff member.
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { Partner, PartnerAction, PartnerDomain } from '../../api/partners'
import { fill, messages } from '../../messages'
import { EmptyState } from '../common/EmptyState'
import { ErrorState } from '../common/ErrorState'
import { LoadingState } from '../common/LoadingState'
import { ReadOnlyNotice } from '../common/ReadOnlyNotice'
import { BrandingTab } from './BrandingTab'
import { DomainsTab } from './DomainsTab'
import { OverviewTab } from './OverviewTab'
import type { PartnerScreenState } from './partnerHarness'
import { PartnerHeader } from './PartnerHeader'
import { PartnerTabs, type PartnerTab } from './PartnerTabs'
import { PlansTab } from './PlansTab'
import { TeamTab } from './TeamTab'
import '../common/list.css'
import './partners.css'

const words = messages.partner

export interface PartnerDetailProps {
  partner: Partner | null
  tab: PartnerTab
  forced: PartnerScreenState | null
  readOnly: boolean
  onAction: (action: PartnerAction) => void
  onRecheck: (domain: PartnerDomain) => Promise<void>
  onReload: () => void
}

export const PartnerLoading = () => (
  <div className="df-page df-list">
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const PartnerError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const Placeholder = ({ children }: { children: ReactNode }) => <div className="df-panel df-panel--wide">{children}</div>

const TabContent = ({ partner, tab, onAction, onRecheck }: Pick<PartnerDetailProps, 'tab' | 'onAction' | 'onRecheck'> & { partner: Partner }) => {
  switch (tab) {
    case 'overview':
      return <OverviewTab partner={partner} />
    case 'stores':
      return (
        <Placeholder>
          <p className="df-muted">{words.placeholders.stores}</p>
          <Link to="/stores" search={{ partner: partner.id }} className="df-row-link">
            {fill(words.placeholders.storesLink, { name: partner.name })}
          </Link>
        </Placeholder>
      )
    case 'branding':
      return <BrandingTab partner={partner} />
    case 'domains':
      return <DomainsTab partner={partner} onRecheck={onRecheck} />
    case 'plans':
      return <PlansTab partner={partner} />
    case 'team':
      return <TeamTab partner={partner} onAction={onAction} />
    case 'activity':
      return (
        <Placeholder>
          <p className="df-muted">{words.placeholders.activity}</p>
        </Placeholder>
      )
  }
}

export const PartnerDetail = ({ partner, tab, forced, readOnly, onAction, onRecheck, onReload }: PartnerDetailProps) => {
  if (forced === 'loading') return <PartnerLoading />
  if (forced === 'error') return <PartnerError onRetry={onReload} />
  if (!partner) {
    return (
      <div className="df-page df-list">
        <EmptyState
          title={words.notFound.title}
          body={words.notFound.body}
          action={
            <Link to="/partners" className="df-button">
              {words.notFound.back}
            </Link>
          }
        />
      </div>
    )
  }
  return (
    <div className="df-page df-list">
      {readOnly && <ReadOnlyNotice title={messages.partners.readOnly.title} body={messages.partners.readOnly.body} />}
      <PartnerHeader partner={partner} onAction={onAction} />
      <PartnerTabs partnerId={partner.id} current={tab} />
      <TabContent partner={partner} tab={tab} onAction={onAction} onRecheck={onRecheck} />
    </div>
  )
}
