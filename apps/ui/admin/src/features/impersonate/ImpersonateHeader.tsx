import { Link } from '@tanstack/react-router'
import { fill, formatCount, messages } from '../../messages'
import { DetailTabs } from '../common/DetailTabs'
import { ListHeader } from '../common/ListHeader'

const words = messages.impersonate
const tabs = ['users', 'sessions'] as const
export type ImpersonateTab = (typeof tabs)[number]

export interface ImpersonateHeaderProps {
  current: ImpersonateTab
  openCount: number
}

export const ImpersonateHeader = ({ current, openCount }: ImpersonateHeaderProps) => (
  <>
    <ListHeader level={words.level} title={words.title} sub={words.sub} />
    <DetailTabs
      label={words.tabsLabel}
      tabs={tabs}
      labels={{ users: words.tabs.users, sessions: openCount > 0 ? fill(words.tabs.sessionsOpen, { count: formatCount(openCount) }) : words.tabs.sessions }}
      current={current}
      link={(tab, props) => <Link to={tab === 'users' ? '/impersonate' : '/impersonate/sessions'} {...props} />}
    />
  </>
)
