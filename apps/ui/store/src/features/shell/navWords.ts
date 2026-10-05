import { navView, type NavRowView, type NavViewWords } from '@dripfunnel/shared/ui'
import { fill, formatCount, messages, plural } from '../../messages'
import { navFor, type NavBadgeSource, type NavKey, type Seat } from '../../nav'

const words: NavViewWords<NavKey, NavBadgeSource> = {
  label: (key) => messages.nav[key],
  badge: (source, count, n) => fill(plural(messages.shell.badges[source], n), { count }),
  count: formatCount,
}

/** The seat's rows, worded, grouped and badged; Billing notes the trial's days left (the prototype's). */
export const navRowsFor = (seat: Seat, badges: Record<NavBadgeSource, number>, trialDaysLeft: number | null): NavRowView[] => {
  const rows = navFor(seat)
  return navView(rows, badges, words).map((view, i) => {
    const group = rows[i]?.group
    const note = view.key === 'billing' && trialDaysLeft !== null ? fill(plural(messages.shell.trialNote, trialDaysLeft), { count: formatCount(trialDaysLeft) }) : undefined
    return { ...view, ...(group ? { group: messages.shell.groups[group] } : {}), ...(note ? { note } : {}) }
  })
}
