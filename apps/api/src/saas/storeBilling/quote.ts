// What a plan change costs and when it happens (SAAS §7.2, PortalBilling): a paid-to-paid upgrade is prorated today
// (the new plan for the days left, less what is unused of the old), a downgrade or a shorter period waits for the
// period's end, and leaving the trial starts the first period now. Minor units, rounded half up as Stripe does.

export type Interval = 'month' | 'year'
export type When = 'now' | 'period_end'

export interface CurrentPlan {
  /** Paid for: false in the trial, or with no subscription yet on Stripe. */
  paid: boolean
  amount: number
  interval: Interval
  /** The plan's monthly price, what plans are ranked by. */
  rank: number
  periodStart: Date
  periodEnd: Date
}

export interface TargetPlan {
  amount: number
  interval: Interval
  rank: number
}

export interface Quote {
  /** The ways this change may be made; a downgrade or a shorter period only at the period's end. */
  offered: readonly When[]
  /** What `when` costs today: the new plan's part, less the old plan's unused part, never below zero. */
  charge: number
  credit: number
  today: number
  /** When the change takes effect, and the price from the next period. */
  from: Date
  nextAmount: number
}

const part = (amount: number, left: bigint, total: bigint): number => (total <= 0n ? 0 : Number((BigInt(amount) * left * 2n + total) / (total * 2n)))

export const addInterval = (from: Date, interval: Interval): Date => {
  const next = new Date(from)
  if (interval === 'year') next.setUTCFullYear(next.getUTCFullYear() + 1)
  else next.setUTCMonth(next.getUTCMonth() + 1)
  return next
}

export const offeredWays = (current: CurrentPlan, target: TargetPlan): readonly When[] => {
  if (!current.paid) return ['now']
  const down = target.rank < current.rank || (current.interval === 'year' && target.interval === 'month')
  return down ? ['period_end'] : ['now', 'period_end']
}

export const quoteChange = (current: CurrentPlan, target: TargetPlan, when: When, now: Date): Quote => {
  const offered = offeredWays(current, target)
  if (!current.paid) return { offered, charge: target.amount, credit: 0, today: target.amount, from: now, nextAmount: target.amount }
  if (when === 'period_end') return { offered, charge: 0, credit: 0, today: 0, from: current.periodEnd, nextAmount: target.amount }
  const total = BigInt(current.periodEnd.getTime() - current.periodStart.getTime())
  const left = BigInt(Math.min(Math.max(current.periodEnd.getTime() - now.getTime(), 0), current.periodEnd.getTime() - current.periodStart.getTime()))
  const credit = part(current.amount, left, total)
  // A longer period starts again today (Stripe resets the anchor), so the whole of it is charged.
  const charge = target.interval === current.interval ? part(target.amount, left, total) : target.amount
  return { offered, charge, credit, today: Math.max(charge - credit, 0), from: now, nextAmount: target.amount }
}
