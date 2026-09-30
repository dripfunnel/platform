import { Link } from '@tanstack/react-router'
import { messages } from '../../messages'
import { DetailTabs } from '../common/DetailTabs'

const words = messages.customer

export const customerTabs = ['overview', 'activity'] as const
export type CustomerTab = (typeof customerTabs)[number]

export const CustomerTabs = ({ customerId, current }: { customerId: string; current: CustomerTab }) => (
  <DetailTabs
    label={words.tabsLabel}
    tabs={customerTabs}
    labels={words.tabs}
    current={current}
    link={(tab, props) => (
      <Link
        to="/customers/$customerId"
        params={{ customerId }}
        search={tab === 'overview' ? { tab: undefined } : { tab }}
        activeOptions={{ explicitUndefined: true }}
        {...props}
      />
    )}
  />
)
