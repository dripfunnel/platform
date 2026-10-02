import type { ReactNode } from 'react'
import '@dripfunnel/shared/ui/list.css'
import './detail.css'

export interface TabLinkProps {
  className: string
  'aria-current': 'page' | undefined
  children: string
}

export interface DetailTabsProps<Tab extends string> {
  label: string
  tabs: readonly Tab[]
  labels: Record<Tab, string>
  current: Tab
  // The page's own link to a tab (?tab=), so each tab is an address that can be shared.
  link: (tab: Tab, props: TabLinkProps) => ReactNode
}

// Links, not an ARIA tab list: each tab is its own address.
export const DetailTabs = <Tab extends string>({ label, tabs, labels, current, link }: DetailTabsProps<Tab>) => (
  <nav className="df-tabs" aria-label={label}>
    <ul>
      {tabs.map((tab) => (
        <li key={tab}>{link(tab, { className: 'df-tab', 'aria-current': tab === current ? 'page' : undefined, children: labels[tab] })}</li>
      ))}
    </ul>
  </nav>
)
