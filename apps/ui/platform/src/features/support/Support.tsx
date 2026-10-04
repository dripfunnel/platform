import { DetailTabs, ErrorState, ListHeader, LoadingState, PermissionDenied } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { fill, messages } from '../../messages'
import { supportTabs, type SupportTab } from './supportHarness'
import './support.css'

const words = messages.support
const screen = messages.screens.support

const Header = () => <ListHeader title={screen.title} sub={screen.lede} />

export const SupportLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const SupportError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

// A role without Support, or a DripFunnel staff session: the API refuses both (§12, ACCESS.md §8.2).
export const SupportRefused = ({ reason }: { reason: string }) => (
  <div className="df-page df-list">
    <Header />
    <PermissionDenied actionLabel={screen.title} reason={reason} />
  </div>
)

// Two tabs, each its own address (?tab=), the second counting the open sessions (§12).
export const Support = ({ tab, openCount, children }: { tab: SupportTab; openCount: number; children: ReactNode }) => (
  <div className="df-page df-list df-support">
    <Header />
    <DetailTabs
      label={words.tabsLabel}
      tabs={supportTabs}
      labels={{ users: words.tabs.users, sessions: fill(words.tabs.sessions, { count: String(openCount) }) }}
      current={tab}
      link={(target, props) => <Link to="/support" search={target === 'users' ? {} : { tab: target }} {...props} />}
    />
    {children}
  </div>
)
