import { formatMoney } from '@dripfunnel/shared/format'
import type { ApiMoney } from '../../api/orders'
import type { BillingInterval, CataloguePlan, PlanValue, Subscription, Usage } from '../../api/billing'
import { fill, formatCount, formatDay, locale, messages, plural } from '../../messages'

// What the Billing screen says about the API's plan and usage (PortalBilling); nothing here prices anything.

const words = messages.billing

export const money = (m: ApiMoney): string => formatMoney({ amount: Number(m.amount), currency: m.currency }, locale)

/** A calendar day of an ISO time, in UTC, as the portal names days. */
export const dayOf = (iso: string): string => formatDay(iso.slice(0, 10))

export const priceOf = (plan: CataloguePlan, interval: BillingInterval): ApiMoney | null => (interval === 'YEAR' ? plan.yearly : plan.monthly)

const isZero = (m: ApiMoney | null) => m === null || Number(m.amount) === 0

/** A plan that costs nothing either way: what "Move to Free" moves to (FIRST-RELEASE §16). */
export const isFree = (plan: CataloguePlan): boolean => isZero(plan.monthly) && isZero(plan.yearly)

/** The API's own ranking (SAAS §7.2): the monthly price, or a twelfth of the yearly. Only the button's wording follows it. */
const rankOf = (plan: CataloguePlan): number => (plan.monthly ? Number(plan.monthly.amount) : plan.yearly ? Number(plan.yearly.amount) / 12 : 0)

export const isUpgrade = (plan: CataloguePlan, current: CataloguePlan | undefined): boolean => !current || rankOf(plan) > rankOf(current)

const valueOf = (plan: CataloguePlan, key: string): PlanValue | undefined => plan.values.find((v) => v.key === key)

const counted = (value: PlanValue | undefined, forms: { one: string; other: string }, unlimited: string, none?: string): string | null => {
  if (!value) return null
  if (value.unlimited) return unlimited
  if (value.amount === null) return null
  if (value.amount === 0 && none) return none
  return fill(plural(forms, value.amount), { count: formatCount(value.amount) })
}

/** The four lines each plan's card leads with, as the prototype's do. */
export const planPoints = (plan: CataloguePlan): string[] => {
  const p = words.plans.points
  const bandwidth = valueOf(plan, 'bandwidth_gb')
  return [
    counted(valueOf(plan, 'products'), p.products, p.productsUnlimited),
    counted(valueOf(plan, 'staff'), p.staff, p.staffUnlimited, p.staffNone),
    counted(valueOf(plan, 'markets'), p.markets, p.marketsUnlimited),
    bandwidth?.unlimited ? p.bandwidthUnlimited : bandwidth?.amount != null ? fill(p.bandwidth, { count: formatCount(bandwidth.amount) }) : null,
  ].filter((line): line is string => line !== null)
}

const monthlyKeys = new Set(['ai_prompts', 'publish_now'])
const rowLabels: Record<string, string> = words.includes.rows
const choiceLabels: Record<string, readonly string[]> = words.includes.choices

const cellOf = (value: PlanValue | undefined): string => {
  const w = words.includes
  if (!value) return w.off
  if (value.kind === 'switch') return value.enabled ? w.on : w.off
  if (value.unlimited) return w.unlimited
  if (value.amount === null) return w.off
  if (value.kind === 'choice') return choiceLabels[value.key]?.[value.amount] ?? w.off
  const count = formatCount(value.amount)
  return monthlyKeys.has(value.key) ? fill(w.monthly, { count }) : count
}

export interface IncludesRow {
  key: string
  label: string
  cells: string[]
}

/** Every setting the plans carry, in the API's order (the pricing page's), one cell a plan; a key this portal has no words for is left out. */
export const includesRows = (plans: readonly CataloguePlan[]): IncludesRow[] => {
  const keys = [...new Set(plans.flatMap((p) => p.values.map((v) => v.key)))]
  return keys.flatMap((key) => {
    const label = rowLabels[key]
    return label ? [{ key, label, cells: plans.map((p) => cellOf(valueOf(p, key))) }] : []
  })
}

export interface Meter {
  key: string
  label: string
  value: string
  /** 0–100, or null for no bar (Unlimited is never near a limit, FIRST-RELEASE §16). */
  percent: number | null
  tone: 'ok' | 'near' | 'full'
  note: string
}

const usageLabels: Record<string, string> = words.usage.rows

/** The first of next month, when a monthly count starts again (src/apis/store/billing.ts: from the 1st, UTC). */
const nextMonth = (now: Date): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)

export const metersOf = (usage: readonly Usage[], now: Date): Meter[] =>
  usage.flatMap((u): Meter[] => {
    const label = usageLabels[u.key]
    // A limit of none with nothing used is a feature the plan leaves out, not a meter.
    if (!label || (u.limit === 0 && u.used === 0)) return []
    const used = formatCount(u.used)
    const resets = u.monthly ? fill(words.usage.resets, { date: formatDay(nextMonth(now)) }) : ''
    if (u.unlimited || u.limit === null) return [{ key: u.key, label, value: fill(words.usage.noLimit, { used }), percent: null, tone: 'ok', note: resets }]
    const ratio = u.limit === 0 ? (u.used > 0 ? 1 : 0) : u.used / u.limit
    const tone = ratio >= 1 ? ('full' as const) : ratio >= 0.8 ? ('near' as const) : ('ok' as const)
    const note = [tone === 'full' ? words.usage.full : tone === 'near' ? words.usage.nearly : '', resets].filter(Boolean).join(' · ')
    return [{ key: u.key, label, value: fill(words.usage.of, { used, limit: formatCount(u.limit) }), percent: Math.min(100, Math.round(ratio * 100)), tone, note }]
  })

const brandName = (brand: string) => (brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : '')

/** The brand, last 4 and expiry Stripe gave; never more of the card (SAAS §7.2). */
export const cardText = (card: Subscription['card']): string => {
  if (!card) return words.card.none
  const on = fill(words.card.on, { brand: brandName(card.brand), last4: card.last4 })
  if (!card.expires) return on
  const [year, month] = card.expires.split('-')
  return fill(words.card.expires, { card: on, date: `${month ?? ''}/${(year ?? '').slice(2)}` })
}
