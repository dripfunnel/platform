import type { IconName } from './Icon'
import type { NavRowView } from './SideNav'

export interface NavViewWords<Key extends string, Badge extends string> {
  label: (key: Key) => string
  // The spoken badge label for a formatted count ("3 need attention").
  badge: (source: Badge, count: string) => string
  count: (count: number) => string
}

// The rows as SideNav draws them: the app's labels, and a badge only when its count is above
// zero, with the spoken label. Both consoles map their nav data through this.
export const navView = <Key extends string, Badge extends string>(
  rows: readonly { key: Key; to: string; icon: IconName; badge?: Badge }[],
  badges: Record<Badge, number>,
  words: NavViewWords<Key, Badge>,
): NavRowView[] =>
  rows.map(({ badge, key, to, icon }) => {
    const count = badge === undefined ? 0 : badges[badge]
    const label = words.label(key)
    return badge !== undefined && count > 0
      ? { key, to, icon, label, badge: { count: words.count(count), label: words.badge(badge, words.count(count)) } }
      : { key, to, icon, label }
  })
