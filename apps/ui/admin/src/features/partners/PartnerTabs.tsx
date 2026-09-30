import { Link } from '@tanstack/react-router'
import { messages } from '../../messages'
import './partners.css'

const words = messages.partner

// The seven tabs FIRST-RELEASE.md §4.2 lists, in its order; no Setup tab (decided on #19).
export const partnerTabs = ['overview', 'stores', 'branding', 'domains', 'plans', 'team', 'activity'] as const
export type PartnerTab = (typeof partnerTabs)[number]

// Links, not an ARIA tab list: each tab is its own address (?tab=), so it can be shared.
export const PartnerTabs = ({ partnerId, current }: { partnerId: string; current: PartnerTab }) => (
  <nav className="df-tabs" aria-label={words.tabsLabel}>
    <ul>
      {partnerTabs.map((tab) => (
        <li key={tab}>
          <Link
            to="/partners/$partnerId"
            params={{ partnerId }}
            search={tab === 'overview' ? {} : { tab }}
            className="df-tab"
            aria-current={tab === current ? 'page' : undefined}
          >
            {words.tabs[tab]}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
)
