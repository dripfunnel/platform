import type { NavRowView } from '@dripfunnel/shared/ui'
import type { NavBadges } from '../../api/navBadges'
import { fill, formatCount, messages } from '../../messages'
import type { NavItem } from '../../nav'

// The rows as the shared SideNav draws them: this app's labels, and a badge only when its
// count is above zero, with the spoken label.
export const navView = (rows: readonly NavItem[], badges: NavBadges): NavRowView[] =>
  rows.map(({ badge, ...row }) => {
    const count = badge ? badges[badge] : 0
    const label = messages.nav[row.key]
    return badge && count > 0
      ? { ...row, label, badge: { count: formatCount(count), label: fill(messages.shell.badges[badge], { count: formatCount(count) }) } }
      : { ...row, label }
  })
