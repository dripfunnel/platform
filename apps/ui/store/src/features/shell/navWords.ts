import { navView, type NavRowView, type NavViewWords } from '@dripfunnel/shared/ui'
import { fill, formatCount, messages, plural } from '../../messages'
import { navFor, type NavBadgeSource, type NavKey, type Seat } from '../../nav'

const words: NavViewWords<NavKey, NavBadgeSource> = {
  label: (key) => messages.nav[key],
  badge: (source, count, n) => fill(plural(messages.shell.badges[source], n), { count }),
  count: formatCount,
}

const noteOf = (key: string, seat: Seat, trialDaysLeft: number | null): string | undefined => {
  if (key === 'billing' && trialDaysLeft !== null) return fill(plural(messages.shell.trialNote, trialDaysLeft), { count: formatCount(trialDaysLeft) })
  if (key === 'yourProducts' && seat.side === 'supplier' && seat.tier === 'vendor-stock') return messages.shell.stockOnly
  return undefined
}

/** The seat's rows, worded, grouped and badged; Billing notes the trial's days left and a Stock-only supplier's products say so (the prototype's). */
export const navRowsFor = (seat: Seat, badges: Record<NavBadgeSource, number>, trialDaysLeft: number | null): NavRowView[] => {
  const rows = navFor(seat)
  return navView(rows, badges, words).map((view, i) => {
    const group = rows[i]?.group
    const note = noteOf(view.key, seat, trialDaysLeft)
    return { ...view, ...(group ? { group: messages.shell.groups[group] } : {}), ...(note ? { note } : {}) }
  })
}
