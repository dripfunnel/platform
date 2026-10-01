import { Link } from '@tanstack/react-router'
import { messages } from '../../messages'
import { DetailTabs } from '../common/DetailTabs'

const words = messages.partner

// The seven tabs FIRST-RELEASE.md §4.2 lists, in its order; no Setup tab (decided on #19).
export const partnerTabs = ['overview', 'stores', 'branding', 'domains', 'plans', 'team', 'activity'] as const
export type PartnerTab = (typeof partnerTabs)[number]

export const PartnerTabs = ({ partnerId, current }: { partnerId: string; current: PartnerTab }) => (
  <DetailTabs
    label={words.tabsLabel}
    tabs={partnerTabs}
    labels={words.tabs}
    current={current}
    link={(tab, props) => <Link to="/partners/$partnerId" params={{ partnerId }} search={tab === 'overview' ? { tab: undefined } : { tab }} activeOptions={{ explicitUndefined: true }} {...props} />}
  />
)
