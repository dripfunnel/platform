import type { NavViewWords } from '@dripfunnel/shared/ui'
import { fill, formatCount, messages } from '../../messages'
import type { NavBadgeSource, NavRow } from '../../nav'

// This app's words for the shared navView.
export const navWords: NavViewWords<NavRow['key'], NavBadgeSource> = {
  label: (key) => messages.nav[key],
  badge: (source, count) => fill(messages.shell.badges[source], { count }),
  count: formatCount,
}
