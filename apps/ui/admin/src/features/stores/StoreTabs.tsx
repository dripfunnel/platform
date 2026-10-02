import { Link } from '@tanstack/react-router'
import { messages } from '../../messages'
import { DetailTabs } from '@dripfunnel/shared/ui'

const words = messages.store

// The tabs decided on #20, in its order, with Customers after Users where the prototype has it
// (#42).
export const storeTabs = ['overview', 'storefront', 'domains', 'provisioning', 'users', 'customers', 'support', 'activity', 'notes'] as const
export type StoreTab = (typeof storeTabs)[number]

export const StoreTabs = ({ storeId, current }: { storeId: string; current: StoreTab }) => (
  <DetailTabs
    label={words.tabsLabel}
    tabs={storeTabs}
    labels={words.tabs}
    current={current}
    link={(tab, props) => <Link to="/stores/$storeId" params={{ storeId }} search={tab === 'overview' ? { tab: undefined } : { tab }} activeOptions={{ explicitUndefined: true }} {...props} />}
  />
)
