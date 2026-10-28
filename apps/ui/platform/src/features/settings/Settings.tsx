import { DetailTabs, ErrorState, ListHeader, LoadingState, ReadOnlyNotice } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/detail.css'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { messages } from '../../messages'
import type { SettingsTab } from './settingsHarness'
import './settings.css'

const words = messages.settings
const screen = messages.screens.settings

const Header = () => <ListHeader title={screen.title} sub={screen.lede} />

export const SettingsLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={words.loading} rows={5} />
  </div>
)

export const SettingsError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

// Five tabs (Integrations for Owners and Admins), each its own address (?tab=), as the prototype draws them (§14).
export const Settings = ({ tab, tabs, readOnly, children }: { tab: SettingsTab; tabs: readonly SettingsTab[]; readOnly: boolean; children: ReactNode }) => (
  <div className="df-page df-list df-settings">
    <Header />
    <DetailTabs
      label={words.tabsLabel}
      tabs={tabs}
      labels={words.tabs}
      current={tab}
      link={(target, props) => <Link to="/settings" search={{ tab: target === 'company' ? undefined : target }} activeOptions={{ explicitUndefined: true }} {...props} />}
    />
    {readOnly && <ReadOnlyNotice title={messages.states.readonly.title} body={messages.states.readonly.body} />}
    {children}
  </div>
)
